import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { NextResponse, type NextRequest } from "next/server";

import { isSafeHttpUrl } from "@/lib/links";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Lê título, descrição e imagem de um link, a partir das metatags Open Graph.
 *
 * Buscar uma URL escolhida pelo usuário no servidor é, por definição, um
 * pedido de SSRF: quem escreve um comentário passa a mandar o servidor fazer
 * requisições. As defesas abaixo existem por isso, e cada uma cobre um vetor
 * diferente:
 *
 *   - exige sessão, para o endpoint não virar proxy aberto na internet;
 *   - só http(s), barrando `file:`, `gopher:` e afins;
 *   - resolve o DNS e recusa endereços privados — é o que impede alcançar
 *     `169.254.169.254` (metadados da nuvem) ou serviços internos;
 *   - segue redirecionamentos manualmente, revalidando cada salto, já que um
 *     host público pode redirecionar para um endereço interno;
 *   - corta a leitura no início do documento, porque as metatags ficam no
 *     `<head>` e o resto seria só consumo de memória.
 */

const TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

/** Faixas reservadas, privadas ou de uso interno — nenhuma deve ser alcançável. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(v6)) return true; // unique local
    // IPv4 mapeado em IPv6: ::ffff:10.0.0.1
    const mapeado = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeado) return isPrivateAddress(mapeado[1]);
    return false;
  }

  const partes = ip.split(".").map(Number);
  if (partes.length !== 4 || partes.some((n) => Number.isNaN(n))) return true;
  const [a, b] = partes;

  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local e metadados de nuvem
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast e reservados
  return false;
}

async function resolveIsPublic(hostname: string): Promise<boolean> {
  // Endereço literal: checa direto, sem consultar DNS.
  if (isIP(hostname)) return !isPrivateAddress(hostname);

  try {
    const enderecos = await lookup(hostname, { all: true });
    if (enderecos.length === 0) return false;
    return enderecos.every((e) => !isPrivateAddress(e.address));
  } catch {
    return false;
  }
}

/** Segue redirecionamentos à mão, validando o destino de cada salto. */
async function fetchSeguro(urlInicial: string, signal: AbortSignal): Promise<Response | null> {
  let atual = urlInicial;

  for (let salto = 0; salto <= MAX_REDIRECTS; salto += 1) {
    if (!isSafeHttpUrl(atual)) return null;
    const url = new URL(atual);
    if (!(await resolveIsPublic(url.hostname))) return null;

    const resposta = await fetch(atual, {
      signal,
      redirect: "manual",
      headers: {
        // Alguns sites só devolvem Open Graph para agentes de pré-visualização.
        "user-agent": "Mozilla/5.0 (compatible; ChromaFluxBot/1.0; +link-preview)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      // A resposta é usada só para metadados; cachear uma hora evita repetir
      // a mesma busca a cada renderização do comentário.
      next: { revalidate: 3600 },
    });

    if (resposta.status >= 300 && resposta.status < 400) {
      const destino = resposta.headers.get("location");
      if (!destino) return null;
      atual = new URL(destino, atual).toString();
      continue;
    }

    return resposta;
  }

  return null;
}

/** Lê no máximo `MAX_BYTES` do corpo — as metatags ficam logo no início. */
async function lerInicio(resposta: Response): Promise<string> {
  const reader = resposta.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8");
  let texto = "";
  let lidos = 0;

  while (lidos < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    lidos += value.byteLength;
    texto += decoder.decode(value, { stream: true });
    // O `</head>` marca o fim do que interessa.
    if (texto.includes("</head>")) break;
  }

  await reader.cancel().catch(() => {});
  return texto;
}

function extrairMeta(html: string, nomes: string[]): string | null {
  for (const nome of nomes) {
    const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const padroes = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escapado}["'][^>]*content=["']([^"']*)["']`,
        "i",
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escapado}["']`,
        "i",
      ),
    ];
    for (const p of padroes) {
      const m = html.match(p);
      if (m?.[1]?.trim()) return decodeEntidades(m[1].trim());
    }
  }
  return null;
}

function decodeEntidades(texto: string): string {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

export async function GET(request: NextRequest) {
  // Endpoint autenticado: sem isso, seria um proxy de requisições aberto.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const alvo = request.nextUrl.searchParams.get("url");
  if (!alvo || !isSafeHttpUrl(alvo)) {
    return NextResponse.json({ erro: "URL inválida." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetchSeguro(alvo, controller.signal);

    if (!resposta || !resposta.ok) {
      return NextResponse.json({ url: alvo, indisponivel: true });
    }

    const tipo = resposta.headers.get("content-type") ?? "";
    if (!tipo.includes("html")) {
      return NextResponse.json({ url: alvo, indisponivel: true });
    }

    const html = await lerInicio(resposta);

    const titulo =
      extrairMeta(html, ["og:title", "twitter:title"]) ??
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ??
      null;

    const imagemBruta = extrairMeta(html, ["og:image", "twitter:image", "twitter:image:src"]);
    // Resolve caminhos relativos e descarta imagens que não sejam http(s).
    let imagem: string | null = null;
    if (imagemBruta) {
      try {
        const absoluta = new URL(imagemBruta, resposta.url || alvo).toString();
        imagem = isSafeHttpUrl(absoluta) ? absoluta : null;
      } catch {
        imagem = null;
      }
    }

    return NextResponse.json({
      url: alvo,
      title: titulo ? decodeEntidades(titulo).slice(0, 200) : null,
      description:
        extrairMeta(html, ["og:description", "twitter:description", "description"])?.slice(
          0,
          300,
        ) ?? null,
      image: imagem,
      siteName: extrairMeta(html, ["og:site_name"]) ?? new URL(alvo).hostname,
    });
  } catch {
    return NextResponse.json({ url: alvo, indisponivel: true });
  } finally {
    clearTimeout(timer);
  }
}
