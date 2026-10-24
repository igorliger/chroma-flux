#!/usr/bin/env bash
# =============================================================================
# Chroma Flux — desliga os programas do Supabase que o site não usa.
#
#   sudo bash /opt/chroma-flux/repo/deploy/supabase/enxugar.sh            # só mostra o plano
#   sudo bash /opt/chroma-flux/repo/deploy/supabase/enxugar.sh aplicar    # aplica (com volta automática)
#   sudo bash /opt/chroma-flux/repo/deploy/supabase/enxugar.sh desfazer   # religa tudo como antes
#   sudo bash /opt/chroma-flux/repo/deploy/supabase/enxugar.sh studio     # liga o Studio (painel) por um tempo
#
# O site usa: banco (db), login (auth), API (rest), anexos (storage), funções
# (functions: push e convite) e a porta de entrada (kong/envoy). Ficam
# desligados: studio, meta, realtime, imgproxy, analytics, vector e o pooler
# (supavisor) — nenhum é usado pelo código (conferido em 24/10/2026).
#
# Como: um `docker-compose.override.yml` põe os desligados no perfil
# "desligado" e tira deles as dependências de quem fica (`!override`, Compose
# 2.24.4+). Nenhum dado é apagado — volumes e a pasta volumes/ ficam intactos.
# Se o login, a API, os anexos ou as funções não responderem depois, o script
# volta sozinho para a configuração anterior.
# =============================================================================
set -euo pipefail

DIR="/opt/chroma-flux/supabase"
OVR="$DIR/docker-compose.override.yml"
MARCA="# gerado por enxugar.sh"
DESLIGAR=(studio meta realtime imgproxy analytics vector supavisor pooler)
MODO="${1:-verificar}"

[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
cd "$DIR"

versao="$(docker compose version --short 2>/dev/null || echo 0)"
if ! printf '2.24.4\n%s\n' "${versao#v}" | sort -V -C; then
  echo "!! Docker Compose $versao é antigo (precisa 2.24.4 ou mais novo). Nada foi feito."
  exit 1
fi

if [[ -f "$OVR" ]] && ! grep -q "$MARCA" "$OVR"; then
  echo "!! Já existe um $OVR que não foi feito por este script. Nada foi feito."
  exit 1
fi

saude() {
  # Lê a chave pública (anon) do .env do Supabase sem mostrar.
  local k
  k="$(grep -E '^ANON_KEY=' "$DIR/.env" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  local ok=0 c
  for _ in $(seq 1 30); do
    ok=1
    c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $k" http://127.0.0.1:8000/auth/v1/health); [[ $c == 200 ]] || ok=0
    c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $k" "http://127.0.0.1:8000/rest/v1/holidays?select=id&limit=1"); [[ $c == 200 ]] || ok=0
    c=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $k" http://127.0.0.1:8000/storage/v1/status); [[ $c == 200 ]] || ok=0
    c=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "apikey: $k" http://127.0.0.1:8000/functions/v1/push); [[ $c =~ ^[0-4] ]] || ok=0
    (( ok )) && return 0
    sleep 4
  done
  return 1
}

case "$MODO" in
  desfazer)
    [[ -f "$OVR" ]] && mv "$OVR" "$OVR.desfeito.$(date +%Y%m%d-%H%M%S)"
    docker compose up -d
    echo "==> Tudo religado como antes."
    exit 0 ;;
  studio)
    echo "==> Ligando o Studio (http://localhost:8000 pelo túnel SSH)."
    docker compose --profile desligado up -d studio
    echo "    Para desligar de novo: docker compose -f $DIR/docker-compose.yml -f $OVR stop studio meta"
    exit 0 ;;
esac

# Monta o override a partir da configuração atual (sem o override antigo).
cfg="$(mktemp)"; trap 'rm -f "$cfg"' EXIT
docker compose -f docker-compose.yml config --format json > "$cfg"

