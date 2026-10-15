#!/usr/bin/env bash
# =============================================================================
# Chroma Flux — liga a aplicação automática de migrações na publicação.
# Rodar UMA vez na VPS, como root:
#   sudo bash /opt/chroma-flux/repo/deploy/instalar-migracoes.sh
#
# Instala /usr/local/bin/flux-migrate (dono root, só o root edita) e deixa o
# usuário `flux` rodar só esse comando como root, sem senha. Depois disso,
# todo `flux-deploy` aplica sozinho as migrações novas. Já aplica as
# pendentes agora. É seguro rodar de novo.
# =============================================================================
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }

cd /opt/chroma-flux/repo
sudo -u flux git fetch -q origin main
sudo -u flux git reset -q --hard origin/main

install -o root -g root -m 755 deploy/flux-migrate.sh /usr/local/bin/flux-migrate

echo 'flux ALL=(root) NOPASSWD: /usr/local/bin/flux-migrate' > /etc/sudoers.d/flux-migrate.tmp
chmod 440 /etc/sudoers.d/flux-migrate.tmp
visudo -cf /etc/sudoers.d/flux-migrate.tmp >/dev/null
mv /etc/sudoers.d/flux-migrate.tmp /etc/sudoers.d/flux-migrate

/usr/local/bin/flux-migrate
echo
echo "PRONTO: migrações automáticas ligadas."
