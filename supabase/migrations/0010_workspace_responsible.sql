-- =============================================================================
-- 0010 — Responsável pelo espaço e visibilidade das tarefas
-- =============================================================================
-- Um espaço pode ter uma pessoa designada, escolhida por quem administra.
-- Enquanto ninguém estiver designado, ele funciona como antes: compartilhado
-- entre todos os membros. Designar alguém torna o espaço privado dessa pessoa
-- — só ela e quem administra enxergam tarefas, comentários e anexos de lá.
--
-- A designação não é um papel e não concede permissão nenhuma. Quem designa é
-- quem pode editar o espaço (capacidade `workspace.edit`), já que o campo vive
-- na linha do próprio workspace.
--
-- Nada fica escondido pela aplicação desta migração: `responsible_id` nasce
-- nulo em todos os espaços, então a restrição é sempre uma escolha explícita.

alter table public.workspaces
  add column if not exists responsible_id uuid;

-- A FK é COMPOSTA de propósito: aponta para (workspace_id, user_id) de
-- workspace_members, não para profiles. Assim o banco garante que a pessoa
-- designada é membro DESTE espaço — apontar para alguém de fora fica
-- impossível, não só desencorajado pela interface.
--
-- `set null (responsible_id)` limita a anulação a essa coluna; sem a lista o
-- Postgres tentaria anular `id`, que é a chave primária. Exige Postgres 15+.
-- Efeito prático: quem sai do espaço deixa de ser o responsável, e o campo
-- volta a ficar vazio em vez de apontar para um ex-membro.
alter table public.workspaces
  drop constraint if exists workspaces_responsible_fkey;
alter table public.workspaces
  add constraint workspaces_responsible_fkey
  foreign key (id, responsible_id)
  references public.workspace_members (workspace_id, user_id)
  on delete set null (responsible_id);

create index if not exists workspaces_responsible_idx
  on public.workspaces (responsible_id)
  where responsible_id is not null;

create or replace function public.can_see_workspace_tasks(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.workspace_members m
      on m.workspace_id = w.id and m.user_id = auth.uid()
    where w.id = p_workspace_id
      and (
        -- Ninguém designado: espaço compartilhado.
        w.responsible_id is null
        -- A pessoa designada.
        or w.responsible_id = auth.uid()
        -- Quem administra, para poder acompanhar e reatribuir.
        --
        -- A checagem consulta a matriz direto, em vez de `has_capability`, de
        -- propósito: `has_capability` também aplica a janela de uso, e a
        -- janela restringe escrita, não leitura. Usá-la aqui esconderia as
        -- tarefas do administrador fora do horário.
        or exists (
          select 1 from public.user_permissions p
          where p.user_id = w.owner_id
            and p.role = m.role
            and p.capability = 'member.manage'
        )
      )
  );
$$;

revoke execute on function public.can_see_workspace_tasks(uuid) from public, anon;
grant execute on function public.can_see_workspace_tasks(uuid) to authenticated;

-- Leitura -------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id));

-- Comentários e anexos acompanham a tarefa: sem isso, um membro sem acesso às
-- tarefas ainda leria a conversa sobre elas.
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id));

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (public.can_see_workspace_tasks(workspace_id));

-- Escrita -------------------------------------------------------------------
-- A policy de UPDATE/DELETE tem o próprio USING, independente da de SELECT.
-- Sem repetir a checagem aqui, alguém com `task.edit` poderia alterar ou
-- apagar às cegas tarefas que não consegue enxergar.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.create')
    and public.can_see_workspace_tasks(workspace_id)
    and created_by = auth.uid()
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    public.has_capability(workspace_id, 'task.edit')
    and public.can_see_workspace_tasks(workspace_id)
  )
  with check (
    public.has_capability(workspace_id, 'task.edit')
    and public.can_see_workspace_tasks(workspace_id)
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (
    public.has_capability(workspace_id, 'task.delete')
    and public.can_see_workspace_tasks(workspace_id)
  );

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'comment.create')
    and public.can_see_workspace_tasks(workspace_id)
    and author_id = auth.uid()
  );

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
  for update to authenticated
  using (author_id = auth.uid() and public.can_see_workspace_tasks(workspace_id))
  with check (author_id = auth.uid());

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    public.can_see_workspace_tasks(workspace_id)
    and (author_id = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
  );

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.edit')
    and public.can_see_workspace_tasks(workspace_id)
    and uploaded_by = auth.uid()
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    public.can_see_workspace_tasks(workspace_id)
    and (uploaded_by = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
  );
