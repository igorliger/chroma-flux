"use client";

import { Select } from "@/components/ui";
import { ROLES } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/database.types";

/**
 * Seletor de papel do membro.
 *
 * Envia o formulário na própria mudança — um botão "salvar" por linha seria
 * ruído numa lista.
 *
 * Opções impossíveis chegam desabilitadas em vez de ausentes: quem olha
 * precisa entender *por que* não pode rebaixar o último proprietário, e uma
 * opção que some não explica nada. O banco recusaria de qualquer forma; a
 * interface só evita a tentativa.
 */
export function RoleSelect({
  defaultValue,
  nome,
  disabledValues = [],
  title,
}: {
  defaultValue: WorkspaceRole;
  nome: string;
  disabledValues?: WorkspaceRole[];
  title?: string;
}) {
  return (
    <Select
      name="role"
      defaultValue={defaultValue}
      aria-label={`Papel de ${nome}`}
      title={title}
      className="h-9 w-40 text-sm"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      {ROLES.map((role) => (
        <option
          key={role.value}
          value={role.value}
          disabled={disabledValues.includes(role.value)}
        >
          {role.label}
        </option>
      ))}
    </Select>
  );
}
