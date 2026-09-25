"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, LogOut, Menu, Pin, PinOff, X } from "lucide-react";

import { CompletionBurst } from "@/components/completion-burst";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme";
import { Avatar, IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "chroma-flux-menu-fixo";
const STORAGE_KEY_ESTREITO = "chroma-flux-menu-fixo-estreito";

/** Mesmo valor do breakpoint `lg` do Tailwind, usado nas classes abaixo. */
const LARGURA_DESKTOP = "(min-width: 1024px)";

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
 * O estado "fixo" é lido do `localStorage` só depois da montagem: no servidor
 * não existe `localStorage`, e desenhar um palpite faria o HTML divergir do
 * que o navegador monta. Até lá a barra aparece aberta, que é o padrão.
 *
 * São dois estados independentes, porque fixar significa coisas diferentes
 * conforme o espaço disponível — e um só valor faria a escolha do computador
 * atravessar a do celular:
 *
 * - Telas largas (≥ `lg`): fixa mostra a barra inteira; solta encolhe para a
 *   trilha de ícones. Padrão: fixa.
 * - Telas estreitas: fixa deixa a barra sempre presente ao lado do conteúdo;
 *   solta é a gaveta sobreposta, que fecha ao navegar. Padrão: solta.
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
  const [fixo, setFixo] = useState(true);
  const [fixoEstreito, setFixoEstreito] = useState(false);
  const [desktop, setDesktop] = useState(true);
  const [montado, setMontado] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  function alternarExpandido(href: string) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(href)) proximo.delete(href);
      else proximo.add(href);
      return proximo;
    });
  }

  useEffect(() => {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (salvo !== null) setFixo(salvo === "true");

    const salvoEstreito = localStorage.getItem(STORAGE_KEY_ESTREITO);
    if (salvoEstreito !== null) setFixoEstreito(salvoEstreito === "true");

    // O botão precisa saber qual dos dois estados está governando a tela no
    // momento. O CSS sozinho não resolve: quem alterna é o clique, não a folha
    // de estilo.
    const consulta = window.matchMedia(LARGURA_DESKTOP);
    setDesktop(consulta.matches);
    const aoMudar = (evento: MediaQueryListEvent) => setDesktop(evento.matches);
    consulta.addEventListener("change", aoMudar);

    setMontado(true);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  /*
    A gaveta fecha ao trocar de página — mas só quando está solta, e só quando
    foi a rota que mudou. Comparar com a rota anterior evita que desafixar com
    a gaveta aberta a feche na cara de quem acabou de clicar.
  */
  const rotaAnterior = useRef(pathname);
  useEffect(() => {
    if (rotaAnterior.current === pathname) return;
    rotaAnterior.current = pathname;
    if (!fixoEstreito) setMobileAberto(false);
  }, [pathname, fixoEstreito]);

  function alternarFixo() {
    const [proximo, chave, aplicar] = desktop
      ? ([!fixo, STORAGE_KEY, setFixo] as const)
      : ([!fixoEstreito, STORAGE_KEY_ESTREITO, setFixoEstreito] as const);

    aplicar(proximo);
    localStorage.setItem(chave, String(proximo));
  }

  /** Qual dos dois estados o botão de alfinete representa agora. */
  const fixoAtual = desktop ? fixo : fixoEstreito;

  const recolhidoDesktop = montado && desktop && !fixo;

  const ativo = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  /*
    A mesma barra serve às três formas de exibição, e cada uma decide se cabem
    rótulos: larga conforme o alfinete, gaveta sempre com rótulos, fixa em tela
    estreita sempre na trilha de ícones.
  */
  const construirBarra = (recolhido: boolean) => (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-fg">
      {/* Cabeçalho */}
      <div
        className={cn(
          "px-3 py-4",
          recolhido ? "flex flex-col items-center gap-2" : "flex items-center gap-2",
        )}
      >
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

        {!recolhido &&
          (cabecalho ?? (
            <Link
              href={tituloHref}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-sidebar-hover"
            >
              {tituloDotClass && (
                <span className={cn("size-2 shrink-0 rounded-full", tituloDotClass)} aria-hidden />
              )}
              <span className="truncate text-sm font-medium text-sidebar-fg">{titulo}</span>
            </Link>
          ))}

        {/* Fechar só faz sentido na gaveta: com a barra fixa não há o que
            fechar, e o botão levaria a um estado sem volta. */}
        {!fixoEstreito && (
          <div className="lg:hidden">
            <IconButton
              label="Fechar menu"
              onClick={() => setMobileAberto(false)}
              className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
            >
              <X className="size-5" />
            </IconButton>
          </div>
        )}

        {/*
          Sempre visível, nos dois estados. Escondê-lo ao recolher deixava a
          barra sem volta: o único caminho de retorno era um botão flutuante
          que caía por cima do próprio rodapé da barra.

          Em tela estreita ele governa o outro estado — se a barra acompanha o
          conteúdo ou se some ao navegar.
        */}
        <IconButton
          label={fixoAtual ? "Desafixar menu" : "Fixar menu"}
          onClick={alternarFixo}
          className="text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg"
        >
          {fixoAtual ? <Pin className="size-4" /> : <PinOff className="size-4" />}
        </IconButton>
      </div>

      {/* Navegação */}
      <nav className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-2 pb-4">
        {grupos.map((grupo, i) => (
          <div key={grupo.rotulo ?? i} className={i > 0 ? "mt-5" : undefined}>
            {grupo.rotulo && !recolhido && (
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-sidebar-muted">
                {grupo.rotulo}
              </p>
            )}

            {grupo.itens.length === 0 && grupo.vazio && !recolhido ? (
              <p className="px-3 text-sm text-sidebar-muted">{grupo.vazio}</p>
            ) : (
              <ul className="space-y-0.5">
                {grupo.itens.map((item) => {
                  const Icone = item.icon;
                  const selecionado = ativo(item);
                  const temFilhos = !recolhido && (item.filhos?.length ?? 0) > 0;
                  const aberto = expandidos.has(item.href);

                  return (
                    <li key={item.href}>
                      <div className="flex items-center">
                        <Link
                          href={item.href}
                          aria-current={selecionado ? "page" : undefined}
                          title={recolhido ? item.label : undefined}
                          className={cn(
                            "flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                            recolhido && "justify-center px-2",
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
                          {!recolhido && <span className="truncate">{item.label}</span>}
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
            title={recolhido ? acaoRodape.label : undefined}
            className={cn(
              "mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              recolhido && "justify-center px-2",
              pathname === acaoRodape.href
                ? "bg-sidebar-active font-medium text-sidebar-fg"
                : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg",
            )}
          >
            <acaoRodape.icon className="size-4 shrink-0" />
            {!recolhido && <span className="truncate">{acaoRodape.label}</span>}
          </Link>
        )}

        {!recolhido && (
          <div className="mb-3">
            <ThemeToggle />
          </div>
        )}

        <div className={cn("flex items-center gap-3", recolhido && "flex-col gap-2")}>
          <Avatar id={user.id} name={user.name} email={user.email} size="sm" />

          {!recolhido && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sidebar-fg">
                {user.name || user.email}
              </p>
              {user.papel && (
                <p className="truncate text-xs text-sidebar-muted">{user.papel}</p>
              )}
            </div>
          )}

          {recolhido && <ThemeToggle compact />}

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

      {/* Desktop */}
      <aside
        className={cn(
          "hidden shrink-0 transition-[width] duration-200 lg:block",
          recolhidoDesktop ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "fixed inset-y-0 transition-[width] duration-200",
            recolhidoDesktop ? "w-16" : "w-64",
          )}
        >
          {construirBarra(recolhidoDesktop)}
        </div>
      </aside>

      {/*
        Tela estreita com o menu fixo: a barra entra no fluxo, ao lado do
        conteúdo, em vez de sobrepô-lo. Vai na trilha de ícones — 256px de
        rótulos num celular não deixariam página nenhuma para ler.
      */}
      {fixoEstreito && (
        <aside className="w-16 shrink-0 lg:hidden">
          <div className="fixed inset-y-0 z-30 w-16">{construirBarra(true)}</div>
        </aside>
      )}

      {/* Gaveta no celular */}
      {!fixoEstreito && mobileAberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/50"
            onClick={() => setMobileAberto(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">{construirBarra(false)}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-surface px-4 py-3 lg:hidden">
          {/* Com a barra fixa ao lado não há gaveta para abrir — o título
              continua, que é ele quem diz onde você está. */}
          {!fixoEstreito && (
            <IconButton label="Abrir menu" onClick={() => setMobileAberto(true)}>
              <Menu className="size-5" />
            </IconButton>
          )}
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
