import "server-only";

import { notFound, redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import {
  fromPlain,
  matrixFromRows,
  toPlain,
  type Capability,
  type PlainMatrix,
} from "@/lib/permissions";
import type {
  CustomFieldDefinition,
  CustomFieldValue,
  Invitation,
  MemberWithProfile,
  PersonRef,
  Profile,
  TaskDependency,
  TaskOverview,
  Workspace,
  WorkspaceRole,
} from "@/lib/database.types";

export type { TaskOverview };

/**
 * Todas as consultas deste arquivo rodam com o JWT do usuário, ou seja, sob
 * RLS. Os filtros por `workspace_id` existem para clareza e uso de índice — a
 * garantia de isolamento vem do banco, não deles.
 *
 * Nota de projeto: em vez de aninhar perfis em cada consulta (`embed` do
 * PostgREST), carregamos os membros do espaço uma vez por página e resolvemos
 * responsável/autor por um mapa em memória. São poucos registros, o resultado
 * é mais previsível e evita depender da inferência de relacionamentos.
 */

export type WorkspaceContext = {
  user: { id: string; email: string };
  workspace: Workspace;
  role: WorkspaceRole;
  profile: Profile;
};

/**
 * Usuário autenticado, ou redirecionamento.
 *
 * A checagem de configuração vem primeiro porque, sem credenciais,
 * `createClient()` lança — e como no App Router o layout e a página renderizam
 * em paralelo, um guard só no layout não impede a página de estourar. Redirecionar
 * para `/`, que mostra as instruções de configuração, resolve num lugar só.
 */
export async function requireUser() {
  if (!isSupabaseConfigured()) redirect("/");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  return user;
}

/**
 * Carrega o espaço de trabalho e o papel do usuário nele.
 *
 * Se a RLS esconder o workspace (usuário não é membro), a consulta volta
 * vazia e respondemos 404 — sem confirmar sequer se o id existe.
 */
export async function getWorkspaceContext(workspaceId: string): Promise<WorkspaceContext> {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: workspace }, { data: membership }, { data: profile }] = await Promise.all([
    supabase.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  ]);

  if (!workspace || !membership || !profile) notFound();

  return {
    user: { id: user.id, email: user.email ?? profile.email },
    workspace,
    role: membership.role,
    profile,
  };
}

/** Perfil do usuário atual, para as telas fora de um espaço de trabalho. */
export async function getMyProfile(): Promise<Profile | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await tolerandoRelogio(() =>
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
  );

  return (data as Profile) ?? null;
}

/**
 * Insiste enquanto o Postgres recusa o token por diferença de relógio.
 *
 * O código `PGRST303` ("JWT issued at future") aparece quando o carimbo de
 * emissão do token está à frente do relógio que o valida. Medindo os dois
 * lados, o banco deste projeto corre alguns segundos atrasado em relação ao
 * serviço que emite os tokens — então um token recém-criado é literalmente do
 * futuro para ele, e continua sendo por vários segundos.
 *
 * Isso atinge só a primeira requisição depois do login, que é o pior momento
 * possível: a primeira tela de quem acabou de entrar.
 *
 * As esperas crescem em vez de serem fixas porque o desvio varia. A maioria
 * dos casos resolve na primeira ou segunda tentativa; a escada existe para o
 * dia em que o atraso for maior, sem impor essa espera a todo mundo. Qualquer
 * outro erro sai na primeira tentativa, sem máscara.
 */
const ESPERAS_RELOGIO_MS = [400, 900, 1800, 3000];

// `PromiseLike` e não `Promise`: o construtor de consulta do Supabase é um
// "thenable", não uma promessa de verdade, e exigir `Promise` faria a inferência
// desistir do tipo real e perder o `data`.
async function tolerandoRelogio<T extends { error: { code?: string } | null }>(
  executar: () => PromiseLike<T>,
): Promise<T> {
  let resposta = await executar();

  for (const espera of ESPERAS_RELOGIO_MS) {
    if (resposta.error?.code !== "PGRST303") return resposta;
    await new Promise((resolve) => setTimeout(resolve, espera));
    resposta = await executar();
  }

  return resposta;
}

