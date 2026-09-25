"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Plus, Trash2, Users } from "lucide-react";

import {
  createAccessGroupAction,
  deleteAccessGroupAction,
  setMemberAccessGroupAction,
  updateAccessGroupAction,
} from "@/app/actions/access-groups";
import { WindowFields, type WindowValue } from "@/components/access-window/window-fields";
import { Avatar, Button, FormError, FormSuccess, Input, Modal } from "@/components/ui";
import type { AccessGroup } from "@/lib/queries";
import type { PersonRef } from "@/lib/database.types";

const JANELA_NOVA: WindowValue = {
  enabled: false,
  weekdays: [1, 2, 3, 4, 5],
  startsAt: "08:00",
  endsAt: "18:00",
  timezone: "America/Sao_Paulo",
};

/**
 * Grupos de membros, cada um com a própria janela de uso — um refinamento da
 * janela pessoal acima (`AccessWindowForm`): quem entra num grupo passa a
 * seguir a janela dele; quem fica de fora continua na pessoal.
 */
export function AccessGroupsPanel({
  grupos,
  membros,
}: {
  grupos: AccessGroup[];
  membros: PersonRef[];
}) {
  const router = useRouter();
  const [criandoAberto, setCriandoAberto] = useState(false);

  // Mapa reverso: em qual grupo cada pessoa está, se estiver em algum.
  const grupoPorMembro = new Map<string, string>();
  for (const g of grupos) {
    for (const id of g.memberIds) grupoPorMembro.set(id, g.id);
  }

  return (
    <div className="space-y-4">
      {grupos.length === 0 && !criandoAberto && (
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <Users className="size-4 shrink-0" aria-hidden />
          Nenhum grupo ainda — todo mundo segue a janela pessoal acima.
        </p>
      )}

      <div className="space-y-3">
        {grupos.map((grupo) => (
          <GroupCard
            key={grupo.id}
            grupo={grupo}
            membros={membros}
            grupoPorMembro={grupoPorMembro}
            onChanged={() => router.refresh()}
          />
        ))}
      </div>

      {criandoAberto ? (
        <NewGroupForm
          onCancel={() => setCriandoAberto(false)}
          onCreated={() => {
            setCriandoAberto(false);
            router.refresh();
          }}
        />
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setCriandoAberto(true)}>
          <Plus className="size-4" aria-hidden />
          Novo grupo
        </Button>
      )}
    </div>
  );
}

function NewGroupForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [nome, setNome] = useState("");
  const [janela, setJanela] = useState<WindowValue>(JANELA_NOVA);
  const [salvando, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function criar() {
    startTransition(async () => {
      const result = await createAccessGroupAction({ name: nome, ...janela });
      if (result.error) {
        setErro(result.error);
        return;
      }
      onCreated();
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-ink-200 p-4">
      <div>
        <p className="mb-1.5 text-xs font-medium text-ink-500">Nome do grupo</p>
        <Input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            setErro(null);
          }}
          placeholder="Ex.: Vendas, Suporte..."
          className="max-w-xs"
        />
      </div>

      <WindowFields value={janela} onChange={setJanela} idPrefix="grupo-novo" />

      <FormError>{erro}</FormError>

      <div className="flex gap-2">
        <Button size="sm" onClick={criar} loading={salvando} disabled={!nome.trim()}>
          Criar grupo
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={salvando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function GroupCard({
  grupo,
  membros,
  grupoPorMembro,
  onChanged,
}: {
  grupo: AccessGroup;
  membros: PersonRef[];
  grupoPorMembro: Map<string, string>;
  onChanged: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(grupo.name);
  const [janela, setJanela] = useState<WindowValue>(grupo);
  const [salvando, startTransition] = useTransition();
  const [excluindo, setExcluindo] = useState(false);
  const [resultado, setResultado] = useState<{ error?: string; success?: string }>({});

  const alterado = nome !== grupo.name || JSON.stringify(janela) !== JSON.stringify(grupo);

  function salvar() {
    startTransition(async () => {
      const result = await updateAccessGroupAction(grupo.id, { name: nome, ...janela });
      setResultado(result);
      if (!result.error) onChanged();
    });
  }

  function excluir() {
    startTransition(async () => {
      await deleteAccessGroupAction(grupo.id);
      setExcluindo(false);
      onChanged();
    });
  }

  function alternarMembro(memberId: string, marcado: boolean) {
    startTransition(async () => {
      await setMemberAccessGroupAction(memberId, marcado ? grupo.id : null);
      onChanged();
    });
  }

  return (
    <div className="rounded-lg border border-ink-200">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-ink-900">{grupo.name}</p>
          <p className="text-xs text-ink-500">
            {grupo.memberIds.length === 0
              ? "Nenhum membro"
              : `${grupo.memberIds.length} ${grupo.memberIds.length === 1 ? "membro" : "membros"}`}
            {" · "}
            {grupo.enabled ? "Janela ativa" : "Sem restrição de horário"}
          </p>
        </div>
        {aberto ? (
          <ChevronUp className="size-4 shrink-0 text-ink-400" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-ink-400" aria-hidden />
        )}
      </button>

      {aberto && (
        <div className="space-y-5 border-t border-ink-100 px-4 py-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">Nome do grupo</p>
            <Input
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setResultado({});
              }}
              className="max-w-xs"
            />
          </div>

          <WindowFields
            value={janela}
            onChange={(next) => {
              setJanela(next);
              setResultado({});
            }}
            idPrefix={`grupo-${grupo.id}`}
          />

          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Membros neste grupo</p>
            {membros.length === 0 ? (
              <p className="text-xs text-ink-400">Nenhum membro na sua equipe ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {membros.map((pessoa) => {
                  const noGrupoAtual = grupoPorMembro.get(pessoa.id) === grupo.id;
                  const emOutroGrupo =
                    grupoPorMembro.has(pessoa.id) && !noGrupoAtual
                      ? grupoPorMembro.get(pessoa.id)
                      : null;

                  return (
                    <label
                      key={pessoa.id}
                      className="flex items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-ink-50"
                    >
                      <input
                        type="checkbox"
                        checked={noGrupoAtual}
                        disabled={salvando}
                        onChange={(e) => alternarMembro(pessoa.id, e.target.checked)}
                        className="size-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      />
                      <Avatar
                        id={pessoa.id}
                        name={pessoa.full_name}
                        email={pessoa.email}
                        size="sm"
                      />
                      <span className="text-sm text-ink-700">
                        {pessoa.full_name || pessoa.email}
                      </span>
                      {emOutroGrupo && (
                        <span className="ml-auto text-xs text-ink-400">Em outro grupo</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <FormError>{resultado.error}</FormError>
          <FormSuccess>{resultado.success}</FormSuccess>

          <div className="flex items-center justify-between gap-2">
            <Button size="sm" onClick={salvar} loading={salvando} disabled={!alterado}>
              Salvar grupo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExcluindo(true)}
              disabled={salvando}
              className="text-danger-fg hover:bg-danger-bg"
            >
              <Trash2 className="size-4" aria-hidden />
              Excluir grupo
            </Button>
          </div>
        </div>
      )}

      <Modal
        open={excluindo}
        onClose={() => setExcluindo(false)}
        title={`Excluir o grupo "${grupo.name}"?`}
        description="Os membros dele voltam a seguir a janela pessoal. Esta ação não pode ser desfeita."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setExcluindo(false)}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" loading={salvando} onClick={excluir}>
            Excluir
          </Button>
        </div>
      </Modal>
    </div>
  );
}
