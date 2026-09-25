-- =============================================================================
-- Chroma Flux — tarefas particulares
-- =============================================================================
-- Até aqui toda tarefa era do espaço: alguém designava, todo mundo via. Faltava
-- o outro lado — a lista que a pessoa mantém para si, com o que ela mesma
-- resolveu fazer e ninguém pediu.
--
-- `is_personal` marca essas linhas. Elas continuam pertencendo ao espaço onde
-- nasceram (é isso que mantém o administrador enxergando, como decidido), mas
-- a interface as separa: a lista pessoal atravessa todos os espaços da pessoa,
-- e a tela de tarefas do espaço continua mostrando o trabalho combinado.
--
-- Uma correção vem junto. `can_see_workspace_tasks` esconde as tarefas dos
-- membros quando o espaço tem um responsável designado. Sem tratar isso, um
-- membro criaria uma tarefa particular num espaço desses e ela sumiria da
-- própria lista dele. A policy de leitura passa a garantir que o autor sempre
-- enxerga o que é seu.
-- =============================================================================

alter table public.tasks
  add column if not exists is_personal boolean not null default false;

comment on column public.tasks.is_personal is
  'Tarefa que a pessoa criou para si, fora do trabalho designado pelo espaco.';

-- A lista pessoal filtra por autor; o índice parcial só cobre as linhas que
-- interessam, que são a minoria.
create index if not exists tasks_personal_idx
  on public.tasks (created_by, is_completed)
  where is_personal;

-- -----------------------------------------------------------------------------
-- A view precisa carregar a coluna nova
-- -----------------------------------------------------------------------------
-- `task_overview` lista as colunas uma a uma, então acrescentar ao `tasks` não
-- basta: sem recriar, a aplicação nunca veria `is_personal`.
--
-- A coluna vai no fim, e não junto das outras de `tasks`, porque
-- `create or replace view` só aceita acréscimos no final — no meio, o Postgres
-- entende que a coluna existente foi renomeada e recusa (42P16). Recriar a view
-- com `drop` resolveria a ordem, mas derrubaria junto o que depende dela.
create or replace view public.task_overview as
  select
    t.id,
    t.workspace_id,
    t.parent_task_id,
    t.title,
    t.description,
    t.assignee_id,
    t.priority,
    t.due_date,
    t.is_completed,
    t.completed_at,
    t.position,
    t.created_by,
    t.created_at,
    t.updated_at,
    t.recurrence_type,
    t.recurrence_interval,
    t.recurrence_unit,
    t.recurrence_weekdays,
    t.recurrence_ends_on,
    t.due_time,
    (select count(*) from public.tasks s where s.parent_task_id = t.id)::integer
      as subtask_count,
    (select count(*) from public.tasks s
      where s.parent_task_id = t.id and s.is_completed)::integer
      as subtask_done_count,
    (select count(*) from public.comments c where c.task_id = t.id)::integer
      as comment_count,
    t.is_personal
  from public.tasks t;

-- -----------------------------------------------------------------------------
-- O autor sempre enxerga o que é dele
-- -----------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.can_see_workspace_tasks(workspace_id)
    -- Espaço com responsável designado esconde as tarefas dos demais membros.
    -- A tarefa particular do próprio autor é a exceção: ela nunca foi do
    -- espaço no sentido que essa regra protege.
    or (is_personal and created_by = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- A recorrência preserva o caráter particular
-- -----------------------------------------------------------------------------
-- Sem isto, a próxima ocorrência de uma tarefa particular repetida nasceria
-- como tarefa comum do espaço e apareceria na lista de trabalho de todos.
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

  perform set_config('chroma.escrita_interna', 'on', true);

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    perform set_config('chroma.escrita_interna', 'off', true);
    return new;
  end if;

  insert into public.tasks (
    workspace_id, parent_task_id,
    title, description, assignee_id, priority, due_date, due_time,
    position, created_by, is_personal,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.due_time,
    new.position, new.created_by, new.is_personal,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  update public.tasks set recurrence_type = 'none' where id = new.id;

  perform set_config('chroma.escrita_interna', 'off', true);
  return new;
end;
$$;
