"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Encolhe o conteúdo (uma peça de largura fixa, como o mockup do notebook)
 * pra caber no espaço disponível, sem nunca ampliar além do tamanho real.
 *
 * O mockup é desenhado numa largura fixa (`designWidth`) porque é uma miniatura
 * de interface de verdade — colunas, cartões e texto precisam manter as
 * proporções entre si. Em vez de reescrever esse layout pra cada tela, ele é
 * medido uma vez e reduzido como uma unidade só (`transform: scale`), do
 * jeito que se encolhe uma foto.
 */
export function ScaleToFit({
  children,
  designWidth,
}: {
  children: React.ReactNode;
  designWidth: number;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const recalc = () => {
      setNaturalHeight(inner.scrollHeight);
      setScale(Math.min(1, outer.offsetWidth / designWidth));
    };
    recalc();

    const ro = new ResizeObserver(recalc);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [designWidth]);

  return (
    <div
      ref={outerRef}
      style={naturalHeight !== null ? { height: naturalHeight * scale } : undefined}
    >
      <div
        ref={innerRef}
        style={{ width: designWidth, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}