// ---------------------------------------------------------------------------
// Espaços de trabalho
// ---------------------------------------------------------------------------
export type WorkspaceSummary = Workspace & {
  role: WorkspaceRole;
  task_count: number;
  member_count: number;
};

export async function listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
  const supabase = await createClient();

  const [
    { data: workspaces, error: erroEspacos },
    { data: memberships, error: erroMembros },
    { data: tasks, error: erroTarefas },
  ] = await Promise.all([
    tolerandoRelogio(() =>
      supabase.from("workspaces").select("*").order("created_at", { ascending: true }),
    ),
    tolerandoRelogio(() =>
      supabase.from("workspace_members").select("workspace_id, user_id, role"),
    ),
    // Contagem de tarefas de nível superior, para o cartão do espaço.
    tolerandoRelogio(() =>
      supabase.from("tasks").select("id, workspace_id").is("parent_task_id", null),
    ),
  ]);

  /*
    Falhar alto em vez de devolver lista vazia.

    Antes o erro era descartado e o `?? []` mais abaixo transformava qualquer
    problema — token expirado, oscilação de rede, limite do plano — na frase
    "Nenhum espaço de trabalho ainda". Uma falha temporária ficava
    indistinguível de não ter espaço nenhum, a ponto de alguém criar um espaço
    duplicado achando que havia perdido o original.
  */
  const falha = erroEspacos ?? erroMembros ?? erroTarefas;
  if (falha) throw falha;

  const myRole = new Map(
    (memberships ?? [])
      .filter((m) => m.user_id === userId)
      .map((m) => [m.workspace_id, m.role as WorkspaceRole]),
  );

  const memberCount = new Map<string, number>();
  for (const m of memberships ?? []) {
    memberCount.set(m.workspace_id, (memberCount.get(m.workspace_id) ?? 0) + 1);
  }

  const taskCount = new Map<string, number>();
  for (const t of tasks ?? []) {
    taskCount.set(t.workspace_id, (taskCount.get(t.workspace_id) ?? 0) + 1);
  }

  return (workspaces ?? []).map((w) => ({
    ...w,
    role: myRole.get(w.id) ?? "member",
    task_count: taskCount.get(w.id) ?? 0,
    member_count: memberCount.get(w.id) ?? 0,
  }));
}

/** Convites pendentes endereçados ao e-mail do usuário atual. */
export type PendingInvitation = {
  id: string;
  role: WorkspaceRole;
  expires_at: string;
  workspace_id: string;
  workspace_name: string;
};

export async function listPendingInvitations(): Promise<PendingInvitation[]> {
  const supabase = await createClient();

  const { data: invitations } = await tolerandoRelogio(() =>
    supabase
      .from("workspace_invitations")
      .select("id, role, expires_at, workspace_id")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString()),
  );

  if (!invitations?.length) return [];

  // A RLS deixa o convidado ler o convite, mas não o workspace (ele ainda não
  // é membro). O nome do espaço, então, vem do próprio convite — por isso
  // guardamos apenas o id aqui e exibimos um rótulo genérico quando não há
  // acesso ao nome.
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .in(
      "id",
      invitations.map((i) => i.workspace_id),
    );

  const names = new Map((workspaces ?? []).map((w) => [w.id, w.name]));

  return invitations.map((i) => ({
    id: i.id,
    role: i.role as WorkspaceRole,
    expires_at: i.expires_at,
    workspace_id: i.workspace_id,
    workspace_name: names.get(i.workspace_id) ?? "Espaço de trabalho",
  }));
}

// ---------------------------------------------------------------------------
// Membros
// ---------------------------------------------------------------------------
export async function listMembers(workspaceId: string): Promise<MemberWithProfile[]> {
  const supabase = await createClient();

  const { data: members, error: erroMembros } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspaceId);

  // Espaço sem membro nenhum não existe — quem cria já entra como proprietário.
  // Lista vazia aqui é sempre falha, e passar batido esconderia a equipe toda.
  if (erroMembros) throw erroMembros;
  if (!members?.length) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in(
      "id",
      members.map((m) => m.user_id),
    );

  const byId = new Map((profiles ?? []).map((p) => [p.id, p as PersonRef]));

  const order: Record<WorkspaceRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };

  return members
    .map((m) => ({ ...m, profile: byId.get(m.user_id) ?? null }))
    .sort(
      (a, b) =>
        order[a.role] - order[b.role] ||
        (a.profile?.full_name ?? "").localeCompare(b.profile?.full_name ?? "", "pt-BR"),
    );
}

