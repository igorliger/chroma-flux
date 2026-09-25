import { differenceInCalendarDays, parseISO } from "date-fns";

import type { TaskOverview } from "@/lib/database.types";
import { PRIORITY_WEIGHT } from "@/lib/utils";

export type StatusFilter = "all" | "open" | "completed";
export type DueFilter = "all" | "overdue" | "today" | "week" | "none";

export type TaskFilters = {
  search: string;
  assignee: string; // "" = todos, "none" = sem responsável, ou um id
  priority: string; // "" = todas, ou uma prioridade
  status: StatusFilter;
  due: DueFilter;
};

export const EMPTY_FILTERS: TaskFilters = {
  search: "",
  assignee: "",
  priority: "",
  status: "all",
  due: "all",
};

/**
 * Filtros vindos da URL — é assim que os cartões do painel abrem a lista já
 * recortada pelo número em que se clicou.
 *
 * Os nomes na query são em português e não repetem os valores internos de
 * `StatusFilter`/`DueFilter`: o endereço é parte da interface, e `?prazo=
 * atrasadas` se explica sozinho na barra do navegador. Valor desconhecido cai
 * no padrão em vez de virar erro — uma URL editada à mão não deve quebrar a
 * tela.
 */
const SITUACAO: Record<string, StatusFilter> = {
  todas: "all",
  abertas: "open",
  concluidas: "completed",
};

const PRAZO: Record<string, DueFilter> = {
  qualquer: "all",
  atrasadas: "overdue",
  hoje: "today",
  semana: "week",
  sem: "none",
};

export function filtersFromQuery(query: {
  situacao?: string;
  prazo?: string;
  responsavel?: string;
  busca?: string;
}): TaskFilters {
  return {
    ...EMPTY_FILTERS,
    status: SITUACAO[query.situacao ?? ""] ?? EMPTY_FILTERS.status,
    due: PRAZO[query.prazo ?? ""] ?? EMPTY_FILTERS.due,
    assignee: query.responsavel ?? EMPTY_FILTERS.assignee,
    search: query.busca ?? EMPTY_FILTERS.search,
  };
}

export function hasActiveFilters(filters: TaskFilters) {
  return (
    filters.search.trim() !== "" ||
    filters.assignee !== "" ||
    filters.priority !== "" ||
    filters.status !== "all" ||
    filters.due !== "all"
  );
}

function matchesDue(task: TaskOverview, due: DueFilter) {
  if (due === "all") return true;
  if (due === "none") return task.due_date === null;
  if (!task.due_date) return false;

  const days = differenceInCalendarDays(parseISO(task.due_date), new Date());

  switch (due) {
    case "overdue":
      return days < 0 && !task.is_completed;
    case "today":
      return days === 0;
    case "week":
      return days >= 0 && days <= 7;
    default:
      return true;
  }
}

/**
 * Normaliza texto para busca: minúsculas e sem acentos.
 *
 * Em português isso é essencial — ninguém digita "manutenção" com cedilha e
 * til na caixa de busca. `NFD` separa a letra do sinal diacrítico, e o regex
 * remove os sinais, de modo que "reuniao" encontra "Reunião" e vice-versa.
 */
// U+0300–U+036F é o bloco dos sinais diacríticos combinantes que o `NFD`
// separa das letras. Construído via `new RegExp` com escapes para o arquivo
// não depender de caracteres invisíveis no código-fonte.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(DIACRITICS, "");
}

/**
 * Aplica busca e filtros sobre a lista já carregada.
 *
 * A filtragem acontece no cliente de propósito: o volume por espaço de
 * trabalho é pequeno, e assim os controles respondem sem ida ao servidor.
 */
export function applyFilters(tasks: TaskOverview[], filters: TaskFilters) {
  const term = normalize(filters.search.trim());

  return tasks.filter((task) => {
    if (term) {
      const haystack = normalize(`${task.title} ${task.description}`);
      if (!haystack.includes(term)) return false;
    }

    if (filters.assignee === "none") {
      if (task.assignee_id !== null) return false;
    } else if (filters.assignee && task.assignee_id !== filters.assignee) {
      return false;
    }

    if (filters.priority && task.priority !== filters.priority) return false;

    if (filters.status === "open" && task.is_completed) return false;
    if (filters.status === "completed" && !task.is_completed) return false;

    return matchesDue(task, filters.due);
  });
}

/** Ordena por prazo mais próximo e, em empate, por prioridade. */
export function sortByUrgency(tasks: TaskOverview[]) {
  return [...tasks].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;

    if (a.due_date && b.due_date) {
      const diff = a.due_date.localeCompare(b.due_date);
      if (diff !== 0) return diff;
    } else if (a.due_date !== b.due_date) {
      return a.due_date ? -1 : 1;
    }

    return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
  });
}
