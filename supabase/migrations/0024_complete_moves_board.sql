-- =============================================================================
-- 0024 — Quem só pode concluir também move a coluna do quadro
-- =============================================================================
-- Quem tem "Marcar como concluída" mas não "Editar tarefas" só pode mexer no
-- campo de conclusão (gatilho tasks_guard_field_edits). Só que concluir
-- também leva a tarefa para a coluna "Feito" do quadro (board_status) — e o
-- gatilho contava isso como edição, recusando a conclusão inteira com "você
-- pode apenas marcá-la como concluída". A coluna do quadro passa a ser
-- tratada como parte da conclusão.
--
-- É seguro rodar de novo.

create or replace function public.tasks_guard_field_edits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on' then
    return new;
  end if;

  if public.has_capability(new.workspace_id, 'task.edit') then
    return new;
  end if;

  if (to_jsonb(new) - 'is_completed' - 'completed_at' - 'updated_at' - 'board_status')
     is distinct from
     (to_jsonb(old) - 'is_completed' - 'completed_at' - 'updated_at' - 'board_status')
  then
    raise exception
      'Sem permissão para alterar esta tarefa: você pode apenas marcá-la como concluída.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.tasks_guard_field_edits() from anon, authenticated, public;
