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
