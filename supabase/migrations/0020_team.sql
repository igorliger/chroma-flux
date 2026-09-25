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
