"use client";

import { useCallback, useEffect, useState } from "react";

import {
  registerPushSubscriptionAction,
  unregisterPushSubscriptionAction,
} from "@/app/actions/push";
import { vapidKeyBytes } from "@/lib/push";

export type PushEstado =
  | "carregando"
  | "sem-suporte" // navegador sem Web Push
  | "ios-instalar" // iPhone/iPad fora do app instalado: só funciona pela Tela de Início
  | "bloqueado" // a pessoa negou a permissão; só dá para reverter no navegador
  | "desativado"
  | "ativado";

function ehIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPad recente se apresenta como Mac, mas tem tela de toque.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function rodandoInstalado() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function salvar(assinatura: PushSubscription) {
  const json = assinatura.toJSON();
  return registerPushSubscriptionAction({
    endpoint: assinatura.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    userAgent: navigator.userAgent,
  });
}

/**
 * Estado e ações das notificações neste navegador. Usado pelo cartão em
 * Configurações e pelo aviso "Ativar notificações" no topo das telas.
 */
export function usePushNotifications() {
  const [estado, setEstado] = useState<PushEstado>("carregando");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      const temSuporte =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      if (!temSuporte) {
        setEstado(ehIOS() && !rodandoInstalado() ? "ios-instalar" : "sem-suporte");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("bloqueado");
        return;
      }

      try {
        const registro = await navigator.serviceWorker.register("/sw.js");
        const atual = await registro.pushManager.getSubscription();
        if (cancelado) return;

        if (atual && Notification.permission === "granted") {
          // Regrava a cada visita: se outra pessoa entrou neste computador,
          // os avisos passam a ir para quem está logado agora.
          await salvar(atual);
          if (!cancelado) setEstado("ativado");
        } else {
          setEstado("desativado");
        }
      } catch {
        if (!cancelado) setEstado("sem-suporte");
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const ativar = useCallback(async () => {
    setErro(null);
    setOcupado(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setEstado(permissao === "denied" ? "bloqueado" : "desativado");
        return;
      }

      const registro = await navigator.serviceWorker.ready;
      const assinatura =
        (await registro.pushManager.getSubscription()) ??
        (await registro.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(),
        }));

      const resultado = await salvar(assinatura);
      if (resultado.error) {
        setErro(resultado.error);
        return;
      }
      setEstado("ativado");
    } catch {
      setErro("Não foi possível ativar as notificações neste navegador.");
    } finally {
      setOcupado(false);
    }
  }, []);

  const desativar = useCallback(async () => {
    setErro(null);
    setOcupado(true);
    try {
      const registro = await navigator.serviceWorker.ready;
      const assinatura = await registro.pushManager.getSubscription();
      if (assinatura) {
        await unregisterPushSubscriptionAction(assinatura.endpoint);
        await assinatura.unsubscribe();
      }
      setEstado("desativado");
    } catch {
      setErro("Não foi possível desativar as notificações.");
    } finally {
      setOcupado(false);
    }
  }, []);

  return { estado, erro, ocupado, ativar, desativar };
}
