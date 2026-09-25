"use client";

import { useActionState } from "react";

import { updateProfileAction, type AuthState } from "@/app/actions/auth";
import { Field, FormError, FormSuccess, Input, SubmitButton } from "@/components/ui";

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, formAction] = useActionState<AuthState, FormData>(updateProfileAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.success}</FormSuccess>

      <Field label="Nome" htmlFor="profile-name">
        <Input
          id="profile-name"
          name="fullName"
          defaultValue={fullName}
          maxLength={80}
          required
        />
      </Field>

      <Field label="E-mail" htmlFor="profile-email" hint="O e-mail de acesso não pode ser alterado por aqui.">
        <Input id="profile-email" value={email} disabled readOnly />
      </Field>

      <SubmitButton>Salvar perfil</SubmitButton>
    </form>
  );
}
