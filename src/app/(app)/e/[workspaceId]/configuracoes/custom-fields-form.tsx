"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";

import {
  createCustomFieldAction,
  deleteCustomFieldAction,
  type ActionState,
} from "@/app/actions/custom-fields";
import { Field, FormError, FormSuccess, IconButton, Input, Select, SubmitButton, Textarea } from "@/components/ui";
import type { CustomFieldDefinition, CustomFieldType } from "@/lib/database.types";

const TIPOS: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Texto curto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Lista de opções" },
];

function tipoLabel(type: CustomFieldType) {
  return TIPOS.find((t) => t.value === type)?.label ?? type;
}

export function CustomFieldsForm({
  workspaceId,
  fields,
}: {
  workspaceId: string;
  fields: CustomFieldDefinition[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(createCustomFieldAction, {});
  const [type, setType] = useState<CustomFieldType>("text");

  return (
    <div className="space-y-4">
      {fields.length === 0 ? (
        <p className="text-sm text-ink-500">Nenhum campo personalizado ainda.</p>
      ) : (
        <ul className="space-y-1">
          {fields.map((field) => (
            <li
              key={field.id}
              className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-ink-50"
            >
              <div>
                <span className="text-sm font-medium text-ink-800">{field.name}</span>
                <span className="ml-2 text-xs text-ink-400">{tipoLabel(field.type)}</span>
              </div>
              <form action={deleteCustomFieldAction}>
                <input type="hidden" name="fieldId" value={field.id} />
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <IconButton
                  label="Excluir campo"
                  type="submit"
                  className="opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600"
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="space-y-3 border-t border-ink-100 pt-4">
        <FormError>{state.error}</FormError>
        <FormSuccess>{state.success}</FormSuccess>

        <input type="hidden" name="workspaceId" value={workspaceId} />

        <div className="flex gap-2">
          <Field label="Nome do campo" htmlFor="cf-name" className="flex-1">
            <Input id="cf-name" name="name" maxLength={60} placeholder="Ex.: Cliente" required />
          </Field>

          <Field label="Tipo" htmlFor="cf-type">
            <Select
              id="cf-type"
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as CustomFieldType)}
              className="w-40"
            >
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {type === "select" && (
          <Field label="Opções" hint="Uma por linha." htmlFor="cf-options">
            <Textarea id="cf-options" name="optionsRaw" rows={3} placeholder={"Alta\nMédia\nBaixa"} />
          </Field>
        )}

        <SubmitButton size="sm">Criar campo</SubmitButton>
      </form>
    </div>
  );
}
