/**
 * Liberação por dispositivo (migração 0033) — partes que o middleware, as
 * ações e as telas compartilham.
 */

/** Cookie com o id aleatório deste navegador. */
export const DEVICE_COOKIE = "cf_device";

/**
 * Nome legível do dispositivo para o administrador reconhecer o pedido:
 * "Chrome no Windows", "Safari no iPhone". Só o tipo de navegador e de
 * sistema — nada que identifique a pessoa.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";

  const navegador = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Navegador";

  const sistema = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "";

  return sistema ? `${navegador} no ${sistema}` : navegador;
}
