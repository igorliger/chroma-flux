import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Link from "next/link";

import { Button, Card } from "@/components/ui";
import { getMyCapabilities, getWorkspaceContext, listCustomFieldDefinitions } from "@/lib/queries";
import { canAdminister } from "@/lib/utils";

import { CustomFieldsForm } from "./custom-fields-form";
import { DeleteWorkspaceButton, WorkspaceSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { workspace, role } = await getWorkspaceContext(workspaceId);

  // Somente administradores acessam esta tela.
  if (!canAdminister(role)) notFound();

  const capacidades = await getMyCapabilities(workspace.owner_id, role);
  const podeGerenciarCampos = capacidades.has("custom_field.manage");
  const customFields = podeGerenciarCampos ? await listCustomFieldDefinitions(workspaceId) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Configurações</h1>
        <p className="mt-1 text-sm text-ink-500">
          Dados do espaço de trabalho e do seu perfil.
        </p>
      </header>

      <Card>
        <h2 className="mb-4 font-semibold text-ink-900">Espaço de trabalho</h2>
        <WorkspaceSettingsForm workspace={workspace} />
      </Card>

      {podeGerenciarCampos && (
        <Card className="mt-6">
          <h2 className="font-semibold text-ink-900">Campos personalizados</h2>
          <p className="mb-4 mt-1 text-sm text-ink-500">
            Aparecem no painel de cada tarefa deste espaço.
          </p>
          <CustomFieldsForm workspaceId={workspaceId} fields={customFields} />
        </Card>
      )}

      {/* Perfil e permissões saíram daqui: são da conta, não deste espaço.
          Editá-los numa tela de espaço sugeriria um alcance que não existe. */}
      <Card className="mt-6">
        <h2 className="font-semibold text-ink-900">Configurações da conta</h2>
        <p className="mb-4 mt-1 text-sm text-ink-500">
          Seu perfil e as permissões por papel valem para todos os seus espaços e
          ficam num lugar só.
        </p>
        <Link href="/configuracoes">
          <Button variant="secondary">Abrir configurações gerais</Button>
        </Link>
      </Card>

      {role === "owner" && (
        <Card className="mt-6 border-rose-200">
          <h2 className="font-semibold text-rose-700">Zona de risco</h2>
          <p className="mb-4 mt-1 text-sm text-ink-500">
            Excluir o espaço apaga permanentemente todas as tarefas, colunas e
            comentários dele. Não há como desfazer.
          </p>
          <DeleteWorkspaceButton workspace={workspace} />
        </Card>
      )}
    </div>
  );
}
