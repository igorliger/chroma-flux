import { Bell, CheckCircle2, Circle } from "lucide-react";

import { Reveal } from "@/components/marketing/reveal";

function PhoneMockup() {
  const itens = [
    { titulo: "Confirmar presença na reunião", feito: false },
    { titulo: "Enviar orçamento atualizado", feito: false },
    { titulo: "Aprovar arte da campanha", feito: true },
  ];

  return (
    <div className="relative mx-auto w-[220px] sm:w-[240px]" aria-hidden="true">
      {/* Sugestão de tela de computador atrás, para reforçar "computador + celular". */}
      <div className="absolute -left-16 top-10 hidden h-40 w-64 rounded-xl border border-white/10 bg-[#12141f] opacity-60 blur-[1px] sm:block" />

      <div className="relative rounded-[2rem] border-4 border-[#1c1f2e] bg-[#0d0f1a] p-2 shadow-2xl shadow-black/50">
        <div className="mx-auto mb-1.5 h-1 w-10 rounded-full bg-white/15" />
        <div className="rounded-[1.4rem] bg-[#12141f] p-3.5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white/70">Minhas tarefas</span>
            <Bell className="size-3.5 text-violet-300" />
          </div>
          <ul className="space-y-2">
            {itens.map((item) => (
              <li
                key={item.titulo}
                className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2"
              >
                {item.feito ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <Circle className="size-3.5 shrink-0 text-white/20" aria-hidden />
                )}
                <span
                  className={`truncate text-[11px] ${item.feito ? "text-white/30 line-through" : "text-white/80"}`}
                >
                  {item.titulo}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function MobileSection() {
  return (
    <section className="relative overflow-hidden bg-[#090a0f] py-20 sm:py-28">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-full bg-[linear-gradient(180deg,_rgba(91,75,255,0.08),_transparent_45%)]" />

      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal className="order-2 lg:order-1">
            <PhoneMockup />
          </Reveal>

          <Reveal delayMs={100} className="order-1 text-center lg:order-2 lg:text-left">
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              Seu trabalho acompanha você.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[17px] leading-relaxed text-white/55 lg:mx-0">
              Acesse tarefas, espaços e atualizações pelo computador ou pelo celular — com
              aviso na hora certa, mesmo com o site fechado.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
