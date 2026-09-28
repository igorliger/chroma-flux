import type { TaskOverview } from "@/lib/database.types";
import { dueDateMeta } from "@/lib/utils";

/**
 * Atrasada de verdade: leva a hora em conta, não só o dia. `isOverdue`
 * (utils.ts) compara só a data, então uma tarefa de hoje com horário já
 * passado (prazo às 14h, e já são 16h) não contava — embora já apareça
 * atrasada em "Tarefas", que usa `dueDateMeta` com hora. Compartilhada entre
 * o resumo do Dashboard e a lista completa por categoria, para as duas
 * concordarem sobre o que é "atrasada".
 */
export function isOverdueNow(t: TaskOverview, agora: Date): boolean {
  return !t.is_completed && !!dueDateMeta(t.due_date, false, t.due_time, agora)?.overdue;
}

export type DashboardFiltro = "abertas" | "atrasadas" | "hoje" | "concluidas";

export const DASHBOARD_FILTROS: Record<
  DashboardFiltro,
  { titulo: string; vazio: string }
> = {
  abertas: { titulo: "Em aberto", vazio: "Nenhuma tarefa em aberto." },
  atrasadas: { titulo: "Atrasadas", vazio: "Nada atrasado." },
  hoje: { titulo: "Vencem hoje", vazio: "Nada vencendo hoje." },
  concluidas: {
    titulo: "Concluídas nos últimos 7 dias",
    vazio: "Nada concluído nos últimos 7 dias.",
  },
};

export function isDashboardFiltro(valor: string | undefined): valor is DashboardFiltro {
  return !!valor && valor in DASHBOARD_FILTROS;
}
