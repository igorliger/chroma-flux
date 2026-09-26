-- =============================================================================
-- 0028 — Feriados
-- =============================================================================
-- Cada proprietário tem uma lista de feriados (nacionais, estaduais,
-- municipais e da própria empresa) que vale para todos os seus espaços.
--
-- Tarefa com prazo num feriado passa para o próximo dia útil (segunda a
-- sexta, fora feriados) — ao criar, ao editar a data e quando a repetição
-- gera a próxima ocorrência. Cadastrar um feriado novo também move as
-- tarefas abertas que já estavam marcadas para aquele dia. No feriado não sai
-- o resumo diário de tarefas.
--
-- É seguro rodar de novo.

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  date date not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  scope text not null default 'empresa'
    check (scope in ('nacional', 'estadual', 'municipal', 'empresa')),
  created_at timestamptz not null default now(),
  unique (owner_id, date)
);

alter table public.holidays enable row level security;

-- O dono mexe; a equipe dele só consulta.
drop policy if exists holidays_select on public.holidays;
create policy holidays_select on public.holidays
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.team_members t
      where t.owner_id = holidays.owner_id and t.user_id = auth.uid()
    )
  );

drop policy if exists holidays_write on public.holidays;
create policy holidays_write on public.holidays
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Dia útil
-- -----------------------------------------------------------------------------
create or replace function public.next_business_day(p_owner_id uuid, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d date := p_date;
begin
  -- Segunda a sexta e fora dos feriados do dono. O limite só evita laço
  -- infinito se alguém cadastrar um mês inteiro de feriados.
  for i in 1..60 loop
    if extract(isodow from d) < 6
       and not exists (select 1 from public.holidays h where h.owner_id = p_owner_id and h.date = d) then
      return d;
    end if;
    d := d + 1;
  end loop;
  return p_date;
end;
$$;

revoke execute on function public.next_business_day(uuid, date) from anon, public;
grant execute on function public.next_business_day(uuid, date) to authenticated;

-- Prazo num feriado → próximo dia útil.
create or replace function public.tasks_shift_holiday()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dono uuid;
begin
  if new.due_date is null then
    return new;
  end if;

  select w.owner_id into dono from public.workspaces w where w.id = new.workspace_id;

  if exists (select 1 from public.holidays h where h.owner_id = dono and h.date = new.due_date) then
    new.due_date := public.next_business_day(dono, new.due_date);
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_shift_holiday() from anon, authenticated, public;

drop trigger if exists tasks_shift_holiday_trg on public.tasks;
create trigger tasks_shift_holiday_trg
  before insert or update of due_date on public.tasks
  for each row execute function public.tasks_shift_holiday();

-- Feriado novo: as tarefas abertas daquele dia andam para o próximo dia útil.
create or replace function public.holidays_shift_tasks()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('chroma.escrita_interna', 'on', true);
  update public.tasks t
  set due_date = public.next_business_day(new.owner_id, t.due_date)
  from public.workspaces w
  where w.id = t.workspace_id
    and w.owner_id = new.owner_id
    and t.due_date = new.date
    and not t.is_completed;
  perform set_config('chroma.escrita_interna', 'off', true);
  return new;
end;
$$;

revoke execute on function public.holidays_shift_tasks() from anon, authenticated, public;

drop trigger if exists holidays_shift_tasks_trg on public.holidays;
create trigger holidays_shift_tasks_trg
  after insert or update of date on public.holidays
  for each row execute function public.holidays_shift_tasks();

-- A pessoa está de feriado nesse dia (feriado de algum dono de espaço em que ela está)?
create or replace function public.is_holiday_for_user(p_user_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.holidays h
    where h.date = p_date
      and (
        h.owner_id = p_user_id
        or exists (
          select 1 from public.workspace_members m
          join public.workspaces w on w.id = m.workspace_id
          where m.user_id = p_user_id and w.owner_id = h.owner_id
        )
      )
  );
$$;

revoke execute on function public.is_holiday_for_user(uuid, date) from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Resumo diário: não sai em feriado
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
      -- no feriado não sai o resumo do dia (0028)
      and not (c.kind = 'digest' and public.is_holiday_for_user(c.user_id, hoje))
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
