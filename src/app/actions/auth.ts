"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { translateAuthError } from "@/lib/auth-errors";
import { sendPasswordCodeEmail } from "@/lib/email";
import { gerarCodigo, hmacDoCodigo } from "@/lib/password-code";
import { getSiteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error?: string; success?: string };

const emailSchema = z.string().trim().toLowerCase().email("Informe um e-mail válido.");

const signUpSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Informe seu nome completo.")
    .max(80, "Nome muito longo."),
  email: emailSchema,
  password: z
    .string()
    .min(8, "A senha precisa de pelo menos 8 caracteres.")
    .max(72, "A senha pode ter no máximo 72 caracteres."),
});

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha."),
});


export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${getSiteUrl()}/auth/callback`,
    },
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  // Com "Confirm email" ligado no Supabase, não há sessão ainda.
  if (!data.session) {
    return {
      success:
        "Conta criada. Enviamos um link de confirmação para o seu e-mail — abra-o para ativar o acesso.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/espacos");
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  const next = formData.get("proximo");
  const target = typeof next === "string" && next.startsWith("/") ? next : "/espacos";

  revalidatePath("/", "layout");
  redirect(target);
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function requestPasswordResetAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${getSiteUrl()}/auth/callback?proximo=/conta/senha`,
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  // Resposta idêntica exista ou não a conta, para não revelar quem é cadastrado.
  return {
    success: "Se houver uma conta com esse e-mail, enviamos um link de redefinição.",
  };
}

const newPasswordSchema = z
  .object({
    password: z.string().min(8, "A senha precisa de pelo menos 8 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "As senhas não coincidem.",
  });

export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  redirect("/espacos");
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Informe seu nome.").max(80, "Nome muito longo."),
});

export async function updateProfileAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = profileSchema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Sessão expirada. Entre novamente." };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: "Perfil atualizado." };
}

/** Mostra o e-mail pela metade: "igo***@chromatechnology.com.br". */
function mascararEmail(email: string) {
  const [nome, dominio] = email.split("@");
  return `${nome.slice(0, 3)}***@${dominio}`;
}

/** Passo 1 de "Alterar senha": manda o código de 6 dígitos para o e-mail da conta. */
export async function requestPasswordCodeAction(): Promise<AuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "Sessão expirada. Entre de novo." };

  let codigo: string;
  try {
    codigo = gerarCodigo();
    const { error } = await supabase.rpc("set_password_code", {
      p_hmac: hmacDoCodigo(user.id, codigo),
    });
    if (error) {
      return {
        error: error.message.includes("Aguarde")
          ? error.message
          : "Não foi possível gerar o código. Tente de novo.",
      };
    }
  } catch {
    return { error: "O envio de e-mails não está configurado no servidor." };
  }

  const envio = await sendPasswordCodeEmail({ to: user.email, code: codigo });
  if (!envio.sent) return { error: "Não foi possível enviar o e-mail com o código. Tente de novo." };

  return { success: `Enviamos um código para ${mascararEmail(user.email)}.` };
}

const changePasswordSchema = z
  .object({
    code: z.string().trim().regex(/^\d{6}$/, "O código tem 6 números."),
    password: z
      .string()
      .min(8, "A nova senha precisa de pelo menos 8 caracteres.")
      .max(72, "A senha pode ter no máximo 72 caracteres."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "As senhas não coincidem." });

/** Passo 2: com o código certo, troca a senha. */
export async function changePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = changePasswordSchema.safeParse({
    code: formData.get("code"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre de novo." };

  let resultado: string | null = null;
  try {
    const { data } = await supabase.rpc("check_password_code", {
      p_hmac: hmacDoCodigo(user.id, parsed.data.code),
    });
    resultado = data;
  } catch {
    return { error: "O envio de e-mails não está configurado no servidor." };
  }

  if (resultado === "invalido") return { error: "Código incorreto. Confira o e-mail e tente de novo." };
  if (resultado === "tentativas") return { error: "Muitas tentativas erradas. Peça um novo código." };
  if (resultado !== "ok") return { error: "O código expirou. Peça um novo." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: translateAuthError(error.message) };

  return { success: "Senha alterada." };
}
