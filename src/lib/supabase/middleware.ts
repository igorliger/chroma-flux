import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabasePublishableKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/env";

// "/convite": página do link do e-mail de convite — quem chega nela ainda
// não tem conta ou não está logado.
const PUBLIC_ROUTES = ["/login", "/cadastro", "/auth", "/recuperar-senha", "/convite"];

function isPublic(pathname: string) {
  return pathname === "/" || PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

/**
 * Rotas que continuam acessíveis mesmo fora da janela de uso: a própria tela
 * de aviso (senão o redirect para ela viraria um loop) e sair, que a tela usa
 * para deslogar. Tudo que é público já passa antes desta checagem.
 */
const ALLOWED_WHILE_BLOCKED = ["/fora-do-horario"];

/**
 * Monta a URL de redirecionamento a partir do que o Nginx repassou, não do
 * endereço em que o Next.js está escutando.
 *
 * O processo roda em `127.0.0.1:3000` atrás do proxy — `request.nextUrl`, por
 * si só, reflete esse endereço de escuta, não o domínio público
 * (`www.chromaflux.com.br`). Sem isto, todo redirecionamento daqui (login,
 * fora do horário, etc.) saía apontando para "localhost:3000", que o
 * navegador de quem acessa não tem como alcançar.
 */
function redirectTo(request: NextRequest, pathname: string): URL {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : request.nextUrl.origin;
  return new URL(pathname, origin);
}

/**
 * Renova o token de acesso a cada navegação e barra rotas privadas.
 *
 * O middleware é a única camada que consegue reescrever os cookies de sessão,
 * por isso a resposta precisa carregar os cookies atualizados adiante.
 */
export async function updateSession(request: NextRequest) {
  // Sem credenciais não há sessão a renovar. Deixar passar faz a aplicação
  // exibir a tela de configuração em vez de falhar em toda requisição.
  if (!isSupabaseConfigured()) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const redirect = redirectTo(request, "/login");
    redirect.searchParams.set("proximo", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && (pathname === "/login" || pathname === "/cadastro")) {
    return NextResponse.redirect(redirectTo(request, "/espacos"));
  }

  // Fora da janela de uso: manda para a tela de aviso em vez do conteúdo —
  // só para quem já está autenticado e fora das rotas sempre permitidas.
  // Um erro na chamada (rede, RPC fora do ar) não bloqueia ninguém: só a
  // janela em si, já validada de novo a cada ação de escrita no banco.
  if (
    user &&
    !isPublic(pathname) &&
    !ALLOWED_WHILE_BLOCKED.some((route) => pathname.startsWith(route))
  ) {
    const { data: bloqueado } = await supabase.rpc("is_blocked_by_access_window");
    if (bloqueado) {
      return NextResponse.redirect(redirectTo(request, "/fora-do-horario"));
    }
  }

  return response;
}
