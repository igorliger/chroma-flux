"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CheckSquare, Plus } from "lucide-react";

import { ReminderFilterBar } from "@/components/task/reminder-filter-bar";
import { PersonalReminderList } from "@/components/task/personal-reminder-list";
import { PersonalReminderPanel } from "@/components/task/personal-reminder-panel";
import { NewPersonalReminderDialog } from "@/components/task/new-personal-reminder-dialog";
import { BulkActionBar } from "@/components/task/bulk-action-bar";
import { Button } from "@/components/ui";
import {
  bulkCompletePersonalTasksAction,
  bulkDeletePersonalTasksAction,
  patchPersonalTaskAction,
} from "@/app/actions/personal-tasks";
import { fireCompletionBurst } from "@/lib/completion-burst";
import { playCompletionSound } from "@/lib/completion-sound";
import {
  DEFAULT_REMINDER_SORT,
  EMPTY_REMINDER_FILTERS,
  applyReminderFilters,
  isReminderSortOrder,
  sortReminders,
  type ReminderFilters,
  type ReminderSortOrder,
} from "@/lib/reminder-filters";
import type { PersonalTaskOverview } from "@/lib/database.types";

/** Onde a ordem escolhida fica guardada, só neste navegador. */
const SORT_STORAGE_KEY = "chroma-flux:ordem-lembretes";

/**
 * Lembretes pessoais — busca, filtros, seleção em massa e o painel de
 * detalhe. Versão de `components/workspace/task-browser.tsx` sem espaço de
 * trabalho: aqui não há permissão de papel para checar, é sempre o dono.
 */
export function PersonalReminderBrowser({
  reminders,
}: {
  reminders: PersonalTaskOverview[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [filters, setFilters] = useState<ReminderFilters>(EMPTY_REMINDER_FILTERS);
  const [ordem, setOrdem] = useState<ReminderSortOrder>(DEFAULT_REMINDER_SORT);

  useEffect(() => {
    try {
      const salva = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (isReminderSortOrder(salva)) setOrdem(salva);
    } catch {
      // Navegação privada ou armazenamento bloqueado: fica na ordem padrão.
    }
  }, []);

  function mudarOrdem(nova: ReminderSortOrder) {
    setOrdem(nova);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, nova);
    } catch {
      // Sem armazenamento, a ordem vale só até recarregar a página.
    }
  }

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [bulkPending, startBulkTransition] = useTransition();

  const [optimisticTasks, applyOptimistic] = useOptimistic(
    reminders,
    (current: PersonalTaskOverview[], change: { id: string; completed: boolean }) =>
      current.map((t) => (t.id === change.id ? { ...t, is_completed: change.completed } : t)),
  );

  const visibleTasks = useMemo(
    () => sortReminders(applyReminderFilters(optimisticTasks, filters), ordem),
    [optimisticTasks, filters, ordem],
  );

  const openTask = optimisticTasks.find((t) => t.id === openTaskId) ?? null;

  function sairDoModoSelecao() {
    setModoSelecao(false);
    setSelecionados(new Set());
  }

  function alternarSelecao(taskId: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(taskId)) proximo.delete(taskId);
      else proximo.add(taskId);
      return proximo;
    });
  }

  function handleBulkComplete(completed: boolean) {
    const ids = [...selecionados];
    startBulkTransition(async () => {
      const result = await bulkCompletePersonalTasksAction(ids, completed);
      setError(result.error ?? null);
      sairDoModoSelecao();
      router.refresh();
    });
  }

  function handleBulkDelete() {
    const ids = [...selecionados];
    startBulkTransition(async () => {
      const result = await bulkDeletePersonalTasksAction(ids);
      setError(result.error ?? null);
      sairDoModoSelecao();
      router.refresh();
    });
  }

  function handleToggle(task: PersonalTaskOverview, origem: { x: number; y: number }) {
    if (!task.is_completed) {
      playCompletionSound();
      fireCompletionBurst(origem);
    }

    startTransition(async () => {
      applyOptimistic({ id: task.id, completed: !task.is_completed });
      const result = await patchPersonalTaskAction(task.id, {
        is_completed: !task.is_completed,
      });
      setError(result.error ?? null);
      // Concluir um lembrete repetido gera o próximo: só o servidor sabe disso.
      if (!result.error) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 basis-48">
          <ReminderFilterBar
            filters={filters}
            onChange={setFilters}
            resultCount={visibleTasks.length}
            totalCount={optimisticTasks.length}
            sort={ordem}
            onSortChange={mudarOrdem}
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!modoSelecao && visibleTasks.length > 0 && (
            <Button variant="secondary" onClick={() => setModoSelecao(true)}>
              <CheckSquare className="size-4" aria-hidden />
              Selecionar
            </Button>
          )}

          <Button onClick={() => setNovoAberto(true)}>
            <Plus className="size-4" aria-hidden />
            Novo lembrete
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
          count={selecionados.size}
          total={visibleTasks.length}
          onToggleAll={() =>
            setSelecionados((atual) =>
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

      <PersonalReminderList
        tasks={visibleTasks}
        onOpenTask={(task) => setOpenTaskId(task.id)}
        onToggleTask={handleToggle}
        emptyTitle="Nenhum lembrete por aqui"
        emptyDescription='Use "Novo lembrete" para anotar algo só seu.'
        selectable={modoSelecao}
        selectedIds={selecionados}
        onToggleSelect={alternarSelecao}
      />

      <NewPersonalReminderDialog
        open={novoAberto}
        onClose={() => setNovoAberto(false)}
        onCreated={() => router.refresh()}
      />

      {openTask && (
        <PersonalReminderPanel
          task={openTask}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}
