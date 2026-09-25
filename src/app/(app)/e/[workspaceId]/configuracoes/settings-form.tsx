"use client";

import { useActionState, useState } from "react";

import {
  deleteWorkspaceAction,
  updateWorkspaceAction,
  type ActionState,
} from "@/app/actions/workspaces";
import {
  Button,
  Field,
  FormError,
  FormSuccess,
  Input,
  Modal,
  SubmitButton,
  Textarea,
} from "@/components/ui";
import { ACCENT_COLORS, cn } from "@/lib/utils";
import type { Workspace } from "@/lib/database.types";

export function WorkspaceSettingsForm({ workspace }: { workspace: Workspace }) {
  const [color, setColor] = useState(workspace.color);
  const [state, formAction] = useActionState<ActionState, FormData>(updateWorkspaceAction, {});

  return (
    <form action={formAction} className="space-y-4">
      <FormError>{state.error}</FormError>
      <FormSuccess>{state.success}</FormSuccess>

      <input type="hidden" name="workspaceId" value={workspace.id} />
      <input type="hidden" name="color" value={color} />

      <Field label="Nome" htmlFor="ws-name">
        <Input
          id="ws-name"
          name="name"
          defaultValue={workspace.name}
          maxLength={80}
          required
        />
      </Field>

      <Field label="Descrição" htmlFor="ws-description">
        <Textarea
          id="ws-description"
          name="description"
          defaultValue={workspace.description}
          rows={3}
          maxLength={300}
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
                color === c.value ? "ring-2 ring-ink-900 ring-offset-2" : "hover:scale-110",
              )}
            />
          ))}
        </div>
      </Field>

      <SubmitButton>Salvar alterações</SubmitButton>
    </form>
  );
}

export function DeleteWorkspaceButton({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const matches = confirmation.trim() === workspace.name;

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Excluir espaço de trabalho
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Excluir espaço de trabalho"
        description="Esta ação é permanente e apaga todas as tarefas, colunas e comentários deste espaço."
        size="sm"
      >
        <form action={deleteWorkspaceAction} className="space-y-4">
          <input type="hidden" name="workspaceId" value={workspace.id} />

          <Field
            label={`Digite "${workspace.name}" para confirmar`}
            htmlFor="confirm-name"
          >
            <Input
              id="confirm-name"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={!matches}>
              Excluir definitivamente
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
