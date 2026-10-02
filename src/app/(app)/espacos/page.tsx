import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LayoutGrid, ListTodo, Users } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { acceptInvitationAction } from "@/app/actions/workspaces";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { Button, Card, EmptyState, FormError } from "@/components/ui";
import {
  getMyProfile,
  acceptMyTeamInvitations,
  canICreateWorkspace,
  listPendingInvitations,
  listWorkspaces,
  requireUser,
} from "@/lib/queries";
import { accentClass, roleLabel } from "@/lib/utils";

import { NewWorkspaceButton } from "./workspace-dialog";

export const metadata: Metadata = { title: "Espaços de trabalho" };

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);

  // Convites para a equipe feitos para este e-mail entram na hora — com os
  // espaços que o proprietário já escolheu. Tem que vir antes da lista, para
  // os espaços novos já aparecerem.
  await acceptMyTeamInvitations();
  const [workspaces, invitations] = await Promise.all([
    listWorkspaces(user.id),
    listPendingInvitations(),
  ]);

  const perfil = await getMyProfile();
  // Membros não criam espaços — só proprietários e administradores. Quem
  // decide é o banco, que também sabe de equipe e convites pendentes.
  const podeCriar = await canICreateWorkspace();

  return (
    <WorkspacesShell
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        color: w.color,
        role: w.role,
      }))}
      user={{
        id: user.id,
        name: perfil?.full_name ?? "",
        email: user.email ?? perfil?.email ?? "",
      }}
      signOut={signOutAction}
    >
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-ink-900 sm:text-[34px]">
              Seus espaços de trabalho
            </h1>
            <p className="mt-1.5 text-base text-ink-500">
              Os dados de cada espaço ficam isolados dos demais.
            </p>
          </div>
          {workspaces.length > 0 && podeCriar && <NewWorkspaceButton />}
        </div>

        <div className="mt-6">
          <FormError>{params.erro}</FormError>
        </div>

        {/* Convites pendentes */}
        {invitations.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
              Convites pendentes
            </h2>
            <div className="space-y-3">
              {invitations.map((invite) => (
                <Card
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-medium text-ink-900">{invite.workspace_name}</p>
                    <p className="text-sm text-ink-500">
                      Você foi convidado como {roleLabel(invite.role).toLowerCase()}.
                    </p>
                  </div>
                  <form action={acceptInvitationAction}>
                    <input type="hidden" name="invitationId" value={invite.id} />
                    <Button type="submit" size="sm">
                      Aceitar convite
                    </Button>
                  </form>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Lista de espaços */}
        <section className="mt-8">
          {workspaces.length === 0 ? (
            <EmptyState
              icon={<LayoutGrid className="size-10" />}
              title="Nenhum espaço de trabalho ainda"
              description={
                podeCriar
                  ? "Crie o primeiro espaço para começar a organizar as tarefas da sua equipe."
                  : "Você ainda não foi colocado em nenhum espaço. Quando o responsável pela equipe liberar o acesso, ele aparece aqui."
              }
              action={podeCriar ? <NewWorkspaceButton /> : undefined}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <Link
                    // Entrar no espaço abre a lista de tarefas direto — o
                    // Painel continua existindo, só não é mais a porta de
                    // entrada (o menu lateral leva a ele quando quiser).
                    href={`/e/${workspace.id}/tarefas`}
                    className="group relative flex h-full flex-col overflow-hidden rounded-(--radius-card) border border-ink-200 bg-surface p-5 flux-shadow transition-colors hover:border-ink-300 hover:bg-surface-raised"
                  >
                    {/* Faixa na cor do espaço, como nos cartões do painel. */}
                    <span
                      className={`absolute inset-x-0 top-0 h-[3px] ${accentClass(workspace.color)}`}
                      aria-hidden
                    />
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`flex size-12 items-center justify-center rounded-xl text-white ${accentClass(
                          workspace.color,
                        )}`}
                      >
                        <LayoutGrid className="size-6" aria-hidden />
                      </span>
                      <span className="rounded-full border border-ink-200 px-2.5 py-1 text-xs font-medium text-ink-700">
                        {roleLabel(workspace.role)}
                      </span>
                    </div>

                    <h3 className="mt-4 text-lg font-bold text-ink-900 group-hover:text-brand-700">
                      {workspace.name}
                    </h3>
                    {workspace.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-500">
                        {workspace.description}
                      </p>
                    )}

                    <div className="mb-4 mt-3 flex items-center gap-4 text-sm text-ink-500">
                      <span className="inline-flex items-center gap-1">
                        <ListTodo className="size-3.5" aria-hidden />
                        {workspace.task_count}{" "}
                        {workspace.task_count === 1 ? "tarefa" : "tarefas"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden />
                        {workspace.member_count}{" "}
                        {workspace.member_count === 1 ? "membro" : "membros"}
                      </span>
                    </div>

                    <span className="mt-auto flex items-center justify-end gap-1 border-t border-ink-200/70 pt-3 text-sm font-medium text-brand-700">
                      Abrir espaço
                      <ArrowRight
                        className="size-4 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* A identificação do usuário migrou para o rodapé da barra lateral;
            repeti-la aqui seria redundante. */}
      </main>
    </WorkspacesShell>
  );
}
