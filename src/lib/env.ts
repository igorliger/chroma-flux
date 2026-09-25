/**
 * Leitura centralizada das variáveis de ambiente.
 *
 * Nenhum segredo é embutido no código: os valores vêm de `.env.local` no
 * desenvolvimento e das Environment Variables do projeto na Vercel. Falhar
 * cedo e com mensagem clara é melhor do que um erro obscuro de rede depois.
 */

/** Valores de exemplo do `.env.example` — presentes, mas não configurados. */
const PLACEHOLDERS = [
  "COLE_A_URL_AQUI",
  "COLE_A_CHAVE_AQUI",
  "sua-anon-key-aqui",
  "sua-publishable-key-aqui",
];

function isPlaceholder(value: string) {
  return PLACEHOLDERS.includes(value) || value.startsWith("https://SEU-PROJETO");
}

function required(name: string, value: string | undefined): string {
  if (!value || isPlaceholder(value)) {
    throw new Error(
      `Variável de ambiente ausente ou não configurada: ${name}. ` +
        `Copie .env.example para .env.local e preencha com os dados do seu projeto Supabase.`,
    );
  }
  return value;
}

export function getSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Chave pública do projeto — a que o navegador usa.
 *
 * O Supabase renomeou essas chaves: `sb_publishable_...` substitui a antiga
 * `anon` key (e `sb_secret_...` substitui a `service_role`, que este projeto
 * não usa em lugar nenhum). As duas funcionam na mesma posição da chamada, e a
 * publishable é a que aparece hoje em Project Settings → API.
 *
 * Aceitamos os dois nomes para que o projeto funcione tanto em contas novas
 * quanto em projetos criados antes da mudança. A publishable tem precedência.
 *
 * Ser pública é intencional: quem protege os dados é a Row Level Security, não
 * o sigilo da chave.
 */
export function getSupabasePublishableKey(): string {
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (publishable && !isPlaceholder(publishable)) return publishable;

  return required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * `true` quando as credenciais já foram preenchidas.
 *
 * Serve para o app mostrar uma tela de configuração em vez de estourar um
 * erro de rede opaco em cada requisição enquanto o Supabase não foi ligado.
 */
export function isSupabaseConfigured(): boolean {
  try {
    getSupabaseUrl();
    getSupabasePublishableKey();
    return true;
  } catch {
    return false;
  }
}

/** URL pública da aplicação, usada nos links de confirmação de e-mail. */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  // A Vercel injeta VERCEL_URL automaticamente em cada deploy.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
