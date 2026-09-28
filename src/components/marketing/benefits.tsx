import { BarChart3, ListChecks, ShieldCheck, Users } from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";

const ITEMS = [
  {
    icon: ListChecks,
    title: "Gestão de tarefas",
    text: "sem complicação",
  },
  {
    icon: Users,
    title: "Equipe mais",
    text: "alinhada",
  },
  {
    icon: ShieldCheck,
    title: "Processos",
    text: "padronizados",
  },
  {
    icon: BarChart3,
    title: "Acompanhamento",
    text: "de resultados",
  },
];

export function Benefits() {
  return (
    <section className="relative -mt-4 border-t border-white/[0.04] bg-[#090a0f] pb-16 pt-10 sm:pb-20">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-3 px-5 sm:gap-4 sm:px-6 lg:grid-cols-4">
        {ITEMS.map(({ icon: Icon, title, text }, i) => (
          <Reveal key={title} delayMs={i * 80}>
            <div className="group h-full rounded-[14px] border border-white/[0.06] bg-[#111420] p-5 transition-all duration-200 hover:-translate-y-[3px] hover:border-violet-400/25">
              <span className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300">
                <Icon className="size-5" aria-hidden />
              </span>
              <p className="mt-4 font-semibold text-white">{title}</p>
              <p className="text-sm text-white/45">{text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
