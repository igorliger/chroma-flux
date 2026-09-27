"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";
import type { PersonalTaskUpdate } from "@/lib/database.types";

/**
 * Server actions dos lembretes pessoais (migração 0029).
 *
 * Espelham `actions/tasks.ts`, sem os pedaços que só fazem sentido para
 * trabalho de espaço: sem `workspaceId`, sem responsável/co-responsáveis
 * ("Todos"), sem comentário nem anexo na criação, sem dependências, sem
 * `board_status`. O que sobra — título, descrição, prioridade, prazo com
 * hora, repetição e subtarefas — é a mesma regra de validação, porque o
 * banco (`personal_tasks`) tem as mesmas restrições de `tasks` para esses
 * campos.
 */

export type ActionState = {
  error?: string;
  success?: string;
  /** Id do lembrete recém-criado. */
  taskId?: string;
  warning?: string;
};

const uuid = z.string().uuid();
const optionalUuid = z
  .union([uuid, z.literal(""), z.null()])
  .transform((v) => (v ? v : null));

const priority = z.enum(["low", "medium", "high", "urgent"]);

/** Mesmo formato de `actions/tasks.ts`: um único campo JSON no formulário. */
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

function parseRecurrence(raw: FormDataEntryValue | null): ParsedRecurrence | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed = recurrenceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function recurrenceColumns(r: ParsedRecurrence) {
  return {
    recurrence_type: r.type,
    recurrence_interval: r.interval,
    recurrence_unit: r.unit,
    recurrence_weekdays:
      r.type === "weekly" || (r.type === "custom" && r.unit === "week") ? r.weekdays : [],
    recurrence_ends_on: r.endsOn,
  };
}

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

const dueTime = z
  .union([
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Hora inválida."),
    z.literal(""),
    z.null(),
  ])
  .transform((v) => (v ? v.slice(0, 5) : null));

/** A única tela que mostra lembretes pessoais. */
function revalidateReminders() {
  revalidatePath("/minhas-tarefas");
}

function friendlyError(code?: string, message?: string) {
  if (code === "42501") return "Você não tem permissão para esta ação.";
  if (code === "23503") return "Referência inválida para este lembrete.";
  if (code === "23514") {
    if (message?.includes("recurrence_needs_due_date") || message?.includes("recurrence_type")) {
      return "Esta repetição precisa de um prazo. Para contar a partir da conclusão, use “Periodicamente”.";
    }
    if (message?.includes("recurrence_weekdays")) {
      return "Marque pelo menos um dia da semana.";
    }
    if (message?.includes("recurrence_interval")) {
      return "O intervalo precisa estar entre 1 e 999.";
    }
    return "Alguns valores do lembrete não são válidos.";
  }
  return message ?? "Não foi possível concluir a operação.";
}

// ---------------------------------------------------------------------------
// Criar
// ---------------------------------------------------------------------------
const createSchema = z.object({
  parentTaskId: optionalUuid,
  title: z.string().trim().min(1, "O lembrete precisa de um título.").max(300, "Título muito longo."),
  description: z.string().trim().max(10000, "Descrição muito longa.").default(""),
  priority: priority.default("medium"),
  dueDate: dueDate.default(null),
  dueTime: dueTime.default(null),
  position: z.coerce.number().default(1000),
});