/**
 * Todas as pessoas que participam de algum espaço do proprietário, sem
 * repetir quem está em mais de um — para atribuir grupos de acesso, que
 * valem para a conta toda, não para um espaço específico. O próprio
 * proprietário fica de fora: ele nunca é barrado pela janela de uso.
 */
export async function listMyTeamMembers(ownerId: string): Promise<PersonRef[]> {
  const supabase = await createClient();

  const { data: workspaces, error: erroEspacos } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", ownerId);

  if (erroEspacos) throw erroEspacos;
  if (!workspaces?.length) return [];

  const { data: members, error: erroMembros } = await supabase
    .from("workspace_members")
    .select("user_id")
    .in(
      "workspace_id",
      workspaces.map((w) => w.id),
    )
    .neq("user_id", ownerId);

  if (erroMembros) throw erroMembros;

  const idsUnicos = [...new Set((members ?? []).map((m) => m.user_id))];
  if (idsUnicos.length === 0) return [];

  const { data: profiles, error: erroPerfis } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", idsUnicos);

  if (erroPerfis) throw erroPerfis;

  return (profiles ?? []).sort((a, b) =>
    (a.full_name ?? "").localeCompare(b.full_name ?? "", "pt-BR"),
  ) as PersonRef[];
}

/**
 * Matriz de permissões da conta.
 *
 * É uma só por conta, e todo espaço herda a do seu proprietário — mexer nela
 * afeta todos os espaços dessa pessoa. Por isso a busca é pelo `user_id`, e
 * não pelo espaço.
 */
export async function getMyPermissionMatrix(): Promise<PlainMatrix> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_permissions")
    .select("role, capability")
    .eq("user_id", user.id);

  // Tabela ausente significa migração não aplicada: a matriz vazia deixaria a
  // tela em branco, então caímos nos padrões conhecidos.
  if (error) return toPlain(matrixFromRows([]));

  return toPlain(matrixFromRows(data ?? []));
}

export type AccessWindow = {
  enabled: boolean;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export const JANELA_PADRAO: AccessWindow = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  startsAt: "08:00",
  endsAt: "18:00",
  timezone: "America/Sao_Paulo",
};

/** Janela de uso da conta. Ausente significa sem restrição. */
export async function getMyAccessWindow(): Promise<AccessWindow> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_access_windows")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) return JANELA_PADRAO;

  return {
    enabled: data.enabled,
    weekdays: data.weekdays ?? [],
    // O Postgres devolve "08:00:00"; a interface trabalha com "08:00".
    startsAt: data.starts_at.slice(0, 5),
    endsAt: data.ends_at.slice(0, 5),
    timezone: data.timezone,
  };
}

export type BlockingWindow = {
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  timezone: string;
};

/**
 * `true` se a pessoa está fora da janela de uso agora (do grupo em que
 * estiver, ou da janela pessoal do dono, se não estiver em nenhum grupo) —
 * chamado pelo middleware para barrar a entrada no site, não só a escrita.
 * O proprietário nunca é bloqueado.
 */
export async function amIBlockedByAccessWindow(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_blocked_by_access_window");
  // Erro de rede/RPC não deve travar o acesso ao site — só a janela em si
  // (já validada no banco a cada ação de escrita) barra de verdade.
  if (error) return false;
  return data ?? false;
}

/**
 * A janela que está bloqueando a pessoa agora — para explicar na tela de
 * "fora do horário" quando ela pode voltar. `null` se, por algum motivo,
 * nenhuma janela ativa for encontrada (a pessoa não deveria estar aqui, mas
 * a tela ainda precisa de algo para mostrar).
 */
