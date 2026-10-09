"use client";

import { ArrowUpDown, Search, X } from "lucide-react";

import { Button, Input, Select } from "@/components/ui";
import {
  EMPTY_FILTERS,
  SORT_OPTIONS,
  hasActiveFilters,
  type SortOrder,
  type TaskFilters,
} from "@/lib/filters";
import { PRIORITIES, cn } from "@/lib/utils";
import type { PersonRef } from "@/lib/database.types";

/**
 * Barra de busca e filtros.
 *
 * Linha 1: busca, contagem "X de Y tarefas" e, à direita, as ações da tela
 * (`acoes`, ex.: "Selecionar"). Linha 2: filtros, "Limpar" (só com filtro
 * ativo) e a ordenação. No celular os seletores viram uma linha rolável,
 * para não empurrar o conteúdo para fora da tela.
 */
export function FilterBar({
  filters,
  onChange,
  people,
  resultCount,
  totalCount,
  sort,
  onSortChange,
  acoes,
}: {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  people: PersonRef[];
  resultCount: number;
  totalCount: number;
  /** Ordem da lista. Fica fora de `filters`: "Limpar" não mexe nela. */
  sort?: SortOrder;
  onSortChange?: (sort: SortOrder) => void;
  /** Botões à direita da busca. */
  acoes?: React.ReactNode;
}) {
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const active = hasActiveFilters(filters);
  // No celular cada seletor ocupa metade da linha; a partir de `sm`, o
  // tamanho do próprio texto. A linha quebra quando não cabe — nunca rola de
  // lado nem corta a ordenação.
  const campo = "h-10 min-w-0 flex-1 basis-[45%] rounded-xl sm:w-auto sm:flex-none sm:basis-auto";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative min-w-48 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400"
            aria-hidden
          />
          <Input
            type="search"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Buscar tarefas..."
            aria-label="Buscar tarefas"
            className="h-11 pl-10"
          />
        </div>

        <span className="whitespace-nowrap text-sm tabular-nums text-ink-500" aria-live="polite">
          {resultCount} de {totalCount} {totalCount === 1 ? "tarefa" : "tarefas"}
        </span>

        {acoes && <div className="ml-auto flex shrink-0 items-center gap-2">{acoes}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.assignee}
          onChange={(e) => set("assignee", e.target.value)}
          aria-label="Filtrar por responsável"
          className={cn(campo, "sm:max-w-56")}
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
          className={campo}
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
          className={campo}
        >
          <option value="all">Todas</option>
          <option value="open">Em aberto</option>
          <option value="completed">Concluídas</option>
        </Select>

        <Select
          value={filters.due}
          onChange={(e) => set("due", e.target.value as TaskFilters["due"])}
          aria-label="Filtrar por prazo"
          className={campo}
        >
          <option value="all">Qualquer prazo</option>
          <option value="overdue">Atrasadas</option>
          <option value="today">Para hoje</option>
          <option value="week">Próximos 7 dias</option>
          <option value="none">Sem prazo</option>
        </Select>

        {active && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="h-10 shrink-0"
          >
            <X className="size-4" aria-hidden />
            Limpar
            <span className="sr-only"> filtros</span>
          </Button>
        )}

        {sort && onSortChange && (
          <>
            <span className="flex basis-full items-center gap-2 sm:basis-auto">
              <span className="mx-1 hidden h-6 w-px shrink-0 bg-ink-200 sm:block" aria-hidden />
            <ArrowUpDown className="size-4 shrink-0 text-ink-500" aria-hidden />
            <Select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortOrder)}
              aria-label="Ordenar tarefas"
              className={campo}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
