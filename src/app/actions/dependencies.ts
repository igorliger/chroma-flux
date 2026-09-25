"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";

export type ActionState = { error?: string; success?: string };

const uuid = z.string().uuid();

/** Telas que mostram tarefas do espaço — mesmo conjunto de `actions/tasks.ts`. */
function revalidateTasks(workspaceId: string) {
  revalidatePath(`/e/${workspaceId}/tarefas`);
  revalidatePath(`/e/${workspaceId}`);
  revalidatePath(`/e/${workspaceId}/minhas-tarefas`);
}

function friendlyError(code?: string, message?: string) {
  if (code === "42501") return "Você não tem permissão para gerenciar dependências neste espaço.";
  if (code === "23505") return "Esta dependência já existe.";
  if (code === "23514") return "Uma tarefa não pode depender de si mesma.";
  if (code === "23503") return "Tarefa inválida para esta dependência.";
  return message ?? "Não foi possível concluir a operação.";
}

const addSchema = z.object({
  workspaceId: uuid,
  taskId: uuid,
  dependsOnTaskId: uuid,
});

/**
 * Marca que `taskId` depende de `dependsOnTaskId` — ou seja, `taskId` só
 * pode ser concluída depois de `dependsOnTaskId`. Ver a checagem de bloqueio
 * em `patchTaskAction`, em `actions/tasks.ts`.
 */
export async function addDependencyAction(
  taskId: string,
  workspaceId: string,
  dependsOnTaskId: string,
): Promise<ActionState> {
  const parsed = addSchema.safeParse({ workspaceId, taskId, dependsOnTaskId });
  if (!parsed.success) return { error: "Tarefa inválida." };

  if (parsed.data.taskId === parsed.data.dependsOnTaskId) {
    return { error: "Uma tarefa não pode depender de si mesma." };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from("task_dependencies").insert({
    workspace_id: parsed.data.workspaceId,
    task_id: parsed.data.taskId,
    depends_on_task_id: parsed.data.dependsOnTaskId,
    created_by: user.id,
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(parsed.data.workspaceId);
  return { success: "Dependência adicionada." };
}

const removeSchema = z.object({
  workspaceId: uuid,
  taskId: uuid,
  dependsOnTaskId: uuid,
});

export async function removeDependencyAction(
  taskId: string,
  workspaceId: string,
  dependsOnTaskId: string,
): Promise<ActionState> {
  const parsed = removeSchema.safeParse({ workspaceId, taskId, dependsOnTaskId });
  if (!parsed.success) return { error: "Tarefa inválida." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("task_id", parsed.data.taskId)
    .eq("depends_on_task_id", parsed.data.dependsOnTaskId);

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(parsed.data.workspaceId);
  return {};
}
