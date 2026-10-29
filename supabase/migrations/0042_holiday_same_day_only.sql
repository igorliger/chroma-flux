-- =============================================================================
-- 0042 — Feriado só conta quando cai no próprio dia da tarefa
-- =============================================================================
-- Correção da regra da 0036 pedida pelo Igor: a opção da repetição deixa de
-- olhar para os feriados da semana. Agora vale só o dia marcado:
--   - o dia da agenda cai num feriado → a ocorrência passa para o dia seguinte
--     (o próximo dia útil, seg–sex fora feriados);
--   - feriado em outro dia da semana → nada muda.
-- Ex.: "toda terça e quinta" com feriado na quinta → a de quinta vai para
-- sexta; a de terça continua na terça.
--
-- A opção continua guardando o dia da agenda (`recurrence_anchor`), para a
-- próxima ocorrência sair da agenda e não do dia adiado.
--
-- Recalcula as tarefas abertas que a regra antiga tinha adiado por causa de
-- um feriado em outro dia da semana. É seguro rodar de novo.

create or replace function public.holiday_week_shifted(p_owner_id uuid, p_date date)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_date is null then
    return null;
  end if;
  -- Dia útil: fica. Feriado ou fim de semana: próximo dia útil.
  return public.next_business_day(p_owner_id, p_date);
end;
$$;

revoke execute on function public.holiday_week_shifted(uuid, date) from anon, public;
grant execute on function public.holiday_week_shifted(uuid, date) to authenticated;

-- Tarefas abertas com a opção: volta para o dia certo pela regra nova.
do $$
begin
  perform set_config('chroma.escrita_interna', 'on', true);
  update public.tasks t
  set due_date = public.holiday_week_shifted(w.owner_id, t.recurrence_anchor)
  from public.workspaces w
  where w.id = t.workspace_id
    and t.holiday_week_shift
    and not t.is_completed
    and t.recurrence_anchor is not null
    and t.due_date is distinct from public.holiday_week_shifted(w.owner_id, t.recurrence_anchor);
  perform set_config('chroma.escrita_interna', 'off', true);
end $$;
