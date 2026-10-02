import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ArrowLeft } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { DashboardTaskRow } from "@/components/dashboard/task-row";
import { getMyProfile, getOwnerDashboard, listWorkspaces, requireUser } from "@/lib/queries";
import { DASHBOARD_FILTROS, isDashboardFiltro, isOverdueNow, type DashboardFiltro } from "@/lib/dashboard";
import { dueDateMeta, formatDate, todayISO } from "@/lib/utils";
import type { TaskOverview } from "@/lib/database.types";

export const metadata: Metadata = { title: "Dashboard" };

/** Rótulo do lado direito de cada linha — muda conforme a categoria aberta. */
function rotuloDireita(t: TaskOverview, filtro: DashboardFiltro, agora: Date) {
  if (filtro === "concluidas") {
    return t.completed_at ? formatDate(t.completed_at, "d 'de' MMM 'às' HH:mm") : "";
  }
  if (filtro === "atrasadas") {
    const dias = t.due_date ? -differenceInCalendarDays(parseISO(t.due_date), agora) : 0;
    return dias <= 0 ? "Hoje" : dias === 1 ? "1 dia" : `${dias} dias`;
  }
  const meta = dueDateMeta(t.due_date, false, t.due_time, agora);
  if (!meta) return "Sem prazo";
  return t.due_time ? `${meta.label} ${t.due_time.slice(0, 5)}` : meta.label;
}

/**
 * Lista completa de uma das quatro categorias do resumo do Dashboard —
 * aberta pelos números clicáveis em `/dashboard`. Mesma fonte de dados
 * (`getOwnerDashboard`), só que sem o limite de 15 linhas do resumo.
 */
export default async function DashboardTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string }>;
}) {
  const { filtro: filtroParam } = await searchParams;
  const filtro: DashboardFiltro = isDashboardFiltro(filtroParam) ? filtroParam : "abertas";

  const user = await requireUser();
  const [perfil, workspaces, dados] = await Promise.all([
    getMyProfile(),
    listWorkspaces(user.id),
    getOwnerDashboard(),
  ]);

  if (dados.workspaces.length === 0) notFound();

  const hoje = todayISO();
  const agora = new Date();
  const { tasks, people } = dados;
  // "" é o lembrete pessoal (sem espaço — ver lib/unified-tasks.ts).
  const espacoPorId = new Map<string, { id: string; name: string; color: string }>([
    ["", { id: "", name: "Pessoal", color: "slate" }],
    ...dados.workspaces.map((w): [string, typeof w] => [w.id, w]),
  ]);
  const pessoaPorId = new Map(people.map((p) => [p.id, p]));

  const abertas = tasks.filter((t) => !t.is_completed);

  const conjuntos: Record<DashboardFiltro, TaskOverview[]> = {
    abertas,
    atrasadas: abertas.filter((t) => isOverdueNow(t, agora)),
    hoje: abertas.filter((t) => t.due_date === hoje),
    concluidas: tasks.filter((t) => t.is_completed),
  };

  const lista = [...conjuntos[filtro]].sort((a, b) =>
    filtro === "concluidas"
      ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "")
      : (a.due_date ?? "").localeCompare(b.due_date ?? ""),
  );

  const { titulo, vazio } = DASHBOARD_FILTROS[filtro];

  return (
    <WorkspacesShell
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, color: w.color, role: w.role }))}
      user={{ id: user.id, name: perfil?.full_name ?? "", email: user.email ?? perfil?.email ?? "" }}
      signOut={signOutAction}
    >
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-700"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Dashboard
        </Link>

        <header className="mb-6 mt-3">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[34px]">{titulo}</h1>
          <p className="mt-1.5 text-base text-ink-500">
            {lista.length} {lista.length === 1 ? "tarefa" : "tarefas"}, em todos os seus espaços e
            nos seus lembretes pessoais.
          </p>
        </header>

        <section className="overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface flux-shadow">
          {lista.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-500">{vazio}</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {lista.map((t) => (
                <DashboardTaskRow
                  key={t.id}
                  t={t}
                  espaco={espacoPorId.get(t.workspace_id)}
                  pessoaPorId={pessoaPorId}
                  direita={
                    <span className={filtro === "atrasadas" ? "font-semibold text-danger-fg" : "text-ink-600"}>
                      {rotuloDireita(t, filtro, agora)}
                    </span>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </WorkspacesShell>
  );
}
