-- =============================================================================
-- Chroma Flux — view de apoio
-- =============================================================================
-- `security_invoker = on` (Postgres 15+) faz a view rodar com as permissões de
-- quem consulta, e não com as do dono. Sem isso, a view seria um furo na RLS:
-- qualquer usuário enxergaria as tarefas de todos os workspaces através dela.
-- =============================================================================

create or replace view public.task_overview
with (security_invoker = on) as
select
  t.*,
  (
    select count(*)
    from public.tasks s
    where s.parent_task_id = t.id
  )::int as subtask_count,
  (
    select count(*)
    from public.tasks s
    where s.parent_task_id = t.id and s.is_completed
  )::int as subtask_done_count,
  (
    select count(*)
    from public.comments c
    where c.task_id = t.id
  )::int as comment_count
from public.tasks t;

grant select on public.task_overview to authenticated;
revoke all on public.task_overview from anon;
