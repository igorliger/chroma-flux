"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui";

/** Falha ao carregar "Minhas tarefas": explica e oferece tentar de novo. */
export default function ErroMinhasTarefas({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div data-visual="flux" className="flux-backdrop flex min-h-screen items-center justify-center px-6">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-8 text-center flux-shadow">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-danger-bg text-danger-fg">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-ink-900">Não foi possível carregar suas tarefas</h1>
        <p className="mt-2 text-sm text-ink-500">
          Pode ter sido uma falha de conexão. Suas tarefas continuam salvas.
        </p>
        <Button
          className="mt-6 rounded-xl"
          loading={pending}
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
        >
          {!pending && <RotateCw className="size-4" aria-hidden />}
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
