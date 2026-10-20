"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";

import { VERSAO_CARREGADA, isVersaoAntiga, recarregarParaVersaoNova } from "@/lib/version";

const INTERVALO = 5 * 60_000;

/**
 * Aviso de versão nova. Cada publicação troca o identificador das ações do
 * servidor, então uma aba aberta antes dela passa a falhar ao salvar
 * ("Algo deu errado"). Este componente percebe a versão nova antes — ao
 * voltar para a aba e a cada 5 minutos — e:
 *   - recarrega sozinho quando a pessoa volta para a aba e não há janela
 *     aberta (nada digitado a perder);
 *   - senão, mostra uma faixa pedindo para atualizar.
 * Se mesmo assim uma ação falhar por versão antiga, também mostra a faixa.
 */
export function VersionWatcher() {
  const [novaVersao, setNovaVersao] = useState(false);

  useEffect(() => {
    if (!VERSAO_CARREGADA) return;
    let ativo = true;

    const temJanelaAberta = () => Boolean(document.querySelector('[role="dialog"]'));

    async function conferir(voltouParaAba: boolean) {
      try {
        const r = await fetch("/api/versao", { cache: "no-store" });
        if (!r.ok) return;
        const { versao } = (await r.json()) as { versao?: string };
        if (!ativo || !versao || versao === VERSAO_CARREGADA) return;
        if (voltouParaAba && !temJanelaAberta() && recarregarParaVersaoNova()) return;
        setNovaVersao(true);
      } catch {
        // Sem rede: tenta de novo na próxima.
      }
    }

    const aoVoltar = () => {
      if (document.visibilityState === "visible") void conferir(true);
    };
    const aoFalhar = (e: PromiseRejectionEvent) => {
      if (isVersaoAntiga(e.reason)) setNovaVersao(true);
    };

    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("unhandledrejection", aoFalhar);
    const timer = window.setInterval(() => void conferir(false), INTERVALO);

    return () => {
      ativo = false;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("unhandledrejection", aoFalhar);
      window.clearInterval(timer);
    };
  }, []);

  if (!novaVersao) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-xl border border-brand-500/40 bg-surface px-4 py-3 text-sm text-ink-800 flux-shadow"
    >
      <span className="min-w-0 flex-1">
        O Chroma Flux foi atualizado. Atualize a página para continuar salvando.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700"
      >
        <RotateCw className="size-4" aria-hidden />
        Atualizar
      </button>
    </div>
  );
}
