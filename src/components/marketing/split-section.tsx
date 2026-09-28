import { Reveal } from "@/components/marketing/reveal";
import { cn } from "@/lib/utils";

/**
 * Seção de duas colunas — texto de um lado, um recorte da interface do
 * outro. Reaproveitada pelas seções de produtividade e de equipe, que só
 * trocam o lado do texto e o conteúdo visual.
 */
export function SplitSection({
  id,
  eyebrow,
  title,
  description,
  visual,
  reverse = false,
}: {
  id?: string;
  eyebrow?: string;
  title: React.ReactNode;
  description: string;
  visual: React.ReactNode;
  /** Texto à direita, visual à esquerda. */
  reverse?: boolean;
}) {
  return (
    <section id={id} className="bg-[#090a0f] py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <Reveal className={reverse ? "lg:order-2" : ""}>
            {eyebrow && (
              <span className="text-sm font-semibold uppercase tracking-wide text-violet-400">
                {eyebrow}
              </span>
            )}
            <h2 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
              {title}
            </h2>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-white/55">
              {description}
            </p>
          </Reveal>

          <Reveal delayMs={150} className={cn("relative", reverse ? "lg:order-1" : "")}>
            <div className="pointer-events-none absolute -inset-10 -z-10">
              <div className="absolute right-10 top-10 size-72 rounded-full bg-[radial-gradient(circle,_rgba(91,75,255,0.16),_transparent_70%)] blur-3xl" />
            </div>
            {visual}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
