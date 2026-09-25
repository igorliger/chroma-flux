"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Cliente Supabase para o navegador. A publishable key é pública por design —
 * quem protege os dados é a RLS, não o segredo da chave.
 */
export function createClient() {
  return createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey());
}
