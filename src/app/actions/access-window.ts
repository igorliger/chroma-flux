"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/queries";

export type AccessWindowResult = { error?: string; success?: string };

const schema = z
  .object({
    enabled: z.boolean(),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
    startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inicial inválido."),
    endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário final inválido."),
    timezone: z.string().min(1).max(64),
  })
  .refine((v) => v.startsAt !== v.endsAt, {
    message: "O início e o fim não podem ser iguais.",
  })
  .refine((v) => !v.enabled || v.weekdays.length > 0, {
    message: "Marque pelo menos um dia da semana.",
  });

export async function saveAccessWindowAction(input: {
  enabled: boolean;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  timezone: string;
}): Promise<AccessWindowResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.from("user_access_windows").upsert(
    {
      user_id: user.id,
      enabled: parsed.data.enabled,
      weekdays: parsed.data.weekdays,
      starts_at: parsed.data.startsAt,
      ends_at: parsed.data.endsAt,
      timezone: parsed.data.timezone,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { error: "O banco ainda não tem a tabela de janela de uso." };
    }
    return { error: error.message };
  }

  // A janela afeta o que qualquer membro consegue fazer em qualquer espaço.
  revalidatePath("/", "layout");

  return {
    success: parsed.data.enabled
      ? "Janela de uso ativada."
      : "Janela de uso desativada — sem restrição de horário.",
  };
}
