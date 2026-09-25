-- =============================================================================
-- 0025 — Conclusão por responsável
-- =============================================================================
-- Em tarefas com mais de um responsável (ou "Todos"), cada um conclui a sua
-- parte. A tarefa só fica concluída de vez (is_completed) quando todos os
-- responsáveis concluírem — e aí a repetição gera a próxima ocorrência, como
-- sempre. Até lá, para quem ainda não concluiu, ela continua aberta (e
-- atrasada, se passar do prazo).
--
-- Tarefas com um responsável só continuam como antes: concluir é concluir.
--
-- É seguro rodar de novo.

create table if not exists public.task_completions (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

alter table public.task_completions enable row level security;

-- Vê quem vê a tarefa. Gravar só pela função abaixo.
drop policy if exists task_completions_select on public.task_completions;
create policy task_completions_select on public.task_completions
  for select to authenticated
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (public.can_see_workspace_tasks(t.workspace_id) or public.is_responsible_for_task(t.id))
    )
  );

-- A view ganha quem já concluiu a sua parte (coluna no fim).
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
  ) as completed_by_ids
from public.tasks t;

-- -----------------------------------------------------------------------------
-- Concluir (ou desfazer) a minha parte
-- -----------------------------------------------------------------------------
-- Devolve true quando, com isso, a tarefa ficou concluída para todos.
create or replace function public.set_my_task_completion(p_task_id uuid, p_done boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  t public.tasks;
  responsaveis uuid[];
  faltam integer;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if t.id is null then
    raise exception 'Tarefa não encontrada.' using errcode = 'no_data_found';
  end if;

  responsaveis := array(
    select distinct x from unnest(array[t.assignee_id] || t.co_assignee_ids) x where x is not null
  );

  if not (eu = any(responsaveis)) then
    raise exception 'Você não é responsável por esta tarefa.' using errcode = '42501';
  end if;
  if not (public.has_capability(t.workspace_id, 'task.complete')
          or public.has_capability(t.workspace_id, 'task.edit')) then
    raise exception 'Você não tem permissão para concluir tarefas neste espaço.' using errcode = '42501';
  end if;

  if p_done then
    insert into public.task_completions (task_id, user_id) values (t.id, eu)
    on conflict do nothing;
  else
    delete from public.task_completions where task_id = t.id and user_id = eu;
  end if;

  select count(*) into faltam
  from unnest(responsaveis) r
  where not exists (select 1 from public.task_completions c where c.task_id = t.id and c.user_id = r);

  if faltam = 0 and not t.is_completed then
    -- Todos concluíram: conclui a tarefa (dispara aviso e próxima ocorrência).
    update public.tasks set is_completed = true, board_status = 'done' where id = t.id;
    return true;
  elsif faltam > 0 and t.is_completed then
    -- Alguém desfez a sua parte: a tarefa volta a ficar aberta — sem apagar
    -- a parte de quem já tinha concluído (ver tasks_reset_completions).
    perform set_config('chroma.reabrindo_parte', 'on', true);
    update public.tasks set is_completed = false, board_status = 'doing' where id = t.id;
    perform set_config('chroma.reabrindo_parte', 'off', true);
  end if;

  return false;
end;
$$;

grant execute on function public.set_my_task_completion(uuid, boolean) to authenticated;
revoke execute on function public.set_my_task_completion(uuid, boolean) from anon, public;

-- Reabrir a tarefa inteira (por quem administra) zera as partes concluídas.
create or replace function public.tasks_reset_completions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.is_completed and not new.is_completed
     and coalesce(current_setting('chroma.reabrindo_parte', true), 'off') <> 'on' then
    delete from public.task_completions where task_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_reset_completions() from anon, authenticated, public;

drop trigger if exists tasks_reset_completions_trg on public.tasks;
create trigger tasks_reset_completions_trg
  after update of is_completed on public.tasks
  for each row execute function public.tasks_reset_completions();

-- -----------------------------------------------------------------------------
-- Lembretes: quem já concluiu a sua parte sai da lista
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
        -- quem já concluiu a sua parte não recebe mais lembrete (0025)
        and not exists (
          select 1 from public.task_completions c where c.task_id = t.id and c.user_id = x
        )
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
