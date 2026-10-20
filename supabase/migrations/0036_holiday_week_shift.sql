-- =============================================================================
-- 0036 — Repetição: "Semana com feriado: adiar 1 dia"
-- =============================================================================
-- Opção por tarefa repetida (desligada por padrão). Ligada, cada feriado em
-- dia útil da semana, ANTES do dia da ocorrência, empurra a ocorrência um dia
-- útil para frente. Ex.: "toda terça e quinta" com feriado na segunda — a de
-- terça vai para quarta e a de quinta para sexta.
--
-- Para a agenda não se perder, a tarefa guarda o dia original em
-- `recurrence_anchor` (o dia "da agenda") e `due_date` passa a ser o dia
-- adiado. A próxima ocorrência é calculada a partir do dia da agenda — por
-- isso, depois da quarta (terça adiada), vem a quinta da agenda, que também
-- é adiada para sexta, e não a quinta "seguinte à quarta".
--
-- Quando o dia é recalculado:
--   - ao criar a tarefa ou gerar a próxima ocorrência;
--   - ao ligar a opção (desligar volta para o dia da agenda);
--   - ao cadastrar, mudar ou apagar um feriado daquela semana.
-- Mudar o prazo à mão vale como novo dia da agenda, sem adiar.
--
-- É seguro rodar de novo.

alter table public.tasks
  add column if not exists holiday_week_shift boolean not null default false,
  add column if not exists recurrence_anchor date;

comment on column public.tasks.holiday_week_shift is
  'Repeticao: cada feriado util da semana antes do dia adia a ocorrencia em 1 dia util (0036).';
comment on column public.tasks.recurrence_anchor is
  'Dia da agenda antes do adiamento por feriado na semana (0036).';

-- -----------------------------------------------------------------------------
-- Dia adiado: um dia útil a mais por feriado (seg–sex) da semana antes de p_date
-- -----------------------------------------------------------------------------
create or replace function public.holiday_week_shifted(p_owner_id uuid, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
  d date := p_date;
begin
  if p_date is null then
    return null;
  end if;

  select count(*) into n
  from public.holidays h
  where h.owner_id = p_owner_id
    and h.date >= date_trunc('week', p_date)::date   -- segunda da semana
    and h.date < p_date
    and extract(isodow from h.date) < 6;

  for i in 1..n loop
    d := public.next_business_day(p_owner_id, d + 1);
  end loop;

  -- O próprio dia (ou o adiado) também não pode cair em feriado/fim de semana.
  return public.next_business_day(p_owner_id, d);
end;
$$;

revoke execute on function public.holiday_week_shifted(uuid, date) from anon, public;
grant execute on function public.holiday_week_shifted(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Gatilho: aplica o adiamento ao criar e ao ligar/desligar a opção
-- -----------------------------------------------------------------------------
-- Roda antes de `tasks_shift_holiday_trg` (ordem alfabética), que depois só
-- confirma que o dia é útil.
create or replace function public.tasks_holiday_week_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dono uuid;
  interna boolean := coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on';
begin
  -- Sem repetição de agenda fixa, a opção não faz sentido.
  if new.recurrence_type in ('none', 'periodic') then
    new.holiday_week_shift := false;
  end if;

  if not new.holiday_week_shift then
    if tg_op = 'UPDATE' and old.holiday_week_shift and new.recurrence_anchor is not null
       and new.due_date is not distinct from old.due_date
       and new.recurrence_type not in ('none', 'periodic') then
      -- Desligou a opção: volta para o dia da agenda.
      new.due_date := new.recurrence_anchor;
    end if;
    new.recurrence_anchor := null;
    return new;
  end if;

  if new.due_date is null or new.is_completed then
    return new;
  end if;

  -- Recalculos feitos pelo próprio banco (feriado novo) já chegam prontos.
  if tg_op = 'UPDATE' and interna then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.holiday_week_shift then
    if new.due_date is distinct from old.due_date then
      -- Prazo mudado à mão: vira o novo dia da agenda, sem adiar.
      new.recurrence_anchor := new.due_date;
    end if;
    return new;
  end if;

  -- Criação (inclusive a próxima ocorrência) ou opção recém-ligada.
  select w.owner_id into dono from public.workspaces w where w.id = new.workspace_id;
  new.recurrence_anchor := coalesce(new.recurrence_anchor, new.due_date);
  new.due_date := public.holiday_week_shifted(dono, new.recurrence_anchor);
  return new;
end;
$$;

revoke execute on function public.tasks_holiday_week_shift() from anon, authenticated, public;

drop trigger if exists tasks_holiday_week_shift_trg on public.tasks;
create trigger tasks_holiday_week_shift_trg
  before insert or update on public.tasks
  for each row execute function public.tasks_holiday_week_shift();

-- -----------------------------------------------------------------------------
-- Feriado cadastrado, mudado ou apagado: recalcula as tarefas daquela semana
-- -----------------------------------------------------------------------------
create or replace function public.holidays_reshift_week()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dono uuid := coalesce(new.owner_id, old.owner_id);
  dia date;
begin
  perform set_config('chroma.escrita_interna', 'on', true);

  foreach dia in array array_remove(array[
    case when tg_op <> 'DELETE' then new.date end,
    case when tg_op <> 'INSERT' then old.date end
  ], null)
  loop
    update public.tasks t
    set due_date = public.holiday_week_shifted(dono, t.recurrence_anchor)
    from public.workspaces w
    where w.id = t.workspace_id
      and w.owner_id = dono
      and t.holiday_week_shift
      and not t.is_completed
      and t.recurrence_anchor is not null
      and date_trunc('week', t.recurrence_anchor) = date_trunc('week', dia)
      and t.due_date is distinct from public.holiday_week_shifted(dono, t.recurrence_anchor);
  end loop;

  perform set_config('chroma.escrita_interna', 'off', true);
  return null;
end;
$$;

revoke execute on function public.holidays_reshift_week() from anon, authenticated, public;

drop trigger if exists holidays_reshift_week_trg on public.holidays;
create trigger holidays_reshift_week_trg
  after insert or update of date or delete on public.holidays
  for each row execute function public.holidays_reshift_week();

-- -----------------------------------------------------------------------------
-- Próxima ocorrência: parte do dia da agenda e leva a opção junto
-- -----------------------------------------------------------------------------
-- Igual à da 0027, com `recurrence_anchor` na base e as duas colunas novas
-- copiadas para a ocorrência nova.
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
    else coalesce(new.recurrence_anchor, new.due_date, current_date)
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
    title, description, assignee_id, co_assignee_ids, assigned_to_all, priority, due_date, due_time,
    position, created_by, is_personal,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on,
    holiday_week_shift, recurrence_anchor
  )
  values (
    new.workspace_id, new.parent_task_id,
    new.title, new.description, new.assignee_id, new.co_assignee_ids, new.assigned_to_all, new.priority,
    v_proxima, new.due_time,
    new.position, new.created_by, new.is_personal,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on,
    new.holiday_week_shift, case when new.holiday_week_shift then v_proxima end
  );

  update public.tasks set recurrence_type = 'none' where id = new.id;

  perform set_config('chroma.escrita_interna', 'off', true);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- A view leva a opção (colunas novas no final, como pede `create or replace`)
-- -----------------------------------------------------------------------------
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
  t.recurrence_anchor
from public.tasks t;
