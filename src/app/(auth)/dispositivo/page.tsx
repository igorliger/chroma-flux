import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { MonitorSmartphone } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import { DEVICE_COOKIE, deviceLabel } from "@/lib/devices";
import { requireUser } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

import { RequestDeviceButton } from "./request-device-button";

export const metadata: Metadata = { title: "Liberar este dispositivo" };

/**
 * Tela de quem entrou por um dispositivo ainda não liberado (recurso
 * opcional, migração 0033) — o middleware redireciona para cá. Daqui a
 * pessoa pede a liberação e espera um administrador aprovar.
 *
 * Se o dispositivo já estiver liberado (ou o recurso foi desligado), volta
 * para dentro do site.
 */
export default async function DispositivoPage() {
  await requireUser();
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value ?? "";
  const nome = deviceLabel((await headers()).get("user-agent"));

  const supabase = await createClient();
  const { data: situacao, error } = await supabase.rpc("device_status", {
    p_device_id: deviceId,
  });
  if (error || !situacao || situacao === "ok") redirect("/espacos");

  const textos = {
    unknown: {
      titulo: "Libere este dispositivo",
      texto:
        "Sua empresa pede que cada computador ou celular seja liberado por um administrador antes do primeiro uso.",
    },
    pending: {
      titulo: "Aguardando liberação",
      texto:
        "O pedido já foi enviado. Assim que um administrador liberar, é só recarregar a página.",
    },
    rejected: {
      titulo: "Dispositivo não liberado",
      texto:
        "Um administrador recusou o acesso por este dispositivo. Se foi engano, peça para ele rever e envie o pedido de novo.",
    },
  } as const;

  const t = textos[situacao as keyof typeof textos] ?? textos.unknown;

  return (
    <>
      <div className="mb-6 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <MonitorSmartphone className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{t.titulo}</h1>
          <p className="mt-2 text-sm text-ink-500">{t.texto}</p>
        </div>
      </div>

      <p className="mb-6 rounded-lg bg-ink-100 px-4 py-3 text-sm text-ink-700">
        Este dispositivo: <strong>{nome}</strong>
      </p>

      <div className="space-y-3">
        {situacao === "pending" ? (
          <Button variant="secondary" className="w-full" disabled>
            Pedido enviado
          </Button>
        ) : (
          <RequestDeviceButton reenviar={situacao === "rejected"} />
        )}

        <form action={signOutAction}>
          <Button type="submit" variant="ghost" className="w-full">
            Sair
          </Button>
        </form>
      </div>
    </>
  );
}
