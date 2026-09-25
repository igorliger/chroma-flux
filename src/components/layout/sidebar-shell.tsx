"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LogOut, Menu, X } from "lucide-react";

import { CompletionBurst } from "@/components/completion-burst";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { Avatar, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** `true` para casar apenas com o caminho exato. */
  exact?: boolean;
  /** Bolinha colorida no lugar do ícone (projetos e espaços). */
  dotClass?: string;
  /**
   * Subitens revelados por uma setinha. Usado na tela de espaços, onde cada
   * espaço abre as próprias seções — assim dá para pular direto de qualquer
   * lugar para qualquer seção, sem entrar no espaço antes.
   */
  filhos?: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }[];
};

/**
 * Casca com barra lateral, compartilhada pelas telas autenticadas.
 *
 * A barra fica sempre fixa e expandida em telas largas (≥ `lg`); não há mais
 * alternância entre fixar/soltar nem trilha de ícones colapsada. Em telas
 * estreitas continua como gaveta sobreposta, que abre pelo botão de menu e
 * fecha ao navegar ou ao tocar fora dela.
 */
export function SidebarShell({
  titulo,
  tituloHref,
  tituloDotClass,
  cabecalho,
  acaoRodape,
  grupos,
  user,
  signOut,
  children,
}: {
  titulo: string;
  tituloHref: string;
  tituloDotClass?: string;
  /**
   * Substitui o link de título no topo da barra. Usado pelo seletor de espaço
   * de trabalho, que precisa de um menu no lugar de um link simples.
   */
  cabecalho?: React.ReactNode;
  /**
   * Item fixo no rodapé, acima do alternador de tema. Fica junto do avatar e
   * do "sair" porque é da conta, não da navegação do conteúdo.
   */
  acaoRodape?: NavItem;
  grupos: { rotulo?: string; itens: NavItem[]; vazio?: string }[];
  user: { id: string; name: string; email: string; papel?: string };
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileAberto, setMobileAberto] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function alternarExpandido(href: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(href)) proximo.delete(href);
      else proximo.add(href);
      return proximo;
    });
  }

  // A gaveta fecha ao trocar de página, para não ficar aberta por cima do
  // conteúdo novo depois de navegar por ela.
  const rotaAnterior = useRef(pathname);
  useEffect(() => {
    if (rotaAnterior.current === pathname) return;
    rotaAnterior.current = pathname;
    setMobileAberto(false);
  }, [pathname]);

  const ativo = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  // A mesma barra serve tanto fixa no desktop quanto na gaveta do celular.
  const construirBarra = () => (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-3 py-4">
        {/* A marca é o atalho para o início, em qualquer tela — convenção que
            todo mundo já espera de um logotipo no canto superior. */}
        <Link
          href="/"
          className="flex shrink-0 items-center"
          title="Ir para o início"
          aria-label="Ir para o início"
        >
          <Logo className="h-6 w-auto" />
        </Link>

        {cabecalho ?? (
          <Link
            href={tituloHref}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-sidebar-hover"
          >
            {tituloDotClass && (
              <span className={cn("size-2 shrink-0 rounded-full", tituloDotClass)} aria-hidden />
            )}
            <span className="truncate text-sm font-medium text-sidebar-fg">{titulo}</span>
          </Link>
        )}

        {/* Fechar só faz sentido na gaveta do celular. */}
        <div className="lg:hidden">
          <IconButton
            label="Fechar menu"
            onClick={() => setMobileAberto(false)}
            className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
          >
            <X className="size-5" />
          </IconButton>
        </div>
      </div>

      {/* Navegação */}
      <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-2 pb-4">
        {grupos.map((grupo, i) => (
          <div key={grupo.rotulo ?? i} className={i > 0 ? "mt-5" : undefined}>
            {grupo.rotulo && (
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-sidebar-muted">
                {grupo.rotulo}
              </p>
            )}

            {grupo.itens.length === 0 && grupo.vazio ? (
              <p className="px-3 text-sm text-sidebar-muted">{grupo.vazio}</p>
            ) : (
              <ul className="space-y-0.5">
                {grupo.itens.map((item) => {
                  const Icone = item.icon;
                  const selecionado = ativo(item);
                  const temFilhos = (item.filhos?.length ?? 0) > 0;
                  const aberto = expandidos.has(item.href);

                  return (
                    <li key={item.href}>
                      <div className="flex items-center">
                        <Link
                          href={item.href}
                          aria-current={selecionado ? "page" : undefined}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                            selecionado
                              ? "bg-sidebar-active font-medium text-sidebar-fg"
                              : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg",
                          )}
                        >
                          {item.dotClass ? (
                            <span
                              className={cn("size-2 shrink-0 rounded-full", item.dotClass)}
                              aria-hidden
                            />
                          ) : (
                            <Icone className="size-4 shrink-0" />
                          )}
                          <span className="truncate">{item.label}</span>
                        </Link>

                        {/* Botão à parte: clicar no nome navega, clicar na
                            setinha só abre — as duas ações são diferentes. */}
                        {temFilhos && (
                          <button
                            type="button"
                            onClick={() => alternarExpandido(item.href)}
                            aria-expanded={aberto}
                            aria-label={`${aberto ? "Recolher" : "Expandir"} ${item.label}`}
                            className="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
                          >
                            <ChevronRight
                              className={cn(
                                "size-3.5 transition-transform",
                                aberto && "rotate-90",
                              )}
                            />
                          </button>
                        )}
                      </div>

                      {temFilhos && aberto && (
                        <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-line pl-2">
                          {item.filhos!.map((filho) => {
                            const IconeFilho = filho.icon;
                            return (
                              <li key={filho.href}>
                                <Link
                                  href={filho.href}
                                  aria-current={pathname === filho.href ? "page" : undefined}
                                  className={cn(
                                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                                    pathname === filho.href
                                      ? "bg-sidebar-active font-medium text-sidebar-fg"
                                      : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg",
                                  )}
                                >
                                  <IconeFilho className="size-3.5 shrink-0" />
                                  <span className="truncate">{filho.label}</span>
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </nav>

      {/* Rodapé: configurações, tema, usuário e sair */}
      <div className="border-t border-sidebar-line p-3">
        {acaoRodape && (
          <Link
            href={acaoRodape.href}
            aria-current={pathname === acaoRodape.href ? "page" : undefined}
            className={cn(
              "mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              pathname === acaoRodape.href
                ? "bg-sidebar-active font-medium text-sidebar-fg"
                : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg",
            )}
          >
            <acaoRodape.icon className="size-4 shrink-0" />
            <span className="truncate">{acaoRodape.label}</span>
          </Link>
        )}

        <div className="mb-3">
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3">
          <Avatar id={user.id} name={user.name} email={user.email} size="sm" />

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-fg">
              {user.name || user.email}
            </p>
            {user.papel && <p className="truncate text-xs text-sidebar-muted">{user.papel}</p>}
          </div>

          <form action={signOut}>
            <IconButton
              label="Sair"
              type="submit"
              className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
            >
              <LogOut className="size-4" />
            </IconButton>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Uma vez para toda a casca autenticada: qualquer tela que conclua uma
          tarefa dispara `fireCompletionBurst()`, e é aqui que ela aparece. */}
      <CompletionBurst />

      {/* Desktop: sempre fixa e expandida, sem colapsar para trilha de ícones. */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="fixed inset-y-0 w-64">{construirBarra()}</div>
      </aside>

      {/* Gaveta no celular */}
      {mobileAberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/50"
            onClick={() => setMobileAberto(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">{construirBarra()}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-surface px-4 py-3 lg:hidden">
          <IconButton label="Abrir menu" onClick={() => setMobileAberto(true)}>
            <Menu className="size-5" />
          </IconButton>
          <span className="flex min-w-0 items-center gap-2">
            {tituloDotClass && (
              <span className={cn("size-2 shrink-0 rounded-full", tituloDotClass)} aria-hidden />
            )}
            <span className="truncate font-medium text-ink-900">{titulo}</span>
          </span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
