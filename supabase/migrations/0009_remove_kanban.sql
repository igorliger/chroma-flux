-- =============================================================================
-- 0009 — Remoção do quadro Kanban
-- =============================================================================
-- As tarefas passam a formar uma lista única do espaço de trabalho. O estado
-- de uma tarefa vira apenas concluída ou em aberto; o que a organiza é
-- responsável, prioridade e prazo.
--
-- As tarefas são preservadas: só perdem `section_id`.

-- A view depende de t.* e precisa sair antes da coluna.
drop view if exists public.task_overview;

drop policy if exists sections_select on public.sections;
drop policy if exists sections_insert on public.sections;
drop policy if exists sections_update on public.sections;
drop policy if exists sections_delete on public.sections;

drop trigger if exists sections_set_updated_at on public.sections;

-- A FK composta tasks(section_id, workspace_id) cai junto com a coluna.
alter table public.tasks drop column if exists section_id;

drop table if exists public.sections cascade;

-- O espaço não semeia mais colunas: só o vínculo do proprietário.
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

-- A próxima ocorrência não precisa mais procurar coluna de destino.
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

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
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
  return new;
end;
$$;

-- `tasks_before_write` anulava section_id em subtarefas; sem colunas, resta a
-- guarda de profundidade e o completed_at automático.
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_is_subtask boolean;
begin
  if new.is_completed and (tg_op = 'INSERT' or not old.is_completed) then
    new.completed_at := now();
  elsif not new.is_completed then
    new.completed_at := null;
  end if;

  if new.parent_task_id is not null then
    select (parent_task_id is not null) into v_parent_is_subtask
    from public.tasks where id = new.parent_task_id;

    if coalesce(v_parent_is_subtask, false) then
      raise exception 'Subtarefas não podem ter subtarefas.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- O índice do quadro dá lugar a um de listagem.
drop index if exists public.tasks_workspace_board_idx;
create index if not exists tasks_workspace_list_idx
  on public.tasks (workspace_id, is_completed, position)
  where parent_task_id is null;

-- A capacidade de gerenciar colunas deixa de existir.
delete from public.user_permissions where capability = 'section.manage';

create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select r::public.workspace_role, c from (
    values
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.delete'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.delete'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','task.create'),     ('member','task.edit'),     ('member','task.delete'),
      ('member','comment.create')
  ) as t(r, c);
$$;

revoke execute on function public.default_permissions()
  from public, anon, authenticated;

create view public.task_overview
with (security_invoker = on) as
select
  t.*,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id)::int as subtask_count,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id and s.is_completed)::int as subtask_done_count,
  (select count(*) from public.comments c
    where c.task_id = t.id)::int as comment_count
from public.tasks t;

grant select on public.task_overview to authenticated;
revoke all on public.task_overview from anon;
