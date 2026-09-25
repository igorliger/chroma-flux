"use server";

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";
import { sendWorkspaceInviteEmail } from "@/lib/email";
import { roleLabel } from "@/lib/utils";

export type ActionState = { error?: string; success?: string };

const workspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Dê um nome ao espaço de trabalho.")
    .max(80, "Nome muito longo (máx. 80 caracteres)."),
  description: z.string().trim().max(300, "Descrição muito longa.").default(""),
  color: z.string().trim().default("indigo"),
});

export async function createWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = workspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    color: formData.get("color") ?? "indigo",
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  // O id é gerado aqui, e não pelo banco, para o INSERT não precisar de
  // RETURNING. Com RETURNING, o Postgres aplicaria a policy de SELECT à linha
  // recém-criada, e nesse instante o gatilho AFTER INSERT que registra o
  // criador como membro ainda não rodou — a criação falharia com erro de RLS.
  const workspaceId = randomUUID();

  const { error } = await supabase
    .from("workspaces")
    .insert({ id: workspaceId, ...parsed.data, owner_id: user.id });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Só proprietários e administradores podem criar espaços de trabalho."
          : error.message,
    };
  }

  // O site inteiro, não só a lista: o espaço novo também precisa aparecer
  // em Configurações (convites e funções), no menu lateral e no seletor.
  revalidatePath("/", "layout");
  redirect(`/e/${workspaceId}`);
}

export async function updateWorkspaceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const parsed = workspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    color: formData.get("color") ?? "indigo",
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update(parsed.data)
    .eq("id", workspaceId);

  // A RLS já barra quem não é administrador; a mensagem só traduz o resultado.
  if (error) return { error: error.message };

  // Nome e cor aparecem em várias telas (menu, Configurações, seletor).
  revalidatePath("/", "layout");
  return { success: "Espaço de trabalho atualizado." };
}

export async function deleteWorkspaceAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const supabase = await createClient();

  await supabase.from("workspaces").delete().eq("id", workspaceId);

  revalidatePath("/", "layout");
  redirect("/espacos");
}

// ---------------------------------------------------------------------------
// Membros e convites
// ---------------------------------------------------------------------------
const inviteSchema = z.object({
  workspaceId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  role: z.enum(["admin", "member", "viewer"], {
    errorMap: () => ({ message: "Selecione um papel válido." }),
  }),
});

export async function inviteMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = inviteSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  // Quem já faz parte da empresa (está em outro espaço do mesmo proprietário)
  // entra direto: o convite por e-mail é feito uma vez só, na primeira vez.
  const { data: daEmpresa } = await supabase.rpc("list_company_people", {
    p_workspace_id: parsed.data.workspaceId,
  });
  const jaNaEmpresa = (daEmpresa ?? []).find(
    (p) => (p.email ?? "").toLowerCase() === parsed.data.email.toLowerCase(),
  );
  if (jaNaEmpresa) {
    const { error: erroMembro } = await supabase.from("workspace_members").insert({
      workspace_id: parsed.data.workspaceId,
      user_id: jaNaEmpresa.id,
      role: parsed.data.role,
    });
    if (erroMembro) return { error: membroErro(erroMembro.code, erroMembro.message) };
    revalidatePath(`/e/${parsed.data.workspaceId}/membros`);
    revalidatePath("/configuracoes");
    return {
      success:
        `${jaNaEmpresa.full_name || parsed.data.email} já faz parte da equipe e foi ` +
        `adicionado(a) direto a este espaço — sem precisar de novo convite.`,
    };
  }

  const { error } = await supabase.from("workspace_invitations").insert({
    workspace_id: parsed.data.workspaceId,
    email: parsed.data.email,
    role: parsed.data.role,
    invited_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "Já existe um convite pendente para este e-mail." };
    }
    return { error: error.message };
  }

  revalidatePath(`/e/${parsed.data.workspaceId}/membros`);

  // O convite já está registrado mesmo se o e-mail falhar — ele aparece do
  // mesmo jeito quando a pessoa entra no Chroma Flux com aquele endereço.
  // Por isso as duas buscas abaixo (nome do espaço, nome de quem convidou)
  // rodam best-effort: um erro aqui não deve desfazer o convite já salvo.
  const [{ data: workspace }, { data: perfil }] = await Promise.all([
    supabase.from("workspaces").select("name").eq("id", parsed.data.workspaceId).maybeSingle(),
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
  ]);

  const emailResult = await sendWorkspaceInviteEmail({
    to: parsed.data.email,
    workspaceName: workspace?.name ?? "Chroma Flux",
    inviterName: perfil?.full_name || perfil?.email || "Alguém",
    roleLabel: roleLabel(parsed.data.role),
  });

  if (emailResult.sent) {
    return {
      success: `Convite enviado por e-mail para ${parsed.data.email}.`,
    };
  }

  // Sem envio: o convite continua valendo (aparece quando a pessoa entrar
  // com esse e-mail), mas quem convidou precisa saber que o e-mail não saiu
  // — e por quê, senão fica esperando uma mensagem que nunca vai chegar.
  return {
    success:
      `Convite registrado para ${parsed.data.email}, mas o e-mail não pôde ser enviado ` +
      `(${emailResult.error ?? "motivo desconhecido"}). ` +
      `A pessoa verá o convite ao entrar no Chroma Flux com esse e-mail.`,
  };
}

