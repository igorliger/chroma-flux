import type { Metadata, Viewport } from "next";

import { themeScript } from "@/components/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Chroma Flux — gerenciamento de projetos",
    template: "%s · Chroma Flux",
  },
  description:
    "Organize as tarefas da sua equipe em espaços de trabalho isolados e colaborativos.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/*
          Roda antes de qualquer CSS pintar. Sem isso, a página nasceria clara
          e escureceria após a montagem do React — o clarão branco. Por rodar
          antes da hidratação, ele altera o `<html>`, e é por isso que o
          elemento leva `suppressHydrationWarning`.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
