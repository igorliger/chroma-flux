-- =============================================================================
-- 0033 — Liberação por dispositivo (recurso opcional, DESLIGADO por padrão)
-- =============================================================================
-- Com o recurso ligado pelo proprietário, quem é membro/visualizador nos
-- espaços dele só entra no site de um dispositivo (navegador) que um
-- administrador liberou. O dispositivo é identificado por um id aleatório
-- guardado num cookie (`cf_device`) — limpar os dados do navegador gera um
-- dispositivo novo, que precisa ser liberado de novo.
--
-- Mesma ideia da janela de horário (0013/0014): o proprietário nunca é
-- bloqueado, e basta um dos donos exigir para o bloqueio valer no site todo.
-- Administradores dos espaços do dono também não precisam de liberação —
-- são eles que liberam.
--
-- Sem nenhuma linha em `device_approval_settings`, nada muda para ninguém.
-- É seguro rodar de novo.

-- -----------------------------------------------------------------------------
-- Quem administra a "empresa" de um dono: ele mesmo ou um admin de algum
-- espaço dele.
-- -----------------------------------------------------------------------------
create or replace function public.is_company_admin(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    p_owner = auth.uid()
    or exists (
      select 1
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where w.owner_id = p_owner
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );
$$;
revoke execute on function public.is_company_admin(uuid) from anon, public;
grant execute on function public.is_company_admin(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Liga/desliga, por proprietário
-- -----------------------------------------------------------------------------
create table if not exists public.device_approval_settings (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.device_approval_settings enable row level security;

drop policy if exists device_approval_settings_select on public.device_approval_settings;
create policy device_approval_settings_select on public.device_approval_settings
  for select to authenticated
  using (public.is_company_admin(owner_id));

drop policy if exists device_approval_settings_write on public.device_approval_settings;
create policy device_approval_settings_write on public.device_approval_settings
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Dispositivos pedidos/liberados, por dono e pessoa
-- -----------------------------------------------------------------------------
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  device_id    text not null check (char_length(device_id) between 16 and 64),
  label        text not null default '' check (char_length(label) <= 200),
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id) on delete set null,
  unique (owner_id, user_id, device_id)
);

create index if not exists devices_owner_idx on public.devices (owner_id, status);

alter table public.devices enable row level security;

-- Leitura: a própria pessoa e quem administra a empresa. Escrita só pelas
-- funções abaixo (nenhuma policy de insert/update/delete).
drop policy if exists devices_select on public.devices;
create policy devices_select on public.devices
  for select to authenticated
  using (user_id = auth.uid() or public.is_company_admin(owner_id));

-- -----------------------------------------------------------------------------
-- Donos que exigem liberação desta pessoa (uso interno das funções abaixo).
-- -----------------------------------------------------------------------------
create or replace function public.device_owners_requiring(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct w.owner_id
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  join public.device_approval_settings s on s.owner_id = w.owner_id and s.enabled
  where m.user_id = p_user
    and w.owner_id <> p_user
    -- Proprietário de qualquer espaço nunca é bloqueado (como na janela).
    and not exists (select 1 from public.workspaces w3 where w3.owner_id = p_user)
    -- Admin nos espaços daquele dono também não: é quem libera.
    and not exists (
      select 1
      from public.workspace_members m2
      join public.workspaces w2 on w2.id = m2.workspace_id
      where w2.owner_id = w.owner_id
        and m2.user_id = p_user
        and m2.role in ('owner', 'admin')
    );
$$;
revoke execute on function public.device_owners_requiring(uuid) from anon, public, authenticated;

-- -----------------------------------------------------------------------------
-- Situação deste dispositivo para quem está logado:
--   'ok' | 'unknown' (nunca pediu) | 'pending' | 'rejected'
-- -----------------------------------------------------------------------------
create or replace function public.device_status(p_device_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  falta boolean;
  pendente boolean;
  recusado boolean;
begin
  if eu is null then
    return 'ok';
  end if;

  select
    coalesce(bool_or(d.status is null), false),
    coalesce(bool_or(d.status = 'pending'), false),
    coalesce(bool_or(d.status = 'rejected'), false)
  into falta, pendente, recusado
  from public.device_owners_requiring(eu) as o(owner_id)
  left join public.devices d
    on d.owner_id = o.owner_id
   and d.user_id = eu
   and d.device_id = coalesce(p_device_id, '')
  where d.status is distinct from 'approved';

  if recusado then return 'rejected'; end if;
  if pendente then return 'pending'; end if;
  if falta then return 'unknown'; end if;
  return 'ok';
end;
$$;
revoke execute on function public.device_status(text) from anon, public;
grant execute on function public.device_status(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Pedir liberação deste dispositivo (para cada dono que exige). Pedido
-- recusado pode ser refeito; pedido pendente ou liberado não muda.
-- -----------------------------------------------------------------------------
create or replace function public.request_device_approval(p_device_id text, p_label text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  eu uuid := auth.uid();
  n integer;
begin
  if eu is null then
    raise exception 'Você precisa estar logado.' using errcode = '42501';
  end if;
  if p_device_id is null or char_length(p_device_id) not between 16 and 64 then
    raise exception 'Dispositivo inválido.' using errcode = '22023';
  end if;

  insert into public.devices (owner_id, user_id, device_id, label, status)
  select o, eu, p_device_id, left(coalesce(p_label, ''), 200), 'pending'
  from public.device_owners_requiring(eu) as o
  on conflict (owner_id, user_id, device_id) do update
    set status = 'pending',
        label = excluded.label,
        requested_at = now(),
        decided_at = null,
        decided_by = null
    where public.devices.status = 'rejected';

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.request_device_approval(text, text) from anon, public;
grant execute on function public.request_device_approval(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Liberar / recusar / remover — só quem administra a empresa do pedido.
-- -----------------------------------------------------------------------------
create or replace function public.decide_device(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dono uuid;
begin
  select owner_id into dono from public.devices where id = p_id;
  if dono is null or not public.is_company_admin(dono) then
    raise exception 'Você não pode decidir este pedido.' using errcode = '42501';
  end if;

  update public.devices
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_at = now(),
      decided_by = auth.uid()
  where id = p_id;
end;
$$;
revoke execute on function public.decide_device(uuid, boolean) from anon, public;
grant execute on function public.decide_device(uuid, boolean) to authenticated;

create or replace function public.remove_device(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dono uuid;
begin
  select owner_id into dono from public.devices where id = p_id;
  if dono is null or not public.is_company_admin(dono) then
    raise exception 'Você não pode remover este dispositivo.' using errcode = '42501';
  end if;

  delete from public.devices where id = p_id;
end;
$$;
revoke execute on function public.remove_device(uuid) from anon, public;
grant execute on function public.remove_device(uuid) to authenticated;
