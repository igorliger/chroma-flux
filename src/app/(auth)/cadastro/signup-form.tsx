"use client";

import { useActionState } from "react";

import { signUpAction, type AuthState } from "@/app/actions/auth";
import { Field, FormError, FormSuccess, Input, SubmitButton } from "@/components/ui";

export function SignUpForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(signUpAction, {});

  if (state.success) {
    return <FormSuccess>{state.success}</FormSuccess>;
  }

  return (
    <form action={formAction} className="space-y-5">
      <FormError>{state.error}</FormError>

      <Field label="Nome completo" htmlFor="fullName">
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          placeholder="Maria Silva"
          required
        />
      </Field>

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

      <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          required
        />
      </Field>

      <SubmitButton size="lg" className="w-full">
        Criar conta
      </SubmitButton>
    </form>
  );
}
