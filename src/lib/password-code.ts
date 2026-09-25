// Só para uso no servidor (Server Actions): depende de node:crypto e da chave do Resend.
import { createHmac, randomInt } from "node:crypto";

/**
 * Código de 6 dígitos para alterar a senha (ver migração 0026).
 *
 * O banco guarda só o HMAC do código, calculado aqui com um segredo que só o
 * servidor tem — derivado da chave do Resend, que já existe só no servidor e
 * é o próprio canal por onde o código viaja. Sem o segredo, ninguém consegue
 * gravar um HMAC de um código que escolheu, mesmo chamando a API direto.
 */
function segredo(): string {
  const chave = process.env.RESEND_API_KEY?.trim();
  if (!chave) throw new Error("RESEND_API_KEY não configurada.");
  return `chroma-flux:alterar-senha:${chave}`;
}

export function gerarCodigo(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hmacDoCodigo(userId: string, codigo: string): string {
  return createHmac("sha256", segredo()).update(`${userId}:${codigo}`).digest("hex");
}

