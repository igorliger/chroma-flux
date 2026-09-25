import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { Avatar } from "@/components/ui";
import { getMyProfile, getOwnerDashboard, listWorkspaces, requireUser } from "@/lib/queries";
import type { PersonRef, TaskOverview } from "@/lib/database.types";
import {
  accentClass,
  cn,
  dueDateMeta,
  isDoneFor,
  isOverdue,
  isResponsible,
  responsibleIds,
  todayISO,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

/** Ainda está com a pessoa: é responsável e não concluiu a sua parte. */
function pendentePara(t: TaskOverview, pessoaId: string) {
  return !t.is_completed && isResponsible(t, pessoaId) && !isDoneFor(t, pessoaId);
}

/**
 * Dashboard do proprietário: visão resumida de todas as tarefas de todos os
 * espaços de que a pessoa é dona — números gerais, situação por espaço e
 * por pessoa, o que está atrasado e o que vence nos próximos dias.
 */
export default async function OwnerDashboardPage() {
  const user = await requireUser();
  const [perfil, workspaces, dados] = await Promise.all([
    getMyProfile(),
    listWorkspaces(user.id),
    getOwnerDashboard(),
  ]);

  // Só para proprietários (o menu também só mostra para eles).
  if (dados.workspaces.length === 0) notFound();

  const hoje = todayISO();
  const agora = new Date();
  const { tasks, people } = dados;
  const espacoPorId = new Map(dados.workspaces.map((w) => [w.id, w]));
  const pessoaPorId = new Map(people.map((p) => [p.id, p]));

  const abertas = tasks.filter((t) => !t.is_completed);
  const atrasadas = abertas.filter((t) => isOverdue(t.due_date, false));
  const paraHoje = abertas.filter((t) => t.due_date === hoje);
  const concluidas7 = tasks.filter((t) => t.is_completed);

  const numeros = [
    { label: "Em aberto", valor: abertas.length, icon: CircleDot, tom: "text-brand-600 bg-brand-50" },
    { label: "Atrasadas", valor: atrasadas.length, icon: AlertTriangle, tom: "text-rose-600 bg-rose-50" },
    { label: "Vencem hoje", valor: paraHoje.length, icon: CalendarClock, tom: "text-amber-600 bg-amber-50" },
    { label: "Concluídas em 7 dias", valor: concluidas7.length, icon: CheckCircle2, tom: "text-emerald-600 bg-emerald-50" },
  ];

  const porEspaco = dados.workspaces.map((w) => {
    const doEspaco = tasks.filter((t) => t.workspace_id === w.id);
    const abertasW = doEspaco.filter((t) => !t.is_completed);
    const concluidasW = doEspaco.filter((t) => t.is_completed).length;
    return {
      ...w,
      abertas: abertasW.length,
      atrasadas: abertasW.filter((t) => isOverdue(t.due_date, false)).length,
      hoje: abertasW.filter((t) => t.due_date === hoje).length,
      concluidas: concluidasW,
      // ritmo da semana: concluídas / (concluídas + em aberto)
      ritmo:
        abertasW.length + concluidasW > 0
          ? Math.round((concluidasW / (abertasW.length + concluidasW)) * 100)
          : 0,
    };
  });

  const porPessoa = people
    .map((p) => ({
      pessoa: p,
      abertas: tasks.filter((t) => pendentePara(t, p.id)).length,
      atrasadas: tasks.filter((t) => pendentePara(t, p.id) && isOverdue(t.due_date, false)).length,
      concluidas: tasks.filter(
        (t) =>
          isResponsible(t, p.id) &&
          (t.is_completed || (t.completed_by_ids ?? []).includes(p.id)),
      ).length,
    }))
    .filter((l) => l.abertas + l.concluidas > 0)
    .sort((a, b) => b.atrasadas - a.atrasadas || b.abertas - a.abertas);

  const maiorCarga = Math.max(1, ...porPessoa.map((l) => l.abertas));

  const listaAtrasadas = [...atrasadas]
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 15);

  const proximas = abertas
    .filter((t) => {
      if (!t.due_date || t.due_date < hoje) return false;
      const dias = differenceInCalendarDays(parseISO(t.due_date), agora);
      return dias >= 0 && dias <= 7;
    })
    .sort((a, b) =>
      `${a.due_date}${a.due_time ?? "99"}`.localeCompare(`${b.due_date}${b.due_time ?? "99"}`),
    )
    .slice(0, 15);

  function Pendentes({ t }: { t: TaskOverview }) {
    const ids = responsibleIds(t).filter((id) => !isDoneFor(t, id));
    const lista = ids.map((id) => pessoaPorId.get(id)).filter((p): p is PersonRef => !!p);
    if (lista.length === 0) return <span className="text-xs text-ink-400">sem responsável</span>;
    return (
      <span className="flex -space-x-1.5" title={lista.map((p) => p.full_name || p.email).join(", ")}>
        {lista.slice(0, 4).map((p) => (
          <Avatar key={p.id} id={p.id} name={p.full_name} email={p.email} size="xs" className="ring-2 ring-surface" />
        ))}
        {lista.length > 4 && (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-ink-200 text-[9px] font-semibold text-ink-700 ring-2 ring-surface">
            +{lista.length - 4}
          </span>
        )}
      </span>
    );
  }

  function LinhaTarefa({ t, direita }: { t: TaskOverview; direita: React.ReactNode }) {
    const espaco = espacoPorId.get(t.workspace_id);
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
          <Pendentes t={t} />
          <span className="w-24 shrink-0 text-right text-xs">{direita}</span>
        </Link>
      </li>
    );
  }

  const cartao = "rounded-[--radius-card] border border-ink-200 bg-surface shadow-sm";

  return (
    <WorkspacesShell
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, color: w.color, role: w.role }))}
      user={{ id: user.id, name: perfil?.full_name ?? "", email: user.email ?? perfil?.email ?? "" }}
      signOut={signOutAction}
    >
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            Todas as tarefas dos seus {dados.workspaces.length} espaços de trabalho, num lugar só.
          </p>
        </header>

        {/* Números gerais */}
        <section aria-label="Resumo" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {numeros.map(({ label, valor, icon: Icon, tom }) => (
            <div key={label} className={cn(cartao, "p-4")}>
              <span className={cn("inline-flex size-8 items-center justify-center rounded-lg", tom)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-ink-900">{valor}</p>
              <p className="text-sm text-ink-500">{label}</p>
            </div>
          ))}
        </section>

        {/* Por espaço */}
        <section className={cn(cartao, "mt-6 overflow-hidden")}>
          <h2 className="px-5 pt-5 font-semibold text-ink-900">Por espaço de trabalho</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                  <th className="px-5 py-2 font-medium">Espaço</th>
                  <th className="px-3 py-2 text-right font-medium">Em aberto</th>
                  <th className="px-3 py-2 text-right font-medium">Atrasadas</th>
                  <th className="px-3 py-2 text-right font-medium">Hoje</th>
                  <th className="px-3 py-2 text-right font-medium">Concluídas (7 dias)</th>
                  <th className="px-5 py-2 font-medium">Ritmo da semana</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {porEspaco.map((w) => (
                  <tr key={w.id} className="hover:bg-ink-50">
                    <td className="px-5 py-2.5">
                      <Link href={`/e/${w.id}`} className="flex items-center gap-2 font-medium text-ink-800 hover:text-brand-600">
                        <span className={cn("size-2 rounded-full", accentClass(w.color))} />
                        {w.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{w.abertas}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", w.atrasadas ? "font-semibold text-danger-fg" : "text-ink-400")}>
                      {w.atrasadas}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{w.hoje}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{w.concluidas}</td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${w.ritmo}%` }} />
                        </div>
                        <span className="text-xs tabular-nums text-ink-500">{w.ritmo}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Por pessoa */}
          <section className={cn(cartao, "p-5")}>
            <h2 className="font-semibold text-ink-900">Por pessoa</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Em tarefas com vários responsáveis, conta a parte de cada um.
            </p>
            {porPessoa.length === 0 ? (
              <p className="mt-6 text-sm text-ink-500">Nenhuma tarefa atribuída ainda.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {porPessoa.map(({ pessoa, abertas: a, atrasadas: at, concluidas: c }) => (
                  <li key={pessoa.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar id={pessoa.id} name={pessoa.full_name} email={pessoa.email} size="sm" />
                        <span className="truncate font-medium text-ink-800">
                          {pessoa.full_name || pessoa.email}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-500">
                        {at > 0 && <span className="mr-2 font-semibold text-danger-fg">{at} atrasada{at > 1 ? "s" : ""}</span>}
                        {a} em aberto · <span className="text-emerald-700">{c} feitas</span>
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={cn("h-full rounded-full", at > 0 ? "bg-rose-500" : "bg-brand-500")}
                        style={{ width: `${Math.round((a / maiorCarga) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Atrasadas */}
          <section className={cn(cartao, "overflow-hidden")}>
            <h2 className="flex items-center gap-2 px-5 pt-5 font-semibold text-ink-900">
              <AlertTriangle className="size-4 text-danger-fg" aria-hidden />
              Atrasadas
              <span className="text-sm font-normal text-ink-400">({atrasadas.length})</span>
            </h2>
            {listaAtrasadas.length === 0 ? (
              <p className="px-5 pb-5 pt-4 text-sm text-ink-500">Nada atrasado.</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-100">
                {listaAtrasadas.map((t) => {
                  const dias = t.due_date ? -differenceInCalendarDays(parseISO(t.due_date), agora) : 0;
                  return (
                    <LinhaTarefa
                      key={t.id}
                      t={t}
                      direita={
                        <span className="font-semibold text-danger-fg">
                          {dias === 1 ? "1 dia" : `${dias} dias`}
                        </span>
                      }
                    />
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Próximos 7 dias */}
        <section className={cn(cartao, "mt-6 overflow-hidden")}>
          <h2 className="flex items-center gap-2 px-5 pt-5 font-semibold text-ink-900">
            <CalendarClock className="size-4 text-amber-600" aria-hidden />
            Próximos 7 dias
          </h2>
          {proximas.length === 0 ? (
            <p className="px-5 pb-5 pt-4 text-sm text-ink-500">Nada vencendo nos próximos dias.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-100">
              {proximas.map((t) => {
                const meta = dueDateMeta(t.due_date, false, t.due_time, agora);
                return (
                  <LinhaTarefa
                    key={t.id}
                    t={t}
                    direita={
                      <span className="text-ink-600">
                        {meta?.label}
                        {t.due_time ? ` ${t.due_time.slice(0, 5)}` : ""}
                      </span>
                    }
                  />
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </WorkspacesShell>
  );
}
