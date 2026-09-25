"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "chroma-flux-tema";

/**
 * Script que roda antes da primeira pintura.
 *
 * Sem ele, a página nasce clara e escurece depois que o React monta — o
 * clarão branco que todo site de tema escuro precisa evitar. Como precisa
 * executar antes de qualquer CSS pintar, vai inline no `<head>`, e não como
 * efeito de componente.
 *
 * `data-theme-ready` é aplicado só depois, para a transição de cores não
 * animar no carregamento inicial.
 */
export const themeScript = `
(function () {
  try {
    var salvo = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var escuro = salvo === 'dark' ||
      ((!salvo || salvo === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', escuro ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

function aplicar(tema: Theme) {
  const escuro =
    tema === "dark" ||
    (tema === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.setAttribute("data-theme", escuro ? "dark" : "light");
}

/** Lê, aplica e persiste a preferência de tema. */
export function useTheme() {
  const [tema, setTemaEstado] = useState<Theme>("system");

  useEffect(() => {
    const salvo = localStorage.getItem(STORAGE_KEY) as Theme | null;
    setTemaEstado(salvo ?? "system");

    // A transição só é liberada depois da montagem, para o tema inicial não
    // aparecer se dissolvendo na frente do usuário.
    document.documentElement.setAttribute("data-theme-ready", "");

    // Com "system", seguir a preferência do sistema em tempo real.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const aoMudar = () => {
      const atual = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
      if (atual === "system") aplicar("system");
    };
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, []);

  const setTema = useCallback((novo: Theme) => {
    setTemaEstado(novo);
    localStorage.setItem(STORAGE_KEY, novo);
    aplicar(novo);
  }, []);

  return { tema, setTema };
}

const OPCOES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

/** Alternador de três estados: claro, escuro e "seguir o sistema". */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { tema, setTema } = useTheme();
  const [montado, setMontado] = useState(false);

  // Antes de montar não se sabe a preferência salva; desenhar um estado
  // qualquer criaria divergência entre o HTML do servidor e o do navegador.
  useEffect(() => setMontado(true), []);

  if (compact) {
    const proximo: Theme = tema === "dark" ? "light" : "dark";
    const Icone = tema === "dark" ? Sun : Moon;
    return (
      <button
        type="button"
        onClick={() => setTema(proximo)}
        aria-label={tema === "dark" ? "Usar tema claro" : "Usar tema escuro"}
        title={tema === "dark" ? "Tema claro" : "Tema escuro"}
        className="inline-flex size-8 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
      >
        {montado ? <Icone className="size-4" /> : <span className="size-4" />}
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="flex rounded-lg bg-sidebar-hover p-0.5"
    >
      {OPCOES.map(({ value, label, icon: Icone }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={montado && tema === value}
          onClick={() => setTema(value)}
          title={label}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs transition-colors",
            montado && tema === value
              ? "bg-sidebar-active font-medium text-sidebar-fg"
              : "text-sidebar-muted hover:text-sidebar-fg",
          )}
        >
          <Icone className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
