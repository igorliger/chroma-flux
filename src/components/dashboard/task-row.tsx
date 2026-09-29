import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Avatar } from "@/components/ui";
import { accentClass, cn, isSharedTask, responsibleIds } from "@/lib/utils";
import type { PersonRef, TaskOverview } from "@/lib/database.types";

/**
 * Uma linha de tarefa no Dashboard do proprietário — usada tanto no resumo
 * (`/dashboard`) quanto na lista completa de cada categoria
 * (`/dashboard/tarefas`), para as duas telas terem a cara idêntica.
 */

/**
 * Todos os responsáveis, com um ✓ em quem já concluiu a própria parte —
 * mesma linguagem visual de `components/task/task-list.tsx`. Mostrar só
 * quem falta (como era antes) escondia quem já tinha feito a parte dele.
 */
export function ResponsibleAvatars({
  t,
  pessoaPorId,
}: {
  t: TaskOverview;
  pessoaPorId: Map<string, PersonRef>;
}) {
  const ids = responsibleIds(t);
  const lista = ids.map((id) => pessoaPorId.get(id)).filter((p): p is PersonRef => !!p);
  const concluidoPor = new Set(t.completed_by_ids ?? []);

  if (lista.length === 0) return <span className="text-xs text-ink-400">sem responsável</span>;

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="flex -space-x-1.5" title={lista.map((p) => p.full_name || p.email).join(", ")}>
        {lista.slice(0, 4).map((p) => (
          <span key={p.id} className="relative">
            <Avatar id={p.id} name={p.full_name} email={p.email} size="xs" className="ring-2 ring-surface" />
            {concluidoPor.has(p.id) && (
              <CheckCircle2
                className="absolute -bottom-1 -right-1 size-3 rounded-full bg-surface text-emerald-600"
                aria-label="concluiu a parte dele"
              />
            )}
          </span>
        ))}
        {lista.length > 4 && (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-ink-200 text-[9px] font-semibold text-ink-700 ring-2 ring-surface">
            +{lista.length - 4}
          </span>
        )}
      </span>
      {isSharedTask(t) && (
        <span className="text-[10px] tabular-nums text-ink-400">
          {concluidoPor.size}/{lista.length}
        </span>
      )}
    </span>
  );
}

export function DashboardTaskRow({
  t,
  espaco,
  pessoaPorId,
  direita,
}: {
  t: TaskOverview;
  espaco: { name: string; color: string } | undefined;
  pessoaPorId: Map<string, PersonRef>;
  direita: React.ReactNode;
}) {
  return (
    <li>
      {/* Lembrete pessoal (sem espaço, `workspace_id` vazio — ver
          `lib/unified-tasks.ts`) abre em "Minhas tarefas", não numa tela de
          espaço que não existe. */}
      <Link
        href={t.workspace_id ? `/e/${t.workspace_id}/tarefas` : "/minhas-tarefas"}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-800">{t.title}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <span className={cn("size-1.5 rounded-full", accentClass(espaco?.color ?? ""))} />
            {espaco?.name}
          </p>
        </div>
        <ResponsibleAvatars t={t} pessoaPorId={pessoaPorId} />
        <span className="w-24 shrink-0 text-right text-xs">{direita}</span>
      </Link>
    </li>
  );
}
