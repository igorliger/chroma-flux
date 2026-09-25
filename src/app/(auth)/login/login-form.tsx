"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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

  // Com `<form action>`, o React 19 limpa o formulário inteiro depois de
  // cada envio — inclusive o e-mail. Por isso o envio é feito à mão (onSubmit
  // chamando a action), o que não dispara essa limpeza: com a senha errada,
  // o e-mail continua preenchido e só a senha precisa ser digitada de novo.
  const [emailDigitado, setEmailDigitado] = useState(email ?? "");
  const [enviando, startTransition] = useTransition();
  const senhaRef = useRef<HTMLInputElement>(null);

  // Errou: apaga só a senha e leva o cursor direto para ela.
  useEffect(() => {
    if (state.error && senhaRef.current) {
      senhaRef.current.value = "";
      if (emailDigitado) senhaRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const dados = new FormData(event.currentTarget);
        startTransition(() => formAction(dados));
      }}
      className="space-y-5"
    >
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

      <SubmitButton size="lg" className="w-full" loading={enviando}>
        Entrar
      </SubmitButton>
    </form>
  );
}
