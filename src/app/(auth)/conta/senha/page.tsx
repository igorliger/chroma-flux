import type { Metadata } from "next";

import { SenhaForm } from "./senha-form";

export const metadata: Metadata = { title: "Senha" };

/** `?primeiro=1`: primeira entrada pelo convite — criar senha é opcional. */
export default async function NewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ primeiro?: string }>;
}) {
  const { primeiro } = await searchParams;
  return <SenhaForm primeiro={primeiro === "1"} />;
}
