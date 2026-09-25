"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";
import type { TaskBoardStatus, TaskUpdate } from "@/lib/database.types";
import { isResponsible, isSharedTask } from "@/lib/utils";

export type ActionState = {
  error?: string;
  success?: string;
  /** Id da tarefa recém-criada — a janela de criação envia os anexos para ela. */
  taskId?: string;
  /** Tarefa criada, mas algum extra (subtarefa, comentário) não entrou. */
  warning?: string;
};

const uuid = z.string().uuid();
const optionalUuid = z
  .union([uuid, z.literal(""), z.null()])
  .transform((v) => (v ? v : null));

const priority = z.enum(["low", "medium", "high", "urgent"]);

/**
 * A recorrência trafega como um único campo JSON no formulário. São cinco
 * valores que só fazem sentido juntos — espalhá-los em cinco campos soltos
 * multiplicaria a checagem sem ganhar nada.
 */
const recurrenceSchema = z.object({
  type: z.enum(["none", "daily", "weekly", "monthly", "yearly", "periodic", "custom"]),
  interval: z.coerce.number().int().min(1).max(999),
  unit: z.enum(["day", "week", "month", "year"]),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
  endsOn: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
    .transform((v) => (v ? v : null)),
});

type ParsedRecurrence = z.infer<typeof recurrenceSchema>;

/** Lê o campo JSON; ausente ou malformado significa "não repetir". */
function parseRecurrence(raw: FormDataEntryValue | null): ParsedRecurrence | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed = recurrenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Colunas de recorrência prontas para o INSERT/UPDATE. */
function recurrenceColumns(r: ParsedRecurrence) {
  return {
    recurrence_type: r.type,
    recurrence_interval: r.interval,
    recurrence_unit: r.unit,
    // O banco recusa lista vazia quando há dias marcados; fora dos tipos que
    // usam dias da semana, a lista precisa ir vazia mesmo.
    recurrence_weekdays:
      r.type === "weekly" || (r.type === "custom" && r.unit === "week") ? r.weekdays : [],
    recurrence_ends_on: r.endsOn,
  };
}

/** O banco exige prazo para os tipos de agenda fixa. */
function recurrenceErrorFor(r: ParsedRecurrence | null, dueDate: string | null) {
  if (!r || r.type === "none" || r.type === "periodic") return null;
  if (!dueDate) {
    return (
      "Escolha um prazo para esta repetição: ela segue uma agenda a partir dele. " +
      "Para contar a partir da conclusão, use “Periodicamente”."
    );
  }
  if (
    (r.type === "weekly" || (r.type === "custom" && r.unit === "week")) &&
    r.weekdays.length === 0
  ) {
    return "Marque pelo menos um dia da semana.";
  }
  return null;
}

const dueDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."), z.literal("")])
  .transform((v) => (v ? v : null))
  .nullable();

/**
 * "HH:MM" — a grade da interface é de meia em meia hora.
 *
 * Aceita também "HH:MM:SS": é assim que o Postgres devolve a coluna `time`,
 * e a hora volta para o servidor nesse formato sempre que só a data ou a
 * repetição muda. Sem isso, trocar a repetição de uma tarefa com hora dava
 * "Hora inválida." e não salvava nada.
 */
const dueTime = z
  .union([
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Hora inválida."),
    z.literal(""),
    z.null(),
  ])
  .transform((v) => (v ? v.slice(0, 5) : null));

/** Telas que mostram tarefas do espaço. */
function revalidateTasks(workspaceId: string) {
  revalidatePath(`/e/${workspaceId}/tarefas`);
  revalidatePath(`/e/${workspaceId}`);
  revalidatePath(`/e/${workspaceId}/minhas-tarefas`);
}

