import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, ListFilter, ShieldCheck, Users } from "lucide-react";

import { Wordmark } from "@/components/logo";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser } from "@/lib/supabase/server";

const FEATURES = [
  {
    icon: ListFilter,
    title: "Busca e filtros",
    text: "Encontre por responsável, prioridade, prazo ou pelo texto da tarefa.",
  },
  {
    icon: Users,
    title: "Espaços de trabalho",
    text: "Cada equipe no seu espaço, com papéis e permissões independentes.",
  },
  {
    icon: CheckCircle2,
    title: "Tarefas e subtarefas",
    text: "Responsável, prioridade, prazo e comentários em cada item.",
  },
  {
    icon: ShieldCheck,
    title: "Isolamento real",
    text: "Row Level Security no banco: ninguém enxerga dados de outro espaço.",
  },
];

export default async function LandingPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const user = await getCurrentUser();
  if (user) redirect("/espacos");

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost">Entrar</Button>
          </Link>
          <Link href="/cadastro">
            <Button>Criar conta</Button>
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-16 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
            O trabalho da sua equipe, organizado em{" "}
            <span className="text-brand-600">um lugar só</span>.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-ink-600">
            Espaços de trabalho, tarefas, prazos e comentários. Simples de usar no
            computador e no celular.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/cadastro">
              <Button size="lg">Começar agora</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">
                Já tenho conta
              </Button>
            </Link>
          </div>
        </section>

        <section className="grid gap-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div
              key={title}
              className="rounded-[--radius-card] border border-ink-200 bg-surface p-6 shadow-sm"
            >
              <Icon className="size-6 text-brand-600" aria-hidden />
              <h2 className="mt-4 font-semibold text-ink-900">{title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-ink-200 py-8">
        <p className="mx-auto max-w-6xl px-6 text-sm text-ink-400">
          Chroma Flux — gerenciamento de projetos.
        </p>
      </footer>
    </div>
  );
}
