"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import { registerAttachmentAction } from "@/app/actions/attachments";
import { BUCKET, buildStoragePath, validateFile } from "@/lib/attachments";
import type { Database } from "@/lib/database.types";

/**
 * Envia arquivos ao Storage e registra os metadados.
 *
 * Compartilhado entre o painel de anexos e o campo de comentário: os dois
 * fazem a mesma sequência de duas etapas, e ela tem um detalhe que não pode
 * divergir — se o registro falhar depois do envio, o arquivo precisa ser
 * apagado, senão fica órfão no bucket, invisível e sem dono.
 *
 * Devolve a lista de mensagens de erro; vazia significa que tudo passou.
 */
export async function uploadAttachments(
  supabase: SupabaseClient<Database>,
  destino: { workspaceId: string; taskId: string; commentId: string | null },
  arquivos: File[],
): Promise<string[]> {
  const erros: string[] = [];

  for (const arquivo of arquivos) {
    const recusa = validateFile(arquivo);
    if (recusa) {
      erros.push(recusa);
      continue;
    }

    const caminho = buildStoragePath(destino.workspaceId, destino.taskId, arquivo.name);

    const { error: erroEnvio } = await supabase.storage
      .from(BUCKET)
      .upload(caminho, arquivo, {
        contentType: arquivo.type || undefined,
        upsert: false,
      });

    if (erroEnvio) {
      erros.push(
        erroEnvio.message.toLowerCase().includes("bucket")
          ? "O armazenamento ainda não foi criado. Execute supabase/migrations/0005_attachments.sql no Supabase."
          : `Falha ao enviar “${arquivo.name}”: ${erroEnvio.message}`,
      );
      continue;
    }

    const resultado = await registerAttachmentAction({
      workspaceId: destino.workspaceId,
      taskId: destino.taskId,
      commentId: destino.commentId,
      storagePath: caminho,
      fileName: arquivo.name,
      mimeType: arquivo.type || "application/octet-stream",
      sizeBytes: arquivo.size,
    });

    if (resultado.error) {
      // O arquivo já subiu: sem esta limpeza, ficaria no bucket sem registro.
      await supabase.storage.from(BUCKET).remove([caminho]);
      erros.push(resultado.error);
    }
  }

  return erros;
}
