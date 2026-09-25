import { requireUser } from "@/lib/queries";

/**
 * Portaria de todas as telas autenticadas.
 *
 * `requireUser()` cuida dos dois desvios possíveis: falta de configuração
 * (manda para `/`, que mostra as instruções) e falta de sessão (manda para
 * `/login`). O middleware já barra visitantes, mas repetir a checagem aqui
 * garante que nenhuma página autenticada renderize sem sessão mesmo que a
 * `matcher` do middleware mude no futuro.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <>{children}</>;
}
