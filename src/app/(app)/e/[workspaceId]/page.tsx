import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
} from "lucide-react";

import { TaskBrowser } from "@/components/workspace/task-browser";
import { Avatar } from "@/components/ui";
import {
  getMyCapabilities,
  getWorkspaceContext,
  listMembers,
  listWorkspaceTasks,
} from "@/lib/queries";
import { taskPermissions } from "@/lib/permissions";
import { EMPTY_FILTERS } from "@/lib/filters";
import { accentClass, canAdminister, cn, isOverdue } from "@/lib/utils";
import { differenceInCalendarDays, parseISO } from "date-fns";

export const metadata: Metadata = { title: "Painel" };

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, role, user, profile } = await getWorkspaceContext(workspaceId);

  const [tasks, members, capacidades] = await Promise.all([
    listWorkspaceTasks(workspaceId),
    listMembers(workspaceId),
    getMyCapabilities(workspace.owner_id, role),
  ]);

  const people = members
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // ---- métricas -----------------------------------------------------------
  const open = tasks.filter((t) => !t.is_completed);
  const completed = tasks.filter((t) => t.is_completed);
  const overdue = tasks.filter((t) => isOverdue(t.due_date, t.is_completed));
  const dueThisWeek = open.filter((t) => {
    if (!t.due_date) return false;
    const days = differenceInCalendarDays(parseISO(t.due_date), new Date());
    return days >= 0 && days <= 7;
  });
  const mine = open.filter((t) => t.assignee_id === user.id);

  const completionRate = tasks.length
    ? Math.round((completed.length / tasks.length) * 100)
    : 0;

  const firstName = (profile.full_name || user.email).split(" ")[0];

  /*
    Cada número leva à lista já filtrada pelo recorte que ele conta. O `filtro`
    vira a query da tela de tarefas, e é lá que ele se transforma nos mesmos
    controles da barra de filtros — assim quem chegou por aqui vê na barra o
    porquê da lista estar recortada, e pode afrouxar o filtro sem voltar.
  */
  const metrics = [
    {
      label: "Em aberto",
      value: open.length,
      icon: CircleDot,
      tone: "text-brand-600 bg-brand-50",
      filtro: "situacao=abertas",
    },
    {
      label: "Atrasadas",
      value: overdue.length,
      icon: AlertTriangle,
      tone: "text-rose-600 bg-rose-50",
      filtro: "situacao=abertas&prazo=atrasadas",
    },
    {
      label: "Vencem em 7 dias",
      value: dueThisWeek.length,
      icon: CalendarClock,
      tone: "text-amber-600 bg-amber-50",
      filtro: "situacao=abertas&prazo=semana",
    },
    {
      label: "Concluídas",
      value: completed.length,
      icon: CheckCircle2,
      tone: "text-emerald-600 bg-emerald-50",
      filtro: "situacao=concluidas",
    },
  ];

  // Carga por pessoa — quem está sobrecarregado e quem tem folga.
  // Só conta o que está em aberto: tarefa concluída não pesa mais em ninguém.
  const semResponsavel = open.filter((t) => !t.assignee_id).length;
  const maiorCarga = Math.max(
    semResponsavel,
    ...people.map((p) => open.filter((t) => t.assignee_id === p.id).length),
    1, // evita divisão por zero quando não há nada em aberto
  );

  const porPessoa = [
    ...people.map((person) => ({
      key: person.id,
      person,
      total: open.filter((t) => t.assignee_id === person.id).length,
      atrasadas: overdue.filter((t) => t.assignee_id === person.id).length,
    })),
    {
      key: "sem-responsavel",
      person: null,
      total: semResponsavel,
      atrasadas: overdue.filter((t) => !t.assignee_id).length,
    },
  ]
    // Quem não tem nada em aberto vira ruído numa lista de carga.
    .filter((linha) => linha.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Olá, {firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Visão geral de {workspace.name}.
        </p>
      </header>

      {/* Métricas */}
      <section aria-label="Resumo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone, filtro }) => (
          <Link
            key={label}
            href={`/e/${workspaceId}/tarefas?${filtro}`}
            aria-label={`${label}: ${value}. Ver na lista de tarefas.`}
            className={cn(
              "group rounded-[--radius-card] border border-ink-200 bg-surface p-4 text-left shadow-sm",
              "transition-colors hover:border-brand-300 hover:bg-ink-50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
            )}
          >
            <span
              className={cn("inline-flex size-8 items-center justify-center rounded-lg", tone)}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <p className="mt-3 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
            <p className="flex items-center gap-1 text-sm text-ink-500">
              {label}
              {/* A setinha só no hover: quatro flechas fixas competiriam com os
                  números, que são o conteúdo do cartão. */}
              <ChevronRight
                className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </p>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Carga da equipe */}
        <section className="lg:col-span-2">
          <div className="rounded-[--radius-card] border border-ink-200 bg-surface p-5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-ink-900">Carga por pessoa</h2>
              <Link
                href={`/e/${workspaceId}/tarefas`}
                className="text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                Ver tarefas
              </Link>
            </div>

            {porPessoa.length === 0 ? (
              <p className="mt-6 text-sm text-ink-500">
                Nada em aberto neste espaço.
              </p>
            ) : (
              <ul className="mt-4 space-y-4">
                {porPessoa.map(({ key, person, total, atrasadas }) => (
                  <li key={key}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        {person ? (
                          <Avatar
                            id={person.id}
                            name={person.full_name}
                            email={person.email}
                            size="sm"
                          />
                        ) : (
                          <span
                            className="size-6 shrink-0 rounded-full border border-dashed border-ink-300"
                            aria-hidden
                          />
                        )}
                        <span className="truncate font-medium text-ink-800">
                          {person ? person.full_name || person.email : "Sem responsável"}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-500">
                        {atrasadas > 0 && (
                          <span className="mr-2 font-semibold text-danger-fg">
                            {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}
                          </span>
                        )}
                        {total} em aberto
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      {/* A barra é relativa a quem tem mais tarefas: o que
                          interessa aqui é a comparação entre as pessoas. */}
                      <div
                        className={cn("h-full rounded-full", accentClass(workspace.color))}
                        style={{ width: `${Math.round((total / maiorCarga) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Taxa de conclusão e equipe */}
        <section className="space-y-6">
          <div className="rounded-[--radius-card] border border-ink-200 bg-surface p-5 shadow-sm">
            <h2 className="font-semibold text-ink-900">Taxa de conclusão</h2>
            <p className="mt-4 text-4xl font-semibold tabular-nums text-ink-900">
              {completionRate}
              <span className="text-2xl text-ink-400">%</span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${completionRate}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-ink-500">
              {completed.length} de {tasks.length}{" "}
              {tasks.length === 1 ? "tarefa" : "tarefas"}
            </p>
          </div>

          <div className="rounded-[--radius-card] border border-ink-200 bg-surface p-5 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-ink-900">Equipe</h2>
              {/* O atalho leva à tela de membros, que agora é de quem
                  administra. Para os demais fica só a contagem. */}
              {canAdminister(role) && (
                <Link
                  href={`/e/${workspaceId}/membros`}
                  className="text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Gerenciar
                </Link>
              )}
            </div>
            <p className="mt-3 text-sm text-ink-500">
              {members.length} {members.length === 1 ? "pessoa" : "pessoas"} neste espaço ·{" "}
              {tasks.length} {tasks.length === 1 ? "tarefa" : "tarefas"} no total
            </p>
          </div>
        </section>
      </div>

      {/* Minhas tarefas em aberto */}
      <section className="mt-8">
        <h2 className="mb-3 font-semibold text-ink-900">Suas tarefas em aberto</h2>
        <TaskBrowser
          tasks={mine}
          people={people}
          permissoes={taskPermissions(capacidades)}
          currentUserId={user.id}
          workspaceId={workspaceId}
          initialFilters={EMPTY_FILTERS}
          emptyTitle="Você está em dia"
          emptyDescription="Nenhuma tarefa em aberto atribuída a você neste espaço."
        />
      </section>
    </div>
  );
}
