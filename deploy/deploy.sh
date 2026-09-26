#!/usr/bin/env bash
# =============================================================================
# Chroma Flux — publica o que está em /opt/chroma-flux/repo (rodar como `flux`).
#
# Cada publicação vira uma pasta nova em releases/. Só depois do build dar
# certo o link `current` passa a apontar para ela, então um build com erro
# nunca derruba o site. Se o site não responder depois da troca, volta
# sozinho para a versão anterior.
# =============================================================================
set -euo pipefail

APP_DIR="/opt/chroma-flux"
REPO="$APP_DIR/repo"
KEEP=3
PORT=3000

SHA="$(git -C "$REPO" rev-parse --short HEAD)"
REL="$APP_DIR/releases/$(date +%Y%m%d-%H%M%S)-$SHA"
PREV="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"

echo "==> Publicando $SHA em $REL"
mkdir -p "$REL"
trap 'echo "!! Falhou — o site continua na versão anterior."; rm -rf "$REL"' ERR

git -C "$REPO" archive HEAD | tar -x -C "$REL"
ln -sfn "$APP_DIR/shared/.env.production" "$REL/.env.production"

cd "$REL"
npm ci --no-audit --no-fund --loglevel=error
NEXT_TELEMETRY_DISABLED=1 npm run build

trap - ERR

troca() {
  ln -sfn "$1" "$APP_DIR/current.tmp"
  mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
  if pm2 describe chroma-flux >/dev/null 2>&1; then
    pm2 reload chroma-flux --update-env >/dev/null
  else
    pm2 start "$APP_DIR/current/deploy/ecosystem.config.cjs" >/dev/null
  fi
}

no_ar() {
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login" && return 0
    sleep 1
  done
  return 1
}

troca "$REL"
if no_ar; then
  pm2 save >/dev/null
  echo "==> No ar: $SHA"
else
  echo "!! O site não respondeu depois da troca."
  if [[ -n "$PREV" && -d "$PREV" ]]; then
    echo "!! Voltando para $(basename "$PREV")"
    troca "$PREV"
    no_ar || true
  fi
  exit 1
fi

# Guarda só as últimas versões (cada uma tem o próprio node_modules).
ls -1dt "$APP_DIR"/releases/*/ | tail -n +$((KEEP + 1)) | xargs -r rm -rf
