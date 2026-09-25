"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, LayoutGrid, Plus } from "lucide-react";

import { accentClass, cn } from "@/lib/utils";

/**
 * Troca de espaço de trabalho, no topo da barra lateral.
 *
 * Antes o nome do espaço era só um link para a lista — trocar exigia sair da
 * tela atual, escolher e entrar de novo. Aqui a lista vem até o usuário.
 *
 * O menu é montado com um `<button>` e uma lista posicionada, e não com
 * `<select>`: os itens precisam de bolinha de cor e marcação do atual, que um
 * `<option>` não desenha.
 */
export function WorkspaceSwitcher({
  atual,
  workspaces,
  podeCriar = true,
}: {
  atual: { id: string; name: string; color: string };
  workspaces: { id: string; name: string; color: string }[];
  /** Mostra "Novo espaço" — só para proprietários e administradores. */
  podeCriar?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Fecha ao navegar: sem isso o menu ficaria aberto por cima da tela nova.
  useEffect(() => setAberto(false), [pathname]);

  useEffect(() => {
    if (!aberto) return;

    const aoClicarFora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };

    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title={`${atual.name} — trocar de espaço`}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-sidebar-hover"
      >
        <span
          className={cn("size-2 shrink-0 rounded-full", accentClass(atual.color))}
          aria-hidden
        />
        <span className="truncate text-sm font-medium text-sidebar-fg">{atual.name}</span>
        <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-sidebar-muted" aria-hidden />
      </button>

      {aberto && (
        <div
          role="menu"
          // Largura própria, e não a do botão: presa à largura do gatilho, a
          // lista ficava estreita a ponto de quebrar "Ver todos os espaços"
          // em duas linhas.
          className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-ink-200 bg-surface py-1 shadow-xl"
        >
          <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Espaços de trabalho
          </p>

          <ul className="max-h-64 overflow-y-auto scrollbar-slim">
            {workspaces.map((w) => {
              const selecionado = w.id === atual.id;
              return (
                <li key={w.id}>
                  <Link
                    href={`/e/${w.id}`}
                    role="menuitem"
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                      selecionado
                        ? "bg-ink-100 font-medium text-ink-900"
                        : "text-ink-700 hover:bg-ink-100",
                    )}
                  >
                    <span
                      className={cn("size-2 shrink-0 rounded-full", accentClass(w.color))}
                      aria-hidden
                    />
                    <span className="truncate">{w.name}</span>
                    {selecionado && (
                      <Check className="ml-auto size-4 shrink-0 text-brand-600" aria-hidden />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="mt-1 border-t border-ink-200 pt-1">
            <Link
              href="/espacos"
              role="menuitem"
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100"
            >
              <LayoutGrid className="size-4 shrink-0 text-ink-400" aria-hidden />
              Ver todos os espaços
            </Link>
            {podeCriar && (
              <Link
                href="/espacos?novo=1"
                role="menuitem"
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-ink-700 transition-colors hover:bg-ink-100"
              >
                <Plus className="size-4 shrink-0 text-ink-400" aria-hidden />
                Novo espaço
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
