-- =============================================================================
-- 0038 — Quem já tem conta entra na equipe na hora, sem convite por e-mail
-- =============================================================================
-- Até aqui, convidar alguém que ainda não era da equipe sempre criava um
-- convite pendente e mandava e-mail — mesmo que a pessoa já tivesse conta no
-- Chroma Flux. Os espaços só chegavam a ela quando entrasse de novo.
--
-- Agora, se já existe conta com aquele e-mail, a pessoa entra na equipe e
-- nos espaços escolhidos imediatamente (e a função escolhida vale também para
-- quem já estava no espaço com outra). Só quem ainda não tem conta recebe
-- convite por e-mail — sem conta não há como entrar.
--
-- Também resolve os convites pendentes de hoje para quem já tem conta.
-- É seguro rodar de novo.

-- -----------------------------------------------------------------------------
-- Aplica os espaços de um dono a uma pessoa (uso interno)
-- -----------------------------------------------------------------------------
create or replace function public.team_apply_roles(p_owner uuid, p_user uuid, p_roles jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.team_members (owner_id, user_id)
  values (p_owner, p_user)
  on conflict do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  select w.id, p_user, (p_roles ->> w.id::text)::public.workspace_role
  from public.workspaces w
  where w.owner_id = p_owner
    and p_roles ? w.id::text
    and (p_roles ->> w.id::text) in ('admin', 'member', 'viewer')
  on conflict (workspace_id, user_id) do update
    set role = excluded.role
    where public.workspace_members.role <> 'owner';
end;
$$;

revoke execute on function public.team_apply_roles(uuid, uuid, jsonb) from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Adicionar à minha equipe quem já tem conta
-- -----------------------------------------------------------------------------
-- Devolve o id da pessoa, ou null se não há conta com o e-mail (aí quem
-- chama segue para o convite por e-mail). Fecha convites pendentes do mesmo
-- e-mail para não ficarem duplicados na tela.
create or replace function public.add_existing_to_team(p_email text, p_roles jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  alvo uuid;
begin
  if eu is null or not exists (select 1 from public.workspaces w where w.owner_id = eu) then
    raise exception 'Você precisa ser proprietário de um espaço.' using errcode = '42501';
  end if;

  select p.id into alvo
  from public.profiles p
  where lower(p.email) = lower(trim(p_email))
  limit 1;

  if alvo is null then
    return null;
  end if;
  if alvo = eu then
    raise exception 'Você não pode adicionar o seu próprio e-mail.' using errcode = '42501';
  end if;

  perform public.team_apply_roles(eu, alvo, coalesce(p_roles, '{}'::jsonb));

  update public.team_invitations
  set status = 'accepted'
  where owner_id = eu and email = lower(trim(p_email)) and status = 'pending';

  return alvo;
end;
$$;

revoke execute on function public.add_existing_to_team(text, jsonb) from anon, public;
grant execute on function public.add_existing_to_team(text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Convites pendentes de hoje para quem já tem conta: aplica agora
-- -----------------------------------------------------------------------------
do $$
declare
  conv record;
begin
  for conv in
    select c.id, c.owner_id, c.workspace_roles, p.id as user_id
    from public.team_invitations c
    join public.profiles p on lower(p.email) = c.email
    where c.status = 'pending' and p.id <> c.owner_id
  loop
    perform public.team_apply_roles(conv.owner_id, conv.user_id, conv.workspace_roles);
    update public.team_invitations set status = 'accepted' where id = conv.id;
  end loop;
end $$;
