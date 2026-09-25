"use client";

import { useActionState, useRef, useEffect } from "react";
import { UserPlus } from "lucide-react";

import { inviteMemberAction, type ActionState } from "@/app/actions/workspaces";
import { Field, FormError, FormSuccess, Input, Select, SubmitButton } from "@/components/ui";
import { ROLES } from "@/lib/utils";

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(inviteMemberAction, {});
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
        <Field label="E-mail" htmlFor="invite-email">
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder="colega@empresa.com"
            required
          />
        </Field>

        <Field label="Papel" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue="member" className="sm:w-44">
            {ROLES.filter((r) => r.value !== "owner").map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        <SubmitButton>
          <UserPlus className="size-4" aria-hidden />
          Convidar
        </SubmitButton>
      </div>
    </form>
  );
}
