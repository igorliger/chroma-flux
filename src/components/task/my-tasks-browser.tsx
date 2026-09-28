"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CheckSquare, Plus } from "lucide-react";

import { FilterBar } from "@/components/filters/filter-bar";
import { TaskList } from "@/components/task/task-list";
import { TaskPanel } from "@/components/task/task-panel";
import { PersonalReminderPanel } from "@/components/task/personal-reminder-panel";
import { NewUnifiedTaskDialog, type UnifiedSpace } from "@/components/task/new-unified-task-dialog";
import { BulkActionBar } from "@/components/task/bulk-action-bar";
import { Button } from "@/components/ui";
import { bulkCompleteTasksAction, bulkDeleteTasksAction, patchTaskAction } from "@/app/actions/tasks";
import {
  bulkCompletePersonalTasksAction,
  bulkDeletePersonalTasksAction,
  patchPersonalTaskAction,
} from "@/app/actions/personal-tasks";
import { fireCompletionBurst } from "@/lib/completion-burst";
import { playCompletionSound } from "@/lib/completion-sound";
import { isDoneFor, isResponsible, isSharedTask } from "@/lib/utils";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  applyFilters,
  isSortOrder,
  sortTasks,
  type SortOrder,
  type TaskFilters,
} from "@/lib/filters";
import type { UnifiedTask } from "@/lib/unified-tasks";
import type { PersonRef, TaskOverview } from "@/lib/database.types";

const SORT_STORAGE_KEY = "chroma-flux:ordem-minhas-tarefas";

/**
 * "Minhas tarefas" numa lista só — tarefas de qualquer espaço e lembretes
 * pessoais juntos, com a mesma busca/filtro/ordenação de sempre
 * (`lib/filters.ts`, `TaskList`, inalterados). O que muda daqui pra
 * `components/workspace/task-browser.tsx` é só o despacho: cada item carrega
 * de onde veio (`origem`), e é isso que decide pra qual ação mandar a
 * mudança e qual painel abrir.
 */
