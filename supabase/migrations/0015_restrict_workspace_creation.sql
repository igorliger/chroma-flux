-- =============================================================================
-- 0015 — Só proprietários e administradores criam espaços de trabalho
-- =============================================================================
-- Antes, qualquer pessoa logada podia criar um espaço novo — inclusive um
-- funcionário convidado como membro, que viraria dono de um espaço próprio
-- fora do controle do proprietário.
--
-- Agora só cria quem já é proprietário ou administrador em algum espaço.
-- Exceção: quem ainda não participa de espaço nenhum (conta nova, criada
-- por conta própria) pode criar o primeiro — senão ninguém conseguiria
-- começar a usar o sistema.
--
-- É seguro rodar de novo: `create or replace` e `drop policy if exists`.

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
