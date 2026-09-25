"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isConfigError = error.message.includes("Variável de ambiente");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
        {isConfigError ? "Configuração incompleta" : "Algo deu errado"}
      </h1>
      <p className="mt-3 max-w-lg text-sm text-ink-500">
        {isConfigError
          ? "As credenciais do Supabase não foram encontradas. Copie .env.example para .env.local, preencha os valores e reinicie o servidor."
          : "Não foi possível carregar esta página. Tente novamente."}
      </p>
      <Button className="mt-8" onClick={reset}>
        Tentar novamente
      </Button>
    </div>
  );
}
