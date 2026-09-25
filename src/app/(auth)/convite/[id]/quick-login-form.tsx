"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";

import { quickInviteLoginAction, type InviteLoginState } from "@/app/actions/invite";
import { Field, FormError, Input, SubmitButton } from "@/components/ui";

export function QuickLoginForm({ invitationId, email }: { invitationId: string; email: string }) {
  const [state, formAction] = useActionState<InviteLoginState, FormData>(
    quickInviteLoginAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-5">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="invitationId" value={invitationId} />

      <Field label="E-mail" htmlFor="email">
        <Input id="email" type="email" value={email} readOnly className="bg-ink-50 text-ink-600" />
      </Field>

      <Field label="Seu nome" htmlFor="fullName" hint="Como você vai aparecer para a equipe.">
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          placeholder="Nome e sobrenome"
          maxLength={80}
        />
      </Field>

      <SubmitButton size="lg" className="w-full">
        <LogIn className="size-4" aria-hidden />
        Entrar agora
      </SubmitButton>
    </form>
  );
}
