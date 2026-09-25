import type { Metadata } from "next";
import { Info } from "lucide-react";

import { signOutAction } from "@/app/actions/auth";
import { WorkspacesShell } from "@/components/layout/workspaces-shell";
import { Card } from "@/components/ui";
import {
  getMyPermissionMatrix,
  getMyProfile,
  listMyAccessGroups,
  listMyInvitees,
  listMyTeamMembers,
  listWorkspaces,
  requireUser,
} from "@/lib/queries";
import { canAdminister } from "@/lib/utils";

import { NotificationSettings } from "@/components/notifications/notification-settings";

import { AccessGroupsPanel } from "./access-groups-panel";
import { InviteesPanel } from "./invitees-panel";
import { PermissionsMatrix } from "./permissions-matrix";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Configurações" };

/**
 * Configurações gerais da conta — fora de qualquer espaço de trabalho.
 *
 * As permissões moram aqui porque são uma regra única: valem para todos os
 * espaços de que você é proprietário. Dentro de um espaço elas seriam
 * enganosas, sugerindo que a alteração se limita àquele.
 */
export default async function ConfiguracoesPage() {
  const user = await requireUser();

  const [perfil, workspaces, matriz, grupos, membrosDaEquipe] = await Promise.all([
    getMyProfile(),
    listWorkspaces(user.id),
    getMyPermissionMatrix(),
    listMyAccessGroups(),
    listMyTeamMembers(user.id),
  ]);

  const meusEspacos = workspaces.filter((w) => w.role === "owner");

  /*
    Permissões e janela de uso são regras que a pessoa impõe a outros. Quem
    entra como membro ou visualizador em todos os seus espaços não impõe regra
    a ninguém: os dois cartões apareciam vazios de sentido, um deles anunciando
    que valia para "os 0 espaços de que você é proprietário". Some com eles.

    O perfil continua, que é a razão de a tela existir para todo mundo.
  */
  const mandaEmAlgumEspaco = workspaces.some((w) => canAdminister(w.role));

  const convidados = await listMyInvitees(
    workspaces.filter((w) => canAdminister(w.role)).map((w) => ({ id: w.id, name: w.name })),
  );

  // Só o booleano sai do servidor — nunca o valor da chave.
  const emailConfigurado = Boolean(process.env.RESEND_API_KEY?.trim());

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
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
            Configurações
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Preferências da sua conta, válidas em todos os espaços de trabalho.
          </p>
        </header>

        <Card>
          <h2 className="font-semibold text-ink-900">Seu perfil</h2>
          <p className="mb-4 mt-1 text-sm text-ink-500">
            Como seu nome aparece para as outras pessoas.
          </p>
          <ProfileForm
            fullName={perfil?.full_name ?? ""}
            email={user.email ?? perfil?.email ?? ""}
          />
        </Card>

        <Card className="mt-6">
          <h2 className="font-semibold text-ink-900">Notificações</h2>
          <p className="mb-4 mt-1 text-sm text-ink-500">
            Avisos no computador ou celular, mesmo com o Chroma Flux fechado: tarefas
            vencendo, resumo do dia às 8h e, para quem criou ou administra o espaço,
            quando alguém conclui uma tarefa. Ative em cada navegador ou aparelho que
            você usa.
          </p>
          <NotificationSettings />
        </Card>

        {mandaEmAlgumEspaco && (
          <>
            <Card className="mt-6">
              <h2 className="font-semibold text-ink-900">Convidados e funções</h2>
              <p className="mt-1 text-sm text-ink-500">
                Todas as pessoas dos espaços que você administra, e os convites que
                ainda não foram aceitos. Troque a função de cada uma aqui.
              </p>
              <p
                className={
                  emailConfigurado
                    ? "mb-4 mt-3 rounded-lg bg-ok-bg px-3 py-2 text-xs text-ok-fg"
                    : "mb-4 mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn-fg"
                }
              >
                {emailConfigurado
                  ? "Envio de convites por e-mail: ativo no servidor."
                  : "Envio de convites por e-mail: a chave do Resend (RESEND_API_KEY) não está chegando ao servidor — os convites ficam registrados, mas nenhum e-mail sai."}
              </p>
              <InviteesPanel espacos={convidados} />
            </Card>

            <Card className="mt-6">
              <h2 className="font-semibold text-ink-900">
                Permissões por papel
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Marque o que cada papel pode fazer. As regras valem no banco de
                dados, não só na tela.
              </p>

              <p className="mb-4 mt-3 flex items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Esta é uma configuração única: vale para{" "}
                  <strong>
                    {meusEspacos.length === 1
                      ? "o espaço de que você é proprietário"
                      : `os ${meusEspacos.length} espaços de que você é proprietário`}
                  </strong>
                  . Espaços de outras pessoas seguem as permissões definidas por
                  elas.
                </span>
              </p>

              <PermissionsMatrix
                inicial={matriz}
                canEdit={meusEspacos.length > 0}
                totalEspacos={meusEspacos.length}
              />
            </Card>

            <Card className="mt-6">
              <h2 className="font-semibold text-ink-900">Grupos de acesso</h2>
              <p className="mb-4 mt-1 text-sm text-ink-500">
                Restringe os dias e horários em que um grupo de membros pode
                trabalhar nos seus espaços. Como as permissões, a regra vale no
                banco de dados. Quem não estiver em nenhum grupo não tem
                restrição de horário.
              </p>
              <AccessGroupsPanel grupos={grupos} membros={membrosDaEquipe} />
            </Card>
          </>
        )}
      </main>
    </WorkspacesShell>
  );
}
