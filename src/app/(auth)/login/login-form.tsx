"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { signInAction, type AuthState } from "@/app/actions/auth";
import { Field, FormError, Input, SubmitButton } from "@/components/ui";

export function LoginForm({
  next,
  initialError,
  email,
}: {
  next?: string;
  initialError?: string;
  /** Preenchido quando vem do link do convite. */
  email?: string;
}) {
  const [state, formAction] = useActionState<AuthState, FormData>(signInAction, {
    error: initialError,
  });

  // O React limpa o formulário depois de cada envio. Guardando o e-mail em
  // estado, ele continua preenchido quando a senha está errada — só a senha
  // precisa ser digitada de novo.
  const [emailDigitado, setEmailDigitado] = useState(email ?? "");
  const senhaRef = useRef<HTMLInputElement>(null);

  // Errou: leva o cursor direto para a senha.
  useEffect(() => {
    if (state.error && emailDigitado) senhaRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="proximo" value={next} />}

      <FormError>{state.error}</FormError>

      <Field label="E-mail" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          value={emailDigitado}
          onChange={(e) => setEmailDigitado(e.target.value)}
          autoComplete="email"
          placeholder="voce@empresa.com"
          required
        />
      </Field>

      <Field label="Senha" htmlFor="password">
        <Input
          ref={senhaRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </Field>

      <div className="flex justify-end">
        <Link
          href="/recuperar-senha"
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Esqueci minha senha
        </Link>
      </div>

      <SubmitButton size="lg" className="w-full">
        Entrar
      </SubmitButton>
    </form>
  );
}
