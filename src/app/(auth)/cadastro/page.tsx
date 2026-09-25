import type { Metadata } from "next";
import Link from "next/link";

import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Criar conta" };

export default function SignUpPage() {
  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Criar sua conta
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Já tem cadastro?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Entrar
          </Link>
        </p>
      </div>

      <SignUpForm />
    </>
  );
}
