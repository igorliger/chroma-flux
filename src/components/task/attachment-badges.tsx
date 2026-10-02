import { Image as ImageIcon, Paperclip } from "lucide-react";

/**
 * Selos "Contém N imagens" e "Contém N anexos" das listas de tarefas.
 * Imagens (image/*) ganham selo próprio; "anexos" conta só os demais
 * arquivos, para nenhum arquivo aparecer duas vezes. Os números vêm das
 * views (migração 0032); sem eles, nada aparece.
 */
export function AttachmentBadges({ total, images }: { total?: number; images?: number }) {
  const imagens = images ?? 0;
  const outros = Math.max(0, (total ?? 0) - imagens);

  return (
    <>
      {imagens > 0 && (
        <span className="inline-flex items-center gap-1 font-medium text-warn-fg">
          <ImageIcon className="size-3.5" aria-hidden />
          Contém {imagens} {imagens === 1 ? "imagem" : "imagens"}
        </span>
      )}
      {outros > 0 && (
        <span className="inline-flex items-center gap-1 font-medium text-info-fg">
          <Paperclip className="size-3.5" aria-hidden />
          Contém {outros} {outros === 1 ? "anexo" : "anexos"}
        </span>
      )}
    </>
  );
}
