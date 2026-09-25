-- =============================================================================
-- Chroma Flux — Row Level Security
-- =============================================================================
-- Regra central: nenhuma linha de nenhuma tabela é visível para quem não é
-- membro do workspace dono daquela linha.
--
-- Por que funções SECURITY DEFINER?
--   A policy de `workspace_members` precisa consultar `workspace_members` para
--   saber se você é membro. Se a policy fizesse esse SELECT diretamente, o
--   Postgres reaplicaria a policy sobre a subconsulta e entraria em recursão
--   infinita (erro 42P17). Encapsular a checagem numa função SECURITY DEFINER
--   faz a consulta rodar como dona da função, ignorando RLS ali dentro — e a
--   função só responde sobre o `auth.uid()` da requisição atual, então não
--   vaza nada.
--
--   `set search_path` é obrigatório em SECURITY DEFINER: sem isso, um schema
--   malicioso no search_path do chamador poderia sequestrar os nomes das
--   tabelas dentro da função.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funções auxiliares
-- -----------------------------------------------------------------------------

-- O usuário atual é membro deste workspace?
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
  );
$$;

-- Papel do usuário atual neste workspace (null se não for membro).
create or replace function public.workspace_role_of(p_workspace_id uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = p_workspace_id
    and m.user_id = auth.uid();
$$;

-- O usuário atual tem algum dos papéis informados?
create or replace function public.has_workspace_role(
  p_workspace_id uuid,
  p_roles public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.workspace_role_of(p_workspace_id) = any (p_roles);
$$;

-- Pode escrever conteúdo (tarefas, comentários)? `viewer` só lê.
create or replace function public.can_write_content(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin', 'member']::public.workspace_role[]
  );
$$;

-- Pode administrar (projetos, membros, configurações)?
create or replace function public.can_administer(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_workspace_role(
    p_workspace_id,
    array['owner', 'admin']::public.workspace_role[]
  );
$$;

-- O usuário atual compartilha algum workspace com o usuário informado?
-- Usado para exibir nome/avatar de colegas sem expor o diretório inteiro.
create or replace function public.shares_workspace_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members mine
    join public.workspace_members theirs
      on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  );
$$;

-- E-mail do usuário autenticado, extraído do JWT, sempre em minúsculas.
create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(nullif(auth.jwt() ->> 'email', ''));
$$;

-- -----------------------------------------------------------------------------
-- Aceitar convite — precisa de SECURITY DEFINER porque o convidado ainda não
-- é membro e a policy de INSERT em workspace_members o barraria.
-- A checagem crítica é `email = current_user_email()`: só o dono do e-mail
-- convidado consegue aceitar.
-- -----------------------------------------------------------------------------
create or replace function public.accept_invitation(p_invitation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   public.workspace_invitations;
  v_email text := public.current_user_email();
begin
  if auth.uid() is null or v_email is null then
    raise exception 'Não autenticado.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv
  from public.workspace_invitations
  where id = p_invitation_id
  for update;

  if v_inv.id is null then
    raise exception 'Convite não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_inv.email <> v_email then
    raise exception 'Este convite é para outro e-mail.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'Este convite já foi utilizado.' using errcode = 'check_violation';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Este convite expirou.' using errcode = 'check_violation';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, auth.uid(), v_inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set status = 'accepted'
  where id = v_inv.id;

  return v_inv.workspace_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas. Sem nenhuma policy que se aplique, o
-- padrão do Postgres é negar — ou seja, tudo que não for explicitamente
-- liberado abaixo fica invisível.
-- -----------------------------------------------------------------------------
alter table public.profiles              enable row level security;
alter table public.workspaces            enable row level security;
alter table public.workspace_members     enable row level security;
alter table public.projects              enable row level security;
alter table public.sections              enable row level security;
alter table public.tasks                 enable row level security;
alter table public.comments              enable row level security;
alter table public.workspace_invitations enable row level security;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_workspace_with(id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- INSERT fica a cargo do trigger on_auth_user_created; nenhuma policy de
-- INSERT significa que ninguém pode forjar profiles pela API.

-- -----------------------------------------------------------------------------
-- workspaces
-- -----------------------------------------------------------------------------
-- O `owner_id = auth.uid()` não é redundante com a checagem de membro.
-- Num `INSERT ... RETURNING`, o Postgres aplica a policy de SELECT à linha
-- devolvida — e nesse instante o gatilho AFTER INSERT que cria o vínculo em
-- workspace_members ainda não rodou. Sem esta primeira condição, criar um
-- espaço de trabalho falha com "new row violates row-level security policy".
-- Não afrouxa o isolamento: só reconhece o dono do próprio espaço.
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (owner_id = auth.uid() or public.is_workspace_member(id));

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.can_administer(id))
  with check (public.can_administer(id));

drop policy if exists workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (public.has_workspace_role(id, array['owner']::public.workspace_role[]));

-- -----------------------------------------------------------------------------
-- workspace_members
-- -----------------------------------------------------------------------------
drop policy if exists workspace_members_select on public.workspace_members;
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members
  for insert to authenticated
  with check (public.can_administer(workspace_id));

drop policy if exists workspace_members_update on public.workspace_members;
create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (public.can_administer(workspace_id))
  with check (public.can_administer(workspace_id));

-- Admins removem qualquer um; qualquer membro pode sair sozinho.
-- (O trigger protect_last_owner impede deixar o workspace sem proprietário.)
drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (public.can_administer(workspace_id) or user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated
  with check (public.can_administer(workspace_id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.can_administer(workspace_id))
  with check (public.can_administer(workspace_id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated
  using (public.can_administer(workspace_id));

-- -----------------------------------------------------------------------------
-- sections
-- -----------------------------------------------------------------------------
drop policy if exists sections_select on public.sections;
create policy sections_select on public.sections
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists sections_insert on public.sections;
create policy sections_insert on public.sections
  for insert to authenticated
  with check (public.can_write_content(workspace_id));

drop policy if exists sections_update on public.sections;
create policy sections_update on public.sections
  for update to authenticated
  using (public.can_write_content(workspace_id))
  with check (public.can_write_content(workspace_id));

drop policy if exists sections_delete on public.sections;
create policy sections_delete on public.sections
  for delete to authenticated
  using (public.can_administer(workspace_id));

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.can_write_content(workspace_id) and created_by = auth.uid());

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update to authenticated
  using (public.can_write_content(workspace_id))
  with check (public.can_write_content(workspace_id));

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete to authenticated
  using (public.can_write_content(workspace_id));

-- -----------------------------------------------------------------------------
-- comments — autor edita/apaga o próprio; admin modera.
-- -----------------------------------------------------------------------------
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments
  for insert to authenticated
  with check (public.can_write_content(workspace_id) and author_id = auth.uid());

drop policy if exists comments_update on public.comments;
create policy comments_update on public.comments
  for update to authenticated
  using (author_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (author_id = auth.uid());

drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (author_id = auth.uid() or public.can_administer(workspace_id))
  );

-- -----------------------------------------------------------------------------
-- workspace_invitations — admins gerenciam; o convidado enxerga o próprio
-- convite mesmo sem ser membro ainda (é exatamente esse o ponto).
-- -----------------------------------------------------------------------------
drop policy if exists invitations_select on public.workspace_invitations;
create policy invitations_select on public.workspace_invitations
  for select to authenticated
  using (
    public.can_administer(workspace_id)
    or email = public.current_user_email()
  );

drop policy if exists invitations_insert on public.workspace_invitations;
create policy invitations_insert on public.workspace_invitations
  for insert to authenticated
  with check (public.can_administer(workspace_id) and invited_by = auth.uid());

drop policy if exists invitations_update on public.workspace_invitations;
create policy invitations_update on public.workspace_invitations
  for update to authenticated
  using (public.can_administer(workspace_id))
  with check (public.can_administer(workspace_id));

drop policy if exists invitations_delete on public.workspace_invitations;
create policy invitations_delete on public.workspace_invitations
  for delete to authenticated
  using (public.can_administer(workspace_id));

-- -----------------------------------------------------------------------------
-- Permissões de execução
-- -----------------------------------------------------------------------------
revoke all on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

grant execute on function public.is_workspace_member(uuid)    to authenticated;
grant execute on function public.workspace_role_of(uuid)      to authenticated;
grant execute on function public.can_write_content(uuid)      to authenticated;
grant execute on function public.can_administer(uuid)         to authenticated;
grant execute on function public.shares_workspace_with(uuid)  to authenticated;
grant execute on function public.current_user_email()         to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[])
  to authenticated;

-- O papel `anon` não tem nada a fazer aqui: sem sessão, sem dados.
revoke all on all tables in schema public from anon;
