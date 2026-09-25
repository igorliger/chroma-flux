"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type InviteLoginState = { error?: string };

/**
 * "Entrar agora" da página do convite: sem senha e sem segundo e-mail.
 *
 * A Edge Function `invite-login` (que tem a chave de serviço) confere que o
 * convite de equipe está pendente e devolve um token de uso único para o
 * e-mail convidado; aqui ele vira a sessão (cookies) e o convite é aceito na
 * hora — o que também faz o link deixar de valer.
 */
export async function quickInviteLoginAction(
  _prev: InviteLoginState,
  formData: FormData,
): Promise<InviteLoginState> {
  const id = z.string().uuid().safeParse(formData.get("invitationId"));
  if (!id.success) return { error: "Convite inválido." };
  const nome = String(formData.get("fullName") ?? "").trim().slice(0, 80);

  let resposta: { token_hash?: string; type?: string; novo?: boolean; error?: string };
  try {
    const r = await fetch(`${getSupabaseUrl()}/functions/v1/invite-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: getSupabasePublishableKey(),
      },
      body: JSON.stringify({ invitation_id: id.data, full_name: nome }),
      cache: "no-store",
    });
    resposta = await r.json().catch(() => ({ error: "Resposta inválida." }));
    if (!r.ok) return { error: resposta.error ?? "Não foi possível entrar pelo convite." };
  } catch {
    return { error: "Não foi possível falar com o servidor. Tente de novo." };
  }

  if (!resposta.token_hash || !resposta.type) {
    return { error: "Não foi possível entrar pelo convite." };
  }

  const supabase = await createClient();
  // Se alguém já estava logado neste navegador, sai antes: a sessão agora é
  // de quem foi convidado.
  await supabase.auth.signOut();

  const { error } = await supabase.auth.verifyOtp({
    token_hash: resposta.token_hash,
    type: resposta.type as "magiclink" | "invite",
  });
  if (error) return { error: "O acesso expirou. Recarregue a página e tente de novo." };

  await supabase.rpc("accept_my_team_invitations");

  // Primeira vez no Chroma Flux: sugere criar uma senha (dá para pular).
  redirect(resposta.novo ? "/conta/senha?primeiro=1" : "/espacos");
}
