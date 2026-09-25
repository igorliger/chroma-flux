"use client";

import { useActionState } from "react";

import { updatePasswordAction, type AuthState } from "@/app/actions/auth";
import { Field, FormError, Input, SubmitButton } from "@/components/ui";

export default function NewPasswordPage() {
  const [state, formAction] = useActionState<AuthState, FormData>(updatePasswordAction, {});

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Definir nova senha
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Escolha uma senha para voltar a acessar sua conta.
        </p>
      </div>

      <form action={formAction} className="space-y-5">
        <FormError>{state.error}</FormError>

        <Field label="Nova senha" htmlFor="password" hint="Mínimo de 8 caracteres.">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <Field label="Confirmar senha" htmlFor="confirm">
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <SubmitButton size="lg" className="w-full">
          Salvar senha
        </SubmitButton>
      </form>
    </>
  );
}
