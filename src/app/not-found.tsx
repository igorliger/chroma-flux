import Link from "next/link";

import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Wordmark className="mb-8" />
      <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
        Página não encontrada
      </h1>
      <p className="mt-3 max-w-md text-ink-500">
        O endereço não existe ou você não tem acesso a este conteúdo.
      </p>
      <Link href="/espacos" className="mt-8">
        <Button size="lg">Voltar aos espaços de trabalho</Button>
      </Link>
    </div>
  );
}
