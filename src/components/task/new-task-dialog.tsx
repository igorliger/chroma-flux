"use client";

import { useActionState, useEffect, useRef, useState } from "react";

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
import { DueDateField } from "@/components/task/due-date-field";
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

  // Fecha assim que a criação der certo.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setDueDate(null);
      setDueTime(null);
      setRecurrence(NO_RECURRENCE);
      onCreated();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal open={open} onClose={onClose} title={isPersonal ? "Nova tarefa particular" : "Nova tarefa"}>
      <form ref={formRef} action={formAction} className="space-y-4">
        <FormError>{state.error}</FormError>

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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsável" htmlFor="task-assignee">
            <Select
              id="task-assignee"
              name="assigneeId"
              // Em "Minhas tarefas" o responsável já vem preenchido: criar
              // uma tarefa ali e ela não aparecer na lista seria confuso.
              defaultValue={onlyAssigneeId ?? defaultAssigneeId ?? ""}
            >
              {!onlyAssigneeId && <option value="">Ninguém</option>}
              {people
                .filter((person) => !onlyAssigneeId || person.id === onlyAssigneeId)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || person.email}
                  </option>
                ))}
            </Select>
          </Field>

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

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <SubmitButton>Criar tarefa</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
