"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";

import { deleteAttachmentAction } from "@/app/actions/attachments";
import { IconButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { uploadAttachments } from "@/lib/upload-attachment";
import { BUCKET, formatBytes, isImage } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/lib/database.types";

/** Códigos que significam "a tabela de anexos ainda não existe". */
const TABELA_AUSENTE = new Set(["42P01", "PGRST205"]);

/**
 * Anexos de uma tarefa, subtarefa ou comentário.
 *
 * O arquivo vai do navegador direto para o Supabase Storage; só os metadados
 * passam por Server Action. Mandar o arquivo pelo servidor significaria
 * carregá-lo inteiro na memória sem ganhar nada — as policies do Storage já
 * autorizam o envio.
 *
 * O bucket é privado, então cada arquivo é lido por URL assinada, gerada sob
 * demanda e de vida curta. Não existe endereço público para um anexo.
 */
export function Attachments({
  workspaceId,
  taskId,
  commentId = null,
  canWrite,
  currentUserId,
  compact = false,
  onChanged,
}: {
  workspaceId: string;
  taskId: string;
  commentId?: string | null;
  canWrite: boolean;
  currentUserId: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const inputRef = useRef<HTMLInputElement>(null);

  const [itens, setItens] = useState<Attachment[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const carregar = useCallback(async () => {
    let query = supabase
      .from("attachments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    query = commentId ? query.eq("comment_id", commentId) : query.is("comment_id", null);

    const { data, error } = await query;

    // Tabela ausente: a migração 0005 ainda não foi aplicada. Some em silêncio
    // em vez de encher a tela de erro num recurso que ainda não existe.
    //
    // São dois códigos porque vêm de camadas diferentes: `42P01` é do Postgres
    // ("relation does not exist") e `PGRST205` é do PostgREST, que responde
    // pelo cache de schema antes mesmo de consultar o banco.
    if (error) {
      if (!TABELA_AUSENTE.has(error.code)) setErro(error.message);
      return;
    }

    const lista = (data ?? []) as Attachment[];
    setItens(lista);

    // Uma assinatura por lote; imagens precisam da URL para exibir a miniatura.
    const paraAssinar = lista.filter((a) => isImage(a.mime_type));
    if (paraAssinar.length > 0) {
      const { data: assinadas } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paraAssinar.map((a) => a.storage_path), 3600);

      if (assinadas) {
        const mapa: Record<string, string> = {};
        assinadas.forEach((s, i) => {
          if (s.signedUrl) mapa[paraAssinar[i].id] = s.signedUrl;
        });
        setUrls(mapa);
      }
    }
  }, [supabase, taskId, commentId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(arquivos: FileList | File[]) {
    const lista = Array.from(arquivos);
    if (lista.length === 0) return;

    setEnviando(true);
    setErro(null);

    const erros = await uploadAttachments(
      supabase,
      { workspaceId, taskId, commentId },
      lista,
    );
    if (erros.length > 0) setErro(erros[0]);

    setEnviando(false);
    if (inputRef.current) inputRef.current.value = "";
    await carregar();
    onChanged?.();
  }

  async function baixar(anexo: Attachment) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(anexo.storage_path, 60, { download: anexo.file_name });

    if (error || !data?.signedUrl) {
      setErro("Não foi possível gerar o link do arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function remover(anexo: Attachment) {
    setItens((prev) => prev.filter((a) => a.id !== anexo.id));
    const resultado = await deleteAttachmentAction(anexo.id, workspaceId);
    if (resultado.error) {
      setErro(resultado.error);
      await carregar();
      return;
    }
    onChanged?.();
  }

  const vazio = itens.length === 0;
  if (vazio && !canWrite) return null;

  return (
    <div
      onDragOver={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        if (!canWrite) return;
        e.preventDefault();
        setArrastando(false);
        void enviar(e.dataTransfer.files);
      }}
      className={cn(
        "rounded-lg transition-colors",
        arrastando && "bg-brand-50 ring-2 ring-brand-300",
      )}
    >
      {itens.length > 0 && (
        <ul className={cn("space-y-1.5", compact && "space-y-1")}>
          {itens.map((anexo) => {
            const imagem = isImage(anexo.mime_type) ? urls[anexo.id] : null;
            const podeRemover = canWrite && anexo.uploaded_by === currentUserId;

            return (
              <li
                key={anexo.id}
                className="group flex items-center gap-2.5 rounded-lg border border-ink-200 bg-surface p-2"
              >
                {imagem ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imagem}
                    alt={anexo.file_name}
                    className="size-10 shrink-0 rounded object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded bg-ink-100 text-ink-500">
                    {isImage(anexo.mime_type) ? (
                      <ImageIcon className="size-4" aria-hidden />
                    ) : (
                      <FileText className="size-4" aria-hidden />
                    )}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {anexo.file_name}
                  </p>
                  <p className="text-xs text-ink-400">{formatBytes(anexo.size_bytes)}</p>
                </div>

                <IconButton
                  label={`Baixar ${anexo.file_name}`}
                  onClick={() => baixar(anexo)}
                  className="size-7"
                >
                  <Download className="size-3.5" />
                </IconButton>

                {podeRemover && (
                  <IconButton
                    label={`Remover ${anexo.file_name}`}
                    onClick={() => remover(anexo)}
                    className="size-7 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {erro && (
        <p role="alert" className="mt-1.5 text-xs text-rose-600">
          {erro}
        </p>
      )}

      {canWrite && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => e.target.files && void enviar(e.target.files)}
          />
          <button
            type="button"
            disabled={enviando}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium",
              "text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700",
              "disabled:pointer-events-none disabled:opacity-60",
            )}
          >
            {enviando ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Enviando…
              </>
            ) : (
              <>
                <Paperclip className="size-3.5" aria-hidden />
                {compact ? "Anexar" : "Anexar arquivo"}
              </>
            )}
          </button>
          {!compact && itens.length === 0 && !enviando && (
            <span className="ml-1 inline-flex items-center gap-1 text-xs text-ink-400">
              <Upload className="size-3" aria-hidden />
              ou arraste aqui
            </span>
          )}
        </>
      )}
    </div>
  );
}
