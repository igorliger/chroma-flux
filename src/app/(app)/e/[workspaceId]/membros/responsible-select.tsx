"use client";

import { Select } from "@/components/ui";
import type { PersonRef } from "@/lib/database.types";

/**
 * Seletor de quem responde pelo espaço.
 *
 * Envia na própria mudança, como o seletor de papel — a diferença é que aqui a
 * escolha muda quem enxerga as tarefas, então a tela avisa o efeito antes e
 * depois, e não só o rótulo do campo.
 */
export function ResponsibleSelect({
  defaultValue,
  people,
}: {
  defaultValue: string | null;
  people: PersonRef[];
}) {
  return (
    <Select
      name="responsibleId"
      defaultValue={defaultValue ?? ""}
      aria-label="Responsável pelo espaço de trabalho"
      className="h-9 w-full text-sm sm:w-64"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      <option value="">Ninguém — espaço compartilhado</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.full_name || person.email}
        </option>
      ))}
    </Select>
  );
}
