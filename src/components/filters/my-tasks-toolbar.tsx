"use client";

import { ArrowUpDown, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";

import { SORT_OPTIONS, type SortOrder, type TaskFilters } from "@/lib/filters";
import { PRIORITIES, cn } from "@/lib/utils";
import type { PersonRef } from "@/lib/database.types";

/**
 * Busca e filtros de "Minhas tarefas" no visual novo: busca larga com
 * "Limpar" e a contagem "X de Y" ao lado; abaixo, os seletores.
 *
 * Os valores e o comportamento são os mesmos da `FilterBar` (mesmo
 * `TaskFilters`, mesmas opções) — muda só a disposição. A diferença de
 * comportamento é o "Limpar": aqui ele volta ao padrão da tela (`defaults`,
 * que abre só as tarefas em aberto), e não a "tudo".
 */
export function MyTasksToolbar({
  filters,
  defaults,
  onChange,
  people,
  resultCount,
  totalCount,
  sort,
  onSortChange,
}: {
  filters: TaskFilters;
  /** Valores que o "Limpar" restaura. */
  defaults: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  people: PersonRef[];
  resultCount: number;
  totalCount: number;
  /** Ordem da lista. Fica fora de `filters`: é preferência salva, e "Limpar" não mexe nela. */
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
}) {
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const noPadrao = (Object.keys(defaults) as (keyof TaskFilters)[]).every(
    (k) => filters[k] === defaults[k],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-stretch rounded-xl border border-ink-200 bg-surface flux-shadow focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Buscar tarefas</span>
          <Search className="pointer-events-none absolute left-4 size-5 text-ink-500" aria-hidden />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => set("search", e.target.value)}
            placeholder="Buscar tarefas..."
            className="h-12 w-full min-w-0 rounded-xl bg-transparent pl-12 pr-3 text-[15px] text-ink-900 placeholder:text-ink-500 focus:outline-none sm:h-14"
          />
        </label>

        <div className="flex shrink-0 items-center gap-1 border-l border-ink-200 pl-1 pr-2 sm:gap-2 sm:pl-2 sm:pr-4">
          <button
            type="button"
            onClick={() => onChange(defaults)}
            disabled={noPadrao}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-800 transition-colors hover:bg-ink-100 disabled:cursor-default disabled:text-ink-400 disabled:hover:bg-transparent"
          >
            <X className="size-4" aria-hidden />
            Limpar
            <span className="sr-only"> filtros</span>
          </button>

          <span className="hidden h-6 w-px bg-ink-200 sm:block" aria-hidden />

          <span
            className="whitespace-nowrap px-1 text-sm tabular-nums text-ink-700"
            aria-live="polite"
            aria-label={`${resultCount} de ${totalCount} tarefas`}
          >
            {resultCount} de {totalCount}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:flex xl:flex-wrap xl:items-center">
        <SlidersHorizontal className="hidden size-5 shrink-0 text-ink-500 xl:block" aria-hidden />

        <FilterSelect
          label="Filtrar por responsável"
          value={filters.assignee}
          onChange={(v) => set("assignee", v)}
          className="xl:min-w-52 xl:flex-[1.3]"
        >
          <option value="">Todos os responsáveis</option>
          <option value="none">Sem responsável</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name || person.email}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Filtrar por prioridade"
          value={filters.priority}
          onChange={(v) => set("priority", v)}
          className="xl:min-w-40 xl:flex-1"
        >
          <option value="">Toda prioridade</option>
          {PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label="Filtrar por situação"
          value={filters.status}
          onChange={(v) => set("status", v as TaskFilters["status"])}
          className="xl:min-w-40 xl:flex-1"
        >
          <option value="all">Todas</option>
          <option value="open">Em aberto</option>
          <option value="completed">Concluídas</option>
        </FilterSelect>

        <FilterSelect
          label="Filtrar por prazo"
          value={filters.due}
          onChange={(v) => set("due", v as TaskFilters["due"])}
          className="xl:min-w-40 xl:flex-1"
        >
          <option value="all">Qualquer prazo</option>
          <option value="overdue">Atrasadas</option>
          <option value="today">Para hoje</option>
          <option value="week">Próximos 7 dias</option>
          <option value="none">Sem prazo</option>
        </FilterSelect>

        <div className="col-span-2 flex items-center gap-2 sm:gap-3 xl:min-w-64 xl:flex-[1.3]">
          <ArrowUpDown className="size-5 shrink-0 text-ink-500" aria-hidden />
          <FilterSelect
            label="Ordenar tarefas"
            value={sort}
            onChange={(v) => onSortChange(v as SortOrder)}
            className="flex-1"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>
    </div>
  );
}

/** Seletor nativo (teclado e leitor de tela de graça) com a seta desenhada. */
function FilterSelect({
  label,
  value,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-11 w-full min-w-0 cursor-pointer appearance-none truncate rounded-xl border border-ink-200 bg-surface pl-4 pr-10 text-[15px] text-ink-900 transition-colors hover:border-ink-300 focus:border-brand-500 sm:h-12"
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-500"
        aria-hidden
      />
    </div>
  );
}