export async function getMyBlockingWindow(): Promise<BlockingWindow | null> {
  const user = await requireUser();
  const supabase = await createClient();

  // A pessoa pode estar em espaços de vários donos; pegamos o dono de
  // qualquer espaço dela — a checagem do grupo/pessoal é por dono mesmo.
  const { data: minhasMembresias } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id);

  const workspaceIds = (minhasMembresias ?? []).map((m) => m.workspace_id);
  if (workspaceIds.length === 0) return null;

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("owner_id")
    .in("id", workspaceIds);

  const ownerIds = [...new Set((workspaces ?? []).map((w) => w.owner_id))];
  if (ownerIds.length === 0) return null;

  // Grupo primeiro (qualquer um dos donos), senão janela pessoal do primeiro dono.
  const { data: grupo } = await supabase
    .from("access_group_members")
    .select("access_groups!inner(owner_id, enabled, weekdays, starts_at, ends_at, timezone)")
    .eq("user_id", user.id)
    .in("access_groups.owner_id", ownerIds)
    .eq("access_groups.enabled", true)
    .maybeSingle();

  const grupoData = (
    grupo as unknown as {
      access_groups: {
        enabled: boolean;
        weekdays: number[];
        starts_at: string;
        ends_at: string;
        timezone: string;
      };
    } | null
  )?.access_groups;

  if (grupoData) {
    return {
      weekdays: grupoData.weekdays ?? [],
      startsAt: grupoData.starts_at.slice(0, 5),
      endsAt: grupoData.ends_at.slice(0, 5),
      timezone: grupoData.timezone,
    };
  }

  const { data: janela } = await supabase
    .from("user_access_windows")
    .select("weekdays, starts_at, ends_at, timezone")
    .in("user_id", ownerIds)
    .eq("enabled", true)
    .maybeSingle();

  if (!janela) return null;

  return {
    weekdays: janela.weekdays ?? [],
    startsAt: janela.starts_at.slice(0, 5),
    endsAt: janela.ends_at.slice(0, 5),
    timezone: janela.timezone,
  };
}

// ---------------------------------------------------------------------------
// Grupos de acesso — janela de uso por grupo de membros
// ---------------------------------------------------------------------------
export type AccessGroup = AccessWindow & {
  id: string;
  name: string;
  /** Ids dos membros (perfis) que estão neste grupo. */
  memberIds: string[];
};

/**
 * Grupos de acesso do proprietário, cada um com a própria janela e os
 * membros que estão nele. Quem não aparece em `memberIds` de nenhum grupo
 * não tem restrição de horário — a janela pessoal (`user_access_windows`)
 * ainda existe no banco como fallback de `within_access_window`, mas não tem
 * mais tela própria; só os grupos são editáveis pela interface.
 */
export async function listMyAccessGroups(): Promise<AccessGroup[]> {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: grupos, error: erroGrupos }, { data: membros, error: erroMembros }] =
    await Promise.all([
      supabase
        .from("access_groups")
        .select("*")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: true }),
      supabase.from("access_group_members").select("group_id, user_id"),
    ]);

  if (erroGrupos) throw erroGrupos;
  if (!grupos?.length) return [];

  // A RLS de `access_group_members` só devolve linhas de grupos visíveis para
  // quem pergunta — aqui, os do próprio dono — então filtrar por `group_id`
  // já basta, sem precisar checar o dono de novo.
  const idsDosGrupos = new Set(grupos.map((g) => g.id));
  const membrosPorGrupo = new Map<string, string[]>();
  if (!erroMembros) {
    for (const m of membros ?? []) {
      if (!idsDosGrupos.has(m.group_id)) continue;
      const lista = membrosPorGrupo.get(m.group_id) ?? [];
      lista.push(m.user_id);
      membrosPorGrupo.set(m.group_id, lista);
    }
  }

  return grupos.map((g) => ({
    id: g.id,
    name: g.name,
    enabled: g.enabled,
    weekdays: g.weekdays ?? [],
    startsAt: g.starts_at.slice(0, 5),
    endsAt: g.ends_at.slice(0, 5),
    timezone: g.timezone,
    memberIds: membrosPorGrupo.get(g.id) ?? [],
  }));
}

/**
 * Matriz que rege um espaço — a do proprietário dele, que nem sempre é quem
 * está olhando.
 */
