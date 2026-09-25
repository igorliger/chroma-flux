"use client";

import { useState, useTransition } from "react";
import { Clock } from "lucide-react";

import { saveAccessWindowAction } from "@/app/actions/access-window";
import { Button, FormError, FormSuccess, Select } from "@/components/ui";
import { WEEKDAYS } from "@/lib/recurrence";
import { TIME_OPTIONS, cn } from "@/lib/utils";
import type { AccessWindow } from "@/lib/queries";

/** Fusos do Brasil, do mais ao menos populoso, mais UTC como escape. */
const FUSOS = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Cuiaba", label: "Cuiabá (GMT-4)" },
  { value: "America/Belem", label: "Belém (GMT-3)" },
  { value: "America/Fortaleza", label: "Fortaleza (GMT-3)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { value: "UTC", label: "UTC" },
];

/**
 * Janela de uso: dias e horário em que a equipe pode trabalhar.
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

  function alternarDia(dia: number) {
    setJanela((j) => ({
      ...j,
      weekdays: j.weekdays.includes(dia)
        ? j.weekdays.filter((d) => d !== dia)
        : [...j.weekdays, dia].sort((a, b) => a - b),
    }));
    setResultado({});
  }

  function salvar() {
    startTransition(async () => {
      setResultado(await saveAccessWindowAction(janela));
    });
  }

  const atravessaMeiaNoite = janela.startsAt > janela.endsAt;

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={janela.enabled}
          onChange={(e) => {
            setJanela((j) => ({ ...j, enabled: e.target.checked }));
            setResultado({});
          }}
          className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        />
        <span>
          <span className="text-sm font-medium text-ink-800">
            Limitar dias e horários de uso
          </span>
          <span className="block text-xs text-ink-500">
            Fora da janela, ninguém consegue criar, editar ou concluir nada.
          </span>
        </span>
      </label>

      {janela.enabled && (
        <div className="space-y-4 border-l border-ink-200 pl-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">Dias da semana</p>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const marcado = janela.weekdays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => alternarDia(d.value)}
                    aria-pressed={marcado}
                    aria-label={d.label}
                    title={d.label}
                    className={cn(
                      "size-9 rounded-full text-xs font-semibold transition-colors",
                      marcado
                        ? "bg-brand-600 text-white"
                        : "bg-ink-100 text-ink-500 hover:bg-ink-200",
                    )}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-500">Das</p>
              <Select
                value={janela.startsAt}
                onChange={(e) => setJanela((j) => ({ ...j, startsAt: e.target.value }))}
                aria-label="Horário inicial"
                className="h-9 w-28"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-500">até</p>
              <Select
                value={janela.endsAt}
                onChange={(e) => setJanela((j) => ({ ...j, endsAt: e.target.value }))}
                aria-label="Horário final"
                className="h-9 w-28"
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="min-w-48 flex-1">
              <p className="mb-1.5 text-xs font-medium text-ink-500">Fuso horário</p>
              <Select
                value={janela.timezone}
                onChange={(e) => setJanela((j) => ({ ...j, timezone: e.target.value }))}
                aria-label="Fuso horário"
                className="h-9"
              >
                {FUSOS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {atravessaMeiaNoite && (
            <p className="flex items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-600">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Esta janela atravessa a meia-noite: vai das {janela.startsAt} de um dia
              marcado até as {janela.endsAt} do dia seguinte.
            </p>
          )}

          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
            Você, como proprietário, nunca é bloqueado — do contrário não
            conseguiria voltar aqui para desfazer.
          </p>
        </div>
      )}

      <FormError>{resultado.error}</FormError>
      <FormSuccess>{resultado.success}</FormSuccess>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={salvar} loading={salvando} disabled={!alterado}>
          Salvar janela
        </Button>
        {alterado && janela.enabled && (
          <span className="text-xs text-ink-500">
            Vai valer para {totalEspacos} {totalEspacos === 1 ? "espaço" : "espaços"}.
          </span>
        )}
      </div>
    </div>
  );
}
