"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Link2, Play } from "lucide-react";

import { describeLink, faviconFor, type LinkInfo } from "@/lib/links";
import { cn } from "@/lib/utils";

type Metadados = {
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  indisponivel?: boolean;
};

/**
 * Miniatura de um link externo.
 *
 * Vídeos de provedores conhecidos aparecem na hora: a miniatura do YouTube tem
 * endereço previsível a partir do id, então não há espera nem requisição. Os
 * demais links buscam as metatags Open Graph em `/api/link-preview`, e até a
 * resposta chegar mostram um esqueleto — nunca um salto de layout.
 *
 * As imagens usam `<img>` puro, e não `next/image`: viriam de qualquer domínio
 * da internet, e liberar isso no `next.config` significaria transformar o
 * otimizador em proxy aberto de imagens.
 */
export function LinkPreview({ url, compact = false }: { url: string; compact?: boolean }) {
  const info = describeLink(url);
  const [meta, setMeta] = useState<Metadados | null>(null);
  const [tocando, setTocando] = useState(false);

  useEffect(() => {
    if (!info) return;
    // O YouTube já tem miniatura previsível; buscar metadados só acrescenta o
    // título, então vale a pena, mas o cartão não depende disso para aparecer.
    let ativo = true;

    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((dados) => {
        if (ativo && dados) setMeta(dados);
      })
      .catch(() => {
        if (ativo) setMeta({ title: null, description: null, image: null, siteName: null, indisponivel: true });
      });

    return () => {
      ativo = false;
    };
  }, [url, info]);

  if (!info) return null;

  const imagem = info.thumbnail ?? meta?.image ?? null;
  const titulo = meta?.title ?? null;
  const carregando = meta === null;

  if (info.provider && info.embedUrl && tocando) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-ink-200 bg-black">
        <div className="aspect-video">
          <iframe
            src={`${info.embedUrl}${info.embedUrl.includes("?") ? "&" : "?"}autoplay=1`}
            title={titulo ?? "Vídeo"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="size-full border-0"
          />
        </div>
      </div>
    );
  }

  // ---- Cartão de vídeo -----------------------------------------------------
  if (info.provider && imagem) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-ink-200 bg-surface">
        <button
          type="button"
          onClick={() => setTocando(true)}
          aria-label={titulo ? `Reproduzir: ${titulo}` : "Reproduzir vídeo"}
          className="group relative block w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imagem}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className={cn("w-full bg-ink-100 object-cover", compact ? "h-32" : "aspect-video")}
          />
          <span className="absolute inset-0 flex items-center justify-center bg-ink-900/20 transition-colors group-hover:bg-ink-900/35">
            <span className="flex size-12 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-110">
              <Play className="ml-0.5 size-5 fill-ink-900 text-ink-900" aria-hidden />
            </span>
          </span>
        </button>

        <Rodape info={info} titulo={titulo} carregando={carregando} />
      </div>
    );
  }

  // ---- Cartão genérico -----------------------------------------------------
  if (carregando) {
    return (
      <div className="mt-2 flex animate-pulse items-center gap-3 rounded-xl border border-ink-200 bg-surface p-3">
        <div className="size-12 shrink-0 rounded-lg bg-ink-100" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-2/3 rounded bg-ink-100" />
          <div className="h-2.5 w-1/3 rounded bg-ink-100" />
        </div>
      </div>
    );
  }

  // Sem metadados úteis, um cartão vazio é pior que o link simples do texto.
  if (meta?.indisponivel || (!titulo && !imagem)) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="mt-2 flex items-stretch gap-3 overflow-hidden rounded-xl border border-ink-200 bg-surface transition-shadow hover:shadow-md"
    >
      {imagem && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imagem}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-24 shrink-0 bg-ink-100 object-cover"
        />
      )}
      <div className="min-w-0 flex-1 py-2.5 pr-3">
        <p className="line-clamp-2 text-sm font-medium text-ink-800">{titulo}</p>
        {meta?.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{meta.description}</p>
        )}
        <span className="mt-1.5 flex items-center gap-1 text-xs text-ink-400">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={faviconFor(info.host)} alt="" className="size-3.5 rounded-sm" loading="lazy" />
          {meta?.siteName ?? info.host}
        </span>
      </div>
    </a>
  );
}

function Rodape({
  info,
  titulo,
  carregando,
}: {
  info: LinkInfo;
  titulo: string | null;
  carregando: boolean;
}) {
  return (
    <a
      href={info.url}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-ink-50"
    >
      <div className="min-w-0 flex-1">
        {carregando && !titulo ? (
          <div className="h-3.5 w-1/2 animate-pulse rounded bg-ink-100" />
        ) : (
          <p className="line-clamp-1 text-sm font-medium text-ink-800">
            {titulo ?? info.url}
          </p>
        )}
        <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-400">
          <Link2 className="size-3" aria-hidden />
          {info.host}
        </span>
      </div>
      <ExternalLink className="size-4 shrink-0 text-ink-400" aria-hidden />
    </a>
  );
}
