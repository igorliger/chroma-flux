-- =============================================================================
-- Ajustes depois de restaurar o banco do Supabase Cloud no Supabase da VPS.
-- Rodar com:  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < pos-restauracao.sql
-- (Os segredos do Vault são recriados à parte — ver MIGRAR-SUPABASE.md, passo 7.)
-- =============================================================================

-- 1. A função que chama a Edge Function `push` apontava para o projeto na nuvem.
--    Dentro da rede do Docker, o banco alcança o gateway (Kong) pelo nome `kong`.
do $$
declare
  def text;
begin
  select pg_get_functiondef('public.call_push_function(jsonb)'::regprocedure) into def;
  if def like '%zdkgujlkdtxiabxntuce.supabase.co%' then
    execute replace(def, 'https://zdkgujlkdtxiabxntuce.supabase.co/functions/v1/push',
                         'http://kong:8000/functions/v1/push');
    raise notice 'call_push_function atualizada para http://kong:8000';
  else
    raise notice 'call_push_function já não aponta para a nuvem — nada a fazer';
  end if;
end $$;

-- 2. Lembretes a cada 5 minutos (pg_cron). Recria se não veio no dump.
select cron.unschedule(jobid) from cron.job where jobname = 'push-reminders';
select cron.schedule('push-reminders', '*/5 * * * *',
  $$ select public.call_push_function('{"type":"reminders"}'::jsonb) $$);

-- 3. Conferência
select 'usuarios' as item, count(*)::text as valor from auth.users
union all select 'tarefas', count(*)::text from public.tasks
union all select 'espacos', count(*)::text from public.workspaces
union all select 'feriados', count(*)::text from public.holidays
union all select 'cron', string_agg(jobname || ' ' || schedule, ', ') from cron.job
union all select 'buckets', string_agg(id, ', ') from storage.buckets;
