/**
 * Regras e utilitários de anexos, compartilhados entre navegador e servidor.
 */

/**
 * 3 MB — o mesmo limite do bucket do Storage e da restrição da tabela.
 *
 * Os três precisam concordar. Se este valor for maior, o arquivo passa pela
 * validação da tela e é recusado depois pelo servidor, com uma mensagem bem
 * pior do que a daqui.
 */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export const BUCKET = "anexos";

/** Formata bytes de forma legível: 1,4 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(".", ",")} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} MB`;
}

export function isImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

/**
 * Nome de arquivo seguro para compor o caminho no Storage.
 *
 * O Storage rejeita vários caracteres, e acentos viram sequências ilegíveis na
 * URL. O nome original fica guardado na tabela e é o que aparece na tela — a
 * higienização vale só para o caminho físico.
 */
// U+0300–U+036F: sinais diacríticos combinantes, escritos em escape para o
// arquivo não depender de caracteres invisíveis no código-fonte.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

export function sanitizeFileName(nome: string): string {
  const limpo = nome
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-120);

  return limpo || "arquivo";
}

/**
 * Monta o caminho do arquivo.
 *
 * A primeira pasta é sempre o workspace: as policies do Storage extraem esse
 * id do caminho para decidir o acesso. O uuid no nome evita colisão entre dois
 * envios do mesmo arquivo e impede adivinhar o endereço de um anexo alheio.
 */
export function buildStoragePath(
  workspaceId: string,
  taskId: string,
  fileName: string,
): string {
  return `${workspaceId}/${taskId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
}

/** Mensagem de recusa, ou `null` se o arquivo passa. */
export function validateFile(file: File): string | null {
  if (file.size === 0) return `“${file.name}” está vazio.`;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `“${file.name}” tem ${formatBytes(file.size)} — o limite é ${formatBytes(
      MAX_ATTACHMENT_BYTES,
    )}.`;
  }
  return null;
}
