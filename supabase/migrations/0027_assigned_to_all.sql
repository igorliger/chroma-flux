-- =============================================================================
-- 0027 — "Todos" dinâmico
-- =============================================================================
-- Antes, marcar "Todos" copiava quem estava no espaço naquele momento: quem
-- entrasse depois ficava de fora das tarefas. Agora a tarefa guarda a marca
-- `assigned_to_all` e a lista de responsáveis acompanha o espaço: quem entra
-- (como membro ou administrador) vira responsável das tarefas abertas marcadas
-- com "Todos"; quem sai deixa de ser. Visualizador não entra — só lê.
--
-- É seguro rodar de novo.

alter table public.tasks
  add column if not exists assigned_to_all boolean not null default false;

-- A view ganha a coluna no fim.
create or replace view public.task_overview
with (security_invoker = true) as
select
  t.id, t.workspace_id, t.parent_task_id, t.title, t.description, t.assignee_id,
  t.priority, t.due_date, t.is_completed, t.completed_at, t."position",
  t.created_by, t.created_at, t.updated_at,
  t.recurrence_type, t.recurrence_interval, t.recurrence_unit,
  t.recurrence_weekdays, t.recurrence_ends_on, t.due_time,
  (select count(*) from public.tasks s where s.parent_task_id = t.id)::integer as subtask_count,
  (select count(*) from public.tasks s where s.parent_task_id = t.id and s.is_completed)::integer as subtask_done_count,
  (select count(*) from public.comments c where c.task_id = t.id)::integer as comment_count,
  t.is_personal, t.board_status,
  t.co_assignee_ids,
  coalesce(
    (select array_agg(c.user_id order by c.completed_at) from public.task_completions c where c.task_id = t.id),
    '{}'
  ) as completed_by_ids,
  t.assigned_to_all
from public.tasks t;

-- -----------------------------------------------------------------------------
-- Quem entra ou sai do espaço entra ou sai das tarefas "Todos"
-- -----------------------------------------------------------------------------
create or replace function public.workspace_members_sync_all_tasks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  trabalha_novo boolean := tg_op <> 'DELETE' and new.role in ('owner', 'admin', 'member');
  trabalhava boolean := tg_op <> 'INSERT' and old.role in ('owner', 'admin', 'member');
  ws uuid := case when tg_op = 'DELETE' then old.workspace_id else new.workspace_id end;
  pessoa uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  -- Escrita do sistema: não passa pelas travas de quem está logado (quem
  -- aceita um convite não tem permissão de atribuir tarefas a si mesmo aqui).
  perform set_config('chroma.escrita_interna', 'on', true);

  if trabalha_novo and not trabalhava then
    update public.tasks t
    set co_assignee_ids = array_append(t.co_assignee_ids, pessoa)
    where t.workspace_id = ws
      and t.assigned_to_all
      and not t.is_completed
      and not t.is_personal
      and t.assignee_id is distinct from pessoa
      and not (pessoa = any(t.co_assignee_ids));
  elsif trabalhava and not trabalha_novo then
    update public.tasks t
    set co_assignee_ids = array_remove(t.co_assignee_ids, pessoa)
    where t.workspace_id = ws
      and t.assigned_to_all
      and not t.is_completed
      and pessoa = any(t.co_assignee_ids);
  end if;

  perform set_config('chroma.escrita_interna', 'off', true);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.workspace_members_sync_all_tasks() from anon, authenticated, public;

drop trigger if exists workspace_members_sync_all_tasks_trg on public.workspace_members;
create trigger workspace_members_sync_all_tasks_trg
  after insert or update of role or delete on public.workspace_members
  for each row execute function public.workspace_members_sync_all_tasks();

-- -----------------------------------------------------------------------------
-- A próxima ocorrência de uma tarefa repetida leva a marca "Todos"
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

  perform set_config('chroma.escrita_interna', 'on', true);

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    perform set_config('chroma.escrita_interna', 'off', true);
    return new;
  end if;

  insert into public.tasks (
    workspace_id, parent_task_id,
    title, description, assignee_id, co_assignee_ids, assigned_to_all, priority, due_date, due_time,
    position, created_by, is_personal,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.parent_task_id,
    new.title, new.description, new.assignee_id, new.co_assignee_ids, new.assigned_to_all, new.priority,
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

-- -----------------------------------------------------------------------------
-- Tarefas que já existiam
-- -----------------------------------------------------------------------------
-- Marca como "Todos" as tarefas abertas com vários responsáveis que cobrem
-- todos os membros do espaço (tirando o dono e quem entrou depois de a tarefa
-- ser criada) — é o que "Todos" significava quando foram montadas.
-- Escrita do sistema: sem travas de usuário e sem aviso de "nova tarefa".
select set_config('chroma.escrita_interna', 'on', true);

update public.tasks t
set assigned_to_all = true
where not t.is_completed
  and not t.is_personal
  and t.parent_task_id is null
  and cardinality(t.co_assignee_ids) >= 1
  and not exists (
    select 1
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = t.workspace_id
      and m.role in ('admin', 'member')
      and m.user_id <> w.owner_id
      and m.created_at <= t.created_at
      and m.user_id is distinct from t.assignee_id
      and not (m.user_id = any(t.co_assignee_ids))
  );

-- E inclui nelas quem entrou depois (o motivo desta migração).
update public.tasks t
set co_assignee_ids = t.co_assignee_ids || array(
  select m.user_id
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  where m.workspace_id = t.workspace_id
    and m.role in ('admin', 'member')
    and m.user_id <> w.owner_id
    and m.user_id is distinct from t.assignee_id
    and not (m.user_id = any(t.co_assignee_ids))
)
where t.assigned_to_all and not t.is_completed;

select set_config('chroma.escrita_interna', 'off', true);
