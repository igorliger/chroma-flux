"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { createWorkspaceAction, type ActionState } from "@/app/actions/workspaces";
import { Button, Field, FormError, Input, Modal, SubmitButton, Textarea } from "@/components/ui";
import { ACCENT_COLORS, cn } from "@/lib/utils";

export function NewWorkspaceButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState("indigo");
  const [state, formAction] = useActionState<ActionState, FormData>(createWorkspaceAction, {});

  const params = useSearchParams();
  const router = useRouter();

  // "Novo espaço" no seletor da barra lateral leva para cá com `?novo=1`.
  // Sem isto o link chegaria à lista e não abriria nada, e a opção pareceria
  // quebrada. O parâmetro é retirado da URL em seguida, para um F5 não
  // reabrir o diálogo.
  useEffect(() => {
    if (params.get("novo") === "1") {
      setOpen(true);
      router.replace("/espacos", { scroll: false });
    }
  }, [params, router]);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Novo espaço
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo espaço de trabalho"
        description="Cada espaço tem suas próprias tarefas, membros e permissões."
      >
        <form action={formAction} className="space-y-4">
          <FormError>{state.error}</FormError>
          <input type="hidden" name="color" value={color} />

          <Field label="Nome" htmlFor="ws-name">
            <Input
              id="ws-name"
              name="name"
              placeholder="Equipe de Produto"
              maxLength={80}
              required
              autoFocus
            />
          </Field>

          <Field label="Descrição" htmlFor="ws-description" hint="Opcional.">
            <Textarea
              id="ws-description"
              name="description"
              rows={3}
              maxLength={300}
              placeholder="Do que este espaço trata?"
            />
          </Field>

          <Field label="Cor">
            <div className="flex flex-wrap gap-2">
              {ACCENT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  aria-label={c.label}
                  aria-pressed={color === c.value}
                  onClick={() => setColor(c.value)}
                  className={cn(
                    "size-8 rounded-full transition-transform",
                    c.className,
                    color === c.value
                      ? "ring-2 ring-ink-900 ring-offset-2"
                      : "hover:scale-110",
                  )}
                />
              ))}
            </div>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton>Criar espaço</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
