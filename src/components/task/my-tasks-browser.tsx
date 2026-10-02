"use client";

import { useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { CheckSquare, ClipboardList, Plus, SearchX } from "lucide-react";

import { MyTasksToolbar } from "@/components/filters/my-tasks-toolbar";
import { MyTasksList, type TaskAction } from "@/components/task/my-tasks-list";
import { TaskPanel } from "@/components/task/task-panel";
import { PersonalReminderPanel } from "@/components/task/personal-reminder-panel";
import { NewUnifiedTaskDialog, type UnifiedSpace } from "@/components/task/new-unified-task-dialog";
import { BulkActionBar } from "@/components/task/bulk-action-bar";
import { Button, Modal } from "@/components/ui";
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
import type { PersonRef } from "@/lib/database.types";

const SORT_STORAGE_KEY = "chroma-flux:ordem-minhas-tarefas";

/** Padrão da tela — e o que "Limpar" restaura: só o que está em aberto. */
const FILTROS_PADRAO: TaskFilters = { ...EMPTY_FILTERS, status: "open" };

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

  const [filters, setFilters] = useState<TaskFilters>(FILTROS_PADRAO);
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
  const [excluindo, setExcluindo] = useState<UnifiedTask | null>(null);
  const [excluindoPending, startExcluir] = useTransition();

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

  function handleToggle(task: UnifiedTask, origem: { x: number; y: number }) {
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

  /** Exclusão de uma tarefa só, pelo menu "⋯" — sempre com confirmação. */
  function confirmarExclusao() {
    const task = excluindo;
    if (!task) return;
    startExcluir(async () => {
      const result =
        task.origem === "lembrete"
          ? await bulkDeletePersonalTasksAction([task.id])
          : await bulkDeleteTasksAction(task.workspace_id, [task.id]);
      setError(result.error ?? null);
      setExcluindo(null);
      if (openTaskId === task.id) setOpenTaskId(null);
      router.refresh();
    });
  }

  /**
   * Permissão de verdade por item: lembrete/tarefa particular é sempre do
   * próprio dono (pode editar, concluir e excluir); tarefa de espaço segue a
   * matriz daquele espaço especificamente — que pode restringir bem mais que
   * isso pra quem é só membro. Sem isto, a barra de seleção mostrava
   * "Excluir" pra quem só tinha permissão de concluir.
   */
  function permiteAcao(t: UnifiedTask, campo: TaskAction): boolean {
    if (t.origem === "lembrete") return true;
    return spaceById.get(t.workspace_id)?.permissoes[campo] ?? false;
  }

  // Antes de selecionar algo, a barra reflete o que há na tela inteira —
  // assim que a seleção existe, passa a refletir só o que foi marcado.
  const baseParaPermissao =
    selecionadas.size > 0 ? optimisticTasks.filter((t) => selecionadas.has(t.id)) : optimisticTasks;
  const podeEditarSelecao = baseParaPermissao.some(
    (t) => permiteAcao(t, "edit") || permiteAcao(t, "complete"),
  );
  const podeExcluirSelecao = baseParaPermissao.some((t) => permiteAcao(t, "delete"));

  const semNada = optimisticTasks.length === 0;
  const filtrosNoPadrao = JSON.stringify(filters) === JSON.stringify(FILTROS_PADRAO);

  return (
    <div>
      <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[34px]">
            Minhas tarefas
          </h1>
          <p className="mt-1.5 text-base text-ink-500">
            Suas tarefas e lembretes pessoais em um só lugar.
          </p>
        </div>

        <Button
          onClick={() => setNovaTarefaAberta(true)}
          className="h-12 shrink-0 rounded-xl px-6 text-base font-semibold shadow-lg shadow-brand-600/25"
        >
          <Plus className="size-5" aria-hidden />
          Nova tarefa
        </Button>
      </header>

      <MyTasksToolbar
        filters={filters}
        defaults={FILTROS_PADRAO}
        onChange={setFilters}
        people={[...peopleById.values()]}
        resultCount={visibleTasks.length}
        totalCount={optimisticTasks.length}
        sort={ordem}
        onSortChange={mudarOrdem}
      />

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger-fg">
          {error}
        </p>
      )}

      <div className="mt-4 min-h-10">
        {modoSelecao ? (
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
            canEdit={podeEditarSelecao}
            canDelete={podeExcluirSelecao}
            pending={bulkPending}
            onComplete={() => handleBulkComplete(true)}
            onReopen={() => handleBulkComplete(false)}
            onDelete={handleBulkDelete}
            onClear={sairDoModoSelecao}
          />
        ) : (
          visibleTasks.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => setModoSelecao(true)}
              className="h-10 rounded-xl px-4"
            >
              <CheckSquare className="size-4" aria-hidden />
              Selecionar
            </Button>
          )
        )}
      </div>

      <div className="mt-4">
        {visibleTasks.length > 0 ? (
          <MyTasksList
            tasks={visibleTasks}
            peopleById={peopleById}
            spaceById={spaceById}
            onOpenTask={(task) => setOpenTaskId(task.id)}
            onToggleTask={handleToggle}
            onDeleteTask={setExcluindo}
            can={permiteAcao}
            selectable={modoSelecao}
            selectedIds={selecionadas}
            onToggleSelect={alternarSelecao}
          />
        ) : semNada ? (
          <EstadoVazio
            icone={<ClipboardList className="size-6" aria-hidden />}
            titulo="Nada por aqui"
            descricao='Use "Nova tarefa" para criar algo — num espaço ou só para você.'
            acao={
              <Button onClick={() => setNovaTarefaAberta(true)} className="rounded-xl">
                <Plus className="size-4" aria-hidden />
                Nova tarefa
              </Button>
            }
          />
        ) : !filtrosNoPadrao ? (
          <EstadoVazio
            icone={<SearchX className="size-6" aria-hidden />}
            titulo="Nenhuma tarefa encontrada"
            descricao={
              filters.search.trim()
                ? `Nada corresponde a "${filters.search.trim()}" com os filtros atuais.`
                : "Nenhuma tarefa corresponde aos filtros escolhidos."
            }
            acao={
              <Button variant="secondary" onClick={() => setFilters(FILTROS_PADRAO)} className="rounded-xl">
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <EstadoVazio
            icone={<CheckSquare className="size-6" aria-hidden />}
            titulo="Tudo em dia!"
            descricao="Você não tem nenhuma tarefa em aberto."
            acao={
              <Button
                variant="secondary"
                onClick={() => setFilters({ ...FILTROS_PADRAO, status: "all" })}
                className="rounded-xl"
              >
                Ver todas, inclusive concluídas
              </Button>
            }
          />
        )}
      </div>

      <Modal
        open={!!excluindo}
        onClose={() => setExcluindo(null)}
        title="Excluir tarefa?"
        description={excluindo ? `"${excluindo.title}" será excluída. Esta ação não pode ser desfeita.` : undefined}
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setExcluindo(null)}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" loading={excluindoPending} onClick={confirmarExclusao}>
            Excluir
          </Button>
        </div>
      </Modal>
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

function EstadoVazio({
  icone,
  titulo,
  descricao,
  acao,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-ink-200 bg-surface px-6 py-14 text-center flux-shadow">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-ink-100 text-ink-500">
        {icone}
      </div>
      <h2 className="text-lg font-semibold text-ink-900">{titulo}</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-500">{descricao}</p>
      {acao && <div className="mt-5">{acao}</div>}
    </div>
  );
}
