-- =============================================================================
-- 0014 — Bloqueia o acesso ao site (não só a escrita) fora da janela de uso
-- =============================================================================
-- Antes, a janela de uso só bloqueava ações de escrita (criar/editar/concluir
-- tarefa) via `has_capability` — a pessoa continuava conseguindo entrar e ver
-- o site fora do horário, só não conseguia mexer em nada. Agora, quem está
-- num grupo de acesso com janela ativa (ou na janela pessoal do dono, sem
-- grupo) também não consegue ENTRAR no site fora do horário permitido.
--
-- O proprietário nunca é bloqueado — mesma regra de sempre, para não se
-- trancar para fora sem conseguir voltar para desfazer.
--
-- É seguro rodar de novo: `create or replace`.

-- Diferente de `within_access_window`, que recebe o dono e o membro (para
-- checar de dentro de `has_capability`, sobre qualquer pessoa), esta função
-- só responde sobre QUEM ESTÁ CHAMANDO (`auth.uid()`) — é o que o middleware
-- consegue chamar sem já saber a quem essa pessoa pertence.
--
-- SECURITY DEFINER: para ler `access_group_members`/`access_groups`/
-- `user_access_windows` do dono, que a RLS dessas tabelas não abre para
-- qualquer um. `stable` (não `security invoker`) e sem argumentos, então
-- não há superfície para sondar a agenda de outra pessoa.
create or replace function public.is_blocked_by_access_window()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  minha_id uuid := auth.uid();
  sou_dono_de_algo boolean;
begin
  if minha_id is null then
    return false;
  end if;

  -- Proprietário nunca é bloqueado, em nenhum dos espaços dele.
  select exists (
    select 1 from public.workspaces w where w.owner_id = minha_id
  ) into sou_dono_de_algo;

  if sou_dono_de_algo then
    return false;
  end if;

  -- A pessoa pode ser membro de espaços de mais de um dono; basta UM deles
  -- barrar para o acesso ficar bloqueado — não dá para "escolher" o dono mais
  -- permissivo entrando por um espaço específico, já que o bloqueio aqui é
  -- do site inteiro, não de uma ação dentro de um espaço só.
  return exists (
    select 1
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = minha_id
      and not public.within_access_window(w.owner_id, minha_id)
  );
end;
$$;

grant execute on function public.is_blocked_by_access_window() to authenticated;
-- Revoga de `anon` E de `public`: toda função nova ganha EXECUTE para
-- `public` por padrão, e `anon` herda dali — sem o segundo revoke, o
-- primeiro sozinho não tira o acesso de fato.
revoke execute on function public.is_blocked_by_access_window() from anon, public;
