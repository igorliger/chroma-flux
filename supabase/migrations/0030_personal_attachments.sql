-- =============================================================================
-- 0030 — Anexos nos lembretes pessoais
-- =============================================================================
-- Mesmo bucket privado `anexos` (0005), caminho diferente: em vez de
-- `{workspace_id}/{task_id}/...`, os anexos de lembrete usam
-- `pessoal/{owner_id}/{task_id}/{uuid}-{nome}`. O prefixo literal `pessoal`
-- distingue as duas convenções no mesmo bucket, e `owner_id` no lugar de
-- `workspace_id` é o que as policies do Storage passam a checar — sempre
-- contra `auth.uid()`, nunca contra participação em espaço, porque lembrete
-- pessoal não tem espaço.
--
-- É seguro rodar de novo.

create table if not exists public.personal_task_attachments (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  task_id      uuid not null,
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) between 1 and 255),
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  created_at   timestamptz not null default now(),

  -- O anexo não consegue apontar para um lembrete de outro dono.
  foreign key (task_id, owner_id)
    references public.personal_tasks (id, owner_id) on delete cascade
);

create index if not exists personal_task_attachments_task_idx
  on public.personal_task_attachments (task_id, created_at);

alter table public.personal_task_attachments enable row level security;

drop policy if exists personal_task_attachments_select on public.personal_task_attachments;
create policy personal_task_attachments_select on public.personal_task_attachments
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists personal_task_attachments_write on public.personal_task_attachments;
create policy personal_task_attachments_write on public.personal_task_attachments
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Policies do Storage para o prefixo `pessoal/`
-- -----------------------------------------------------------------------------
-- Extrai o dono do caminho, só quando a primeira pasta é `pessoal` — um
-- caminho de espaço (primeira pasta = workspace_id) devolve null aqui, então
-- estas policies não interferem nele.
create or replace function public.storage_personal_owner_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] = 'pessoal'
     and (storage.foldername(p_name))[2] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[2])::uuid
    else null
  end;
$$;

grant execute on function public.storage_personal_owner_id(text) to authenticated;

drop policy if exists anexos_pessoal_select on storage.objects;
create policy anexos_pessoal_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'anexos'
    and public.storage_personal_owner_id(name) = auth.uid()
  );

drop policy if exists anexos_pessoal_insert on storage.objects;
create policy anexos_pessoal_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'anexos'
    and public.storage_personal_owner_id(name) = auth.uid()
  );

drop policy if exists anexos_pessoal_delete on storage.objects;
create policy anexos_pessoal_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'anexos'
    and public.storage_personal_owner_id(name) = auth.uid()
  );
