"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";

export type AccessGroupResult = { error?: string; success?: string };

const uuid = z.string().uuid();

const windowFields = {
  enabled: z.boolean(),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inicial inválido."),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário final inválido."),
  timezone: z.string().min(1).max(64),
};

const saveSchema = z
  .object({
    name: z.string().trim().min(1, "O grupo precisa de um nome.").max(80, "Nome muito longo."),
    ...windowFields,
  })
  .refine((v) => v.startsAt !== v.endsAt, {
    message: "O início e o fim não podem ser iguais.",
  })
  .refine((v) => !v.enabled || v.weekdays.length > 0, {
    message: "Marque pelo menos um dia da semana.",
  });

function revalidateGroups() {
  revalidatePath("/configuracoes");
}

/** Cria um grupo novo, sem membro nenhum. */
export async function createAccessGroupAction(input: {
  name: string;
  enabled: boolean;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  timezone: string;
}): Promise<AccessGroupResult & { id?: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("access_groups")
    .insert({
      owner_id: user.id,
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      weekdays: parsed.data.weekdays,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      timezone: parsed.data.timezone,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { error: "O banco ainda não tem a tabela de grupos de acesso." };
    }
    return { error: error.message };
  }

  revalidateGroups();
  return { success: "Grupo criado.", id: data.id };
}

/** Atualiza nome e janela de um grupo já existente. */
export async function updateAccessGroupAction(
  groupId: string,
  input: {
    name: string;
    enabled: boolean;
    weekdays: number[];
    startsAt: string;
    endsAt: string;
    timezone: string;
  },
): Promise<AccessGroupResult> {
  const ids = uuid.safeParse(groupId);
  if (!ids.success) return { error: "Grupo inválido." };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase
    .from("access_groups")
    .update({
      name: parsed.data.name,
      enabled: parsed.data.enabled,
      weekdays: parsed.data.weekdays,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      timezone: parsed.data.timezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", groupId);

  if (error) return { error: error.message };

  revalidateGroups();
  return { success: "Grupo atualizado." };
}

/** Exclui o grupo — os membros dele voltam para a janela pessoal do dono. */
export async function deleteAccessGroupAction(groupId: string): Promise<AccessGroupResult> {
  const ids = uuid.safeParse(groupId);
  if (!ids.success) return { error: "Grupo inválido." };

  const supabase = await createClient();
  const { error } = await supabase.from("access_groups").delete().eq("id", groupId);

  if (error) return { error: error.message };

  revalidateGroups();
  return { success: "Grupo excluído." };
}

/**
 * Coloca um membro num grupo, tirando-o de qualquer outro em que estivesse —
 * um membro só pertence a um grupo por vez (ver a `unique` em `user_id` na
 * migração 0013). `groupId: null` só remove, devolvendo o membro para a
 * janela pessoal do dono.
 */
export async function setMemberAccessGroupAction(
  memberId: string,
  groupId: string | null,
): Promise<AccessGroupResult> {
  const memberIds = uuid.safeParse(memberId);
  if (!memberIds.success) return { error: "Membro inválido." };
  if (groupId !== null && !uuid.safeParse(groupId).success) {
    return { error: "Grupo inválido." };
  }

  const supabase = await createClient();

  // Sai de onde estava — a unicidade de `user_id` não permite duas linhas.
  const { error: erroRemover } = await supabase
    .from("access_group_members")
    .delete()
    .eq("user_id", memberId);

  if (erroRemover) return { error: erroRemover.message };

  if (groupId) {
    const { error: erroInserir } = await supabase
      .from("access_group_members")
      .insert({ group_id: groupId, user_id: memberId });

    if (erroInserir) return { error: erroInserir.message };
  }

  revalidateGroups();
  return { success: groupId ? "Membro movido para o grupo." : "Membro removido do grupo." };
}
