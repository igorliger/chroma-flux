"use client";

import { Clock } from "lucide-react";

import { Select } from "@/components/ui";
import { WEEKDAYS } from "@/lib/recurrence";
import { TIME_OPTIONS, cn } from "@/lib/utils";

/** Fusos do Brasil, do mais ao menos populoso, mais UTC como escape. */
export const FUSOS = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Cuiaba", label: "Cuiabá (GMT-4)" },
  { value: "America/Belem", label: "Belém (GMT-3)" },
  { value: "America/Fortaleza", label: "Fortaleza (GMT-3)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { value: "UTC", label: "UTC" },
];

export type WindowValue = {
  enabled: boolean;
  weekdays: number[];
  startsAt: string;
  endsAt: string;
  timezone: string;
};

/**
 * Dias da semana, horário e fuso de uma janela de uso — o miolo compartilhado
 * pela janela pessoal (`AccessWindowForm`) e pela janela de cada grupo
 * (`AccessGroupsPanel`), que só diferem no que envolve isso (nome do grupo,
 * botão de salvar, etc).
 */
export function WindowFields({
  value,
  onChange,
  idPrefix,
}: {
  value: WindowValue;
  onChange: (next: WindowValue) => void;
  /** Evita ids de `<label>`/controles colidindo quando há vários painéis na tela. */
  idPrefix: string;
}) {
  function alternarDia(dia: number) {
    onChange({
      ...value,
      weekdays: value.weekdays.includes(dia)
        ? value.weekdays.filter((d) => d !== dia)
        : [...value.weekdays, dia].sort((a, b) => a - b),
    });
  }

  const atravessaMeiaNoite = value.startsAt > value.endsAt;

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        />
        <span>
          <span className="text-sm font-medium text-ink-800">Limitar dias e horários de uso</span>
          <span className="block text-xs text-ink-500">
            Fora da janela, ninguém consegue criar, editar ou concluir nada.
          </span>
        </span>
      </label>

      {value.enabled && (
        <div className="space-y-4 border-l border-ink-200 pl-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-500">Dias da semana</p>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const marcado = value.weekdays.includes(d.value);
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
                value={value.startsAt}
                onChange={(e) => onChange({ ...value, startsAt: e.target.value })}
                aria-label="Horário inicial"
                id={`${idPrefix}-starts-at`}
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
                value={value.endsAt}
                onChange={(e) => onChange({ ...value, endsAt: e.target.value })}
                aria-label="Horário final"
                id={`${idPrefix}-ends-at`}
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
                value={value.timezone}
                onChange={(e) => onChange({ ...value, timezone: e.target.value })}
                aria-label="Fuso horário"
                id={`${idPrefix}-timezone`}
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
              Esta janela atravessa a meia-noite: vai das {value.startsAt} de um dia marcado até
              as {value.endsAt} do dia seguinte.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
