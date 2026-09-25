import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 *
 * A sessão viaja por cookies, então toda consulta feita por aqui roda com o
 * JWT do usuário — e portanto sob as policies de RLS. Não existe caminho
 * "privilegiado" nesta aplicação: a chave secreta (`sb_secret_...`, antiga
 * `service_role`) não é usada em lugar nenhum, nem mesmo no servidor.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components não podem escrever cookies. O middleware já
          // renova a sessão, então ignorar aqui é seguro.
        }
      },
    },
  });
}

/**
 * Usuário autenticado ou `null`.
 *
 * Usa `getUser()` (que valida o token no servidor do Supabase) em vez de
 * `getSession()`, cujos dados vêm do cookie e podem ser forjados.
 */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
