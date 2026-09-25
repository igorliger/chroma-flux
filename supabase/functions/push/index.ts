// =============================================================================
// Edge Function `push` — envia as notificações do Chroma Flux (Web Push)
// =============================================================================
// Chamada de três jeitos:
//   { type: "completed", task_id, completed_by } — pelo gatilho do banco,
//       quando uma tarefa é concluída (ver migração 0016);
//   { type: "reminders" } — pelo pg_cron, a cada 5 minutos;
//   { type: "test" } — pelo site, com o token do usuário logado, para o botão
//       "Enviar notificação de teste".
//
// As duas primeiras só são aceitas com o cabeçalho `x-flux-secret` certo (o
// segredo fica no Vault do Supabase). A de teste exige um usuário logado e
// só envia para os dispositivos dele mesmo.
//
// Publicada com verify_jwt = false porque o gatilho e o cron não têm JWT de
// usuário — a autenticação é a descrita acima, feita aqui dentro.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type Mensagem = { title: string; body: string; url: string; tag?: string };

type Config = {
  vapid_public_key: string;
  vapid_private_key: string;
  webhook_secret: string;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let config: Config | null = null;

async function getConfig(): Promise<Config> {
  if (config) return config;
  const { data, error } = await supabase.rpc("get_push_config");
  if (error) throw new Error(`Falha ao ler a configuração: ${error.message}`);
  const c = data as Config;
  if (!c?.vapid_public_key || !c?.vapid_private_key || !c?.webhook_secret) {
    throw new Error("Chaves de notificação ausentes no Vault.");
  }
  webpush.setVapidDetails("https://www.chromaflux.com.br", c.vapid_public_key, c.vapid_private_key);
  config = c;
  return c;
}

/** Envia para todos os dispositivos das pessoas; apaga os que expiraram. */
async function enviarPara(userIds: string[], msg: Mensagem) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return { enviados: 0, removidos: 0, falhas: 0 };

  const { data: assinaturas, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids);
  if (error) throw new Error(error.message);

  let enviados = 0;
  let removidos = 0;
  let falhas = 0;

  await Promise.all(
    (assinaturas ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 60 * 60 * 6, urgency: "high" },
        );
        enviados++;
        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410: o navegador cancelou a assinatura (permissão retirada,
        // dados apagados). Não adianta tentar de novo — sai da lista.
        if (status === 404 || status === 410) {
          removidos++;
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        } else {
          falhas++;
          console.error("[push] falha ao enviar", status, (e as Error).message);
        }
      }
    }),
  );

  return { enviados, removidos, falhas };
}

async function tarefaConcluida(taskId: string, concluidaPor: string | null) {
  const { data: tarefa } = await supabase
    .from("tasks")
    .select("id, title, workspace_id, created_by, is_personal")
    .eq("id", taskId)
    .maybeSingle();
  if (!tarefa || tarefa.is_personal) return { enviados: 0, removidos: 0, falhas: 0 };

  const [{ data: espaco }, { data: gestores }, { data: perfil }] = await Promise.all([
    supabase.from("workspaces").select("name, owner_id").eq("id", tarefa.workspace_id).maybeSingle(),
    supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", tarefa.workspace_id)
      .in("role", ["owner", "admin"]),
    concluidaPor
      ? supabase.from("profiles").select("full_name, email").eq("id", concluidaPor).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Quem criou a tarefa e quem administra o espaço — menos quem concluiu,
  // que já sabe.
  const destinatarios = [
    tarefa.created_by,
    espaco?.owner_id,
    ...(gestores ?? []).map((g) => g.user_id),
  ].filter((id): id is string => !!id && id !== concluidaPor);

  const quem = perfil?.full_name || perfil?.email || "Alguém";

  return enviarPara(destinatarios, {
    title: "Tarefa concluída ✅",
    body: `${quem} concluiu “${tarefa.title}”${espaco?.name ? ` · ${espaco.name}` : ""}`,
    url: `/e/${tarefa.workspace_id}/tarefas`,
    tag: `concluida-${tarefa.id}`,
  });
}

async function lembretes() {
  const { data, error } = await supabase.rpc("claim_push_reminders");
  if (error) throw new Error(error.message);

  const total = { enviados: 0, removidos: 0, falhas: 0 };
  for (const r of (data ?? []) as {
    user_id: string;
    kind: string;
    ref: string;
    title: string;
    body: string;
    url: string;
  }[]) {
    const res = await enviarPara([r.user_id], {
      title: r.title,
      body: r.body,
      url: r.url,
      tag: `${r.kind}-${r.ref}`,
    });
    total.enviados += res.enviados;
    total.removidos += res.removidos;
    total.falhas += res.falhas;
  }
  return total;
}

function json(dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "método não permitido" }, 405);

  let corpo: { type?: string; task_id?: string; completed_by?: string | null };
  try {
    corpo = await req.json();
  } catch {
    return json({ error: "corpo inválido" }, 400);
  }

  try {
    const cfg = await getConfig();

    if (corpo.type === "test") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = await supabase.auth.getUser(token);
      if (!data.user) return json({ error: "não autenticado" }, 401);

      const res = await enviarPara([data.user.id], {
        title: "Notificações ativadas 🔔",
        body: "Tudo certo! Você vai receber os avisos de tarefas do Chroma Flux aqui.",
        url: "/configuracoes",
        tag: "teste",
      });
      return json(res);
    }

    if (req.headers.get("x-flux-secret") !== cfg.webhook_secret) {
      return json({ error: "não autorizado" }, 401);
    }

    if (corpo.type === "completed" && corpo.task_id) {
      return json(await tarefaConcluida(corpo.task_id, corpo.completed_by ?? null));
    }
    if (corpo.type === "reminders") {
      return json(await lembretes());
    }
    return json({ error: "tipo desconhecido" }, 400);
  } catch (e) {
    console.error("[push]", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
