"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { requestDeviceAction } from "@/app/actions/devices";
import { Button, FormError } from "@/components/ui";

export function RequestDeviceButton({ reenviar }: { reenviar: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <FormError>{erro}</FormError>
      <Button
        className="w-full"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await requestDeviceAction();
            setErro(r.error ?? null);
            if (!r.error) router.refresh();
          })
        }
      >
        {reenviar ? "Pedir liberação de novo" : "Pedir liberação ao administrador"}
      </Button>
    </div>
  );
}
