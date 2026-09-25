import type { Metadata } from "next";

import { KanbanBoard } from "@/components/task/kanban-board";
import {
  getMyCapabilities,
  getWorkspaceContext,
  listCustomFieldDefinitions,
  listCustomFieldValues,
  listMembers,
  listTaskDependencies,
  listWorkspaceTasks,
} from "@/lib/queries";
import { taskPermissions } from "@/lib/permissions";

export const metadata: Metadata = { title: "Quadro" };

export default async function QuadroPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, role, user } = await getWorkspaceContext(workspaceId);

  const capacidades = await getMyCapabilities(workspace.owner_id, role);

  const [tasks, members, customFields] = await Promise.all([
    listWorkspaceTasks(workspaceId, {
      incluirParticulares: capacidades.has("member.manage"),
    }),
    listMembers(workspaceId),
    listCustomFieldDefinitions(workspaceId),
  ]);

  const [dependenciesByTask, customFieldValuesByTask] = await Promise.all([
    listTaskDependencies(workspaceId, tasks),
    listCustomFieldValues(
      workspaceId,
      tasks.map((t) => t.id),
    ),
  ]);

  const people = members
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Quadro</h1>
        <p className="mt-1 text-sm text-ink-500">
          Arraste as tarefas entre as colunas para atualizar o andamento.
        </p>
      </div>

      <KanbanBoard
        tasks={tasks}
        people={people}
        permissoes={taskPermissions(capacidades)}
        currentUserId={user.id}
        workspaceId={workspaceId}
        customFields={customFields}
        dependenciesByTask={dependenciesByTask}
        customFieldValuesByTask={customFieldValuesByTask}
      />
    </div>
  );
}