export async function createPersonalTaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    parentTaskId: formData.get("parentTaskId") ?? "",
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    priority: formData.get("priority") ?? "medium",
    dueDate: formData.get("dueDate") ?? "",
    dueTime: formData.get("dueTime") ?? "",
    position: formData.get("position") ?? 1000,
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const recurrence = parseRecurrence(formData.get("recurrence"));
  const recurrenceError = recurrenceErrorFor(recurrence, parsed.data.dueDate);
  if (recurrenceError) return { error: recurrenceError };

  const user = await requireUser();
  const supabase = await createClient();

  // O id nasce aqui para as subtarefas poderem apontar para o lembrete logo
  // em seguida, sem depender de RETURNING.
  const taskId = randomUUID();

  const { error } = await supabase.from("personal_tasks").insert({
    id: taskId,
    owner_id: user.id,
    parent_task_id: parsed.data.parentTaskId,
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    due_date: parsed.data.dueDate,
    // Hora sem data é recusada pelo banco; a interface já evita, isto é a rede.
    due_time: parsed.data.dueDate ? parsed.data.dueTime : null,
    position: parsed.data.position,
    ...(recurrence && recurrence.type !== "none" ? recurrenceColumns(recurrence) : {}),
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  const avisos: string[] = [];

  const subtarefas = formData
    .getAll("subtasks")
    .map((v) => String(v).trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 30);
  if (subtarefas.length > 0) {
    const { error: erroSub } = await supabase.from("personal_tasks").insert(
      subtarefas.map((title, i) => ({
        owner_id: user.id,
        parent_task_id: taskId,
        title,
        position: (i + 1) * 1000,
      })),
    );
    if (erroSub) avisos.push("as subtarefas não puderam ser criadas");
  }

  revalidateReminders();
  return {
    success: "Lembrete criado.",
    taskId,
    warning: avisos.length ? `Lembrete criado, mas ${avisos.join(" e ")}.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Atualizar campo a campo
// ---------------------------------------------------------------------------
const patchSchema = z.object({
  taskId: uuid,
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(10000).optional(),
  priority: priority.optional(),
  is_completed: z.boolean().optional(),
});

export type PersonalTaskPatch = Omit<z.infer<typeof patchSchema>, "taskId">;

export async function patchPersonalTaskAction(
  taskId: string,
  patch: PersonalTaskPatch,
): Promise<{ error?: string }> {
  const parsed = patchSchema.safeParse({ taskId, ...patch });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const fields: PersonalTaskUpdate = {};
  if (parsed.data.title !== undefined) fields.title = parsed.data.title;
  if (parsed.data.description !== undefined) fields.description = parsed.data.description;
  if (parsed.data.priority !== undefined) fields.priority = parsed.data.priority;
  if (parsed.data.is_completed !== undefined) fields.is_completed = parsed.data.is_completed;

  if (Object.keys(fields).length === 0) return {};

  const supabase = await createClient();
  const { error } = await supabase.from("personal_tasks").update(fields).eq("id", taskId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return {};
}

/**
 * Grava prazo e repetição juntos — mesmo motivo de `setTaskScheduleAction`
 * em `actions/tasks.ts`: são um par que o banco valida em conjunto.
 */
export async function setPersonalTaskScheduleAction(
  taskId: string,
  dueDateValue: string | null,
  dueTimeValue: string | null,
  recurrence: unknown,
): Promise<{ error?: string }> {
  if (!uuid.safeParse(taskId).success) return { error: "Lembrete inválido." };

  const data = z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .safeParse(dueDateValue);
  if (!data.success) return { error: "Data inválida." };

  const hora = dueTime.safeParse(dueTimeValue);
  if (!hora.success) return { error: "Hora inválida." };

  const r = recurrenceSchema.safeParse(recurrence);
  if (!r.success) return { error: "Configuração de repetição inválida." };

  const erro = recurrenceErrorFor(r.data, data.data);
  if (erro) return { error: erro };

  const supabase = await createClient();
  const { error } = await supabase
    .from("personal_tasks")
    .update({
      due_date: data.data,
      due_time: data.data ? hora.data : null,
      ...recurrenceColumns(r.data),
    })
    .eq("id", taskId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return {};
}

export async function deletePersonalTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") ?? "");
  const supabase = await createClient();
  await supabase.from("personal_tasks").delete().eq("id", taskId);

  revalidateReminders();
}

// ---------------------------------------------------------------------------
// Subtarefas
// ---------------------------------------------------------------------------
export async function createPersonalSubtaskAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const schema = z.object({
    parentTaskId: uuid,
    title: z.string().trim().min(1, "A subtarefa precisa de um título.").max(300),
  });

  const parsed = schema.safeParse({
    parentTaskId: formData.get("parentTaskId"),
    title: formData.get("title"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from("personal_tasks").insert({
    owner_id: user.id,
    parent_task_id: parsed.data.parentTaskId,
    title: parsed.data.title,
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return {};
}

// ---------------------------------------------------------------------------
// Ações em massa
// ---------------------------------------------------------------------------
const bulkSchema = z.object({
  taskIds: z.array(uuid).min(1, "Selecione ao menos um lembrete."),
});

export async function bulkDeletePersonalTasksAction(
  taskIds: string[],
): Promise<{ error?: string; count?: number }> {
  const parsed = bulkSchema.safeParse({ taskIds });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("personal_tasks")
    .delete({ count: "exact" })
    .in("id", parsed.data.taskIds);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return { count: count ?? parsed.data.taskIds.length };
}

// ---------------------------------------------------------------------------
// Anexos (migração 0030) — mesmo padrão de `actions/attachments.ts`: o
// arquivo sobe do navegador direto para o Storage, e só os metadados passam
// por aqui.
// ---------------------------------------------------------------------------
const registerAttachmentSchema = z.object({
  taskId: uuid,
  ownerId: uuid,
  storagePath: z.string().min(1).max(512),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(255).default("application/octet-stream"),
  sizeBytes: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
});

export async function registerPersonalAttachmentAction(input: {
  taskId: string;
  ownerId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ error?: string }> {
  const parsed = registerAttachmentSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados do anexo inválidos." };

  const { taskId, ownerId, storagePath, fileName, mimeType, sizeBytes } = parsed.data;

  // O caminho precisa começar por `pessoal/{ownerId}/`: é dali que as
  // policies do Storage derivam a permissão (ver migração 0030).
  if (!storagePath.startsWith(`pessoal/${ownerId}/`)) {
    return { error: "Caminho do arquivo não corresponde a este lembrete." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("personal_task_attachments").insert({
    owner_id: ownerId,
    task_id: taskId,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return {};
}

/**
 * Remove o anexo: primeiro o arquivo, depois o registro — mesma ordem de
 * `deleteAttachmentAction`, pelo mesmo motivo (um registro órfão aparece na
 * lista e pode ser removido; um arquivo órfão no Storage, não).
 */
export async function deletePersonalAttachmentAction(
  attachmentId: string,
): Promise<{ error?: string }> {
  if (!uuid.safeParse(attachmentId).success) return { error: "Anexo inválido." };

  const supabase = await createClient();

  const { data: anexo } = await supabase
    .from("personal_task_attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();

  if (!anexo) return { error: "Anexo não encontrado." };

  const { error: erroArquivo } = await supabase.storage
    .from("anexos")
    .remove([anexo.storage_path]);

  if (erroArquivo && !erroArquivo.message.toLowerCase().includes("not found")) {
    return { error: "Não foi possível remover o arquivo." };
  }

  const { error } = await supabase
    .from("personal_task_attachments")
    .delete()
    .eq("id", attachmentId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return {};
}

export async function bulkCompletePersonalTasksAction(
  taskIds: string[],
  completed: boolean,
): Promise<{ error?: string; count?: number }> {
  const parsed = bulkSchema.safeParse({ taskIds });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("personal_tasks")
    .update({ is_completed: completed }, { count: "exact" })
    .in("id", parsed.data.taskIds);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateReminders();
  return { count: count ?? parsed.data.taskIds.length };
}
