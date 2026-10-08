-- =============================================================================
-- 0034 — Aviso de tarefas atrasadas a cada 15 minutos
-- =============================================================================
-- `claim_push_reminders` (chamada pelo pg_cron a cada 5 min) ganha um terceiro
-- tipo de aviso, `overdue`: para cada pessoa com tarefa atrasada — de espaço
-- (como responsável que ainda não concluiu a sua parte) ou lembrete pessoal —
-- um aviso "Você tem N tarefas atrasadas" a cada 15 minutos, das 08:00 às
-- 20:00 (horário de Brasília), fora de feriado e dentro da janela de acesso.
-- Some sozinho quando não houver mais nada atrasado.
--
-- O resto da função é idêntico ao da 0028. Não altera dados; é seguro rodar
-- de novo.

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
  -- O aviso de atrasadas se repete a cada 15 minutos: o registro dele vence
  -- antes disso (14 min, folga para o cron de 5 em 5 não pular uma volta).
  delete from public.notification_log
  where kind = 'overdue' and sent_at < now() - interval '14 minutes';

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
  atrasadas as (
    -- Tarefas de espaço atrasadas (dia passado, ou hoje com a hora já vencida)
    -- e lembretes pessoais atrasados (0029), por pessoa.
    select a.destinatario as user_id, a.title, a.due_date, a.due_time
    from alvo a
    where a.due_date < hoje
       or (a.due_date = hoje and a.due_time is not null and a.due_date + a.due_time <= agora)

    union all

    select p.owner_id, p.title, p.due_date, p.due_time
    from public.personal_tasks p
    where not p.is_completed
      and p.due_date is not null
      and (p.due_date < hoje
           or (p.due_date = hoje and p.due_time is not null and p.due_date + p.due_time <= agora))
  ),
  resumo_atrasadas as (
    select
      x.user_id,
      count(*) as n,
      (array_agg(x.title order by x.due_date, x.due_time nulls first))[1] as mais_antiga
    from atrasadas x
    group by x.user_id
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

    union all

    -- Atrasadas: a cada 15 minutos, das 08:00 às 20:00, enquanto houver
    -- alguma (0034). `ref` fixo = mesma `tag` no aparelho: o aviso novo
    -- substitui o anterior em vez de empilhar.
    select
      ra.user_id,
      'overdue',
      'atrasadas',
      case when ra.n = 1 then 'Você tem 1 tarefa atrasada'
           else 'Você tem ' || ra.n || ' tarefas atrasadas' end,
      case when ra.n = 1 then '“' || ra.mais_antiga || '”'
           else '“' || ra.mais_antiga || '” e mais ' || (ra.n - 1) end,
      '/minhas-tarefas'
    from resumo_atrasadas ra
    where agora::time >= time '08:00'
      and agora::time < time '20:00'
  ),
  filtrados as (
    select c.*
    from candidatos c
    join com_dispositivo d on d.user_id = c.user_id
    where not public.is_user_blocked_by_access_window(c.user_id)
      -- no feriado não sai o resumo do dia (0028)
      and not (c.kind = 'digest' and public.is_holiday_for_user(c.user_id, hoje))
      -- nem o de atrasadas (0034)
      and not (c.kind = 'overdue' and public.is_holiday_for_user(c.user_id, hoje))
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
