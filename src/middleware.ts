import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto assets estáticos e imagens — não faz sentido
     * gastar uma validação de token para servir um favicon. O service worker
     * (`/sw.js`) e o manifest também ficam de fora: o navegador os busca
     * sozinho, e um redirecionamento (login, fora do horário) os quebraria.
     * `/api/versao` também: é consultada a cada poucos minutos só para saber
     * se saiu versão nova, e não lê dado nenhum.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|api/versao|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
