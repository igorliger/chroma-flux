import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Info, Lock } from "lucide-react";

import {
  changeMemberRoleAction,
  removeMemberAction,
  revokeInvitationAction,
  setWorkspaceResponsibleAction,
} from "@/app/actions/workspaces";
import { Avatar, Button, Card, FormError } from "@/components/ui";
import { InviteForm } from "./invite-form";
import { ResponsibleSelect } from "./responsible-select";
import { RoleSelect } from "./role-select";
import {
  getWorkspacePermissionMatrix,
  getWorkspaceContext,
  listMembers,
  listWorkspaceInvitations,
} from "@/lib/queries";
import { CAPABILITY_GROUPS, ROLE_ORDER, fromPlain } from "@/lib/permissions";
import { canAdminister, formatDate, roleLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Membros" };

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const { role, user, workspace } = await getWorkspaceContext(workspaceId);
  const isAdmin = canAdminister(role);

  /*
    A tela é de quem administra o espaço. O menu já não a oferece aos demais,
    mas o link continuaria funcionando digitado na barra de endereço — e uma
    tela que se abre para quem não deveria vê-la não está protegida por não
    aparecer no menu.

    `notFound()` em vez de uma mensagem de acesso negado: para quem não
    administra, esta tela simplesmente não existe.
  */
  if (!isAdmin) notFound();

  const [members, invitations, matriz] = await Promise.all([
    listMembers(workspaceId),
    listWorkspaceInvitations(workspaceId),
    // A matriz que rege este espaço é a do proprietário dele, que pode não ser
    // quem está olhando.
    getWorkspacePermissionMatrix(workspace.owner_id),
  ]);

  const ownerCount = members.filter((m) => m.role === "owner").length;

  const people = members
    .map((m) => m.profile)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const responsavel = people.find((p) => p.id === workspace.responsible_id) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Membros</h1>
        <p className="mt-1 text-sm text-ink-500">
          Quem tem acesso a este espaço de trabalho e com qual permissão.
        </p>
      </header>

      {query.erro && (
        <div className="mb-4">
          <FormError>{query.erro}</FormError>
        </div>
      )}

      {/* Convidar */}
      {isAdmin && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold text-ink-900">Convidar pessoa</h2>
          <InviteForm workspaceId={workspaceId} />
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              O convite fica pendente até que a pessoa entre no Chroma Flux com esse mesmo
              e-mail — ela verá o convite na tela de espaços de trabalho e poderá aceitá-lo.
            </span>
          </p>
        </Card>
      )}

      {/* Convites pendentes */}
      {isAdmin && invitations.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink-900">
            <Clock className="size-4 text-ink-400" aria-hidden />
            Convites pendentes
          </h2>
          <ul className="divide-y divide-ink-100">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {invitation.email}
                  </p>
                  <p className="text-xs text-ink-500">
                    {roleLabel(invitation.role)} · expira em{" "}
                    {formatDate(invitation.expires_at)}
                  </p>
                </div>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="invitationId" value={invitation.id} />
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <Button type="submit" variant="ghost" size="sm">
                    Cancelar
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Responsável pelo espaço */}
      <Card className="mb-6">
        <h2 className="flex items-center gap-2 font-semibold text-ink-900">
          <Lock className="size-4 text-ink-400" aria-hidden />
          Responsável pelo espaço
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Designe uma pessoa e o espaço passa a ser dela: só ela e quem administra
          enxergam as tarefas, os comentários e os anexos daqui. Sem ninguém designado,
          todos os membros veem tudo.
        </p>

        {isAdmin ? (
          <form action={setWorkspaceResponsibleAction} className="mt-4">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <ResponsibleSelect
              defaultValue={workspace.responsible_id}
              people={people}
            />
            <button type="submit" className="sr-only">
              Salvar responsável
            </button>
          </form>
        ) : (
          <p className="mt-4 text-sm text-ink-700">
            {responsavel
              ? responsavel.full_name || responsavel.email
              : "Ninguém designado — espaço compartilhado."}
          </p>
        )}

        {responsavel && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Os demais membros continuam neste espaço, mas não veem as tarefas dele.
              Para devolver o espaço ao uso compartilhado, escolha “Ninguém”.
            </span>
          </p>
        )}
      </Card>

      {/* Membros */}
      <Card>
        <h2 className="mb-3 font-semibold text-ink-900">
          {members.length} {members.length === 1 ? "membro" : "membros"}
        </h2>

        <ul className="divide-y divide-ink-100">
          {members.map((member) => {
            const isSelf = member.user_id === user.id;
            const isLastOwner = member.role === "owner" && ownerCount === 1;
            const nome = member.profile?.full_name || member.profile?.email || "Usuário";

            return (
              <li key={member.user_id} className="flex items-center gap-3 py-3">
                <Avatar
                  id={member.user_id}
                  name={member.profile?.full_name ?? ""}
                  email={member.profile?.email}
                />

                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink-800">
                    <span className="truncate">{nome}</span>
                    {isSelf && <span className="text-xs text-ink-400">(você)</span>}
                    {member.user_id === workspace.responsible_id && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                        <Lock className="size-3" aria-hidden />
                        Responsável
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-500">{member.profile?.email}</p>
                </div>

                {isAdmin ? (
                  <div className="shrink-0">
                    <form action={changeMemberRoleAction}>
                      <input type="hidden" name="workspaceId" value={workspaceId} />
                      <input type="hidden" name="userId" value={member.user_id} />
                      <RoleSelect
                        defaultValue={member.role}
                        nome={nome}
                        // Rebaixar o último proprietário deixaria o espaço sem
                        // dono. O gatilho no banco recusa; aqui as opções já
                        // chegam bloqueadas, para o erro nem acontecer.
                        disabledValues={
                          isLastOwner ? ["admin", "member", "viewer"] : []
                        }
                        title={
                          isLastOwner
                            ? "Único proprietário do espaço. Promova outra pessoa a proprietário antes de mudar este papel."
                            : undefined
                        }
                      />
                      <button type="submit" className="sr-only">
                        Salvar papel
                      </button>
                    </form>
                    {isLastOwner && (
                      <p className="mt-1 text-right text-[11px] text-ink-400">
                        único proprietário
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="shrink-0 rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">
                    {roleLabel(member.role)}
                  </span>
                )}

                {(isAdmin || isSelf) && !isLastOwner && (
                  <form action={removeMemberAction} className="shrink-0">
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="userId" value={member.user_id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {isSelf ? "Sair" : "Remover"}
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* Resumo do que cada papel pode fazer, sem edição.
          A matriz vive nas configurações gerais: ela é uma regra única da
          conta, e editá-la aqui sugeriria que a mudança se limita a este
          espaço, quando na verdade alcança todos. */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-ink-900">Permissões por papel</h2>
            <p className="mt-1 text-sm text-ink-500">
              O que cada papel pode fazer aqui.
            </p>
          </div>
          <Link
            href="/configuracoes"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Editar nas configurações
          </Link>
        </div>

        <ul className="mt-4 space-y-3">
          {ROLE_ORDER.map((papel) => {
            const capacidades = fromPlain(matriz)[papel];
            const rotulos = CAPABILITY_GROUPS.flatMap((g) => g.itens)
              .filter((i) => capacidades.has(i.value))
              .map((i) => i.label);

            return (
              <li key={papel} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                <span className="w-32 shrink-0 text-sm font-medium text-ink-700">
                  {roleLabel(papel)}
                </span>
                <span className="text-sm text-ink-500">
                  {rotulos.length > 0 ? rotulos.join(" · ") : "Somente leitura."}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
