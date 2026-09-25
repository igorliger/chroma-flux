"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Paperclip, Plus, X } from "lucide-react";

import { createTaskAction, type ActionState } from "@/app/actions/tasks";
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
import { AssigneePicker } from "@/components/task/assignee-picker";
import { DueDateField } from "@/components/task/due-date-field";
import { formatBytes, validateFile } from "@/lib/attachments";
import { createClient } from "@/lib/supabase/client";
import { uploadAttachments } from "@/lib/upload-attachment";
import { NO_RECURRENCE, type Recurrence } from "@/lib/recurrence";
import { PRIORITIES } from "@/lib/utils";
import type { PersonRef } from "@/lib/database.types";

/**
 * Diálogo de nova tarefa.
 *
 * As tarefas pertencem ao espaço de trabalho e formam uma lista única. O que
 * as organiza é responsável, prioridade e prazo — não há etapa a escolher.
 */
export function NewTaskDialog({
  open,
  onClose,
  onCreated,
  workspaceId,
  people,
  defaultAssigneeId,
  onlyAssigneeId,
  currentUserId,
  isPersonal = false,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  workspaceId: string;
  people: PersonRef[];
  defaultAssigneeId?: string | null;
  /**
   * Quando definido, a pessoa só pode criar tarefa para si mesma (sem a
   * permissão "Atribuir tarefas a outras pessoas"): o responsável fica
   * travado nela. O banco recusa qualquer outro valor de todo jeito.
   */
  onlyAssigneeId?: string;
  /** Quem está criando — marcado como "(você)" na lista de responsáveis. */
  currentUserId: string;
  /** Nasce na lista pessoal de quem cria, fora do trabalho do espaço. */
  isPersonal?: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createTaskAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Prazo e repetição vivem em estado: são controles interligados, e o campo
  // de repetição precisa reagir à data escolhida.
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence>(NO_RECURRENCE);

  // Extras da criação: subtarefas, anexos (o comentário é um campo comum).
  const [subtarefas, setSubtarefas] = useState<string[]>([]);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const responsaveisIniciais = () => {
    const id = onlyAssigneeId ?? defaultAssigneeId;
    return id ? [id] : [];
  };
  const [responsaveis, setResponsaveis] = useState<string[]>(responsaveisIniciais);
  const inputArquivo = useRef<HTMLInputElement>(null);

  function limpar() {
    formRef.current?.reset();
    setDueDate(null);
    setDueTime(null);
    setRecurrence(NO_RECURRENCE);
    setSubtarefas([]);
    setArquivos([]);
    setErroArquivo(null);
    setResponsaveis(responsaveisIniciais());
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

  // Criou: sobe os anexos (do navegador, como no painel da tarefa) e fecha.
  // Se algo não entrou, a janela fica aberta dizendo o quê.
  useEffect(() => {
    if (!state.success || !state.taskId) return;
    const taskId = state.taskId;
    const pendentes = arquivos;

    (async () => {
      const problemas: string[] = state.warning ? [state.warning] : [];
      if (pendentes.length > 0) {
        setEnviando(true);
        const erros = await uploadAttachments(
          createClient(),
          { workspaceId, taskId, commentId: null },
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
    <Modal open={open} onClose={fechar} title={isPersonal ? "Nova tarefa particular" : "Nova tarefa"}>
      <form ref={formRef} action={formAction} className="space-y-4">
        <FormError>{state.error}</FormError>
        {aviso && (
          <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">{aviso}</p>
        )}

        <input type="hidden" name="workspaceId" value={workspaceId} />
        {isPersonal && <input type="hidden" name="isPersonal" value="true" />}

        <Field label="Título" htmlFor="task-title">
          <Input
            id="task-title"
            name="title"
            placeholder="O que precisa ser feito?"
            maxLength={300}
            required
            autoFocus
          />
        </Field>

        <Field label="Descrição" htmlFor="task-description" hint="Opcional.">
          <Textarea
            id="task-description"
            name="description"
            rows={3}
            placeholder="Detalhes, links, critérios de aceite…"
          />
        </Field>

        {!isPersonal && (
          <Field label="Responsáveis" hint="Marque uma ou mais pessoas — ou Todos.">
            {/* O primeiro marcado é o principal; os demais, outros responsáveis. */}
            <input type="hidden" name="assigneeId" value={responsaveis[0] ?? ""} />
            {responsaveis.slice(1).map((id) => (
              <input key={id} type="hidden" name="coAssigneeIds" value={id} />
            ))}
            <div className="max-h-56 overflow-y-auto rounded-lg border border-ink-200 p-1">
              <AssigneePicker
                people={people}
                selecionados={responsaveis}
                onChange={setResponsaveis}
                currentUserId={currentUserId}
                podeOutros={!onlyAssigneeId}
              />
            </div>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prioridade" htmlFor="task-priority">
            <Select id="task-priority" name="priority" defaultValue="medium">
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
            idPrefix="nova-tarefa"
          />
        </Field>

        {/* Subtarefas */}
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
                    // Enter cria a próxima, em vez de enviar o formulário.
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

        {/* Comentário */}
        <Field label="Comentário" htmlFor="task-comment" hint="Opcional — aparece como o primeiro comentário da tarefa.">
          <Textarea
            id="task-comment"
            name="comment"
            rows={2}
            maxLength={10000}
            placeholder="Algum recado para quem vai fazer?"
          />
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
                {enviando ? "Enviando anexos…" : "Criar tarefa"}
              </SubmitButton>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
