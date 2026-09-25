-- =============================================================================
-- Chroma Flux — recorrência de tarefas
-- =============================================================================
-- Modelo espelhado no que o Asana oferece:
--
--   Diariamente    a cada N dias
--   Semanalmente   a cada N semanas, nos dias da semana escolhidos
--   Mensalmente    a cada N meses, no mesmo dia do mês
--   Anualmente     a cada N anos, na mesma data
--   Periodicamente a cada N dias/semanas/meses CONTADOS A PARTIR DA CONCLUSÃO
--   Personalizado  a cada N dias/semanas/meses/anos, com dias da semana opcionais
--
-- A diferença entre "periodicamente" e os demais é a âncora: os outros contam
-- a partir do prazo anterior (agenda fixa), o periódico conta a partir do dia
-- em que a tarefa foi de fato concluída. É a distinção entre "todo dia 5" e
-- "30 dias depois que eu terminar".
-- =============================================================================

do $$ begin
  create type public.recurrence_type as enum (
    'none', 'daily', 'weekly', 'monthly', 'yearly', 'periodic', 'custom'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recurrence_unit as enum ('day', 'week', 'month', 'year');
exception when duplicate_object then null; end $$;

alter table public.tasks
  add column if not exists recurrence_type public.recurrence_type not null default 'none',
  add column if not exists recurrence_interval int not null default 1,
  add column if not exists recurrence_unit public.recurrence_unit not null default 'week',
  -- 0 = domingo … 6 = sábado, na convenção de `extract(dow)`.
  add column if not exists recurrence_weekdays smallint[] not null default '{}',
  add column if not exists recurrence_ends_on date;

do $$ begin
  alter table public.tasks
    add constraint tasks_recurrence_interval_check
    check (recurrence_interval between 1 and 999);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tasks
    add constraint tasks_recurrence_weekdays_check
    check (
      recurrence_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
      and array_length(recurrence_weekdays, 1) is distinct from 0
    );
exception when duplicate_object then null; end $$;

-- Só tarefas com prazo entram em agenda fixa. O periódico é a exceção: ele
-- conta a partir da conclusão, então pode começar sem prazo definido.
do $$ begin
  alter table public.tasks
    add constraint tasks_recurrence_needs_due_date
    check (
      recurrence_type in ('none', 'periodic')
      or due_date is not null
    );
exception when duplicate_object then null; end $$;

create index if not exists tasks_recurrence_idx
  on public.tasks (workspace_id, recurrence_type)
  where recurrence_type <> 'none';

-- -----------------------------------------------------------------------------
-- Cálculo da próxima data
-- -----------------------------------------------------------------------------
create or replace function public.next_due_date(
  p_type      public.recurrence_type,
  p_interval  int,
  p_unit      public.recurrence_unit,
  p_weekdays  smallint[],
  p_base      date
)
returns date
language plpgsql
immutable
as $$
declare
  v_unit    public.recurrence_unit;
  v_cursor  date;
  v_limite  int;
begin
  if p_type = 'none' or p_base is null then
    return null;
  end if;

  -- Unidade efetiva de cada tipo.
  v_unit := case p_type
    when 'daily'   then 'day'
    when 'weekly'  then 'week'
    when 'monthly' then 'month'
    when 'yearly'  then 'year'
    else p_unit                       -- 'periodic' e 'custom' escolhem a sua
  end::public.recurrence_unit;

  -- Com dias da semana marcados, a próxima data é o próximo dia marcado — e
  -- não um salto cego de N semanas. É o que faz "toda segunda e quinta"
  -- alternar corretamente entre os dois dias.
  if array_length(p_weekdays, 1) > 0 and v_unit = 'week' then
    v_cursor := p_base + 1;
    -- Uma volta completa do ciclo basta para encontrar o próximo marcado.
    v_limite := 7 * greatest(p_interval, 1) + 7;

    for i in 1..v_limite loop
      if extract(dow from v_cursor)::smallint = any (p_weekdays) then
        return v_cursor;
      end if;
      v_cursor := v_cursor + 1;
    end loop;

    -- Conjunto vazio na prática: cai no salto simples abaixo.
  end if;

  return case v_unit
    when 'day'   then p_base + (p_interval || ' days')::interval
    when 'week'  then p_base + (p_interval || ' weeks')::interval
    when 'month' then p_base + (p_interval || ' months')::interval
    when 'year'  then p_base + (p_interval || ' years')::interval
  end::date;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ao concluir, gera a próxima ocorrência
-- -----------------------------------------------------------------------------
-- Fica no banco, e não na aplicação, porque a conclusão acontece por três
-- caminhos diferentes — a caixinha do cartão, o painel da tarefa e o arrasto
-- para a coluna "Concluído". Um gatilho cobre os três de uma vez.
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
  -- Só na transição para concluída, e só se houver recorrência.
  if new.recurrence_type = 'none' then
    return new;
  end if;
  if not (new.is_completed and not old.is_completed) then
    return new;
  end if;

  -- Âncora: o periódico conta a partir de hoje (quando foi realmente feita);
  -- os demais seguem a agenda a partir do prazo anterior.
  v_base := case
    when new.recurrence_type = 'periodic' then current_date
    else coalesce(new.due_date, current_date)
  end;

  v_proxima := public.next_due_date(
    new.recurrence_type,
    new.recurrence_interval,
    new.recurrence_unit,
    new.recurrence_weekdays,
    v_base
  );

  if v_proxima is null then
    return new;
  end if;

  -- Passou da data-limite: a série termina aqui.
  if new.recurrence_ends_on is not null and v_proxima > new.recurrence_ends_on then
    update public.tasks set recurrence_type = 'none' where id = new.id;
    return new;
  end if;

  -- A nova ocorrência volta para a primeira coluna do quadro. Herdar a coluna
  -- atual colocaria a próxima tarefa já dentro de "Concluído".
  select s.id into v_secao
  from public.sections s
  where s.project_id = new.project_id
  order by s.position
  limit 1;

  insert into public.tasks (
    workspace_id, project_id, section_id, parent_task_id,
    title, description, assignee_id, priority, due_date, position, created_by,
    recurrence_type, recurrence_interval, recurrence_unit,
    recurrence_weekdays, recurrence_ends_on
  )
  values (
    new.workspace_id, new.project_id,
    case when new.parent_task_id is null then v_secao else null end,
    new.parent_task_id,
    new.title, new.description, new.assignee_id, new.priority,
    v_proxima, new.position, new.created_by,
    new.recurrence_type, new.recurrence_interval, new.recurrence_unit,
    new.recurrence_weekdays, new.recurrence_ends_on
  );

  -- A recorrência migra para a nova ocorrência: a tarefa concluída vira um
  -- registro histórico. Sem isso, reabrir e concluir de novo criaria cópias.
  --
  -- Este UPDATE dispara o gatilho outra vez, mas aí `old.is_completed` já é
  -- verdadeiro e a guarda no topo interrompe — não há recursão.
  update public.tasks set recurrence_type = 'none' where id = new.id;

  return new;
end;
$$;

drop trigger if exists tasks_spawn_next_occurrence_trg on public.tasks;
create trigger tasks_spawn_next_occurrence_trg
  after update on public.tasks
  for each row execute function public.tasks_spawn_next_occurrence();

grant execute on function public.next_due_date(
  public.recurrence_type, int, public.recurrence_unit, smallint[], date
) to authenticated;

-- -----------------------------------------------------------------------------
-- A view precisa ser recriada para enxergar as colunas novas do `t.*`.
-- -----------------------------------------------------------------------------
drop view if exists public.task_overview;

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
