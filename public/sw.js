/*
 * Service worker do Chroma Flux — só cuida das notificações.
 *
 * Recebe o aviso enviado pela Edge Function `push` (Supabase) e mostra a
 * notificação do sistema operacional, mesmo com o site fechado. Clicar nela
 * abre (ou traz para a frente) o Chroma Flux na tela certa.
 *
 * Não faz cache de nada: o site continua sempre buscando a versão mais nova.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch {
    dados = { body: event.data ? event.data.text() : "" };
  }

  const titulo = dados.title || "Chroma Flux";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: dados.body || "",
      icon: "/logo-chroma-flux-512.png",
      // A mesma `tag` substitui o aviso anterior em vez de empilhar repetidos.
      tag: dados.tag,
      renotify: Boolean(dados.tag),
      data: { url: dados.url || "/espacos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(
    (event.notification.data && event.notification.data.url) || "/espacos",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const janela of janelas) {
        if (janela.url.startsWith(self.location.origin) && "focus" in janela) {
          try {
            await janela.navigate(destino);
          } catch {
            // Algumas janelas não aceitam navegar daqui; só focar já ajuda.
          }
          return janela.focus();
        }
      }
      return self.clients.openWindow(destino);
    })(),
  );
});
