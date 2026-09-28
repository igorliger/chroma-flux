"use client";

import { useState } from "react";
import { ChevronRight, Lock } from "lucide-react";

import { NewTaskDialog } from "@/components/task/new-task-dialog";
import { NewPersonalReminderDialog } from "@/components/task/new-personal-reminder-dialog";
import { Modal } from "@/components/ui";
import { accentClass, cn } from "@/lib/utils";
import type { PersonRef } from "@/lib/database.types";
import type { TaskPermissions } from "@/lib/permissions";

export type UnifiedSpace = {
  id: string;
  name: string;
  color: string;
  people: PersonRef[];
  permissoes: TaskPermissions;
};

/**
 * "Nova tarefa" em "Minhas tarefas" pode nascer em qualquer um dos seus
 * espaços, ou como lembrete pessoal — diferente da tela de um espaço só, que
 * já sabe onde a tarefa vai. Por isso primeiro pergunta o destino, e só
 * depois abre o diálogo de verdade (`NewTaskDialog` ou
 * `NewPersonalReminderDialog`, sem nada reescrito neles).
 */
export function NewUnifiedTaskDialog({
  open,
  onClose,
  onCreated,
  currentUserId,
  spaces,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  currentUserId: string;
  spaces: UnifiedSpace[];
}) {
  const [destino, setDestino] = useState<string>("");

  function fechar() {
    setDestino("");
    onClose();
  }

  if (destino === "pessoal") {
    return (
      <NewPersonalReminderDialog
        open={open}
        onClose={fechar}
        onCreated={onCreated}
        currentUserId={currentUserId}
      />
    );
  }

  const espaco = spaces.find((s) => s.id === destino);
  if (espaco) {
    return (
      <NewTaskDialog
        open={open}
        onClose={fechar}
        onCreated={onCreated}
        workspaceId={espaco.id}
        people={espaco.people}
        defaultAssigneeId={currentUserId}
        onlyAssigneeId={espaco.permissoes.assignOthers ? undefined : currentUserId}
        currentUserId={currentUserId}
      />
    );
  }

  const podeCriarEm = spaces.filter((s) => s.permissoes.create);

  return (
    <Modal open={open} onClose={fechar} title="Nova tarefa" size="sm">
      <p className="mb-3 text-sm text-ink-500">Onde essa tarefa deve ficar?</p>
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setDestino("pessoal")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5 text-left text-sm",
            "text-ink-700 transition-colors hover:border-brand-300 hover:bg-ink-50",
          )}
        >
          <Lock className="size-4 shrink-0 text-ink-400" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink-800">Pessoal</span>
            <span className="block text-xs text-ink-400">Só sua, sem espaço de trabalho.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden />
        </button>

        {podeCriarEm.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setDestino(s.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-ink-200 px-3 py-2.5 text-left text-sm",
              "text-ink-700 transition-colors hover:border-brand-300 hover:bg-ink-50",
            )}
          >
            <span className={cn("size-2.5 shrink-0 rounded-full", accentClass(s.color))} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{s.name}</span>
            <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden />
          </button>
        ))}
      </div>
    </Modal>
  );
}