export async function getWorkspacePermissionMatrix(
  ownerId: string,
): Promise<PlainMatrix> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("user_permissions")
    .select("role, capability")
    .eq("user_id", ownerId);

  if (error) return toPlain(matrixFromRows([]));
  return toPlain(matrixFromRows(data ?? []));
}

/** Capacidades de quem está olhando, dentro de um espaço. */
export async function getMyCapabilities(
  ownerId: string,
  role: WorkspaceRole,
): Promise<Set<Capability>> {
  const matriz = fromPlain(await getWorkspacePermissionMatrix(ownerId));
  return matriz[role];
}

export async function listWorkspaceInvitations(workspaceId: string): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (data ?? []) as Invitation[];
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------

/**
 * Todas as tarefas do espaço — base do dashboard, das listas e da busca.
 *
 * As particulares ficam de fora por padrão: elas não são o trabalho combinado
 * do espaço, e misturá-las desfaria a separação que a lista pessoal existe para
 * fazer. Quem administra pode pedi-las com `incluirParticulares`, e a lista as
 * marca com um selo — foi a visibilidade escolhida para o administrador.
 */
export async function listWorkspaceTasks(
  workspaceId: string,
  { incluirParticulares = false }: { incluirParticulares?: boolean } = {},
): Promise<TaskOverview[]> {
  const supabase = await createClient();

  let consulta = supabase
    .from("task_overview")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("parent_task_id", null);

  if (!incluirParticulares) consulta = consulta.eq("is_personal", false);

  const { data, error } = await consulta
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(1000);

  if (error) throw error;
  return (data ?? []) as TaskOverview[];
}

/**
 * A lista pessoal, atravessando todos os espaços de que a pessoa participa.
 *
 * Vem separada em dois blocos porque é essa a distinção que a tela existe para
 * mostrar: o que designaram para você e o que você anotou para si.
 *
 * Cada bloco é agrupado por espaço, e não numa lista só, porque tudo o que se
 * faz com uma tarefa — concluir, editar, comentar — obedece à matriz do espaço
 * dela, e a mesma pessoa pode ter papéis diferentes em cada um.
 */
export type PersonalBoard = {
  workspace: { id: string; name: string; color: string; owner_id: string };
  role: WorkspaceRole;
  capabilities: Set<Capability>;
  people: PersonRef[];
  designadas: TaskOverview[];
  particulares: TaskOverview[];
};

export async function listPersonalBoards(userId: string): Promise<PersonalBoard[]> {
  const supabase = await createClient();

  const { data: memberships, error: erroMembros } = await supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId);

  // Sem isto, uma falha aqui esvaziaria a lista pessoal inteira — inclusive as
  // tarefas particulares — como se a pessoa não tivesse nada.
  if (erroMembros) throw erroMembros;
  if (!memberships || memberships.length === 0) return [];

  const ids = memberships.map((m) => m.workspace_id);

  const [{ data: workspaces }, { data: tasks }, { data: membros }] = await Promise.all([
    supabase.from("workspaces").select("*").in("id", ids),
    supabase
      .from("task_overview")
      .select("*")
      .in("workspace_id", ids)
      .is("parent_task_id", null)
      .or(`assignee_id.eq.${userId},and(is_personal.eq.true,created_by.eq.${userId})`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(1000),
    // Sem `embed` do PostgREST, pelo motivo explicado no topo do arquivo: os
    // perfis vêm numa segunda consulta e são resolvidos por mapa.
    supabase.from("workspace_members").select("workspace_id, user_id").in("workspace_id", ids),
  ]);

  const { data: perfis } = await supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", [...new Set((membros ?? []).map((m) => m.user_id))]);

  const perfilPorId = new Map((perfis ?? []).map((p) => [p.id, p as PersonRef]));

  const porEspaco = new Map((workspaces ?? []).map((w) => [w.id, w]));

  // Uma matriz por proprietário, não por espaço: espaços do mesmo dono
  // compartilham as regras, e buscar duas vezes só repetiria a consulta.
  const donos = [...new Set((workspaces ?? []).map((w) => w.owner_id))];
  const matrizes = new Map(
    await Promise.all(
      donos.map(
        async (dono) =>
          [dono, fromPlain(await getWorkspacePermissionMatrix(dono))] as const,
      ),
    ),
  );

  const quadros: PersonalBoard[] = [];

  for (const m of memberships) {
    const workspace = porEspaco.get(m.workspace_id);
    if (!workspace) continue;

    const role = m.role as WorkspaceRole;
    const doEspaco = (tasks ?? []).filter(
      (t) => t.workspace_id === m.workspace_id,
    ) as TaskOverview[];

    const designadas = doEspaco.filter((t) => !t.is_personal && t.assignee_id === userId);
    const particulares = doEspaco.filter((t) => t.is_personal && t.created_by === userId);

    // Espaços vazios continuam na lista: é neles que a pessoa cria a primeira
    // tarefa particular. Quem decide o que esconder é a tela.
    quadros.push({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        color: workspace.color,
        owner_id: workspace.owner_id,
      },
      role,
      capabilities: matrizes.get(workspace.owner_id)?.[role] ?? new Set<Capability>(),
      people: (membros ?? [])
        .filter((x) => x.workspace_id === m.workspace_id)
        .map((x) => perfilPorId.get(x.user_id))
        .filter((p): p is PersonRef => p !== undefined),
      designadas,
      particulares,
    });
  }

  return quadros;
}

