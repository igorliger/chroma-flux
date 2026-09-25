"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  Circle,
  Flag,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { createCommentAction, deleteCommentAction } from "@/app/actions/comments";
import {
  createSubtaskAction,
  deleteTaskAction,
  patchTaskAction,
  setTaskScheduleAction,
} from "@/app/actions/tasks";
import { addDependencyAction, removeDependencyAction } from "@/app/actions/dependencies";
import { setCustomFieldValueAction } from "@/app/actions/custom-fields";
import { Attachments } from "@/components/task/attachments";
import { AssigneePicker } from "@/components/task/assignee-picker";
import { DueDateField } from "@/components/task/due-date-field";
import { RichText } from "@/components/rich-text";
import { extractUrls } from "@/lib/links";
import { LinkPreview } from "@/components/link-preview";
import { formatBytes, validateFile } from "@/lib/attachments";
import { uploadAttachments } from "@/lib/upload-attachment";
import {
  recurrenceFromTask,
  recurrencePendingReason,
  type Recurrence,
} from "@/lib/recurrence";
import { Avatar, Button, IconButton, Input, Modal, Select, Textarea } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { fireCompletionBurst } from "@/lib/completion-burst";
import { playCompletionSound } from "@/lib/completion-sound";
import type { TaskPermissions } from "@/lib/permissions";
import { PRIORITIES, cn, formatDateTime, priorityMeta, responsibleIds } from "@/lib/utils";
import type {
  Comment,
  CustomFieldDefinition,
  PersonRef,
  Task,
  TaskOverview,
  TaskPriority,
} from "@/lib/database.types";
import { Link2, Plus as PlusDep, Trash2 as TrashDep } from "lucide-react";


