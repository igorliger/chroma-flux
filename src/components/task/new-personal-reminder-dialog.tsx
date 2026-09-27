"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Paperclip, Plus, X } from "lucide-react";

import { createPersonalTaskAction, type ActionState } from "@/app/actions/personal-tasks";
import {
  Button,
  Field,
  FormError,
  Input,
  Modal,
  Select,
  SubmitButton,
  Textarea,
} from "@/components/ui";
import { DueDateField } from "@/components/task/due-date-field";
import { formatBytes, validateFile } from "@/lib/attachments";
import { createClient } from "@/lib/supabase/client";
import { uploadPersonalAttachments } from "@/lib/upload-attachment";
import { NO_RECURRENCE, type Recurrence } from "@/lib/recurrence";
import { PRIORITIES } from "@/lib/utils";

/**
 * Diálogo de novo lembrete pessoal — versão de
 * `components/task/new-task-dialog.tsx` sem responsável nem comentário: um
 * lembrete é só da pessoa que o cria, e responsável não faz sentido aqui.
 * Anexos continuam (migração 0030), pelo mesmo caminho de dois passos do
 * diálogo de tarefa: o arquivo só sobe depois que o lembrete existe.
 */
export function NewPersonalReminderDialog({
  open,
  onClose,
  onCreated,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Dono do lembrete — é para a pasta dele que os anexos sobem. */
  currentUserId: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createPersonalTaskAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence>(NO_RECURRENCE);
  const [subtarefas, setSubtarefas] = useState<string[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  function limpar() {
    formRef.current?.reset();
    setDueDate(null);
    setDueTime(null);
    setRecurrence(NO_RECURRENCE);
    setSubtarefas([]);
    setArquivos([]);
    setErroArquivo(null);
  }

  function fechar() {
    setAviso(null);
    onClose();
  }

  function escolherArquivos(lista: FileList | null) {
    if (!lista) return;
    const novos: File[] = [];
    for (const arquivo of Array.from(lista)) {
      const recusa = validateFile(arquivo);
      if (recusa) setErroArquivo(recusa);
      else novos.push(arquivo);
    }
    setArquivos((atual) => [...atual, ...novos]);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }

  // Criou: sobe os anexos e fecha. Se algum não entrou, a janela fica aberta
  // dizendo o quê — mesmo comportamento de `NewTaskDialog`.
  useEffect(() => {
    if (!state.success || !state.taskId) return;
    const taskId = state.taskId;
    const pendentes = arquivos;

    (async () => {
      const problemas: string[] = state.warning ? [state.warning] : [];
      if (pendentes.length > 0) {
        setEnviando(true);
        const erros = await uploadPersonalAttachments(
          createClient(),
          { ownerId: currentUserId, taskId },
          pendentes,
        );
        setEnviando(false);
        if (erros.length) problemas.push(`Anexos: ${erros.join(" ")}`);
      }

      limpar();
      onCreated();
      if (problemas.length) setAviso(problemas.join(" "));
      else fechar();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal open={open} onClose={fechar} title="Novo lembrete">
      <form ref={formRef} action={formAction} className="space-y-4">
        <FormError>{state.error}</FormError>
        {aviso && (
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">{aviso}</p>
        )}

        <Field label="Título" htmlFor="reminder-title">
          <Input
            id="reminder-title"
            name="title"
            placeholder="O que você precisa lembrar?"
            maxLength={300}
            required
            autoFocus
          />
        </Field>

        <Field label="Descrição" htmlFor="reminder-description" hint="Opcional.">
          <Textarea
            id="reminder-description"
            name="description"
            rows={3}
            placeholder="Detalhes, links…"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prioridade" htmlFor="reminder-priority">
            <Select id="reminder-priority" name="priority" defaultValue="medium">
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Prazo e repetição">
          <input type="hidden" name="dueDate" value={dueDate ?? ""} />
          <input type="hidden" name="dueTime" value={dueTime ?? ""} />
          <input type="hidden" name="recurrence" value={JSON.stringify(recurrence)} />
          <DueDateField
            dueDate={dueDate}
            dueTime={dueTime}
            recurrence={recurrence}
            onDueDateChange={setDueDate}
            onDueTimeChange={setDueTime}
            onRecurrenceChange={setRecurrence}
            idPrefix="novo-lembrete"
          />
        </Field>

        <Field label="Subtarefas" hint="Opcional.">
          <div className="space-y-2">
            {subtarefas.map((titulo, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  name="subtasks"
                  value={titulo}
                  maxLength={300}
                  placeholder={`Subtarefa ${i + 1}`}
                  aria-label={`Subtarefa ${i + 1}`}
                  autoFocus={i === subtarefas.length - 1 && titulo === ""}
                  onChange={(e) =>
                    setSubtarefas((atual) => atual.map((t, j) => (j === i ? e.target.value : t)))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (titulo.trim()) setSubtarefas((atual) => [...atual, ""]);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setSubtarefas((atual) => atual.filter((_, j) => j !== i))}
                  aria-label={`Remover subtarefa ${i + 1}`}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSubtarefas((atual) => [...atual, ""])}
            >
              <Plus className="size-4" aria-hidden />
              Adicionar subtarefa
            </Button>
          </div>
        </Field>

        {/* Anexos */}
        <Field label="Anexos" hint="Opcional. Até 3 MB por arquivo.">
          <div className="space-y-2">
            {arquivos.length > 0 && (
              <ul className="space-y-1">
                {arquivos.map((arquivo, i) => (
                  <li
                    key={`${arquivo.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-1.5 text-sm text-ink-700"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
                    <span className="shrink-0 text-xs text-ink-400">{formatBytes(arquivo.size)}</span>
                    <button
                      type="button"
                      onClick={() => setArquivos((atual) => atual.filter((_, j) => j !== i))}
                      aria-label={`Remover ${arquivo.name}`}
                      className="rounded p-0.5 text-ink-400 hover:text-ink-700"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={inputArquivo}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                setErroArquivo(null);
                escolherArquivos(e.target.files);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => inputArquivo.current?.click()}
            >
              <Paperclip className="size-4" aria-hidden />
              Anexar arquivo
            </Button>
            {erroArquivo && <p className="text-xs text-danger-fg">{erroArquivo}</p>}
          </div>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          {aviso ? (
            <Button type="button" onClick={fechar}>
              Fechar
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={fechar} disabled={enviando}>
                Cancelar
              </Button>
              <SubmitButton loading={enviando}>
                {enviando ? "Enviando anexos…" : "Criar lembrete"}
              </SubmitButton>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
