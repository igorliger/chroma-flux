"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckSquare, ListTree, MessageSquare, Repeat } from "lucide-react";

import { TaskPanel } from "@/components/task/task-panel";
import { BulkActionBar } from "@/components/task/bulk-action-bar";
import { Button, EmptyState } from "@/components/ui";
import {
  bulkCompleteTasksAction,
  bulkDeleteTasksAction,
  patchTaskAction,
} from "@/app/actions/tasks";
import { recurrenceFromTask, shortRecurrenceLabel } from "@/lib/recurrence";
import { useNow } from "@/lib/use-now";
import { cn, dueDateMeta, positionBetween, priorityMeta, responsibleIds } from "@/lib/utils";
import type { TaskPermissions } from "@/lib/permissions";
import type {
  CustomFieldDefinition,
  PersonRef,
  TaskBoardStatus,
  TaskOverview,
} from "@/lib/database.types";
import type { TaskDependencyInfo } from "@/lib/queries";

/**
 * Só duas colunas visíveis: "A fazer" reúne tudo que não está concluído,
 * incluindo o que porventura ainda esteja marcado como "doing" no banco (por
 * exemplo, uma tarefa reaberta depois de "Feito" — ver `tasks.ts`). O valor
 * "doing" continua existindo no schema; só a coluna "Fazendo" some da tela.
 */
const COLUNAS: { value: "todo" | "done"; label: string; estados: TaskBoardStatus[] }[] = [
  { value: "todo", label: "A fazer", estados: ["todo", "doing"] },
  { value: "done", label: "Feito", estados: ["done"] },
];

/**
 * Quadro Kanban de colunas fixas — ver a decisão no plano: nada de seções
 * configuráveis (o projeto já teve isso e removeu por complexidade). Arrastar
 * usa a API nativa do navegador, sem biblioteca.
 */
