"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  ExternalLink,
  Link2,
  ListTree,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Repeat,
  RotateCcw,
  SquareArrowOutUpRight,
  Text,
  Trash2,
  Users,
} from "lucide-react";

import { AttachmentBadges } from "@/components/task/attachment-badges";
import { isSafeHttpUrl } from "@/lib/links";
import { recurrenceFromTask, shortRecurrenceLabel } from "@/lib/recurrence";
import { useNow } from "@/lib/use-now";
import {
  accentClass,
  cn,
  dueDateMeta,
  initials,
  isSharedTask,
  priorityMeta,
  responsibleIds,
} from "@/lib/utils";
import type { UnifiedTask } from "@/lib/unified-tasks";
import type { PersonRef, TaskPriority } from "@/lib/database.types";

export type TaskAction = "edit" | "complete" | "delete";

/**
 * Colunas da lista no desktop: controle · tarefa · prazo · prioridade ·
 * responsável · ações. O cabeçalho usa as mesmas, para alinhar.
 */
const COLUNAS = "xl:grid-cols-[1.5rem_minmax(0,1fr)_8.5rem_8rem_7.5rem_2.5rem]";

/**
 * Lista de "Minhas tarefas" no visual novo.
 *
 * No desktop é uma tabela de colunas; abaixo de `xl`, cada linha vira um
 * cartão compacto — título e detalhes em cima, prazo, prioridade e
 * responsável numa linha logo abaixo, sem rolagem horizontal.
 *
 * Abrir, concluir, selecionar e o menu de ações são controles separados:
 * o clique na linha abre a tarefa (ou marca, no modo de seleção), mas cada
 * controle de dentro para a propagação para não disparar os dois.
 */