export function MyTasksBrowser({
  tasks,
  currentUserId,
  perfil,
  spaces,
}: {
  tasks: UnifiedTask[];
  currentUserId: string;
  /** Garante que o próprio usuário aparece no mapa de avatares mesmo sem
   *  nenhuma tarefa de espaço na lista (só lembretes). */
  perfil: PersonRef;
  spaces: UnifiedSpace[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [filters, setFilters] = useState<TaskFilters>({ ...EMPTY_FILTERS, status: "open" });
  const [ordem, setOrdem] = useState<SortOrder>(DEFAULT_SORT);

  useEffect(() => {
    try {
      const salva = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (isSortOrder(salva)) setOrdem(salva);
    } catch {
      // Navegação privada ou armazenamento bloqueado: fica na ordem padrão.
    }
  }, []);

  function mudarOrdem(nova: SortOrder) {
    setOrdem(nova);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, nova);
    } catch {
      // Sem armazenamento, a ordem vale só até recarregar a página.
    }
  }

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [novaTarefaAberta, setNovaTarefaAberta] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();

  const [optimisticTasks, applyOptimistic] = useOptimistic(
    tasks,
    (current: UnifiedTask[], change: { id: string; completed: boolean }) =>
      current.map((task) => {
        if (task.id !== change.id) return task;
        if (isSharedTask(task) && isResponsible(task, currentUserId)) {
          const outros = (task.completed_by_ids ?? []).filter((id) => id !== currentUserId);
          return {
            ...task,
            completed_by_ids: change.completed ? [...outros, currentUserId] : outros,
          };
        }
        return {
          ...task,
          is_completed: change.completed,
          lembreteOriginal: task.lembreteOriginal
            ? { ...task.lembreteOriginal, is_completed: change.completed }
            : undefined,
        };
      }),
  );

  const tarefasParaMim = useMemo(
    () => optimisticTasks.map((t) => ({ ...t, is_completed: isDoneFor(t, currentUserId) })),
    [optimisticTasks, currentUserId],
  );

  // Um mapa só, com a equipe de todos os espaços — um responsável pode
  // aparecer em mais de um espaço, mas o `Map` já resolve a repetição. O
  // próprio usuário entra garantido, pro avatar dos lembretes existir mesmo
  // sem nenhuma tarefa de espaço na lista.
  const peopleById = useMemo(() => {
    const mapa = new Map<string, PersonRef>([[perfil.id, perfil]]);
    for (const espaco of spaces) {
      for (const pessoa of espaco.people) mapa.set(pessoa.id, pessoa);
    }
    return mapa;
  }, [spaces, perfil]);

  const spaceById = useMemo(() => new Map(spaces.map((s) => [s.id, s])), [spaces]);

  const visibleTasks = useMemo(
    () => sortTasks(applyFilters(tarefasParaMim, filters), ordem),
    [tarefasParaMim, filters, ordem],
  );

  const openTask = optimisticTasks.find((t) => t.id === openTaskId) ?? null;
  const openTaskSpace = openTask ? spaceById.get(openTask.workspace_id) : undefined;

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

  /** Separa os ids marcados por origem — e, entre os de espaço, por espaço:
   *  cada ação em massa só aceita ids de uma coisa por vez. */
  function agruparSelecionadas() {
    const porEspaco = new Map<string, string[]>();
    const lembretes: string[] = [];
    for (const id of selecionadas) {
      const t = optimisticTasks.find((x) => x.id === id);
      if (!t) continue;
      if (t.origem === "lembrete") lembretes.push(id);
      else porEspaco.set(t.workspace_id, [...(porEspaco.get(t.workspace_id) ?? []), id]);
    }
    return { porEspaco, lembretes };
  }

  function handleBulkComplete(completed: boolean) {
    const { porEspaco, lembretes } = agruparSelecionadas();
    startBulkTransition(async () => {
      const resultados = await Promise.all([
        ...[...porEspaco.entries()].map(([workspaceId, ids]) =>
          bulkCompleteTasksAction(workspaceId, ids, completed),
        ),
        ...(lembretes.length ? [bulkCompletePersonalTasksAction(lembretes, completed)] : []),
      ]);
      setError(resultados.find((r) => r.error)?.error ?? null);
      sairDoModoSelecao();
      router.refresh();
    });
  }

  function handleBulkDelete() {
    const { porEspaco, lembretes } = agruparSelecionadas();
    startBulkTransition(async () => {
      const resultados = await Promise.all([
        ...[...porEspaco.entries()].map(([workspaceId, ids]) => bulkDeleteTasksAction(workspaceId, ids)),
        ...(lembretes.length ? [bulkDeletePersonalTasksAction(lembretes)] : []),
      ]);
      setError(resultados.find((r) => r.error)?.error ?? null);
      sairDoModoSelecao();
      router.refresh();
    });
  }

  // Tipado como `TaskOverview` porque é isso que `TaskList` promete no
  // callback — na prática é sempre um `UnifiedTask`, já que é isso que a
  // lista recebeu para renderizar.
  function handleToggle(taskGeral: TaskOverview, origem: { x: number; y: number }) {
    const task = taskGeral as UnifiedTask;
    if (!task.is_completed) {
      playCompletionSound();
      fireCompletionBurst(origem);
    }

    startTransition(async () => {
      applyOptimistic({ id: task.id, completed: !task.is_completed });
      const result =
        task.origem === "lembrete"
          ? await patchPersonalTaskAction(task.id, { is_completed: !task.is_completed })
          : await patchTaskAction(task.id, task.workspace_id, { is_completed: !task.is_completed });
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  // Sempre dá pra criar alguma coisa: no pior caso, um lembrete pessoal — que
  // não depende de permissão de espaço nenhuma.
  const podeSelecionar = true;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 basis-48">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            people={[...peopleById.values()]}
            resultCount={visibleTasks.length}
            totalCount={optimisticTasks.length}
            sort={ordem}
            onSortChange={mudarOrdem}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {podeSelecionar && !modoSelecao && visibleTasks.length > 0 && (
            <Button variant="secondary" onClick={() => setModoSelecao(true)}>
              <CheckSquare className="size-4" aria-hidden />
              Selecionar
            </Button>
          )}

          <Button onClick={() => setNovaTarefaAberta(true)}>
            <Plus className="size-4" aria-hidden />
            Nova tarefa
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          {error}
        </p>
      )}

      {modoSelecao && (
        <BulkActionBar
          count={selecionadas.size}
          total={visibleTasks.length}
          onToggleAll={() =>
            setSelecionadas((atual) =>
              visibleTasks.length > 0 && visibleTasks.every((t) => atual.has(t.id))
                ? new Set()
                : new Set(visibleTasks.map((t) => t.id)),
            )
          }
          canEdit
          canDelete
          pending={bulkPending}
          onComplete={() => handleBulkComplete(true)}
          onReopen={() => handleBulkComplete(false)}
          onDelete={handleBulkDelete}
          onClear={sairDoModoSelecao}
        />
      )}

      <TaskList
        tasks={visibleTasks}
        peopleById={peopleById}
        canComplete
        onOpenTask={(task) => setOpenTaskId(task.id)}
        onToggleTask={handleToggle}
        emptyTitle="Nada por aqui"
        emptyDescription='Use "Nova tarefa" pra criar algo — num espaço ou só pra você.'
        selectable={modoSelecao}
        selectedIds={selecionadas}
        onToggleSelect={alternarSelecao}
      />

      <NewUnifiedTaskDialog
        open={novaTarefaAberta}
        onClose={() => setNovaTarefaAberta(false)}
        onCreated={() => router.refresh()}
        currentUserId={currentUserId}
        spaces={spaces}
      />

      {openTask &&
        (openTask.origem === "lembrete" && openTask.lembreteOriginal ? (
          <PersonalReminderPanel
            task={openTask.lembreteOriginal}
            onClose={() => setOpenTaskId(null)}
            onChanged={() => router.refresh()}
          />
        ) : (
          openTaskSpace && (
            <TaskPanel
              task={openTask}
              workspaceId={openTask.workspace_id}
              people={openTaskSpace.people}
              permissoes={openTaskSpace.permissoes}
              currentUserId={currentUserId}
              allTasks={optimisticTasks.filter(
                (t) => t.origem === "espaco" && t.workspace_id === openTask.workspace_id,
              )}
              onClose={() => setOpenTaskId(null)}
              onChanged={() => router.refresh()}
            />
          )
        ))}
    </div>
  );
}