export function TaskPanel({
  task,
  workspaceId,
  people,
  permissoes,
  currentUserId,
  allTasks = [],
  customFields = [],
  customFieldValues,
  dependencies,
  onClose,
  onChanged,
}: {
  task: TaskOverview;
  workspaceId: string;
  people: PersonRef[];
  permissoes: TaskPermissions;
  currentUserId: string;
  /** Todas as tarefas do espaço, para escolher de quem esta tarefa depende. */
  allTasks?: TaskOverview[];
  /** Campos personalizados definidos para o espaço. */
  customFields?: CustomFieldDefinition[];
  /** Valores já preenchidos desta tarefa, por id do campo. */
  customFieldValues?: Map<string, string>;
  /** Dependências desta tarefa, já resolvidas contra `allTasks`. */
  dependencies?: { dependsOn: TaskOverview[]; blockedBy: TaskOverview[] };
  onClose: () => void;
  onChanged: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [dependsOn, setDependsOn] = useState(dependencies?.dependsOn ?? []);
  const [blockedBy, setBlockedBy] = useState(dependencies?.blockedBy ?? []);
  const [addDepOpen, setAddDepOpen] = useState(false);

  const [fieldValues, setFieldValues] = useState<Map<string, string>>(
    customFieldValues ?? new Map(),
  );

  // Campos editáveis mantidos localmente para a digitação não engasgar.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [completed, setCompleted] = useState(task.is_completed);
  const [dueDate, setDueDate] = useState<string | null>(task.due_date);
  const [dueTime, setDueTime] = useState<string | null>(task.due_time);
  const [recurrence, setRecurrence] = useState<Recurrence>(recurrenceFromTask(task));
  /** O que falta para a repetição escolhida poder ser gravada. */
  const [pendencia, setPendencia] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [subtaskResult, commentResult] = await Promise.all([
      supabase
        .from("tasks")
        .select("*")
        .eq("parent_task_id", task.id)
        .order("position", { ascending: true }),
      supabase
        .from("comments")
        .select("*")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true }),
    ]);

    if (subtaskResult.error || commentResult.error) {
      setError("Não foi possível carregar os detalhes desta tarefa.");
    } else {
      setSubtasks(subtaskResult.data as Task[]);
      setComments(commentResult.data as Comment[]);
    }
    setLoading(false);
  }, [supabase, task.id]);

  // Responsáveis: estado local para a troca aparecer na hora, antes de a
  // lista recarregar do servidor. A ordem importa (o primeiro é o principal).
  const [responsaveis, setResponsaveis] = useState<string[]>(responsibleIds(task));
  const chaveResponsaveis = responsibleIds(task).join(",");
  useEffect(() => {
    setResponsaveis(responsibleIds(task));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, chaveResponsaveis]);

  async function salvarResponsaveis(ids: string[]) {
    const anteriores = responsaveis;
    setResponsaveis(ids);
    const ok = await patch({ assignee_id: ids[0] ?? null, co_assignee_ids: ids.slice(1) });
    if (!ok) setResponsaveis(anteriores);
  }

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setCompleted(task.is_completed);
    setDueDate(task.due_date);
    setDueTime(task.due_time);
    setRecurrence(recurrenceFromTask(task));
    setPendencia(null);
    setLoading(true);
    void load();
    // `task` inteiro na lista faria o efeito rodar a cada revalidação e
    // atropelar o que o usuário está editando; por isso só os campos usados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.title, task.description, task.is_completed, task.due_date, task.due_time, load]);

  useEffect(() => {
    setDependsOn(dependencies?.dependsOn ?? []);
    setBlockedBy(dependencies?.blockedBy ?? []);
    setFieldValues(customFieldValues ?? new Map());
  }, [task.id, dependencies, customFieldValues]);

  /**
   * Prazo, hora e repetição são gravados juntos: o banco valida os três em
   * conjunto — hora exige data, e agenda fixa exige data.
   *
   * Como o painel salva sozinho, a cada mudança, uma combinação ainda
   * incompleta não vira erro: fica esperando o campo que falta. E quando o
   * servidor recusa de verdade, os três campos voltam ao que estava gravado —
   * sem isso o painel exibiria uma agenda que o banco não aceitou.
   */
  async function salvarAgenda(
    novaData: string | null,
    novaHora: string | null,
    novaRegra: Recurrence,
  ) {
    const anterior = { data: dueDate, hora: dueTime, regra: recurrence };

    setDueDate(novaData);
    setDueTime(novaHora);
    setRecurrence(novaRegra);

    const falta = recurrencePendingReason(novaRegra, novaData);
    setPendencia(falta);
    if (falta) {
      setError(null);
      return;
    }

    const result = await setTaskScheduleAction(
      task.id,
      workspaceId,
      novaData,
      novaHora,
      novaRegra,
    );

    if (result.error) {
      setError(result.error);
      setDueDate(anterior.data);
      setDueTime(anterior.hora);
      setRecurrence(anterior.regra);
      return;
    }
    setError(null);
    startTransition(onChanged);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Salva um campo e propaga o erro na própria tela, sem alertas nativos. */
  async function patch(patchFields: Parameters<typeof patchTaskAction>[2]) {
    const result = await patchTaskAction(task.id, workspaceId, patchFields);
    if (result.error) {
      setError(result.error);
      return false;
    }
    setError(null);
    startTransition(onChanged);
    return true;
  }

  async function toggleSubtask(subtask: Task, origem: { x: number; y: number }) {
    if (!subtask.is_completed) {
      playCompletionSound();
      fireCompletionBurst(origem);
    }
    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, is_completed: !s.is_completed } : s)),
    );
    const ok = await patchSubtask(subtask.id, { is_completed: !subtask.is_completed });
    if (!ok) void load();
  }

  async function patchSubtask(
    subtaskId: string,
    fields: Parameters<typeof patchTaskAction>[2],
  ) {
    const result = await patchTaskAction(subtaskId, workspaceId, fields);
    if (result.error) {
      setError(result.error);
      return false;
    }
    startTransition(onChanged);
    return true;
  }

  const priority = priorityMeta(task.priority);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink-900/30" onClick={onClose} aria-hidden />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={task.title}
        className="relative flex h-full w-full flex-col bg-surface shadow-2xl sm:max-w-xl"
      >
        {/* Cabeçalho */}
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <button
            type="button"
            disabled={!permissoes.complete}
            onClick={async (event) => {
              const next = !completed;
              if (next) {
                playCompletionSound();
                fireCompletionBurst({ x: event.clientX, y: event.clientY });
              }
              setCompleted(next);
              const ok = await patch({ is_completed: next });
              if (!ok) setCompleted(!next);
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
              completed
                ? "bg-emerald-50 text-emerald-700"
                : "bg-ink-100 text-ink-600 hover:bg-ink-200",
              !permissoes.complete && "cursor-default opacity-70",
            )}
          >
            {completed ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <Circle className="size-4" aria-hidden />
            )}
            {completed ? "Concluída" : "Marcar como concluída"}
          </button>

          <div className="flex items-center gap-1">
            {permissoes.delete && (
              <form
                action={deleteTaskAction}
                onSubmit={() => onClose()}
                className="contents"
              >
                <input type="hidden" name="taskId" value={task.id} />
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <IconButton
                  label="Excluir tarefa"
                  type="submit"
                  className="hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </form>
            )}
            <IconButton label="Fechar" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-4 py-4 sm:px-5">
          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          {/* Título */}
          <textarea
            value={title}
            disabled={!permissoes.edit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => {
              const trimmed = title.trim();
              if (!trimmed || trimmed === task.title) {
                setTitle(task.title);
                return;
              }
              const ok = await patch({ title: trimmed });
              if (!ok) setTitle(task.title);
            }}
            rows={2}
            className="w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold leading-snug text-ink-900 transition-colors hover:border-ink-200 focus:border-brand-400 disabled:hover:border-transparent"
          />

          {/* Metadados */}
          <dl className="mt-4 space-y-3">
            {/* Responsáveis: caixas de seleção, com "Todos". O primeiro marcado é o
                principal (assignee_id); os demais, co_assignee_ids. */}
            <div className="flex gap-3">
              <dt className="flex w-32 shrink-0 items-start gap-2 pt-1.5 text-sm text-ink-500">
                <span className="text-ink-400">
                  <Users className="size-4" />
                </span>
                Responsáveis
              </dt>
              <dd className="min-w-0 flex-1">
                {task.is_personal ? (
                  <span className="text-sm text-ink-600">Só você (tarefa particular)</span>
                ) : (
                  <AssigneePicker
                    people={people}
                    selecionados={responsaveis}
                    onChange={salvarResponsaveis}
                    currentUserId={currentUserId}
                    podeOutros={permissoes.assignOthers}
                    disabled={!permissoes.edit}
                  />
                )}
              </dd>
            </div>

            <Row icon={<Flag className="size-4" />} label="Prioridade">
              <div className="flex items-center gap-2">
                <Select
                  value={task.priority}
                  disabled={!permissoes.edit}
                  onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                  className="h-9 max-w-40"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
                <span className={cn("size-2 rounded-full", priority.dot)} aria-hidden />
              </div>
            </Row>

          </dl>

          {/* Campos personalizados */}
          {customFields.length > 0 && (
            <section className="mt-5 rounded-xl border border-ink-200 p-3">
              <h3 className="mb-3 text-sm font-semibold text-ink-700">Campos personalizados</h3>
              <div className="space-y-3">
                {customFields.map((field) => (
                  <CustomFieldRow
                    key={field.id}
                    field={field}
                    value={fieldValues.get(field.id) ?? ""}
                    disabled={!permissoes.edit}
                    onSave={async (novoValor) => {
                      const valorAnterior = fieldValues.get(field.id) ?? "";
                      setFieldValues((prev) => {
                        const next = new Map(prev);
                        if (novoValor) next.set(field.id, novoValor);
                        else next.delete(field.id);
                        return next;
                      });
                      const result = await setCustomFieldValueAction(
                        task.id,
                        workspaceId,
                        field.id,
                        novoValor || null,
                      );
                      if (result.error) {
                        setError(result.error);
                        setFieldValues((prev) => {
                          const next = new Map(prev);
                          if (valorAnterior) next.set(field.id, valorAnterior);
                          else next.delete(field.id);
                          return next;
                        });
                        return;
                      }
                      setError(null);
                      startTransition(onChanged);
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Dependências */}
          <section className="mt-5 rounded-xl border border-ink-200 p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-700">Depende de</h3>
              {permissoes.edit && (
                <IconButton label="Adicionar dependência" onClick={() => setAddDepOpen(true)}>
                  <PlusDep className="size-4" />
                </IconButton>
              )}
            </div>

            {dependsOn.length === 0 ? (
              <p className="mt-1 text-sm text-ink-400">
                Nenhuma — esta tarefa pode ser concluída livremente.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {dependsOn.map((dep) => (
                  <li
                    key={dep.id}
                    className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-50"
                  >
                    <Link2 className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm text-ink-700",
                        dep.is_completed && "text-ink-400 line-through",
                      )}
                    >
                      {dep.title}
                    </span>
                    {!dep.is_completed && (
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        Bloqueando
                      </span>
                    )}
                    {permissoes.edit && (
                      <IconButton
                        label="Remover dependência"
                        className="size-7 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                        onClick={async () => {
                          setDependsOn((prev) => prev.filter((d) => d.id !== dep.id));
                          const result = await removeDependencyAction(
                            task.id,
                            workspaceId,
                            dep.id,
                          );
                          if (result.error) setError(result.error);
                          else startTransition(onChanged);
                        }}
                      >
                        <TrashDep className="size-3.5" />
                      </IconButton>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {blockedBy.length > 0 && (
              <>
                <h3 className="mb-1 mt-4 text-sm font-semibold text-ink-700">Bloqueia</h3>
                <ul className="space-y-1">
                  {blockedBy.map((dep) => (
                    <li
                      key={dep.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-600"
                    >
                      <Link2 className="size-3.5 shrink-0 text-ink-400" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{dep.title}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {addDepOpen && (
              <AddDependencyModal
                open={addDepOpen}
                onClose={() => setAddDepOpen(false)}
                task={task}
                allTasks={allTasks}
                existing={dependsOn}
                onAdd={async (alvo) => {
                  const result = await addDependencyAction(task.id, workspaceId, alvo.id);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setDependsOn((prev) => [...prev, alvo]);
                  setAddDepOpen(false);
                  setError(null);
                  startTransition(onChanged);
                }}
              />
            )}
          </section>

          {/* Prazo e repetição */}
          <section className="mt-5 rounded-xl border border-ink-200 p-3">
            <h3 className="mb-3 text-sm font-semibold text-ink-700">Prazo e repetição</h3>
            <DueDateField
              dueDate={dueDate}
              dueTime={dueTime}
              recurrence={recurrence}
              onDueDateChange={(d) => salvarAgenda(d, d ? dueTime : null, recurrence)}
              onDueTimeChange={(h) => salvarAgenda(dueDate, h, recurrence)}
              onRecurrenceChange={(r) => salvarAgenda(dueDate, dueTime, r)}
              pending={pendencia}
              disabled={!permissoes.edit}
              idPrefix={`painel-${task.id}`}
            />
          </section>

          {/* Descrição */}
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">Descrição</h3>
            <Textarea
              value={description}
              disabled={!permissoes.edit}
              rows={4}
              placeholder={permissoes.edit ? "Adicione mais contexto…" : "Sem descrição."}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={async () => {
                if (description === task.description) return;
                const ok = await patch({ description: description.trim() });
                if (!ok) setDescription(task.description);
              }}
            />

            {/* Miniaturas dos links citados na descrição. Ficam fora do campo
                de edição: dentro dele, o texto precisa continuar editável. */}
            {extractUrls(description)
              .slice(0, 3)
              .map((url) => (
                <LinkPreview key={url} url={url} />
              ))}

            <div className="mt-3">
              <Attachments
                workspaceId={workspaceId}
                taskId={task.id}
                canWrite={permissoes.edit}
                currentUserId={currentUserId}
                onChanged={() => startTransition(onChanged)}
              />
            </div>
          </section>

          {/* Subtarefas */}
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-ink-700">
              Subtarefas
              {subtasks.length > 0 && (
                <span className="ml-2 font-normal text-ink-400">
                  {subtasks.filter((s) => s.is_completed).length}/{subtasks.length}
                </span>
              )}
            </h3>

            {loading ? (
              <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
            ) : (
              <ul className="space-y-1">
                {subtasks.map((subtask) => (
                  <li key={subtask.id} className="group rounded-lg px-2 py-1.5 hover:bg-ink-50">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!permissoes.complete}
                        onClick={(event) =>
                          toggleSubtask(subtask, { x: event.clientX, y: event.clientY })
                        }
                        aria-label={
                          subtask.is_completed ? "Reabrir subtarefa" : "Concluir subtarefa"
                        }
                        className="shrink-0 text-ink-300 transition-colors hover:text-emerald-600 disabled:hover:text-ink-300"
                      >
                        {subtask.is_completed ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <Circle className="size-4" />
                        )}
                      </button>
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-sm text-ink-700",
                          subtask.is_completed && "text-ink-400 line-through",
                        )}
                      >
                        {subtask.title}
                      </span>
                      {permissoes.delete && (
                        <form
                          action={deleteTaskAction}
                          onSubmit={() =>
                            setSubtasks((prev) => prev.filter((s) => s.id !== subtask.id))
                          }
                        >
                          <input type="hidden" name="taskId" value={subtask.id} />
                          <input type="hidden" name="workspaceId" value={workspaceId} />
                          <IconButton
                            label="Excluir subtarefa"
                            type="submit"
                            className="size-7 opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </form>
                      )}
                    </div>

                    {/* Subtarefa é uma tarefa: recebe anexos pelo mesmo caminho. */}
                    <div className="ml-6 mt-1">
                      <Attachments
                        workspaceId={workspaceId}
                        taskId={subtask.id}
                        canWrite={permissoes.edit}
                        currentUserId={currentUserId}
                        compact
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {permissoes.create && (
              <AddSubtask
                workspaceId={workspaceId}
                parentTaskId={task.id}
                onAdded={() => {
                  void load();
                  startTransition(onChanged);
                }}
              />
            )}
          </section>

          {/* Comentários */}
          <section className="mt-8">
            <h3 className="mb-3 text-sm font-semibold text-ink-700">
              Comentários {comments.length > 0 && `(${comments.length})`}
            </h3>

            {loading ? (
              <Loader2 className="size-4 animate-spin text-ink-400" aria-hidden />
            ) : comments.length === 0 ? (
              <p className="text-sm text-ink-400">Nenhum comentário ainda.</p>
            ) : (
              <ul className="space-y-4">
                {comments.map((comment) => {
                  const author = peopleById.get(comment.author_id);
                  return (
                    <li key={comment.id} className="group flex gap-3">
                      <Avatar
                        id={comment.author_id}
                        name={author?.full_name ?? ""}
                        email={author?.email ?? "?"}
                        size="sm"
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-ink-800">
                            {author?.full_name || author?.email || "Usuário removido"}
                          </span>
                          <span className="text-xs text-ink-400">
                            {formatDateTime(comment.created_at)}
                          </span>
                          {comment.author_id === currentUserId && (
                            <form
                              action={deleteCommentAction}
                              onSubmit={() =>
                                setComments((prev) =>
                                  prev.filter((c) => c.id !== comment.id),
                                )
                              }
                              className="ml-auto"
                            >
                              <input type="hidden" name="commentId" value={comment.id} />
                              <input type="hidden" name="workspaceId" value={workspaceId} />
                              <button
                                type="submit"
                                className="text-xs text-ink-400 opacity-0 transition-opacity hover:text-rose-600 group-hover:opacity-100"
                              >
                                excluir
                              </button>
                            </form>
                          )}
                        </div>
                        <RichText text={comment.body} className="mt-0.5" />
                        <div className="mt-1.5">
                          <Attachments
                            workspaceId={workspaceId}
                            taskId={task.id}
                            commentId={comment.id}
                            canWrite={comment.author_id === currentUserId}
                            currentUserId={currentUserId}
                            compact
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {permissoes.comment && (
              <AddComment
                workspaceId={workspaceId}
                taskId={task.id}
                onAdded={() => {
                  void load();
                  startTransition(onChanged);
                }}
              />
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

/** Um campo personalizado dentro do painel — mesmo padrão de autossave-no-blur
 *  dos outros campos (título, descrição). */
function CustomFieldRow({
  field,
  value,
  disabled,
  onSave,
}: {
  field: CustomFieldDefinition;
  value: string;
  disabled: boolean;
  onSave: (novoValor: string) => void;
}) {
  const [local, setLocal] = useState(value);

  useEffect(() => setLocal(value), [value]);

  const options = Array.isArray(field.options) ? (field.options as string[]) : [];

  const commit = () => {
    if (local !== value) onSave(local.trim());
  };

  return (
    <Row icon={null} label={field.name}>
      {field.type === "select" ? (
        <Select
          value={local}
          disabled={disabled}
          onChange={(e) => {
            setLocal(e.target.value);
            onSave(e.target.value);
          }}
          className="h-9 max-w-56"
        >
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          value={local}
          disabled={disabled}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          className="h-9 max-w-56"
        />
      )}
    </Row>
  );
}

/** Modal de busca simples entre as tarefas do espaço, para escolher de qual
 *  esta tarefa passa a depender. */
function AddDependencyModal({
  open,
  onClose,
  task,
  allTasks,
  existing,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  task: TaskOverview;
  allTasks: TaskOverview[];
  existing: TaskOverview[];
  onAdd: (alvo: TaskOverview) => void;
}) {
  const [busca, setBusca] = useState("");

  const jaDepende = new Set(existing.map((t) => t.id));
  const candidatas = allTasks.filter(
    (t) =>
      t.id !== task.id &&
      !jaDepende.has(t.id) &&
      t.title.toLowerCase().includes(busca.trim().toLowerCase()),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar dependência"
      description={`"${task.title}" só poderá ser concluída depois da tarefa escolhida.`}
    >
      <Input
        autoFocus
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar tarefa…"
        className="mb-3"
      />
      <ul className="max-h-72 space-y-1 overflow-y-auto scrollbar-slim">
        {candidatas.length === 0 && (
          <p className="px-2 py-3 text-sm text-ink-400">Nenhuma tarefa encontrada.</p>
        )}
        {candidatas.slice(0, 50).map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onAdd(t)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
                "text-ink-700 transition-colors hover:bg-ink-50",
              )}
            >
              {t.is_completed ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <Circle className="size-3.5 shrink-0 text-ink-300" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex w-32 shrink-0 items-center gap-2 text-sm text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function AddSubtask({
  workspaceId,
  parentTaskId,
  onAdded,
}: {
  workspaceId: string;
  parentTaskId: string;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("parentTaskId", parentTaskId);
    formData.set("title", trimmed);

    const result = await createSubtaskAction({}, formData);
    setSaving(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setTitle("");
    onAdded();
  }

  return (
    <form onSubmit={submit} className="mt-2 flex items-center gap-2">
      <Plus className="size-4 shrink-0 text-ink-400" aria-hidden />
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Adicionar subtarefa"
        maxLength={300}
        className="h-9 border-transparent bg-ink-50"
      />
      {title.trim() && (
        <Button type="submit" size="sm" loading={saving}>
          Adicionar
        </Button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </form>
  );
}

function AddComment({
  workspaceId,
  taskId,
  onAdded,
}: {
  workspaceId: string;
  taskId: string;
  onAdded: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const fileRef = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Arquivos escolhidos antes de enviar. Só sobem depois que o comentário
  // existe, porque um anexo precisa do id do comentário ao qual pertence.
  const [pendentes, setPendentes] = useState<File[]>([]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = body.trim();
    if ((!trimmed && pendentes.length === 0) || saving) return;

    // Um comentário só de anexos ainda precisa de corpo: o banco exige.
    const texto = trimmed || (pendentes.length === 1 ? "Anexo" : "Anexos");

    setSaving(true);
    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("taskId", taskId);
    formData.set("body", texto);

    const result = await createCommentAction({}, formData);

    if (result.error || !result.commentId) {
      setSaving(false);
      setError(result.error ?? "Não foi possível publicar o comentário.");
      return;
    }

    if (pendentes.length > 0) {
      const erros = await uploadAttachments(
        supabase,
        { workspaceId, taskId, commentId: result.commentId },
        pendentes,
      );
      if (erros.length > 0) setError(erros[0]);
    }

    setSaving(false);
    if (!error) setError(null);
    setBody("");
    setPendentes([]);
    if (fileRef.current) fileRef.current.value = "";
    onAdded();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="Escreva um comentário…"
        onKeyDown={(e) => {
          // Ctrl/Cmd + Enter envia, como na maioria dos apps de equipe.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit(e as unknown as React.FormEvent);
          }
        }}
      />

      {pendentes.length > 0 && (
        <ul className="space-y-1">
          {pendentes.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center gap-2 rounded-lg bg-ink-50 px-2 py-1.5 text-xs"
            >
              <Paperclip className="size-3.5 shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ink-700">{f.name}</span>
              <span className="shrink-0 text-ink-400">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => setPendentes((p) => p.filter((_, j) => j !== i))}
                className="shrink-0 text-ink-400 transition-colors hover:text-rose-600"
                aria-label={`Remover ${f.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="sr-only"
          onChange={(e) => {
            const escolhidos = Array.from(e.target.files ?? []);
            const recusado = escolhidos.map(validateFile).find(Boolean);
            if (recusado) setError(recusado);
            setPendentes((p) => [...p, ...escolhidos.filter((f) => !validateFile(f))]);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <Paperclip className="size-3.5" aria-hidden />
          Anexar arquivo
        </button>

        <Button
          type="submit"
          size="sm"
          loading={saving}
          disabled={!body.trim() && pendentes.length === 0}
        >
          Comentar
        </Button>
      </div>
    </form>
  );
}
