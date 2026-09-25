import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid, ListTodo, Users } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { acceptInvitationAction } from "@/app/actions/workspaces";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { Button, Card, EmptyState, FormError } from "@/components/ui";
import {
  getMyProfile,
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
  const [workspaces, invitations] = await Promise.all([
    listWorkspaces(user.id),
    listPendingInvitations(),
  ]);

  const perfil = await getMyProfile();

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
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
              Seus espaços de trabalho
            </h1>
            <p className="mt-1 text-sm text-ink-500">
              Os dados de cada espaço ficam isolados dos demais.
            </p>
          </div>
          {workspaces.length > 0 && <NewWorkspaceButton />}
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
              description="Crie o primeiro espaço para começar a organizar as tarefas da sua equipe."
              action={<NewWorkspaceButton />}
            />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {workspaces.map((workspace) => (
                <li key={workspace.id}>
                  <Link
                    href={`/e/${workspace.id}`}
                    className="group block h-full rounded-[--radius-card] border border-ink-200 bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`flex size-10 items-center justify-center rounded-xl text-white ${accentClass(
                          workspace.color,
                        )}`}
                      >
                        <LayoutGrid className="size-5" aria-hidden />
                      </span>
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                        {roleLabel(workspace.role)}
                      </span>
                    </div>

                    <h3 className="mt-4 font-semibold text-ink-900 group-hover:text-brand-700">
                      {workspace.name}
                    </h3>
                    {workspace.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-ink-500">
                        {workspace.description}
                      </p>
                    )}

                    <div className="mt-4 flex items-center gap-4 text-xs text-ink-500">
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
