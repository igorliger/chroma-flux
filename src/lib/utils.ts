import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import type { TaskPriority, WorkspaceRole } from "@/lib/database.types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Prioridades
// ---------------------------------------------------------------------------
// Os selos usam os tokens de estado, e não as paletas prontas do Tailwind:
// `bg-rose-50` continuaria quase branco no tema escuro. Ver globals.css.
export const PRIORITIES: {
  value: TaskPriority;
  label: string;
  dot: string;
  chip: string;
}[] = [
  { value: "low", label: "Baixa", dot: "bg-ink-400", chip: "bg-ink-100 text-ink-600" },
  { value: "medium", label: "Média", dot: "bg-sky-500", chip: "bg-info-bg text-info-fg" },
  { value: "high", label: "Alta", dot: "bg-amber-500", chip: "bg-warn-bg text-warn-fg" },
  { value: "urgent", label: "Urgente", dot: "bg-rose-500", chip: "bg-danger-bg text-danger-fg" },
];

export function priorityMeta(priority: TaskPriority) {
  return PRIORITIES.find((p) => p.value === priority) ?? PRIORITIES[1];
}

/** Ordem decrescente de urgência, para ordenar listas. */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Papéis
// ---------------------------------------------------------------------------
export const ROLES: { value: WorkspaceRole; label: string; description: string }[] = [
  {
    value: "owner",
    label: "Proprietário",
    description: "Controle total, incluindo excluir o espaço de trabalho.",
  },
  {
    value: "admin",
    label: "Administrador",
    description: "Gerencia tarefas, membros e permissões.",
  },
  {
    value: "member",
    label: "Membro",
    description: "Cria e edita tarefas e comentários.",
  },
  {
    value: "viewer",
    label: "Visualizador",
    description: "Somente leitura.",
  },
];

export function roleLabel(role: WorkspaceRole) {
  return ROLES.find((r) => r.value === role)?.label ?? role;
}

export function canWrite(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "admin" || role === "member";
}

export function canAdminister(role: WorkspaceRole | null | undefined) {
  return role === "owner" || role === "admin";
}

/**
 * Quem pode criar espaço novo: proprietário ou administrador de algum
 * espaço, ou quem ainda não participa de nenhum (conta nova). Espelha
 * `can_create_workspace()` no banco, que é quem de fato decide — aqui é só
 * para não oferecer o botão a quem seria recusado.
 */
export function canCreateWorkspace(roles: (WorkspaceRole | null | undefined)[]) {
  return roles.length === 0 || roles.some(canAdminister);
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------
function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === "string" ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function formatDate(value: string | Date | null | undefined, pattern = "d 'de' MMM") {
  const date = toDate(value);
  return date ? format(date, pattern, { locale: ptBR }) : "";
}

export function formatDateTime(value: string | Date | null | undefined) {
  return formatDate(value, "d 'de' MMM 'às' HH:mm");
}

// ---------------------------------------------------------------------------
// Hora do prazo
// ---------------------------------------------------------------------------

/**
 * Horários de meia em meia hora, de 00:00 a 23:30.
 *
 * Gerado em vez de escrito à mão: 48 entradas literais seriam ruído, e a lista
 * precisa ficar consistente com o passo caso ele mude.
 */
export const TIME_OPTIONS: { value: string; label: string }[] = Array.from(
  { length: 48 },
  (_, i) => {
    const hora = Math.floor(i / 2);
    const minuto = i % 2 === 0 ? "00" : "30";
    const valor = `${String(hora).padStart(2, "0")}:${minuto}`;
    return { value: valor, label: valor };
  },
);

/** Normaliza a hora vinda do banco ("14:30:00") para o formato do seletor. */
export function toTimeOption(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{2}):(\d{2})/.exec(value);
  if (!m) return "";

  // Arredonda para baixo até a meia hora, para um valor fora da grade (vindo
  // de importação ou de uma versão anterior) ainda casar com uma opção.
  const minuto = Number(m[2]) >= 30 ? "30" : "00";
  return `${m[1]}:${minuto}`;
}

/** "14:30", ou vazio quando não há hora. */
export function formatTime(value: string | null | undefined): string {
  return toTimeOption(value);
}

/**
 * Rótulo curto e humano para um prazo, com o tom certo de urgência.
 *
 * `now` existe por causa da renderização no servidor. A hora do prazo é hora
 * de parede, e o servidor roda em UTC — comparar com o relógio dele marcaria
 * como atrasada uma tarefa que ainda não venceu para quem está no Brasil, e o
 * HTML gerado divergiria do que o navegador desenha depois. Passando `null`,
 * a comparação fica só no nível de data (idêntica nos dois lados); passando o
 * relógio do navegador, ela ganha a precisão da hora. Ver `useNow()`.
 */