export function KanbanBoard({
  tasks,
  people,
  permissoes,
  currentUserId,
  workspaceId,
  customFields,
  dependenciesByTask,
  customFieldValuesByTask,
}: {
  tasks: TaskOverview[];
  people: PersonRef[];
  permissoes: TaskPermissions;
  currentUserId: string;
  workspaceId: string;
  customFields: CustomFieldDefinition[];
  dependenciesByTask: Map<string, TaskDependencyInfo>;
  customFieldValuesByTask: Map<string, Map<string, string>>;
}) {
  const router = useRouter();
  const now = useNow();
  const [, startTransition] = useTransition();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mesmo modelo de seleção em massa da lista de tarefas — ver `TaskBrowser`.
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();

  const [optimisticTasks, applyOptimistic] = useOptimistic(
    tasks,
    (
      current: TaskOverview[],
      change: { id: string; board_status: TaskBoardStatus; position: number },
    ) =>
      current.map((t) =>
        t.id === change.id
          ? {
              ...t,
              board_status: change.board_status,
              position: change.position,
              is_completed: change.board_status === "done",
            }
          : t,
      ),
  );

  const peopleById = new Map(people.map((p) => [p.id, p]));
  const openTask = optimisticTasks.find((t) => t.id === openTaskId) ?? null;
  const podeSelecionar = permissoes.edit || permissoes.delete;

  function sairDoModoSelecao() {
    setModoSelecao(false);
    setSelecionadas(new Set());
  }

  function alternarSelecao(taskId: string) {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(taskId)) proximo.delete(taskId);
      else proximo.add(taskId);
      return proximo;
    });
  }

  function handleBulkComplete(completed: boolean) {
    const ids = [...selecionadas];
    startBulkTransition(async () => {
      const result = await bulkCompleteTasksAction(workspaceId, ids, completed);
      setError(result.error ?? null);
      sairDoModoSelecao();
      router.refresh();
    });
  }

  function handleBulkDelete() {
    const ids = [...selecionadas];
    startBulkTransition(async () => {
      const result = await bulkDeleteTasksAction(workspaceId, ids);
      setError(result.error ?? null);
      sairDoModoSelecao();
      router.refresh();
    });
  }

  async function moverPara(
    taskId: string,
    novoStatus: TaskBoardStatus,
    antes?: number,
    depois?: number,
  ) {
    const novaPosicao = positionBetween(antes, depois);

    startTransition(async () => {
      applyOptimistic({ id: taskId, board_status: novoStatus, position: novaPosicao });
      const result = await patchTaskAction(taskId, workspaceId, {
        board_status: novoStatus,
        position: novaPosicao,
      });
      if (result.error) {
        setError(result.error);
        router.refresh();
      } else {
        setError(null);
        router.refresh();
      }
    });
  }

  function onDragStart(event: React.DragEvent, taskId: string) {
    event.dataTransfer.setData("text/plain", taskId);
    document.body.classList.add("dragging");
  }

  function onDragEnd() {
    document.body.classList.remove("dragging");
  }

  return (
    <div className="space-y-3">
      {podeSelecionar && !modoSelecao && optimisticTasks.length > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={() => setModoSelecao(true)}>
            <CheckSquare className="size-4" aria-hidden />
            Selecionar
          </Button>
        </div>
      )}

      {modoSelecao && (
        <BulkActionBar
          count={selecionadas.size}
          total={optimisticTasks.length}
          onToggleAll={() =>
            setSelecionadas((atual) =>
              optimisticTasks.length > 0 && optimisticTasks.every((t) => atual.has(t.id))
                ? new Set()
                : new Set(optimisticTasks.map((t) => t.id)),
            )
          }
          canEdit={permissoes.edit || permissoes.complete}
          canDelete={permissoes.delete}
          pending={bulkPending}
          onComplete={() => handleBulkComplete(true)}
          onReopen={() => handleBulkComplete(false)}
          onDelete={handleBulkDelete}
          onClear={sairDoModoSelecao}
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {COLUNAS.map((coluna) => {
          const doColuna = optimisticTasks
            .filter((t) => coluna.estados.includes(t.board_status))
            .sort((a, b) => a.position - b.position);

          return (
            <div
              key={coluna.value}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData("text/plain");
                if (!taskId) return;
                const ultima = doColuna[doColuna.length - 1];
                void moverPara(taskId, coluna.value, ultima?.position, undefined);
              }}
              className="flex min-h-40 flex-col rounded-[--radius-card] border border-ink-200 bg-ink-50/50 p-2"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-sm font-semibold text-ink-700">{coluna.label}</h3>
                <span className="text-xs text-ink-400">{doColuna.length}</span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto scrollbar-slim">
                {doColuna.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-ink-400">
                    Arraste tarefas para aqui
                  </p>
                )}

                {doColuna.map((task, index) => {
                  const responsaveis = responsibleIds(task)
                    .map((id) => peopleById.get(id))
                    .filter((p): p is NonNullable<typeof p> => !!p);
                  const priority = priorityMeta(task.priority);
                  const due = dueDateMeta(task.due_date, task.is_completed, task.due_time, now);
                  const anterior = doColuna[index - 1];

                  return (
                    <div
                      key={task.id}
                      draggable={permissoes.edit && !modoSelecao}
                      onDragStart={(e) => onDragStart(e, task.id)}
                      onDragEnd={onDragEnd}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const taskId = e.dataTransfer.getData("text/plain");
                        if (!taskId || taskId === task.id) return;
                        void moverPara(taskId, coluna.value, anterior?.position, task.position);
                      }}
                      onClick={() =>
                        modoSelecao ? alternarSelecao(task.id) : setOpenTaskId(task.id)
                      }
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 bg-surface p-2.5 shadow-sm transition-colors hover:border-brand-300",
                        permissoes.edit && !modoSelecao && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      {modoSelecao && (
                        <input
                          type="checkbox"
                          checked={selecionadas.has(task.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => alternarSelecao(task.id)}
                          aria-label={`Selecionar "${task.title}"`}
                          className="mt-0.5 size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                        />
                      )}

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-medium text-ink-800",
                            task.is_completed && "text-ink-400 line-through",
                          )}
                        >
                          {task.title}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-500">
                          {due?.overdue && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-1.5 py-0.5 font-semibold text-danger-fg">
                              <AlertTriangle className="size-3" aria-hidden />
                              Atrasado
                            </span>
                          )}
                          {shortRecurrenceLabel(recurrenceFromTask(task)) && (
                            <span className="inline-flex items-center gap-1 font-medium text-brand-600">
                              <Repeat className="size-3" aria-hidden />
                            </span>
                          )}
                          {task.subtask_count > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ListTree className="size-3" aria-hidden />
                              {task.subtask_done_count}/{task.subtask_count}
                            </span>
                          )}
                          {task.comment_count > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="size-3" aria-hidden />
                              {task.comment_count}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-center justify-between">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              priority.chip,
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", priority.dot)} aria-hidden />
                          </span>
                          {responsaveis.length > 0 && (
                            <span className="flex -space-x-1">
                              {responsaveis.slice(0, 3).map((pessoa) => (
                                <span
                                  key={pessoa.id}
                                  title={pessoa.full_name || pessoa.email}
                                  className="inline-flex size-5 items-center justify-center rounded-full bg-ink-200 text-[9px] font-semibold text-ink-700 ring-2 ring-surface"
                                >
                                  {(pessoa.full_name || pessoa.email).slice(0, 1).toUpperCase()}
                                </span>
                              ))}
                              {responsaveis.length > 3 && (
                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-ink-200 text-[9px] font-semibold text-ink-700 ring-2 ring-surface">
                                  +{responsaveis.length - 3}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {optimisticTasks.length === 0 && (
        <EmptyState
          title="Nenhuma tarefa por aqui"
          description="Crie tarefas em “Tarefas” para vê-las no quadro."
        />
      )}

      {openTask && (
        <TaskPanel
          task={openTask}
          workspaceId={workspaceId}
          people={people}
          permissoes={permissoes}
          currentUserId={currentUserId}
          allTasks={optimisticTasks}
          customFields={customFields}
          customFieldValues={customFieldValuesByTask.get(openTask.id)}
          dependencies={dependenciesByTask.get(openTask.id)}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
