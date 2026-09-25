import { signOutAction } from "@/app/actions/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getWorkspaceContext, listWorkspaces } from "@/lib/queries";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, role, profile, user } = await getWorkspaceContext(workspaceId);

  // Alimenta o seletor no topo da barra: sem a lista, trocar de espaço
  // exigiria voltar à tela de espaços a cada vez.
  const workspaces = await listWorkspaces(user.id);

  return (
    <AppShell
      workspace={workspace}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name, color: w.color, role: w.role }))}
      role={role}
      user={{ id: user.id, name: profile.full_name, email: user.email }}
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}
