-- =============================================================================
-- Chroma Flux — SQL COMPLETO PARA O SUPABASE
-- =============================================================================
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em Run.
-- É seguro executar novamente: tudo usa `if not exists` / `create or replace`.
--
-- Contém, nesta ordem:
--    1. Tipos (enums)
--    2. Tabelas, relacionamentos e índices
--    3. Gatilhos (perfil automático, updated_at, coerência, proteções)
--    4. Funções auxiliares de permissão
--    5. Políticas de Row Level Security
--    6. Permissões de execução
--    7. Recorrência de tarefas
--    8. Anexos (bucket privado + políticas de storage)
--    9. Hora do prazo (opcional)
--   10. Permissões configuráveis e janela de acesso
--   11. Responsável pelo espaço e visibilidade das tarefas
--   12. Endurecimento (search_path, revogações)
--   13. Verificação final
--
-- -----------------------------------------------------------------------------
-- COMO O ISOLAMENTO ENTRE ESPAÇOS DE TRABALHO É GARANTIDO
-- -----------------------------------------------------------------------------
-- Duas camadas independentes — as duas precisariam falhar para haver vazamento.
--
-- 1. ESTRUTURAL — chaves estrangeiras COMPOSTAS.
--    Toda tabela de conteúdo carrega `workspace_id`, e as FKs incluem essa
--    coluna:
--        tasks       (workspace_id)                 -> workspaces (id)
--        tasks       (parent_task_id, workspace_id) -> tasks      (id, workspace_id)
--        comments    (task_id,        workspace_id) -> tasks      (id, workspace_id)
--        attachments (task_id,        workspace_id) -> tasks      (id, workspace_id)
--    Uma subtarefa marcada como do espaço A não pode apontar para uma tarefa
--    do espaço B: o banco recusa, mesmo com privilégio total e mesmo que
--    alguém contorne a aplicação.
--
-- 2. ACESSO — RLS com funções SECURITY DEFINER.
--    Cada policy passa por is_workspace_member() / can_write_content() /
--    can_administer(). Essas funções PRECISAM ser SECURITY DEFINER: a policy de
--    `workspace_members` consulta `workspace_members`, e um SELECT direto faria
--    o Postgres reaplicar a policy sobre a subconsulta, entrando em recursão
--    infinita (erro 42P17). Dentro da função a consulta roda como dona da
--    função e ignora RLS — e como ela só responde sobre o auth.uid() da
--    requisição atual, nada vaza. Todas fixam `search_path`, para que um schema
--    malicioso não sequestre os nomes das tabelas.
--
-- -----------------------------------------------------------------------------
-- REQUISITO: Postgres 15 ou superior (padrão no Supabase).
--   Usado em `on delete set null (coluna)` e em `security_invoker` na view.
-- Nenhuma extensão precisa ser instalada: gen_random_uuid() é nativa desde o
-- Postgres 13, e e-mails são `text` normalizado em minúsculas (sem citext).
-- =============================================================================


-- =============================================================================
-- 1. TIPOS
-- =============================================================================
do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
exception when duplicate_object then null; end $$;


-- =============================================================================
-- 2. TABELAS, RELACIONAMENTOS E ÍNDICES
-- =============================================================================

-- Utilitário usado por vários gatilhos de updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles — espelho público de auth.users
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workspaces — o espaço de trabalho é a fronteira de isolamento
-- -----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '',
  color       text not null default 'indigo',
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  -- Quem responde pelo espaço. Não é um papel e não concede permissão: o que
  -- muda é a visibilidade — ver `can_see_workspace_tasks` na seção 11.
  -- A FK composta que amarra esta coluna a workspace_members é adicionada lá,
  -- porque a tabela de membros ainda não existe neste ponto do arquivo.
  responsible_id uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workspace_members — quem participa de qual espaço, e com qual papel
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  role         public.workspace_role not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

-- -----------------------------------------------------------------------------
-- tasks — tarefas e subtarefas (auto-referência via parent_task_id)
--
-- As tarefas pertencem diretamente ao espaço de trabalho e formam uma lista
-- única. O estado é apenas concluída ou em aberto; o que as organiza é
-- responsável, prioridade e prazo.
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  parent_task_id uuid,
  title          text not null check (char_length(trim(title)) between 1 and 300),
  description    text not null default '',
  assignee_id    uuid references public.profiles (id) on delete set null,
  priority       public.task_priority not null default 'medium',
  due_date       date,
  is_completed   boolean not null default false,
  completed_at   timestamptz,
  position       double precision not null default 1000,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A subtarefa precisa estar no mesmo espaço da tarefa-mãe.
  foreign key (parent_task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade,

  -- Alvo das FKs compostas (auto-referência, comments e attachments).
  unique (id, workspace_id),

  check (parent_task_id is null or parent_task_id <> id)
);

create index if not exists tasks_workspace_list_idx
  on public.tasks (workspace_id, is_completed, position)
  where parent_task_id is null;
create index if not exists tasks_parent_idx
  on public.tasks (parent_task_id);
create index if not exists tasks_assignee_idx
  on public.tasks (workspace_id, assignee_id);
create index if not exists tasks_due_idx
  on public.tasks (workspace_id, due_date);
-- Índice de busca textual em português (título + descrição).
create index if not exists tasks_search_idx
  on public.tasks using gin (to_tsvector('portuguese', title || ' ' || description));

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- comments
-- -----------------------------------------------------------------------------
create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id      uuid not null,
  author_id    uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (char_length(trim(body)) between 1 and 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- O comentário pertence a uma tarefa do MESMO espaço de trabalho.
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade
);

create index if not exists comments_task_idx
  on public.comments (task_id, created_at);

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workspace_invitations — convite por e-mail, sem usar a chave service_role
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Sempre em minúsculas, para comparar com lower(auth.jwt() ->> 'email').
  email        text not null check (email = lower(email)),
  role         public.workspace_role not null default 'member',
  status       public.invitation_status not null default 'pending',
  invited_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  check (role <> 'owner')
);

create unique index if not exists workspace_invitations_unique_pending
  on public.workspace_invitations (workspace_id, email)
  where status = 'pending';

create index if not exists workspace_invitations_email_idx
  on public.workspace_invitations (email, status);

-- -----------------------------------------------------------------------------
-- task_overview — view com contadores, usada pelas listas e pelo painel
-- -----------------------------------------------------------------------------
-- `security_invoker = on` faz a view rodar com as permissões de quem consulta.
-- Sem isso, a view seria um furo na RLS: qualquer usuário enxergaria as tarefas
-- de todos os espaços de trabalho através dela.
create or replace view public.task_overview
with (security_invoker = on) as
select
  t.*,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id)::int as subtask_count,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id and s.is_completed)::int as subtask_done_count,
  (select count(*) from public.comments c
    where c.task_id = t.id)::int as comment_count
from public.tasks t;


-- =============================================================================
-- 3. GATILHOS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Cria o perfil automaticamente quando alguém se cadastra.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  -- Em ON CONFLICT, a linha existente é referenciada pelo nome simples da
  -- tabela alvo (`profiles`), nunca qualificado por schema.
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when profiles.full_name = '' then excluded.full_name
          else profiles.full_name
        end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Quem cria o espaço de trabalho vira proprietário.
-- SECURITY DEFINER é necessário: no instante do INSERT o criador ainda não é
-- membro, e a policy de workspace_members o barraria.
-- -----------------------------------------------------------------------------
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
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- -----------------------------------------------------------------------------
-- Impede que o espaço fique sem nenhum proprietário.
-- -----------------------------------------------------------------------------
create or replace function public.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid := coalesce(old.workspace_id, new.workspace_id);
  v_owner_count  int;
