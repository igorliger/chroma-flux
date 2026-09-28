import Link from "next/link";

import { DemoButton } from "@/components/marketing/demo-button";
import { PRODUCT_MOCKUP_WIDTH, ProductMockup } from "@/components/marketing/product-mockup";
import { Reveal } from "@/components/marketing/reveal";
import { ScaleToFit } from "@/components/marketing/scale-to-fit";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Fundo do hero: quase preto à esquerda, degradê violeta escuro à
          direita — a "onda" fica atrás de tudo, só para dar profundidade. */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[#090a0f]" />
        <div className="absolute inset-y-0 right-0 w-[70%] bg-[linear-gradient(135deg,_rgba(91,75,255,0.16),_rgba(139,92,246,0.08)_55%,_transparent_80%)]" />
        <div className="absolute -right-40 top-[-10%] size-[42rem] rounded-full bg-[radial-gradient(circle,_rgba(91,75,255,0.22),_transparent_70%)] blur-3xl" />
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-20 pt-10 sm:px-6 sm:pb-28 sm:pt-14 lg:pb-32">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[45%_55%] lg:gap-8">
          {/* Texto */}
          <Reveal>
            <span className="inline-flex items-center rounded-full border border-violet-400/20 bg-violet-500/10 px-3.5 py-1.5 text-xs font-medium text-violet-300">
              Planejamento • Execução • Resultados
            </span>

            <h1 className="mt-5 text-[clamp(2.4rem,7vw,4.5rem)] font-extrabold leading-[1.03] tracking-tight text-white">
              Transforme planejamento em{" "}
              <span className="bg-gradient-to-r from-[#8B7CFF] to-[#B794FF] bg-clip-text text-transparent">
                resultados.
              </span>
            </h1>

            <p className="mt-6 max-w-[550px] text-lg leading-relaxed text-white/60">
              O Chroma Flux ajuda sua empresa a organizar tarefas, prazos e processos e
              manter toda a equipe no mesmo ritmo.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/cadastro"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-gradient-to-r from-[#5B4BFF] via-[#765DFF] to-[#8B5CF6] px-7 text-[15px] font-semibold text-white shadow-lg shadow-violet-900/40 transition-transform hover:scale-[1.03] sm:h-[54px]"
              >
                Começar agora
              </Link>
              <DemoButton />
            </div>
          </Reveal>

          {/* Mockup do produto */}
          <Reveal delayMs={150}>
            <ScaleToFit designWidth={PRODUCT_MOCKUP_WIDTH}>
              <ProductMockup />
            </ScaleToFit>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
