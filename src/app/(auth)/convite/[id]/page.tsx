import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { QuickLoginForm } from "./quick-login-form";

export const metadata: Metadata = { title: "Convite" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Para onde leva o botão do e-mail de convite. Mostra quem convidou e para
 * quais espaços, com o e-mail já preenchido e um botão de entrada rápida —
 * quem foi convidado não precisa passar pelo cadastro.
 */
export default async function ConvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const convite = UUID.test(id)
    ? ((await supabase.rpc("team_invite_preview", { p_id: id })).data ?? [])[0]
    : undefined;

  if (!convite) {
    return (
      <Aviso titulo="Convite não encontrado">
        O link pode estar incompleto. Peça um novo convite a quem convidou você, ou{" "}
        <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
          entre com sua senha
        </Link>
        .
      </Aviso>
    );
  }

  // Já está logado com o e-mail do convite: é só entrar.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email?.toLowerCase() === convite.email) redirect("/espacos");

  if (!convite.valid) {
    return (
      <Aviso titulo="Este convite já foi usado">
        Você já entrou no Chroma Flux por ele. Agora é só{" "}
        <Link
          href={`/login?email=${encodeURIComponent(convite.email)}`}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          entrar com seu e-mail e senha
        </Link>
        {" "}— ou use “Esqueci minha senha” se ainda não criou uma.
      </Aviso>
    );
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Você foi convidado!
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          <strong className="text-ink-800">{convite.inviter_name}</strong> convidou você para a
          equipe no Chroma Flux
          {convite.workspace_names.length > 0 && (
            <>
              {" "}
              — espaços: <strong className="text-ink-800">{convite.workspace_names.join(", ")}</strong>
            </>
          )}
          .
        </p>
      </div>

      <QuickLoginForm invitationId={id} email={convite.email} />

      <p className="mt-6 text-center text-sm text-ink-500">
        Já tem senha?{" "}
        <Link
          href={`/login?email=${encodeURIComponent(convite.email)}`}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          Entrar com senha
        </Link>
      </p>
    </>
  );
}

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{titulo}</h1>
      <p className="mt-2 text-sm text-ink-500">{children}</p>
    </div>
  );
}