begin
  -- Quando o próprio espaço está sendo excluído, o CASCADE remove todos os
  -- membros — inclusive o proprietário. Nesse caso a linha do workspace já não
  -- existe (o CASCADE roda depois do DELETE do pai) e não há nada a proteger.
  -- Sem esta guarda, excluir um espaço de trabalho falharia sempre.
  if not exists (select 1 from public.workspaces where id = v_workspace_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and old.role <> 'owner' then
    return new;
  end if;
  if tg_op = 'DELETE' and old.role <> 'owner' then
    return old;
  end if;

  select count(*) into v_owner_count
  from public.workspace_members
  where workspace_id = v_workspace_id and role = 'owner';

  if v_owner_count <= 1 then
    raise exception 'O workspace precisa de pelo menos um proprietário.'
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists workspace_members_protect_owner on public.workspace_members;
create trigger workspace_members_protect_owner
  before update or delete on public.workspace_members
  for each row execute function public.protect_last_owner();

-- -----------------------------------------------------------------------------
-- Coerência das tarefas: completed_at automático e no máximo um nível de
-- subtarefa.
-- -----------------------------------------------------------------------------
create or replace function public.tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_is_subtask boolean;
begin
  if new.is_completed and (tg_op = 'INSERT' or not old.is_completed) then
    new.completed_at := now();
  elsif not new.is_completed then
    new.completed_at := null;
  end if;

  if new.parent_task_id is not null then
    select (parent_task_id is not null) into v_parent_is_subtask
    from public.tasks where id = new.parent_task_id;

    if coalesce(v_parent_is_subtask, false) then
      raise exception 'Subtarefas não podem ter subtarefas.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_before_write_trg on public.tasks;
create trigger tasks_before_write_trg
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();


-- =============================================================================
-- 4. FUNÇÕES AUXILIARES DE PERMISSÃO
-- =============================================================================
-- Ver a nota sobre SECURITY DEFINER no cabeçalho deste arquivo.

-- O usuário atual é membro deste espaço de trabalho?
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

-- Papel do usuário atual neste espaço (null se não for membro).
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

-- Pode criar e editar conteúdo? (visualizador só lê)
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

-- Pode administrar projetos, membros e configurações?
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

-- O usuário atual compartilha algum espaço com o usuário informado?
-- Usado para exibir nome e avatar de colegas sem expor o diretório inteiro.
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
-- Aceitar convite.
-- SECURITY DEFINER é necessário porque o convidado ainda não é membro e a
-- policy de INSERT em workspace_members o barraria. A checagem crítica é
-- `email = current_user_email()`: só o dono do e-mail convidado consegue
-- aceitar.
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


-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================
-- Habilitada em todas as tabelas. Sem nenhuma policy que se aplique, o padrão
-- do Postgres é NEGAR — tudo que não for explicitamente liberado fica invisível.

alter table public.profiles              enable row level security;
alter table public.workspaces            enable row level security;
alter table public.workspace_members     enable row level security;
alter table public.tasks                 enable row level security;
alter table public.comments              enable row level security;
alter table public.workspace_invitations enable row level security;

-- -----------------------------------------------------------------------------
-- profiles — você mesmo, ou alguém que divide um espaço com você
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

-- Não há policy de INSERT: perfis só nascem pelo gatilho on_auth_user_created,
-- então ninguém consegue forjar um perfil pela API.

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

-- Só proprietários e administradores (em algum espaço) criam espaços novos;
-- quem ainda não participa de nenhum pode criar o primeiro (0015).
create or replace function public.can_create_workspace()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    not exists (
      select 1 from public.workspace_members m where m.user_id = auth.uid()
    )
    or exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    );
$$;

grant execute on function public.can_create_workspace() to authenticated;
revoke execute on function public.can_create_workspace() from anon, public;

drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_create_workspace());

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

-- Administradores removem qualquer um; qualquer membro pode sair sozinho.
-- (O gatilho protect_last_owner impede deixar o espaço sem proprietário.)
drop policy if exists workspace_members_delete on public.workspace_members;
create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (public.can_administer(workspace_id) or user_id = auth.uid());

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
-- comments — o autor edita e apaga o próprio; administradores moderam
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
-- workspace_invitations — administradores gerenciam; o convidado enxerga o
-- próprio convite mesmo sem ser membro ainda (é exatamente esse o ponto).
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


-- =============================================================================
-- 6. PERMISSÕES DE EXECUÇÃO
-- =============================================================================
revoke all on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;

grant execute on function public.is_workspace_member(uuid)   to authenticated;
grant execute on function public.workspace_role_of(uuid)     to authenticated;
grant execute on function public.can_write_content(uuid)     to authenticated;
grant execute on function public.can_administer(uuid)        to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
grant execute on function public.current_user_email()        to authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role[])
  to authenticated;

grant select on public.task_overview to authenticated;

-- O papel `anon` não tem nada a fazer aqui: sem sessão, sem dados.
revoke all on public.task_overview from anon;
revoke all on all tables in schema public from anon;


-- =============================================================================
-- 7. RECORRÊNCIA DE TAREFAS
-- =============================================================================
-- Modelo espelhado no que o Asana oferece:
--
--   Diariamente    a cada N dias
--   Semanalmente   a cada N semanas, nos dias da semana escolhidos
--   Mensalmente    a cada N meses, no mesmo dia do mês
--   Anualmente     a cada N anos, na mesma data
--   Periodicamente a cada N dias/semanas/meses CONTADOS A PARTIR DA CONCLUSÃO
--   Personalizado  a cada N dias/semanas/meses/anos, com dias da semana opcionais
--
-- A diferença de "periodicamente" para os demais é a âncora: os outros contam
-- a partir do prazo anterior (agenda fixa), o periódico conta do dia em que a
-- tarefa foi de fato concluída — "todo dia 5" versus "30 dias depois que eu
-- terminar".

do $$ begin
  create type public.recurrence_type as enum (
    'none', 'daily', 'weekly', 'monthly', 'yearly', 'periodic', 'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recurrence_unit as enum ('day', 'week', 'month', 'year');
exception when duplicate_object then null; end $$;

alter table public.tasks
  add column if not exists recurrence_type public.recurrence_type not null default 'none',
  add column if not exists recurrence_interval int not null default 1,
  add column if not exists recurrence_unit public.recurrence_unit not null default 'week',
  -- 0 = domingo … 6 = sábado, na convenção de `extract(dow)`.
  add column if not exists recurrence_weekdays smallint[] not null default '{}',
  add column if not exists recurrence_ends_on date;

do $$ begin
  alter table public.tasks
    add constraint tasks_recurrence_interval_check
    check (recurrence_interval between 1 and 999);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tasks
    add constraint tasks_recurrence_weekdays_check
    check (
      recurrence_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
      and array_length(recurrence_weekdays, 1) is distinct from 0
    );
exception when duplicate_object then null; end $$;

-- Só tarefas com prazo entram em agenda fixa. O periódico é a exceção: conta
-- a partir da conclusão, então pode começar sem prazo definido.
do $$ begin
  alter table public.tasks
    add constraint tasks_recurrence_needs_due_date
    check (
      recurrence_type in ('none', 'periodic')
      or due_date is not null
    );
exception when duplicate_object then null; end $$;

create index if not exists tasks_recurrence_idx
  on public.tasks (workspace_id, recurrence_type)
  where recurrence_type <> 'none';

-- Cálculo da próxima data --------------------------------------------------
create or replace function public.next_due_date(
  p_type      public.recurrence_type,
  p_interval  int,
  p_unit      public.recurrence_unit,
  p_weekdays  smallint[],
  p_base      date
)
returns date
language plpgsql
immutable
as $$
declare
  v_unit    public.recurrence_unit;
  v_cursor  date;
  v_limite  int;
begin
  if p_type = 'none' or p_base is null then
    return null;
  end if;

  v_unit := case p_type
    when 'daily'   then 'day'
    when 'weekly'  then 'week'
    when 'monthly' then 'month'
    when 'yearly'  then 'year'
    else p_unit
  end::public.recurrence_unit;

  -- Com dias da semana marcados, a próxima data é o próximo dia marcado — e
  -- não um salto cego de N semanas. É o que faz "toda segunda e quinta"
  -- alternar corretamente entre os dois dias.
  if array_length(p_weekdays, 1) > 0 and v_unit = 'week' then
    v_cursor := p_base + 1;
    v_limite := 7 * greatest(p_interval, 1) + 7;

    for i in 1..v_limite loop
      if extract(dow from v_cursor)::smallint = any (p_weekdays) then
        return v_cursor;
      end if;
      v_cursor := v_cursor + 1;
    end loop;
  end if;

  return case v_unit
    when 'day'   then p_base + (p_interval || ' days')::interval
    when 'week'  then p_base + (p_interval || ' weeks')::interval
    when 'month' then p_base + (p_interval || ' months')::interval
    when 'year'  then p_base + (p_interval || ' years')::interval
  end::date;
end;
$$;

-- Ao concluir, gera a próxima ocorrência ------------------------------------
-- Fica no banco, e não na aplicação, porque a conclusão acontece por dois
-- caminhos: a caixinha na lista e o painel da tarefa. Um gatilho cobre os dois
-- de uma vez — e cobriria também qualquer UPDATE feito fora da interface.
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
    else coalesce(new.due_date, current_date)
  end;

  v_proxima := public.next_due_date(
    new.recurrence_type,
    new.recurrence_interval,
    new.recurrence_unit,
    new.recurrence_weekdays,
    v_base
  );

  if v_proxima is null then
    return new;
  end if;

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    return new;
  end if;

  insert into public.tasks (
    workspace_id, parent_task_id,
    title, description, assignee_id, priority, due_date, position, created_by,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id,
    new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.position, new.created_by,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  -- A recorrência migra para a nova ocorrência: a concluída vira histórico.
  -- Este UPDATE dispara o gatilho de novo, mas aí `old.is_completed` já é
  -- verdadeiro e a guarda no topo interrompe — não há recursão.
  update public.tasks set recurrence_type = 'none' where id = new.id;

  return new;
end;
$$;

drop trigger if exists tasks_spawn_next_occurrence_trg on public.tasks;
create trigger tasks_spawn_next_occurrence_trg
  after update on public.tasks
  for each row execute function public.tasks_spawn_next_occurrence();

grant execute on function public.next_due_date(
  public.recurrence_type, int, public.recurrence_unit, smallint[], date
) to authenticated;

-- A view é recriada para enxergar as colunas novas trazidas por `t.*`.
drop view if exists public.task_overview;

create view public.task_overview
with (security_invoker = on) as
select
  t.*,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id)::int as subtask_count,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id and s.is_completed)::int as subtask_done_count,
  (select count(*) from public.comments c
    where c.task_id = t.id)::int as comment_count
