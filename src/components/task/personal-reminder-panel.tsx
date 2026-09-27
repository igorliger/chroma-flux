"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Circle, Flag, Loader2, Plus, Trash2, X } from "lucide-react";

import {
  createPersonalSubtaskAction,
  deletePersonalTaskAction,
  patchPersonalTaskAction,
  setPersonalTaskScheduleAction,
} from "@/app/actions/personal-tasks";
import { DueDateField } from "@/components/task/due-date-field";
import { PersonalAttachments } from "@/components/task/personal-attachments";
import { extractUrls } from "@/lib/links";
import { LinkPreview } from "@/components/link-preview";
import {
  recurrenceFromTask,
  recurrencePendingReason,
  type Recurrence,
} from "@/lib/recurrence";
import { Button, IconButton, Input, Select, Textarea } from "@/components/ui";
import { fireCompletionBurst } from "@/lib/completion-burst";
import { playCompletionSound } from "@/lib/completion-sound";
import { PRIORITIES, cn, priorityMeta } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { PersonalTask, PersonalTaskOverview, TaskPriority } from "@/lib/database.types";

/**
 * Painel de um lembrete pessoal — versão de `components/task/task-panel.tsx`
 * sem responsável, campos personalizados, dependências, comentários ou
 * anexos: nada disso existe para um lembrete que só o dono vê.
 */
