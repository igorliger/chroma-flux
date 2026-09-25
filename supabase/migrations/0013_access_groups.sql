-- =============================================================================
-- 0013 — Grupos de acesso: janela de uso por grupo de membros
-- =============================================================================
-- Antes, a janela de uso (`user_access_windows`) era uma única regra do
-- proprietário, valendo para toda a equipe de todos os seus espaços. Agora o
-- proprietário pode criar grupos ("Vendas", "Suporte"...), cada um com sua
-- própria janela, e colocar membros dentro deles.
--
-- Quem não está em nenhum grupo continua na janela pessoal do proprietário
-- (`user_access_windows`), exatamente como funcionava antes desta migração —
-- ninguém fica sem cobertura, e nada muda para quem nunca criar um grupo.
--
-- É seguro rodar de novo: tudo usa `if not exists` / `create or replace`.

-- -----------------------------------------------------------------------------
-- Tabela de grupos
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Associação membro → grupo
-- -----------------------------------------------------------------------------
-- Um membro pertence a no máximo um grupo por vez: duas janelas simultâneas
-- para a mesma pessoa seriam ambíguas. `user_id` é `unique` sozinho (não
-- composto com `group_id`) exatamente para impor isso — trocar de grupo é um
-- upsert, não uma segunda linha.
create table if not exists public.access_group_members (
  group_id  uuid not null references public.access_groups (id) on delete cascade,
  user_id   uuid not null unique references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);

create index if not exists access_group_members_user_idx
  on public.access_group_members (user_id);

alter table public.access_groups enable row level security;
alter table public.access_group_members enable row level security;

-- Quem administra vê e edita os próprios grupos; os demais membros do espaço
-- só precisam enxergar os grupos para saber em qual estão (tela de membros).
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

-- Só quem é dono do grupo (via `access_groups`) gerencia quem entra e sai.
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
-- within_access_window ganha o membro sendo checado
-- -----------------------------------------------------------------------------
-- Se o membro estiver num grupo do dono, a janela do grupo manda; senão, cai
-- na janela pessoal do dono (`user_access_windows`) — o comportamento de
-- antes desta migração, preservado como padrão de quem não está agrupado.
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

-- `has_capability` agora informa quem está sendo checado, não só o dono.
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

grant execute on function public.has_capability(uuid, text) to authenticated;

-- Mesmo raciocínio das outras auxiliares SECURITY DEFINER: só `has_capability`
-- precisa chamar `within_access_window`, e ela agora tem uma assinatura nova
-- (dois argumentos) — a antiga (um argumento) fica pra trás nesta migração.
revoke execute on function public.within_access_window(uuid, uuid)
  from public, anon, authenticated;

drop function if exists public.within_access_window(uuid);
