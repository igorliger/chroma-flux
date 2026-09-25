-- =============================================================================
-- Chroma Flux — schema base
-- =============================================================================
-- Estratégia de isolamento (multi-tenant):
--
--   Toda tabela de conteúdo carrega `workspace_id` de forma explícita. Isso não
--   é apenas desnormalização por performance: as chaves estrangeiras COMPOSTAS
--   abaixo tornam impossível, no nível do banco, que uma linha aponte para um
--   pai de outro workspace. Assim o isolamento não depende só das policies —
--   ele é uma invariante estrutural.
--
--   Exemplo: `sections (project_id, workspace_id)` referencia
--   `projects (id, workspace_id)`. Uma seção do workspace A jamais pode
--   pertencer a um projeto do workspace B, mesmo que alguém burle a aplicação.
--
-- As policies de RLS ficam em 0002_rls.sql.
-- =============================================================================

-- Nenhuma extensão precisa ser instalada: `gen_random_uuid()` é nativa desde o
-- Postgres 13. E-mails são guardados como `text` já normalizado em minúsculas
-- (a aplicação normaliza na entrada), evitando depender de `citext` e do schema
-- em que ele esteja instalado.
--
-- Requisito: Postgres 15 ou superior — usado em `on delete set null (coluna)`
-- aqui e em `security_invoker` na migração 0003. É o padrão no Supabase.

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.workspace_role as enum ('owner', 'admin', 'member', 'viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invitation_status as enum ('pending', 'accepted', 'revoked');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- -----------------------------------------------------------------------------
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

-- Cria o profile automaticamente quando um usuário se cadastra.
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
-- workspaces
-- -----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '',
  color       text not null default 'indigo',
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workspace_members — vínculo usuário <-> workspace + papel
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

-- Quem cria o workspace vira owner automaticamente. Precisa ser SECURITY
-- DEFINER porque, no instante do INSERT, o criador ainda não é membro e a
-- policy de workspace_members o barraria.
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

  -- Seções padrão do quadro Kanban do workspace são criadas por projeto,
  -- não aqui. Ver public.handle_new_project().
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.handle_new_workspace();

-- Impede que o workspace fique sem nenhum owner.
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
  -- Quando o próprio workspace está sendo excluído, o CASCADE remove todos os
  -- membros — inclusive o owner. Nesse caso a linha do workspace já não existe
  -- (o CASCADE roda depois do DELETE do pai) e não há nada a proteger. Sem esta
  -- guarda, excluir um espaço de trabalho falharia sempre.
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
-- projects
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (char_length(trim(name)) between 1 and 120),
  description  text not null default '',
  color        text not null default 'indigo',
  is_archived  boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Alvo da FK composta usada pelas tabelas filhas.
  unique (id, workspace_id)
);

create index if not exists projects_workspace_idx
  on public.projects (workspace_id, is_archived);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- sections — colunas do quadro Kanban
-- -----------------------------------------------------------------------------
create table if not exists public.sections (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id   uuid not null,
  name         text not null check (char_length(trim(name)) between 1 and 60),
  position     double precision not null default 1000,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Amarra a seção ao workspace do projeto: impossível cruzar tenants.
  foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id) on delete cascade,
  -- Alvo da FK composta usada por tasks.
  unique (id, project_id)
);

create index if not exists sections_project_idx
  on public.sections (project_id, position);

drop trigger if exists sections_set_updated_at on public.sections;
create trigger sections_set_updated_at
  before update on public.sections
  for each row execute function public.set_updated_at();

-- Todo projeto nasce com as três colunas padrão.
create or replace function public.handle_new_project()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.sections (workspace_id, project_id, name, position)
  values
    (new.workspace_id, new.id, 'A fazer', 1000),
    (new.workspace_id, new.id, 'Em andamento', 2000),
    (new.workspace_id, new.id, 'Concluído', 3000);
  return new;
end;
$$;

drop trigger if exists on_project_created on public.projects;
create trigger on_project_created
  after insert on public.projects
  for each row execute function public.handle_new_project();

-- -----------------------------------------------------------------------------
-- tasks — tarefas e subtarefas (auto-referência via parent_task_id)
-- -----------------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  project_id     uuid not null,
  section_id     uuid,
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

  -- Tarefa pertence a um projeto do mesmo workspace.
  foreign key (project_id, workspace_id)
    references public.projects (id, workspace_id) on delete cascade,
  -- Seção precisa ser do MESMO projeto.
  -- `set null (section_id)` limita a anulação a essa coluna: sem a lista, o
  -- Postgres anularia também `project_id`, que é NOT NULL, e excluir uma coluna
  -- do quadro falharia. A forma com lista exige Postgres 15+.
  foreign key (section_id, project_id)
    references public.sections (id, project_id) on delete set null (section_id),
  -- Subtarefa precisa ter o mesmo projeto da tarefa-mãe.
  foreign key (parent_task_id, project_id)
    references public.tasks (id, project_id) on delete cascade,
  -- Alvos das FKs compostas usadas por tasks (auto) e comments.
  unique (id, project_id),
  unique (id, workspace_id),
  -- Uma subtarefa não pode ser mãe de outra: só um nível de aninhamento.
  check (parent_task_id is null or parent_task_id <> id)
);

create index if not exists tasks_project_board_idx
  on public.tasks (project_id, section_id, position)
  where parent_task_id is null;
create index if not exists tasks_parent_idx on public.tasks (parent_task_id);
create index if not exists tasks_assignee_idx on public.tasks (workspace_id, assignee_id);
create index if not exists tasks_due_idx on public.tasks (workspace_id, due_date);
create index if not exists tasks_search_idx
  on public.tasks using gin (to_tsvector('portuguese', title || ' ' || description));

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

-- Mantém completed_at coerente e garante profundidade máxima de 1 nível.
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

    -- Subtarefa não ocupa coluna do quadro.
    new.section_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_before_write_trg on public.tasks;
create trigger tasks_before_write_trg
  before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

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
  -- Comentário pertence a uma tarefa do mesmo workspace.
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade
);

create index if not exists comments_task_idx on public.comments (task_id, created_at);

drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- workspace_invitations — convite por e-mail, sem service_role
-- -----------------------------------------------------------------------------
create table if not exists public.workspace_invitations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Sempre em minúsculas: normalizado na aplicação e comparado com
  -- `lower(auth.jwt() ->> 'email')` nas policies.
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
