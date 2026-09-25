-- =============================================================================
-- 0018 — Mais de um responsável por tarefa
-- =============================================================================
-- `assignee_id` continua sendo o responsável principal (é ele que aparece
-- primeiro e que as telas antigas já conhecem). `co_assignee_ids` guarda os
-- demais. Todos eles veem a tarefa em "Minhas tarefas", recebem os lembretes
-- e podem concluí-la.
--
-- É seguro rodar de novo.

alter table public.tasks
  add column if not exists co_assignee_ids uuid[] not null default '{}';

create index if not exists tasks_co_assignee_ids_idx
  on public.tasks using gin (co_assignee_ids);

-- A view ganha a coluna no fim (create or replace só permite acrescentar).
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
  t.co_assignee_ids
from public.tasks t;

-- -----------------------------------------------------------------------------
-- Normaliza a lista: sem repetidos, sem nulos e sem o responsável principal
-- -----------------------------------------------------------------------------
create or replace function public.tasks_normalize_co_assignees()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.co_assignee_ids := coalesce((
    select array_agg(distinct x)
    from unnest(coalesce(new.co_assignee_ids, '{}')) as x
    where x is not null and x is distinct from new.assignee_id
  ), '{}');
  return new;
end;
$$;

drop trigger if exists tasks_normalize_co_assignees_trg on public.tasks;
-- Nome começa com "tasks_a..." para rodar antes da trava de atribuição
-- (os gatilhos BEFORE rodam em ordem alfabética).
drop trigger if exists tasks_a_normalize_co_assignees_trg on public.tasks;
create trigger tasks_a_normalize_co_assignees_trg
  before insert or update of assignee_id, co_assignee_ids on public.tasks
  for each row execute function public.tasks_normalize_co_assignees();

-- -----------------------------------------------------------------------------
-- Trava de atribuição (0017) estendida aos outros responsáveis
-- -----------------------------------------------------------------------------
-- Sem "Atribuir tarefas a outras pessoas", a pessoa só pode incluir ou tirar
-- a si mesma da lista de responsáveis.
create or replace function public.tasks_guard_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  antigos uuid[] := case when tg_op = 'UPDATE' then old.co_assignee_ids else '{}' end;
begin
  if eu is null
     or coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on'
     or new.is_personal then
    return new;
  end if;

  if public.has_capability(new.workspace_id, 'task.assign_others') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assignee_id is null then
      new.assignee_id := eu;
    elsif new.assignee_id <> eu then
      raise exception 'Você só pode criar tarefas para você mesmo.'
        using errcode = '42501';
    end if;
  elsif new.assignee_id is distinct from old.assignee_id
        and new.assignee_id is distinct from eu then
    raise exception 'Você não pode passar tarefas para outra pessoa.'
      using errcode = '42501';
  end if;

  -- Quem entrou ou saiu da lista de outros responsáveis, tirando a si mesmo.
  if exists (
    select 1 from unnest(new.co_assignee_ids) x
    where x <> eu and not (x = any(antigos))
  ) or exists (
    select 1 from unnest(antigos) x
    where x <> eu and not (x = any(new.co_assignee_ids))
      and x is distinct from new.assignee_id
  ) then
    raise exception 'Você só pode incluir ou remover você mesmo como responsável.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.tasks_guard_assignment() from anon, authenticated, public;

drop trigger if exists tasks_guard_assignment_trg on public.tasks;
create trigger tasks_guard_assignment_trg
  before insert or update of assignee_id, co_assignee_ids on public.tasks
  for each row execute function public.tasks_guard_assignment();

-- -----------------------------------------------------------------------------
-- Aviso interno ("Você recebeu uma tarefa") para quem entra na lista
-- -----------------------------------------------------------------------------
create or replace function public.notify_task_co_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications
    (user_id, workspace_id, task_id, actor_id, type, task_title, actor_name)
  select
    x, new.workspace_id, new.id, auth.uid(), 'task_assigned',
    new.title, coalesce(public.display_name(auth.uid()), 'Alguém')
  from unnest(new.co_assignee_ids) as x
  where x is distinct from auth.uid()
    and (tg_op = 'INSERT' or not (x = any(old.co_assignee_ids)))
    -- a próxima ocorrência de uma tarefa repetida não é "atribuição nova"
    and coalesce(current_setting('chroma.escrita_interna', true), 'off') <> 'on';
  return new;
