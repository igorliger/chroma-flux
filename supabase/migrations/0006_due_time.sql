-- =============================================================================
-- Chroma Flux — hora do prazo (opcional)
-- =============================================================================
-- A hora vai numa coluna separada, e não convertendo `due_date` em timestamp,
-- por duas razões:
--
--   1. Ela é opcional. Num timestamp, "sem hora" viraria meia-noite, e uma
--      tarefa para hoje pareceria vencida desde o início do dia.
--
--   2. `time` sem fuso guarda hora de parede: "entregar às 14:30" significa
--      14:30 para quem lê, em qualquer lugar. Um `timestamptz` deslocaria o
--      horário conforme o fuso do leitor — comportamento certo para um evento
--      de agenda, errado para um prazo de trabalho.
--
-- A recorrência continua operando só sobre a data: a hora é herdada intacta
-- pela próxima ocorrência, que é o comportamento esperado de "toda terça às 9h".
-- =============================================================================

alter table public.tasks
  add column if not exists due_time time;

-- Hora sem data não descreve prazo nenhum.
do $$ begin
  alter table public.tasks
    add constraint tasks_due_time_needs_date
    check (due_time is null or due_date is not null);
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- A próxima ocorrência precisa herdar a hora
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
  v_secao   uuid;
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
    new.recurrence_type,
    new.recurrence_interval,
    new.recurrence_unit,
    new.recurrence_weekdays,
    v_base
  );

  if v_proxima is null then
    return new;
  end if;

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    return new;
  end if;

  select s.id into v_secao
  from public.sections s
  where s.project_id = new.project_id
  order by s.position
  limit 1;

  insert into public.tasks (
    workspace_id, project_id, section_id, parent_task_id,
    title, description, assignee_id, priority, due_date, due_time,
    position, created_by,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.project_id,
    case when new.parent_task_id is null then v_secao else null end,
    new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.due_time,          -- a hora acompanha a série
    new.position, new.created_by,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  update public.tasks set recurrence_type = 'none' where id = new.id;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- A view expõe `t.*`; sem recriá-la, a coluna nova não apareceria.
-- -----------------------------------------------------------------------------
drop view if exists public.task_overview;

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
