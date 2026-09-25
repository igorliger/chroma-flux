import type { Metadata } from "next";

import { signOutAction } from "@/app/actions/auth";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { TaskBrowser } from "@/components/workspace/task-browser";
import { EmptyState } from "@/components/ui";
import {
  getMyProfile,
  listPersonalBoards,
  listWorkspaces,
  requireUser,
} from "@/lib/queries";
import { EMPTY_FILTERS } from "@/lib/filters";
import { taskPermissions } from "@/lib/permissions";
import { accentClass } from "@/lib/utils";

export const metadata: Metadata = { title: "Minhas tarefas" };

/**
 * Tudo que está sob responsabilidade da pessoa, atravessando todos os
 * espaços de que ela participa — diferente de "Tarefas", que fica dentro de
 * um único espaço. Uma seção por espaço, cada uma com seu próprio
 * `TaskBrowser`, já que criar e filtrar são ações de um espaço por vez.
 *
 * Fica fora de `e/[workspaceId]`, então não herda o `AppShell` daquele
 * layout — por isso monta a mesma casca que a tela de espaços usa
 * (`WorkspacesShell`), para a barra lateral aparecer aqui também.
 */
export default async function MyTasksPage() {
  const user = await requireUser();
  const [quadros, workspaces, perfil] = await Promise.all([
    listPersonalBoards(user.id),
    listWorkspaces(user.id),
    getMyProfile(),
  ]);

  const comTarefas = quadros.filter(
    (q) => q.designadas.length > 0 || q.particulares.length > 0,
  );

  const shellProps = {
    workspaces: workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
      role: w.role,
    })),
    user: {
      id: user.id,
      name: perfil?.full_name ?? "",
      email: user.email ?? perfil?.email ?? "",
    },
    signOut: signOutAction,
  };

  if (comTarefas.length === 0) {
    return (
      <WorkspacesShell {...shellProps}>
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Minhas tarefas</h1>
            <p className="mt-1 text-sm text-ink-500">
              Tudo que está sob sua responsabilidade, em todos os seus espaços.
            </p>
          </div>
          <EmptyState
            title="Nada atribuído a você"
            description="Quando alguém marcar você como responsável em algum espaço, a tarefa aparece aqui."
          />
        </div>
      </WorkspacesShell>
    );
  }

  return (
    <WorkspacesShell {...shellProps}>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Minhas tarefas</h1>
          <p className="mt-1 text-sm text-ink-500">
            Tudo que está sob sua responsabilidade, em todos os seus espaços.
          </p>
        </div>

        <div className="space-y-8">
          {comTarefas.map((quadro) => (
            <div key={quadro.workspace.id}>
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`size-2 shrink-0 rounded-full ${accentClass(quadro.workspace.color)}`}
                  aria-hidden
                />
                <h2 className="text-sm font-semibold text-ink-700">{quadro.workspace.name}</h2>
              </div>

              <TaskBrowser
                tasks={[...quadro.designadas, ...quadro.particulares]}
                people={quadro.people}
                permissoes={taskPermissions(quadro.capabilities)}
                currentUserId={user.id}
                workspaceId={quadro.workspace.id}
                initialFilters={{ ...EMPTY_FILTERS, status: "open" }}
                emptyTitle="Nada atribuído a você aqui"
                emptyDescription="Quando alguém marcar você como responsável, a tarefa aparece aqui."
                allowCreate
                // A tarefa nasce atribuída a quem a cria: criar algo em "Minhas
                // tarefas" e não vê-lo na lista seria desconcertante.
                assignToMeByDefault
              />
            </div>
          ))}
        </div>
      </div>
    </WorkspacesShell>
  );
}
