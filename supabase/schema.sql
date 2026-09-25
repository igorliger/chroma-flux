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
create or replace function public.within_access_window(p_owner_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  j      public.user_access_windows;
  agora  timestamp;
  dia    smallint;
  hora   time;
begin
  select * into j from public.user_access_windows where user_id = p_owner_id;

  -- Sem configuração, ou desligada: sem restrição.
  if j.user_id is null or not j.enabled then
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
      and (m.role = 'owner' or public.within_access_window(w.owner_id))
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
revoke execute on function public.within_access_window(uuid)
  from public, anon, authenticated;
revoke execute on function public.default_permissions()
  from public, anon, authenticated;
revoke execute on function public.seed_user_permissions(uuid)
  from public, anon, authenticated;


-- =============================================================================
-- 13. VERIFICAÇÃO
-- =============================================================================
-- Confirma que a RLS está ativa em todas as tabelas e mostra quantas policies
-- cada uma tem. Esperado: 10 linhas, todas com rls_ativa = true.
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
    'user_permissions', 'user_access_windows'
  )
group by c.relname, c.relrowsecurity
order by c.relname;

-- E que o bucket de anexos existe e está privado.
select id, public as publico, file_size_limit as limite_bytes
from storage.buckets
where id = 'anexos';
