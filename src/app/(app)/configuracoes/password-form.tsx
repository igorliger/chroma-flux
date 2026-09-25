"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Mail } from "lucide-react";

import {
  changePasswordAction,
  requestPasswordCodeAction,
  type AuthState,
} from "@/app/actions/auth";
import { Button, Field, FormError, FormSuccess, Input, SubmitButton } from "@/components/ui";

/**
 * Alterar senha em dois passos: primeiro um código de 6 dígitos vai para o
 * e-mail da conta; depois, com o código, a pessoa define a nova senha. Serve
 * também para quem entrou pelo convite e ainda não tem senha.
 */
export function PasswordForm() {
  const [envio, setEnvio] = useState<AuthState>({});
  const [enviando, startEnvio] = useTransition();
  const [state, formAction] = useActionState<AuthState, FormData>(changePasswordAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [codigoEnviado, setCodigoEnviado] = useState(false);

  function pedirCodigo() {
    startEnvio(async () => {
      const r = await requestPasswordCodeAction();
      setEnvio(r);
      if (r.success) setCodigoEnviado(true);
    });
  }

  // Senha trocada: limpa os campos e volta ao começo.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setCodigoEnviado(false);
      setEnvio({});
    }
  }, [state]);

  if (!codigoEnviado) {
    return (
      <div className="space-y-3">
        <FormSuccess>{state.success}</FormSuccess>
        <FormError>{envio.error}</FormError>
        <Button onClick={pedirCodigo} loading={enviando}>
          <Mail className="size-4" aria-hidden />
          Enviar código para meu e-mail
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <FormSuccess>{envio.success}</FormSuccess>
      <FormError>{state.error ?? envio.error}</FormError>

      <Field label="Código recebido por e-mail" htmlFor="pw-code" hint="6 números · vale por 10 minutos.">
        <Input
          id="pw-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="000000"
          className="max-w-40 text-center font-mono tracking-[0.4em]"
          required
          autoFocus
        />
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

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>Alterar senha</SubmitButton>
        <Button type="button" variant="ghost" onClick={pedirCodigo} loading={enviando}>
          Reenviar código
        </Button>
        <Button type="button" variant="ghost" onClick={() => setCodigoEnviado(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
