import { Wordmark } from "@/components/logo";

/**
 * Exibida quando `.env.local` ainda não tem as credenciais do Supabase.
 * Sem isso, a primeira execução falharia com um erro de rede sem explicação.
 */
export function SetupNotice() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl">
        <Wordmark className="mb-8" />

        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          Falta conectar o Supabase
        </h1>
        <p className="mt-3 text-ink-600">
          A aplicação está rodando, mas ainda não sabe com qual banco falar. Siga os
          três passos abaixo:
        </p>

        <ol className="mt-6 space-y-4">
          <Step number={1} title="Crie um projeto no Supabase">
            Em{" "}
            <a
              href="https://supabase.com/dashboard"
              className="font-medium text-brand-600 underline underline-offset-2"
              target="_blank"
              rel="noreferrer noopener"
            >
              supabase.com/dashboard
            </a>
            , crie um projeto e abra <strong>Connect</strong> ou{" "}
            <strong>Project Settings → API</strong>.
          </Step>

          <Step number={2} title="Preencha o .env.local">
            Copie a <em>Project URL</em> e a <em>publishable key</em> para as variáveis{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">
              NEXT_PUBLIC_SUPABASE_URL
            </code>{" "}
            e{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            </code>
            . A <em>secret key</em> e a senha do banco não são usadas por esta
            aplicação e não devem entrar no repositório.
          </Step>

          <Step number={3} title="Crie o banco">
            No <strong>SQL Editor</strong> do Supabase, cole e execute o arquivo{" "}
            <code className="rounded bg-ink-100 px-1 py-0.5 text-xs">
              supabase/schema.sql
            </code>
            . Ele cria tabelas, índices, gatilhos e as políticas de Row Level
            Security de uma vez.
          </Step>
        </ol>

        <p className="mt-6 rounded-lg bg-ink-100 px-4 py-3 text-sm text-ink-600">
          Depois reinicie o servidor: as variáveis <code>NEXT_PUBLIC_*</code> são lidas
          na inicialização.
        </p>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
        {number}
      </span>
      <div>
        <h2 className="font-medium text-ink-900">{title}</h2>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-600">{children}</p>
      </div>
    </li>
  );
}
