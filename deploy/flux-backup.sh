#!/usr/bin/env bash
# Chroma Flux — backup diário do banco (e dos anexos) do Supabase da VPS.
#
# Cópia de referência do script instalado em /opt/chroma-flux/bin/flux-backup
# (link em /usr/local/bin/flux-backup). Agendado no cron do root para 03:30.
# Mantém os últimos 14 dias em /opt/chroma-flux/backups e envia uma cópia ao
# Google Drive do Igor ("Chroma Flux - Backups") via rclone (remoto `gdrive:`,
# config em /root/.config/rclone/rclone.conf — nunca imprimir o token).
#
# Se o envio ao Drive falhar com "invalid_grant", a autorização do Google
# expirou: ver "Backup" no CLAUDE.md para reconectar.
set -euo pipefail

BACKUP_DIR=/opt/chroma-flux/backups
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/supabase-$TS.sql.gz"

docker exec supabase-db pg_dump -U postgres -d postgres | gzip > "$OUT"
chmod 600 "$OUT"

# Falha no envio ao Drive não derruba o backup local, que é o que protege os
# dados de verdade — o Drive é a cópia extra, fora da VPS.
rclone copy "$OUT" "gdrive:Chroma Flux - Backups/" \
  || echo "flux-backup: aviso — não consegui enviar o backup ao Google Drive." >&2

find "$BACKUP_DIR" -maxdepth 1 -name 'supabase-*.sql.gz' -mtime +14 -delete

# Anexos (Storage do Supabase): cópia incremental para o Drive, só envia o que
# mudou. O pg_dump acima guarda só os metadados dos arquivos, não o conteúdo.
rclone copy /opt/chroma-flux/supabase/volumes/storage "gdrive:Chroma Flux - Backups/anexos" \
  || echo "flux-backup: aviso - nao consegui enviar os anexos ao Google Drive." >&2
