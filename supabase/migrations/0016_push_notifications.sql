-- =============================================================================
-- 0016 — Notificações no navegador / sistema operacional (Web Push)
-- =============================================================================
-- O envio em si é feito pela Edge Function `push` (supabase/functions/push).
-- Aqui ficam:
--   * as assinaturas de cada dispositivo (`push_subscriptions`);
--   * o registro do que já foi enviado, para não repetir aviso (`notification_log`);
--   * o gatilho que avisa quando uma tarefa é concluída;
--   * o agendamento (pg_cron) que, a cada 5 minutos, manda os lembretes.
--
-- Segredos (chave privada VAPID e o segredo que autentica o banco perante a
-- função) ficam no Supabase Vault, NUNCA neste arquivo — ele vai para o git.
-- Os nomes esperados no Vault são:
--   push_vapid_public_key, push_vapid_private_key, push_webhook_secret
--
-- É seguro rodar de novo.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Assinaturas (um registro por navegador/dispositivo)
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Cada um só enxerga e apaga os próprios dispositivos. Gravar passa pela
-- função abaixo (o mesmo navegador pode trocar de conta).
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Registra (ou transfere para quem está logado) a assinatura deste navegador.
-- SECURITY DEFINER porque, num computador compartilhado, o mesmo endpoint pode
-- estar registrado em nome de outra conta — e a RLS não deixaria mexer nele.
-- Quem entrou por último é quem passa a receber os avisos neste aparelho.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        created_at = now();
end;
$$;

grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
revoke execute on function public.register_push_subscription(text, text, text, text) from anon, public;

-- -----------------------------------------------------------------------------
-- O que já foi avisado (só a função/serviço lê e grava)
-- -----------------------------------------------------------------------------
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.notification_log enable row level security;
-- Sem policies de propósito: ninguém pelo site lê ou grava aqui.

-- -----------------------------------------------------------------------------
-- Janela de uso por usuário (sem depender de auth.uid())
-- -----------------------------------------------------------------------------
-- Mesma regra de `is_blocked_by_access_window()`, mas para qualquer pessoa —
-- usada pelos lembretes, que rodam sem sessão. Não é exposta pela API.
create or replace function public.is_user_blocked_by_access_window(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    not exists (select 1 from public.workspaces w where w.owner_id = p_user_id)
    and exists (
      select 1
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = p_user_id
        and not public.within_access_window(w.owner_id, p_user_id)
    );
$$;

revoke execute on function public.is_user_blocked_by_access_window(uuid)
  from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Configuração lida pela Edge Function (só service_role)
-- -----------------------------------------------------------------------------
create or replace function public.get_push_config()
returns jsonb
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select jsonb_build_object(
    'vapid_public_key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_public_key'),
    'vapid_private_key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_private_key'),
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret')
  );
$$;

revoke execute on function public.get_push_config() from anon, authenticated, public;
grant execute on function public.get_push_config() to service_role;

-- -----------------------------------------------------------------------------
-- Chamada à Edge Function (usada pelo gatilho e pelo agendamento)
-- -----------------------------------------------------------------------------
-- pg_net é assíncrono: a gravação da tarefa não espera o envio nem falha se a
-- função estiver fora do ar.
create or replace function public.call_push_function(p_body jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, vault, pg_temp
as $$
declare
  segredo text;
begin
  select decrypted_secret into segredo
  from vault.decrypted_secrets where name = 'push_webhook_secret';

  if segredo is null then
    return; -- ainda não configurado: não faz nada
  end if;

  perform net.http_post(
    url := 'https://zdkgujlkdtxiabxntuce.supabase.co/functions/v1/push',
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-flux-secret', segredo
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.call_push_function(jsonb) from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Aviso de tarefa concluída
-- -----------------------------------------------------------------------------
-- Só na virada de "aberta" para "concluída", e não para tarefas particulares
-- (não há a quem avisar). Quem concluiu vai junto: é ele quem não recebe.
create or replace function public.tasks_notify_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_completed and not coalesce(old.is_completed, false) and not new.is_personal then
    perform public.call_push_function(jsonb_build_object(
      'type', 'completed',
      'task_id', new.id,
      'completed_by', auth.uid()
    ));
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_notify_completed() from anon, authenticated, public;

drop trigger if exists tasks_notify_completed on public.tasks;
create trigger tasks_notify_completed
  after update of is_completed on public.tasks
  for each row execute function public.tasks_notify_completed();

-- -----------------------------------------------------------------------------
-- Lembretes de tarefas a concluir
-- -----------------------------------------------------------------------------
-- Devolve os lembretes que devem sair AGORA e já os marca como enviados no
-- mesmo comando — se duas execuções se sobrepuserem, cada lembrete sai uma
-- vez só. Horário de Brasília.
--
--   due_soon: tarefa com hora marcada, vencendo nos próximos 15 minutos.
--   digest:   uma vez por dia, a partir das 08:00, resumo de quantas tarefas
--             vencem hoje e quantas estão atrasadas.
--
-- Vai para o responsável (ou para quem criou, se não houver responsável),
-- só para quem tem algum dispositivo com notificação ativada e não está fora
-- da janela de uso — quem está fora recebe o resumo quando a janela abrir.
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
    select t.*, coalesce(t.assignee_id, t.created_by) as destinatario
    from public.tasks t
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

-- A cada 5 minutos a função é chamada para enviar os lembretes pendentes.
select cron.unschedule(jobid) from cron.job where jobname = 'push-reminders';
select cron.schedule(
  'push-reminders',
  '*/5 * * * *',
  $$ select public.call_push_function('{"type":"reminders"}'::jsonb) $$
);
