"use client";

import { useState, useTransition } from "react";

import { saveAccessWindowAction } from "@/app/actions/access-window";
import { WindowFields } from "@/components/access-window/window-fields";
import { Button, FormError, FormSuccess } from "@/components/ui";
import type { AccessWindow } from "@/lib/queries";

/**
 * Janela de uso pessoal: dias e horário em que a equipe pode trabalhar,
 * aplicada a quem não estiver em nenhum grupo de acesso (ver
 * `AccessGroupsPanel`, logo abaixo desta na tela de Configurações).
 *
 * O fuso é escolhido explicitamente porque a janela é hora de parede: "das 8h
 * às 18h" precisa significar 8h no relógio de quem trabalha, e o servidor roda
 * em UTC.
 */
export function AccessWindowForm({
  inicial,
  totalEspacos,
}: {
  inicial: AccessWindow;
  totalEspacos: number;
}) {
  const [janela, setJanela] = useState<AccessWindow>(inicial);
  const [salvando, startTransition] = useTransition();
  const [resultado, setResultado] = useState<{ error?: string; success?: string }>({});

  const alterado = JSON.stringify(janela) !== JSON.stringify(inicial);

  function salvar() {
    startTransition(async () => {
      setResultado(await saveAccessWindowAction(janela));
    });
  }

  return (
    <div className="space-y-4">
      <WindowFields
        value={janela}
        onChange={(next) => {
          setJanela(next);
          setResultado({});
        }}
        idPrefix="janela-pessoal"
      />

      {janela.enabled && (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
          Você, como proprietário, nunca é bloqueado — do contrário não conseguiria voltar aqui
          para desfazer.
        </p>
      )}

      <FormError>{resultado.error}</FormError>
      <FormSuccess>{resultado.success}</FormSuccess>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={salvar} loading={salvando} disabled={!alterado}>
          Salvar janela
        </Button>
        {alterado && janela.enabled && (
          <span className="text-xs text-ink-500">
            Vai valer para {totalEspacos} {totalEspacos === 1 ? "espaço" : "espaços"} — só para
            quem não estiver em um grupo de acesso.
          </span>
        )}
      </div>
    </div>
  );
}
