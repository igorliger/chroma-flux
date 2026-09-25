-- =============================================================================
-- Chroma Flux — concluir separado de editar
-- =============================================================================
-- Até aqui `task.edit` era um cadeado único sobre a linha inteira: quem podia
-- marcar uma tarefa como feita podia também mudar prazo, repetição, descrição,
-- título e responsável. Para um membro que apenas executa o que o administrador
-- designou, isso é permissão demais.
--
-- Esta migração parte o cadeado em dois:
--
--   task.complete  marcar concluída (e reabrir) — nada mais
--   task.edit      todo o resto dos campos, como antes
--
-- Quem já tinha `task.edit` recebe `task.complete` junto, então nenhuma conta
-- existente muda de comportamento ao aplicar isto.
--
-- A RLS sozinha não dá conta: uma policy de UPDATE enxerga a linha nova e a
-- antiga, mas não consegue exigir "só esta coluna mudou" de forma legível. Por
-- isso a policy libera a operação e um gatilho `before update` compara as duas
-- versões, recusando qualquer alteração fora da conclusão.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A capacidade nova entra nos padrões
-- -----------------------------------------------------------------------------
create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
as $$
  select r::public.workspace_role, c from (
    values
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.complete'),
      ('owner','task.delete'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.complete'),
      ('admin','task.delete'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','task.create'),     ('member','task.edit'),     ('member','task.complete'),
      ('member','task.delete'),
      ('member','comment.create')
  ) as t(r, c);
$$;

-- Contas que já existem: quem editava passa a concluir explicitamente. Sem
-- isto, aplicar a migração tiraria de todo mundo a permissão de concluir.
insert into public.user_permissions (user_id, role, capability)
select user_id, role, 'task.complete'
from public.user_permissions
where capability = 'task.edit'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. A policy passa a aceitar qualquer uma das duas
-- -----------------------------------------------------------------------------
-- Quem só tem `task.complete` atravessa a policy e é filtrado pelo gatilho
-- abaixo, que é onde a distinção entre as colunas cabe.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    public.can_see_workspace_tasks(workspace_id)
    and (
      public.has_capability(workspace_id, 'task.edit')
      or public.has_capability(workspace_id, 'task.complete')
    )
  )
  with check (
    public.can_see_workspace_tasks(workspace_id)
    and (
      public.has_capability(workspace_id, 'task.edit')
      or public.has_capability(workspace_id, 'task.complete')
    )
  );

-- -----------------------------------------------------------------------------
-- 3. O gatilho que separa conclusão de edição
-- -----------------------------------------------------------------------------
create or replace function public.tasks_guard_field_edits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /*
    Escrita interna do próprio banco — a que migra a recorrência para a nova
    ocorrência depois de concluir. Ela roda em nome de quem concluiu, que pode
    não ter `task.edit`; sem esta saída, um membro concluindo uma tarefa
    repetida esbarraria na própria regra que o gatilho existe para aplicar.
  */
  if coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on' then
    return new;
  end if;

  if public.has_capability(new.workspace_id, 'task.edit') then
    return new;
  end if;

  /*
    Comparação da linha inteira menos as três colunas que a conclusão mexe.
    Em jsonb porque enumerar coluna a coluna envelhece mal: uma coluna nova
    entraria sem proteção, e é justamente a coluna esquecida que vira brecha.
    `completed_at` sai porque `tasks_before_write` a preenche antes daqui, e
    `updated_at` porque outro gatilho a carimba depois.
  */
  if (to_jsonb(new) - 'is_completed' - 'completed_at' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'is_completed' - 'completed_at' - 'updated_at')
  then
    raise exception
      'Sem permissão para alterar esta tarefa: você pode apenas marcá-la como concluída.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Nome escolhido para ordenar depois de `tasks_before_write_trg` e antes de
-- `tasks_set_updated_at`: gatilhos `before` disparam em ordem alfabética.
drop trigger if exists tasks_guard_field_edits_trg on public.tasks;
create trigger tasks_guard_field_edits_trg
  before update on public.tasks
  for each row execute function public.tasks_guard_field_edits();

-- -----------------------------------------------------------------------------
-- 4. A recorrência avisa que a escrita é dela
-- -----------------------------------------------------------------------------
create or replace function public.tasks_spawn_next_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base    date;
  v_proxima date;
begin
  if new.recurrence_type = 'none' then
    return new;
  end if;
  if not (new.is_completed and not old.is_completed) then
    return new;
  end if;

  v_base := case
    when new.recurrence_type = 'periodic' then current_date
    else coalesce(new.due_date, current_date)
  end;

  v_proxima := public.next_due_date(
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, v_base
  );

  if v_proxima is null then
    return new;
  end if;

  -- Vale só até o fim desta transação.
  perform set_config('chroma.escrita_interna', 'on', true);

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    perform set_config('chroma.escrita_interna', 'off', true);
    return new;
  end if;

  insert into public.tasks (
    workspace_id, parent_task_id,
    title, description, assignee_id, priority, due_date, due_time,
    position, created_by,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.due_time,
    new.position, new.created_by,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  -- A recorrência migra para a nova ocorrência: a concluída vira histórico.
  update public.tasks set recurrence_type = 'none' where id = new.id;

  perform set_config('chroma.escrita_interna', 'off', true);
  return new;
end;
$$;
