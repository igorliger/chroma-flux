import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { DEVICE_COOKIE } from "@/lib/devices";
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
 * Liberação por dispositivo (migração 0033, recurso opcional). Cada navegador
 * ganha um id aleatório num cookie; com o recurso ligado pelo proprietário,
 * quem não é dono nem admin só entra de um dispositivo liberado. A tela de
 * pedido e a de horário continuam acessíveis para não virar loop.
 */
const ALLOWED_WHILE_DEVICE_BLOCKED = ["/dispositivo", "/fora-do-horario"];

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

  // O id do dispositivo nasce na primeira visita e vale ~400 dias (o máximo
  // que os navegadores aceitam). Vai em toda resposta — inclusive nos
  // redirecionamentos — para não trocar de id no meio do caminho.
  const deviceIdExistente = request.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = deviceIdExistente ?? crypto.randomUUID();
  const comDispositivo = (res: NextResponse) => {
    if (!deviceIdExistente) {
      res.cookies.set(DEVICE_COOKIE, deviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 400,
      });
    }
    return res;
  };

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
    return comDispositivo(NextResponse.redirect(redirect));
  }

  if (user && (pathname === "/login" || pathname === "/cadastro")) {
    return comDispositivo(NextResponse.redirect(redirectTo(request, "/espacos")));
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
      return comDispositivo(NextResponse.redirect(redirectTo(request, "/fora-do-horario")));
    }
  }

  // Dispositivo não liberado: manda para a tela de pedido. Como na janela,
  // erro na chamada (ou a migração 0033 ainda não aplicada) não bloqueia
  // ninguém. Desligado — o padrão — a função devolve "ok" para todos.
  if (
    user &&
    !isPublic(pathname) &&
    !ALLOWED_WHILE_DEVICE_BLOCKED.some((route) => pathname.startsWith(route))
  ) {
    const { data: situacao, error } = await supabase.rpc("device_status", {
      p_device_id: deviceId,
    });
    if (!error && situacao && situacao !== "ok") {
      return comDispositivo(NextResponse.redirect(redirectTo(request, "/dispositivo")));
    }
  }

  return comDispositivo(response);
}
