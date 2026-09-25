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
