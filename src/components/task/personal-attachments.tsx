"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";

import { deletePersonalAttachmentAction } from "@/app/actions/personal-tasks";
import { IconButton } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { uploadPersonalAttachments } from "@/lib/upload-attachment";
import { BUCKET, formatBytes, isImage } from "@/lib/attachments";
import { cn } from "@/lib/utils";
import type { PersonalTaskAttachment } from "@/lib/database.types";

/**
 * Anexos de um lembrete pessoal — versão de `components/task/attachments.tsx`
 * sem `canWrite`/`currentUserId`: quem chega até aqui já é o dono (a RLS de
 * `personal_task_attachments` garante isso), então pode sempre anexar e
 * remover.
 */
export function PersonalAttachments({
  ownerId,
  taskId,
  compact = false,
  onChanged,
}: {
  ownerId: string;
  taskId: string;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const inputRef = useRef<HTMLInputElement>(null);

  const [itens, setItens] = useState<PersonalTaskAttachment[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("personal_task_attachments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) {
      setErro(error.message);
      return;
    }

    const lista = (data ?? []) as PersonalTaskAttachment[];
    setItens(lista);

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
  }, [supabase, taskId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(arquivos: FileList | File[]) {
    const lista = Array.from(arquivos);
    if (lista.length === 0) return;

    setEnviando(true);
    setErro(null);

    const erros = await uploadPersonalAttachments(supabase, { ownerId, taskId }, lista);
    if (erros.length > 0) setErro(erros[0]);

    setEnviando(false);
    if (inputRef.current) inputRef.current.value = "";
    await carregar();
    onChanged?.();
  }

  async function baixar(anexo: PersonalTaskAttachment) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(anexo.storage_path, 60, { download: anexo.file_name });

    if (error || !data?.signedUrl) {
      setErro("Não foi possível gerar o link do arquivo.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function remover(anexo: PersonalTaskAttachment) {
    setItens((prev) => prev.filter((a) => a.id !== anexo.id));
    const resultado = await deletePersonalAttachmentAction(anexo.id);
    if (resultado.error) {
      setErro(resultado.error);
      await carregar();
      return;
    }
    onChanged?.();
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
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
                  <p className="truncate text-sm font-medium text-ink-800">{anexo.file_name}</p>
                  <p className="text-xs text-ink-400">{formatBytes(anexo.size_bytes)}</p>
                </div>

                <IconButton
                  label={`Baixar ${anexo.file_name}`}
                  onClick={() => baixar(anexo)}
                  className="size-7"
                >
                  <Download className="size-3.5" />
                </IconButton>

                <IconButton
                  label={`Remover ${anexo.file_name}`}
                  onClick={() => remover(anexo)}
                  className="size-7 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-3.5" />
                </IconButton>
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
    </div>
  );
}
