#!/usr/bin/env bash
# =============================================================================
# Chroma Flux — aplica no banco as migrações novas (roda como root).
#
# Instalado em /usr/local/bin/flux-migrate por `deploy/instalar-migracoes.sh`.
# O `deploy.sh` chama com `sudo -n` (o flux só pode rodar este script, sem
# senha — ver /etc/sudoers.d/flux-migrate), depois do build e antes de trocar
# o site, então publicar já deixa o banco em dia.
#
# Lê as migrações da cópia de deploy (/opt/chroma-flux/repo, que acabou de
# ser atualizada com a main) e anota as aplicadas em `flux.migrations`
# (schema fora da API). Cada migração roda numa transação só: se der erro,
# nada dela fica no banco, o script para e a publicação é cancelada.
#
# Primeira vez: marca 0001–0033 como já aplicadas (foram rodadas à mão) e
# roda de novo 0034 e 0035, que são seguras de repetir.
# =============================================================================
set -euo pipefail

DIR="/opt/chroma-flux/repo/supabase/migrations"
BASE="0033"
CONTAINER="supabase-db"

psql_db() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"
}

psql_db <<'SQL'
create schema if not exists flux;
revoke all on schema flux from public;
create table if not exists flux.migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
SQL

if [[ "$(psql_db -c 'select count(*) from flux.migrations')" == "0" ]]; then
  for f in "$DIR"/*.sql; do
    n="$(basename "$f" .sql)"
    [[ "${n:0:4}" > "$BASE" ]] && continue
    psql_db -c "insert into flux.migrations (name) values ('$n') on conflict do nothing"
  done
  echo "==> Migrações até $BASE marcadas como já aplicadas."
fi

aplicadas="$(psql_db -c 'select name from flux.migrations')"
novas=0
for f in "$DIR"/*.sql; do
  n="$(basename "$f" .sql)"
  [[ "$n" =~ ^[0-9]{4}_[a-z0-9_]+$ ]] || { echo "!! Nome de migração inválido: $n"; exit 1; }
  grep -qxF "$n" <<<"$aplicadas" && continue

  echo "==> Aplicando migração $n"
  {
    echo "begin;"
    cat "$f"
    echo
    echo "insert into flux.migrations (name) values ('$n');"
    echo "commit;"
  } | psql_db
  novas=$((novas + 1))
done

if (( novas > 0 )); then
  psql_db -c "notify pgrst, 'reload schema'"
  echo "==> $novas migração(ões) aplicada(s)."
else
  echo "==> Banco já em dia."
fi
