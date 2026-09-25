"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

import { Button } from "@/components/ui";

import { usePushNotifications } from "./use-push-notifications";

const DISPENSADO = "chroma-flux:aviso-notificacoes-dispensado";

/**
 * Faixa discreta no topo das telas convidando a ativar as notificações.
 * Some quando ativadas, quando a pessoa clica em "Agora não" (fica
 * lembrado neste navegador) ou quando o navegador não suporta.
 */
export function NotificationPrompt() {
  const { estado, ocupado, ativar } = usePushNotifications();
  const [dispensado, setDispensado] = useState(true);

  useEffect(() => {
    try {
      setDispensado(window.localStorage.getItem(DISPENSADO) === "1");
    } catch {
      setDispensado(false);
    }
  }, []);

  if (dispensado || estado !== "desativado") return null;

  function dispensar() {
    setDispensado(true);
    try {
      window.localStorage.setItem(DISPENSADO, "1");
    } catch {
      // Sem armazenamento, a faixa volta na próxima visita — sem problema.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-brand-200 bg-brand-50 px-4 py-2.5 text-sm text-brand-900">
      <Bell className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        Receba avisos das tarefas a concluir e das tarefas concluídas, mesmo com o
        Chroma Flux fechado.
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={ativar} loading={ocupado}>
          Ativar
        </Button>
        <Button size="sm" variant="ghost" onClick={dispensar} aria-label="Agora não">
          <X className="size-4" aria-hidden />
          <span className="hidden sm:inline">Agora não</span>
        </Button>
      </div>
    </div>
  );
}
