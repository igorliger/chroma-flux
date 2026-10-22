#!/usr/bin/env bash
# =============================================================================
# Limpeza automática da VPS (roda como root, a cada 3 dias às 04:15 — cron em
# /etc/cron.d/vps-limpeza; registro em /var/log/vps-limpeza.log).
#
# Só apaga o que é seguro para todos os sistemas da VPS (Chroma Flux,
# ChromaStock, ChromaZap, SellerChroma):
#   - cache de construção do Docker e imagens "órfãs" (sem nome);
#   - logs de container maiores que 100 MB (esvazia o arquivo);
#   - caches do npm e do apt;
#   - logs do sistema acima de 200 MB.
# NÃO mexe em volumes, imagens com nome, containers, backups nem anexos.
# Instalado em /usr/local/bin/vps-limpeza (cópia deste arquivo).
# =============================================================================
set -u

echo "===== $(date '+%d/%m/%Y %H:%M') ====="
echo "Antes:  $(df -h / | awk 'NR==2 {print $3 " usados, " $4 " livres"}')"

docker builder prune -af >/dev/null 2>&1 || echo "aviso: docker builder prune falhou"
docker image prune -f >/dev/null 2>&1 || echo "aviso: docker image prune falhou"
find /var/lib/docker/containers -name '*-json.log' -size +100M -exec truncate -s 0 {} \; 2>/dev/null
npm cache clean --force >/dev/null 2>&1 || true
sudo -u flux npm cache clean --force >/dev/null 2>&1 || true
apt-get clean >/dev/null 2>&1 || true
journalctl --vacuum-size=200M >/dev/null 2>&1 || true

echo "Depois: $(df -h / | awk 'NR==2 {print $3 " usados, " $4 " livres"}')"
