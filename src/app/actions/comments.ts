"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";

/**
 * `commentId` é devolvido para o campo de comentário conseguir enviar os
 * anexos logo em seguida: um anexo precisa do id do comentário ao qual
 * pertence, e ele só existe depois da inserção.
 */
export type ActionState = { error?: string; success?: string; commentId?: string };

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  taskId: z.string().uuid(),
  body: z
    .string()
    .trim()
    .min(1, "Escreva algo antes de enviar.")
    .max(5000, "Comentário muito longo (máx. 5000 caracteres)."),
});

export async function createCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    taskId: formData.get("taskId"),
    body: formData.get("body"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("comments")
    .insert({
      workspace_id: parsed.data.workspaceId,
      task_id: parsed.data.taskId,
      author_id: user.id,
      body: parsed.data.body,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Visualizadores não podem comentar neste espaço."
          : error.message,
    };
  }

  revalidatePath(`/e/${parsed.data.workspaceId}/tarefas`);
  return { commentId: data.id };
}

export async function deleteCommentAction(formData: FormData) {
  const commentId = String(formData.get("commentId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");

  const supabase = await createClient();
  await supabase.from("comments").delete().eq("id", commentId);

  revalidatePath(`/e/${workspaceId}/tarefas`);
}