/** Mensagem legível para os erros que a RLS costuma devolver. */
function friendlyError(code?: string, message?: string) {
  // Recusas com texto próprio (ex.: membro tentando atribuir tarefa a outra
  // pessoa — migração 0017) já vêm prontas para mostrar.
  if (code === "42501" && message?.startsWith("Você ")) return message;
  if (code === "42501") return "Você não tem permissão para esta ação neste espaço.";
  if (code === "23503") return "Referência inválida para esta tarefa.";
  if (code === "42703" && message?.includes("recurrence")) {
    // O banco ainda não tem as colunas de recorrência.
    return (
      "O banco de dados ainda não tem o recurso de repetição. " +
      "Execute supabase/migrations/0004_recurrence.sql no SQL Editor do Supabase."
    );
  }
  if (code === "23514") {
    // Restrições de recorrência: o texto do Postgres cita o nome interno.
    if (message?.includes("recurrence_needs_due_date")) {
      return "Esta repetição precisa de um prazo. Para contar a partir da conclusão, use “Periodicamente”.";
    }
    if (message?.includes("recurrence_weekdays")) {
      return "Marque pelo menos um dia da semana.";
    }
    if (message?.includes("recurrence_interval")) {
      return "O intervalo precisa estar entre 1 e 999.";
    }
    return "Alguns valores da tarefa não são válidos.";
  }
  return message ?? "Não foi possível concluir a operação.";
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------
const createSchema = z.object({
  workspaceId: uuid,
  parentTaskId: optionalUuid,
  title: z.string().trim().min(1, "A tarefa precisa de um título.").max(300, "Título muito longo."),
  description: z.string().trim().max(10000, "Descrição muito longa.").default(""),
  assigneeId: optionalUuid,
  coAssigneeIds: z.array(z.string().uuid()).max(50, "No máximo 50 responsáveis.").default([]),
  priority: priority.default("medium"),
  dueDate: dueDate.default(null),
  dueTime: dueTime.default(null),
  position: z.coerce.number().default(1000),
  isPersonal: z
    .union([z.literal("true"), z.literal("false"), z.null()])
    .transform((v) => v === "true"),
});

export async function createTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    parentTaskId: formData.get("parentTaskId") ?? "",
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    assigneeId: formData.get("assigneeId") ?? "",
    coAssigneeIds: formData.getAll("coAssigneeIds").map(String).filter(Boolean),
    priority: formData.get("priority") ?? "medium",
    dueDate: formData.get("dueDate") ?? "",
    dueTime: formData.get("dueTime") ?? "",
    position: formData.get("position") ?? 1000,
    isPersonal: formData.get("isPersonal") as "true" | null,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const recurrence = parseRecurrence(formData.get("recurrence"));
  const recurrenceError = recurrenceErrorFor(recurrence, parsed.data.dueDate);
  if (recurrenceError) return { error: recurrenceError };

  const user = await requireUser();
  const supabase = await createClient();

  // O id nasce aqui para as subtarefas, o comentário e os anexos poderem
  // apontar para a tarefa logo em seguida, sem depender de RETURNING.
  const taskId = randomUUID();

  const { error } = await supabase.from("tasks").insert({
    id: taskId,
    workspace_id: parsed.data.workspaceId,
    parent_task_id: parsed.data.parentTaskId,
    title: parsed.data.title,
    description: parsed.data.description,
    is_personal: parsed.data.isPersonal,
    // Tarefa particular é sempre de quem a criou: deixá-la sem responsável a
    // faria sumir da lista pessoal, que é o único lugar onde ela aparece.
    assignee_id: parsed.data.isPersonal ? user.id : parsed.data.assigneeId,
    // Particular é só de quem criou: não há outros responsáveis.
    co_assignee_ids: parsed.data.isPersonal ? [] : parsed.data.coAssigneeIds,
    assigned_to_all: !parsed.data.isPersonal && formData.get("assignedToAll") === "true",
    priority: parsed.data.priority,
    due_date: parsed.data.dueDate,
    // Hora sem data é recusada pelo banco; a interface já evita, isto é a rede.
    due_time: parsed.data.dueDate ? parsed.data.dueTime : null,
    position: parsed.data.position,
    created_by: user.id,
    // Só toca nas colunas de recorrência quando há repetição de fato: assim
    // criar uma tarefa comum continua funcionando mesmo antes de a migração
    // 0004 ser aplicada ao banco.
    ...(recurrence && recurrence.type !== "none" ? recurrenceColumns(recurrence) : {}),
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  // Extras preenchidos já na criação. A tarefa já existe: se algum deles
  // falhar, ela continua criada e a janela avisa o que não entrou.
  const avisos: string[] = [];

  const subtarefas = formData
    .getAll("subtasks")
    .map((v) => String(v).trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 30);
  if (subtarefas.length > 0) {
    const { error: erroSub } = await supabase.from("tasks").insert(
      subtarefas.map((title, i) => ({
        workspace_id: parsed.data.workspaceId,
        parent_task_id: taskId,
        title,
        created_by: user.id,
        is_personal: parsed.data.isPersonal,
        position: (i + 1) * 1000,
      })),
    );
    if (erroSub) avisos.push("as subtarefas não puderam ser criadas");
  }

  const comentario = String(formData.get("comment") ?? "").trim().slice(0, 10000);
  if (comentario) {
    const { error: erroComentario } = await supabase.from("comments").insert({
      workspace_id: parsed.data.workspaceId,
      task_id: taskId,
      author_id: user.id,
      body: comentario,
    });
    if (erroComentario) avisos.push("o comentário não pôde ser salvo");
  }

  revalidateTasks(parsed.data.workspaceId);
  return {
    success: "Tarefa criada.",
    taskId,
    warning: avisos.length ? `Tarefa criada, mas ${avisos.join(" e ")}.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Atualizar
// ---------------------------------------------------------------------------
const updateSchema = z.object({
  taskId: uuid,
  workspaceId: uuid,
  title: z.string().trim().min(1, "A tarefa precisa de um título.").max(300).optional(),
  description: z.string().trim().max(10000).optional(),
  assigneeId: optionalUuid.optional(),
  priority: priority.optional(),
  dueDate: dueDate.optional(),
  isCompleted: z.coerce.boolean().optional(),
});

export async function updateTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw: Record<string, unknown> = {
    taskId: formData.get("taskId"),
    workspaceId: formData.get("workspaceId"),
  };

  // Só entram no UPDATE os campos realmente enviados pelo formulário.
  for (const key of ["title", "description", "assigneeId", "priority", "dueDate"]) {
    if (formData.has(key)) raw[key] = formData.get(key);
  }
  if (formData.has("isCompleted")) {
    raw.isCompleted = formData.get("isCompleted") === "true";
  }

  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { taskId, workspaceId, ...fields } = parsed.data;

  const patch: TaskUpdate = {};
  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.description !== undefined) patch.description = fields.description;
  if (fields.assigneeId !== undefined) patch.assignee_id = fields.assigneeId;
  if (fields.priority !== undefined) patch.priority = fields.priority;
  if (fields.dueDate !== undefined) patch.due_date = fields.dueDate;
  if (fields.isCompleted !== undefined) patch.is_completed = fields.isCompleted;

  if (Object.keys(patch).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(workspaceId);
  return { success: "Tarefa atualizada." };
}

const boardStatus = z.enum(["todo", "doing", "done"]);

const patchSchema = z.object({
  taskId: uuid,
  workspaceId: uuid,
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(10000).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  co_assignee_ids: z.array(z.string().uuid()).max(50).optional(),
  assigned_to_all: z.boolean().optional(),
  priority: priority.optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  is_completed: z.boolean().optional(),
  board_status: boardStatus.optional(),
  position: z.number().optional(),
  /**
   * Concluir/reabrir a tarefa inteira mesmo sendo compartilhada — o botão
   * "Concluir para todos" de quem administra. Sem isto, um responsável
   * conclui só a sua parte.
   */
  for_all: z.boolean().optional(),
});

export type TaskPatch = Omit<z.infer<typeof patchSchema>, "taskId" | "workspaceId">;

/**
 * Se existir alguma tarefa da qual `taskId` depende e que ainda não foi
 * concluída, devolve uma mensagem amigável explicando qual — e a conclusão
 * não deve prosseguir. `null` significa livre para concluir.
 */
async function dependenciaPendente(taskId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: dependencias, error } = await supabase
    .from("task_dependencies")
    .select("depends_on_task_id")
    .eq("task_id", taskId);

  if (error || !dependencias?.length) return null;

  const { data: tarefas } = await supabase
    .from("tasks")
    .select("id, title, is_completed")
    .in(
      "id",
      dependencias.map((d) => d.depends_on_task_id),
    );

  const pendente = (tarefas ?? []).find((t) => !t.is_completed);
  if (!pendente) return null;

  return `Esta tarefa depende de "${pendente.title}", que ainda não foi concluída.`;
}

/**
 * Atualização pontual de um campo, usada pelas edições inline do painel de
 * tarefa e pelo quadro Kanban. Diferente de `updateTaskAction`, recebe um
 * objeto em vez de FormData — mais direto para chamadas vindas de
 * componentes client.
 *
 * `board_status` e `is_completed` ficam sincronizados aqui, num só lugar:
 * mover para "Feito" no quadro também conclui a tarefa, e concluir pela
 * lista/painel joga a coluna para "Feito". Reabrir uma tarefa cujo status
 * era "done" volta para "doing" (não "todo"), para não perder o progresso
 * percebido no quadro.
 */
export async function patchTaskAction(
  taskId: string,
  workspaceId: string,
  patch: TaskPatch,
): Promise<{ error?: string }> {
  const parsed = patchSchema.safeParse({ taskId, workspaceId, ...patch });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const vaiConcluir =
    parsed.data.is_completed === true || parsed.data.board_status === "done";

  if (vaiConcluir) {
    const aviso = await dependenciaPendente(taskId);
    if (aviso) return { error: aviso };
  }

  // Tarefa com vários responsáveis: quem é um deles conclui (ou reabre) só a
  // sua parte — venha o clique da lista, do quadro ou do painel. A tarefa
  // fecha de vez quando todos concluírem (set_my_task_completion).
  const mexeNaConclusao =
    parsed.data.is_completed !== undefined ||
    (parsed.data.board_status !== undefined && parsed.data.board_status !== "todo");
  if (mexeNaConclusao && !parsed.data.for_all) {
    const supabase = await createClient();
    const user = await requireUser();
    const { data: tarefa } = await supabase
      .from("tasks")
      .select("assignee_id, co_assignee_ids, is_completed")
      .eq("id", taskId)
      .maybeSingle();

    if (tarefa && isSharedTask(tarefa) && isResponsible(tarefa, user.id)) {
      const concluir =
        parsed.data.is_completed ?? parsed.data.board_status === "done";
      // Mover entre "A fazer" e "Fazendo" numa tarefa aberta não é conclusão.
      if (parsed.data.is_completed !== undefined || concluir || tarefa.is_completed) {
        const { error } = await supabase.rpc("set_my_task_completion", {
          p_task_id: taskId,
          p_done: concluir,
        });
        if (error) return { error: friendlyError(error.code, error.message) };
        revalidateTasks(workspaceId);
        return {};
      }
    }
  }

  // Só os campos de conteúdo vão para o UPDATE — os identificadores ficam de fora.
  const fields: TaskUpdate = {};
  if (parsed.data.title !== undefined) fields.title = parsed.data.title;
  if (parsed.data.description !== undefined) fields.description = parsed.data.description;
  if (parsed.data.assignee_id !== undefined) fields.assignee_id = parsed.data.assignee_id;
  if (parsed.data.co_assignee_ids !== undefined) fields.co_assignee_ids = parsed.data.co_assignee_ids;
  if (parsed.data.assigned_to_all !== undefined) fields.assigned_to_all = parsed.data.assigned_to_all;
  if (parsed.data.priority !== undefined) fields.priority = parsed.data.priority;
  if (parsed.data.due_date !== undefined) fields.due_date = parsed.data.due_date;
  if (parsed.data.position !== undefined) fields.position = parsed.data.position;

  let boardStatusFinal: TaskBoardStatus | undefined = parsed.data.board_status;

  if (parsed.data.is_completed !== undefined) {
    fields.is_completed = parsed.data.is_completed;
    // Quem concluiu pela lista/painel também anda no quadro; quem reabriu
    // volta para "Fazendo", nunca para "A fazer".
    if (boardStatusFinal === undefined) {
      boardStatusFinal = parsed.data.is_completed ? "done" : "doing";
    }
  } else if (parsed.data.board_status !== undefined) {
    // Quem moveu no quadro também conclui/reabre pelo mesmo campo que a
    // lista usa — um único estado de verdade para "concluída".
    fields.is_completed = parsed.data.board_status === "done";
  }

  if (boardStatusFinal !== undefined) fields.board_status = boardStatusFinal;

  if (Object.keys(fields).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from("tasks").update(fields).eq("id", taskId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(workspaceId);
  return {};
}

/**
 * Grava prazo e repetição juntos.
 *
 * São um par: o banco recusa agenda fixa sem prazo, e limpar o prazo precisa
 * derrubar a repetição junto. Salvá-los em chamadas separadas deixaria a
 * tarefa num estado intermediário inválido entre as duas.
 */
export async function setTaskScheduleAction(
  taskId: string,
  workspaceId: string,
  dueDate: string | null,
  dueTimeValue: string | null,
  recurrence: unknown,
): Promise<{ error?: string }> {
  const ids = z.object({ taskId: uuid, workspaceId: uuid });
  if (!ids.safeParse({ taskId, workspaceId }).success) {
    return { error: "Tarefa inválida." };
  }

  const data = z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .safeParse(dueDate);
  if (!data.success) return { error: "Data inválida." };

  const hora = dueTime.safeParse(dueTimeValue);
  if (!hora.success) return { error: "Hora inválida." };

  const r = recurrenceSchema.safeParse(recurrence);
  if (!r.success) return { error: "Configuração de repetição inválida." };

  const erro = recurrenceErrorFor(r.data, data.data);
  if (erro) return { error: erro };

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({
      due_date: data.data,
      // Limpar a data limpa a hora junto: o banco recusa hora órfã.
      due_time: data.data ? hora.data : null,
      ...recurrenceColumns(r.data),
    })
    .eq("id", taskId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(workspaceId);
  return {};
}

/** Alterna a conclusão da tarefa. Usada nas caixas de seleção das listas. */
export async function toggleTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const completed = formData.get("isCompleted") === "true";

  // Mesma checagem de `patchTaskAction`: sem isso, a caixa de seleção
  // concluiria uma tarefa bloqueada sem avisar nada — só `patchTaskAction`
  // devolve erro amigável, e este endpoint não tem para onde devolvê-lo.
  if (completed) {
    const aviso = await dependenciaPendente(taskId);
    if (aviso) return;
  }

  const supabase = await createClient();
  await supabase
    .from("tasks")
    .update({ is_completed: completed, board_status: completed ? "done" : "doing" })
    .eq("id", taskId);

  revalidateTasks(workspaceId);
}

export async function deleteTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const supabase = await createClient();
  await supabase.from("tasks").delete().eq("id", taskId);

  revalidateTasks(workspaceId);
}

// ---------------------------------------------------------------------------
// Subtarefas
// ---------------------------------------------------------------------------
export async function createSubtaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const schema = z.object({
    workspaceId: uuid,
    parentTaskId: uuid,
    title: z.string().trim().min(1, "A subtarefa precisa de um título.").max(300),
  });

  const parsed = schema.safeParse({
    workspaceId: formData.get("workspaceId"),
    parentTaskId: formData.get("parentTaskId"),
    title: formData.get("title"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from("tasks").insert({
    workspace_id: parsed.data.workspaceId,
    parent_task_id: parsed.data.parentTaskId,
    title: parsed.data.title,
    created_by: user.id,
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(parsed.data.workspaceId);
  return {};
}

// ---------------------------------------------------------------------------
// Ações em massa
// ---------------------------------------------------------------------------
const bulkSchema = z.object({
  workspaceId: uuid,
  taskIds: z.array(uuid).min(1, "Selecione ao menos uma tarefa."),
});

/**
 * Exclui várias tarefas de uma vez — a caixa de seleção da lista/quadro.
 *
 * A política do banco (RLS) já barra quem não tem `task.delete`; aqui só
 * validamos o formato para devolver um erro legível em vez de deixar o
 * Supabase recusar em silêncio linha a linha.
 */
export async function bulkDeleteTasksAction(
  workspaceId: string,
  taskIds: string[],
): Promise<{ error?: string; count?: number }> {
  const parsed = bulkSchema.safeParse({ workspaceId, taskIds });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("tasks")
    .delete({ count: "exact" })
    .in("id", parsed.data.taskIds);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(workspaceId);
  return { count: count ?? parsed.data.taskIds.length };
}

/**
 * Marca ou reabre várias tarefas de uma vez.
 *
 * Segue a mesma regra de `patchTaskAction`: reabrir volta para "doing" (não
 * "todo"), e tarefas com dependência pendente são puladas — em vez de barrar
 * a operação inteira, a mensagem devolvida diz quantas ficaram de fora.
 */
export async function bulkCompleteTasksAction(
  workspaceId: string,
  taskIds: string[],
  completed: boolean,
): Promise<{ error?: string; count?: number }> {
  const parsed = bulkSchema.safeParse({ workspaceId, taskIds });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let idsParaAtualizar = parsed.data.taskIds;

  if (completed) {
    const pendentes = await Promise.all(
      idsParaAtualizar.map(async (id) => ((await dependenciaPendente(id)) ? id : null)),
    );
    const bloqueadas = new Set(pendentes.filter((id): id is string => id !== null));
    idsParaAtualizar = idsParaAtualizar.filter((id) => !bloqueadas.has(id));

    if (idsParaAtualizar.length === 0) {
      return { error: "Nenhuma tarefa selecionada pode ser concluída: todas dependem de outra pendente." };
    }
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("tasks")
    .update({ is_completed: completed, board_status: completed ? "done" : "doing" }, { count: "exact" })
    .in("id", idsParaAtualizar);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(workspaceId);

  const puladas = parsed.data.taskIds.length - idsParaAtualizar.length;
  if (puladas > 0) {
    return {
      count: count ?? idsParaAtualizar.length,
      error: `${puladas} tarefa(s) não foram concluídas por depender de outra pendente.`,
    };
  }

  return { count: count ?? idsParaAtualizar.length };
}

