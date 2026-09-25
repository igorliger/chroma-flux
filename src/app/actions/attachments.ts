"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";
import { MAX_ATTACHMENT_BYTES } from "@/lib/attachments";

export type AttachmentResult = { error?: string };

const uuid = z.string().uuid();

const registerSchema = z.object({
  workspaceId: uuid,
  taskId: uuid,
  commentId: z.union([uuid, z.null()]),
  storagePath: z.string().min(1).max(512),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().max(255).default("application/octet-stream"),
  sizeBytes: z.number().int().min(0).max(MAX_ATTACHMENT_BYTES),
});

/**
 * Registra os metadados de um arquivo já enviado ao Storage.
 *
 * O envio em si acontece no navegador, direto para o Supabase — passar o
 * arquivo por uma Server Action significaria carregá-lo inteiro na memória do
 * servidor sem necessidade. As policies do Storage protegem o envio, e esta
 * ação registra o que foi enviado.
 *
 * O caminho é validado contra o workspace informado: sem isso alguém poderia
 * registrar um arquivo de outro espaço apontando para o seu.
 */
export async function registerAttachmentAction(input: {
  workspaceId: string;
  taskId: string;
  commentId: string | null;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<AttachmentResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados do anexo inválidos." };

  const { workspaceId, taskId, commentId, storagePath, fileName, mimeType, sizeBytes } =
    parsed.data;

  // O caminho precisa começar pelo workspace: é dele que as policies do
  // Storage derivam a permissão, então divergir aqui criaria um registro
  // apontando para um arquivo que o usuário não poderia ler.
  if (!storagePath.startsWith(`${workspaceId}/`)) {
    return { error: "Caminho do arquivo não corresponde ao espaço de trabalho." };
  }

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from("attachments").insert({
    workspace_id: workspaceId,
    task_id: taskId,
    comment_id: commentId,
    storage_path: storagePath,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    uploaded_by: user.id,
  });

  if (error) {
    // `42P01` vem do Postgres; `PGRST205`, do cache de schema do PostgREST.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return {
        error:
          "O banco ainda não tem o recurso de anexos. " +
          "Execute supabase/migrations/0005_attachments.sql no SQL Editor do Supabase.",
      };
    }
    if (error.code === "42501") {
      return { error: "Você não tem permissão para anexar arquivos neste espaço." };
    }
    return { error: error.message };
  }

  revalidatePath(`/e/${workspaceId}`, "layout");
  return {};
}

/**
 * Remove o anexo: primeiro o arquivo, depois o registro.
 *
 * Nesta ordem porque a falha que sobra é a menos ruim. Se o arquivo sumir e o
 * registro ficar, aparece um item quebrado na lista, visível e removível. Na
 * ordem inversa, o arquivo ficaria órfão no Storage — invisível, ocupando
 * espaço e sem ninguém para apagá-lo.
 */
export async function deleteAttachmentAction(
  attachmentId: string,
  workspaceId: string,
): Promise<AttachmentResult> {
  if (!uuid.safeParse(attachmentId).success || !uuid.safeParse(workspaceId).success) {
    return { error: "Anexo inválido." };
  }

  const supabase = await createClient();

  const { data: anexo } = await supabase
    .from("attachments")
    .select("storage_path")
    .eq("id", attachmentId)
    .maybeSingle();

  if (!anexo) return { error: "Anexo não encontrado." };

  const { error: erroArquivo } = await supabase.storage
    .from("anexos")
    .remove([anexo.storage_path]);

  // Um arquivo já ausente não impede limpar o registro.
  if (erroArquivo && !erroArquivo.message.toLowerCase().includes("not found")) {
    return { error: "Não foi possível remover o arquivo." };
  }

  const { error } = await supabase.from("attachments").delete().eq("id", attachmentId);
  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Só quem enviou o anexo, ou um administrador, pode removê-lo."
          : error.message,
    };
  }

  revalidatePath(`/e/${workspaceId}`, "layout");
  return {};
}
