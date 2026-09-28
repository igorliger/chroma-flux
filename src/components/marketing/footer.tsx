import Link from "next/link";

import { Logo } from "@/components/logo";

export function MarketingFooter() {
  const ano = new Date().getFullYear();

  return (
    <footer id="contato" className="border-t border-white/[0.06] bg-[#090a0f] py-12">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <Logo className="h-6 w-auto opacity-80" />
            <span className="text-sm font-semibold text-white/70">Chroma Flux</span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/45">
            <a href="#recursos" className="transition-colors hover:text-white/80">
              Recursos
            </a>
            <a href="#equipe" className="transition-colors hover:text-white/80">
              Equipe
            </a>
            {/* TODO: definir o e-mail/canal de contato público antes de publicar. */}
            <a href="#contato" className="transition-colors hover:text-white/80">
              Contato
            </a>
            <Link href="/login" className="transition-colors hover:text-white/80">
              Entrar
            </Link>
            <Link href="/cadastro" className="transition-colors hover:text-white/80">
              Criar conta
            </Link>
          </nav>
        </div>

        <p className="mt-8 text-center text-xs text-white/30 sm:text-left">
          © {ano} Chroma Flux. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  );
}
