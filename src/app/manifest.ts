import type { MetadataRoute } from "next";

/**
 * Manifest do app instalável (PWA).
 *
 * Além do atalho na tela inicial, é o que permite notificações no iPhone e
 * iPad: lá o Safari só entrega notificações a sites adicionados à Tela de
 * Início (iOS 16.4 ou mais novo).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chroma Flux",
    short_name: "Chroma Flux",
    description: "Gerenciamento de tarefas da equipe.",
    lang: "pt-BR",
    start_url: "/espacos",
    scope: "/",
    display: "standalone",
    background_color: "#111318",
    theme_color: "#4f46e5",
    icons: [
      {
        src: "/logo-chroma-flux-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
