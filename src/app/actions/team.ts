"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sendTeamInviteEmail } from "@/lib/email";
import { requireUser } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/lib/database.types";

export type TeamActionState = { error?: string; success?: string };

/** Funções que se pode dar num espaço; "none" = sem acesso. */
const funcao = z.enum(["admin", "member", "viewer"]);
const funcaoOuNenhuma = z.enum(["admin", "member", "viewer", "none"]);

function revalidarTudo() {
  revalidatePath("/equipe");
  revalidatePath("/espacos");
  revalidatePath("/configuracoes");
}

/** Espaços de que quem está logado é proprietário — só neles dá para designar. */
async function meusEspacos() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("workspaces").select("id, name").eq("owner_id", user.id);
  return { user, supabase, espacos: data ?? [] };
}

/**
 * Convida alguém para a equipe — uma vez só. Os espaços marcados no
 * formulário (`espaco:<id>` = função) ficam guardados no convite e são
 * aplicados quando a pessoa entrar.
 */
export async function inviteToTeamAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .email("Informe um e-mail válido.")
    .safeParse(formData.get("email"));
  if (!email.success) return { error: email.error.issues[0].message };

  const { user, supabase, espacos } = await meusEspacos();
  if (espacos.length === 0) {
    return { error: "Só o proprietário de um espaço pode convidar para a equipe." };
  }

  const workspaceRoles: Record<string, WorkspaceRole> = {};
  for (const e of espacos) {
    const r = funcao.safeParse(formData.get(`espaco:${e.id}`));
    if (r.success) workspaceRoles[e.id] = r.data;
  }

  // Já está na equipe? Então não precisa de convite: é só designar os espaços.
  const { data: perfil } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email.data)
    .maybeSingle();
  if (perfil) {
    if (perfil.id === user.id) return { error: "Esse é o seu próprio e-mail." };
    const { data: jaNaEquipe } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("owner_id", user.id)
      .eq("user_id", perfil.id)
      .maybeSingle();
    if (jaNaEquipe) {
      return {
        error: "Essa pessoa já faz parte da equipe. Escolha os espaços dela na lista abaixo.",
      };
    }
  }

  const { data: criado, error } = await supabase
    .from("team_invitations")
    .insert({
      owner_id: user.id,
      email: email.data,
      workspace_roles: workspaceRoles,
      invited_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "Já existe um convite pendente para este e-mail — use “Reenviar”." };
    }
    return { error: "Não foi possível registrar o convite." };
  }

  revalidarTudo();
  const envio = await enviarEmail(criado.id, email.data, workspaceRoles, espacos);

  return envio.sent
    ? { success: `Convite enviado por e-mail para ${email.data}.` }
    : {
        success:
          `Convite registrado para ${email.data}, mas o e-mail não pôde ser enviado ` +
          `(${envio.error ?? "motivo desconhecido"}). A pessoa entra na equipe ao acessar o ` +
          `Chroma Flux com esse e-mail.`,
      };
}

async function enviarEmail(
  invitationId: string,
  email: string,
  workspaceRoles: Record<string, WorkspaceRole>,
  espacos: { id: string; name: string }[],
) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: eu } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  return sendTeamInviteEmail({
    to: email,
    inviterName: eu?.full_name || eu?.email || "Alguém",
    workspaceNames: espacos.filter((e) => workspaceRoles[e.id]).map((e) => e.name),
    invitationId,
  });
}

/** Manda o e-mail do convite de novo (sem criar outro convite). */
export async function resendTeamInviteAction(invitationId: string): Promise<TeamActionState> {
  const { supabase, espacos } = await meusEspacos();
  const { data: convite } = await supabase
    .from("team_invitations")
    .select("email, workspace_roles")
    .eq("id", invitationId)
    .eq("status", "pending")
    .maybeSingle();
  if (!convite) return { error: "Convite não encontrado." };

  const envio = await enviarEmail(
    invitationId,
    convite.email,
    (convite.workspace_roles ?? {}) as Record<string, WorkspaceRole>,
    espacos,
  );
  return envio.sent
    ? { success: `E-mail reenviado para ${convite.email}.` }
    : { error: `O e-mail não pôde ser enviado (${envio.error ?? "motivo desconhecido"}).` };
}

export async function cancelTeamInviteAction(invitationId: string): Promise<TeamActionState> {
  const { supabase } = await meusEspacos();
  const { data, error } = await supabase
    .from("team_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .select("id");
  if (error || !data?.length) return { error: "Não foi possível cancelar o convite." };
  revalidarTudo();
  return {};
}

/** Função de um convite pendente num espaço ("none" = não vai entrar nele). */
export async function setInviteWorkspaceRoleAction(
  invitationId: string,
  workspaceId: string,
  role: string,
): Promise<TeamActionState> {
  const r = funcaoOuNenhuma.safeParse(role);
  if (!r.success) return { error: "Função inválida." };

  const { supabase, espacos } = await meusEspacos();
  if (!espacos.some((e) => e.id === workspaceId)) return { error: "Espaço inválido." };

  const { data: convite } = await supabase
    .from("team_invitations")
    .select("workspace_roles")
    .eq("id", invitationId)
    .eq("status", "pending")
    .maybeSingle();
  if (!convite) return { error: "Convite não encontrado ou já aceito." };

  const roles = { ...((convite.workspace_roles ?? {}) as Record<string, WorkspaceRole>) };
  if (r.data === "none") delete roles[workspaceId];
  else roles[workspaceId] = r.data;

  const { error } = await supabase
    .from("team_invitations")
    .update({ workspace_roles: roles })
    .eq("id", invitationId);
  if (error) return { error: "Não foi possível salvar." };

  revalidarTudo();
  return {};
}

/** Acesso de alguém da equipe a um espaço: entra, muda de função ou sai. */
export async function setMemberWorkspaceRoleAction(
  userId: string,
  workspaceId: string,
  role: string,
): Promise<TeamActionState> {
  const r = funcaoOuNenhuma.safeParse(role);
  if (!r.success) return { error: "Função inválida." };

  const { user, supabase, espacos } = await meusEspacos();
  if (!espacos.some((e) => e.id === workspaceId)) return { error: "Espaço inválido." };

  const { data: naEquipe } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("owner_id", user.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!naEquipe) return { error: "Essa pessoa não faz parte da sua equipe." };

  if (r.data === "none") {
    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId);
    if (error) return { error: "Não foi possível tirar a pessoa do espaço." };
  } else {
    const { error } = await supabase
      .from("workspace_members")
      .upsert(
        { workspace_id: workspaceId, user_id: userId, role: r.data },
        { onConflict: "workspace_id,user_id" },
      );
    if (error) return { error: "Não foi possível salvar o acesso." };
  }

  revalidarTudo();
  revalidatePath(`/e/${workspaceId}/membros`);
  return {};
}

/** Tira a pessoa da equipe e de todos os seus espaços. */
export async function removeFromTeamAction(userId: string): Promise<TeamActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team_member", { p_user_id: userId });
  if (error) return { error: "Não foi possível remover a pessoa da equipe." };
  revalidarTudo();
  return {};
}
