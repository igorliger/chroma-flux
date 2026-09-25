"use client";

import { useState, useTransition } from "react";
import { Mail, X } from "lucide-react";

import {
  cancelInvitationAction,
  setInvitationRoleAction,
  setMemberRoleAction,
} from "@/app/actions/workspaces";
import { FormError, IconButton, Select } from "@/components/ui";
import type { InviteeWorkspace } from "@/lib/queries";
import { ROLES, roleLabel } from "@/lib/utils";

/** Funções disponíveis para convidados: tudo menos proprietário. */
const FUNCOES = ROLES.filter((r) => r.value !== "owner");

export function InviteesPanel({ espacos }: { espacos: InviteeWorkspace[] }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, startTransition] = useTransition();

  function executar(acao: () => Promise<{ error?: string }>) {
    setErro(null);
    startTransition(async () => {
      const r = await acao();
      if (r.error) setErro(r.error);
    });
  }

  const vazio = espacos.every((e) => e.members.length === 0 && e.invitations.length === 0);

  return (
    <div className="space-y-5">
      <ul className="grid gap-2 rounded-lg bg-ink-100 px-3 py-2.5 text-xs text-ink-600 sm:grid-cols-3">
        {FUNCOES.map((f) => (
          <li key={f.value}>
            <strong className="text-ink-800">{f.label}:</strong> {f.description}
          </li>
        ))}
      </ul>

      <FormError>{erro}</FormError>

      {vazio && (
        <p className="text-sm text-ink-500">
          Ninguém foi convidado ainda. Convide pessoas na tela <strong>Membros</strong> de
          cada espaço.
        </p>
      )}

      {espacos
        .filter((e) => e.members.length > 0 || e.invitations.length > 0)
        .map((espaco) => (
          <section key={espaco.workspaceId}>
            <h3 className="mb-2 text-sm font-semibold text-ink-800">{espaco.workspaceName}</h3>

            <ul className="divide-y divide-ink-200 rounded-lg border border-ink-200">
              {espaco.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{m.name}</p>
                    {m.email && <p className="truncate text-xs text-ink-500">{m.email}</p>}
                  </div>
                  {m.role === "owner" ? (
                    <span className="text-sm text-ink-500">{roleLabel("owner")}</span>
                  ) : (
                    <Select
                      value={m.role}
                      disabled={pendente}
                      aria-label={`Função de ${m.name} em ${espaco.workspaceName}`}
                      onChange={(e) =>
                        executar(() =>
                          setMemberRoleAction(espaco.workspaceId, m.userId, e.target.value),
                        )
                      }
                      className="h-9 w-44"
                    >
                      {FUNCOES.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </li>
              ))}

              {espaco.invitations.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <Mail className="size-4 shrink-0 text-ink-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{c.email}</p>
                    <p className="text-xs text-ink-500">Convite pendente — ainda não entrou</p>
                  </div>
                  <Select
                    value={c.role}
                    disabled={pendente}
                    aria-label={`Função do convite para ${c.email}`}
                    onChange={(e) => executar(() => setInvitationRoleAction(c.id, e.target.value))}
                    className="h-9 w-44"
                  >
                    {FUNCOES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                  <IconButton
                    label="Cancelar convite"
                    disabled={pendente}
                    onClick={() => executar(() => cancelInvitationAction(c.id))}
                  >
                    <X className="size-4" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
