"use client";

import { CalendarDays, Clock, Repeat, X } from "lucide-react";

import { Input, Select } from "@/components/ui";
import {
  RECURRENCE_TYPES,
  RECURRENCE_UNITS,
  WEEKDAYS,
  describeRecurrence,
  recurrenceNeedsDueDate,
  usesUnit,
  usesWeekdays,
  type Recurrence,
} from "@/lib/recurrence";
import { TIME_OPTIONS, cn, toTimeOption } from "@/lib/utils";
import type { RecurrenceType, RecurrenceUnit } from "@/lib/database.types";

/**
 * Prazo com repetição, no mesmo conjunto de opções do Asana.
 *
 * Os controles aparecem em cascata: a repetição só surge depois que há uma
 * data, e os campos de intervalo, unidade e dias da semana só aparecem para os
 * tipos que realmente os usam. Mostrar tudo de uma vez faria um formulário
 * grande para um caso que, na maioria das vezes, é só "escolher um dia".
 */
export function DueDateField({
  dueDate,
  dueTime,
  recurrence,
  onDueDateChange,
  onDueTimeChange,
  onRecurrenceChange,
  pending = null,
  disabled = false,
  idPrefix = "prazo",
}: {
  dueDate: string | null;
  dueTime: string | null;
  recurrence: Recurrence;
  onDueDateChange: (value: string | null) => void;
  onDueTimeChange: (value: string | null) => void;
  onRecurrenceChange: (value: Recurrence) => void;
  /**
   * Mensagem de quem salva sozinho, dizendo o que falta para a repetição ser
   * gravada. Quem tem botão de salvar não precisa: lá o erro vem no envio.
   */
  pending?: string | null;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const set = <K extends keyof Recurrence>(key: K, value: Recurrence[K]) =>
    onRecurrenceChange({ ...recurrence, [key]: value });

  function trocarTipo(type: RecurrenceType) {
    // Semanal começa marcando o dia da semana do próprio prazo — é quase
    // sempre o que se quer, e evita um passo a mais.
    const weekdays =
      type === "weekly" && recurrence.weekdays.length === 0 && dueDate
        ? [new Date(`${dueDate}T12:00:00`).getDay()]
        : recurrence.weekdays;

    onRecurrenceChange({ ...recurrence, type, weekdays });
  }

  function alternarDia(dia: number) {
    const atual = recurrence.weekdays;
    const proximo = atual.includes(dia)
      ? atual.filter((d) => d !== dia)
      : [...atual, dia].sort((a, b) => a - b);

    // Pelo menos um dia precisa ficar marcado: o banco recusa lista vazia.
    if (proximo.length === 0) return;
    set("weekdays", proximo);
  }

  const resumo = describeRecurrence(recurrence);
  const faltaPrazo = recurrenceNeedsDueDate(recurrence.type) && !dueDate;

  /*
    Quem salva sozinho manda a pendência pronta; quem tem botão de salvar cai
    no aviso local, que cobre o único caso detectável antes do envio.
  */
  const aviso =
    pending ??
    (faltaPrazo
      ? "Escolha um prazo: este tipo de repetição segue uma agenda a partir dele. " +
        "Para contar a partir da conclusão, use “Periodicamente”."
      : null);

  return (
    <div className="space-y-3">
      {/* Data e hora */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="size-4 shrink-0 text-ink-400" aria-hidden />
        <Input
          id={`${idPrefix}-data`}
          type="date"
          value={dueDate ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const nova = e.target.value || null;
            onDueDateChange(nova);
            // Hora sem data não descreve prazo nenhum — o banco também recusa.
            if (!nova && dueTime) onDueTimeChange(null);
          }}
          aria-label="Prazo"
          className="h-9 max-w-44"
        />

        {/* A hora só faz sentido depois que existe uma data. */}
        {dueDate && (
          <>
            <Clock className="size-4 shrink-0 text-ink-400" aria-hidden />
            <Select
              id={`${idPrefix}-hora`}
              value={toTimeOption(dueTime)}
              disabled={disabled}
              onChange={(e) => onDueTimeChange(e.target.value || null)}
              aria-label="Hora"
              className="h-9 w-28"
            >
              <option value="">Sem hora</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </>
        )}

        {dueDate && !disabled && (
          <button
            type="button"
            onClick={() => {
              onDueDateChange(null);
              onDueTimeChange(null);
              // Sem data, a agenda fixa não se sustenta.
              if (recurrenceNeedsDueDate(recurrence.type)) {
                onRecurrenceChange({ ...recurrence, type: "none" });
              }
            }}
            className="text-xs text-ink-400 transition-colors hover:text-rose-600"
          >
            limpar
          </button>
        )}
      </div>

      {/* Repetição */}
      <div className="flex items-center gap-2">
        <Repeat className="size-4 shrink-0 text-ink-400" aria-hidden />
        <Select
          id={`${idPrefix}-repeticao`}
          value={recurrence.type}
          disabled={disabled}
          onChange={(e) => trocarTipo(e.target.value as RecurrenceType)}
          aria-label="Repetição"
          className="h-9 max-w-52"
        >
          {RECURRENCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {recurrence.type !== "none" && (
        <div className="ml-6 space-y-3 border-l border-ink-200 pl-4">
          {/* Intervalo e unidade */}
          {usesUnit(recurrence.type) ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
              <span>A cada</span>
              <Input
                type="number"
                min={1}
                max={999}
                value={recurrence.interval}
                disabled={disabled}
                onChange={(e) => set("interval", Math.max(1, Number(e.target.value) || 1))}
                aria-label="Intervalo"
                className="h-9 w-20"
              />
              <Select
                value={recurrence.unit}
                disabled={disabled}
                onChange={(e) => set("unit", e.target.value as RecurrenceUnit)}
                aria-label="Unidade"
                className="h-9 w-32"
              >
                {RECURRENCE_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {recurrence.interval === 1 ? u.singular : u.plural}
                  </option>
                ))}
              </Select>
              {recurrence.type === "periodic" && (
                <span className="text-ink-500">após concluir</span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
              <span>A cada</span>
              <Input
                type="number"
                min={1}
                max={999}
                value={recurrence.interval}
                disabled={disabled}
                onChange={(e) => set("interval", Math.max(1, Number(e.target.value) || 1))}
                aria-label="Intervalo"
                className="h-9 w-20"
              />
              <span>
                {recurrence.type === "daily" && (recurrence.interval === 1 ? "dia" : "dias")}
                {recurrence.type === "weekly" &&
                  (recurrence.interval === 1 ? "semana" : "semanas")}
                {recurrence.type === "monthly" &&
                  (recurrence.interval === 1 ? "mês" : "meses")}
                {recurrence.type === "yearly" && (recurrence.interval === 1 ? "ano" : "anos")}
              </span>
            </div>
          )}

          {/* Dias da semana */}
          {usesWeekdays(recurrence.type, recurrence.unit) && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-500">Dias da semana</p>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d) => {
                  const marcado = recurrence.weekdays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => alternarDia(d.value)}
                      aria-pressed={marcado}
                      aria-label={d.label}
                      title={d.label}
                      className={cn(
                        "size-8 rounded-full text-xs font-semibold transition-colors",
                        marcado
                          ? "bg-brand-600 text-white"
                          : "bg-ink-100 text-ink-500 hover:bg-ink-200",
                        disabled && "pointer-events-none opacity-50",
                      )}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fim da série */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <span>Até</span>
            <Input
              type="date"
              value={recurrence.endsOn ?? ""}
              min={dueDate ?? undefined}
              disabled={disabled}
              onChange={(e) => set("endsOn", e.target.value || null)}
              aria-label="Repetir até"
              className="h-9 max-w-44"
            />
            {recurrence.endsOn ? (
              !disabled && (
                <button
                  type="button"
                  onClick={() => set("endsOn", null)}
                  className="inline-flex items-center gap-1 text-xs text-ink-400 transition-colors hover:text-rose-600"
                >
                  <X className="size-3" aria-hidden />
                  sem limite
                </button>
              )
            ) : (
              <span className="text-xs text-ink-400">sem limite</span>
            )}
          </div>

          {/* Resumo e avisos */}
          {/* Com pendência o resumo perde a cor de confirmado: ele descreve o
              que foi escolhido, não o que já está valendo. */}
          {resumo && (
            <p
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium",
                aviso
                  ? "bg-ink-100 text-ink-500"
                  : "bg-brand-50 text-brand-700",
              )}
            >
              {resumo}
              {aviso && <span className="font-normal"> — ainda não salvo</span>}
            </p>
          )}
          {aviso && (
            <p role="alert" className="text-xs text-amber-700">
              {aviso}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
