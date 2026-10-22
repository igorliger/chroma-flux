-- =============================================================================
-- 0039 — Conta sem perfil: cria o perfil e aplica os convites pendentes
-- =============================================================================
-- Achado com a Elaine: a conta existia em `auth.users`, mas sem linha em
-- `public.profiles`. Sem perfil, nada consegue colocá-la na equipe nem nos
-- espaços (as tabelas apontam para `profiles`) — `accept_my_team_invitations`
-- falhava calado a cada acesso e o convite ficava pendente para sempre.
--
-- Provável origem: o gatilho `on_auth_user_created` (0001), que cria o perfil
-- no cadastro, não existir no banco auto-hospedado (a migração da nuvem
-- copiou os dados de auth, não os gatilhos de lá).
--
-- Esta migração:
--   1. cria os perfis que faltam, a partir de auth.users;
--   2. recria o gatilho do cadastro (se o banco deixar — senão só avisa);
--   3. faz as funções de equipe criarem o perfil se ainda faltar;
--   4. aplica os convites pendentes de quem já tem conta.
--
-- É seguro rodar de novo.

-- 1. Perfis que faltam -------------------------------------------------------
create or replace function public.ensure_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  select u.id, lower(u.email),
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
  from auth.users u
  where u.id = p_user and u.email is not null
  on conflict (id) do nothing;
end;
$$;

revoke execute on function public.ensure_profile(uuid) from anon, authenticated, public;

insert into public.profiles (id, email, full_name)
select u.id, lower(u.email),
       coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- 2. Gatilho do cadastro -----------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass
  ) then
    begin
      create trigger on_auth_user_created
        after insert on auth.users
        for each row execute function public.handle_new_user();
    exception when insufficient_privilege then
      raise warning 'Sem permissão para criar on_auth_user_created; as funções de equipe criam o perfil quando faltar.';
    end;
  end if;
end $$;

-- 3. Funções de equipe criam o perfil se faltar --------------------------------
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

  perform public.ensure_profile(eu);

  for conv in
    select * from public.team_invitations
    where email = meu_email and status = 'pending' and owner_id <> eu
    for update
  loop
    perform public.team_apply_roles(conv.owner_id, eu, conv.workspace_roles);
    update public.team_invitations set status = 'accepted' where id = conv.id;
    aceitos := aceitos + 1;
  end loop;

  return aceitos;
end;
$$;

grant execute on function public.accept_my_team_invitations() to authenticated;
revoke execute on function public.accept_my_team_invitations() from anon, public;

-- Procura a conta em auth.users (e não em profiles), garantindo o perfil.
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

  select u.id into alvo
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if alvo is null then
    return null;
  end if;
  if alvo = eu then
    raise exception 'Você não pode adicionar o seu próprio e-mail.' using errcode = '42501';
  end if;

  perform public.ensure_profile(alvo);
  perform public.team_apply_roles(eu, alvo, coalesce(p_roles, '{}'::jsonb));

  update public.team_invitations
  set status = 'accepted'
  where owner_id = eu and email = lower(trim(p_email)) and status = 'pending';

  return alvo;
end;
$$;

revoke execute on function public.add_existing_to_team(text, jsonb) from anon, public;
grant execute on function public.add_existing_to_team(text, jsonb) to authenticated;

-- 4. Convites pendentes de quem já tem conta -----------------------------------
do $$
declare
  conv record;
begin
  for conv in
    select c.id, c.owner_id, c.workspace_roles, u.id as user_id
    from public.team_invitations c
    join auth.users u on lower(u.email) = c.email
    where c.status = 'pending' and u.id <> c.owner_id
  loop
    perform public.ensure_profile(conv.user_id);
    perform public.team_apply_roles(conv.owner_id, conv.user_id, conv.workspace_roles);
    update public.team_invitations set status = 'accepted' where id = conv.id;
  end loop;
end $$;
