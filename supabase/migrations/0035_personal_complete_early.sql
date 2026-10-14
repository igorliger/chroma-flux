-- =============================================================================
-- 0035 — Tarefa pessoal pode ser concluída antes do prazo
-- =============================================================================
-- A 0031 passou a recusar concluir antes do dia do prazo, para evitar engano
-- em trabalho combinado. Na lista pessoal isso só atrapalha: quem anotou para
-- si e já resolveu antes quer poder marcar como feito.
--
-- Agora a trava vale só para tarefas do espaço. Ficam livres:
--   - tarefas particulares (`tasks.is_personal = true`);
--   - lembretes pessoais (`personal_tasks`).
--
-- É seguro rodar de novo.

create or replace function public.tasks_guard_future_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_completed
     and (tg_op = 'INSERT' or not old.is_completed)
     and not new.is_personal
     and new.due_date is not null
     and new.due_date > (now() at time zone 'America/Sao_Paulo')::date
     and coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'off'
  then
    raise exception 'Você não pode concluir uma tarefa antes do dia do prazo.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_guard_future_completion() from anon, authenticated, public;

-- Lembretes pessoais: sem trava nenhuma.
drop trigger if exists personal_tasks_guard_future_completion_trg on public.personal_tasks;
drop function if exists public.personal_tasks_guard_future_completion();

-- Conclusão por pessoa: mesma exceção para tarefa particular.
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

