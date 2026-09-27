"use client";

import { AlertTriangle, CheckCircle2, Circle, ListTree, Repeat } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { recurrenceFromTask, shortRecurrenceLabel } from "@/lib/recurrence";
import { useNow } from "@/lib/use-now";
import { cn, dueDateMeta, priorityMeta } from "@/lib/utils";
import type { PersonalTaskOverview } from "@/lib/database.types";

/**
 * Lista de lembretes pessoais — versão de `components/task/task-list.tsx`
 * sem responsável/avatar (só há um dono, que é quem está olhando) e sem
 * contagem de comentários (lembrete não tem).
 */
export function PersonalReminderList({
  tasks,
  onOpenTask,
  onToggleTask,
  emptyTitle = "Nenhum lembrete por aqui",
  emptyDescription = "Ajuste os filtros ou crie um novo lembrete.",
  selectable = false,
  selectedIds,
  onToggleSelect,
}: {
  tasks: PersonalTaskOverview[];
  onOpenTask: (task: PersonalTaskOverview) => void;
  onToggleTask: (task: PersonalTaskOverview, origem: { x: number; y: number }) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
}) {
  const now = useNow();

  if (tasks.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <ul className="divide-y divide-ink-100 overflow-hidden rounded-[--radius-card] border border-ink-200 bg-surface">
      {tasks.map((task) => {
        const priority = priorityMeta(task.priority);
        const due = dueDateMeta(task.due_date, task.is_completed, task.due_time, now);

        return (
          <li key={task.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpenTask(task)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenTask(task);
                }
              }}
              className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-ink-50 sm:px-4"
            >
              {selectable && (
                <input
                  type="checkbox"
                  checked={selectedIds?.has(task.id) ?? false}
                  onClick={(event) => event.stopPropagation()}
                  onChange={() => onToggleSelect?.(task.id)}
                  aria-label={`Selecionar "${task.title}"`}
                  className="size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                />
              )}

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleTask(task, { x: event.clientX, y: event.clientY });
                }}
                aria-label={task.is_completed ? "Reabrir lembrete" : "Concluir lembrete"}
                className="shrink-0 text-ink-300 transition-colors hover:text-emerald-600"
              >
                {task.is_completed ? (
                  <CheckCircle2 className="size-5 text-emerald-600" />
                ) : (
                  <Circle className="size-5" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      task.is_completed
                        ? "text-ink-400 line-through"
                        : due?.overdue
                          ? "text-danger-fg"
                          : "text-ink-800",
                    )}
                  >
                    {task.title}
                  </p>
                  {due?.overdue && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger-fg">
                      <AlertTriangle className="size-3" aria-hidden />
                      Atrasado
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-500">
                  {shortRecurrenceLabel(recurrenceFromTask(task)) && (
                    <span className="inline-flex items-center gap-1 font-medium text-brand-600">
                      <Repeat className="size-3.5" aria-hidden />
                      {shortRecurrenceLabel(recurrenceFromTask(task))}
                    </span>
                  )}
                  {task.subtask_count > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <ListTree className="size-3.5" aria-hidden />
                      {task.subtask_done_count}/{task.subtask_count}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {due && (
                  <span
                    className={cn(
                      "hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline",
                      due.className,
                    )}
                  >
                    {due.label}
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    priority.chip,
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", priority.dot)} aria-hidden />
                  <span className="hidden sm:inline">{priority.label}</span>
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
