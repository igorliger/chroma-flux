import type { Metadata } from "next";
import { Moon } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui";
import { amIBlockedByAccessWindow, getMyBlockingWindow } from "@/lib/queries";
import { WEEKDAYS } from "@/lib/recurrence";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Até o próximo expediente" };

/**
 * Descreve os dias em linguagem natural: "de segunda a sexta" para dias
 * seguidos, "segunda, quarta e sexta" para dias soltos, "todos os dias"
 * para a semana inteira.
 */
function descreverDias(weekdays: number[]): string {
  const dias = [...new Set(weekdays)].sort((a, b) => a - b);
  if (dias.length === 0) return "";
  if (dias.length === 7) return "todos os dias";

  const nome = (d: number) => WEEKDAYS.find((w) => w.value === d)?.label ?? "";

  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (seguidos && dias.length >= 3) {
    return `de ${nome(dias[0])} a ${nome(dias[dias.length - 1])}`;
  }

  const nomes = dias.map(nome);
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * Tela mostrada no lugar do site para quem está fora do horário de trabalho
 * do seu grupo de acesso — ver o middleware, que redireciona para cá.
 *
 * O tom é de "bom descanso", não de bloqueio: quem cai aqui é funcionário
 * fora do expediente, não alguém fazendo algo errado.
 *
 * Se a pessoa não estiver mais bloqueada (a janela mudou, ou o horário
 * virou enquanto ela estava com a aba aberta), manda de volta para dentro.
 */
export default async function ForaDoHorarioPage() {
  const bloqueado = await amIBlockedByAccessWindow();
  if (!bloqueado) redirect("/espacos");

  const janela = await getMyBlockingWindow();
  const dias = janela ? descreverDias(janela.weekdays) : "";

  return (
    <>
      <div className="mb-8 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Moon className="size-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Até o próximo expediente!
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Agora é hora de descansar. O Chroma Flux fica disponível para você
            no seu horário de trabalho.
          </p>
        </div>
      </div>

      {janela && (
        <p className="mb-6 rounded-lg bg-ink-100 px-4 py-3 text-sm text-ink-700">
          Seu horário: {dias && <>{dias}, </>}das <strong>{janela.startsAt}</strong> às{" "}
          <strong>{janela.endsAt}</strong>.
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
