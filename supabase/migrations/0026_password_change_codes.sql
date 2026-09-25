-- =============================================================================
-- 0026 — Código por e-mail para alterar a senha
-- =============================================================================
-- Configurações → Alterar senha manda um código de 6 dígitos para o e-mail da
-- conta; a senha só muda com o código certo, em até 10 minutos e 5
-- tentativas.
--
-- O banco guarda só um HMAC do código, calculado no servidor do site com um
-- segredo que o navegador não tem. Por isso, mesmo chamando estas funções
-- direto pela API, ninguém consegue "escolher" um código válido: só quem
-- recebeu o e-mail sabe qual é.
--
-- É seguro rodar de novo.

create table if not exists public.password_change_codes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  code_hmac text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.password_change_codes enable row level security;
-- Sem policies: só as funções abaixo mexem aqui.

create or replace function public.set_password_code(p_hmac text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  -- Um código por minuto, no máximo: evita encher a caixa de alguém.
  if exists (
    select 1 from public.password_change_codes
    where user_id = auth.uid() and created_at > now() - interval '1 minute'
  ) then
    raise exception 'Aguarde um minuto antes de pedir outro código.' using errcode = 'P0001';
  end if;

  insert into public.password_change_codes (user_id, code_hmac, expires_at, attempts, created_at)
  values (auth.uid(), p_hmac, now() + interval '10 minutes', 0, now())
  on conflict (user_id) do update
    set code_hmac = excluded.code_hmac,
        expires_at = excluded.expires_at,
        attempts = 0,
        created_at = now();
end;
$$;

-- 'ok' | 'invalido' | 'expirado' | 'tentativas'. Com 'ok' o código é gasto.
create or replace function public.check_password_code(p_hmac text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c public.password_change_codes;
begin
  select * into c from public.password_change_codes where user_id = auth.uid() for update;

  if c.user_id is null then
    return 'expirado';
  end if;
  if c.expires_at < now() then
    delete from public.password_change_codes where user_id = auth.uid();
    return 'expirado';
  end if;
  if c.attempts >= 5 then
    delete from public.password_change_codes where user_id = auth.uid();
    return 'tentativas';
  end if;
  if c.code_hmac = p_hmac then
    delete from public.password_change_codes where user_id = auth.uid();
    return 'ok';
  end if;

  update public.password_change_codes set attempts = attempts + 1 where user_id = auth.uid();
  return 'invalido';
end;
$$;

grant execute on function public.set_password_code(text) to authenticated;
grant execute on function public.check_password_code(text) to authenticated;
revoke execute on function public.set_password_code(text) from anon, public;
revoke execute on function public.check_password_code(text) from anon, public;
