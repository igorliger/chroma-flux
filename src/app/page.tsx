import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { redirect } from "next/navigation";

import { Benefits } from "@/components/marketing/benefits";
import { FeaturesGrid } from "@/components/marketing/features-grid";
import { MarketingFooter } from "@/components/marketing/footer";
import { MarketingHeader } from "@/components/marketing/header";
import { Hero } from "@/components/marketing/hero";
import { TaskListSnippet, TeamSnippet } from "@/components/marketing/interface-snippets";
import { MobileSection } from "@/components/marketing/mobile-section";
import { SplitSection } from "@/components/marketing/split-section";
import { SetupNotice } from "@/components/setup-notice";
import { getSiteUrl, isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

// Só esta página usa Inter — o resto do app continua na fonte do sistema
// (`globals.css`). `next/font` a auto-hospeda: sem requisição externa, sem
// atraso de carregamento.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"] });

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "Chroma Flux | Gestão de Tarefas e Equipes",
  description:
    "Organize tarefas, prazos e processos da sua empresa em um único lugar com o Chroma Flux.",
  alternates: { canonical: "https://www.chromaflux.com.br" },
  openGraph: {
    title: "Chroma Flux | Gestão de Tarefas e Equipes",
    description:
      "Organize tarefas, prazos e processos da sua empresa em um único lugar com o Chroma Flux.",
    url: "https://www.chromaflux.com.br",
    siteName: "Chroma Flux",
    locale: "pt_BR",
    type: "website",
    images: [{ url: "/logo-chroma-flux-512.png", width: 1160, height: 668 }],
  },
  twitter: {
    card: "summary",
    title: "Chroma Flux | Gestão de Tarefas e Equipes",
    description:
      "Organize tarefas, prazos e processos da sua empresa em um único lugar com o Chroma Flux.",
    images: ["/logo-chroma-flux-512.png"],
  },
};

/**
 * Landing pública. Continua checando configuração e sessão antes de
 * qualquer coisa — o redesenho é só do que vem depois disso.
 */
export default async function LandingPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const user = await getCurrentUser();
  if (user) redirect("/espacos");

  return (
    // `overflow-x-clip`: os brilhos decorativos do fundo (hero, split-section)
    // de propósito sangram para fora da própria seção — sem isto, esse
    // sangramento vira scroll horizontal, mesmo sendo só efeito visual.
    <div className={`${inter.className} overflow-x-clip bg-[#090a0f]`}>
      <MarketingHeader />
      <main>
        <Hero />
        <Benefits />
        <FeaturesGrid />
        <SplitSection
          eyebrow="Produtividade"
          title={
            <>
              Menos tempo organizando.
              <br />
              Mais tempo fazendo.
            </>
          }
          description="Tenha clareza sobre o que precisa ser feito, quem é responsável e quais são os próximos prazos."
          visual={<TaskListSnippet />}
        />
        <SplitSection
          id="equipe"
          eyebrow="Equipe"
          title="Todos sabem o que precisa ser feito."
          description="Responsáveis, status e comentários de cada tarefa, visíveis para quem precisa — sem planilha paralela nem grupo de mensagem perdido."
          visual={<TeamSnippet />}
          reverse
        />
        <MobileSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