export function MyTasksList({
  tasks,
  peopleById,
  spaceById,
  onOpenTask,
  onToggleTask,
  onDeleteTask,
  can,
  selectable,
  selectedIds,
  onToggleSelect,
}: {
  tasks: UnifiedTask[];
  peopleById: Map<string, PersonRef>;
  spaceById: Map<string, { name: string; color: string }>;
  onOpenTask: (task: UnifiedTask) => void;
  /** A posição do clique acompanha a tarefa: é dali que o confete nasce. */
  onToggleTask: (task: UnifiedTask, origem: { x: number; y: number }) => void;
  onDeleteTask: (task: UnifiedTask) => void;
  /** Permissão real por item (lembrete é sempre do dono; espaço segue a matriz). */
  can: (task: UnifiedTask, acao: TaskAction) => boolean;
  selectable: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (taskId: string) => void;
}) {
  const now = useNow();

  return (
    <div className="rounded-2xl border border-ink-200 bg-surface flux-shadow">
      <div
        className={cn(
          "hidden items-center gap-x-4 border-b border-ink-200 px-5 py-3.5 text-sm font-medium text-ink-500 xl:grid",
          COLUNAS,
        )}
        aria-hidden
      >
        <span />
        <span>Tarefa</span>
        <span>Prazo</span>
        <span>Prioridade</span>
        <span>Responsável</span>
        <span />
      </div>

      <ul aria-label="Tarefas" className="divide-y divide-ink-200/70">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            now={now}
            peopleById={peopleById}
            space={task.origem === "espaco" ? spaceById.get(task.workspace_id) : undefined}
            onOpen={() => onOpenTask(task)}
            onToggle={(origem) => onToggleTask(task, origem)}
            onDelete={() => onDeleteTask(task)}
            can={(acao) => can(task, acao)}
            selectable={selectable}
            selected={selectedIds.has(task.id)}
            onToggleSelect={() => onToggleSelect(task.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({
  task,
  now,
  peopleById,
  space,
  onOpen,
  onToggle,
  onDelete,
  can,
  selectable,
  selected,
  onToggleSelect,
}: {
  task: UnifiedTask;
  now: Date | null;
  peopleById: Map<string, PersonRef>;
  space?: { name: string; color: string };
  onOpen: () => void;
  onToggle: (origem: { x: number; y: number }) => void;
  onDelete: () => void;
  can: (acao: TaskAction) => boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const responsaveis = responsibleIds(task)
    .map((id) => peopleById.get(id))
    .filter((p): p is PersonRef => !!p);
  const due = dueDateMeta(task.due_date, task.is_completed, task.due_time, now);
  const atrasada = !!due?.overdue && !task.is_completed;
  const recorrencia = shortRecurrenceLabel(recurrenceFromTask(task));
  const podeConcluir = can("complete") || can("edit");
  const concluidosPor = task.completed_by_ids ?? [];

  return (
    <li
      onClick={selectable ? onToggleSelect : onOpen}
      className={cn(
        "group relative grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_2.5rem] items-start gap-x-3 gap-y-2 px-4 py-3.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl xl:items-center xl:gap-x-4 xl:px-5 xl:py-3",
        COLUNAS,
        selected
          ? "bg-brand-50"
          : atrasada
            ? "bg-danger-bg/60 hover:bg-danger-bg"
            : "hover:bg-ink-100/60",
      )}
    >
      {/* Controle à esquerda: no modo de seleção é uma caixa quadrada (marcar
          para ação em lote); fora dele, a bolinha redonda de concluir. */}
      <div className="row-span-2 flex h-6 items-center xl:row-span-1">
        {selectable ? (
          <input
            type="checkbox"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={onToggleSelect}
            aria-label={`Selecionar "${task.title}"`}
            className="size-[18px] cursor-pointer rounded accent-brand-600"
          />
        ) : (
          <button
            type="button"
            disabled={!podeConcluir}
            onClick={(event) => {
              event.stopPropagation();
              onToggle({ x: event.clientX, y: event.clientY });
            }}
            aria-label={
              task.is_completed ? `Reabrir "${task.title}"` : `Concluir "${task.title}"`
            }
            className="rounded-full text-ink-400 transition-colors hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-ink-400"
          >
            {task.is_completed ? (
              <CheckCircle2 className="size-6 text-emerald-500" aria-hidden />
            ) : (
              <Circle className="size-6" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        )}
      </div>

      {/* Título e detalhes */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <TaskTitle task={task} onOpen={onOpen} selectable={selectable} />
          {atrasada && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-danger-fg/40 px-2 py-0.5 text-xs font-medium text-danger-fg">
              <AlertTriangle className="size-3.5" aria-hidden />
              Atrasado
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-500">
          {recorrencia && (
            <span className="inline-flex items-center gap-1 font-medium text-brand-700">
              <Repeat className="size-3.5" aria-hidden />
              {recorrencia}
            </span>
          )}
          {task.is_personal && (
            <span className="inline-flex items-center gap-1" title="Só você vê esta tarefa">
              <Lock className="size-3.5" aria-hidden />
              Particular
            </span>
          )}
          {space && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className={cn("size-2 shrink-0 rounded-full", accentClass(space.color))} aria-hidden />
              <span className="sr-only">Espaço: </span>
              <span className="truncate">{space.name}</span>
            </span>
          )}
          {task.description.trim().length > 0 && (
            <span className="inline-flex items-center gap-1 text-ok-fg">
              <Text className="size-3.5" aria-hidden />
              Contém descrição
            </span>
          )}
          {task.subtask_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListTree className="size-3.5" aria-hidden />
              <span className="sr-only">Subtarefas: </span>
              {task.subtask_done_count}/{task.subtask_count}
            </span>
          )}
          {task.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden />
              <span className="sr-only">Comentários: </span>
              {task.comment_count}
            </span>
          )}
          <AttachmentBadges total={task.attachment_count} images={task.image_count} />
          {isSharedTask(task) && (
            <span
              className="inline-flex items-center gap-1"
              title={`${concluidosPor.length} de ${responsaveis.length} responsáveis concluíram`}
            >
              <Users className="size-3.5" aria-hidden />
              {concluidosPor.length}/{responsaveis.length}
              <span className="sr-only"> responsáveis concluíram</span>
            </span>
          )}
        </div>
      </div>

      {/* Prazo, prioridade e responsável: linha própria no celular, colunas
          no desktop (`xl:contents` solta os três direto na grade). */}
      <div className="col-span-2 col-start-2 row-start-2 flex flex-wrap items-center gap-2 xl:contents">
        <div className="text-sm">
          <span className="sr-only">Prazo: </span>
          {due ? (
            <span
              className={cn(
                "inline-flex items-center whitespace-nowrap",
                atrasada
                  ? "rounded-lg bg-danger-bg px-2.5 py-1 font-medium text-danger-fg"
                  : "text-ink-700 xl:px-0",
                !atrasada && "rounded-lg bg-ink-100 px-2 py-0.5 xl:bg-transparent",
              )}
            >
              {due.label}
              {atrasada && <span className="sr-only"> (atrasada)</span>}
            </span>
          ) : (
            <span className="text-ink-400">
              <span aria-hidden>—</span>
              <span className="sr-only">sem prazo</span>
            </span>
          )}
        </div>

        <div>
          <PriorityBadge priority={task.priority} />
        </div>

        <div className="ml-auto xl:ml-0">
          <span className="sr-only">Responsável: </span>
          {responsaveis.length > 0 ? (
            <span className="flex -space-x-2">
              {responsaveis.slice(0, 3).map((pessoa) => (
                <span key={pessoa.id} className="relative">
                  <PersonAvatar person={pessoa} />
                  {concluidosPor.includes(pessoa.id) && (
                    <CheckCircle2
                      className="absolute -bottom-1 -right-1 size-4 rounded-full bg-surface text-emerald-500"
                      aria-label="concluiu"
                    />
                  )}
                </span>
              ))}
              {responsaveis.length > 3 && (
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-ink-200 text-xs font-semibold text-ink-800 ring-2 ring-surface">
                  +{responsaveis.length - 3}
                </span>
              )}
            </span>
          ) : (
            <span
              className="inline-block size-8 rounded-full border border-dashed border-ink-300"
              title="Sem responsável"
            >
              <span className="sr-only">sem responsável</span>
            </span>
          )}
        </div>
      </div>

      <div className="col-start-3 row-start-1 flex justify-end xl:col-start-auto xl:row-start-auto">
        <RowMenu
          task={task}
          onOpen={onOpen}
          onToggle={podeConcluir ? onToggle : undefined}
          onDelete={can("delete") ? onDelete : undefined}
        />
      </div>
    </li>
  );
}

/**
 * Título com reticências quando não cabe. O texto guardado não muda: o
 * corte é só visual, e o leitor de tela lê o título inteiro. No desktop, um
 * balão mostra o texto completo ao passar o mouse ou focar — só quando houve
 * corte de fato, para não repetir títulos que já cabem.
 *
 * Título que é um endereço vira link de verdade (abre em outra aba sem abrir
 * a tarefa); a tarefa continua abrindo pelo clique na linha ou pelo menu.
 */
function TaskTitle({
  task,
  onOpen,
  selectable,
}: {
  task: UnifiedTask;
  onOpen: () => void;
  selectable: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [cortado, setCortado] = useState(false);

  const medir = () => {
    const el = ref.current;
    setCortado(!!el && el.scrollWidth > el.clientWidth + 1);
  };

  const titulo = task.title.trim();
  const ehLink = !/\s/.test(titulo) && isSafeHttpUrl(titulo);
  const classeTexto = cn(
    // `relative` prende o texto escondido para leitor de tela dentro do corte —
    // sem isso ele escapa para o fim do título e cria rolagem horizontal.
    "relative block min-w-0 truncate text-left text-[15px] font-semibold",
    task.is_completed ? "text-ink-500 line-through" : "text-ink-900",
  );

  return (
    <span
      className="group/titulo relative flex min-w-0 items-center gap-1.5"
      onMouseEnter={medir}
      onFocusCapture={medir}
    >
      {ehLink ? (
        <>
          <Link2 className="size-4 shrink-0 text-brand-700" aria-hidden />
          <a
            ref={(el) => {
              ref.current = el;
            }}
            href={titulo}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className={cn(classeTexto, "text-brand-700 hover:underline")}
          >
            {task.title}
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
          <ExternalLink className="hidden size-3.5 shrink-0 text-ink-500 group-hover/titulo:inline" aria-hidden />
        </>
      ) : (
        <button
          ref={(el) => {
            ref.current = el;
          }}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          // No modo de seleção a linha marca; o título continua abrindo.
          aria-label={selectable ? `Abrir "${task.title}"` : undefined}
          className={cn(classeTexto, "rounded hover:text-brand-700")}
        >
          {task.title}
        </button>
      )}

      {cortado && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 hidden max-w-[min(32rem,80vw)] rounded-lg border border-ink-200 bg-surface-raised px-3 py-2 text-sm font-normal break-words text-ink-900 shadow-lg md:group-focus-within/titulo:block md:group-hover/titulo:block"
        >
          {task.title}
        </span>
      )}
    </span>
  );
}

/** Selo de prioridade: bolinha + texto, para não depender só da cor. */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const meta = priorityMeta(priority);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium",
        meta.chip,
      )}
    >
      <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden />
      <span className="sr-only">Prioridade </span>
      {meta.label}
    </span>
  );
}

/** Avatar de iniciais em turquesa — o app ainda não exibe fotos de perfil. */
export function PersonAvatar({ person }: { person: PersonRef }) {
  const nome = person.full_name || person.email;
  return (
    <span
      title={nome}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-500 text-xs font-semibold text-white ring-2 ring-surface"
    >
      <span aria-hidden>{initials(person.full_name, person.email)}</span>
      <span className="sr-only">{nome}</span>
    </span>
  );
}

/**
 * Menu "⋯" da linha, com as ações que já existiam para a tarefa: abrir,
 * concluir/reabrir e excluir (as duas últimas só com permissão). Teclado:
 * setas navegam, Esc fecha e devolve o foco ao botão.
 */
function RowMenu({
  task,
  onOpen,
  onToggle,
  onDelete,
}: {
  task: UnifiedTask;
  onOpen: () => void;
  onToggle?: (origem: { x: number; y: number }) => void;
  onDelete?: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();

    const fora = (event: PointerEvent) => {
      const alvo = event.target as Node;
      if (!menuRef.current?.contains(alvo) && !botaoRef.current?.contains(alvo)) setAberto(false);
    };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto]);

  function fechar(devolverFoco = true) {
    setAberto(false);
    if (devolverFoco) botaoRef.current?.focus();
  }

  function aoTeclar(event: React.KeyboardEvent) {
    const itens = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []),
    ];
    const atual = itens.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      fechar();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      itens[(atual + 1) % itens.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      itens[(atual - 1 + itens.length) % itens.length]?.focus();
    } else if (event.key === "Tab") {
      fechar(false);
    }
  }

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink-800 hover:bg-ink-100 focus:bg-ink-100 focus:outline-none";

  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Ações de "${task.title}"`}
        className="inline-flex size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>

      {aberto && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Ações de "${task.title}"`}
          onKeyDown={aoTeclar}
          className="absolute right-0 top-full z-30 mt-1 w-52 rounded-xl border border-ink-200 bg-surface-raised p-1.5 shadow-xl"
        >
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              fechar(false);
              onOpen();
            }}
          >
            <SquareArrowOutUpRight className="size-4 text-ink-500" aria-hidden />
            Abrir tarefa
          </button>
          {onToggle && (
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={(event) => {
                fechar();
                onToggle({ x: event.clientX, y: event.clientY });
              }}
            >
              {task.is_completed ? (
                <RotateCcw className="size-4 text-ink-500" aria-hidden />
              ) : (
                <Check className="size-4 text-ink-500" aria-hidden />
              )}
              {task.is_completed ? "Reabrir" : "Concluir"}
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              role="menuitem"
              className={cn(item, "text-danger-fg hover:bg-danger-bg focus:bg-danger-bg")}
              onClick={() => {
                fechar(false);
                onDelete();
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Excluir
            </button>
          )}
        </div>
      )}
    </div>
  );
}
