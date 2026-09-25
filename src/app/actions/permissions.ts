"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";
import { ALL_CAPABILITIES, ROLE_ORDER, isLocked, type Capability } from "@/lib/permissions";
import type { WorkspaceRole } from "@/lib/database.types";

export type PermissionsResult = { error?: string; success?: string };

const schema = z.object({
  matriz: z.record(z.enum(["owner", "admin", "member", "viewer"]), z.array(z.string())),
});

/**
 * Grava a matriz da conta.
 *
 * É uma só, e todos os espaços do usuário a herdam — salvar aqui muda as
 * regras de todos de uma vez.
 *
 * Substitui tudo em vez de aplicar diferenças: a tela envia o estado completo
 * que está à vista, o que mantém banco e interface em acordo sem depender de
 * qual caixa foi clicada.
 */
export async function savePermissionsAction(
  matriz: Record<WorkspaceRole, Capability[]>,
): Promise<PermissionsResult> {
  const parsed = schema.safeParse({ matriz });
  if (!parsed.success) return { error: "Dados de permissão inválidos." };

  const user = await requireUser();

  // Só capacidades conhecidas entram: a tela não deve conseguir criar chaves
  // que nenhuma policy consulta.
  const linhas: { user_id: string; role: WorkspaceRole; capability: Capability }[] = [];

  for (const role of ROLE_ORDER) {
    const escolhidas = (matriz[role] ?? []).filter((c): c is Capability =>
      ALL_CAPABILITIES.includes(c as Capability),
    );

    for (const capability of escolhidas) {
      linhas.push({ user_id: user.id, role, capability });
    }

    // As travadas são reinseridas mesmo que a tela não as envie.
    for (const capability of ALL_CAPABILITIES) {
      if (
        isLocked(role, capability) &&
        !linhas.some((l) => l.role === role && l.capability === capability)
      ) {
        linhas.push({ user_id: user.id, role, capability });
      }
    }
  }

  const supabase = await createClient();

  // A linha travada do proprietário fica de fora do delete: o gatilho do banco
  // recusa apagá-la, e a recusa abortaria a operação inteira.
  const { error: erroDelete } = await supabase
    .from("user_permissions")
    .delete()
    .eq("user_id", user.id)
    .not("capability", "eq", "member.manage")
    .in("capability", ALL_CAPABILITIES);

  if (erroDelete) {
    return {
      error:
        erroDelete.code === "42P01" || erroDelete.code === "PGRST205"
          ? "O banco ainda não tem a tabela de permissões da conta."
          : erroDelete.message,
    };
  }

  // `member.manage` some apenas dos papéis que não são o de proprietário.
  const { error: erroManage } = await supabase
    .from("user_permissions")
    .delete()
    .eq("user_id", user.id)
    .eq("capability", "member.manage")
    .neq("role", "owner");

  if (erroManage) return { error: erroManage.message };

  const { error: erroInsert } = await supabase
    .from("user_permissions")
    .upsert(linhas, { onConflict: "user_id,role,capability", ignoreDuplicates: true });

  if (erroInsert) return { error: erroInsert.message };

  // Todas as telas de todos os espaços dependem da matriz.
  revalidatePath("/", "layout");
  return { success: "Permissões atualizadas em todos os seus espaços." };
}
