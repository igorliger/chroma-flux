import type { NextConfig } from "next";

// Cabeçalhos de segurança em todas as respostas. Ficam aqui (e não só no
// vercel.json) para valer igual na Vercel e na VPS.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
