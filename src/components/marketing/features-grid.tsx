import {
  Bell,
  CalendarDays,
  Flag,
  ListTree,
  MessageSquare,
  Search,
  Trello,
  Users,
} from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

/**
 * Recursos reais do Chroma Flux — nada aqui é inventado. Cada item existe
 * hoje no produto (ver `CLAUDE.md` e as telas de tarefa, espaço e calendário).
 */
const FEATURES: {
  icon: typeof ListTree;
  title: string;
  text: string;
  span: string;
}[] = [
  {
    icon: ListTree,
    title: "Tarefas e subtarefas",
    text: "Responsável, prioridade, prazo com hora e repetição — tudo no mesmo lugar, com quantos níveis a equipe precisar.",
    span: "sm:col-span-2 sm:row-span-2",
  },
  {
    icon: Users,
    title: "Espaços de trabalho",
    text: "Cada equipe no seu espaço, com papéis e permissões independentes.",
    span: "sm:col-span-2",
  },
  {
    icon: Trello,
    title: "Quadro Kanban",
    text: "Arraste as tarefas entre colunas e acompanhe o andamento visualmente.",
    span: "",
  },
  {
    icon: Bell,
    title: "Notificações",
    text: "Aviso no navegador e no celular quando um prazo está chegando.",
    span: "",
  },
  {
    icon: Search,
    title: "Busca e filtros",
    text: "Encontre qualquer tarefa por responsável, prioridade, prazo ou pelo próprio texto.",
    span: "sm:col-span-2",
  },
  {
    icon: Flag,
    title: "Prioridades e prazos",
    text: "Do baixo ao urgente, com atraso destacado na lista.",
    span: "",
  },
  {
    icon: MessageSquare,
    title: "Comentários e anexos",
    text: "A conversa e os arquivos da tarefa ficam junto dela.",
    span: "",
  },
  {
    icon: CalendarDays,
    title: "Calendário",
    text: "Todos os prazos do espaço, numa visão de mês.",
    span: "",
  },
];

export function FeaturesGrid() {
  return (
    <section id="recursos" className="bg-[#090a0f] py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Tudo o que sua equipe precisa para trabalhar melhor.
          </h2>
          <p className="mt-4 text-white/55">
            Centralize tarefas, prazos e comunicação em um único lugar.
          </p>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-4 sm:[grid-auto-flow:dense]">
          {FEATURES.map(({ icon: Icon, title, text, span }, i) => (
            <Reveal key={title} delayMs={(i % 4) * 70} className={span}>
              <div
                className={cn(
                  "flex h-full flex-col rounded-2xl border border-white/[0.06] bg-[#121522] p-6 transition-colors duration-200 hover:border-violet-400/20",
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-white/50">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
