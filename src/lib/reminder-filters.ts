import { differenceInCalendarDays, parseISO } from "date-fns";

import type { PersonalTaskOverview } from "@/lib/database.types";
import { PRIORITY_WEIGHT } from "@/lib/utils";

/**
 * Busca, filtros e ordenação da lista de lembretes pessoais.
 *
 * Mesma lógica de `lib/filters.ts` (que serve "Tarefas"/"Minhas tarefas"),
 * sem o filtro por responsável: lembrete pessoal só tem um dono, que é quem
 * está olhando — não haveria o que escolher.
 */

export type ReminderStatusFilter = "all" | "open" | "completed";
export type ReminderDueFilter = "all" | "overdue" | "today" | "week" | "none";

export type ReminderFilters = {
  search: string;
  priority: string;
  status: ReminderStatusFilter;
  due: ReminderDueFilter;
};

export const EMPTY_REMINDER_FILTERS: ReminderFilters = {
  search: "",
  priority: "",
  status: "open",
  due: "all",
};

export function hasActiveReminderFilters(filters: ReminderFilters) {
  return (
    filters.search.trim() !== "" ||
    filters.priority !== "" ||
    filters.status !== EMPTY_REMINDER_FILTERS.status ||
    filters.due !== "all"
  );
}

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(DIACRITICS, "");
}

function matchesDue(task: PersonalTaskOverview, due: ReminderDueFilter) {
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

export function applyReminderFilters(tasks: PersonalTaskOverview[], filters: ReminderFilters) {
  const term = normalize(filters.search.trim());

  return tasks.filter((task) => {
    if (term) {
      const haystack = normalize(`${task.title} ${task.description}`);
      if (!haystack.includes(term)) return false;
    }

    if (filters.priority && task.priority !== filters.priority) return false;

    if (filters.status === "open" && task.is_completed) return false;
    if (filters.status === "completed" && !task.is_completed) return false;

    return matchesDue(task, filters.due);
  });
}

export type ReminderSortOrder = "due_asc" | "due_desc" | "priority" | "recent";

export const REMINDER_SORT_OPTIONS: { value: ReminderSortOrder; label: string }[] = [
  { value: "due_asc", label: "Prazo mais próximo" },
  { value: "due_desc", label: "Prazo mais distante" },
  { value: "priority", label: "Prioridade" },
  { value: "recent", label: "Criados recentemente" },
];

export const DEFAULT_REMINDER_SORT: ReminderSortOrder = "due_asc";

export function isReminderSortOrder(value: unknown): value is ReminderSortOrder {
  return REMINDER_SORT_OPTIONS.some((o) => o.value === value);
}

function compareDue(a: PersonalTaskOverview, b: PersonalTaskOverview) {
  const dia = (a.due_date ?? "").localeCompare(b.due_date ?? "");
  if (dia !== 0) return dia;
  if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
  if (a.due_time !== b.due_time) return a.due_time ? -1 : 1;
  return 0;
}

const byPriority = (a: PersonalTaskOverview, b: PersonalTaskOverview) =>
  PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];

export function sortReminders(
  tasks: PersonalTaskOverview[],
  order: ReminderSortOrder = DEFAULT_REMINDER_SORT,
) {
  return [...tasks].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;

    if (order === "priority") {
      return byPriority(a, b) || (a.due_date && b.due_date ? compareDue(a, b) : 0);
    }

    if (order === "recent") {
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    }

    if (!a.due_date || !b.due_date) {
      if (a.due_date !== b.due_date) return a.due_date ? -1 : 1;
      return byPriority(a, b);
    }

    const prazo = order === "due_desc" ? compareDue(b, a) : compareDue(a, b);
    return prazo || byPriority(a, b);
  });
}
