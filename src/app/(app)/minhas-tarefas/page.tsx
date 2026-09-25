import type { Metadata } from "next";
import { ClipboardList, Lock } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { TaskBrowser } from "@/components/workspace/task-browser";
import { EmptyState } from "@/components/ui";
import { getMyProfile, listPersonalBoards, listWorkspaces, requireUser } from "@/lib/queries";
import { EMPTY_FILTERS } from "@/lib/filters";
import { taskPermissions } from "@/lib/permissions";
import { accentClass, cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Minhas tarefas" };

/**
 * A lista da pessoa, fora dos espaços.
 *
 * Dois blocos, que é a separação pedida: o que designaram para você e o que
 * você anotou para si. Dentro de cada bloco, um agrupamento por espaço — não
 * por gosto de organizar, mas porque concluir, editar e comentar obedecem à
 * matriz do espaço da tarefa, e a mesma pessoa pode ter papéis diferentes em
 * cada um. Uma lista única teria de escolher um conjunto de permissões só, e
 * estaria errada para metade das linhas.
 */
export default async function MinhasTarefasPage() {
  const user = await requireUser();

  const [quadros, workspaces, perfil] = await Promise.all([
    listPersonalBoards(user.id),
    // A casca desta tela é a de fora dos espaços, a mesma de "Espaços de
    // trabalho" e "Configurações": a lista pessoal não pertence a espaço algum.
    listWorkspaces(user.id),
    getMyProfile(),
  ]);

  const comDesignadas = quadros.filter((q) => q.designadas.length > 0);

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
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Minhas tarefas</h1>
        <p className="mt-1 text-sm text-ink-500">
          Tudo que é seu, de todos os espaços de trabalho.
        </p>
      </div>

      {/* Designadas ------------------------------------------------------- */}
      <section className="mb-12">
        <div className="mb-4 flex items-center gap-2">
          <ClipboardList className="size-4 text-ink-400" aria-hidden />
          <h2 className="font-semibold text-ink-900">Designadas a você</h2>
        </div>

        {comDesignadas.length === 0 ? (
          <EmptyState
            title="Nada designado a você"
            description="Quando alguém marcar você como responsável por uma tarefa, ela aparece aqui."
          />
        ) : (
          comDesignadas.map((quadro) => (
            <div key={quadro.workspace.id} className="mb-6 last:mb-0">
              <Etiqueta nome={quadro.workspace.name} cor={quadro.workspace.color} />
              <TaskBrowser
                tasks={quadro.designadas}
                people={quadro.people}
                permissoes={taskPermissions(quadro.capabilities)}
                currentUserId={user.id}
                workspaceId={quadro.workspace.id}
                initialFilters={{ ...EMPTY_FILTERS, status: "open" }}
                emptyTitle="Nada em aberto"
                emptyDescription="Nenhuma tarefa designada a você neste espaço."
              />
            </div>
          ))
        )}
      </section>

      {/* Particulares ------------------------------------------------------ */}
      <section>
        <div className="mb-1 flex items-center gap-2">
          <Lock className="size-4 text-ink-400" aria-hidden />
          <h2 className="font-semibold text-ink-900">Suas tarefas particulares</h2>
        </div>
        <p className="mb-4 text-sm text-ink-500">
          O que você anotou para si. Não entra na lista de tarefas do espaço — mas
          quem administra o espaço consegue vê-las.
        </p>

        {quadros.length === 0 ? (
          <EmptyState
            title="Você ainda não participa de nenhum espaço"
            description="Tarefas particulares nascem dentro de um espaço de trabalho."
          />
        ) : (
          quadros.map((quadro) => (
            <div key={quadro.workspace.id} className="mb-6 last:mb-0">
              <Etiqueta nome={quadro.workspace.name} cor={quadro.workspace.color} />
              <TaskBrowser
                tasks={quadro.particulares}
                people={quadro.people}
                permissoes={taskPermissions(quadro.capabilities)}
                currentUserId={user.id}
                workspaceId={quadro.workspace.id}
                initialFilters={{ ...EMPTY_FILTERS, status: "open" }}
                emptyTitle="Nenhuma tarefa particular aqui"
                emptyDescription="Anote o que for seu neste espaço."
                allowCreate
                createPersonal
              />
            </div>
          ))
        )}
      </section>
    </div>
    </WorkspacesShell>
  );
}

/** Nome do espaço acima de cada bloco, com a bolinha da cor dele. */
function Etiqueta({ nome, cor }: { nome: string; cor: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={cn("size-2 shrink-0 rounded-full", accentClass(cor))} aria-hidden />
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        {nome}
      </span>
    </div>
  );
}
