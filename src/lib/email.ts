import { Resend } from "resend";

import { getSiteUrl } from "@/lib/env";

/**
 * Envio de e-mails transacionais (hoje só o convite de espaço de trabalho).
 *
 * Sem `RESEND_API_KEY` configurada, o convite continua sendo registrado no
 * banco normalmente — só o e-mail não sai. Isso evita que quem ainda não
 * configurou o Resend fique impedido de convidar gente: a pessoa convidada
 * só não recebe aviso, mas o convite aparece do mesmo jeito quando ela entra
 * no Chroma Flux com aquele e-mail.
 */
function getResendClient(): Resend | null {
  // `trim()`: ao colar a chave no painel da Vercel é comum vir junto um
  // espaço ou quebra de linha — o Resend recusaria a chave inteira por isso.
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

/**
 * Remetente do e-mail. Por padrão usa o domínio próprio `chromaflux.com.br`,
 * já verificado no Resend — assim o convite chega a qualquer pessoa.
 * `RESEND_FROM_EMAIL` só é necessária para trocar esse endereço.
 */
function getFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "Chroma Flux <convites@chromaflux.com.br>";
}

export type SendInviteEmailResult = { sent: boolean; error?: string };

/**
 * Envia o e-mail de convite para um espaço de trabalho.
 *
 * O link aponta para a raiz do site: não existe token de convite por link —
 * o convite é resolvido pelo e-mail da conta, então basta a pessoa entrar (ou
 * se cadastrar) no Chroma Flux com este mesmo endereço para vê-lo em
 * "Espaços de trabalho".
 */
export async function sendWorkspaceInviteEmail(params: {
  to: string;
  workspaceName: string;
  inviterName: string;
  roleLabel: string;
}): Promise<SendInviteEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    console.error("[convite] e-mail não enviado: RESEND_API_KEY não configurada.");
    return { sent: false, error: "chave do Resend não configurada no servidor" };
  }

  const siteUrl = getSiteUrl();
  const { to, workspaceName, inviterName, roleLabel } = params;

  let error: { message: string; name?: string } | null = null;
  try {
    ({ error } = await resend.emails.send({
    from: getFromAddress(),
    to,
    subject: `${inviterName} convidou você para o espaço "${workspaceName}" no Chroma Flux`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2530;">
        <h1 style="font-size: 20px; margin-bottom: 8px;">Você foi convidado para o Chroma Flux</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #4b5566;">
          <strong>${inviterName}</strong> convidou você para participar do espaço de trabalho
          <strong>${workspaceName}</strong> como <strong>${roleLabel}</strong>.
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #4b5566;">
          Entre (ou crie sua conta) no Chroma Flux com o e-mail <strong>${to}</strong> para
          ver e aceitar o convite.
        </p>
        <a
          href="${siteUrl}/espacos"
          style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #7c5cff; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;"
        >
          Abrir Chroma Flux
        </a>
        <p style="font-size: 12px; color: #9aa2b1; margin-top: 24px;">
          Se você não esperava este convite, pode ignorar este e-mail.
        </p>
      </div>
    `,
    }));
  } catch (e) {
    // Falha antes da resposta (rede, cabeçalho inválido): sem isto, a exceção
    // derrubaria a action inteira depois de o convite já ter sido gravado.
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  if (error) {
    // Aparece em Logs na Vercel — é o único lugar onde dá para ver o motivo
    // real sem acesso ao servidor.
    console.error("[convite] Resend recusou o envio:", error.name ?? "", error.message);
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

/**
 * Convite para a equipe (tela "Equipe"). Enviado uma vez só por pessoa: os
 * espaços em que ela entra são decididos depois, sem novo e-mail.
 */
export async function sendTeamInviteEmail(params: {
  to: string;
  inviterName: string;
  workspaceNames: string[];
  invitationId: string;
}): Promise<SendInviteEmailResult> {
  const resend = getResendClient();
  if (!resend) {
    console.error("[convite] e-mail não enviado: RESEND_API_KEY não configurada.");
    return { sent: false, error: "chave do Resend não configurada no servidor" };
  }

  const siteUrl = getSiteUrl();
  const { to, inviterName, workspaceNames, invitationId } = params;
  const espacos = workspaceNames.length
    ? `<p style="font-size: 14px; line-height: 1.6; color: #4b5566;">Você já terá acesso a: <strong>${workspaceNames.join(", ")}</strong>.</p>`
    : "";

  let error: { message: string; name?: string } | null = null;
  try {
    ({ error } = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject: `${inviterName} convidou você para a equipe no Chroma Flux`,
      html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2530;">
        <h1 style="font-size: 20px; margin-bottom: 8px;">Você foi convidado para o Chroma Flux</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #4b5566;">
          <strong>${inviterName}</strong> convidou você para fazer parte da equipe no Chroma Flux.
        </p>
        ${espacos}
        <p style="font-size: 14px; line-height: 1.6; color: #4b5566;">
          É só clicar no botão abaixo — sem cadastro e sem senha.
        </p>
        <a
          href="${siteUrl}/convite/${invitationId}"
          style="display: inline-block; margin-top: 16px; padding: 10px 20px; background: #7c5cff; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;"
        >
          Entrar no Chroma Flux
        </a>
        <p style="font-size: 12px; color: #9aa2b1; margin-top: 24px;">
          Se você não esperava este convite, pode ignorar este e-mail.
        </p>
      </div>
    `,
    }));
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  if (error) {
    console.error("[convite] Resend recusou o envio:", error.name ?? "", error.message);
    return { sent: false, error: error.message };
  }
  return { sent: true };
}

/** Código de 6 dígitos para alterar a senha (Configurações). */
export async function sendPasswordCodeEmail(params: {
  to: string;
  code: string;
}): Promise<SendInviteEmailResult> {
  const resend = getResendClient();
  if (!resend) return { sent: false, error: "chave do Resend não configurada no servidor" };

  let error: { message: string; name?: string } | null = null;
  try {
    ({ error } = await resend.emails.send({
      from: getFromAddress(),
      to: params.to,
      subject: `${params.code} é o seu código para alterar a senha do Chroma Flux`,
      html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2530;">
        <h1 style="font-size: 20px; margin-bottom: 8px;">Código para alterar a senha</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #4b5566;">
          Use este código em Configurações → Alterar senha. Ele vale por 10 minutos.
        </p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; margin: 24px 0; color: #1f2530;">
          ${params.code}
        </p>
        <p style="font-size: 12px; color: #9aa2b1;">
          Não pediu para trocar a senha? Ignore este e-mail — sem o código, nada muda. Se
          isso se repetir, troque sua senha: alguém pode ter acesso à sua conta.
        </p>
      </div>
    `,
    }));
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) };
  }

  if (error) {
    console.error("[senha] Resend recusou o envio:", error.name ?? "", error.message);
    return { sent: false, error: error.message };
  }
  return { sent: true };
}
