import type { Metadata } from "next";
import Link from "next/link";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string; erro?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Entrar na sua conta
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Ainda não tem cadastro?{" "}
          <Link href="/cadastro" className="font-medium text-brand-600 hover:text-brand-700">
            Criar conta
          </Link>
        </p>
      </div>

      <LoginForm next={params.proximo} initialError={params.erro} />
    </>
  );
}
