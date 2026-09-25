"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Plus } from "lucide-react";

import { FilterBar } from "@/components/filters/filter-bar";
import { TaskList } from "@/components/task/task-list";
import { TaskPanel } from "@/components/task/task-panel";
import { NewTaskDialog } from "@/components/task/new-task-dialog";
import { Button } from "@/components/ui";
import { patchTaskAction } from "@/app/actions/tasks";
import { fireCompletionBurst } from "@/lib/completion-burst";
import { playCompletionSound } from "@/lib/completion-sound";
import { EMPTY_FILTERS, applyFilters, sortByUrgency, type TaskFilters } from "@/lib/filters";
import type { TaskPermissions } from "@/lib/permissions";
import type {
  CustomFieldDefinition,
  PersonRef,
  TaskOverview,
} from "@/lib/database.types";
import type { TaskDependencyInfo } from "@/lib/queries";

/**
 * Lista de tarefas com busca e filtros — usada em "Tarefas" e em
 * "Minhas tarefas", que só diferem no recorte inicial.
 */
export function TaskBrowser({
  tasks,
  people,
  permissoes,
  currentUserId,
  workspaceId,
  initialFilters = EMPTY_FILTERS,
  emptyTitle,
  emptyDescription,
  allowCreate = false,
  assignToMeByDefault = false,
  createPersonal = false,
  customFields = [],
  dependenciesByTask,
  customFieldValuesByTask,
}: {
  tasks: TaskOverview[];
  people: PersonRef[];
  permissoes: TaskPermissions;
  currentUserId: string;
  workspaceId: string;
  initialFilters?: TaskFilters;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Mostra o botão de criar tarefa, para as telas onde criar faz sentido. */
  allowCreate?: boolean;
  /** Preenche o responsável com quem está criando. */
  assignToMeByDefault?: boolean;
  /** O que for criado aqui nasce como tarefa particular de quem criou. */
  createPersonal?: boolean;
  /** Campos personalizados definidos para o espaço. */
  customFields?: CustomFieldDefinition[];
  /** Dependências de cada tarefa, já resolvidas — ver `listTaskDependencies`. */
  dependenciesByTask?: Map<string, TaskDependencyInfo>;
  /** Valores dos campos personalizados por tarefa — ver `listCustomFieldValues`. */
  customFieldValuesByTask?: Map<string, Map<string, string>>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [filters, setFilters] = useState<TaskFilters>(initialFilters);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [novaTarefaAberta, setNovaTarefaAberta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [optimisticTasks, applyOptimistic] = useOptimistic(
    tasks,
    (current: TaskOverview[], change: { id: string; completed: boolean }) =>
      current.map((task) =>
        task.id === change.id ? { ...task, is_completed: change.completed } : task,
      ),
  );

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const visibleTasks = useMemo(
    () => sortByUrgency(applyFilters(optimisticTasks, filters)),
    [optimisticTasks, filters],
  );

  const openTask = optimisticTasks.find((t) => t.id === openTaskId) ?? null;

  function handleToggle(task: TaskOverview, origem: { x: number; y: number }) {
    // Fora da transição, de propósito: o navegador só libera áudio dentro do
    // gesto que o pediu, e reabrir uma tarefa não é conclusão nenhuma.
    if (!task.is_completed) {
      playCompletionSound();
      fireCompletionBurst(origem);
    }

    startTransition(async () => {
      applyOptimistic({ id: task.id, completed: !task.is_completed });
      const result = await patchTaskAction(task.id, workspaceId, {
        is_completed: !task.is_completed,
      });
      setError(result.error ?? null);
      // Concluir uma tarefa repetida gera a próxima: só o servidor sabe disso.
      if (!result.error) router.refresh();
    });
  }

  const podeCriar = allowCreate && permissoes.create;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* A base acompanha o piso da busca (`min-w-48`). Com `flex-1` puro a
            base era zero: a linha nunca quebrava, a busca não cedia abaixo do
            piso e acabava por baixo do botão quando o conteúdo estreitava —
            com o menu fixo num celular, por exemplo. */}
        <div className="flex-1 basis-48">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            people={people}
            resultCount={visibleTasks.length}
            totalCount={optimisticTasks.length}
          />
        </div>

        {podeCriar && (
          <Button onClick={() => setNovaTarefaAberta(true)} className="shrink-0">
            <Plus className="size-4" aria-hidden />
            Nova tarefa
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}

      <TaskList
        tasks={visibleTasks}
        peopleById={peopleById}
        canComplete={permissoes.complete}
        onOpenTask={(task) => setOpenTaskId(task.id)}
        onToggleTask={handleToggle}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />

      {podeCriar && (
        <NewTaskDialog
          open={novaTarefaAberta}
          onClose={() => setNovaTarefaAberta(false)}
          onCreated={() => router.refresh()}
          workspaceId={workspaceId}
          people={people}
          defaultAssigneeId={assignToMeByDefault || createPersonal ? currentUserId : null}
          isPersonal={createPersonal}
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
          customFieldValues={customFieldValuesByTask?.get(openTask.id)}
          dependencies={dependenciesByTask?.get(openTask.id)}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
