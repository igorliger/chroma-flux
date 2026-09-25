import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Troca o `code` do link de e-mail por uma sessão.
 *
 * É para cá que apontam os links de confirmação de cadastro e de redefinição
 * de senha (`emailRedirectTo` / `redirectTo`).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("proximo");
  const next = nextParam?.startsWith("/") ? nextParam : "/espacos";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?erro=${encodeURIComponent("Link inválido ou incompleto.")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?erro=${encodeURIComponent(
        "Este link expirou ou já foi usado. Solicite um novo.",
      )}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
