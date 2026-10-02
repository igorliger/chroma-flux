import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export type MetricTone = "brand" | "danger" | "warn" | "ok";

/**
 * Faixa no topo e bloco do ícone de cada tom. Escritas por extenso porque o
 * Tailwind só gera classes que encontra literalmente no código.
 */
const TONS: Record<MetricTone, { faixa: string; icone: string }> = {
  brand: { faixa: "bg-brand-600", icone: "bg-brand-600 text-white" },
  danger: { faixa: "bg-rose-500", icone: "bg-rose-500 text-white" },
  warn: { faixa: "bg-amber-400", icone: "bg-amber-400 text-white" },
  ok: { faixa: "bg-emerald-400", icone: "bg-emerald-100 text-emerald-600" },
};

/**
 * Cartão de número do painel: faixa colorida no topo, ícone em bloco sólido
 * e o número em destaque. Leva para a lista já filtrada pelo que conta.
 */
export function MetricCard({
  href,
  label,
  value,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: MetricTone;
}) {
  const t = TONS[tone];
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}. Ver na lista de tarefas.`}
      className="group relative block overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface p-4 flux-shadow transition-colors hover:border-ink-300 hover:bg-surface-raised sm:p-5"
    >
      <span className={cn("absolute inset-x-0 top-0 h-[3px]", t.faixa)} aria-hidden />
      <span
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-xl sm:size-12",
          t.icone,
        )}
      >
        <Icon className="size-5 sm:size-6" aria-hidden />
      </span>
      <p className="mt-3 text-[28px] font-bold leading-none tabular-nums text-ink-900 sm:mt-4 sm:text-[32px]">
        {value}
      </p>
      <p className="mt-1.5 flex items-center gap-1 text-sm text-ink-500 sm:text-base">
        {label}
        {/* A setinha só no hover: quatro flechas fixas competiriam com os
            números, que são o conteúdo do cartão. */}
        <ChevronRight
          className="size-4 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </p>
    </Link>
  );
}
