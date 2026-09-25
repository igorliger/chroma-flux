"use client";

import { useState } from "react";
import { CheckCircle2, Circle, Trash2, X } from "lucide-react";

import { Button, Modal } from "@/components/ui";

/**
 * Barra de ações que aparece quando há tarefas selecionadas — usada tanto na
 * lista ("Tarefas"/"Minhas tarefas") quanto no quadro Kanban, que compartilham
 * o mesmo modelo de seleção em massa.
 *
 * Excluir pede confirmação (é irreversível); concluir/reabrir não, pelo mesmo
 * motivo que a bolinha da lista não pede: dá para desfazer clicando de novo.
 */
export function BulkActionBar({
  count,
  canEdit,
  canDelete,
  onComplete,
  onReopen,
  onDelete,
  onClear,
  pending = false,
}: {
  count: number;
  canEdit: boolean;
  canDelete: boolean;
  onComplete?: () => void;
  onReopen?: () => void;
  onDelete?: () => void;
  onClear: () => void;
  pending?: boolean;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const semSelecao = count === 0;

  return (
    <>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-900">
        <span className="font-medium">
          {semSelecao
            ? "Toque nas tarefas para selecionar"
            : `${count} ${count === 1 ? "tarefa selecionada" : "tarefas selecionadas"}`}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canEdit && onComplete && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onComplete}
              disabled={pending || semSelecao}
            >
              <CheckCircle2 className="size-4" aria-hidden />
              Concluir
            </Button>
          )}
          {canEdit && onReopen && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onReopen}
              disabled={pending || semSelecao}
            >
              <Circle className="size-4" aria-hidden />
              Reabrir
            </Button>
          )}
          {canDelete && onDelete && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmando(true)}
              disabled={pending || semSelecao}
            >
              <Trash2 className="size-4" aria-hidden />
              Excluir
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={pending}>
            <X className="size-4" aria-hidden />
            Cancelar
          </Button>
        </div>
      </div>

      <Modal
        open={confirmando}
        onClose={() => setConfirmando(false)}
        title={count === 1 ? "Excluir 1 tarefa?" : `Excluir ${count} tarefas?`}
        description="Esta ação não pode ser desfeita."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={pending}
            onClick={() => {
              onDelete?.();
              setConfirmando(false);
            }}
          >
            Excluir
          </Button>
        </div>
      </Modal>
    </>
  );
}
