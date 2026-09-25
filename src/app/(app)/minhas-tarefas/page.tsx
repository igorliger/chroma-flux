import type { Metadata } from "next";

import { TaskBrowser } from "@/components/workspace/task-browser";
import { EmptyState } from "@/components/ui";
import { requireUser, listPersonalBoards } from "@/lib/queries";
import { EMPTY_FILTERS } from "@/lib/filters";
import { taskPermissions } from "@/lib/permissions";
import { accentClass } from "@/lib/utils";

export const metadata: Metadata = { title: "Minhas tarefas" };

/**
 * Tudo que está sob responsabilidade da pessoa, atravessando todos os
 * espaços de que ela participa — diferente de "Tarefas", que fica dentro de
 * um único espaço. Uma seção por espaço, cada uma com seu próprio
 * `TaskBrowser`, já que criar e filtrar são ações de um espaço por vez.
 */
export default async function MyTasksPage() {
  const user = await requireUser();
  const quadros = await listPersonalBoards(user.id);

  const comTarefas = quadros.filter(
    (q) => q.designadas.length > 0 || q.particulares.length > 0,
  );

  if (comTarefas.length === 0) {
    return (
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
    );
  }

  return (
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
  );
}
