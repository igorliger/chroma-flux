-- =============================================================================
-- 0032 — Contadores de anexos nas listas ("Contém N anexos/imagens")
-- =============================================================================
-- As duas views de lista ganham `attachment_count` (todos os anexos) e
-- `image_count` (só os de tipo image/*) no FIM — as colunas existentes não
-- mudam de lugar, como pede `create or replace view`. Contam os anexos da
-- descrição e os dos comentários.
--
-- `security_invoker = true` continua: a contagem respeita a RLS de quem
-- consulta, então ninguém descobre anexos que não poderia ver.
--
-- Só mexe em views (nenhum dado é alterado). É seguro rodar de novo.

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
  t.assigned_to_all,
  (select count(*) from public.attachments a where a.task_id = t.id)::integer as attachment_count,
  (select count(*) from public.attachments a
    where a.task_id = t.id and a.mime_type like 'image/%')::integer as image_count
from public.tasks t;

create or replace view public.personal_task_overview
with (security_invoker = true) as
select
  t.id, t.owner_id, t.parent_task_id, t.title, t.description, t.priority,
  t.due_date, t.due_time, t.is_completed, t.completed_at, t."position",
  t.recurrence_type, t.recurrence_interval, t.recurrence_unit,
  t.recurrence_weekdays, t.recurrence_ends_on,
  t.created_at, t.updated_at,
  (select count(*) from public.personal_tasks s where s.parent_task_id = t.id)::integer
    as subtask_count,
  (select count(*) from public.personal_tasks s
    where s.parent_task_id = t.id and s.is_completed)::integer
    as subtask_done_count,
  (select count(*) from public.personal_task_attachments a where a.task_id = t.id)::integer
    as attachment_count,
  (select count(*) from public.personal_task_attachments a
    where a.task_id = t.id and a.mime_type like 'image/%')::integer
    as image_count
from public.personal_tasks t;
