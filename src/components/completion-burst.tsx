"use client";

import { useEffect, useRef } from "react";

import { ouvirCompletionBurst } from "@/lib/completion-burst";

/**
 * Cores do confete — as mesmas bolinhas de acento usadas nos espaços de
 * trabalho (`--accent-*` em globals.css), para o efeito parecer parte do
 * mesmo sistema visual em vez de um plugin colado por fora.
 */
const CORES = [
  "oklch(0.62 0.18 285)", // indigo
  "oklch(0.68 0.13 190)", // teal
  "oklch(0.76 0.15 75)", // amber
  "oklch(0.66 0.18 15)", // rose
  "oklch(0.68 0.15 155)", // emerald
  "oklch(0.7 0.14 235)", // sky
];

const N_PARTICULAS = 26;
const DURACAO_MS = 900;
const GRAVIDADE = 0.0022; // px/ms²

type Particula = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  cor: string;
  tamanho: number;
  rotacao: number;
  vRotacao: number;
  nascimento: number;
};

/**
 * Camada de confete montada uma vez na casca da aplicação (`SidebarShell`).
 *
 * Um `<canvas>` de tela cheia, oculto e sem interceptar clique (`pointer-events:
 * none`) até que `fireCompletionBurst()` seja chamado; a partir daí desenha
 * algumas dezenas de partículas caindo e some sozinho. Sem biblioteca: é o
 * mesmo espírito de `completion-sound.ts` — um efeito pequeno que não pesa o
 * bundle nem depende de nada carregando por fora.
 */
export function CompletionBurst() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particulasRef = useRef<Particula[]>([]);
  const animandoRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;

    function ajustarTamanho() {
      if (!canvas) return;
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
    }

    ajustarTamanho();
    window.addEventListener("resize", ajustarTamanho);

    function passo() {
      if (!canvas || !ctx) return;
      const agora = performance.now();
      const dpr = window.devicePixelRatio;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particulasRef.current = particulasRef.current.filter((p) => agora - p.nascimento < DURACAO_MS);

      for (const p of particulasRef.current) {
        const t = agora - p.nascimento;
        const x = p.x + p.vx * t;
        const y = p.y + p.vy * t + 0.5 * GRAVIDADE * t * t;
        const vidaRestante = 1 - t / DURACAO_MS;

        ctx.save();
        ctx.globalAlpha = Math.max(vidaRestante, 0);
        ctx.translate(x * dpr, y * dpr);
        ctx.rotate(p.rotacao + p.vRotacao * t);
        ctx.fillStyle = p.cor;
        const meio = (p.tamanho * dpr) / 2;
        ctx.fillRect(-meio, -meio, p.tamanho * dpr, p.tamanho * dpr * 0.6);
        ctx.restore();
      }

      if (particulasRef.current.length > 0) {
        frame = requestAnimationFrame(passo);
      } else {
        animandoRef.current = false;
      }
    }

    function estourar(origem: { x: number; y: number } | null) {
      const centro = origem ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };

      const novas: Particula[] = Array.from({ length: N_PARTICULAS }, () => {
        // Leque para cima, como confete jogado — não uma explosão em todas
        // as direções, que lembraria mais uma detonação que uma comemoração.
        const angulo = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.8);
        const velocidade = 0.25 + Math.random() * 0.35;

        return {
          x: centro.x,
          y: centro.y,
          vx: Math.cos(angulo) * velocidade,
          vy: Math.sin(angulo) * velocidade,
          cor: CORES[Math.floor(Math.random() * CORES.length)],
          tamanho: 5 + Math.random() * 4,
          rotacao: Math.random() * Math.PI * 2,
          vRotacao: (Math.random() - 0.5) * 0.012,
          nascimento: performance.now(),
        };
      });

      particulasRef.current = [...particulasRef.current, ...novas];

      if (!animandoRef.current) {
        animandoRef.current = true;
        frame = requestAnimationFrame(passo);
      }
    }

    const pararDeOuvir = ouvirCompletionBurst(estourar);

    return () => {
      pararDeOuvir();
      window.removeEventListener("resize", ajustarTamanho);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50 size-full"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
