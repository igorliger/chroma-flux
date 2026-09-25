"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; success?: string };

const uuid = z.string().uuid();

function revalidateTasks(workspaceId: string) {
  revalidatePath(`/e/${workspaceId}/tarefas`);
  revalidatePath(`/e/${workspaceId}`);
  revalidatePath(`/e/${workspaceId}/minhas-tarefas`);
  revalidatePath(`/e/${workspaceId}/configuracoes`);
}

function friendlyError(code?: string, message?: string) {
  if (code === "42501") return "Você não tem permissão para gerenciar campos personalizados.";
  if (code === "23505") return "Já existe um campo com este nome neste espaço.";
  return message ?? "Não foi possível concluir a operação.";
}

// ---------------------------------------------------------------------------
// Criar campo
// ---------------------------------------------------------------------------
const createSchema = z.object({
  workspaceId: uuid,
  name: z.string().trim().min(1, "Dê um nome ao campo.").max(60, "Nome muito longo."),
  type: z.enum(["text", "number", "date", "select"]),
  // Uma opção por linha, vindas de um textarea — vazio para os outros tipos.
  optionsRaw: z.string().default(""),
});

export async function createCustomFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
    type: formData.get("type"),
    optionsRaw: formData.get("optionsRaw") ?? "",
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const options =
    parsed.data.type === "select"
      ? parsed.data.optionsRaw
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean)
      : [];

  if (parsed.data.type === "select" && options.length === 0) {
    return { error: "Uma lista de opções precisa de pelo menos uma opção." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("custom_field_definitions").insert({
    workspace_id: parsed.data.workspaceId,
    name: parsed.data.name,
    type: parsed.data.type,
    options,
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(parsed.data.workspaceId);
  return { success: "Campo criado." };
}

// ---------------------------------------------------------------------------
// Excluir campo
// ---------------------------------------------------------------------------
export async function deleteCustomFieldAction(formData: FormData) {
  const fieldId = String(formData.get("fieldId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");

  const supabase = await createClient();
  await supabase.from("custom_field_definitions").delete().eq("id", fieldId);

  revalidateTasks(workspaceId);
}

// ---------------------------------------------------------------------------
// Preencher valor numa tarefa
// ---------------------------------------------------------------------------
const setValueSchema = z.object({
  workspaceId: uuid,
  taskId: uuid,
  fieldId: uuid,
  value: z.string().max(2000).nullable(),
});

/**
 * Grava (ou limpa, com `value: null`) o valor de um campo personalizado numa
 * tarefa. Chamada direto de client component, como `patchTaskAction`.
 */
export async function setCustomFieldValueAction(
  taskId: string,
  workspaceId: string,
  fieldId: string,
  value: string | null,
): Promise<ActionState> {
  const parsed = setValueSchema.safeParse({ workspaceId, taskId, fieldId, value });
  if (!parsed.success) return { error: "Valor inválido." };

  const supabase = await createClient();

  const valorLimpo = parsed.data.value?.trim();

  if (!valorLimpo) {
    // Sem valor: remove a linha em vez de guardar string vazia — mantém a
    // tabela só com o que foi de fato preenchido.
    const { error } = await supabase
      .from("custom_field_values")
      .delete()
      .eq("task_id", parsed.data.taskId)
      .eq("field_id", parsed.data.fieldId);

    if (error) return { error: friendlyError(error.code, error.message) };
    revalidateTasks(parsed.data.workspaceId);
    return {};
  }

  const { error } = await supabase.from("custom_field_values").upsert({
    workspace_id: parsed.data.workspaceId,
    task_id: parsed.data.taskId,
    field_id: parsed.data.fieldId,
    value: valorLimpo,
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: friendlyError(error.code, error.message) };

  revalidateTasks(parsed.data.workspaceId);
  return {};
}
