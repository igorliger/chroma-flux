import type { RecurrenceType, RecurrenceUnit } from "@/lib/database.types";

/**
 * Recorrência de tarefas — nomes, rótulos e resumo legível.
 *
 * Espelha o conjunto de opções do Asana. A regra que define cada tipo mora no
 * banco (`public.next_due_date`), porque quem gera a próxima ocorrência é um
 * gatilho; aqui ficam apenas a forma e a apresentação.
 */

export type Recurrence = {
  type: RecurrenceType;
  interval: number;
  unit: RecurrenceUnit;
  /** 0 = domingo … 6 = sábado. */
  weekdays: number[];
  endsOn: string | null;
};

export const NO_RECURRENCE: Recurrence = {
  type: "none",
  interval: 1,
  unit: "week",
  weekdays: [],
  endsOn: null,
};

export const RECURRENCE_TYPES: { value: RecurrenceType; label: string; hint?: string }[] = [
  { value: "none", label: "Não repetir" },
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanalmente" },
  { value: "monthly", label: "Mensalmente" },
  { value: "yearly", label: "Anualmente" },
  {
    value: "periodic",
    label: "Periodicamente",
    hint: "Conta a partir do dia em que a tarefa for concluída, e não do prazo.",
  },
  {
    value: "custom",
    label: "Personalizado",
    hint: "Escolha o intervalo, a unidade e, se quiser, os dias da semana.",
  },
];

export const RECURRENCE_UNITS: { value: RecurrenceUnit; singular: string; plural: string }[] = [
  { value: "day", singular: "dia", plural: "dias" },
  { value: "week", singular: "semana", plural: "semanas" },
  { value: "month", singular: "mês", plural: "meses" },
  { value: "year", singular: "ano", plural: "anos" },
];

/**
 * Domingo primeiro, como em `extract(dow)` do Postgres e no `getDay()` do JS.
 *
 * O plural existe porque o resumo fala de hábito, não de uma data: "às quintas
 * e sextas", e não "às quinta e sexta".
 */
export const WEEKDAYS = [
  { value: 0, short: "D", label: "domingo", plural: "domingos" },
  { value: 1, short: "S", label: "segunda", plural: "segundas" },
  { value: 2, short: "T", label: "terça", plural: "terças" },
  { value: 3, short: "Q", label: "quarta", plural: "quartas" },
  { value: 4, short: "Q", label: "quinta", plural: "quintas" },
  { value: 5, short: "S", label: "sexta", plural: "sextas" },
  { value: 6, short: "S", label: "sábado", plural: "sábados" },
];

/** `true` quando o tipo escolhido usa dias da semana. */
export function usesWeekdays(type: RecurrenceType, unit: RecurrenceUnit) {
  return type === "weekly" || (type === "custom" && unit === "week");
}

/** `true` quando o tipo deixa o usuário escolher intervalo e unidade. */
export function usesUnit(type: RecurrenceType) {
  return type === "periodic" || type === "custom";
}

function unitLabel(unit: RecurrenceUnit, quantidade: number) {
  const u = RECURRENCE_UNITS.find((x) => x.value === unit) ?? RECURRENCE_UNITS[1];
  return quantidade === 1 ? u.singular : u.plural;
}

function listaDeDias(weekdays: number[]) {
  const nomes = [...weekdays]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS.find((w) => w.value === d)?.plural)
    .filter(Boolean) as string[];

  if (nomes.length === 0) return "";
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * Resumo em uma linha, do tipo "a cada 2 semanas, às segundas e quintas".
 * Devolve `null` quando não há repetição — assim quem chama some com o rótulo.
 */
export function describeRecurrence(r: Recurrence): string | null {
  if (r.type === "none") return null;

  const n = Math.max(1, r.interval);
  const dias = listaDeDias(r.weekdays);

  let base: string;
  switch (r.type) {
    case "daily":
      base = n === 1 ? "Todo dia" : `A cada ${n} dias`;
      break;
    case "weekly":
      base = n === 1 ? "Toda semana" : `A cada ${n} semanas`;
      break;
    case "monthly":
      base = n === 1 ? "Todo mês" : `A cada ${n} meses`;
      break;
    case "yearly":
      base = n === 1 ? "Todo ano" : `A cada ${n} anos`;
      break;
    case "periodic":
      base = `${n} ${unitLabel(r.unit, n)} após concluir`;
      break;
    case "custom":
      base = n === 1 ? `A cada ${unitLabel(r.unit, 1)}` : `A cada ${n} ${unitLabel(r.unit, n)}`;
      break;
    default:
      return null;
  }

  if (dias && usesWeekdays(r.type, r.unit)) {
    return `${base}, às ${dias}`;
  }
  return base;
}

/** Rótulo curto para a linha da lista, onde o espaço é apertado. */
export function shortRecurrenceLabel(r: Recurrence): string | null {
  if (r.type === "none") return null;
  const n = Math.max(1, r.interval);

  switch (r.type) {
    case "daily":
      return n === 1 ? "diária" : `${n}/dias`;
    case "weekly":
      return n === 1 ? "semanal" : `${n}/sem`;
    case "monthly":
      return n === 1 ? "mensal" : `${n}/meses`;
    case "yearly":
      return "anual";
    case "periodic":
      return `${n} ${unitLabel(r.unit, n)}`;
    case "custom":
      return `${n} ${unitLabel(r.unit, n)}`;
    default:
      return null;
  }
}

/** Extrai a recorrência de uma linha de tarefa vinda do banco. */
export function recurrenceFromTask(task: {
  recurrence_type: RecurrenceType;
  recurrence_interval: number;
  recurrence_unit: RecurrenceUnit;
  recurrence_weekdays: number[] | null;
  recurrence_ends_on: string | null;
}): Recurrence {
  return {
    type: task.recurrence_type ?? "none",
    interval: task.recurrence_interval ?? 1,
    unit: task.recurrence_unit ?? "week",
    weekdays: task.recurrence_weekdays ?? [],
    endsOn: task.recurrence_ends_on,
  };
}

/**
 * O banco recusa agenda fixa sem prazo (`tasks_recurrence_needs_due_date`).
 * Validar antes de enviar dá uma mensagem clara em vez do erro cru do Postgres.
 */
export function recurrenceNeedsDueDate(type: RecurrenceType) {
  return type !== "none" && type !== "periodic";
}

/**
 * O que ainda falta para a repetição poder ser gravada, ou `null` se nada falta.
 *
 * Escolher "Diariamente" antes do prazo é a ordem natural de quem preenche o
 * formulário de cima para baixo — não é engano. Enquanto a combinação estiver
 * pela metade ela fica só na tela, porque mandá-la ao servidor renderia uma
 * recusa e um painel mostrando uma agenda que o banco não tem.
 */
export function recurrencePendingReason(r: Recurrence, dueDate: string | null): string | null {
  if (recurrenceNeedsDueDate(r.type) && !dueDate) {
    return (
      "Escolha um prazo para salvar esta repetição: ela segue uma agenda a partir dele. " +
      "Para contar a partir da conclusão, use “Periodicamente”."
    );
  }
  if (usesWeekdays(r.type, r.unit) && r.weekdays.length === 0) {
    return "Marque pelo menos um dia da semana para salvar esta repetição.";
  }
  return null;
}
