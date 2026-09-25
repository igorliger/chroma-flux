import type { WorkspaceRole } from "@/lib/database.types";

/**
 * Capacidades configuráveis por papel.
 *
 * A lista aqui é a mesma que as policies do banco consultam
 * (`public.has_capability`). Se divergirem, a interface esconde um botão que o
 * banco deixaria passar — ou pior, mostra um que ele recusa. Ao acrescentar
 * uma capacidade, ela precisa entrar nos dois lugares.
 */
export type Capability =
  | "task.create"
  | "task.edit"
  | "task.complete"
  | "task.delete"
  | "comment.create"
  | "comment.moderate"
  | "member.manage"
  | "workspace.edit"
  | "workspace.delete"
  | "dependency.manage"
  | "custom_field.manage";

export type PermissionMatrix = Record<WorkspaceRole, Set<Capability>>;

/**
 * O que a tela de tarefas pode oferecer a quem está olhando.
 *
 * Existe para os componentes não decidirem isso cada um por conta própria: um
 * botão a mais aqui vira uma ação que o banco recusa, e um a menos vira uma
 * permissão que o usuário tem e não encontra.
 */
export type TaskPermissions = {
  create: boolean;
  edit: boolean;
  complete: boolean;
  delete: boolean;
  /**
   * Comentar não depende de poder editar a tarefa — é o canal de quem só
   * executa. Vem junto porque o painel decide as duas coisas no mesmo lugar.
   */
  comment: boolean;
};

export function taskPermissions(capacidades: Set<Capability>): TaskPermissions {
  const edit = capacidades.has("task.edit");

  return {
    create: capacidades.has("task.create"),
    edit,
    comment: capacidades.has("comment.create"),
    // Quem edita, conclui. `task.complete` é o subconjunto de quem só executa;
    // exigir as duas marcadas faria a matriz negar o menos a quem tem o mais.
    complete: edit || capacidades.has("task.complete"),
    delete: capacidades.has("task.delete"),
  };
}

export const CAPABILITY_GROUPS: {
  grupo: string;
  itens: { value: Capability; label: string; hint?: string }[];
}[] = [
  {
    grupo: "Tarefas",
    itens: [
      { value: "task.create", label: "Criar tarefas e subtarefas" },
      {
        value: "task.complete",
        label: "Marcar como concluída",
        hint: "Concluir e reabrir tarefas e subtarefas, sem poder alterá-las.",
      },
      {
        value: "task.edit",
        label: "Editar tarefas",
        hint:
          "Título, descrição, responsável, prioridade, prazo, repetição e anexos. " +
          "Quem edita também conclui.",
      },
      { value: "task.delete", label: "Excluir tarefas" },
      {
        value: "dependency.manage",
        label: "Gerenciar dependências entre tarefas",
        hint: "Adicionar e remover a relação \"depende de\" entre tarefas do espaço.",
      },
    ],
  },
  {
    grupo: "Comentários",
    itens: [
      { value: "comment.create", label: "Comentar" },
      {
        value: "comment.moderate",
        label: "Excluir comentários de outros",
        hint: "O autor sempre pode excluir os próprios.",
      },
    ],
  },
  {
    grupo: "Espaço de trabalho",
    itens: [
      {
        value: "member.manage",
        label: "Gerenciar membros e permissões",
        hint: "Convidar, remover, mudar papéis e editar esta própria tela.",
      },
      { value: "workspace.edit", label: "Editar nome, descrição e cor" },
      { value: "workspace.delete", label: "Excluir o espaço de trabalho" },
      {
        value: "custom_field.manage",
        label: "Gerenciar campos personalizados",
        hint: "Criar, editar e excluir os campos personalizados do espaço.",
      },
    ],
  },
];

export const ALL_CAPABILITIES: Capability[] = CAPABILITY_GROUPS.flatMap((g) =>
  g.itens.map((i) => i.value),
);

/** Ordem das colunas na matriz, do mais para o menos privilegiado. */
export const ROLE_ORDER: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

/**
 * Combinações que a interface não deixa desmarcar.
 *
 * O proprietário precisa manter o controle de membros e permissões: desmarcar
 * isso trancaria o espaço para sempre, já que ninguém poderia reabrir a tela
 * para desfazer. O banco também recusa, por gatilho — aqui a caixa já vem
 * travada, para o erro nem acontecer.
 */
export function isLocked(role: WorkspaceRole, capability: Capability): boolean {
  return role === "owner" && capability === "member.manage";
}

export function emptyMatrix(): PermissionMatrix {
  return {
    owner: new Set<Capability>(),
    admin: new Set<Capability>(),
    member: new Set<Capability>(),
    viewer: new Set<Capability>(),
  };
}

/** Monta a matriz a partir das linhas do banco. */
export function matrixFromRows(
  rows: { role: WorkspaceRole; capability: string }[],
): PermissionMatrix {
  const matriz = emptyMatrix();
  for (const row of rows) {
    if (ALL_CAPABILITIES.includes(row.capability as Capability)) {
      matriz[row.role].add(row.capability as Capability);
    }
  }
  return matriz;
}

/** Formato serializável, para atravessar a fronteira servidor → cliente. */
export type PlainMatrix = Record<WorkspaceRole, Capability[]>;

export function toPlain(matriz: PermissionMatrix): PlainMatrix {
  return {
    owner: [...matriz.owner],
    admin: [...matriz.admin],
    member: [...matriz.member],
    viewer: [...matriz.viewer],
  };
}

export function fromPlain(plain: PlainMatrix): PermissionMatrix {
  return {
    owner: new Set(plain.owner),
    admin: new Set(plain.admin),
    member: new Set(plain.member),
    viewer: new Set(plain.viewer),
  };
}
