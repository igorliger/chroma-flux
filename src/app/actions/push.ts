"use server";

import { z } from "zod";

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const assinaturaSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
  userAgent: z.string().max(500).optional(),
});

/** Guarda a assinatura deste navegador em nome de quem está logado. */
export async function registerPushSubscriptionAction(
  dados: unknown,
): Promise<{ error?: string }> {
  const parsed = assinaturaSchema.safeParse(dados);
  if (!parsed.success) return { error: "Assinatura de notificação inválida." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.p256dh,
    p_auth: parsed.data.auth,
    p_user_agent: parsed.data.userAgent ?? "",
  });

  if (error) return { error: "Não foi possível ativar as notificações. Tente de novo." };
  return {};
}

/** Para de enviar para este navegador. */
export async function unregisterPushSubscriptionAction(
  endpoint: string,
): Promise<{ error?: string }> {
  if (!endpoint) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { error: "Não foi possível desativar as notificações." };
  return {};
}

/** Manda uma notificação de teste para todos os dispositivos de quem pediu. */
export async function sendTestPushAction(): Promise<{ error?: string; enviados?: number }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: "Sessão expirada. Entre de novo." };

  try {
    const resposta = await fetch(`${getSupabaseUrl()}/functions/v1/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: getSupabasePublishableKey(),
      },
      body: JSON.stringify({ type: "test" }),
      cache: "no-store",
    });
    const corpo = (await resposta.json().catch(() => ({}))) as {
      enviados?: number;
      error?: string;
    };
    if (!resposta.ok) return { error: corpo.error ?? "Falha ao enviar o teste." };
    return { enviados: corpo.enviados ?? 0 };
  } catch {
    return { error: "Não foi possível falar com o serviço de notificações." };
  }
}
