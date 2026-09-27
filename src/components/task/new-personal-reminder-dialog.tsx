"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

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
import { NO_RECURRENCE, type Recurrence } from "@/lib/recurrence";
import { PRIORITIES } from "@/lib/utils";

/**
 * Diálogo de novo lembrete pessoal — versão de
 * `components/task/new-task-dialog.tsx` sem responsável, comentário nem
 * anexos: um lembrete é só da pessoa que o cria, e não tem esse aparato de
 * trabalho em equipe.
 */
export function NewPersonalReminderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createPersonalTaskAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<Recurrence>(NO_RECURRENCE);
  const [subtarefas, setSubtarefas] = useState<string[]>([]);

  function limpar() {
    formRef.current?.reset();
    setDueDate(null);
    setDueTime(null);
    setRecurrence(NO_RECURRENCE);
    setSubtarefas([]);
  }

  function fechar() {
    onClose();
  }

  useEffect(() => {
    if (!state.success) return;
    limpar();
    onCreated();
    fechar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal open={open} onClose={fechar} title="Novo lembrete">
      <form ref={formRef} action={formAction} className="space-y-4">
        <FormError>{state.error}</FormError>

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

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={fechar}>
            Cancelar
          </Button>
          <SubmitButton>Criar lembrete</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
