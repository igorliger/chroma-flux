"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";
import { DEVICE_COOKIE, deviceLabel } from "@/lib/devices";

export type DeviceResult = { error?: string; success?: string };

const uuid = z.string().uuid();

/** Mensagem legível; recusas do banco que começam com "Você " vêm prontas. */
function amigavel(message?: string) {
  if (message?.startsWith("Você ")) return message;
  if (message?.includes("device_status") || message?.includes("does not exist")) {
    return "Este recurso ainda não foi instalado no banco de dados (migração 0033).";
  }
  return message ?? "Não foi possível concluir a operação.";
}

/** Pede a liberação deste navegador aos administradores. */
export async function requestDeviceAction(): Promise<DeviceResult> {
  await requireUser();
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!deviceId) return { error: "Recarregue a página e tente de novo." };

  const label = deviceLabel((await headers()).get("user-agent"));
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_device_approval", {
    p_device_id: deviceId,
    p_label: label,
  });
  if (error) return { error: amigavel(error.message) };

  revalidatePath("/dispositivo");
  return { success: "Pedido enviado." };
}

/** Liga ou desliga a exigência — só o proprietário, pela RLS. */
export async function setDeviceApprovalAction(enabled: boolean): Promise<DeviceResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("device_approval_settings")
    .upsert({ owner_id: user.id, enabled, updated_at: new Date().toISOString() });
  if (error) return { error: amigavel(error.message) };

  revalidatePath("/configuracoes");
  return { success: enabled ? "Liberação por dispositivo ligada." : "Liberação por dispositivo desligada." };
}

export async function decideDeviceAction(id: string, approve: boolean): Promise<DeviceResult> {
  if (!uuid.safeParse(id).success) return { error: "Pedido inválido." };
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_device", { p_id: id, p_approve: approve });
  if (error) return { error: amigavel(error.message) };

  revalidatePath("/configuracoes");
  return { success: approve ? "Dispositivo liberado." : "Pedido recusado." };
}

export async function removeDeviceAction(id: string): Promise<DeviceResult> {
  if (!uuid.safeParse(id).success) return { error: "Dispositivo inválido." };
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_device", { p_id: id });
  if (error) return { error: amigavel(error.message) };

  revalidatePath("/configuracoes");
  return { success: "Dispositivo removido." };
}