from public.tasks t;

grant select on public.task_overview to authenticated;
revoke all on public.task_overview from anon;


-- =============================================================================
-- 8. ANEXOS
-- =============================================================================
-- Arquivos ficam no Supabase Storage, num bucket PRIVADO, no caminho:
--
--     {workspace_id}/{task_id}/{uuid}-{nome-do-arquivo}
--
-- A primeira pasta ser o workspace não é organização: é o que permite às
-- policies do Storage decidirem o acesso. `storage.foldername(name)[1]` extrai
-- esse id e ele passa pelo mesmo `is_workspace_member()` que protege o resto —
-- o isolamento entre espaços vale para arquivos como vale para tarefas.

do $$ begin
  alter table public.comments add constraint comments_id_workspace_key
    unique (id, workspace_id);
exception when duplicate_table or duplicate_object then null; end $$;

create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  task_id       uuid not null,
  -- Nulo quando o anexo pertence à descrição da tarefa (ou da subtarefa).
  comment_id    uuid,
  storage_path  text not null unique,
  file_name     text not null check (char_length(file_name) between 1 and 255),
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),

  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade,
  foreign key (comment_id, workspace_id)
    references public.comments (id, workspace_id) on delete cascade
);

create index if not exists attachments_task_idx
  on public.attachments (task_id, created_at);
create index if not exists attachments_comment_idx
  on public.attachments (comment_id)
  where comment_id is not null;

alter table public.attachments enable row level security;

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (public.can_write_content(workspace_id) and uploaded_by = auth.uid());

-- Anexo não se edita: troca-se por outro. Sem policy de UPDATE.

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (uploaded_by = auth.uid() or public.can_administer(workspace_id))
  );

-- Bucket privado: nada é servido por URL pública. A leitura acontece por URL
-- assinada, gerada sob demanda e de vida curta.
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 26214400)          -- 25 MB
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400;

-- Extrai o workspace do caminho. O `~` valida o formato antes do cast: um
-- caminho fora do padrão daria erro de conversão dentro da policy, e erro em
-- policy é falha de acesso difícil de diagnosticar. Devolvendo null,
-- `is_workspace_member(null)` resulta em false.
create or replace function public.storage_workspace_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
    else null
  end;
$$;

grant execute on function public.storage_workspace_id(text) to authenticated;

drop policy if exists anexos_select on storage.objects;
create policy anexos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'anexos'
    and public.is_workspace_member(public.storage_workspace_id(name))
  );

drop policy if exists anexos_insert on storage.objects;
create policy anexos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'anexos'
    and public.can_write_content(public.storage_workspace_id(name))
  );

drop policy if exists anexos_delete on storage.objects;
create policy anexos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'anexos'
    and public.can_write_content(public.storage_workspace_id(name))
  );

-- Arquivo não se sobrescreve: cada envio gera um caminho novo com uuid. Sem
-- policy de UPDATE, ninguém troca o conteúdo de um anexo já referenciado.


-- =============================================================================
-- 9. HORA DO PRAZO (opcional)
-- =============================================================================
-- A hora vai numa coluna separada, e não convertendo `due_date` em timestamp:
--
--   1. Ela é opcional. Num timestamp, "sem hora" viraria meia-noite, e uma
--      tarefa para hoje pareceria vencida desde o começo do dia.
--   2. `time` sem fuso guarda hora de parede: "entregar às 14:30" significa
--      14:30 para quem lê, em qualquer lugar. `timestamptz` deslocaria conforme
--      o fuso do leitor — certo para um evento de agenda, errado para um prazo.
--
-- A recorrência segue operando só sobre a data; a hora é herdada intacta pela
-- próxima ocorrência, que é o esperado de "toda terça às 9h".

alter table public.tasks
  add column if not exists due_time time;

do $$ begin
  alter table public.tasks
    add constraint tasks_due_time_needs_date
    check (due_time is null or due_date is not null);
exception when duplicate_object then null; end $$;

-- A próxima ocorrência herda a hora.
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
    else coalesce(new.due_date, current_date)
  end;

  v_proxima := public.next_due_date(
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, v_base
  );

  if v_proxima is null then
    return new;
  end if;

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    return new;
  end if;

  insert into public.tasks (
    workspace_id, parent_task_id,
    title, description, assignee_id, priority, due_date, due_time,
    position, created_by,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id,
    new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.due_time,
    new.position, new.created_by,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  update public.tasks set recurrence_type = 'none' where id = new.id;

  return new;
end;
$$;

drop view if exists public.task_overview;

create view public.task_overview
with (security_invoker = on) as
select
  t.*,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id)::int as subtask_count,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id and s.is_completed)::int as subtask_done_count,
  (select count(*) from public.comments c
    where c.task_id = t.id)::int as comment_count
from public.tasks t;

grant select on public.task_overview to authenticated;
revoke all on public.task_overview from anon;


-- =============================================================================
-- 10. PERMISSÕES CONFIGURÁVEIS E JANELA DE ACESSO
-- =============================================================================
-- Até aqui, o que cada papel podia fazer estava fixo no código das policies
-- (can_write_content, can_administer). Esta seção troca isso por uma matriz que
-- o usuário edita na tela de Configurações.
--
-- A matriz é POR PESSOA, não por espaço de trabalho: ela pertence ao
-- proprietário e vale para todos os espaços dele de uma vez. Foi uma decisão
-- deliberada — quem administra vários espaços quase sempre quer a mesma regra
-- em todos, e mantê-las separadas obrigaria a repetir a configuração.

-- -----------------------------------------------------------------------------
-- Matriz papel × capacidade
-- -----------------------------------------------------------------------------
create table if not exists public.user_permissions (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.workspace_role not null,
  capability text not null,
  primary key (user_id, role, capability)
);

alter table public.user_permissions enable row level security;

-- Legível pelo dono e por quem participa de algum espaço dele: a interface
-- precisa saber o que o próprio usuário pode fazer para esconder os botões que
-- o banco recusaria.
drop policy if exists user_permissions_select on public.user_permissions;
create policy user_permissions_select on public.user_permissions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id
      where w.owner_id = user_permissions.user_id and m.user_id = auth.uid()
    )
  );

-- Só o próprio dono edita a própria matriz.
drop policy if exists user_permissions_insert on public.user_permissions;
create policy user_permissions_insert on public.user_permissions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_permissions_delete on public.user_permissions;
create policy user_permissions_delete on public.user_permissions
  for delete to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Janela de uso — dias da semana e horário em que a equipe pode escrever
-- -----------------------------------------------------------------------------
create table if not exists public.user_access_windows (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  enabled    boolean not null default false,
  weekdays   smallint[] not null default '{1,2,3,4,5}',
  starts_at  time not null default '08:00',
  ends_at    time not null default '18:00',
  timezone   text not null default 'America/Sao_Paulo',
  updated_at timestamptz not null default now(),
  constraint weekdays_validos
    check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  -- Início igual ao fim seria uma janela de duração zero — ou de 24h, conforme
  -- a leitura. Ambígua demais para permitir.
  constraint intervalo_nao_vazio check (starts_at <> ends_at)
);

alter table public.user_access_windows enable row level security;

drop policy if exists user_access_windows_select on public.user_access_windows;
create policy user_access_windows_select on public.user_access_windows
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id
      where w.owner_id = user_access_windows.user_id and m.user_id = auth.uid()
    )
  );

drop policy if exists user_access_windows_insert on public.user_access_windows;
create policy user_access_windows_insert on public.user_access_windows
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_access_windows_update on public.user_access_windows;
create policy user_access_windows_update on public.user_access_windows
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Grupos de acesso — janela de uso por grupo de membros (ver 0013)
-- -----------------------------------------------------------------------------
-- Quem não está em nenhum grupo continua na janela pessoal acima
-- (`user_access_windows`) — grupos são um refinamento opcional, não uma
-- substituição.
create table if not exists public.access_groups (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(trim(name)) > 0),
  enabled    boolean not null default false,
  weekdays   smallint[] not null default '{1,2,3,4,5}',
  starts_at  time not null default '08:00',
  ends_at    time not null default '18:00',
  timezone   text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_groups_weekdays_validos
    check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint access_groups_intervalo_nao_vazio check (starts_at <> ends_at)
);

create index if not exists access_groups_owner_idx on public.access_groups (owner_id);

-- Um membro pertence a no máximo um grupo por vez — `user_id` é `unique`
-- sozinho (não composto com `group_id`) para impor isso.
create table if not exists public.access_group_members (
  group_id  uuid not null references public.access_groups (id) on delete cascade,
  user_id   uuid not null unique references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);

