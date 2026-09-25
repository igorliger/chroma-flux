"use client";

import { Fragment } from "react";

import { LinkPreview } from "@/components/link-preview";
import { extractUrls, isSafeHttpUrl } from "@/lib/links";
import { cn } from "@/lib/utils";

/**
 * Texto do usuário com links clicáveis e miniaturas dos endereços citados.
 *
 * O conteúdo é sempre inserido como texto — nunca como HTML —, então nada que
 * alguém escreva num comentário vira marcação. Os links são reconstruídos como
 * elementos React a partir do texto puro, o que torna injeção impossível por
 * construção, e não por sanitização.
 */
export function RichText({
  text,
  className,
  maxPreviews = 3,
}: {
  text: string;
  className?: string;
  maxPreviews?: number;
}) {
  if (!text.trim()) return null;

  const urls = extractUrls(text).slice(0, maxPreviews);

  return (
    <div className={cn("min-w-0", className)}>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-600">
        {linkify(text)}
      </p>

      {urls.map((url) => (
        <LinkPreview key={url} url={url} />
      ))}
    </div>
  );
}

/** Quebra o texto em trechos comuns e âncoras, preservando a ordem. */
function linkify(texto: string) {
  const regex = /https?:\/\/[^\s<>"']+/gi;
  const partes: React.ReactNode[] = [];

  let ultimo = 0;
  let match: RegExpExecArray | null;
  let chave = 0;

  while ((match = regex.exec(texto)) !== null) {
    const bruta = match[0];

    // A pontuação final da frase não faz parte do endereço.
    const limpa = bruta.replace(/[.,;:!?]+$/, "");
    const sobra = bruta.slice(limpa.length);

    if (match.index > ultimo) {
      partes.push(<Fragment key={chave++}>{texto.slice(ultimo, match.index)}</Fragment>);
    }

    if (isSafeHttpUrl(limpa)) {
      partes.push(
        <a
          key={chave++}
          href={limpa}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700"
        >
          {limpa.replace(/^https?:\/\//, "").slice(0, 60)}
          {limpa.replace(/^https?:\/\//, "").length > 60 ? "…" : ""}
        </a>,
      );
    } else {
      partes.push(<Fragment key={chave++}>{limpa}</Fragment>);
    }

    if (sobra) partes.push(<Fragment key={chave++}>{sobra}</Fragment>);
    ultimo = match.index + bruta.length;
  }

  if (ultimo < texto.length) {
    partes.push(<Fragment key={chave++}>{texto.slice(ultimo)}</Fragment>);
  }

  return partes;
}
