import type { NextConfig } from "next";

// Cabeçalhos de segurança em todas as respostas. Ficam aqui (e não só no
// vercel.json) para valer igual na Vercel e na VPS.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * Marca de cada build. Fica gravada no código do navegador e no da rota
 * `/api/versao`: quando as duas deixam de bater, saiu versão nova e a aba
 * aberta precisa recarregar — os botões dela chamam ações que o servidor
 * novo não conhece mais ("Failed to find Server Action").
 */
// Calculada uma vez e guardada no ambiente: o build roda em vários processos,
// e cada um carrega este arquivo de novo — sem isso, cada parte do site
// ganharia uma marca diferente.
process.env.NEXT_PUBLIC_VERSAO ||= new Date().toISOString();
const VERSAO = process.env.NEXT_PUBLIC_VERSAO;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_VERSAO: VERSAO },
  poweredByHeader: false,
  eslint: {
    // O lint roda como passo separado no CI (`npm run lint`).
    ignoreDuringBuilds: false,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