export function PersonalReminderPanel({
  task,
  onClose,
  onChanged,
}: {
  task: PersonalTaskOverview;
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = useRef(createClient()).current;

  const [subtasks, setSubtasks] = useState<PersonalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [completed, setCompleted] = useState(task.is_completed);
  const [dueDate, setDueDate] = useState<string | null>(task.due_date);
  const [dueTime, setDueTime] = useState<string | null>(task.due_time);
  const [recurrence, setRecurrence] = useState<Recurrence>(recurrenceFromTask(task));
  const [pendencia, setPendencia] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: erroCarregar } = await supabase
      .from("personal_tasks")
      .select("*")
      .eq("parent_task_id", task.id)
      .order("position", { ascending: true });

    if (erroCarregar) {
      setError("Não foi possível carregar as subtarefas deste lembrete.");
    } else {
      setSubtasks(data as PersonalTask[]);
    }
    setLoading(false);
  }, [supabase, task.id]);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setCompleted(task.is_completed);
    setDueDate(task.due_date);
    setDueTime(task.due_time);
    setRecurrence(recurrenceFromTask(task));
    setPendencia(null);
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.title, task.description, task.is_completed, task.due_date, task.due_time, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function patch(patchFields: Parameters<typeof patchPersonalTaskAction>[1]) {
    const result = await patchPersonalTaskAction(task.id, patchFields);
    if (result.error) {
      setError(result.error);
      return false;
    }
    setError(null);
    startTransition(onChanged);
    return true;
  }

  async function salvarAgenda(
    novaData: string | null,
    novaHora: string | null,
    novaRegra: Recurrence,
  ) {
    const anterior = { data: dueDate, hora: dueTime, regra: recurrence };

    setDueDate(novaData);
    setDueTime(novaHora);
    setRecurrence(novaRegra);

    const falta = recurrencePendingReason(novaRegra, novaData);
    setPendencia(falta);
    if (falta) {
      setError(null);
      return;
    }

    const result = await setPersonalTaskScheduleAction(task.id, novaData, novaHora, novaRegra);

    if (result.error) {
      setError(result.error);
      setDueDate(anterior.data);
      setDueTime(anterior.hora);
      setRecurrence(anterior.regra);
      return;
    }
    setError(null);
    startTransition(onChanged);
  }

  async function toggleSubtask(subtask: PersonalTask, origem: { x: number; y: number }) {
    if (!subtask.is_completed) {
      playCompletionSound();
      fireCompletionBurst(origem);
    }
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, is_completed: !s.is_completed } : s)),
    );
    const result = await patchPersonalTaskAction(subtask.id, { is_completed: !subtask.is_completed });
    if (result.error) void load();
    else startTransition(onChanged);
  }

  const priority = priorityMeta(task.priority);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="relative flex h-full w-full flex-col bg-surface shadow-2xl sm:max-w-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <button
            type="button"
            onClick={async (event) => {
              const next = !completed;
              if (next) {
                playCompletionSound();
                fireCompletionBurst({ x: event.clientX, y: event.clientY });
              }
              setCompleted(next);
              const ok = await patch({ is_completed: next });
              if (!ok) setCompleted(!next);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
              completed
                ? "bg-emerald-50 text-emerald-700"
                : "bg-ink-100 text-ink-600 hover:bg-ink-200",
            )}
          >
            {completed ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <Circle className="size-4" aria-hidden />
            )}
            {completed ? "Concluído" : "Marcar como concluído"}
          </button>

          <div className="flex items-center gap-1">
            <form action={deletePersonalTaskAction} onSubmit={() => onClose()} className="contents">
              <input type="hidden" name="taskId" value={task.id} />
              <IconButton
                label="Excluir lembrete"
                type="submit"
                className="hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="size-4" />
              </IconButton>
            </form>
            <IconButton label="Fechar" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-4 py-4 sm:px-5">
          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => {
              const trimmed = title.trim();
              if (!trimmed || trimmed === task.title) {
                setTitle(task.title);
                return;
              }
              const ok = await patch({ title: trimmed });
              if (!ok) setTitle(task.title);
            }}
            rows={2}
            className="w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold leading-snug text-ink-900 transition-colors hover:border-ink-200 focus:border-brand-400"
          />

          <dl className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <dt className="flex w-32 shrink-0 items-center gap-2 text-sm text-ink-500">
                <span className="text-ink-400">
                  <Flag className="size-4" />
                </span>
                Prioridade
              </dt>
              <dd className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Select
                    value={task.priority}
                    onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                    className="h-9 max-w-40"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                  <span className={cn("size-2 rounded-full", priority.dot)} aria-hidden />
                </div>
              </dd>
            </div>
          </dl>

          <section className="mt-5 rounded-xl border border-ink-200 p-3">
            <h3 className="mb-3 text-sm font-semibold text-ink-700">Prazo e repetição</h3>
            <DueDateField
              dueDate={dueDate}
              dueTime={dueTime}
              recurrence={recurrence}
              onDueDateChange={(d) => salvarAgenda(d, d ? dueTime : null, recurrence)}
              onDueTimeChange={(h) => salvarAgenda(dueDate, h, recurrence)}
              onRecurrenceChange={(r) => salvarAgenda(dueDate, dueTime, r)}
              pending={pendencia}
              idPrefix={`lembrete-${task.id}`}
            />
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Descrição</h3>
            <Textarea
              value={description}
              rows={4}
              placeholder="Adicione mais contexto…"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={async () => {
                if (description === task.description) return;
                const ok = await patch({ description: description.trim() });
                if (!ok) setDescription(task.description);
              }}
            />

            {extractUrls(description)
              .slice(0, 3)
              .map((url) => (
                <LinkPreview key={url} url={url} />
              ))}

            <div className="mt-3">
              <PersonalAttachments
                ownerId={task.owner_id}
                taskId={task.id}
                onChanged={() => startTransition(onChanged)}
              />
            </div>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Subtarefas
              {subtasks.length > 0 && (
                <span className="ml-2 font-normal text-ink-400">
                  {subtasks.filter((s) => s.is_completed).length}/{subtasks.length}
                </span>
              )}
            </h3>

            {loading ? (
              <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
            ) : (
              <ul className="space-y-1">
                {subtasks.map((subtask) => (
                  <li key={subtask.id} className="group rounded-lg px-2 py-1.5 hover:bg-ink-50">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(event) =>
                          toggleSubtask(subtask, { x: event.clientX, y: event.clientY })
                        }
                        aria-label={
                          subtask.is_completed ? "Reabrir subtarefa" : "Concluir subtarefa"
                        }
                        className="shrink-0 text-ink-300 transition-colors hover:text-emerald-600"
                      >
                        {subtask.is_completed ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <Circle className="size-4" />
                        )}
                      </button>
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm text-ink-700",
                          subtask.is_completed && "text-ink-400 line-through",
                        )}
                      >
                        {subtask.title}
                      </span>
                      <form
                        action={deletePersonalTaskAction}
                        onSubmit={() =>
                          setSubtasks((prev) => prev.filter((s) => s.id !== subtask.id))
                        }
                      >
                        <input type="hidden" name="taskId" value={subtask.id} />
                        <IconButton
                          label="Excluir subtarefa"
                          type="submit"
                          className="size-7 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="size-3.5" />
                        </IconButton>
                      </form>
                    </div>

                    {/* Subtarefa é um lembrete: recebe anexos pelo mesmo caminho. */}
                    <div className="ml-6 mt-1">
                      <PersonalAttachments ownerId={task.owner_id} taskId={subtask.id} compact />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <AddSubtask
              parentTaskId={task.id}
              onAdded={() => {
                void load();
                startTransition(onChanged);
              }}
            />
          </section>
        </div>
      </aside>
    </div>
  );
}

function AddSubtask({
  parentTaskId,
  onAdded,
}: {
  parentTaskId: string;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    const formData = new FormData();
    formData.set("parentTaskId", parentTaskId);
    formData.set("title", trimmed);

    const result = await createPersonalSubtaskAction({}, formData);
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setTitle("");
    onAdded();
  }

  return (
    <form onSubmit={submit} className="mt-2 flex items-center gap-2">
      <Plus className="size-4 shrink-0 text-ink-400" aria-hidden />
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Adicionar subtarefa"
        maxLength={300}
        className="h-9 border-transparent bg-ink-50"
      />
      {title.trim() && (
        <Button type="submit" size="sm" loading={saving}>
          Adicionar
        </Button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </form>
  );
}
