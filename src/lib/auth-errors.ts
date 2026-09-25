/**
 * Tradução das mensagens do Supabase Auth, que chegam sempre em inglês.
 *
 * Vive fora de `app/actions/auth.ts` porque arquivos `"use server"` só podem
 * exportar funções assíncronas — o que impediria testar esta lógica
 * diretamente. Aqui ela é uma função pura, isolada e verificável.
 *
 * A correspondência é por expressão regular, e não por texto exato, porque
 * várias mensagens embutem dados variáveis: o endereço recusado, o número
 * mínimo de caracteres, os segundos de espera. Uma tabela de igualdade nunca
 * casaria com essas.
 */
const AUTH_ERRORS: [RegExp, string][] = [
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [
    /email not confirmed/i,
    "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.",
  ],
  [
    /user already registered|already been registered/i,
    "Já existe uma conta com este e-mail.",
  ],
  [
    // Ex.: Email address "fulano@dominio.xyz" is invalid
    /email address .* is invalid|unable to validate email address|email_address_invalid/i,
    "O Supabase recusou este endereço de e-mail. Use um domínio real e ativo — " +
      "endereços de teste como @example.com costumam ser bloqueados.",
  ],
  [/password should be at least (\d+)/i, "A senha precisa de pelo menos $1 caracteres."],
  [/signup requires a valid password/i, "Informe uma senha válida."],
  [
    /you can only request this after (\d+) seconds?/i,
    "Por segurança, aguarde $1 segundos antes de tentar novamente.",
  ],
  [
    /rate limit|too many requests/i,
    "Muitas tentativas em pouco tempo. Aguarde alguns minutos.",
  ],
  [/signups not allowed|signup is disabled/i, "O cadastro está desativado neste projeto."],
];

export function translateAuthError(message: string): string {
  for (const [pattern, translation] of AUTH_ERRORS) {
    const match = message.match(pattern);
    if (!match) continue;

    // Devolve a tradução inteira. Nunca `message.replace()`: aquilo trocaria
    // apenas o trecho casado e deixaria sobras em inglês em volta — o bug
    // "email <tradução> exceeded". Os `$1` recebem os grupos capturados.
    return translation.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? "");
  }
  return message;
}
