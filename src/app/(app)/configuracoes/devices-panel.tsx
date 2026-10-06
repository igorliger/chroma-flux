"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, MonitorSmartphone, Trash2, X } from "lucide-react";

import {
  decideDeviceAction,
  removeDeviceAction,
  setDeviceApprovalAction,
} from "@/app/actions/devices";
import { Button, FormError, FormSuccess, Modal } from "@/components/ui";
import type { CompanyDevice, DeviceApprovalOverview } from "@/lib/queries";
import { cn, formatDateTime } from "@/lib/utils";

/**
 * Liberação por dispositivo (recurso opcional, migração 0033).
 *
 * O interruptor é só do proprietário e começa desligado. A lista de pedidos
 * aparece para o proprietário e para os administradores dos espaços dele —
 * quem libera.
 */
export function DevicesPanel({
  overview,
  canToggle,
}: {
  overview: DeviceApprovalOverview;
  canToggle: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmarLigar, setConfirmarLigar] = useState(false);

  function executar(acao: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const r = await acao();
      setErro(r.error ?? null);
      setOk(r.error ? null : (r.success ?? null));
      if (!r.error) router.refresh();
    });
  }

  if (!overview.installed) {
    return (
      <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">
        Recurso preparado, mas ainda não instalado no banco de dados. Peça ao
        responsável técnico para aplicar a migração 0033.
      </p>
    );
  }

  const pendentes = overview.devices.filter((d) => d.status === "pending");
  const liberados = overview.devices.filter((d) => d.status === "approved");
  const recusados = overview.devices.filter((d) => d.status === "rejected");

  return (
    <div className="space-y-5">
      <FormError>{erro}</FormError>
      <FormSuccess>{ok}</FormSuccess>

      {canToggle && (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-ink-200 p-4">
          <div>
            <p className="text-sm font-medium text-ink-900">Exigir liberação de dispositivo</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {overview.enabled
                ? "Ligado: membros e visualizadores só entram por dispositivos liberados."
                : "Desligado: todos entram de qualquer dispositivo, como hoje."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={overview.enabled}
            aria-label="Exigir liberação de dispositivo"
            disabled={pending}
            onClick={() =>
              overview.enabled
                ? executar(() => setDeviceApprovalAction(false))
                : setConfirmarLigar(true)
            }
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              overview.enabled ? "bg-brand-600" : "bg-ink-300",
            )}
          >
            <span
              className={cn(
                "inline-block size-5 rounded-full bg-white shadow transition-transform",
                overview.enabled ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      )}

      <Lista
        titulo="Aguardando liberação"
        vazio="Nenhum pedido no momento."
        itens={pendentes}
        acoes={(d) => (
          <>
            <Button size="sm" disabled={pending} onClick={() => executar(() => decideDeviceAction(d.id, true))}>
              <Check className="size-4" aria-hidden />
              Liberar
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => executar(() => decideDeviceAction(d.id, false))}
            >
              <X className="size-4" aria-hidden />
              Recusar
            </Button>
          </>
        )}
      />

      {liberados.length > 0 && (
        <Lista
          titulo="Liberados"
          itens={liberados}
          acoes={(d) => (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => executar(() => removeDeviceAction(d.id))}
              aria-label={`Remover ${d.label} de ${d.person.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
              Remover
            </Button>
          )}
        />
      )}

      {recusados.length > 0 && (
        <Lista
          titulo="Recusados"
          itens={recusados}
          acoes={(d) => (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => executar(() => decideDeviceAction(d.id, true))}
            >
              Liberar
            </Button>
          )}
        />
      )}

      <Modal
        open={confirmarLigar}
        onClose={() => setConfirmarLigar(false)}
        title="Ligar a liberação por dispositivo?"
        description="No próximo acesso, cada membro e visualizador vai precisar pedir liberação do computador ou celular que usa — e só entra depois que você (ou um administrador) liberar aqui. Você e os administradores continuam entrando normalmente."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmarLigar(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            loading={pending}
            onClick={() => {
              setConfirmarLigar(false);
              executar(() => setDeviceApprovalAction(true));
            }}
          >
            Ligar
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Lista({
  titulo,
  vazio,
  itens,
  acoes,
}: {
  titulo: string;
  vazio?: string;
  itens: CompanyDevice[];
  acoes: (d: CompanyDevice) => React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-ink-900">
        {titulo}
        {itens.length > 0 && <span className="ml-1.5 font-normal text-ink-500">({itens.length})</span>}
      </h3>
      {itens.length === 0 ? (
        <p className="text-sm text-ink-500">{vazio}</p>
      ) : (
        <ul className="divide-y divide-ink-200/70 rounded-xl border border-ink-200">
          {itens.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <MonitorSmartphone className="size-5 shrink-0 text-ink-500" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{d.person.name}</p>
                <p className="text-xs text-ink-500">
                  {d.label} · pedido em {formatDateTime(d.requestedAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">{acoes(d)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
