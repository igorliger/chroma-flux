-- =============================================================================
-- 0008 — Remoção da camada de projetos
-- =============================================================================
-- As tarefas passam a pertencer diretamente ao espaço de trabalho, e o quadro
-- Kanban é do espaço: cada espaço tem um, com suas colunas.
--
-- Nada é perdido: tarefas e colunas existentes são preservadas, só deixam de
-- carregar `project_id`.
--
-- Aplicado no banco em quatro etapas (remove_projects_v2,
-- reanchor_sections_tasks_to_workspace, drop_dead_seed_workspace_permissions e
-- harden_permission_functions), consolidadas aqui.

-- -----------------------------------------------------------------------------
-- 1. A view depende das colunas que vão sair
-- -----------------------------------------------------------------------------
drop view if exists public.task_overview;

-- -----------------------------------------------------------------------------
-- 2. Fora as policies e o gatilho de projetos
-- -----------------------------------------------------------------------------
drop policy if exists projects_select on public.projects;
drop policy if exists projects_insert on public.projects;
drop policy if exists projects_update on public.projects;
drop policy if exists projects_delete on public.projects;

drop trigger if exists on_project_created on public.projects;
drop function if exists public.handle_new_project();

-- -----------------------------------------------------------------------------
-- 3. As colunas e a tabela
-- -----------------------------------------------------------------------------
-- Cada FK composta que citava project_id cai junto com a coluna.
alter table public.sections drop column if exists project_id;
alter table public.tasks    drop column if exists project_id;

drop table if exists public.projects cascade;

-- -----------------------------------------------------------------------------
-- 4. Reancorar no espaço de trabalho
-- -----------------------------------------------------------------------------
-- Ao cair, as FKs compostas para `projects` levaram consigo a única ligação
-- estrutural de `sections` e `tasks` ao espaço. Sem repô-la, excluir um espaço
-- deixaria colunas e tarefas órfãs e o isolamento passaria a depender só da RLS.
alter table public.sections
  drop constraint if exists sections_id_workspace_key;
alter table public.sections
  add constraint sections_id_workspace_key unique (id, workspace_id);

alter table public.sections
  drop constraint if exists sections_workspace_fkey;
alter table public.sections
  add constraint sections_workspace_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;

alter table public.tasks
  drop constraint if exists tasks_workspace_fkey;
alter table public.tasks
  add constraint tasks_workspace_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;

-- `set null (section_id)` limita a anulação a essa coluna; sem a lista o
-- Postgres tentaria anular workspace_id, que é NOT NULL. Exige Postgres 15+.
alter table public.tasks
  drop constraint if exists tasks_section_workspace_fkey;
alter table public.tasks
  add constraint tasks_section_workspace_fkey
  foreign key (section_id, workspace_id)
  references public.sections (id, workspace_id) on delete set null (section_id);

alter table public.tasks
  drop constraint if exists tasks_parent_workspace_fkey;
alter table public.tasks
  add constraint tasks_parent_workspace_fkey
  foreign key (parent_task_id, workspace_id)
  references public.tasks (id, workspace_id) on delete cascade;

drop index if exists public.sections_project_idx;
drop index if exists public.tasks_project_board_idx;
create index if not exists sections_workspace_idx
  on public.sections (workspace_id, position);
create index if not exists tasks_workspace_board_idx
  on public.tasks (workspace_id, section_id, position)
  where parent_task_id is null;

-- -----------------------------------------------------------------------------
-- 5. O quadro padrão passa a nascer com o espaço
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;

  insert into public.sections (workspace_id, name, position)
  values
    (new.id, 'A fazer',      1000),
    (new.id, 'Em andamento', 2000),
    (new.id, 'Concluído',    3000);

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. A próxima ocorrência procura a coluna pelo espaço, não pelo projeto
-- -----------------------------------------------------------------------------
create or replace function public.tasks_spawn_next_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base    date;
  v_proxima date;
  v_secao   uuid;
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
    update public.tasks set recurrence_type = 'none' where id = new.id;
    return new;
  end if;

  -- A nova ocorrência volta para a primeira coluna do quadro. Herdar a coluna
  -- atual colocaria a próxima tarefa já dentro de "Concluído".
  select s.id into v_secao
  from public.sections s
  where s.workspace_id = new.workspace_id
  order by s.position
  limit 1;

  insert into public.tasks (
    workspace_id, section_id, parent_task_id,
    title, description, assignee_id, priority, due_date, due_time,
    position, created_by,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id,
    case when new.parent_task_id is null then v_secao else null end,
    new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.due_time,
    new.position, new.created_by,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  update public.tasks set recurrence_type = 'none' where id = new.id;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Capacidades de projeto saem da matriz
-- -----------------------------------------------------------------------------
delete from public.user_permissions
where capability in ('project.create', 'project.edit', 'project.delete');

create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
set search_path = public, pg_temp
as $$
  select r::public.workspace_role, c from (
    values
      ('owner','section.manage'),
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.delete'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','section.manage'),
      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.delete'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','section.manage'),
      ('member','task.create'),     ('member','task.edit'),     ('member','task.delete'),
      ('member','comment.create')
  ) as t(r, c);
$$;

-- `workspace_permissions` deixou de existir quando a matriz passou a ser por
-- usuário; a função que a semeava ficou para trás e falharia se chamada.
drop function if exists public.seed_workspace_permissions(uuid);

-- -----------------------------------------------------------------------------
-- 8. A view volta, agora sem project_id
-- -----------------------------------------------------------------------------
create view public.task_overview
with (security_invoker = on) as
select
  t.*,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id)::int as subtask_count,
  (select count(*) from public.tasks s
    where s.parent_task_id = t.id and s.is_completed)::int as subtask_done_count,
  (select count(*) from public.comments c
    where c.task_id = t.id)::int as comment_count
from public.tasks t;

grant select on public.task_overview to authenticated;
revoke all on public.task_overview from anon;

-- -----------------------------------------------------------------------------
-- 9. Endurecimento das funções da matriz
-- -----------------------------------------------------------------------------
-- Chamadas apenas de dentro de `has_capability`, que é SECURITY DEFINER e roda
-- como dona — quem chama não precisa de EXECUTE nelas. Expostas em
-- /rest/v1/rpc, `seed_user_permissions` reaplicaria a matriz padrão a qualquer
-- usuário (desfazendo permissões que o dono fechou) e `within_access_window`
-- permitiria sondar a agenda de qualquer proprietário.
revoke execute on function public.seed_user_permissions(uuid)
  from public, anon, authenticated;
revoke execute on function public.within_access_window(uuid)
  from public, anon, authenticated;
revoke execute on function public.default_permissions()
  from public, anon, authenticated;
