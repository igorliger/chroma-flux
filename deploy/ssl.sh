#!/usr/bin/env bash
# Emite o certificado HTTPS (Let's Encrypt) e liga o redirecionamento para
# https. Rodar como root depois que o DNS já aponta para a VPS. A renovação
# fica automática (timer do certbot).
set -euo pipefail
DOMAIN="chromaflux.com.br"
EMAIL="contato@chromatechnology.com.br"
certbot --nginx -n --agree-tos -m "$EMAIL" --redirect \
  -d "$DOMAIN" -d "www.$DOMAIN"
systemctl reload nginx
echo "==> HTTPS ativo: https://www.$DOMAIN"
