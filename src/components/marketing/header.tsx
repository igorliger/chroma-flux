"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#recursos", label: "Recursos" },
  { href: "#equipe", label: "Equipe" },
  { href: "#contato", label: "Contato" },
];

/**
 * Cabeçalho da landing pública — fixo, com fundo que só aparece ao rolar.
 *
 * No topo ele se funde com o hero (fundo transparente); depois de rolar um
 * pouco, ganha um fundo escuro semitransparente com desfoque, para o texto
 * continuar legível sobre o que passa por baixo.
 */
export function MarketingHeader() {
  const [rolado, setRolado] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    const onScroll = () => setRolado(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-300",
        rolado ? "bg-[#090a0f]/75 backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 sm:h-20 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="h-7 w-auto" />
          <span className="text-lg font-semibold tracking-tight text-white">Chroma Flux</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-white/60 transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/login"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-white/80 transition-colors hover:text-white"
          >
            Entrar
          </Link>
          <Link
            href="/cadastro"
            className="rounded-lg bg-gradient-to-r from-[#5B4BFF] to-[#8B5CF6] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-transform hover:scale-[1.03]"
          >
            Criar conta
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMenuAberto((v) => !v)}
          aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
          aria-expanded={menuAberto}
          className="rounded-lg p-2 text-white/80 md:hidden"
        >
          {menuAberto ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {menuAberto && (
        <div className="border-t border-white/10 bg-[#090a0f]/95 px-5 pb-6 pt-4 backdrop-blur-md md:hidden">
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuAberto(false)}
                className="rounded-lg px-2 py-2.5 text-[15px] text-white/70 hover:bg-white/5 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2.5">
            <Link
              href="/login"
              className="rounded-lg border border-white/15 px-4 py-2.5 text-center text-sm font-medium text-white/85"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="rounded-lg bg-gradient-to-r from-[#5B4BFF] to-[#8B5CF6] px-4 py-2.5 text-center text-sm font-semibold text-white"
            >
              Criar conta
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
