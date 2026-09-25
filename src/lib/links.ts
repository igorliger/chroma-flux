/**
 * Detecção e classificação de links em texto livre.
 *
 * Provedores conhecidos (YouTube, Vimeo, Loom) são resolvidos a partir do
 * próprio identificador do vídeo — a miniatura tem endereço previsível, então
 * não é preciso buscar nada. Para os demais, o servidor lê as metatags Open
 * Graph; ver `app/api/link-preview/route.ts`.
 */

export type VideoProvider = "youtube" | "vimeo" | "loom";

export type LinkInfo = {
  url: string;
  host: string;
  provider: VideoProvider | null;
  videoId: string | null;
  /** Miniatura previsível, quando o provedor permite deduzi-la. */
  thumbnail: string | null;
  /** Endereço do player embutido, quando aplicável. */
  embedUrl: string | null;
};

// Captura http(s) até o primeiro espaço, sem engolir pontuação final de frase.
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

/** Remove pontuação que costuma grudar no fim de um link dentro de uma frase. */
function trimTrailingPunctuation(url: string) {
  let limpa = url.replace(/[.,;:!?]+$/, "");

  // Parênteses só contam como parte do link se estiverem balanceados.
  const abre = (limpa.match(/\(/g) ?? []).length;
  const fecha = (limpa.match(/\)/g) ?? []).length;
  if (fecha > abre) limpa = limpa.replace(/\)+$/, "");

  return limpa;
}

export function extractUrls(text: string): string[] {
  const encontradas = text.match(URL_REGEX) ?? [];
  const vistas = new Set<string>();

  for (const bruta of encontradas) {
    const url = trimTrailingPunctuation(bruta);
    if (isSafeHttpUrl(url)) vistas.add(url);
  }
  return [...vistas];
}

/**
 * Barra o que não for http(s) público.
 *
 * `javascript:` e `data:` viram execução de código se caírem num href, e
 * endereços internos transformam a busca de metadados numa sonda da rede
 * privada de quem hospeda a aplicação.
 */
export function isSafeHttpUrl(valor: string): boolean {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  // Endereço IP literal é resolvido de novo no servidor, antes da requisição.
  if (host === "0.0.0.0" || host === "[::1]" || host === "::1") return false;

  return true;
}

// ---------------------------------------------------------------------------
// Provedores de vídeo
// ---------------------------------------------------------------------------
function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) return v;

    // /embed/ID e /shorts/ID
    const m = url.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]{11})/);
    if (m) return m[1];
  }

  return null;
}

function vimeoId(url: URL): string | null {
  if (!url.hostname.replace(/^www\./, "").endsWith("vimeo.com")) return null;
  const m = url.pathname.match(/^\/(\d{6,})/);
  return m ? m[1] : null;
}

function loomId(url: URL): string | null {
  if (url.hostname.replace(/^www\./, "") !== "loom.com") return null;
  const m = url.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{20,})/i);
  return m ? m[1] : null;
}

/** Segundo em que o vídeo do YouTube deve começar, se o link indicar. */
export function youtubeStart(url: URL): number | null {
  const t = url.searchParams.get("t") ?? url.searchParams.get("start");
  if (!t) return null;

  // Aceita "90", "90s" e "1m30s".
  const somenteNumero = /^\d+s?$/.exec(t);
  if (somenteNumero) return parseInt(t, 10);

  const composto = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!composto) return null;

  const [, h, m, s] = composto;
  const total = (Number(h) || 0) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0);
  return total > 0 ? total : null;
}

export function describeLink(valor: string): LinkInfo | null {
  if (!isSafeHttpUrl(valor)) return null;

  const url = new URL(valor);
  const host = url.hostname.replace(/^www\./, "");

  const yt = youtubeId(url);
  if (yt) {
    const inicio = youtubeStart(url);
    return {
      url: valor,
      host,
      provider: "youtube",
      videoId: yt,
      // `hqdefault` existe para todo vídeo; `maxresdefault` falha em muitos.
      thumbnail: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}${inicio ? `?start=${inicio}` : ""}`,
    };
  }

  const vi = vimeoId(url);
  if (vi) {
    return {
      url: valor,
      host,
      provider: "vimeo",
      videoId: vi,
      // O Vimeo não expõe miniatura por URL previsível; vem do Open Graph.
      thumbnail: null,
      embedUrl: `https://player.vimeo.com/video/${vi}`,
    };
  }

  const lo = loomId(url);
  if (lo) {
    return {
      url: valor,
      host,
      provider: "loom",
      videoId: lo,
      thumbnail: null,
      embedUrl: `https://www.loom.com/embed/${lo}`,
    };
  }

  return { url: valor, host, provider: null, videoId: null, thumbnail: null, embedUrl: null };
}

/** Endereço do favicon do site, para dar identidade ao cartão. */
export function faviconFor(host: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}
