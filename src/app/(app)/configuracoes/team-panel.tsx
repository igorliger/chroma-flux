"use client";

import { useState, useTransition } from "react";
import { Mail, RotateCw, UserMinus, X } from "lucide-react";

import {
  cancelTeamInviteAction,
  removeFromTeamAction,
  resendTeamInviteAction,
  setInviteWorkspaceRoleAction,
  setMemberWorkspaceRoleAction,
  type TeamActionState,
} from "@/app/actions/team";
import { Avatar, Button, FormError, FormSuccess, IconButton, Modal, Select } from "@/components/ui";
import type { TeamOverview } from "@/lib/queries";
import { ROLES, accentClass, cn } from "@/lib/utils";

const FUNCOES = ROLES.filter((r) => r.value !== "owner");

function SeletorEspacos({
  workspaces,
  valores,
  disabled,
  onChange,
}: {
  workspaces: TeamOverview["workspaces"];
  valores: Record<string, string>;
  disabled: boolean;
  onChange: (workspaceId: string, role: string) => void;
}) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {workspaces.map((w) => (
        <label
          key={w.id}
          className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-1.5"
        >
          <span className="flex min-w-0 items-center gap-2 text-xs text-ink-700">
            <span className={cn("size-2 shrink-0 rounded-full", accentClass(w.color))} />
            <span className="truncate">{w.name}</span>
          </span>
          <Select
            value={valores[w.id] ?? "none"}
            disabled={disabled || valores[w.id] === "owner"}
            onChange={(e) => onChange(w.id, e.target.value)}
            className="h-8 w-36 text-xs"
            aria-label={`Função em ${w.name}`}
          >
            <option value="none">Sem acesso</option>
            {FUNCOES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
            {valores[w.id] === "owner" && <option value="owner">Proprietário</option>}
          </Select>
        </label>
      ))}
    </div>
  );
}

export function TeamPanel({ equipe }: { equipe: TeamOverview }) {
  const [resultado, setResultado] = useState<TeamActionState>({});
  const [pendente, startTransition] = useTransition();
  const [removendo, setRemovendo] = useState<{ userId: string; name: string } | null>(null);

  function executar(acao: () => Promise<TeamActionState>) {
    setResultado({});
    startTransition(async () => setResultado(await acao()));
  }

  const vazio = equipe.members.length === 0 && equipe.invitations.length === 0;

  return (
    <div className="space-y-3">
      <FormError>{resultado.error}</FormError>
      <FormSuccess>{resultado.success}</FormSuccess>

      {vazio && (
        <p className="text-sm text-ink-500">Ninguém na equipe ainda. Convide alguém acima.</p>
      )}

      <ul className="space-y-3">
        {equipe.members.map((m) => (
          <li key={m.userId} className="rounded-lg border border-ink-200 p-3">
            <div className="flex items-center gap-3">
              <Avatar id={m.userId} name={m.name} email={m.email} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{m.name}</p>
                <p className="truncate text-xs text-ink-500">{m.email}</p>
              </div>
              <IconButton
                label="Tirar da equipe"
                disabled={pendente}
                onClick={() => setRemovendo({ userId: m.userId, name: m.name })}
              >
                <UserMinus className="size-4" aria-hidden />
              </IconButton>
            </div>
            <SeletorEspacos
              workspaces={equipe.workspaces}
              valores={m.roles}
              disabled={pendente}
              onChange={(ws, role) =>
                executar(() => setMemberWorkspaceRoleAction(m.userId, ws, role))
              }
            />
          </li>
        ))}

        {equipe.invitations.map((c) => (
          <li key={c.id} className="rounded-lg border border-dashed border-ink-300 p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
                <Mail className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{c.email}</p>
                <p className="text-xs text-ink-500">
                  Convite pendente — entra nos espaços abaixo quando acessar o Chroma Flux
                </p>
              </div>
              <IconButton
                label="Reenviar e-mail"
                disabled={pendente}
                onClick={() => executar(() => resendTeamInviteAction(c.id))}
              >
                <RotateCw className="size-4" aria-hidden />
              </IconButton>
              <IconButton
                label="Cancelar convite"
                disabled={pendente}
                onClick={() => executar(() => cancelTeamInviteAction(c.id))}
              >
                <X className="size-4" aria-hidden />
              </IconButton>
            </div>
            <SeletorEspacos
              workspaces={equipe.workspaces}
              valores={c.workspaceRoles}
              disabled={pendente}
              onChange={(ws, role) =>
                executar(() => setInviteWorkspaceRoleAction(c.id, ws, role))
              }
            />
          </li>
        ))}
      </ul>

      <Modal
        open={removendo !== null}
        onClose={() => setRemovendo(null)}
        title={`Tirar ${removendo?.name ?? ""} da equipe?`}
        description="A pessoa sai de todos os seus espaços de trabalho. As tarefas dela continuam lá."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setRemovendo(null)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={pendente}
            onClick={() => {
              const alvo = removendo;
              setRemovendo(null);
              if (alvo) executar(() => removeFromTeamAction(alvo.userId));
            }}
          >
            Tirar da equipe
          </Button>
        </div>
      </Modal>
    </div>
  );
}
