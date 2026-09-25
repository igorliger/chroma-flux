import type { Metadata } from "next";

import { TaskBrowser } from "@/components/workspace/task-browser";
import {
  getMyCapabilities,
  getWorkspaceContext,
  listCustomFieldDefinitions,
  listCustomFieldValues,
  listMembers,
  listTaskDependencies,
  listWorkspaceTasks,
} from "@/lib/queries";
import { filtersFromQuery } from "@/lib/filters";
import { taskPermissions } from "@/lib/permissions";

export const metadata: Metadata = { title: "Tarefas" };

export default async function TarefasPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    situacao?: string;
    prazo?: string;
    responsavel?: string;
    busca?: string;
  }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const { workspace, role, user } = await getWorkspaceContext(workspaceId);

  // As capacidades vêm da matriz do proprietário do espaço, que pode não ser
  // quem está olhando. Antes das tarefas, porque decidem o que buscar.
  const capacidades = await getMyCapabilities(workspace.owner_id, role);

  const [tasks, members, customFields] = await Promise.all([
    // Quem administra também enxerga as particulares da equipe, marcadas com
    // um selo. Para os demais elas ficam de fora — é a separação que a lista
    // pessoal existe para manter.
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

  /*
    Sem parâmetros a tela abre como sempre abriu, mostrando o que está em
    aberto. Com eles — vindos dos cartões do painel — o recorte é outro, e o
    subtítulo precisa parar de prometer "tudo que está em aberto".
  */
  const veioComRecorte = Boolean(
    query.situacao || query.prazo || query.responsavel || query.busca,
  );
  const filtros = filtersFromQuery({ ...query, situacao: query.situacao ?? "abertas" });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Tarefas</h1>
        <p className="mt-1 text-sm text-ink-500">
          {veioComRecorte
            ? "Recorte vindo do painel. Ajuste os filtros abaixo para ver mais."
            : `Tudo que está em aberto em ${workspace.name}, ordenado por urgência.`}
        </p>
      </div>

      <TaskBrowser
        tasks={tasks}
        people={people}
        permissoes={taskPermissions(capacidades)}
        currentUserId={user.id}
        workspaceId={workspaceId}
        initialFilters={filtros}
        emptyTitle="Nenhuma tarefa ainda"
        emptyDescription="Crie a primeira e ela aparece aqui."
        allowCreate
        customFields={customFields}
        dependenciesByTask={dependenciesByTask}
        customFieldValuesByTask={customFieldValuesByTask}
      />
    </div>
  );
}
