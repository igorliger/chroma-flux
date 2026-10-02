import type { PersonalTaskOverview, TaskOverview } from "@/lib/database.types";

/**
 * "Minhas tarefas" precisa mostrar, lado a lado, tarefas de espaço e
 * lembretes pessoais — coisas com tabelas, ações e permissões diferentes por
 * trás. Em vez de duas listas separadas, o lembrete é "adaptado" pro formato
 * de `TaskOverview`: os campos que ele não tem (responsável, comentários,
 * "Todos") ganham o valor que um lembrete sempre teria — um único
 * responsável, que é o próprio dono, sem comentário nenhum. Assim a mesma
 * lista, o mesmo filtro e a mesma busca (`lib/filters.ts`, `TaskList`)
 * servem os dois sem precisar saber da diferença.
 *
 * `origem` é o que sobra pra saber, na hora de abrir ou concluir o item,
 * pra qual ação do servidor mandar a mudança.
 */
export type UnifiedTask = TaskOverview & {
  origem: "espaco" | "lembrete";
  /** Só quando `origem === "lembrete"`: o objeto original, pro painel dele. */
  lembreteOriginal?: PersonalTaskOverview;
};

export function adaptarTarefaDeEspaco(t: TaskOverview): UnifiedTask {
  return { ...t, origem: "espaco" };
}

export function adaptarLembrete(p: PersonalTaskOverview, donoId: string): UnifiedTask {
  return {
    id: p.id,
    workspace_id: "",
    parent_task_id: p.parent_task_id,
    title: p.title,
    description: p.description,
    assignee_id: donoId,
    co_assignee_ids: [],
    assigned_to_all: false,
    priority: p.priority,
    due_date: p.due_date,
    due_time: p.due_time,
    is_completed: p.is_completed,
    completed_at: p.completed_at,
    position: p.position,
    created_by: donoId,
    created_at: p.created_at,
    updated_at: p.updated_at,
    recurrence_type: p.recurrence_type,
    recurrence_interval: p.recurrence_interval,
    recurrence_unit: p.recurrence_unit,
    recurrence_weekdays: p.recurrence_weekdays,
    recurrence_ends_on: p.recurrence_ends_on,
    is_personal: true,
    board_status: "todo",
    subtask_count: p.subtask_count,
    subtask_done_count: p.subtask_done_count,
    comment_count: 0,
    attachment_count: p.attachment_count ?? 0,
    image_count: p.image_count ?? 0,
    completed_by_ids: [],
    origem: "lembrete",
    lembreteOriginal: p,
  };
}
