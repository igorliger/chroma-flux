"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";

import { changePasswordAction, type AuthState } from "@/app/actions/auth";
import { Field, FormError, FormSuccess, Input, SubmitButton } from "@/components/ui";

export function PasswordForm() {
  const [state, formAction] = useActionState<AuthState, FormData>(changePasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Senha trocada: limpa os campos para não ficarem preenchidos na tela.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.success}</FormSuccess>

      <Field label="Senha atual" htmlFor="pw-current">
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nova senha" htmlFor="pw-new" hint="Mínimo de 8 caracteres.">
          <Input
            id="pw-new"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
        </Field>
        <Field label="Confirmar nova senha" htmlFor="pw-confirm">
          <Input
            id="pw-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Alterar senha</SubmitButton>
        <p className="text-xs text-ink-500">
          Entrou pelo convite e ainda não tem senha?{" "}
          <Link href="/conta/senha?primeiro=1" className="font-medium text-brand-600 hover:text-brand-700">
            Criar senha
          </Link>
        </p>
      </div>
    </form>
  );
}
