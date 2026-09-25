import type { Metadata } from "next";
import { Clock } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import { amIBlockedByAccessWindow, getMyBlockingWindow } from "@/lib/queries";
import { WEEKDAYS } from "@/lib/recurrence";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Fora do horário" };

/**
 * Tela mostrada no lugar do site inteiro para quem está fora da janela de
 * uso do grupo (ou da janela pessoal do dono, se não estiver em nenhum
 * grupo) — ver o middleware, que redireciona para cá.
 *
 * Se a pessoa não estiver mais bloqueada (a janela mudou, ou o horário
 * virou enquanto ela estava com a aba aberta), manda de volta para dentro —
 * essa checagem dupla evita prender alguém aqui depois que o bloqueio já
 * não vale mais.
 */
export default async function ForaDoHorarioPage() {
  const bloqueado = await amIBlockedByAccessWindow();
  if (!bloqueado) redirect("/espacos");

  const janela = await getMyBlockingWindow();

  const dias = (janela?.weekdays ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.plural)
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <div className="mb-8 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warn-bg text-warn-fg">
          <Clock className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Fora do horário de uso
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Sua conta só pode acessar o Chroma Flux dentro do horário combinado.
          </p>
        </div>
      </div>

      {janela && (
        <p className="mb-6 rounded-lg bg-ink-100 px-4 py-3 text-sm text-ink-700">
          Acesso liberado {dias || "em dias combinados"}, das{" "}
          <strong>{janela.startsAt}</strong> às <strong>{janela.endsAt}</strong> (
          {janela.timezone.replace("_", " ")}).
        </p>
      )}

      <form action={signOutAction}>
        <Button type="submit" variant="secondary" className="w-full">
          Sair
        </Button>
      </form>
    </>
  );
}
