-- =============================================================================
-- 0017 — Membros só criam tarefas para si mesmos
-- =============================================================================
-- Nova capacidade na matriz de permissões: `task.assign_others` ("Atribuir
-- tarefas a outras pessoas"). Vem ligada para proprietário e administrador e
-- desligada para membro e visualizador. Sem ela:
--   * ao criar, a tarefa fica com a própria pessoa como responsável (se vier
--     sem responsável, é preenchida com ela; outro nome é recusado);
--   * ao editar, dá para assumir a tarefa, mas não passá-la para outra pessoa
--     nem deixá-la sem responsável.
-- Tarefas particulares e escritas internas (a próxima ocorrência de uma
-- tarefa repetida) não passam por esta regra.
--
-- É seguro rodar de novo.

-- Padrão para matrizes novas.
create or replace function public.default_permissions()
returns table (role public.workspace_role, capability text)
language sql
immutable
as $$
  select r::public.workspace_role, c from (
    values
      ('owner','task.create'),      ('owner','task.edit'),      ('owner','task.complete'),
      ('owner','task.delete'),      ('owner','task.assign_others'),
      ('owner','comment.create'),   ('owner','comment.moderate'),
      ('owner','member.manage'),    ('owner','workspace.edit'), ('owner','workspace.delete'),

      ('admin','task.create'),      ('admin','task.edit'),      ('admin','task.complete'),
      ('admin','task.delete'),      ('admin','task.assign_others'),
      ('admin','comment.create'),   ('admin','comment.moderate'),
      ('admin','member.manage'),    ('admin','workspace.edit'),

      ('member','task.create'),     ('member','task.edit'),     ('member','task.complete'),
      ('member','task.delete'),
      ('member','comment.create')
  ) as t(r, c);
$$;

-- Matrizes que já existem: proprietário e administrador continuam podendo
-- atribuir a qualquer um, como antes. Membros passam a só atribuir a si.
insert into public.user_permissions (user_id, role, capability)
select distinct up.user_id, r.role::public.workspace_role, 'task.assign_others'
from public.user_permissions up
cross join (values ('owner'), ('admin')) as r(role)
on conflict do nothing;

create or replace function public.tasks_guard_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
begin
  -- Sem sessão (serviços internos) ou escrita interna: nada a checar.
  if eu is null
     or coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on'
     or new.is_personal then
    return new;
  end if;

  if public.has_capability(new.workspace_id, 'task.assign_others') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.assignee_id is null then
      new.assignee_id := eu;
    elsif new.assignee_id <> eu then
      raise exception 'Você só pode criar tarefas para você mesmo.'
        using errcode = '42501';
    end if;
  elsif new.assignee_id is distinct from old.assignee_id
        and new.assignee_id is distinct from eu then
    raise exception 'Você não pode passar tarefas para outra pessoa.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.tasks_guard_assignment() from anon, authenticated, public;

drop trigger if exists tasks_guard_assignment_trg on public.tasks;
create trigger tasks_guard_assignment_trg
  before insert or update of assignee_id on public.tasks
  for each row execute function public.tasks_guard_assignment();
