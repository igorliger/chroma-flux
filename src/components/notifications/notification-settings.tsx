"use client";

import { useState, useTransition } from "react";
import { Bell, BellOff, Send } from "lucide-react";

import { sendTestPushAction } from "@/app/actions/push";
import { Button, FormError, FormSuccess, Spinner } from "@/components/ui";

import { usePushNotifications } from "./use-push-notifications";

/** Cartão "Notificações" em Configurações — vale só para este navegador. */
export function NotificationSettings() {
  const { estado, erro, ocupado, ativar, desativar } = usePushNotifications();
  const [testando, startTeste] = useTransition();
  const [aviso, setAviso] = useState<{ ok?: string; erro?: string }>({});

  function testar() {
    setAviso({});
    startTeste(async () => {
      const r = await sendTestPushAction();
      if (r.error) setAviso({ erro: r.error });
      else if (!r.enviados) setAviso({ erro: "Nenhum dispositivo ativo recebeu o teste." });
      else setAviso({ ok: "Teste enviado. A notificação deve aparecer em instantes." });
    });
  }

  if (estado === "carregando") {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <Spinner /> Verificando este navegador…
      </div>
    );
  }

  if (estado === "sem-suporte") {
    return (
      <p className="rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-600">
        Este navegador não suporta notificações. Use o Chrome, Edge, Firefox ou Safari
        atualizados.
      </p>
    );
  }

  if (estado === "ios-instalar") {
    return (
      <p className="rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-600">
        No iPhone e no iPad, as notificações só funcionam com o Chroma Flux na Tela de
        Início: toque em <strong>Compartilhar</strong> → <strong>Adicionar à Tela de
        Início</strong>, abra o Chroma Flux pelo ícone criado e volte aqui para ativar.
      </p>
    );
  }

  if (estado === "bloqueado") {
    return (
      <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">
        As notificações foram bloqueadas para este site. Para liberar, clique no ícone de
        cadeado ao lado do endereço (www.chromaflux.com.br), permita as notificações e
        recarregue a página.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {estado === "ativado" ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ok-fg">
              <Bell className="size-4" aria-hidden /> Ativadas neste navegador
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={testar} loading={testando}>
                <Send className="size-4" aria-hidden />
                Enviar teste
              </Button>
              <Button variant="ghost" size="sm" onClick={desativar} disabled={ocupado}>
                <BellOff className="size-4" aria-hidden />
                Desativar
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={ativar} loading={ocupado}>
            <Bell className="size-4" aria-hidden />
            Ativar notificações neste navegador
          </Button>
        )}
      </div>

      <FormError>{erro ?? aviso.erro}</FormError>
      <FormSuccess>{aviso.ok}</FormSuccess>
    </div>
  );
}
