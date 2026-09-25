"use client";

import { useActionState } from "react";
import Link from "next/link";

import { requestPasswordResetAction, type AuthState } from "@/app/actions/auth";
import { Field, FormError, FormSuccess, Input, SubmitButton } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [state, formAction] = useActionState<AuthState, FormData>(
    requestPasswordResetAction,
    {},
  );

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Recuperar senha
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Enviaremos um link para você definir uma nova senha.
        </p>
      </div>

      <form action={formAction} className="space-y-5">
        <FormError>{state.error}</FormError>
        <FormSuccess>{state.success}</FormSuccess>

        <Field label="E-mail" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="voce@empresa.com"
            required
          />
        </Field>

        <SubmitButton size="lg" className="w-full">
          Enviar link
        </SubmitButton>

        <p className="text-center text-sm text-ink-500">
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Voltar para o login
          </Link>
        </p>
      </form>
    </>
  );
}