export async function revokeInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "");
  const workspaceId = String(formData.get("workspaceId") ?? "");

  const supabase = await createClient();
  await supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId);

  revalidatePath(`/e/${workspaceId}/membros`);
}

export async function acceptInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_invitation_id: invitationId,
  });

  if (error) {
    redirect(`/espacos?erro=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/espacos");
  redirect(`/e/${data}`);
}

/** Traduz as recusas do banco ao mexer em membros. */
function membroErro(code?: string, message?: string) {
  // O gatilho `protect_last_owner` levanta check_violation com texto próprio.
  if (code === "23514" || message?.includes("pelo menos um proprietário")) {
    return "O espaço precisa de pelo menos um proprietário. Promova outra pessoa antes.";
  }
  if (code === "42501") return "Você não tem permissão para alterar membros deste espaço.";
  return message ?? "Não foi possível concluir a alteração.";
}

export async function changeMemberRoleAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  const parsed = z.enum(["owner", "admin", "member", "viewer"]).safeParse(role);
  if (!parsed.success) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspace_members")
    .update({ role: parsed.data })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  // Sem isto, uma recusa do banco não deixaria rastro: o seletor voltaria ao
  // valor anterior e o usuário ficaria sem saber se salvou ou não.
  if (error) {
    redirect(
      `/e/${workspaceId}/membros?erro=${encodeURIComponent(
        membroErro(error.code, error.message),
      )}`,
    );
  }

  revalidatePath(`/e/${workspaceId}/membros`);
}

export async function removeMemberAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId);

  if (error) {
    redirect(
      `/e/${workspaceId}/membros?erro=${encodeURIComponent(
        membroErro(error.code, error.message),
      )}`,
    );
  }

  // Quem sai do próprio espaço perde o acesso e volta para a lista.
  if (userId === user.id) {
    revalidatePath("/espacos");
    redirect("/espacos");
  }

  revalidatePath(`/e/${workspaceId}/membros`);
}

/**
 * Designa quem responde pelo espaço de trabalho.
 *
 * Não é um papel: não concede nem retira permissão. O que muda é a
 * visibilidade — com alguém designado, só essa pessoa e quem administra
 * enxergam as tarefas, os comentários e os anexos do espaço. Deixar em branco
 * devolve o espaço ao uso compartilhado entre todos os membros.
 */
export async function setWorkspaceResponsibleAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const raw = String(formData.get("responsibleId") ?? "");

  const parsed = z
    .union([z.string().uuid(), z.literal("")])
    .transform((v) => (v ? v : null))
    .safeParse(raw);
  if (!parsed.success) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ responsible_id: parsed.data })
    .eq("id", workspaceId);

  if (error) {
    redirect(
      `/e/${workspaceId}/membros?erro=${encodeURIComponent(
        // 23503: a FK composta recusou porque a pessoa não é membro deste
        // espaço — acontece se ela sair enquanto a tela estava aberta.
        error.code === "23503"
          ? "Essa pessoa não é mais membro deste espaço."
          : membroErro(error.code, error.message),
      )}`,
    );
  }

  revalidatePath(`/e/${workspaceId}/membros`);
  revalidatePath(`/e/${workspaceId}`);
  revalidatePath(`/e/${workspaceId}/tarefas`);
}

// ---------------------------------------------------------------------------
// Cartão "Convidados e funções" (Configurações)
// ---------------------------------------------------------------------------
// Versões das ações acima que devolvem o resultado em vez de redirecionar:
// a tela de Configurações mostra o erro no próprio cartão.

/** Funções que se pode dar a quem foi convidado — proprietário não entra aqui. */
const funcaoConvidado = z.enum(["admin", "member", "viewer"]);

export async function setMemberRoleAction(
  workspaceId: string,
  userId: string,
  role: string,
): Promise<{ error?: string }> {
  const parsed = funcaoConvidado.safeParse(role);
  if (!parsed.success) return { error: "Função inválida." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role: parsed.data })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) return { error: membroErro(error.code, error.message) };
  if (!data?.length) return { error: "Você não tem permissão para alterar membros deste espaço." };

  revalidatePath("/configuracoes");
  revalidatePath(`/e/${workspaceId}/membros`);
  return {};
}

export async function setInvitationRoleAction(
  invitationId: string,
  role: string,
): Promise<{ error?: string }> {
  const parsed = funcaoConvidado.safeParse(role);
  if (!parsed.success) return { error: "Função inválida." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .update({ role: parsed.data })
    .eq("id", invitationId)
    .eq("status", "pending")
    .select("workspace_id");

  if (error) return { error: membroErro(error.code, error.message) };
  if (!data?.length) return { error: "Convite não encontrado ou já aceito." };

  revalidatePath("/configuracoes");
  revalidatePath(`/e/${data[0].workspace_id}/membros`);
  return {};
}

export async function cancelInvitationAction(invitationId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .select("workspace_id, email");

  if (error) return { error: membroErro(error.code, error.message) };
  if (!data?.length) return { error: "Convite não encontrado." };

  // Convites repetidos para o mesmo e-mail no mesmo espaço saem juntos —
  // senão o cartão mostraria o próximo da fila como se nada tivesse mudado.
  await supabase
    .from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("workspace_id", data[0].workspace_id)
    .eq("email", data[0].email)
    .eq("status", "pending");

  revalidatePath("/configuracoes");
  revalidatePath(`/e/${data[0].workspace_id}/membros`);
  return {};
}

/** Adiciona ao espaço alguém que já faz parte da empresa — sem convite. */
export async function addTeamMemberAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      workspaceId: z.string().uuid(),
      userId: z.string().uuid("Escolha uma pessoa."),
      role: funcaoConvidado,
    })
    .safeParse({
      workspaceId: formData.get("workspaceId"),
      userId: formData.get("userId"),
      role: formData.get("role"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();

  // Só aceita quem a lista oferece: evita adicionar um id qualquer de fora
  // da empresa mandando o formulário na mão.
  const { data: daEmpresa } = await supabase.rpc("list_company_people", {
    p_workspace_id: parsed.data.workspaceId,
  });
  const pessoa = (daEmpresa ?? []).find((p) => p.id === parsed.data.userId);
  if (!pessoa) return { error: "Essa pessoa não está disponível para este espaço." };

  const { error } = await supabase.from("workspace_members").insert({
    workspace_id: parsed.data.workspaceId,
    user_id: parsed.data.userId,
    role: parsed.data.role,
  });
  if (error) return { error: membroErro(error.code, error.message) };

  revalidatePath(`/e/${parsed.data.workspaceId}/membros`);
  revalidatePath("/configuracoes");
  return { success: `${pessoa.full_name || pessoa.email} foi adicionado(a) ao espaço.` };
}
