"use client";

import { useActionState, useEffect, useRef } from "react";
import { Send } from "lucide-react";

import { inviteToTeamAction, type TeamActionState } from "@/app/actions/team";
import { Field, FormError, FormSuccess, Input, Select, SubmitButton } from "@/components/ui";
import { ROLES, accentClass, cn } from "@/lib/utils";

const FUNCOES = ROLES.filter((r) => r.value !== "owner");

export function TeamInviteForm({
  workspaces,
}: {
  workspaces: { id: string; name: string; color: string }[];
}) {
  const [state, formAction] = useActionState<TeamActionState, FormData>(inviteToTeamAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.success}</FormSuccess>

      <Field label="E-mail" htmlFor="team-email">
        <Input
          id="team-email"
          name="email"
          type="email"
          placeholder="pessoa@empresa.com.br"
          required
        />
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-700">
          Espaços em que a pessoa já entra <span className="font-normal text-ink-400">(opcional — dá para mudar depois)</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {workspaces.map((w) => (
            <label
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-ink-800">
                <span className={cn("size-2 shrink-0 rounded-full", accentClass(w.color))} />
                <span className="truncate">{w.name}</span>
              </span>
              <Select name={`espaco:${w.id}`} defaultValue="" className="h-8 w-36 text-xs">
                <option value="">Sem acesso</option>
                {FUNCOES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton>
        <Send className="size-4" aria-hidden />
        Convidar
      </SubmitButton>
    </form>
  );
}
