-- =============================================================================
-- 0040 — Tarefa repetida com vários responsáveis: a próxima nasce na hora
-- =============================================================================
-- Achado com o Italo (espaço Equipe): numa tarefa repetida com vários
-- responsáveis, a próxima ocorrência só nascia quando TODOS concluíam a sua
-- parte. Quem já tinha feito a dele ficava sem tarefa nos dias seguintes
-- enquanto alguém atrasava — e a antiga aparecia como atrasada para o dono.
--
-- Agora a próxima ocorrência nasce assim que a primeira pessoa conclui a
-- sua parte. A antiga perde a repetição (como já acontecia ao gerar a
-- próxima) e segue aberta só para quem ainda não concluiu.
--
-- O cálculo da próxima data (agenda, feriado na semana — 0036) é o mesmo:
-- foi só movido do gatilho para `spawn_next_occurrence`, chamado pelo
-- gatilho (conclusão total ou "Concluir para todos") e pela conclusão por
-- pessoa (`set_my_task_completion`).
--
-- Também corrige as tarefas presas hoje: repetidas, abertas, em que alguém já
-- concluiu a sua parte, ganham a próxima ocorrência agora.
--
-- É seguro rodar de novo.

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
    holiday_week_shift, recurrence_anchor
  )
  values (
    v.workspace_id, v.parent_task_id,
    v.title, v.description, v.assignee_id, v.co_assignee_ids, v.assigned_to_all, v.priority,
    v_proxima, v.due_time,
    v.position, v.created_by, v.is_personal,
    v.recurrence_type, v.recurrence_interval, v.recurrence_unit,
    v.recurrence_weekdays, v.recurrence_ends_on,
    v.holiday_week_shift, case when v.holiday_week_shift then v_proxima end
  );

  update public.tasks set recurrence_type = 'none' where id = v.id;

  perform set_config('chroma.escrita_interna', 'off', true);
  return;
end;
$$;


create or replace function public.tasks_spawn_next_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.recurrence_type <> 'none' and new.is_completed and not old.is_completed then
    perform public.spawn_next_occurrence(new.id);
  end if;
  return new;
end;
$$;

create or replace function public.set_my_task_completion(p_task_id uuid, p_done boolean)
returns boolean
language plpgsql
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
  if p_done and not t.is_personal and t.due_date is not null
     and t.due_date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Você não pode concluir uma tarefa antes do dia do prazo.' using errcode = '42501';
  end if;

  if p_done then
    insert into public.task_completions (task_id, user_id) values (t.id, eu)
    on conflict do nothing;
    -- Repetida: a próxima ocorrência nasce já na primeira parte concluída
    -- (0040). Quem terminou não fica sem tarefa esperando os atrasados, e
    -- a antiga continua aberta (e atrasada) só para quem não concluiu.
    if t.recurrence_type <> 'none' then
      perform public.spawn_next_occurrence(t.id);
    end if;
  else
    delete from public.task_completions where task_id = t.id and user_id = eu;
  end if;

  select count(*) into faltam
  from unnest(responsaveis) r
  where not exists (select 1 from public.task_completions c where c.task_id = t.id and c.user_id = r);

  if faltam = 0 and not t.is_completed then
    update public.tasks set is_completed = true, board_status = 'done' where id = t.id;
    return true;
  elsif faltam > 0 and t.is_completed then
    perform set_config('chroma.reabrindo_parte', 'on', true);
    update public.tasks set is_completed = false, board_status = 'doing' where id = t.id;
    perform set_config('chroma.reabrindo_parte', 'off', true);
  end if;

  return false;
end;
$$;


revoke execute on function public.spawn_next_occurrence(uuid) from anon, authenticated, public;

-- Tarefas presas hoje -----------------------------------------------------------
do $$
declare
  presa uuid;
begin
  for presa in
    select t.id from public.tasks t
    where not t.is_completed
      and t.recurrence_type <> 'none'
      and exists (select 1 from public.task_completions c where c.task_id = t.id)
  loop
    perform public.spawn_next_occurrence(presa);
  end loop;
end $$;
