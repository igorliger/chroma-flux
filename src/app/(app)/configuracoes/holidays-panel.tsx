"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { addHolidayAction, deleteHolidayAction, type HolidayState } from "@/app/actions/holidays";
import { Field, FormError, FormSuccess, IconButton, Input, Select, SubmitButton } from "@/components/ui";
import type { Holiday } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ESCOPO: Record<Holiday["scope"], { label: string; tom: string }> = {
  nacional: { label: "Nacional", tom: "bg-brand-50 text-brand-700" },
  estadual: { label: "Estadual", tom: "bg-amber-50 text-amber-700" },
  municipal: { label: "Municipal", tom: "bg-emerald-50 text-emerald-700" },
  empresa: { label: "Empresa", tom: "bg-ink-100 text-ink-700" },
};

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function formatar(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${DIAS[data.getDay()]}`;
}

export function HolidaysPanel({ feriados }: { feriados: Holiday[] }) {
  const [state, formAction] = useActionState<HolidayState, FormData>(addHolidayAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, startRemocao] = useTransition();
  const [verAnteriores, setVerAnteriores] = useState(false);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  const hoje = new Date().toISOString().slice(0, 10);
  const visiveis = verAnteriores ? feriados : feriados.filter((f) => f.date >= hoje);
  const anteriores = feriados.length - feriados.filter((f) => f.date >= hoje).length;

  const porAno = new Map<string, Holiday[]>();
  for (const f of visiveis) {
    const ano = f.date.slice(0, 4);
    porAno.set(ano, [...(porAno.get(ano) ?? []), f]);
  }

  return (
    <div className="space-y-5">
      <form ref={formRef} action={formAction} className="space-y-3">
        <FormError>{state.error}</FormError>
        <FormSuccess>{state.success}</FormSuccess>
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto_auto] sm:items-end">
          <Field label="Data" htmlFor="feriado-data">
            <Input id="feriado-data" name="date" type="date" required />
          </Field>
          <Field label="Nome" htmlFor="feriado-nome">
            <Input id="feriado-nome" name="name" placeholder="Ex.: Recesso de fim de ano" maxLength={80} required />
          </Field>
          <Field label="Tipo" htmlFor="feriado-tipo">
            <Select id="feriado-tipo" name="scope" defaultValue="empresa" className="sm:w-36">
              <option value="empresa">Empresa</option>
              <option value="municipal">Municipal</option>
              <option value="estadual">Estadual</option>
              <option value="nacional">Nacional</option>
            </Select>
          </Field>
          <SubmitButton>
            <Plus className="size-4" aria-hidden />
            Adicionar
          </SubmitButton>
        </div>
      </form>

      <FormError>{erro}</FormError>

      {visiveis.length === 0 ? (
        <p className="text-sm text-ink-500">Nenhum feriado cadastrado daqui para a frente.</p>
      ) : (
        [...porAno.entries()].map(([ano, lista]) => (
          <section key={ano}>
            <h3 className="mb-2 text-sm font-semibold text-ink-800">{ano}</h3>
            <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
              {lista.map((f) => (
                <li
                  key={f.id}
                  className={cn("flex items-center gap-3 px-3 py-2", f.date < hoje && "opacity-50")}
                >
                  <span className="w-24 shrink-0 text-sm tabular-nums text-ink-600">{formatar(f.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{f.name}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", ESCOPO[f.scope].tom)}>
                    {ESCOPO[f.scope].label}
                  </span>
                  <IconButton
                    label={`Remover ${f.name}`}
                    disabled={removendo}
                    onClick={() =>
                      startRemocao(async () => {
                        const r = await deleteHolidayAction(f.id);
                        setErro(r.error ?? null);
                      })
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {anteriores > 0 && (
        <button
          type="button"
          onClick={() => setVerAnteriores((v) => !v)}
          className="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          {verAnteriores ? "Esconder feriados que já passaram" : `Mostrar ${anteriores} que já passaram`}
        </button>
      )}
    </div>
  );
}
