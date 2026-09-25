import type { Metadata } from "next";

import { TaskBrowser } from "@/components/workspace/task-browser";
import { getWorkspaceContext, listMembers, listWorkspaceTasks } from "@/lib/queries";
import { EMPTY_FILTERS } from "@/lib/filters";
import { canWrite } from "@/lib/utils";

export const metadata: Metadata = { title: "Minhas tarefas" };

export default async function MyTasksPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { role, user } = await getWorkspaceContext(workspaceId);

  const [tasks, members] = await Promise.all([
    listWorkspaceTasks(workspaceId),
    listMembers(workspaceId),
  ]);

  const people = members
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const mine = tasks.filter((task) => task.assignee_id === user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Minhas tarefas</h1>
        <p className="mt-1 text-sm text-ink-500">
          Tudo que está sob sua responsabilidade neste espaço, ordenado por urgência.
        </p>
      </div>

      <TaskBrowser
        tasks={mine}
        people={people}
        canWrite={canWrite(role)}
        currentUserId={user.id}
        workspaceId={workspaceId}
        initialFilters={{ ...EMPTY_FILTERS, status: "open" }}
        emptyTitle="Nada atribuído a você"
        emptyDescription="Quando alguém marcar você como responsável, a tarefa aparece aqui."
        allowCreate
        // A tarefa nasce atribuída a quem a cria: criar algo em "Minhas
        // tarefas" e não vê-lo na lista seria desconcertante.
        assignToMeByDefault
      />
    </div>
  );
}
