-- =============================================================================
-- 0023 — Quem é responsável por uma tarefa sempre a enxerga
-- =============================================================================
-- Com "Responsável pelo espaço" definido (0010), só o responsável e quem
-- administra viam as tarefas do espaço. Isso escondia de um membro até as
-- tarefas atribuídas a ele: ele era responsável, mas não via nada.
--
-- Agora, além da regra do espaço, quem é responsável (principal ou um dos
-- outros responsáveis) por uma tarefa a vê — junto com as subtarefas dela, os
-- comentários, anexos, campos e dependências — e pode trabalhar nela conforme
-- as permissões do papel. Criar subtarefa dentro dela também vale.
--
-- É seguro rodar de novo.

create or replace function public.is_responsible_for_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tasks t
    left join public.tasks pai on pai.id = t.parent_task_id
    where t.id = p_task_id
      and public.is_workspace_member(t.workspace_id)
      and (
        t.assignee_id = auth.uid()
        or auth.uid() = any(t.co_assignee_ids)
        -- subtarefa de uma tarefa pela qual a pessoa é responsável
        or pai.assignee_id = auth.uid()
        or auth.uid() = any(coalesce(pai.co_assignee_ids, '{}'))
      )
  );
$$;

grant execute on function public.is_responsible_for_task(uuid) to authenticated;
revoke execute on function public.is_responsible_for_task(uuid) from anon, public;

-- Tarefas ---------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.can_see_workspace_tasks(workspace_id)
    or (is_personal and created_by = auth.uid())
    or public.is_responsible_for_task(id)
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(id))
    and (public.has_capability(workspace_id, 'task.edit')
         or public.has_capability(workspace_id, 'task.complete'))
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.create')
    and created_by = auth.uid()
    and (
      public.can_see_workspace_tasks(workspace_id)
      or (parent_task_id is not null and public.is_responsible_for_task(parent_task_id))
    )
  );

-- Comentários -------------------------------------------------------------------
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'comment.create')
    and (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
    and author_id = auth.uid()
  );

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
  for update to authenticated
  using (
    author_id = auth.uid()
    and (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
  );

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
    and (author_id = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
  );

-- Anexos -------------------------------------------------------------------------
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.edit')
    and (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
    and uploaded_by = auth.uid()
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
    and (uploaded_by = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
  );

-- Campos personalizados --------------------------------------------------------
-- As definições (nome e tipo dos campos) não são segredo: quem está no
-- espaço precisa delas para ver os valores das próprias tarefas.
drop policy if exists custom_field_definitions_select on public.custom_field_definitions;
create policy custom_field_definitions_select on public.custom_field_definitions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists custom_field_values_select on public.custom_field_values;
create policy custom_field_values_select on public.custom_field_values
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id));

drop policy if exists custom_field_values_insert on public.custom_field_values;
create policy custom_field_values_insert on public.custom_field_values
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.edit')
    and (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
  );

drop policy if exists custom_field_values_update on public.custom_field_values;
create policy custom_field_values_update on public.custom_field_values
  for update to authenticated
  using (
    public.has_capability(workspace_id, 'task.edit')
    and (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
  );

drop policy if exists custom_field_values_delete on public.custom_field_values;
create policy custom_field_values_delete on public.custom_field_values
  for delete to authenticated
  using (
    public.has_capability(workspace_id, 'task.edit')
    and (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id))
  );

-- Dependências (só leitura: mexer nelas continua exigindo ver o espaço) ------
drop policy if exists task_dependencies_select on public.task_dependencies;
create policy task_dependencies_select on public.task_dependencies
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id) or public.is_responsible_for_task(task_id));
