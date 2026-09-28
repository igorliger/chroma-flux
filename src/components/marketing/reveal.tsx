"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Revelação suave ao rolar a página — só a landing pública usa isto.
 *
 * Sem biblioteca de animação: um `IntersectionObserver` troca duas classes
 * Tailwind (opacidade e translação), e a transição fica só no CSS. Simples o
 * bastante para não justificar trazer uma dependência nova.
 *
 * `prefers-reduced-motion` já é respeitado globalmente em `globals.css`
 * (zera a duração de toda transição/animação), então não precisa de tratamento
 * extra aqui.
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Atraso opcional, para o efeito em cascata de uma lista de cartões. */
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisivel(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: visivel ? `${delayMs}ms` : "0ms" }}
      className={cn(
        "transition-all duration-700 ease-out",
        visivel ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
