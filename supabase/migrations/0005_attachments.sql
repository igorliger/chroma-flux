-- =============================================================================
-- Chroma Flux — anexos
-- =============================================================================
-- Arquivos ficam no Supabase Storage, num bucket PRIVADO. O caminho segue a
-- convenção:
--
--     {workspace_id}/{task_id}/{uuid}-{nome-do-arquivo}
--
-- A primeira pasta ser o workspace não é organização: é o que permite às
-- policies do Storage decidirem o acesso. `storage.foldername(name)[1]` extrai
-- esse id e ele passa pelo mesmo `is_workspace_member()` que protege todo o
-- resto — o isolamento entre espaços vale para os arquivos exatamente como
-- vale para as tarefas.
--
-- A tabela `attachments` guarda os metadados. Um anexo pertence a uma tarefa
-- (descrição ou subtarefa, que também é uma tarefa) ou a um comentário.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- comments precisa deste alvo para a FK composta de attachments
-- -----------------------------------------------------------------------------
do $$ begin
  alter table public.comments add constraint comments_id_workspace_key
    unique (id, workspace_id);
exception when duplicate_table or duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- attachments
-- -----------------------------------------------------------------------------
create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  task_id       uuid not null,
  -- Nulo quando o anexo pertence à descrição da tarefa (ou da subtarefa).
  comment_id    uuid,
  storage_path  text not null unique,
  file_name     text not null check (char_length(file_name) between 1 and 255),
  mime_type     text not null default 'application/octet-stream',
  size_bytes    bigint not null check (size_bytes >= 0 and size_bytes <= 26214400),
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),

  -- Mesmas FKs compostas do resto do schema: o anexo não consegue apontar
  -- para uma tarefa ou comentário de outro espaço de trabalho.
  foreign key (task_id, workspace_id)
    references public.tasks (id, workspace_id) on delete cascade,
  foreign key (comment_id, workspace_id)
    references public.comments (id, workspace_id) on delete cascade
);

create index if not exists attachments_task_idx
  on public.attachments (task_id, created_at);
create index if not exists attachments_comment_idx
  on public.attachments (comment_id)
  where comment_id is not null;

-- -----------------------------------------------------------------------------
-- RLS da tabela de metadados
-- -----------------------------------------------------------------------------
alter table public.attachments enable row level security;

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (public.can_write_content(workspace_id) and uploaded_by = auth.uid());

-- Anexo não se edita: troca-se por outro. Sem policy de UPDATE.

drop policy if exists attachments_delete on public.attachments;
create policy attachments_delete on public.attachments
  for delete to authenticated
  using (
    public.is_workspace_member(workspace_id)
    and (uploaded_by = auth.uid() or public.can_administer(workspace_id))
  );

-- -----------------------------------------------------------------------------
-- Bucket
-- -----------------------------------------------------------------------------
-- Privado: nada é servido por URL pública. A leitura acontece por URL assinada,
-- gerada sob demanda e válida por pouco tempo.
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos', 'anexos', false, 26214400)          -- 25 MB
on conflict (id) do update
  set public = false,
      file_size_limit = 26214400;

-- Extrai o workspace do caminho do arquivo.
-- O `~` valida o formato antes do cast: um caminho fora do padrão devolveria
-- erro de conversão dentro da policy, e erro em policy é falha de acesso ruim
-- de diagnosticar. Devolvendo null, `is_workspace_member(null)` dá false.
create or replace function public.storage_workspace_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(p_name))[1] ~*
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
    else null
  end;
$$;

grant execute on function public.storage_workspace_id(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Policies do Storage
-- -----------------------------------------------------------------------------
-- Sem elas, o bucket privado seria inacessível até para quem tem direito.
drop policy if exists anexos_select on storage.objects;
create policy anexos_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'anexos'
    and public.is_workspace_member(public.storage_workspace_id(name))
  );

drop policy if exists anexos_insert on storage.objects;
create policy anexos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'anexos'
    and public.can_write_content(public.storage_workspace_id(name))
  );

drop policy if exists anexos_delete on storage.objects;
create policy anexos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'anexos'
    and public.can_write_content(public.storage_workspace_id(name))
  );

-- Arquivo não se sobrescreve: cada envio gera um caminho novo com uuid.
-- Sem policy de UPDATE, um usuário não consegue trocar o conteúdo de um anexo
-- já referenciado por outro.
