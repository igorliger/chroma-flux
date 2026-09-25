/**
 * Chave pública VAPID do Chroma Flux.
 *
 * É pública por definição: o navegador a usa para saber que só o nosso
 * servidor pode mandar notificações para ele. A chave privada que forma o
 * par fica no Vault do Supabase (`push_vapid_private_key`) e é usada só pela
 * Edge Function `push`. Trocar uma exige trocar a outra — e todo mundo
 * precisaria reativar as notificações.
 */
export const VAPID_PUBLIC_KEY =
  "BKrNWT0rRUvg5VnXvNEUpuwEfKeWDnfRllGHKoh7YA779V08qQ8-s9INoxoLiuKBOPHOf6fmBxCOV5gOcPQUyAA";

/** Converte a chave (base64url) para o formato que `pushManager.subscribe` pede. */
export function vapidKeyBytes(): Uint8Array<ArrayBuffer> {
  const base64 = VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
