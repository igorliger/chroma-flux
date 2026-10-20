-- =============================================================================
-- 0037 — "Semana com feriado: adiar 1 dia" para todas as tarefas
-- =============================================================================
-- Interruptor do proprietário em Configurações › Feriados. Ligado, a opção
-- da 0036 vale para todas as tarefas repetidas (agenda fixa) dos espaços
-- dele: as abertas são ajustadas na hora, e as novas (inclusive as próximas
-- ocorrências) já nascem com a opção — não dá para desmarcar uma por uma.
-- Desligar desmarca todas e as devolve ao dia da agenda.
--
-- Sem linha em `holiday_settings`, nada muda. É seguro rodar de novo.

create table if not exists public.holiday_settings (
  owner_id       uuid primary key references public.profiles (id) on delete cascade,
  week_shift_all boolean not null default false,
  updated_at     timestamptz not null default now()
);

alter table public.holiday_settings enable row level security;

-- Só o dono lê; escrita só pela função abaixo.
drop policy if exists holiday_settings_select on public.holiday_settings;
create policy holiday_settings_select on public.holiday_settings
  for select to authenticated
  using (owner_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Gatilho da 0036, agora obedecendo ao interruptor do dono
-- -----------------------------------------------------------------------------
create or replace function public.tasks_holiday_week_shift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dono uuid;
  interna boolean := coalesce(current_setting('chroma.escrita_interna', true), 'off') = 'on';
begin
  select w.owner_id into dono from public.workspaces w where w.id = new.workspace_id;

  -- Sem repetição de agenda fixa, a opção não faz sentido.
  if new.recurrence_type in ('none', 'periodic') then
    new.holiday_week_shift := false;
  elsif exists (
    select 1 from public.holiday_settings s where s.owner_id = dono and s.week_shift_all
  ) then
    -- Ligado para todas em Configurações (0037).
    new.holiday_week_shift := true;
  end if;

  if not new.holiday_week_shift then
    if tg_op = 'UPDATE' and old.holiday_week_shift and new.recurrence_anchor is not null
       and new.due_date is not distinct from old.due_date
       and new.recurrence_type not in ('none', 'periodic') then
      -- Desligou a opção: volta para o dia da agenda.
      new.due_date := new.recurrence_anchor;
    end if;
    new.recurrence_anchor := null;
    return new;
  end if;

  if new.due_date is null or new.is_completed then
    return new;
  end if;

  -- Recalculos feitos pelo próprio banco (feriado novo) já chegam prontos.
  if tg_op = 'UPDATE' and interna then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.holiday_week_shift then
    if new.due_date is distinct from old.due_date then
      -- Prazo mudado à mão: vira o novo dia da agenda, sem adiar.
      new.recurrence_anchor := new.due_date;
    end if;
    return new;
  end if;

  -- Criação (inclusive a próxima ocorrência) ou opção recém-ligada.
  new.recurrence_anchor := coalesce(new.recurrence_anchor, new.due_date);
  new.due_date := public.holiday_week_shifted(dono, new.recurrence_anchor);
  return new;
end;
$$;

revoke execute on function public.tasks_holiday_week_shift() from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Liga/desliga para todas — só o próprio dono, para os espaços dele
-- -----------------------------------------------------------------------------
create or replace function public.set_holiday_week_shift_all(p_on boolean)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  n integer;
begin
  if eu is null or not exists (select 1 from public.workspaces w where w.owner_id = eu) then
    raise exception 'Você precisa ser proprietário de um espaço.' using errcode = '42501';
  end if;

  insert into public.holiday_settings (owner_id, week_shift_all, updated_at)
  values (eu, coalesce(p_on, false), now())
  on conflict (owner_id) do update
    set week_shift_all = excluded.week_shift_all, updated_at = now();

  -- Escrita comum (sem `chroma.escrita_interna`): é o gatilho acima que
  -- calcula o dia adiado ao ligar e devolve o dia da agenda ao desligar.
  update public.tasks t
  set holiday_week_shift = coalesce(p_on, false)
  from public.workspaces w
  where w.id = t.workspace_id
    and w.owner_id = eu
    and not t.is_completed
    and t.recurrence_type not in ('none', 'periodic')
    and t.holiday_week_shift is distinct from coalesce(p_on, false);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.set_holiday_week_shift_all(boolean) from anon, public;
grant execute on function public.set_holiday_week_shift_all(boolean) to authenticated;