novo="$(python3 - "$cfg" "$MARCA" "${DESLIGAR[@]}" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1]))
marca, alvo = sys.argv[2], set(sys.argv[3:])
servicos = cfg["services"]
desl = sorted(s for s in servicos if s in alvo)
if not desl:
    sys.exit("nenhum dos serviços a desligar existe neste compose")
linhas = [marca, "services:"]
for s in desl:
    linhas += [f"  {s}:", '    profiles: ["desligado"]']
    # O Studio, quando ligado à mão, só precisa do meta.
    if s == "studio":
        linhas += ["    depends_on: !override", "      meta:", "        condition: service_started"]
    if s == "meta":
        linhas += ["    depends_on: !override", "      db:", "        condition: service_healthy"]
for s, d in servicos.items():
    if s in desl:
        continue
    deps = d.get("depends_on") or {}
    fica = {k: v for k, v in deps.items() if k not in desl}
    extra = []
    if s == "storage":
        extra = ["    environment:", '      ENABLE_IMAGE_TRANSFORMATION: "false"']
    if len(fica) == len(deps) and not extra:
        continue
    linhas.append(f"  {s}:")
    if len(fica) != len(deps):
        if fica:
            linhas.append("    depends_on: !override")
            for k, v in fica.items():
                linhas += [f"      {k}:", f"        condition: {v.get('condition', 'service_started')}"]
        else:
            linhas.append("    depends_on: !reset []")
    linhas += extra
print("\n".join(linhas))
PY
)"

echo "==> Docker Compose $versao"
echo "==> Serão desligados: $(grep -B1 'profiles: \["desligado"\]' <<<"$novo" | grep -oE '^  [a-z_-]+' | xargs)"
echo "==> Override que será gravado em $OVR:"
echo "------------------------------------------------------------------"
echo "$novo"
echo "------------------------------------------------------------------"

if [[ "$MODO" != "aplicar" ]]; then
  echo "Nada foi mudado. Para aplicar: sudo bash $0 aplicar"
  exit 0
fi

# Confere se o compose aceita o override antes de mexer em qualquer coisa.
tmp="$(mktemp --suffix=.yml)"; echo "$novo" > "$tmp"
docker compose -f docker-compose.yml -f "$tmp" config -q || { echo "!! O compose recusou o override. Nada foi feito."; rm -f "$tmp"; exit 1; }

[[ -f "$OVR" ]] && cp "$OVR" "$OVR.antes.$(date +%Y%m%d-%H%M%S)"
mv "$tmp" "$OVR"; chmod 644 "$OVR"

desligados=$(grep -B1 'profiles: \["desligado"\]' "$OVR" | grep -oE '^  [a-z_-]+' | xargs)
imagens=$(python3 -c 'import json,sys; c=json.load(open(sys.argv[1]))["services"]; print(" ".join(sorted({c[s]["image"] for s in sys.argv[2:] if s in c and c[s].get("image")})))' "$cfg" $desligados)
echo "==> Recriando os serviços que ficam e parando: $desligados"
docker compose up -d
# shellcheck disable=SC2086
docker compose --profile desligado stop $desligados
# shellcheck disable=SC2086
docker compose --profile desligado rm -f $desligados

echo "==> Testando login, API, anexos e funções…"
if saude; then
  echo "==> Tudo respondendo. Pronto!"
  echo "    Memória agora:"; docker stats --no-stream --format '    {{.Name}} {{.MemUsage}}' | grep -i supabase || true
  echo "    As imagens dos desligados continuam no disco (para religar rápido)."
  echo "    Para liberar o espaço delas, depois de uns dias com tudo bem:"
  echo "    docker image rm $imagens"
else
  echo "!! Algo não respondeu. Voltando para a configuração anterior…"
  mv "$OVR" "$OVR.falhou.$(date +%Y%m%d-%H%M%S)"
  docker compose up -d
  saude && echo "==> Voltou ao normal (tudo ligado)." || echo "!! Verifique: docker compose ps"
  exit 1
fi
