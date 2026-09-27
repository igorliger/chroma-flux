"use client";

import { ArrowUpDown, Search, SlidersHorizontal, X } from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import {
  EMPTY_REMINDER_FILTERS,
  REMINDER_SORT_OPTIONS,
  hasActiveReminderFilters,
  type ReminderFilters,
  type ReminderSortOrder,
} from "@/lib/reminder-filters";
import { PRIORITIES } from "@/lib/utils";

/**
 * Busca e filtros da lista de lembretes pessoais — mesmo desenho de
 * `components/filters/filter-bar.tsx`, sem o seletor de responsável (aqui só
 * há um dono, que é quem está olhando).
 */
export function ReminderFilterBar({
  filters,
  onChange,
  resultCount,
  totalCount,
  sort,
  onSortChange,
}: {
  filters: ReminderFilters;
  onChange: (filters: ReminderFilters) => void;
  resultCount: number;
  totalCount: number;
  sort?: ReminderSortOrder;
  onSortChange?: (sort: ReminderSortOrder) => void;
}) {
  const set = <K extends keyof ReminderFilters>(key: K, value: ReminderFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const active = hasActiveReminderFilters(filters);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            aria-hidden
          />
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Buscar lembretes…"
            aria-label="Buscar lembretes"
            className="h-9 pl-9"
          />
        </div>

        {active && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_REMINDER_FILTERS)}>
            <X className="size-3.5" aria-hidden />
            Limpar
          </Button>
        )}

        {active && (
          <span className="text-sm text-ink-500">
            {resultCount} de {totalCount}
          </span>
        )}
      </div>

      <div className="-mx-1 flex items-center gap-2 overflow-x-auto scrollbar-slim px-1 pb-1">
        <SlidersHorizontal className="size-4 shrink-0 text-ink-400" aria-hidden />

        <Select
          value={filters.priority}
          onChange={(e) => set("priority", e.target.value)}
          aria-label="Filtrar por prioridade"
          className="h-9 w-auto min-w-32 shrink-0"
        >
          <option value="">Toda prioridade</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>

        <Select
          value={filters.status}
          onChange={(e) => set("status", e.target.value as ReminderFilters["status"])}
          aria-label="Filtrar por situação"
          className="h-9 w-auto min-w-32 shrink-0"
        >
          <option value="all">Todos</option>
          <option value="open">Em aberto</option>
          <option value="completed">Concluídos</option>
        </Select>

        <Select
          value={filters.due}
          onChange={(e) => set("due", e.target.value as ReminderFilters["due"])}
          aria-label="Filtrar por prazo"
          className="h-9 w-auto min-w-32 shrink-0"
        >
          <option value="all">Qualquer prazo</option>
          <option value="overdue">Atrasados</option>
          <option value="today">Para hoje</option>
          <option value="week">Próximos 7 dias</option>
          <option value="none">Sem prazo</option>
        </Select>

        {sort && onSortChange && (
          <>
            <ArrowUpDown className="ml-2 size-4 shrink-0 text-ink-400" aria-hidden />
            <Select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as ReminderSortOrder)}
              aria-label="Ordenar lembretes"
              className="h-9 w-auto min-w-40 shrink-0"
            >
              {REMINDER_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  Ordenar: {o.label}
                </option>
              ))}
            </Select>
          </>
        )}
      </div>
    </div>
  );
}
