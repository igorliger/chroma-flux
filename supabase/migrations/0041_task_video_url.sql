-- =============================================================================
-- 0041 — Link de vídeo na tarefa
-- =============================================================================
-- Campo opcional com o link de um vídeo (ex.: compartilhamento da Asustor
-- via EZ-Connect). O site mostra um botão "Assistir vídeo" que abre o link
-- numa aba nova — a página de compartilhamento da Asustor não pode ser
-- embutida em outro site.
--
-- Só aceita http(s), até 2000 caracteres. Quem só pode concluir não muda o
-- link (o gatilho tasks_guard_field_edits compara a linha inteira).
-- A próxima ocorrência de uma tarefa repetida herda o link.
--
-- É seguro rodar de novo.

alter table public.tasks
  add column if not exists video_url text;

do $$
begin
  alter table public.tasks
    add constraint tasks_video_url_check
    check (video_url is null or (char_length(video_url) <= 2000 and video_url ~* '^https?://'));
exception when duplicate_object then null;
end $$;

-- Próxima ocorrência leva o link (igual à 0040, mais `video_url`) ---------------
create or replace function public.spawn_next_occurrence(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.tasks;
  v_base    date;
  v_proxima date;
begin
  select * into v from public.tasks where id = p_task_id for update;
  -- Sem repetição (ou já gerou a próxima — a antiga fica com 'none'): nada a fazer.
  if v.id is null or v.recurrence_type = 'none' then
    return;
  end if;

  v_base := case
    when v.recurrence_type = 'periodic' then current_date
    else coalesce(v.recurrence_anchor, v.due_date, current_date)
  end;

  v_proxima := public.next_due_date(
    v.recurrence_type, v.recurrence_interval, v.recurrence_unit,
    v.recurrence_weekdays, v_base
  );

  if v_proxima is null then
    return;
  end if;

  perform set_config('chroma.escrita_interna', 'on', true);

  if v.recurrence_ends_on is not null and v_proxima > v.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = v.id;
    perform set_config('chroma.escrita_interna', 'off', true);
    return;
  end if;

  insert into public.tasks (
    workspace_id, parent_task_id,
    title, description, assignee_id, co_assignee_ids, assigned_to_all, priority, due_date, due_time,
    position, created_by, is_personal,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on,
    holiday_week_shift, recurrence_anchor, video_url
  )
  values (
    v.workspace_id, v.parent_task_id,
    v.title, v.description, v.assignee_id, v.co_assignee_ids, v.assigned_to_all, v.priority,
    v_proxima, v.due_time,
    v.position, v.created_by, v.is_personal,
    v.recurrence_type, v.recurrence_interval, v.recurrence_unit,
    v.recurrence_weekdays, v.recurrence_ends_on,
    v.holiday_week_shift, case when v.holiday_week_shift then v_proxima end, v.video_url
  );

  update public.tasks set recurrence_type = 'none' where id = v.id;

  perform set_config('chroma.escrita_interna', 'off', true);
  return;
end;
$$;

-- A view leva o link (coluna nova no final) -----------------------------------
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
    where a.task_id = t.id and a.mime_type like 'image/%')::integer as image_count,
  t.holiday_week_shift,
  t.recurrence_anchor,
  t.video_url
from public.tasks t;
