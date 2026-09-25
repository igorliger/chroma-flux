import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    // O lint roda como passo separado no CI (`npm run lint`).
    ignoreDuringBuilds: false,
  },
};

export default nextConfig;
