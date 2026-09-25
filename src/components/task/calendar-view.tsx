"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { TaskPanel } from "@/components/task/task-panel";
import { IconButton } from "@/components/ui";
import { cn, priorityMeta } from "@/lib/utils";
import type { TaskPermissions } from "@/lib/permissions";
import type { CustomFieldDefinition, PersonRef, TaskOverview } from "@/lib/database.types";
import type { TaskDependencyInfo } from "@/lib/queries";

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const MAX_POR_DIA = 3;

/**
 * Grade mensal em CSS puro, sem biblioteca de calendário — ver a decisão no
 * plano. Cada dia mostra até `MAX_POR_DIA` tarefas com prazo naquele dia;
 * clicar num card abre o painel de tarefa já existente, que reusa
 * `DueDateField` para editar o prazo.
 */
export function CalendarView({
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
  const [mesAtual, setMesAtual] = useState(() => new Date());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [expandidoEm, setExpandidoEm] = useState<string | null>(null);

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesAtual), { locale: ptBR });
    const fim = endOfWeek(endOfMonth(mesAtual), { locale: ptBR });
    return eachDayOfInterval({ start: inicio, end: fim });
  }, [mesAtual]);

  const tarefasPorDia = useMemo(() => {
    const mapa = new Map<string, TaskOverview[]>();
    for (const task of tasks) {
      if (!task.due_date) continue;
      const chave = task.due_date;
      const lista = mapa.get(chave) ?? [];
      lista.push(task);
      mapa.set(chave, lista);
    }
    return mapa;
  }, [tasks]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize text-ink-900">
          {format(mesAtual, "MMMM 'de' yyyy", { locale: ptBR })}
        </h2>
        <div className="flex items-center gap-1">
          <IconButton label="Mês anterior" onClick={() => setMesAtual((m) => subMonths(m, 1))}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Hoje" onClick={() => setMesAtual(new Date())}>
            <span className="text-xs font-medium">Hoje</span>
          </IconButton>
          <IconButton label="Próximo mês" onClick={() => setMesAtual((m) => addMonths(m, 1))}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>

      <div className="overflow-hidden rounded-[--radius-card] border border-ink-200">
        <div className="grid grid-cols-7 border-b border-ink-200 bg-ink-50">
          {DIAS_SEMANA.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-xs font-semibold uppercase text-ink-500"
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {dias.map((dia) => {
            const chave = format(dia, "yyyy-MM-dd");
            const doDia = tarefasPorDia.get(chave) ?? [];
            const expandido = expandidoEm === chave;
            const visiveis = expandido ? doDia : doDia.slice(0, MAX_POR_DIA);
            const restantes = doDia.length - visiveis.length;

            return (
              <div
                key={chave}
                className={cn(
                  "min-h-24 border-b border-r border-ink-100 p-1.5 last:border-r-0",
                  !isSameMonth(dia, mesAtual) && "bg-ink-50/50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium",
                    isToday(dia)
                      ? "bg-brand-600 text-white"
                      : isSameMonth(dia, mesAtual)
                        ? "text-ink-700"
                        : "text-ink-400",
                  )}
                >
                  {format(dia, "d")}
                </span>

                <div className="mt-1 space-y-1">
                  {visiveis.map((task) => {
                    const priority = priorityMeta(task.priority);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => setOpenTaskId(task.id)}
                        className={cn(
                          "flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px]",
                          priority.chip,
                          task.is_completed && "opacity-50 line-through",
                        )}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", priority.dot)} aria-hidden />
                        <span className="truncate">{task.title}</span>
                      </button>
                    );
                  })}

                  {restantes > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandidoEm(expandido ? null : chave)}
                      className="w-full px-1.5 text-left text-[11px] font-medium text-ink-500 hover:text-brand-600"
                    >
                      {expandido ? "ver menos" : `+${restantes} mais`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openTask && (
        <TaskPanel
          task={openTask}
          workspaceId={workspaceId}
          people={people}
          permissoes={permissoes}
          currentUserId={currentUserId}
          allTasks={tasks}
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