// Detalhes de uma tarefa (subtarefas e comentários) são carregados pelo próprio
// painel, no navegador, quando ele abre — ver `components/task/task-panel.tsx`.
// Assim a lista não paga por dados que só são vistos sob demanda.

// ---------------------------------------------------------------------------
// Dependências entre tarefas
// ---------------------------------------------------------------------------

/** Para uma tarefa: o que ela espera terminar, e o que espera por ela. */
export type TaskDependencyInfo = {
  dependsOn: TaskOverview[];
  blockedBy: TaskOverview[];
};

/**
 * Dependências de um conjunto de tarefas, resolvidas contra a lista de
 * tarefas já carregada — mesmo estilo de "mapa em memória" do resto deste
 * arquivo, em vez de um embed do PostgREST.
 */
export async function listTaskDependencies(
  workspaceId: string,
  tasks: TaskOverview[],
): Promise<Map<string, TaskDependencyInfo>> {
  const supabase = await createClient();
  const taskIds = tasks.map((t) => t.id);
  const porId = new Map(tasks.map((t) => [t.id, t]));

  const info = new Map<string, TaskDependencyInfo>();
  if (taskIds.length === 0) return info;

  const { data, error } = await supabase
    .from("task_dependencies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .or(`task_id.in.(${taskIds.join(",")}),depends_on_task_id.in.(${taskIds.join(",")})`);

  if (error) throw error;

  for (const row of (data ?? []) as TaskDependency[]) {
    const dependente = porId.get(row.task_id);
    const dependida = porId.get(row.depends_on_task_id);

    if (dependente && dependida) {
      const atual = info.get(row.task_id) ?? { dependsOn: [], blockedBy: [] };
      atual.dependsOn.push(dependida);
      info.set(row.task_id, atual);

      const inverso = info.get(row.depends_on_task_id) ?? { dependsOn: [], blockedBy: [] };
      inverso.blockedBy.push(dependente);
      info.set(row.depends_on_task_id, inverso);
    }
  }

  return info;
}

// ---------------------------------------------------------------------------
// Campos personalizados
// ---------------------------------------------------------------------------

export async function listCustomFieldDefinitions(
  workspaceId: string,
): Promise<CustomFieldDefinition[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("custom_field_definitions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CustomFieldDefinition[];
}

/** Valores preenchidos, por tarefa: `taskId -> (fieldId -> valor)`. */
export async function listCustomFieldValues(
  workspaceId: string,
  taskIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const porTarefa = new Map<string, Map<string, string>>();
  if (taskIds.length === 0) return porTarefa;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_field_values")
    .select("*")
    .eq("workspace_id", workspaceId)
    .in("task_id", taskIds);

  if (error) throw error;

  for (const row of (data ?? []) as CustomFieldValue[]) {
    if (row.value === null) continue;
    const doMapa = porTarefa.get(row.task_id) ?? new Map<string, string>();
    doMapa.set(row.field_id, row.value);
    porTarefa.set(row.task_id, doMapa);
  }

  return porTarefa;
}
