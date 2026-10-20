/** Versão com que esta aba foi carregada (gravada no build, ver next.config). */
export const VERSAO_CARREGADA = process.env.NEXT_PUBLIC_VERSAO ?? "";

/**
 * Erro de quando a aba é de uma versão anterior à publicada: as ações do
 * servidor mudam de identificador a cada build, e o servidor novo responde
 * que não conhece a ação chamada.
 */
export function isVersaoAntiga(erro: unknown) {
  const msg =
    erro instanceof Error ? `${erro.name} ${erro.message}` : typeof erro === "string" ? erro : "";
  return /failed-to-find-server-action|UnrecognizedActionError|was not found on the server/i.test(msg);
}

/**
 * Recarrega a página — no máximo uma vez a cada 30 s, para nunca virar laço
 * se o erro voltar logo depois.
 */
export function recarregarParaVersaoNova() {
  try {
    const ultima = Number(sessionStorage.getItem("cf-recarga") ?? 0);
    if (Date.now() - ultima < 30_000) return false;
    sessionStorage.setItem("cf-recarga", String(Date.now()));
  } catch {
    // Sem sessionStorage (aba privada): recarrega assim mesmo.
  }
  window.location.reload();
  return true;
}
