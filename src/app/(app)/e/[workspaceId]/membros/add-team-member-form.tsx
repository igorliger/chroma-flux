"use client";

import { useActionState, useEffect, useRef } from "react";
import { UserCheck } from "lucide-react";

import { addTeamMemberAction, type ActionState } from "@/app/actions/workspaces";
import { Field, FormError, FormSuccess, Select, SubmitButton } from "@/components/ui";
import { ROLES } from "@/lib/utils";

/**
 * Adiciona ao espaço, direto e sem e-mail, alguém que já entrou em outro
 * espaço do mesmo proprietário. O convite por e-mail é só para quem ainda
 * não faz parte da equipe.
 */
export function AddTeamMemberForm({
  workspaceId,
  pessoas,
}: {
  workspaceId: string;
  pessoas: { id: string; name: string; email: string }[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(addTeamMemberAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.success}</FormSuccess>

      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Pessoa" htmlFor="team-person">
          <Select id="team-person" name="userId" defaultValue="" required>
            <option value="" disabled>
              Escolha alguém da equipe…
            </option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.email && p.email !== p.name ? ` (${p.email})` : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Função" htmlFor="team-role">
          <Select id="team-role" name="role" defaultValue="member" className="sm:w-44">
            {ROLES.filter((r) => r.value !== "owner").map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        <SubmitButton>
          <UserCheck className="size-4" aria-hidden />
          Adicionar
        </SubmitButton>
      </div>
    </form>
  );
}
