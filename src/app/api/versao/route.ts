/**
 * Versão publicada no servidor agora. O `AvisoDeVersao` compara com a versão
 * que a aba carregou para saber quando recarregar.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { versao: process.env.NEXT_PUBLIC_VERSAO ?? "" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