end;
$$;

revoke execute on function public.notify_task_co_assigned() from anon, authenticated, public;

drop trigger if exists tasks_notify_co_assigned_trg on public.tasks;
create trigger tasks_notify_co_assigned_trg
  after insert or update of co_assignee_ids on public.tasks
  for each row execute function public.notify_task_co_assigned();

-- -----------------------------------------------------------------------------
-- A próxima ocorrência de uma tarefa repetida leva os mesmos responsáveis
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
    title, description, assignee_id, co_assignee_ids, priority, due_date, due_time,
    position, created_by, is_personal,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.parent_task_id,
    new.title, new.description, new.assignee_id, new.co_assignee_ids, new.priority,
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
-- Lembretes (0016) passam a ir para todos os responsáveis
-- -----------------------------------------------------------------------------
create or replace function public.claim_push_reminders()
returns table (user_id uuid, kind text, ref text, title text, body text, url text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  agora timestamp := (now() at time zone 'America/Sao_Paulo');
  hoje date := agora::date;
begin
  -- O registro só precisa lembrar o suficiente para não repetir aviso.
  delete from public.notification_log where sent_at < now() - interval '30 days';

  return query
  with alvo as (
    -- Um lembrete para cada responsável: o principal (ou quem criou, se não
    -- houver) e cada um dos outros responsáveis (0018).
    select t.*, d.destinatario
    from public.tasks t
    cross join lateral (
      select distinct x as destinatario
      from unnest(array[coalesce(t.assignee_id, t.created_by)] || t.co_assignee_ids) as x
      where x is not null
    ) d
    where not t.is_completed
      and t.due_date is not null
      and t.due_date <= hoje + 1
  ),
  com_dispositivo as (
    select distinct s.user_id from public.push_subscriptions s
  ),
  candidatos as (
    -- Vencendo nos próximos 15 minutos
    select
      a.destinatario as user_id,
      'due_soon'::text as kind,
      a.id::text || ':' || a.due_date::text as ref,
      'Tarefa vencendo às ' || to_char(a.due_date + a.due_time, 'HH24:MI') as title,
      a.title as body,
      case when a.is_personal then '/minhas-tarefas'
           else '/e/' || a.workspace_id::text || '/tarefas' end as url
    from alvo a
    where a.due_time is not null
      and (a.due_date + a.due_time) > agora
      and (a.due_date + a.due_time) <= agora + interval '15 minutes'

    union all

    -- Resumo do dia
    select
      r.destinatario,
      'digest',
      hoje::text,
      'Suas tarefas de hoje',
      case
        when r.hoje_n > 0 and r.atrasadas > 0 then
          'Você tem ' || r.hoje_n || case when r.hoje_n = 1 then ' tarefa' else ' tarefas' end ||
          ' para hoje e ' || r.atrasadas || case when r.atrasadas = 1 then ' atrasada.' else ' atrasadas.' end
        when r.hoje_n > 0 then
          'Você tem ' || r.hoje_n || case when r.hoje_n = 1 then ' tarefa' else ' tarefas' end || ' para hoje.'
        else
          'Você tem ' || r.atrasadas || case when r.atrasadas = 1 then ' tarefa atrasada.' else ' tarefas atrasadas.' end
      end,
      '/minhas-tarefas'
    from (
      select
        a.destinatario,
        count(*) filter (where a.due_date = hoje) as hoje_n,
        count(*) filter (where a.due_date < hoje) as atrasadas
      from alvo a
      group by a.destinatario
    ) r
    where agora::time >= time '08:00'
      and agora::time < time '20:00'
      and (r.hoje_n > 0 or r.atrasadas > 0)
  ),
  filtrados as (
    select c.*
    from candidatos c
    join com_dispositivo d on d.user_id = c.user_id
    where not public.is_user_blocked_by_access_window(c.user_id)
  ),
  marcados as (
    insert into public.notification_log (user_id, kind, ref)
    select f.user_id, f.kind, f.ref from filtrados f
    on conflict do nothing
    returning notification_log.user_id, notification_log.kind, notification_log.ref
  )
  select f.user_id, f.kind, f.ref, f.title, f.body, f.url
  from filtrados f
  join marcados m using (user_id, kind, ref);
end;
$$;

revoke execute on function public.claim_push_reminders() from anon, authenticated, public;
grant execute on function public.claim_push_reminders() to service_role;