create index if not exists access_group_members_user_idx
  on public.access_group_members (user_id);

alter table public.access_groups enable row level security;
alter table public.access_group_members enable row level security;

drop policy if exists access_groups_select on public.access_groups;
create policy access_groups_select on public.access_groups
  for select to authenticated
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.workspaces w
      join public.workspace_members m on m.workspace_id = w.id
      where w.owner_id = access_groups.owner_id and m.user_id = auth.uid()
    )
  );

drop policy if exists access_groups_insert on public.access_groups;
create policy access_groups_insert on public.access_groups
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists access_groups_update on public.access_groups;
create policy access_groups_update on public.access_groups
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists access_groups_delete on public.access_groups;
create policy access_groups_delete on public.access_groups
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists access_group_members_select on public.access_group_members;
create policy access_group_members_select on public.access_group_members
  for select to authenticated
  using (
    exists (
      select 1 from public.access_groups g
      where g.id = access_group_members.group_id
        and (
          g.owner_id = auth.uid()
          or exists (
            select 1 from public.workspaces w
            join public.workspace_members m on m.workspace_id = w.id
            where w.owner_id = g.owner_id and m.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists access_group_members_insert on public.access_group_members;
create policy access_group_members_insert on public.access_group_members
  for insert to authenticated
  with check (
    exists (
      select 1 from public.access_groups g
      where g.id = access_group_members.group_id and g.owner_id = auth.uid()
    )
  );

drop policy if exists access_group_members_delete on public.access_group_members;
create policy access_group_members_delete on public.access_group_members
  for delete to authenticated
  using (
    exists (
      select 1 from public.access_groups g
      where g.id = access_group_members.group_id and g.owner_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.access_groups to authenticated;
grant select, insert, delete on public.access_group_members to authenticated;
revoke all on public.access_groups from anon;
revoke all on public.access_group_members from anon;

-- -----------------------------------------------------------------------------
-- Padrões e funções de consulta
-- -----------------------------------------------------------------------------
-- Estes valores só definem o ponto de partida de cada usuário novo; depois a
-- matriz é dele. Visualizador não aparece: nasce sem nenhuma capacidade.
create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
as $$
  select r::public.workspace_role, c from (
    values
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.delete'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.delete'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','task.create'),     ('member','task.edit'),     ('member','task.delete'),
      ('member','comment.create')
  ) as t(r, c);
$$;

create or replace function public.seed_user_permissions(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.user_permissions (user_id, role, capability)
  select p_user_id, d.role, d.capability from public.default_permissions() d
  on conflict do nothing;
$$;

-- A janela é hora de parede de quem a definiu; o servidor roda em UTC.
--
-- Recebe também o membro sendo checado (`p_member_id`): se ele estiver num
-- grupo de acesso do dono (ver 0013), a janela do grupo manda; senão cai na
-- janela pessoal do dono (`user_access_windows`) — o padrão de quem não está
-- em nenhum grupo.
create or replace function public.within_access_window(p_owner_id uuid, p_member_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  j      record;
  agora  timestamp;
  dia    smallint;
  hora   time;
begin
  select g.enabled, g.weekdays, g.starts_at, g.ends_at, g.timezone
    into j
    from public.access_group_members gm
    join public.access_groups g on g.id = gm.group_id
    where gm.user_id = p_member_id and g.owner_id = p_owner_id;

  if j is null then
    select uaw.enabled, uaw.weekdays, uaw.starts_at, uaw.ends_at, uaw.timezone
      into j
      from public.user_access_windows uaw
      where uaw.user_id = p_owner_id;
  end if;

  -- Sem configuração (nem grupo, nem janela pessoal), ou desligada: sem restrição.
  if j is null or not j.enabled then
    return true;
  end if;

  agora := now() at time zone j.timezone;
  dia   := extract(dow from agora)::smallint;
  hora  := agora::time;

  if not (dia = any (j.weekdays)) then
    return false;
  end if;

  -- Janela que atravessa a meia-noite (ex.: 22:00–06:00) inverte a comparação.
  if j.starts_at < j.ends_at then
    return hora >= j.starts_at and hora < j.ends_at;
  else
    return hora >= j.starts_at or hora < j.ends_at;
  end if;
end;
$$;

-- Substitui can_write_content/can_administer nas policies de conteúdo.
-- SECURITY DEFINER pelo mesmo motivo das outras auxiliares (ver cabeçalho).
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
    join public.workspaces w on w.id = m.workspace_id
    join public.user_permissions p
      on p.user_id = w.owner_id
     and p.role = m.role
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and p.capability = p_capability
      -- O proprietário nunca é barrado pela própria janela: fechar-se para
      -- fora do horário e não conseguir reabrir seria uma armadilha.
      and (m.role = 'owner' or public.within_access_window(w.owner_id, m.user_id))
  );
$$;

-- Todo usuário novo nasce com a matriz padrão.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when profiles.full_name = '' then excluded.full_name
          else profiles.full_name
        end;

  perform public.seed_user_permissions(new.id);
  return new;
end;
$$;

-- Quem já existia antes desta seção também precisa da matriz.
insert into public.user_permissions (user_id, role, capability)
select p.id, d.role, d.capability
from public.profiles p cross join public.default_permissions() d
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Policies de conteúdo, agora guiadas pela matriz
-- -----------------------------------------------------------------------------
-- SELECT continua sendo "é membro do espaço": a janela de acesso limita a
-- escrita, não a leitura.
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

-- O autor sempre pode apagar o próprio comentário; apagar o dos outros exige
-- a capacidade de moderação.
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (author_id = auth.uid() or public.has_capability(workspace_id, 'comment.moderate'))
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

grant select, insert, delete on public.user_permissions to authenticated;
grant select, insert, update on public.user_access_windows to authenticated;
grant execute on function public.has_capability(uuid, text) to authenticated;

-- O `revoke ... on all tables` da seção 6 rodou antes destas duas tabelas
-- existirem, e o Supabase concede privilégios padrão a `anon` em tudo que nasce
-- no schema public. As policies já miram só `authenticated`, mas fechar o
-- privilégio de tabela evita depender só disso.
revoke all on public.user_permissions from anon;
revoke all on public.user_access_windows from anon;


-- =============================================================================
-- 11. RESPONSÁVEL PELO ESPAÇO E VISIBILIDADE DAS TAREFAS
-- =============================================================================
-- Um espaço pode ter uma pessoa designada. Enquanto ninguém estiver designado,
-- ele funciona como antes: compartilhado entre todos os membros. Designar
-- alguém torna o espaço privado dessa pessoa — só ela e quem administra
-- enxergam tarefas, comentários e anexos de lá.
--
-- A designação não é um papel e não concede permissão nenhuma. Quem designa é
-- quem pode editar o espaço (capacidade `workspace.edit`).

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


-- =============================================================================
-- 12. ENDURECIMENTO
-- =============================================================================
-- `search_path` fixo também nas funções que não são SECURITY DEFINER.
-- `storage_workspace_id` é a mais sensível: decide o acesso aos arquivos e
-- chama `storage.foldername()`; com search_path mutável, um schema plantado no
-- caminho poderia sombrear esse nome.
alter function public.storage_workspace_id(text) set search_path = public, storage, pg_temp;
alter function public.current_user_email() set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.next_due_date(
  public.recurrence_type, int, public.recurrence_unit, smallint[], date
) set search_path = public, pg_temp;
alter function public.default_permissions() set search_path = public, pg_temp;

-- Funções de gatilho não devem ser chamáveis por RPC. O Postgres não exige
-- EXECUTE do usuário para disparar um gatilho, então revogar não quebra nada.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_workspace() from public, anon, authenticated;
revoke execute on function public.protect_last_owner() from public, anon, authenticated;
revoke execute on function public.tasks_before_write() from public, anon, authenticated;
revoke execute on function public.tasks_spawn_next_occurrence() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- As auxiliares continuam disponíveis para `authenticated`: as policies as
-- invocam em nome do usuário, e sem EXECUTE a RLS inteira pararia. Para `anon`
-- não há policy que as use — nenhuma mira esse papel —, então revogar fecha a
-- superfície de RPC sem efeito colateral.
revoke execute on function public.is_workspace_member(uuid) from anon, public;
revoke execute on function public.workspace_role_of(uuid) from anon, public;
revoke execute on function public.can_write_content(uuid) from anon, public;
revoke execute on function public.can_administer(uuid) from anon, public;
revoke execute on function public.shares_workspace_with(uuid) from anon, public;
revoke execute on function public.current_user_email() from anon, public;
revoke execute on function public.storage_workspace_id(text) from anon, public;
revoke execute on function public.next_due_date(
  public.recurrence_type, int, public.recurrence_unit, smallint[], date
) from anon, public;
revoke execute on function public.has_workspace_role(uuid, public.workspace_role[])
  from anon, public;
revoke execute on function public.accept_invitation(uuid) from anon, public;
revoke execute on function public.has_capability(uuid, text) from anon, public;
revoke execute on function public.can_see_workspace_tasks(uuid) from anon, public;

-- Estas três são chamadas apenas de dentro de `has_capability`, que é SECURITY
-- DEFINER e roda como dona — quem chama não precisa de EXECUTE nelas. Deixá-las
-- expostas em /rest/v1/rpc teria consequências reais: `seed_user_permissions`
-- reaplicaria a matriz padrão a qualquer usuário, desfazendo permissões que o
-- dono fechou, e `within_access_window` permitiria sondar a agenda de qualquer
-- proprietário.
revoke execute on function public.within_access_window(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.default_permissions()
  from public, anon, authenticated;
revoke execute on function public.seed_user_permissions(uuid)
  from public, anon, authenticated;

-- A assinatura antiga (um argumento só) não existe mais desde a 0013 — cai
-- fora caso alguém rode este arquivo por cima de um banco daquela época.
drop function if exists public.within_access_window(uuid);

-- -----------------------------------------------------------------------------
-- Bloqueio de acesso ao site fora da janela de uso (0014)
-- -----------------------------------------------------------------------------
-- Antes, a janela de uso só bloqueava ações de escrita (criar/editar/concluir
-- tarefa) via `has_capability` — a pessoa continuava conseguindo entrar e ver
-- o site fora do horário, só não conseguia mexer em nada. Esta função também
-- bloqueia a ENTRADA no site fora do horário permitido, para quem está num
-- grupo de acesso com janela ativa (ou na janela pessoal do dono, sem grupo).
--
-- O proprietário nunca é bloqueado — mesma regra de sempre, para não se
-- trancar para fora sem conseguir voltar para desfazer.
--
-- Diferente de `within_access_window`, que recebe o dono e o membro (para
-- checar de dentro de `has_capability`, sobre qualquer pessoa), esta função
-- só responde sobre QUEM ESTÁ CHAMANDO (`auth.uid()`) — é o que o middleware
-- consegue chamar sem já saber a quem essa pessoa pertence.
--
-- SECURITY DEFINER: para ler `access_group_members`/`access_groups`/
-- `user_access_windows` do dono, que a RLS dessas tabelas não abre para
-- qualquer um. `stable` (não `security invoker`) e sem argumentos, então
-- não há superfície para sondar a agenda de outra pessoa.
create or replace function public.is_blocked_by_access_window()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  minha_id uuid := auth.uid();
  sou_dono_de_algo boolean;
begin
  if minha_id is null then
    return false;
  end if;

  -- Proprietário nunca é bloqueado, em nenhum dos espaços dele.
  select exists (
    select 1 from public.workspaces w where w.owner_id = minha_id
  ) into sou_dono_de_algo;

  if sou_dono_de_algo then
    return false;
  end if;

  -- A pessoa pode ser membro de espaços de mais de um dono; basta UM deles
  -- barrar para o acesso ficar bloqueado — não dá para "escolher" o dono mais
  -- permissivo entrando por um espaço específico, já que o bloqueio aqui é
  -- do site inteiro, não de uma ação dentro de um espaço só.
  return exists (
    select 1
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = minha_id
      and not public.within_access_window(w.owner_id, minha_id)
  );
end;
$$;

grant execute on function public.is_blocked_by_access_window() to authenticated;
-- Revoga de `anon` E de `public`: toda função nova ganha EXECUTE para
-- `public` por padrão, e `anon` herda dali — sem o segundo revoke, o
-- primeiro sozinho não tira o acesso de fato.
revoke execute on function public.is_blocked_by_access_window() from anon, public;


-- >>> incorporado de migrations/0016_push_notifications.sql
-- =============================================================================
-- 0016 — Notificações no navegador / sistema operacional (Web Push)
-- =============================================================================
-- O envio em si é feito pela Edge Function `push` (supabase/functions/push).
-- Aqui ficam:
--   * as assinaturas de cada dispositivo (`push_subscriptions`);
--   * o registro do que já foi enviado, para não repetir aviso (`notification_log`);
--   * o gatilho que avisa quando uma tarefa é concluída;
--   * o agendamento (pg_cron) que, a cada 5 minutos, manda os lembretes.
--
-- Segredos (chave privada VAPID e o segredo que autentica o banco perante a
-- função) ficam no Supabase Vault, NUNCA neste arquivo — ele vai para o git.
-- Os nomes esperados no Vault são:
--   push_vapid_public_key, push_vapid_private_key, push_webhook_secret
--
-- É seguro rodar de novo.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Assinaturas (um registro por navegador/dispositivo)
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Cada um só enxerga e apaga os próprios dispositivos. Gravar passa pela
-- função abaixo (o mesmo navegador pode trocar de conta).
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

-- Registra (ou transfere para quem está logado) a assinatura deste navegador.
-- SECURITY DEFINER porque, num computador compartilhado, o mesmo endpoint pode
-- estar registrado em nome de outra conta — e a RLS não deixaria mexer nele.
-- Quem entrou por último é quem passa a receber os avisos neste aparelho.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        created_at = now();
end;
$$;

grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
revoke execute on function public.register_push_subscription(text, text, text, text) from anon, public;

-- -----------------------------------------------------------------------------
-- O que já foi avisado (só a função/serviço lê e grava)
-- -----------------------------------------------------------------------------
create table if not exists public.notification_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.notification_log enable row level security;
-- Sem policies de propósito: ninguém pelo site lê ou grava aqui.

-- -----------------------------------------------------------------------------
-- Janela de uso por usuário (sem depender de auth.uid())
-- -----------------------------------------------------------------------------
-- Mesma regra de `is_blocked_by_access_window()`, mas para qualquer pessoa —
-- usada pelos lembretes, que rodam sem sessão. Não é exposta pela API.
create or replace function public.is_user_blocked_by_access_window(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    not exists (select 1 from public.workspaces w where w.owner_id = p_user_id)
    and exists (
      select 1
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where m.user_id = p_user_id
        and not public.within_access_window(w.owner_id, p_user_id)
    );
$$;

revoke execute on function public.is_user_blocked_by_access_window(uuid)
  from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Configuração lida pela Edge Function (só service_role)
-- -----------------------------------------------------------------------------
create or replace function public.get_push_config()
returns jsonb
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select jsonb_build_object(
    'vapid_public_key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_public_key'),
    'vapid_private_key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_private_key'),
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret')
  );
$$;

revoke execute on function public.get_push_config() from anon, authenticated, public;
grant execute on function public.get_push_config() to service_role;

-- -----------------------------------------------------------------------------
-- Chamada à Edge Function (usada pelo gatilho e pelo agendamento)
-- -----------------------------------------------------------------------------
-- pg_net é assíncrono: a gravação da tarefa não espera o envio nem falha se a
-- função estiver fora do ar.
create or replace function public.call_push_function(p_body jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, vault, pg_temp
as $$
declare
  segredo text;
begin
  select decrypted_secret into segredo
  from vault.decrypted_secrets where name = 'push_webhook_secret';

  if segredo is null then
    return; -- ainda não configurado: não faz nada
  end if;

  perform net.http_post(
    url := 'https://zdkgujlkdtxiabxntuce.supabase.co/functions/v1/push',
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-flux-secret', segredo
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.call_push_function(jsonb) from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Aviso de tarefa concluída
-- -----------------------------------------------------------------------------
-- Só na virada de "aberta" para "concluída", e não para tarefas particulares
-- (não há a quem avisar). Quem concluiu vai junto: é ele quem não recebe.
create or replace function public.tasks_notify_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_completed and not coalesce(old.is_completed, false) and not new.is_personal then
    perform public.call_push_function(jsonb_build_object(
      'type', 'completed',
      'task_id', new.id,
      'completed_by', auth.uid()
    ));
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_notify_completed() from anon, authenticated, public;

drop trigger if exists tasks_notify_completed on public.tasks;
create trigger tasks_notify_completed
  after update of is_completed on public.tasks
  for each row execute function public.tasks_notify_completed();

-- -----------------------------------------------------------------------------
-- Lembretes de tarefas a concluir
-- -----------------------------------------------------------------------------
-- Devolve os lembretes que devem sair AGORA e já os marca como enviados no
-- mesmo comando — se duas execuções se sobrepuserem, cada lembrete sai uma
-- vez só. Horário de Brasília.
--
--   due_soon: tarefa com hora marcada, vencendo nos próximos 15 minutos.
--   digest:   uma vez por dia, a partir das 08:00, resumo de quantas tarefas
--             vencem hoje e quantas estão atrasadas.
--
-- Vai para o responsável (ou para quem criou, se não houver responsável),
-- só para quem tem algum dispositivo com notificação ativada e não está fora
-- da janela de uso — quem está fora recebe o resumo quando a janela abrir.
create or replace function public.claim_push_reminders()
returns table (user_id uuid, kind text, ref text, title text, body text, url text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  agora timestamp := (now() at time zone 'America/Sao_Paulo');
  hoje date := agora::date;
begin
  -- O registro só precisa lembrar o suficiente para não repetir aviso.
  delete from public.notification_log where sent_at < now() - interval '30 days';

  return query
  with alvo as (
    select t.*, coalesce(t.assignee_id, t.created_by) as destinatario
    from public.tasks t
    where not t.is_completed
      and t.due_date is not null
      and t.due_date <= hoje + 1
  ),
  com_dispositivo as (
    select distinct s.user_id from public.push_subscriptions s
  ),
  candidatos as (
    -- Vencendo nos próximos 15 minutos
    select
      a.destinatario as user_id,
      'due_soon'::text as kind,
      a.id::text || ':' || a.due_date::text as ref,
      'Tarefa vencendo às ' || to_char(a.due_date + a.due_time, 'HH24:MI') as title,
      a.title as body,
      case when a.is_personal then '/minhas-tarefas'
           else '/e/' || a.workspace_id::text || '/tarefas' end as url
    from alvo a
    where a.due_time is not null
      and (a.due_date + a.due_time) > agora
      and (a.due_date + a.due_time) <= agora + interval '15 minutes'

    union all

    -- Resumo do dia
    select
      r.destinatario,
      'digest',
      hoje::text,
      'Suas tarefas de hoje',
      case
        when r.hoje_n > 0 and r.atrasadas > 0 then
          'Você tem ' || r.hoje_n || case when r.hoje_n = 1 then ' tarefa' else ' tarefas' end ||
          ' para hoje e ' || r.atrasadas || case when r.atrasadas = 1 then ' atrasada.' else ' atrasadas.' end
        when r.hoje_n > 0 then
          'Você tem ' || r.hoje_n || case when r.hoje_n = 1 then ' tarefa' else ' tarefas' end || ' para hoje.'
        else
          'Você tem ' || r.atrasadas || case when r.atrasadas = 1 then ' tarefa atrasada.' else ' tarefas atrasadas.' end
      end,
      '/minhas-tarefas'
    from (
      select
        a.destinatario,
        count(*) filter (where a.due_date = hoje) as hoje_n,
        count(*) filter (where a.due_date < hoje) as atrasadas
      from alvo a
      group by a.destinatario
    ) r
    where agora::time >= time '08:00'
      and agora::time < time '20:00'
      and (r.hoje_n > 0 or r.atrasadas > 0)
  ),
  filtrados as (
    select c.*
    from candidatos c
    join com_dispositivo d on d.user_id = c.user_id
    where not public.is_user_blocked_by_access_window(c.user_id)
  ),
  marcados as (
    insert into public.notification_log (user_id, kind, ref)
    select f.user_id, f.kind, f.ref from filtrados f
    on conflict do nothing
    returning notification_log.user_id, notification_log.kind, notification_log.ref
  )
  select f.user_id, f.kind, f.ref, f.title, f.body, f.url
  from filtrados f
  join marcados m using (user_id, kind, ref);
end;
$$;

revoke execute on function public.claim_push_reminders() from anon, authenticated, public;
grant execute on function public.claim_push_reminders() to service_role;

-- A cada 5 minutos a função é chamada para enviar os lembretes pendentes.
select cron.unschedule(jobid) from cron.job where jobname = 'push-reminders';
select cron.schedule(
  'push-reminders',
  '*/5 * * * *',
  $$ select public.call_push_function('{"type":"reminders"}'::jsonb) $$
);


-- >>> incorporado de migrations/0017_restrict_task_assignment.sql
-- =============================================================================
-- 0017 — Membros só criam tarefas para si mesmos
-- =============================================================================
-- Nova capacidade na matriz de permissões: `task.assign_others` ("Atribuir
-- tarefas a outras pessoas"). Vem ligada para proprietário e administrador e
-- desligada para membro e visualizador. Sem ela:
--   * ao criar, a tarefa fica com a própria pessoa como responsável (se vier
--     sem responsável, é preenchida com ela; outro nome é recusado);
--   * ao editar, dá para assumir a tarefa, mas não passá-la para outra pessoa
--     nem deixá-la sem responsável.
-- Tarefas particulares e escritas internas (a próxima ocorrência de uma
-- tarefa repetida) não passam por esta regra.
--
-- É seguro rodar de novo.

-- Padrão para matrizes novas.
create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
as $$
  select r::public.workspace_role, c from (
    values
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.complete'),
      ('owner','task.delete'),      ('owner','task.assign_others'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.complete'),
      ('admin','task.delete'),      ('admin','task.assign_others'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','task.create'),     ('member','task.edit'),     ('member','task.complete'),
      ('member','task.delete'),
      ('member','comment.create')
  ) as t(r, c);
$$;

-- Matrizes que já existem: proprietário e administrador continuam podendo
-- atribuir a qualquer um, como antes. Membros passam a só atribuir a si.
insert into public.user_permissions (user_id, role, capability)
select distinct up.user_id, r.role::public.workspace_role, 'task.assign_others'
from public.user_permissions up
cross join (values ('owner'), ('admin')) as r(role)
on conflict do nothing;

create or replace function public.tasks_guard_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
begin
  -- Sem sessão (serviços internos) ou escrita interna: nada a checar.
  if eu is null
     or coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on'
     or new.is_personal then
    return new;
  end if;

  if public.has_capability(new.workspace_id, 'task.assign_others') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assignee_id is null then
      new.assignee_id := eu;
    elsif new.assignee_id <> eu then
      raise exception 'Você só pode criar tarefas para você mesmo.'
        using errcode = '42501';
    end if;
  elsif new.assignee_id is distinct from old.assignee_id
        and new.assignee_id is distinct from eu then
    raise exception 'Você não pode passar tarefas para outra pessoa.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.tasks_guard_assignment() from anon, authenticated, public;

drop trigger if exists tasks_guard_assignment_trg on public.tasks;
create trigger tasks_guard_assignment_trg
  before insert or update of assignee_id on public.tasks
  for each row execute function public.tasks_guard_assignment();


-- >>> incorporado de migrations/0018_co_assignees.sql
-- =============================================================================
-- 0018 — Mais de um responsável por tarefa
-- =============================================================================
-- `assignee_id` continua sendo o responsável principal (é ele que aparece
-- primeiro e que as telas antigas já conhecem). `co_assignee_ids` guarda os
-- demais. Todos eles veem a tarefa em "Minhas tarefas", recebem os lembretes
-- e podem concluí-la.
--
-- É seguro rodar de novo.

alter table public.tasks
  add column if not exists co_assignee_ids uuid[] not null default '{}';

create index if not exists tasks_co_assignee_ids_idx
  on public.tasks using gin (co_assignee_ids);

-- A view ganha a coluna no fim (create or replace só permite acrescentar).
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
  t.co_assignee_ids
from public.tasks t;

-- -----------------------------------------------------------------------------
-- Normaliza a lista: sem repetidos, sem nulos e sem o responsável principal
-- -----------------------------------------------------------------------------
create or replace function public.tasks_normalize_co_assignees()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.co_assignee_ids := coalesce((
    select array_agg(distinct x)
    from unnest(coalesce(new.co_assignee_ids, '{}')) as x
    where x is not null and x is distinct from new.assignee_id
  ), '{}');
  return new;
end;
$$;

drop trigger if exists tasks_normalize_co_assignees_trg on public.tasks;
-- Nome começa com "tasks_a..." para rodar antes da trava de atribuição
-- (os gatilhos BEFORE rodam em ordem alfabética).
drop trigger if exists tasks_a_normalize_co_assignees_trg on public.tasks;
create trigger tasks_a_normalize_co_assignees_trg
  before insert or update of assignee_id, co_assignee_ids on public.tasks
  for each row execute function public.tasks_normalize_co_assignees();

-- -----------------------------------------------------------------------------
-- Trava de atribuição (0017) estendida aos outros responsáveis
-- -----------------------------------------------------------------------------
-- Sem "Atribuir tarefas a outras pessoas", a pessoa só pode incluir ou tirar
-- a si mesma da lista de responsáveis.
create or replace function public.tasks_guard_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  antigos uuid[] := case when tg_op = 'UPDATE' then old.co_assignee_ids else '{}' end;
begin
  if eu is null
     or coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on'
     or new.is_personal then
    return new;
  end if;

  if public.has_capability(new.workspace_id, 'task.assign_others') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assignee_id is null then
      new.assignee_id := eu;
    elsif new.assignee_id <> eu then
      raise exception 'Você só pode criar tarefas para você mesmo.'
        using errcode = '42501';
    end if;
  elsif new.assignee_id is distinct from old.assignee_id
        and new.assignee_id is distinct from eu then
    raise exception 'Você não pode passar tarefas para outra pessoa.'
      using errcode = '42501';
  end if;

  -- Quem entrou ou saiu da lista de outros responsáveis, tirando a si mesmo.
  if exists (
    select 1 from unnest(new.co_assignee_ids) x
    where x <> eu and not (x = any(antigos))
  ) or exists (
    select 1 from unnest(antigos) x
    where x <> eu and not (x = any(new.co_assignee_ids))
      and x is distinct from new.assignee_id
  ) then
    raise exception 'Você só pode incluir ou remover você mesmo como responsável.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.tasks_guard_assignment() from anon, authenticated, public;

drop trigger if exists tasks_guard_assignment_trg on public.tasks;
create trigger tasks_guard_assignment_trg
  before insert or update of assignee_id, co_assignee_ids on public.tasks
  for each row execute function public.tasks_guard_assignment();

-- -----------------------------------------------------------------------------
-- Aviso interno ("Você recebeu uma tarefa") para quem entra na lista
-- -----------------------------------------------------------------------------
create or replace function public.notify_task_co_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications
    (user_id, workspace_id, task_id, actor_id, type, task_title, actor_name)
  select
    x, new.workspace_id, new.id, auth.uid(), 'task_assigned',
    new.title, coalesce(public.display_name(auth.uid()), 'Alguém')
  from unnest(new.co_assignee_ids) as x
  where x is distinct from auth.uid()
    and (tg_op = 'INSERT' or not (x = any(old.co_assignee_ids)))
    -- a próxima ocorrência de uma tarefa repetida não é "atribuição nova"
    and coalesce(current_setting('chroma.escrita_interna', true), 'off') <> 'on';
  return new;
end;
$$;

revoke execute on function public.notify_task_co_assigned() from anon, authenticated, public;

drop trigger if exists tasks_notify_co_assigned_trg on public.tasks;
create trigger tasks_notify_co_assigned_trg
  after insert or update of co_assignee_ids on public.tasks
  for each row execute function public.notify_task_co_assigned();

-- -----------------------------------------------------------------------------
-- A próxima ocorrência de uma tarefa repetida leva os mesmos responsáveis
-- -----------------------------------------------------------------------------
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
    else coalesce(new.due_date, current_date)
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
    title, description, assignee_id, co_assignee_ids, priority, due_date, due_time,
    position, created_by, is_personal,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.parent_task_id,
    new.title, new.description, new.assignee_id, new.co_assignee_ids, new.priority,
    v_proxima, new.due_time,
    new.position, new.created_by, new.is_personal,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  update public.tasks set recurrence_type = 'none' where id = new.id;

  perform set_config('chroma.escrita_interna', 'off', true);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Lembretes (0016) passam a ir para todos os responsáveis
-- -----------------------------------------------------------------------------
create or replace function public.claim_push_reminders()
returns table (user_id uuid, kind text, ref text, title text, body text, url text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  agora timestamp := (now() at time zone 'America/Sao_Paulo');
  hoje date := agora::date;
begin
  -- O registro só precisa lembrar o suficiente para não repetir aviso.
  delete from public.notification_log where sent_at < now() - interval '30 days';

  return query
  with alvo as (
    -- Um lembrete para cada responsável: o principal (ou quem criou, se não
    -- houver) e cada um dos outros responsáveis (0018).
    select t.*, d.destinatario
    from public.tasks t
    cross join lateral (
      select distinct x as destinatario
      from unnest(array[coalesce(t.assignee_id, t.created_by)] || t.co_assignee_ids) as x
      where x is not null
    ) d
    where not t.is_completed
      and t.due_date is not null
      and t.due_date <= hoje + 1
  ),
  com_dispositivo as (
    select distinct s.user_id from public.push_subscriptions s
  ),
  candidatos as (
    -- Vencendo nos próximos 15 minutos
    select
      a.destinatario as user_id,
      'due_soon'::text as kind,
      a.id::text || ':' || a.due_date::text as ref,
      'Tarefa vencendo às ' || to_char(a.due_date + a.due_time, 'HH24:MI') as title,
      a.title as body,
      case when a.is_personal then '/minhas-tarefas'
           else '/e/' || a.workspace_id::text || '/tarefas' end as url
    from alvo a
    where a.due_time is not null
      and (a.due_date + a.due_time) > agora
      and (a.due_date + a.due_time) <= agora + interval '15 minutes'

    union all

    -- Resumo do dia
    select
      r.destinatario,
      'digest',
      hoje::text,
      'Suas tarefas de hoje',
      case
        when r.hoje_n > 0 and r.atrasadas > 0 then
          'Você tem ' || r.hoje_n || case when r.hoje_n = 1 then ' tarefa' else ' tarefas' end ||
          ' para hoje e ' || r.atrasadas || case when r.atrasadas = 1 then ' atrasada.' else ' atrasadas.' end
        when r.hoje_n > 0 then
          'Você tem ' || r.hoje_n || case when r.hoje_n = 1 then ' tarefa' else ' tarefas' end || ' para hoje.'
        else
          'Você tem ' || r.atrasadas || case when r.atrasadas = 1 then ' tarefa atrasada.' else ' tarefas atrasadas.' end
      end,
      '/minhas-tarefas'
    from (
      select
        a.destinatario,
        count(*) filter (where a.due_date = hoje) as hoje_n,
        count(*) filter (where a.due_date < hoje) as atrasadas
      from alvo a
      group by a.destinatario
    ) r
    where agora::time >= time '08:00'
      and agora::time < time '20:00'
      and (r.hoje_n > 0 or r.atrasadas > 0)
  ),
  filtrados as (
    select c.*
    from candidatos c
    join com_dispositivo d on d.user_id = c.user_id
    where not public.is_user_blocked_by_access_window(c.user_id)
  ),
  marcados as (
    insert into public.notification_log (user_id, kind, ref)
    select f.user_id, f.kind, f.ref from filtrados f
    on conflict do nothing
    returning notification_log.user_id, notification_log.kind, notification_log.ref
  )
  select f.user_id, f.kind, f.ref, f.title, f.body, f.url
  from filtrados f
  join marcados m using (user_id, kind, ref);
end;
$$;

revoke execute on function public.claim_push_reminders() from anon, authenticated, public;
grant execute on function public.claim_push_reminders() to service_role;


-- >>> incorporado de migrations/0019_company_people.sql
-- =============================================================================
-- 0019 — Adicionar direto quem já faz parte da empresa
-- =============================================================================
-- Quem já entrou no Chroma Flux por convite em algum espaço de um
-- proprietário não precisa de outro convite para os demais espaços desse
-- mesmo proprietário: quem administra o espaço pode adicioná-lo direto.
--
-- Esta função lista essas pessoas. Precisa ser SECURITY DEFINER porque um
-- administrador pode não participar de todos os espaços do proprietário, e a
-- RLS só mostraria os membros dos espaços em que ele está.
--
-- É seguro rodar de novo.

create or replace function public.list_company_people(p_workspace_id uuid)
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct p.id, p.full_name, p.email
  from public.workspaces alvo
  join public.workspaces outros on outros.owner_id = alvo.owner_id
  join public.workspace_members m on m.workspace_id = outros.id
  join public.profiles p on p.id = m.user_id
  where alvo.id = p_workspace_id
    and public.can_administer(p_workspace_id)
    and not exists (
      select 1 from public.workspace_members ja
      where ja.workspace_id = p_workspace_id and ja.user_id = m.user_id
    )
  order by p.full_name;
$$;

grant execute on function public.list_company_people(uuid) to authenticated;
revoke execute on function public.list_company_people(uuid) from anon, public;


-- >>> incorporado de migrations/0020_team.sql
-- =============================================================================
-- 0020 — Equipe: convite uma vez só, designação por espaço depois
-- =============================================================================
-- Antes, cada espaço tinha o próprio convite por e-mail. Agora o proprietário
-- convida a pessoa para a EQUIPE (uma vez, pela tela "Equipe") e, a partir
-- daí, decide em quais espaços ela entra e com qual função.
--
--   team_members      — quem faz parte da equipe de um proprietário;
--   team_invitations  — convites para a equipe ainda não aceitos, já com os
--                       espaços e a função que a pessoa vai receber.
--
-- Ao entrar no Chroma Flux com o e-mail convidado, a pessoa passa a fazer
-- parte da equipe e já cai nos espaços escolhidos (accept_my_team_invitations).
--
-- É seguro rodar de novo.

-- -----------------------------------------------------------------------------
-- Equipe
-- -----------------------------------------------------------------------------
create table if not exists public.team_members (
  owner_id uuid not null references public.profiles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, user_id),
  check (owner_id <> user_id)
);

alter table public.team_members enable row level security;

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members
  for select to authenticated
  using (owner_id = auth.uid() or user_id = auth.uid());

drop policy if exists team_members_delete on public.team_members;
create policy team_members_delete on public.team_members
  for delete to authenticated
  using (owner_id = auth.uid());

-- Quem entra em qualquer espaço de um proprietário passa a ser da equipe dele
-- — inclusive pelos convites antigos, por espaço, que ainda estiverem abertos.
create or replace function public.workspace_members_join_team()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.team_members (owner_id, user_id)
  select w.owner_id, new.user_id
  from public.workspaces w
  where w.id = new.workspace_id and w.owner_id <> new.user_id
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.workspace_members_join_team() from anon, authenticated, public;

drop trigger if exists workspace_members_join_team_trg on public.workspace_members;
create trigger workspace_members_join_team_trg
  after insert on public.workspace_members
  for each row execute function public.workspace_members_join_team();

-- Quem já está em algum espaço hoje entra na equipe do dono desse espaço.
insert into public.team_members (owner_id, user_id)
select distinct w.owner_id, m.user_id
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id
where m.user_id <> w.owner_id
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Convites para a equipe
-- -----------------------------------------------------------------------------
create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  email text not null check (email = lower(email)),
  -- Espaços e função já escolhidos: aplicados quando a pessoa entrar.
  workspace_roles jsonb not null default '{}'::jsonb,
  invited_by uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now()
);

create unique index if not exists team_invitations_pendente_unico
  on public.team_invitations (owner_id, email) where status = 'pending';

alter table public.team_invitations enable row level security;

drop policy if exists team_invitations_owner on public.team_invitations;
create policy team_invitations_owner on public.team_invitations
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and invited_by = auth.uid());

drop policy if exists team_invitations_invitee on public.team_invitations;
create policy team_invitations_invitee on public.team_invitations
  for select to authenticated
  using (email = public.current_user_email());

-- -----------------------------------------------------------------------------
-- Aceitar (automático ao entrar com o e-mail convidado)
-- -----------------------------------------------------------------------------
create or replace function public.accept_my_team_invitations()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  meu_email text := public.current_user_email();
  conv record;
  aceitos integer := 0;
begin
  if eu is null or meu_email is null then
    return 0;
  end if;

  for conv in
    select * from public.team_invitations
    where email = meu_email and status = 'pending' and owner_id <> eu
    for update
  loop
    insert into public.team_members (owner_id, user_id)
    values (conv.owner_id, eu)
    on conflict do nothing;

    -- Só espaços que continuam sendo desse proprietário.
    insert into public.workspace_members (workspace_id, user_id, role)
    select w.id, eu, (conv.workspace_roles ->> w.id::text)::public.workspace_role
    from public.workspaces w
    where w.owner_id = conv.owner_id
      and conv.workspace_roles ? w.id::text
      and (conv.workspace_roles ->> w.id::text) in ('admin', 'member', 'viewer')
    on conflict (workspace_id, user_id) do nothing;

    update public.team_invitations set status = 'accepted' where id = conv.id;
    aceitos := aceitos + 1;
  end loop;

  return aceitos;
end;
$$;

grant execute on function public.accept_my_team_invitations() to authenticated;
revoke execute on function public.accept_my_team_invitations() from anon, public;

-- -----------------------------------------------------------------------------
-- Tirar alguém da equipe (sai de todos os espaços do proprietário)
-- -----------------------------------------------------------------------------
create or replace function public.remove_team_member(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or p_user_id = auth.uid() then
    raise exception 'Operação não permitida.' using errcode = '42501';
  end if;

  delete from public.workspace_members m
  using public.workspaces w
  where w.id = m.workspace_id and w.owner_id = auth.uid() and m.user_id = p_user_id;

  delete from public.team_members where owner_id = auth.uid() and user_id = p_user_id;
end;
$$;

grant execute on function public.remove_team_member(uuid) to authenticated;
revoke execute on function public.remove_team_member(uuid) from anon, public;

-- -----------------------------------------------------------------------------
-- "Adicionar da equipe" (0019) passa a usar a tabela de equipe
-- -----------------------------------------------------------------------------
create or replace function public.list_company_people(p_workspace_id uuid)
returns table (id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email
  from public.workspaces alvo
  join public.team_members t on t.owner_id = alvo.owner_id
  join public.profiles p on p.id = t.user_id
  where alvo.id = p_workspace_id
    and public.can_administer(p_workspace_id)
    and not exists (
      select 1 from public.workspace_members ja
      where ja.workspace_id = p_workspace_id and ja.user_id = t.user_id
    )
  order by p.full_name;
$$;

-- >>> incorporado de migrations/0021_invite_quick_login.sql
-- =============================================================================
-- 0021 — Página do convite com entrada rápida
-- =============================================================================
-- O botão do e-mail de convite leva a /convite/<id>. Essa página precisa
-- mostrar, para quem ainda não entrou, quem convidou e para quais espaços —
-- por isso a prévia abaixo é liberada até para visitantes não logados. Só
-- quem tem o link (o id é aleatório e só vai no e-mail) consegue consultar.
--
-- A entrada em si (sem senha) é feita pela Edge Function `invite-login`, que
-- tem a chave de serviço para gerar o acesso — o site não tem.
--
-- Também converte os convites antigos, feitos por espaço, em convites de
-- equipe: a partir daqui só existe um jeito de convidar.
--
-- É seguro rodar de novo.

create or replace function public.team_invite_preview(p_id uuid)
returns table (email text, inviter_name text, workspace_names text[], valid boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    i.email,
    coalesce(nullif(p.full_name, ''), p.email, 'Alguém'),
    coalesce((
      select array_agg(w.name order by w.name)
      from public.workspaces w
      where w.owner_id = i.owner_id and i.workspace_roles ? w.id::text
    ), '{}'),
    i.status = 'pending' and i.created_at > now() - interval '30 days'
  from public.team_invitations i
  left join public.profiles p on p.id = i.owner_id
  where i.id = p_id;
$$;

grant execute on function public.team_invite_preview(uuid) to anon, authenticated;
revoke execute on function public.team_invite_preview(uuid) from public;

-- Convites antigos (por espaço) ainda pendentes viram um convite de equipe
-- por pessoa, já com os espaços e funções que tinham.
insert into public.team_invitations (owner_id, email, workspace_roles, invited_by)
select
  w.owner_id,
  lower(wi.email),
  jsonb_object_agg(w.id::text, wi.role::text),
  w.owner_id
from public.workspace_invitations wi
join public.workspaces w on w.id = wi.workspace_id
where wi.status = 'pending'
  and not exists (
    select 1 from public.team_invitations t
    where t.owner_id = w.owner_id and t.email = lower(wi.email) and t.status = 'pending'
  )
group by w.owner_id, lower(wi.email);

update public.workspace_invitations set status = 'revoked' where status = 'pending';

-- -----------------------------------------------------------------------------
-- Criar espaço: fecha a brecha de quem é da equipe mas ainda sem espaço
-- -----------------------------------------------------------------------------
-- Antes, quem não participava de nenhum espaço podia criar o primeiro — e um
-- convidado que entrasse sem espaço designado caía nessa regra. Agora quem
-- faz parte da equipe de alguém (ou tem convite de equipe pendente) só cria
-- espaço se for proprietário ou administrador em algum. Contas novas, que
-- não vieram de convite, continuam podendo criar o primeiro espaço.
create or replace function public.can_create_workspace()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and m.role in ('owner', 'admin')
    )
    or (
      not exists (select 1 from public.workspace_members m where m.user_id = auth.uid())
      and not exists (select 1 from public.team_members t where t.user_id = auth.uid())
      and not exists (
        select 1 from public.team_invitations i
        where i.email = public.current_user_email() and i.status = 'pending'
      )
    );
$$;

-- >>> incorporado de migrations/0022_profiles_team_visibility.sql
-- =============================================================================
-- 0022 — Perfis visíveis dentro da equipe
-- =============================================================================
-- Antes, só dava para ver o perfil (nome, e-mail) de quem dividisse algum
-- espaço com você. Quem acabou de entrar na equipe, ainda sem espaço
-- designado, ficava invisível para o proprietário — justamente na hora de
-- escolher os espaços dessa pessoa em Configurações.
--
-- Agora o proprietário vê os perfis da sua equipe, e cada pessoa da equipe
-- vê o perfil do proprietário.
--
-- É seguro rodar de novo.

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.shares_workspace_with(id)
    or exists (
      select 1 from public.team_members t
      where (t.owner_id = auth.uid() and t.user_id = profiles.id)
         or (t.user_id = auth.uid() and t.owner_id = profiles.id)
    )
  );

-- >>> incorporado de migrations/0023_responsible_sees_task.sql
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

-- >>> incorporado de migrations/0024_complete_moves_board.sql
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

-- =============================================================================
-- 13. VERIFICAÇÃO
-- =============================================================================
-- Confirma que a RLS está ativa em todas as tabelas e mostra quantas policies
-- cada uma tem. Esperado: 12 linhas, todas com rls_ativa = true.
select
  c.relname                as tabela,
  c.relrowsecurity         as rls_ativa,
  count(p.polname)::int    as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles', 'workspaces', 'workspace_members',
    'tasks', 'comments', 'workspace_invitations', 'attachments',
    'user_permissions', 'user_access_windows',
    'access_groups', 'access_group_members'
  )
group by c.relname, c.relrowsecurity
order by c.relname;

-- E que o bucket de anexos existe e está privado.
select id, public as publico, file_size_limit as limite_bytes
from storage.buckets
where id = 'anexos';