export function dueDateMeta(
  dueDate: string | null,
  isCompleted: boolean,
  dueTime?: string | null,
  now?: Date | null,
) {
  const date = toDate(dueDate);
  if (!date) return null;

  const referencia = now ?? new Date();
  const days = differenceInCalendarDays(date, referencia);

  let overdue = !isCompleted && days < 0;

  // Vence hoje, mas a hora já passou.
  if (!overdue && !isCompleted && days === 0 && dueTime && now) {
    const m = /^(\d{2}):(\d{2})/.exec(dueTime);
    if (m) {
      const limite = new Date(now);
      limite.setHours(Number(m[1]), Number(m[2]), 0, 0);
      overdue = limite.getTime() < now.getTime();
    }
  }

  let label: string;
  if (days === 0) label = "Hoje";
  else if (days === 1) label = "Amanhã";
  else if (days === -1) label = "Ontem";
  else if (days > 1 && days <= 7) label = format(date, "EEEE", { locale: ptBR });
  else label = format(date, "d 'de' MMM", { locale: ptBR });

  // A hora entra no rótulo quando existe: "Hoje 14:30", "12 de set 09:00".
  const hora = formatTime(dueTime);
  if (hora) label = `${label} ${hora}`;

  return {
    label,
    overdue,
    dueSoon: !overdue && !isCompleted && days >= 0 && days <= 2,
    className: overdue
      ? "bg-danger-bg text-danger-fg"
      : !isCompleted && days >= 0 && days <= 2
        ? "bg-warn-bg text-warn-fg"
        : "bg-ink-100 text-ink-500",
  };
}

/** `true` se a tarefa está atrasada. */
export function isOverdue(dueDate: string | null, isCompleted: boolean) {
  const date = toDate(dueDate);
  if (!date || isCompleted) return false;
  return differenceInCalendarDays(date, new Date()) < 0;
}

/** Data de hoje em `yyyy-MM-dd`, o formato aceito pelo tipo `date` do Postgres. */
export function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Diversos
// ---------------------------------------------------------------------------
export function initials(name: string, email?: string) {
  const source = name.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Cor estável derivada do id, para avatares sem foto. */
export function avatarColor(id: string) {
  const palette = [
    "bg-brand-500",
    "bg-teal-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-emerald-500",
    "bg-sky-500",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/**
 * Cores disponíveis para os espaços de trabalho, na ordem do seletor (em
 * volta do círculo cromático, e os neutros no fim). As classes ficam
 * escritas por extenso de propósito: o Tailwind só gera as classes que
 * encontra literalmente no código — montá-las com texto variável faria a cor
 * sumir. O `value` é o que fica salvo no banco; os seis primeiros valores
 * antigos continuam os mesmos, então espaços existentes não mudam de cor.
 */
export const ACCENT_COLORS = [
  { value: "indigo", label: "Índigo", className: "bg-brand-500" },
  { value: "blue", label: "Azul", className: "bg-blue-500" },
  { value: "sky", label: "Céu", className: "bg-sky-500" },
  { value: "cyan", label: "Ciano", className: "bg-cyan-500" },
  { value: "teal", label: "Turquesa", className: "bg-teal-500" },
  { value: "emerald", label: "Esmeralda", className: "bg-emerald-500" },
  { value: "green", label: "Verde", className: "bg-green-500" },
  { value: "lime", label: "Lima", className: "bg-lime-500" },
  { value: "yellow", label: "Amarelo", className: "bg-yellow-400" },
  { value: "amber", label: "Âmbar", className: "bg-amber-500" },
  { value: "orange", label: "Laranja", className: "bg-orange-500" },
  { value: "red", label: "Vermelho", className: "bg-red-500" },
  { value: "rose", label: "Rosa", className: "bg-rose-500" },
  { value: "pink", label: "Pink", className: "bg-pink-500" },
  { value: "fuchsia", label: "Fúcsia", className: "bg-fuchsia-500" },
  { value: "purple", label: "Roxo", className: "bg-purple-500" },
  { value: "violet", label: "Violeta", className: "bg-violet-500" },
  { value: "slate", label: "Grafite", className: "bg-slate-500" },
];

export function accentClass(color: string) {
  return ACCENT_COLORS.find((c) => c.value === color)?.className ?? "bg-brand-500";
}

/**
 * Calcula a posição de um item inserido entre dois vizinhos.
 * Posições fracionárias evitam reescrever a coluna inteira a cada arrasto.
 */
export function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000;
  if (before === undefined) return (after as number) - 1000;
  if (after === undefined) return before + 1000;
  return (before + after) / 2;
}

/** Todos os responsáveis da tarefa: o principal primeiro, depois os demais. */
export function responsibleIds(task: {
  assignee_id: string | null;
  co_assignee_ids?: string[] | null;
}): string[] {
  const ids = task.assignee_id ? [task.assignee_id] : [];
  for (const id of task.co_assignee_ids ?? []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** A pessoa é responsável (principal ou não) pela tarefa? */
export function isResponsible(
  task: { assignee_id: string | null; co_assignee_ids?: string[] | null },
  userId: string,
): boolean {
  return task.assignee_id === userId || (task.co_assignee_ids ?? []).includes(userId);
}

/** Tarefa com mais de um responsável: cada um conclui a sua parte (0025). */
export function isSharedTask(task: {
  assignee_id: string | null;
  co_assignee_ids?: string[] | null;
}): boolean {
  return responsibleIds(task).length > 1;
}

/**
 * Concluída do ponto de vista de quem está olhando: numa tarefa
 * compartilhada em que a pessoa é responsável, conta a parte dela — para as
 * outras pessoas a tarefa continua aberta (e atrasada, se passar do prazo).
 */
export function isDoneFor(
  task: {
    is_completed: boolean;
    assignee_id: string | null;
    co_assignee_ids?: string[] | null;
    completed_by_ids?: string[] | null;
  },
  userId: string,
): boolean {
  if (task.is_completed) return true;
  return (
    isSharedTask(task) &&
    isResponsible(task, userId) &&
    (task.completed_by_ids ?? []).includes(userId)
  );
}
