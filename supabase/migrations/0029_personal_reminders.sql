-- =============================================================================
-- 0029 — Lembretes pessoais
-- =============================================================================
-- "Tarefa particular" (0012) já existia, mas continua presa a um espaço de
-- trabalho: toda `tasks` carrega `workspace_id` NOT NULL, e essa é uma
-- invariante estrutural do projeto (ver o comentário no topo de
-- `0001_schema.sql`) — não algo para relaxar ali.
--
-- Um lembrete pessoal é outra coisa: não pertence a espaço nenhum, é só da
-- pessoa. Por isso ganha tabela própria, `personal_tasks`, em vez de uma
-- linha de `tasks` com `workspace_id` nulo. Tem a mesma cara de uma tarefa —
-- prioridade, prazo com hora e repetição, subtarefas (um nível) — mas sem
-- comentários, anexos, campos personalizados ou dependências: essas coisas
-- existem para o trabalho em equipe, e um lembrete não tem equipe.
--
-- É seguro rodar de novo.

create table if not exists public.personal_tasks (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  parent_task_id      uuid,
  title               text not null check (char_length(trim(title)) between 1 and 300),
  description         text not null default '',
  priority            public.task_priority not null default 'medium',
  due_date            date,
  due_time            time,
  is_completed        boolean not null default false,
  completed_at        timestamptz,
  position            double precision not null default 1000,
  recurrence_type     public.recurrence_type not null default 'none',
  recurrence_interval integer not null default 1,
  recurrence_unit     public.recurrence_unit not null default 'week',
  recurrence_weekdays smallint[] not null default '{}',
  recurrence_ends_on  date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- Subtarefa é sempre do mesmo dono da tarefa-mãe (mesmo padrão de
  -- `tasks_parent_workspace_fkey`, trocando workspace por dono).
  foreign key (parent_task_id, owner_id)
    references public.personal_tasks (id, owner_id) on delete cascade,
  -- Alvo da FK composta acima.
  unique (id, owner_id),

  check (parent_task_id is null or parent_task_id <> id),
  check (due_time is null or due_date is not null),
  check (recurrence_interval between 1 and 999),
  check (recurrence_type in ('none', 'periodic') or due_date is not null),
  check (
    recurrence_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
    and array_length(recurrence_weekdays, 1) is distinct from 0
  )
);

comment on table public.personal_tasks is
  'Lembrete pessoal: não pertence a nenhum espaço de trabalho, só ao dono. '
  'Sem comentários, anexos, campos personalizados ou dependências — isso é '
  'coisa de tasks, que é trabalho em equipe.';

-- Só a lista de topo é comum; a maioria será aberta e não concluída.
create index if not exists personal_tasks_owner_idx
  on public.personal_tasks (owner_id, is_completed)
  where parent_task_id is null;
create index if not exists personal_tasks_parent_idx
  on public.personal_tasks (parent_task_id);
create index if not exists personal_tasks_due_idx
  on public.personal_tasks (owner_id, due_date);

drop trigger if exists personal_tasks_set_updated_at on public.personal_tasks;
create trigger personal_tasks_set_updated_at
  before update on public.personal_tasks
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Conclusão e profundidade máxima de 1 nível — mesma regra de `tasks_before_write`.
-- -----------------------------------------------------------------------------
create or replace function public.personal_tasks_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_parent_is_subtask boolean;
begin
  if new.is_completed and (tg_op = 'INSERT' or not old.is_completed) then
    new.completed_at := now();
  elsif not new.is_completed then
    new.completed_at := null;
  end if;

  if new.parent_task_id is not null then
    select (parent_task_id is not null) into v_parent_is_subtask
    from public.personal_tasks where id = new.parent_task_id;

    if coalesce(v_parent_is_subtask, false) then
      raise exception 'Subtarefas não podem ter subtarefas.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.personal_tasks_before_write() from anon, authenticated, public;

drop trigger if exists personal_tasks_before_write_trg on public.personal_tasks;
create trigger personal_tasks_before_write_trg
  before insert or update on public.personal_tasks
  for each row execute function public.personal_tasks_before_write();

-- -----------------------------------------------------------------------------
-- Repetição: concluir gera a próxima ocorrência (reaproveita `next_due_date`,
-- que é pura e já serve `tasks` — ver `0004_recurrence.sql`).
-- -----------------------------------------------------------------------------
create or replace function public.personal_tasks_spawn_next_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base    date;
  v_proxima date;
begin
  if new.recurrence_type = 'none' then
    return new;
  end if;
  if not (new.is_completed and not old.is_completed) then
    return new;
  end if;

  v_base := case
    when new.recurrence_type = 'periodic' then current_date
    else coalesce(new.due_date, current_date)
  end;

  v_proxima := public.next_due_date(
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, v_base
  );

  if v_proxima is null then
    return new;
  end if;

  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.personal_tasks set recurrence_type = 'none' where id = new.id;
    return new;
  end if;

  insert into public.personal_tasks (
    owner_id, parent_task_id, title, description, priority, due_date, due_time,
    position, recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.owner_id, new.parent_task_id, new.title, new.description, new.priority,
    v_proxima, new.due_time,
    new.position, new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  update public.personal_tasks set recurrence_type = 'none' where id = new.id;

  return new;
end;
$$;

revoke execute on function public.personal_tasks_spawn_next_occurrence() from anon, authenticated, public;

drop trigger if exists personal_tasks_spawn_next_occurrence_trg on public.personal_tasks;
create trigger personal_tasks_spawn_next_occurrence_trg
  after update on public.personal_tasks
  for each row execute function public.personal_tasks_spawn_next_occurrence();

-- -----------------------------------------------------------------------------
-- View: tasks + contadores de subtarefas.
-- -----------------------------------------------------------------------------
create or replace view public.personal_task_overview
with (security_invoker = true) as
select
  t.id, t.owner_id, t.parent_task_id, t.title, t.description, t.priority,
  t.due_date, t.due_time, t.is_completed, t.completed_at, t."position",
  t.recurrence_type, t.recurrence_interval, t.recurrence_unit,
  t.recurrence_weekdays, t.recurrence_ends_on,
  t.created_at, t.updated_at,
  (select count(*) from public.personal_tasks s where s.parent_task_id = t.id)::integer
    as subtask_count,
  (select count(*) from public.personal_tasks s
    where s.parent_task_id = t.id and s.is_completed)::integer
    as subtask_done_count
from public.personal_tasks t;

-- -----------------------------------------------------------------------------
-- RLS: só o dono vê e mexe — sem matriz de papéis, porque não há espaço nem
-- equipe aqui. Mesmo padrão de `holidays` (0028).
-- -----------------------------------------------------------------------------
alter table public.personal_tasks enable row level security;

drop policy if exists personal_tasks_select on public.personal_tasks;
create policy personal_tasks_select on public.personal_tasks
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists personal_tasks_write on public.personal_tasks;
create policy personal_tasks_write on public.personal_tasks
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
