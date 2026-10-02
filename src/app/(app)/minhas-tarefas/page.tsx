import type { Metadata } from "next";

import { signOutAction } from "@/app/actions/auth";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { MyTasksBrowser } from "@/components/task/my-tasks-browser";
import type { UnifiedSpace } from "@/components/task/new-unified-task-dialog";
import {
  getMyProfile,
  listPersonalBoards,
  listPersonalReminders,
  listWorkspaces,
  requireUser,
} from "@/lib/queries";
import { taskPermissions } from "@/lib/permissions";
import { adaptarLembrete, adaptarTarefaDeEspaco, type UnifiedTask } from "@/lib/unified-tasks";
import type { PersonRef } from "@/lib/database.types";

export const metadata: Metadata = { title: "Minhas tarefas" };

/**
 * Tudo que está sob responsabilidade da pessoa — tarefas de qualquer espaço
 * de que ela participa e lembretes pessoais — numa lista só, em vez de um
 * bloco por espaço mais um bloco de lembretes. Ver `lib/unified-tasks.ts`
 * pelo porquê da junção.
 *
 * Fica fora de `e/[workspaceId]`, então não herda o `AppShell` daquele
 * layout — por isso monta a mesma casca que a tela de espaços usa
 * (`WorkspacesShell`), para a barra lateral aparecer aqui também.
 */
export default async function MyTasksPage() {
  const user = await requireUser();
  const [quadros, lembretes, workspaces, perfil] = await Promise.all([
    listPersonalBoards(user.id),
    listPersonalReminders(user.id),
    listWorkspaces(user.id),
    getMyProfile(),
  ]);

  const tarefas: UnifiedTask[] = [
    ...quadros.flatMap((q) => [...q.designadas, ...q.particulares].map(adaptarTarefaDeEspaco)),
    ...lembretes.map((l) => adaptarLembrete(l, user.id)),
  ];

  const spaces: UnifiedSpace[] = quadros.map((q) => ({
    id: q.workspace.id,
    name: q.workspace.name,
    color: q.workspace.color,
    role: q.role,
    people: q.people,
    permissoes: taskPermissions(q.capabilities),
  }));

  const perfilPessoa: PersonRef = perfil
    ? { id: perfil.id, full_name: perfil.full_name, email: perfil.email, avatar_url: perfil.avatar_url }
    : { id: user.id, full_name: "", email: user.email ?? "", avatar_url: null };

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

  return (
    <WorkspacesShell {...shellProps}>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <MyTasksBrowser tasks={tarefas} currentUserId={user.id} perfil={perfilPessoa} spaces={spaces} />
      </div>
    </WorkspacesShell>
  );
}
