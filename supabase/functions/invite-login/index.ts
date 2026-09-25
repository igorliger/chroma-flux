// =============================================================================
// Edge Function `invite-login` — entrada rápida pelo link do convite
// =============================================================================
// O botão do e-mail de convite leva a /convite/<id>. Lá, "Entrar agora" chama
// o site, que chama esta função com o id do convite. Se o convite de equipe
// estiver pendente, ela gera um acesso de uso único (sem senha) para o e-mail
// convidado — criando a conta, se a pessoa ainda não tiver uma — e devolve o
// `token_hash`, que o site troca por uma sessão (verifyOtp).
//
// O id do convite só existe no e-mail enviado à pessoa, e o convite deixa de
// valer assim que é aceito (o site aceita logo após a entrada). Por isso o
// link funciona uma vez só; depois, a pessoa entra pelo login normal.
//
// Publicada com verify_jwt = false: quem chama ainda não está logado.

import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000;

function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  let corpo: { invitation_id?: string; full_name?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }

  const id = corpo.invitation_id ?? "";
  if (!UUID.test(id)) return json({ error: "Convite inválido." }, 400);

  const { data: convite } = await admin
    .from("team_invitations")
    .select("email, status, created_at")
    .eq("id", id)
    .maybeSingle();

  if (
    !convite ||
    convite.status !== "pending" ||
    Date.now() - new Date(convite.created_at).getTime() > VALIDADE_MS
  ) {
    return json({ error: "Este convite já foi usado ou expirou." }, 410);
  }

  const nome = (corpo.full_name ?? "").trim().slice(0, 120);

  const { data: perfil } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("email", convite.email)
    .maybeSingle();
  const contaNova = !perfil;

  // Conta nova: "invite" cria a conta já confirmada. Existente: "magiclink".
  const { data, error } = await admin.auth.admin.generateLink({
    type: contaNova ? "invite" : "magiclink",
    email: convite.email,
    options: nome ? { data: { full_name: nome } } : undefined,
  });

  if (error || !data?.properties?.hashed_token) {
    console.error("[invite-login]", error?.message);
    return json({ error: "Não foi possível gerar o acesso. Tente entrar com senha." }, 500);
  }

  // Conta que já existia sem nome de verdade (o padrão é a parte antes do @):
  // aproveita o nome informado.
  if (perfil && nome && (!perfil.full_name || perfil.full_name === convite.email.split("@")[0])) {
    await admin.from("profiles").update({ full_name: nome }).eq("id", perfil.id);
  }

  return json({
    token_hash: data.properties.hashed_token,
    type: data.properties.verification_type,
    novo: contaNova,
  });
});
