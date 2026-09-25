"use client";

import {
  Calendar,
  CheckSquare,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { SidebarShell, type NavItem } from "@/components/layout/sidebar-shell";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { accentClass, canAdminister, canCreateWorkspace, roleLabel } from "@/lib/utils";
import type { Workspace, WorkspaceRole } from "@/lib/database.types";

/** Casca das telas de dentro de um espaço de trabalho. */
export function AppShell({
  workspace,
  workspaces,
  role,
  user,
  signOut,
  children,
}: {
  workspace: Workspace;
  /** Todos os espaços do usuário, para o seletor no topo da barra. */
  workspaces: { id: string; name: string; color: string; role: WorkspaceRole }[];
  role: WorkspaceRole;
  user: { id: string; name: string; email: string };
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const base = `/e/${workspace.id}`;

  const principais: NavItem[] = [
    { href: base, label: "Painel", icon: LayoutDashboard, exact: true },
    { href: `${base}/tarefas`, label: "Tarefas", icon: ListTodo },
    { href: `${base}/quadro`, label: "Quadro", icon: LayoutGrid },
    { href: `${base}/calendario`, label: "Calendário", icon: Calendar },
  ];

  // Membros e configurações são de quem administra o espaço. A própria página
  // recusa quem não administra; aqui é só não oferecer o caminho.
  if (canAdminister(role)) {
    principais.push({ href: `${base}/membros`, label: "Membros", icon: Users });
    principais.push({
      href: `${base}/configuracoes`,
      // "do espaço" evita confusão com as configurações da conta, que ficam no
      // rodapé: são coisas diferentes com o mesmo nome.
      label: "Configurações do espaço",
      icon: Settings,
    });
  }

  return (
    <SidebarShell
      titulo={workspace.name}
      tituloHref="/espacos"
      tituloDotClass={accentClass(workspace.color)}
      cabecalho={
        <WorkspaceSwitcher
          atual={{ id: workspace.id, name: workspace.name, color: workspace.color }}
          workspaces={workspaces}
          podeCriar={canCreateWorkspace(workspaces.map((w) => w.role))}
        />
      }
      grupos={[
        { itens: principais },
        // Fora do espaço de propósito: a lista pessoal atravessa todos eles.
        {
          rotulo: "Você",
          itens: [
            { href: "/minhas-tarefas", label: "Minhas tarefas", icon: CheckSquare, exact: true },
          ],
        },
      ]}
      acaoRodape={{
        href: "/configuracoes",
        label: "Configurações",
        icon: SlidersHorizontal,
        exact: true,
      }}
      user={{ ...user, papel: roleLabel(role) }}
      signOut={signOut}
    >
      {children}
    </SidebarShell>
  );
}
