import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Marca do Chroma Flux.
 *
 * Usa o arquivo original em `public/`, e não um SVG redesenhado: as curvas e
 * os degradês da fita são o desenho aprovado, e qualquer tentativa de
 * reproduzi-los à mão sai diferente.
 *
 * O PNG foi aparado da margem vazia e reduzido a 512px de largura, mantendo o
 * fundo transparente do original — por isso a marca assenta tanto sobre o
 * cabeçalho claro quanto sobre a barra lateral escura, sem moldura.
 *
 * A proporção real da arte é 1160×668, então o dimensionamento é feito pela
 * altura (`h-*`), com a largura livre. Uma classe quadrada como `size-8`
 * distorceria a marca.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-chroma-flux-512.png"
      alt="Chroma Flux"
      width={1160}
      height={668}
      priority
      className={cn("h-8 w-auto", className)}
    />
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <Logo className="h-7 w-auto" />
      <span className="text-lg font-semibold tracking-tight text-ink-900">
        Chroma Flux
      </span>
    </span>
  );
}
