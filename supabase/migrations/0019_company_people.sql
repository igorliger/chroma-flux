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
