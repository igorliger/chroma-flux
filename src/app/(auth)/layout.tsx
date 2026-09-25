import Link from "next/link";

import { AuthIllustration } from "@/components/auth-illustration";
import { Wordmark } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      {/* Formulário */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-flex">
            <Wordmark />
          </Link>
          {children}
        </div>

        {/* Rodapé discreto: dá acabamento à coluna e evita que o formulário
            pareça solto no meio do branco. */}
        <p className="mx-auto mt-12 w-full max-w-sm text-xs text-ink-400">
          Chroma Flux — gerenciamento de projetos.
        </p>
      </div>

      {/*
        Painel de marca. Some no celular: ali a tela inteira é do formulário,
        e uma ilustração de 400px empurraria os campos para fora da dobra.
      */}
      <div className="relative hidden overflow-hidden bg-brand-700 lg:block">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 20%, var(--color-brand-400) 0, transparent 45%), " +
              "radial-gradient(circle at 75% 75%, var(--color-brand-900) 0, transparent 50%)",
          }}
          aria-hidden
        />

        {/* Malha fina por cima do degradê — dá textura e tira o ar de fundo
            chapado, sem competir com a ilustração. */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), " +
              "linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
          aria-hidden
        />

        <div className="relative flex h-full flex-col justify-center gap-12 p-12 xl:p-16">
          <AuthIllustration className="w-full max-w-xl drop-shadow-2xl" />

          <blockquote className="max-w-lg">
            <p className="text-2xl font-semibold leading-snug text-white xl:text-3xl">
              Cada equipe no seu espaço. Cada tarefa no seu lugar.
            </p>
            <p className="mt-4 text-brand-100">
              Espaços de trabalho isolados, responsáveis, prazos e comentários — tudo
              em um único lugar, no computador ou no celular.
            </p>
          </blockquote>
        </div>
      </div>
    </div>
  );
}
