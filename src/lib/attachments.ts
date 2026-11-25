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

/**
 * Mesma ideia de `buildStoragePath`, para lembretes pessoais (migração 0030):
 * a primeira pasta é o literal `pessoal`, e a segunda é o dono — não há
 * workspace para as policies do Storage checarem.
 */
export function buildPersonalStoragePath(
  ownerId: string,
  taskId: string,
  fileName: string,
): string {
  return `pessoal/${ownerId}/${taskId}/${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;
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

/**
 * Arquivos colados (Ctrl+V / colar do celular) — normalmente um print ou uma
 * foto copiada. A área de transferência dá a todos o mesmo nome ("image.png"),
 * então cada um ganha um nome com data e hora para não confundir na lista.
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const arquivos = Array.from(data.files ?? []);
  if (arquivos.length === 0) {
    for (const item of Array.from(data.items ?? [])) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) arquivos.push(f);
      }
    }
  }
  const agora = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const carimbo = `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  return arquivos.map((f, i) => {
    if (!/^image\.(png|jpe?g|gif|webp)$/i.test(f.name)) return f;
    const ext = f.name.split(".").pop() ?? "png";
    const sufixo = arquivos.length > 1 ? `-${i + 1}` : "";
    return new File([f], `imagem-colada-${carimbo}${sufixo}.${ext}`, { type: f.type, lastModified: f.lastModified });
  });
}

/**
 * Imagem colada maior que o limite (comum em print de tela inteira ou foto do
 * celular): redesenha em JPEG, com no máximo 2560 px no lado maior, até caber.
 * O que não é imagem, ou já cabe, passa como está — o limite continua valendo.
 */
export async function shrinkPastedImages(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (f) => {
      if (f.size <= MAX_ATTACHMENT_BYTES || !f.type.startsWith("image/") || f.type === "image/gif") return f;
      try {
        const bitmap = await createImageBitmap(f);
        let escala = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
        for (let tentativa = 0; tentativa < 4; tentativa++) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(bitmap.width * escala);
          canvas.height = Math.round(bitmap.height * escala);
          canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
          if (blob && blob.size <= MAX_ATTACHMENT_BYTES) {
            return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
          }
          escala *= 0.75;
        }
      } catch {
        // Navegador sem suporte: segue o arquivo original (e o limite avisa).
      }
      return f;
    }),
  );
}
