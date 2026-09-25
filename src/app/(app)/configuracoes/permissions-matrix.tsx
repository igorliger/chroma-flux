"use client";

import { useState, useTransition } from "react";
import { Lock, RotateCcw } from "lucide-react";

import { savePermissionsAction } from "@/app/actions/permissions";
import { Button, FormError, FormSuccess } from "@/components/ui";
import {
  CAPABILITY_GROUPS,
  ROLE_ORDER,
  fromPlain,
  isLocked,
  toPlain,
  type Capability,
  type PlainMatrix,
} from "@/lib/permissions";
import { cn, roleLabel } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/database.types";

/**
 * Matriz papel × capacidade da conta.
 *
 * As alterações ficam em estado local até "Salvar": marcar cada caixa contra o
 * servidor deixaria os espaços em combinações intermediárias que ninguém
 * escolheu — como um instante sem nenhuma permissão de escrita enquanto se
 * troca uma pela outra.
 */
export function PermissionsMatrix({
  inicial,
  canEdit,
  totalEspacos,
}: {
  inicial: PlainMatrix;
  canEdit: boolean;
  totalEspacos: number;
}) {
  const [matriz, setMatriz] = useState(() => fromPlain(inicial));
  const [salvando, startTransition] = useTransition();
  const [resultado, setResultado] = useState<{ error?: string; success?: string }>({});

  const alterado = JSON.stringify(toPlain(matriz)) !== JSON.stringify(normalizar(inicial));

  function alternar(role: WorkspaceRole, capability: Capability) {
    if (!canEdit || isLocked(role, capability)) return;

    setMatriz((atual) => {
      const copia = fromPlain(toPlain(atual));
      if (copia[role].has(capability)) copia[role].delete(capability);
      else copia[role].add(capability);
      return copia;
    });
    setResultado({});
  }

  function salvar() {
    startTransition(async () => {
      setResultado(await savePermissionsAction(toPlain(matriz)));
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto scrollbar-slim">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-[42%] px-2 pb-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                Permissão
              </th>
              {ROLE_ORDER.map((role) => (
                <th
                  key={role}
                  className="px-2 pb-2 text-center text-xs font-semibold text-ink-600"
                >
                  {roleLabel(role)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {CAPABILITY_GROUPS.map((grupo) => (
              <RowGroup key={grupo.grupo} titulo={grupo.grupo}>
                {grupo.itens.map((item) => (
                  <tr key={item.value} className="border-t border-ink-100">
                    <td className="px-2 py-2.5">
                      <span className="font-medium text-ink-800">{item.label}</span>
                      {item.hint && (
                        <span className="block text-xs text-ink-400">{item.hint}</span>
                      )}
                    </td>

                    {ROLE_ORDER.map((role) => {
                      const marcado = matriz[role].has(item.value);
                      const travado = isLocked(role, item.value);

                      return (
                        <td key={role} className="px-2 py-2.5 text-center">
                          <label
                            className={cn(
                              "inline-flex items-center justify-center",
                              canEdit && !travado ? "cursor-pointer" : "cursor-default",
                            )}
                            title={
                              travado
                                ? "Sempre ativo: sem isso, ninguém poderia reabrir esta tela."
                                : undefined
                            }
                          >
                            <input
                              type="checkbox"
                              checked={marcado || travado}
                              disabled={!canEdit || travado}
                              onChange={() => alternar(role, item.value)}
                              aria-label={`${item.label} — ${roleLabel(role)}`}
                              className={cn(
                                "size-4 rounded border-ink-300 text-brand-600",
                                "focus:ring-brand-500 disabled:opacity-60",
                              )}
                            />
                            {travado && (
                              <Lock className="ml-1 size-3 text-ink-400" aria-hidden />
                            )}
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </RowGroup>
            ))}
          </tbody>
        </table>
      </div>

      <FormError>{resultado.error}</FormError>
      <FormSuccess>{resultado.success}</FormSuccess>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={salvar} loading={salvando} disabled={!alterado}>
            Salvar permissões
          </Button>
          {alterado && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setMatriz(fromPlain(inicial));
                  setResultado({});
                }}
              >
                <RotateCcw className="size-4" aria-hidden />
                Descartar
              </Button>
              <span className="text-xs text-ink-500">
                Vai valer para {totalEspacos}{" "}
                {totalEspacos === 1 ? "espaço" : "espaços"} de uma vez.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RowGroup({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td
          colSpan={ROLE_ORDER.length + 1}
          className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-ink-400"
        >
          {titulo}
        </td>
      </tr>
      {children}
    </>
  );
}

/** Ordena as listas para a comparação de "houve mudança" não depender da ordem. */
function normalizar(plain: PlainMatrix): PlainMatrix {
  return {
    owner: [...plain.owner].sort(),
    admin: [...plain.admin].sort(),
    member: [...plain.member].sort(),
    viewer: [...plain.viewer].sort(),
  };
}
