-- =============================================================================
-- Chroma Flux — permissões configuráveis por papel
-- =============================================================================
-- Antes, o que cada papel podia fazer estava escrito nas funções
-- `can_write_content()` e `can_administer()`. Agora vira dado: cada espaço de
-- trabalho tem sua própria matriz papel × capacidade, editável na tela de
-- configurações.
--
-- O ponto que faz isso valer alguma coisa é a RLS consultar a matriz. Se as
-- policies continuassem com a lógica fixa, as caixas de seleção seriam
-- enfeite — a interface mostraria uma permissão negada e o banco deixaria
-- passar assim mesmo.
--
-- TRAVA DE SEGURANÇA: `member.manage` do proprietário é imutável. Sem isso,
-- desmarcar essa caixa trancaria o espaço para sempre — ninguém poderia
-- reabrir a tela de permissões para desfazer.
-- =============================================================================

create table if not exists public.workspace_permissions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  role         public.workspace_role not null,
  capability   text not null,
  primary key (workspace_id, role, capability)
);

create index if not exists workspace_permissions_lookup_idx
  on public.workspace_permissions (workspace_id, role);

-- Presença da linha = permitido. A ausência é a negação, o que evita ter de
-- criar 48 linhas por espaço só para registrar "não".
comment on table public.workspace_permissions is
  'Matriz papel x capacidade por espaco. Linha presente = permitido.';

-- -----------------------------------------------------------------------------
-- Padrões — reproduzem exatamente o comportamento anterior
-- -----------------------------------------------------------------------------
create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
as $$
  select r, c from (
    values
      ('owner','project.create'),   ('owner','project.edit'),   ('owner','project.delete'),
      ('owner','section.manage'),
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.delete'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','project.create'),   ('admin','project.edit'),   ('admin','project.delete'),
      ('admin','section.manage'),
      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.delete'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','section.manage'),
      ('member','task.create'),     ('member','task.edit'),     ('member','task.delete'),
      ('member','comment.create')

      -- `viewer` não recebe nenhuma: somente leitura.
  ) as t(r, c);
$$;

-- Semeia um espaço com os padrões.
create or replace function public.seed_workspace_permissions(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.workspace_permissions (workspace_id, role, capability)
  select p_workspace_id, d.role, d.capability from public.default_permissions() d
  on conflict do nothing;
$$;

-- Espaços já existentes.
do $$
declare w record;
begin
  for w in select id from public.workspaces loop
    perform public.seed_workspace_permissions(w.id);
  end loop;
end $$;

-- Espaços novos.
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;

  perform public.seed_workspace_permissions(new.id);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- A trava: o proprietário nunca perde o controle de membros e permissões
-- -----------------------------------------------------------------------------
create or replace function public.protect_owner_control()
returns trigger
language plpgsql
as $$
begin
  if old.role = 'owner' and old.capability = 'member.manage' then
    raise exception
      'O proprietário não pode perder o controle de membros e permissões: '
      'seria impossível reabrir esta tela para desfazer.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists workspace_permissions_protect_owner on public.workspace_permissions;
create trigger workspace_permissions_protect_owner
  before delete on public.workspace_permissions
  for each row execute function public.protect_owner_control();

-- -----------------------------------------------------------------------------
-- Consulta de capacidade
-- -----------------------------------------------------------------------------
create or replace function public.has_capability(p_workspace_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members m
    join public.workspace_permissions p
      on p.workspace_id = m.workspace_id
     and p.role = m.role
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and p.capability = p_capability
  );
$$;

grant execute on function public.has_capability(uuid, text) to authenticated;
revoke execute on function public.has_capability(uuid, text) from anon, public;

-- As duas funções antigas passam a derivar da matriz. Mantê-las evita
-- reescrever policies que não mudaram de intenção.
create or replace function public.can_write_content(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_capability(p_workspace_id, 'task.create')
      or public.has_capability(p_workspace_id, 'task.edit');
$$;

create or replace function public.can_administer(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_capability(p_workspace_id, 'member.manage');
$$;

-- -----------------------------------------------------------------------------
-- Policies passam a consultar a matriz
-- -----------------------------------------------------------------------------
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.has_capability(workspace_id, 'project.create'));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.has_capability(workspace_id, 'project.edit'))
  with check (public.has_capability(workspace_id, 'project.edit'));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (public.has_capability(workspace_id, 'project.delete'));

drop policy if exists sections_insert on public.sections;
create policy sections_insert on public.sections
  for insert to authenticated
  with check (public.has_capability(workspace_id, 'section.manage'));

drop policy if exists sections_update on public.sections;
create policy sections_update on public.sections
  for update to authenticated
  using (public.has_capability(workspace_id, 'section.manage'))
  with check (public.has_capability(workspace_id, 'section.manage'));

drop policy if exists sections_delete on public.sections;
create policy sections_delete on public.sections
  for delete to authenticated
  using (public.has_capability(workspace_id, 'section.manage'));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.create') and created_by = auth.uid()
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.has_capability(workspace_id, 'task.edit'))
  with check (public.has_capability(workspace_id, 'task.edit'));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.has_capability(workspace_id, 'task.delete'));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'comment.create') and author_id = auth.uid()
  );

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (author_id = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
  );

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.has_capability(id, 'workspace.edit'))
  with check (public.has_capability(id, 'workspace.edit'));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (public.has_capability(id, 'workspace.delete'));

drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (public.has_capability(workspace_id, 'member.manage'));

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (public.has_capability(workspace_id, 'member.manage'))
  with check (public.has_capability(workspace_id, 'member.manage'));

drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (
    public.has_capability(workspace_id, 'member.manage') or user_id = auth.uid()
  );

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    public.has_capability(workspace_id, 'task.edit') and uploaded_by = auth.uid()
  );

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (uploaded_by = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
  );

-- -----------------------------------------------------------------------------
-- RLS da própria matriz
-- -----------------------------------------------------------------------------
alter table public.workspace_permissions enable row level security;

-- Todo membro lê: a interface precisa saber o que esconder de quem.
drop policy if exists workspace_permissions_select on public.workspace_permissions;
create policy workspace_permissions_select on public.workspace_permissions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_permissions_insert on public.workspace_permissions;
create policy workspace_permissions_insert on public.workspace_permissions
  for insert to authenticated
  with check (public.has_capability(workspace_id, 'member.manage'));

drop policy if exists workspace_permissions_delete on public.workspace_permissions;
create policy workspace_permissions_delete on public.workspace_permissions
  for delete to authenticated
  using (public.has_capability(workspace_id, 'member.manage'));

revoke all on public.workspace_permissions from anon;
grant select, insert, delete on public.workspace_permissions to authenticated;
