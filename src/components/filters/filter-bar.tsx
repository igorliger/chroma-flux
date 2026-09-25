"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import { EMPTY_FILTERS, hasActiveFilters, type TaskFilters } from "@/lib/filters";
import { PRIORITIES } from "@/lib/utils";
import type { PersonRef } from "@/lib/database.types";

/**
 * Barra de busca e filtros.
 *
 * No celular os seletores viram uma linha rolável horizontalmente, para não
 * empurrar o conteúdo principal para fora da tela.
 */
export function FilterBar({
  filters,
  onChange,
  people,
  resultCount,
  totalCount,
}: {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  people: PersonRef[];
  resultCount: number;
  totalCount: number;
}) {
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const active = hasActiveFilters(filters);

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
            placeholder="Buscar tarefas…"
            aria-label="Buscar tarefas"
            className="h-9 pl-9"
          />
        </div>

        {active && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
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
          value={filters.assignee}
          onChange={(e) => set("assignee", e.target.value)}
          aria-label="Filtrar por responsável"
          className="h-9 w-auto min-w-36 shrink-0"
        >
          <option value="">Todos os responsáveis</option>
          <option value="none">Sem responsável</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name || person.email}
            </option>
          ))}
        </Select>

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
          onChange={(e) => set("status", e.target.value as TaskFilters["status"])}
          aria-label="Filtrar por situação"
          className="h-9 w-auto min-w-32 shrink-0"
        >
          <option value="all">Todas</option>
          <option value="open">Em aberto</option>
          <option value="completed">Concluídas</option>
        </Select>

        <Select
          value={filters.due}
          onChange={(e) => set("due", e.target.value as TaskFilters["due"])}
          aria-label="Filtrar por prazo"
          className="h-9 w-auto min-w-32 shrink-0"
        >
          <option value="all">Qualquer prazo</option>
          <option value="overdue">Atrasadas</option>
          <option value="today">Para hoje</option>
          <option value="week">Próximos 7 dias</option>
          <option value="none">Sem prazo</option>
        </Select>
      </div>
    </div>
  );
}
