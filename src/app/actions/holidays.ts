"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export type HolidayState = { error?: string; success?: string };

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escolha a data."),
  name: z.string().trim().min(1, "Dê um nome ao feriado.").max(80, "Nome muito longo."),
  scope: z.enum(["nacional", "estadual", "municipal", "empresa"]).default("empresa"),
});

function revalidar() {
  // O prazo das tarefas pode ter mudado (feriado novo move as do dia).
  revalidatePath("/", "layout");
}

export async function addHolidayAction(
  _prev: HolidayState,
  formData: FormData,
): Promise<HolidayState> {
  const parsed = schema.safeParse({
    date: formData.get("date"),
    name: formData.get("name"),
    scope: formData.get("scope") ?? "empresa",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert({ owner_id: user.id, ...parsed.data });

  if (error) {
    if (error.code === "23505") return { error: "Já existe um feriado nessa data." };
    return { error: "Não foi possível cadastrar o feriado." };
  }

  revalidar();
  return {
    success:
      "Feriado cadastrado. Tarefas abertas marcadas para esse dia foram para o próximo dia útil.",
  };
}

/** Liga/desliga "Dia com feriado: passar para o dia seguinte" em todas as tarefas (0037). */
export async function setHolidayWeekShiftAllAction(on: boolean): Promise<HolidayState> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_holiday_week_shift_all", { p_on: on });
  if (error) {
    if (error.code === "42501" && error.message.startsWith("Você ")) return { error: error.message };
    return { error: "Não foi possível mudar a opção. Tente de novo." };
  }
  revalidar();
  const n = Number(data ?? 0);
  const ajuste = n === 1 ? "1 tarefa ajustada" : `${n} tarefas ajustadas`;
  return {
    success: on
      ? `Ligado para todas as tarefas repetidas (${ajuste}).`
      : `Desligado para todas as tarefas repetidas (${ajuste}).`,
  };
}

export async function deleteHolidayAction(id: string): Promise<HolidayState> {
  if (!z.string().uuid().safeParse(id).success) return { error: "Feriado inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) return { error: "Não foi possível remover o feriado." };
  revalidar();
  return {};
}
