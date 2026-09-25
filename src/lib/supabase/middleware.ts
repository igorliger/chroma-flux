import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { getSupabasePublishableKey, getSupabaseUrl, isSupabaseConfigured } from "@/lib/env";

const PUBLIC_ROUTES = ["/login", "/cadastro", "/auth", "/recuperar-senha"];

function isPublic(pathname: string) {
  return pathname === "/" || PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
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
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("proximo", pathname);
    return NextResponse.redirect(redirect);
  }

  if (user && (pathname === "/login" || pathname === "/cadastro")) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/espacos";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return response;
}
