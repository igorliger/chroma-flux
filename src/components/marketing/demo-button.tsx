"use client";

import { useState } from "react";
import { Play, X } from "lucide-react";

/**
 * Botão "Ver demonstração".
 *
 * Não existe vídeo ou tour gravado ainda — em vez de inventar um, o botão já
 * abre a janela que vai receber esse conteúdo no futuro (troque o `<div>` de
 * espaço reservado por um vídeo, iframe ou tour guiado quando existir).
 */
export function DemoButton() {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/15 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/5 sm:h-[54px]"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-white/10">
          <Play className="size-3 fill-current" aria-hidden />
        </span>
        Ver demonstração
      </button>

      {aberto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Demonstração do Chroma Flux"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setAberto(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#12141f] p-8 text-center shadow-2xl"
          >
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setAberto(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="mx-auto flex aspect-video max-w-lg items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.03]">
              <p className="px-6 text-sm text-white/50">
                A demonstração em vídeo do Chroma Flux está a caminho. Enquanto isso,
                crie uma conta gratuita e conheça o produto por dentro.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
