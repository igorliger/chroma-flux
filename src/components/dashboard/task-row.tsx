import Link from "next/link";

import { Avatar } from "@/components/ui";
import { accentClass, cn, isDoneFor, responsibleIds } from "@/lib/utils";
import type { PersonRef, TaskOverview } from "@/lib/database.types";

/**
 * Uma linha de tarefa no Dashboard do proprietário — usada tanto no resumo
 * (`/dashboard`) quanto na lista completa de cada categoria
 * (`/dashboard/tarefas`), para as duas telas terem a cara idêntica.
 */

export function PendingAvatars({
  t,
  pessoaPorId,
}: {
  t: TaskOverview;
  pessoaPorId: Map<string, PersonRef>;
}) {
  const ids = responsibleIds(t).filter((id) => !isDoneFor(t, id));
  const lista = ids.map((id) => pessoaPorId.get(id)).filter((p): p is PersonRef => !!p);

  if (lista.length === 0) return <span className="text-xs text-ink-400">sem responsável</span>;

  return (
    <span className="flex -space-x-1.5" title={lista.map((p) => p.full_name || p.email).join(", ")}>
      {lista.slice(0, 4).map((p) => (
        <Avatar
          key={p.id}
          id={p.id}
          name={p.full_name}
          email={p.email}
          size="xs"
          className="ring-2 ring-surface"
        />
      ))}
      {lista.length > 4 && (
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-ink-200 text-[9px] font-semibold text-ink-700 ring-2 ring-surface">
          +{lista.length - 4}
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
      <Link
        href={`/e/${t.workspace_id}/tarefas`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-800">{t.title}</p>
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <span className={cn("size-1.5 rounded-full", accentClass(espaco?.color ?? ""))} />
            {espaco?.name}
          </p>
        </div>
        <PendingAvatars t={t} pessoaPorId={pessoaPorId} />
        <span className="w-24 shrink-0 text-right text-xs">{direita}</span>
      </Link>
    </li>
  );
}
