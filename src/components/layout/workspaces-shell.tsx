"use client";

import {
  BarChart3,
  CheckSquare,
  LayoutDashboard,
  LayoutGrid,
  ListTodo,
  Settings,
  Users,
} from "lucide-react";

import { SidebarShell, type NavItem } from "@/components/layout/sidebar-shell";
import { accentClass, canAdminister } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/database.types";

/**
 * Casca da tela de espaços de trabalho.
 *
 * Aqui nenhum espaço está aberto, então a barra não pode simplesmente repetir
 * o menu de dentro de um deles. Em vez disso, cada espaço abre as próprias
 * seções numa setinha: dá para pular de qualquer lugar para qualquer seção de
 * qualquer espaço, sem precisar entrar nele primeiro.
 */
export function WorkspacesShell({
  workspaces,
  user,
  signOut,
  children,
}: {
  workspaces: { id: string; name: string; color: string; role: WorkspaceRole }[];
  user: { id: string; name: string; email: string };
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const itens: NavItem[] = workspaces.map((w) => {
    const base = `/e/${w.id}`;

    const filhos = [
      { href: base, label: "Painel", icon: LayoutDashboard },
      { href: `${base}/tarefas`, label: "Tarefas", icon: ListTodo },
    ];

    // Membros e configurações só existem para quem administra aquele espaço —
    // e o papel varia de espaço para espaço.
    if (canAdminister(w.role)) {
      filhos.push({ href: `${base}/membros`, label: "Membros", icon: Users });
      filhos.push({ href: `${base}/configuracoes`, label: "Configurações", icon: Settings });
    }

    return {
      href: base,
      label: w.name,
      icon: LayoutGrid,
      dotClass: accentClass(w.color),
      filhos,
    };
  });

  return (
    <SidebarShell
      titulo="Chroma Flux"
      tituloHref="/"
      grupos={[
        {
          itens: [
            // Visão de todos os espaços juntos: só para quem é dono de algum.
            ...(workspaces.some((w) => w.role === "owner")
              ? [{ href: "/dashboard", label: "Dashboard", icon: BarChart3, exact: true }]
              : []),
            { href: "/espacos", label: "Espaços de trabalho", icon: LayoutGrid, exact: true },
            {
              href: "/minhas-tarefas",
              label: "Minhas tarefas",
              icon: CheckSquare,
              exact: true,
            },
          ],
        },
        {
          rotulo: "Seus espaços",
          vazio: "Nenhum espaço ainda.",
          itens,
        },
      ]}
      acaoRodape={{
        href: "/configuracoes",
        label: "Configurações",
        icon: Settings,
        exact: true,
      }}
      user={user}
      signOut={signOut}
    >
      {children}
    </SidebarShell>
  );
}
