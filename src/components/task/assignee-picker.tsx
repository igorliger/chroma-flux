"use client";

import { Avatar } from "@/components/ui";
import type { PersonRef } from "@/lib/database.types";
import { cn } from "@/lib/utils";

/**
 * Responsáveis da tarefa em caixas de seleção, com "Todos" no topo.
 *
 * A ordem de `selecionados` importa: o primeiro é o responsável principal
 * (`assignee_id`), os demais vão para `co_assignee_ids`. Quem é marcado
 * depois entra no fim da lista, então o principal só muda se for desmarcado.
 *
 * Sem "Atribuir tarefas a outras pessoas" (`podeOutros = false`), só a caixa
 * da própria pessoa fica habilitada — as outras aparecem, mas travadas, e
 * "Todos" some. O banco recusa qualquer outra coisa de todo jeito.
 */
export function AssigneePicker({
  people,
  selecionados,
  onChange,
  currentUserId,
  podeOutros,
  disabled = false,
}: {
  people: PersonRef[];
  selecionados: string[];
  onChange: (ids: string[]) => void;
  currentUserId: string;
  podeOutros: boolean;
  disabled?: boolean;
}) {
  const todosMarcados = people.length > 0 && people.every((p) => selecionados.includes(p.id));
  const algunsMarcados = !todosMarcados && selecionados.length > 0;

  function alternar(id: string) {
    onChange(
      selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id],
    );
  }

  function alternarTodos() {
    if (todosMarcados) {
      onChange([]);
      return;
    }
    // Mantém a ordem de quem já estava marcado (o principal continua o mesmo).
    onChange([...selecionados, ...people.map((p) => p.id).filter((id) => !selecionados.includes(id))]);
  }

  return (
    <div className="space-y-1">
      {podeOutros && people.length > 1 && (
        <label
          className={cn(
            "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium text-ink-800 hover:bg-ink-50",
            disabled && "cursor-default opacity-60",
          )}
        >
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-brand-600"
            checked={todosMarcados}
            ref={(el) => {
              if (el) el.indeterminate = algunsMarcados;
            }}
            disabled={disabled}
            onChange={alternarTodos}
          />
          Todos
        </label>
      )}

      {people.map((pessoa) => {
        const marcado = selecionados.includes(pessoa.id);
        const travado = disabled || (!podeOutros && pessoa.id !== currentUserId);
        const principal = selecionados[0] === pessoa.id && selecionados.length > 1;
        return (
          <label
            key={pessoa.id}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink-700",
              travado ? "cursor-default opacity-60" : "cursor-pointer hover:bg-ink-50",
            )}
          >
            <input
              type="checkbox"
              className="size-4 cursor-pointer accent-brand-600 disabled:cursor-default"
              checked={marcado}
              disabled={travado}
              onChange={() => alternar(pessoa.id)}
            />
            <Avatar id={pessoa.id} name={pessoa.full_name} email={pessoa.email} size="xs" />
            <span className="min-w-0 truncate">
              {pessoa.full_name || pessoa.email}
              {pessoa.id === currentUserId && <span className="text-ink-400"> (você)</span>}
            </span>
            {principal && (
              <span className="ml-auto shrink-0 text-[11px] text-ink-400">principal</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
