#!/usr/bin/env bash
# =============================================================================
# Chroma Flux — preparação da VPS (Ubuntu 22.04/24.04 limpo), rodar como root.
#
# Antes deste script, rode o "bootstrap" (ver deploy/README-VPS.md): ele cria a
# deploy key em /root/.ssh/chroma_flux_deploy e clona este repositório.
#
# O que este script faz:
#   1. Atualiza o sistema, cria swap e ajusta o fuso para America/Bahia.
#   2. Instala Node 22, PM2, Nginx, Certbot e o firewall (UFW).
#   3. Cria o usuário `flux`, dono do site em /opt/chroma-flux.
#   4. Grava as variáveis de ambiente (pede a RESEND_API_KEY sem mostrar).
#   5. Faz o primeiro build e sobe o site no PM2 (reinicia sozinho no boot).
#   6. Configura o Nginx e, se o DNS já apontar para cá, o HTTPS.
#   7. Gera a chave que o GitHub Actions usa para publicar a cada push.
#
# O Supabase (banco, login, storage, functions) roda auto-hospedado (Docker)
# nesta mesma VPS, em https://api.chromaflux.com.br — ver
# deploy/supabase/MIGRAR-SUPABASE.md. Se esta VPS ainda não tiver o Supabase
# rodando, esse roteiro precisa ser feito antes (ou o site sobe sem banco).
#
# Pode rodar de novo sem estragar nada: cada passo verifica o que já existe.
# =============================================================================
set -euo pipefail

DOMAIN="chromaflux.com.br"
REPO_SSH="git@github.com:igorliger/chroma-flux.git"
APP_USER="flux"
APP_DIR="/opt/chroma-flux"
# Supabase auto-hospedado (Docker) nesta mesma VPS — ver deploy/supabase/MIGRAR-SUPABASE.md.
SUPABASE_URL="https://api.chromaflux.com.br"
# Chave publicável (ANON_KEY): é pública por design (quem protege os dados é a RLS).
SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkwNDc2MDc2LCJleHAiOjIxMDU4MzYwNzZ9.jkwOTYosXok99g2ZBrB9rmHZml4NcAAHQJkjLrmx8bc"
FROM_EMAIL="Chroma Flux <convites@chromaflux.com.br>"
DEPLOY_KEY="/root/.ssh/chroma_flux_deploy"

verde() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
aviso() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Rode como root (sudo -i)."; exit 1; }
[[ -f "$DEPLOY_KEY" ]] || { echo "Deploy key não encontrada em $DEPLOY_KEY — rode o bootstrap primeiro."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
SETUP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
verde "1/8 Atualizando o sistema"
apt-get update -q
apt-get upgrade -yq
apt-get install -yq curl git nginx ufw certbot python3-certbot-nginx ca-certificates gnupg
timedatectl set-timezone America/Bahia || true

if ! swapon --show | grep -q .; then
  verde "Criando 2 GB de swap (o build do Next consome bastante memória)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------------------
verde "2/8 Instalando Node 22 e PM2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2@latest
node -v

# ---------------------------------------------------------------------------
verde "3/8 Criando o usuário $APP_USER e as pastas"
id "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR" "$APP_DIR/releases" "$APP_DIR/shared"

# Deploy key (só leitura no GitHub) passa para o usuário do site.
install -m 600 -o "$APP_USER" -g "$APP_USER" "$DEPLOY_KEY" "$APP_HOME/.ssh/github_deploy"
install -m 644 -o "$APP_USER" -g "$APP_USER" "$DEPLOY_KEY.pub" "$APP_HOME/.ssh/github_deploy.pub"
cat > "$APP_HOME/.ssh/config" <<CFG
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
CFG
ssh-keyscan -t ed25519 github.com 2>/dev/null >> "$APP_HOME/.ssh/known_hosts"
sort -u -o "$APP_HOME/.ssh/known_hosts" "$APP_HOME/.ssh/known_hosts"
chown "$APP_USER:$APP_USER" "$APP_HOME/.ssh/config" "$APP_HOME/.ssh/known_hosts"
chmod 600 "$APP_HOME/.ssh/config"

if [[ ! -d "$APP_DIR/repo/.git" ]]; then
  sudo -u "$APP_USER" -H git clone -q "$REPO_SSH" "$APP_DIR/repo"
fi
sudo -u "$APP_USER" -H git -C "$APP_DIR/repo" fetch -q origin main
sudo -u "$APP_USER" -H git -C "$APP_DIR/repo" reset -q --hard origin/main

# ---------------------------------------------------------------------------
verde "4/8 Variáveis de ambiente"
ENV_FILE="$APP_DIR/shared/.env.production"
if [[ -f "$ENV_FILE" ]] && grep -q '^RESEND_API_KEY=re_' "$ENV_FILE"; then
  echo "Já existe $ENV_FILE com a chave do Resend — mantendo."
else
  echo "Cole a RESEND_API_KEY (a mesma que está na Vercel, começa com re_)."
  echo "Ela não aparece na tela enquanto você cola. Tecle Enter no final."
  read -rs RESEND_KEY
  echo
  RESEND_KEY="$(printf '%s' "$RESEND_KEY" | tr -d '[:space:]')"
  [[ "$RESEND_KEY" == re_* ]] || aviso "A chave não começa com re_ — confira depois em $ENV_FILE."
  umask 077
  cat > "$ENV_FILE" <<ENV
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL=https://www.$DOMAIN
RESEND_API_KEY=$RESEND_KEY
RESEND_FROM_EMAIL=$FROM_EMAIL
ENV
  umask 022
  unset RESEND_KEY
fi
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------------------------------------------------------------------------
verde "5/8 Primeiro build (leva alguns minutos)"
sudo -u "$APP_USER" -H bash "$APP_DIR/repo/deploy/deploy.sh"

# PM2 volta sozinho depois de um reboot.
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null
sudo -u "$APP_USER" -H pm2 save >/dev/null

# Atalho para publicar na mão: `sudo -u flux flux-deploy`
cat > /usr/local/bin/flux-deploy <<'BIN'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/chroma-flux/repo
git fetch -q origin main
git reset -q --hard origin/main
exec bash deploy/deploy.sh
BIN
chmod 755 /usr/local/bin/flux-deploy

# ---------------------------------------------------------------------------
verde "6/8 Nginx"
install -m 644 "$APP_DIR/repo/deploy/nginx-chroma-flux.conf" /etc/nginx/sites-available/chroma-flux
ln -sfn /etc/nginx/sites-available/chroma-flux /etc/nginx/sites-enabled/chroma-flux
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

# ---------------------------------------------------------------------------
verde "7/8 Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

# ---------------------------------------------------------------------------
verde "8/8 Chave para o GitHub Actions publicar a cada push"
ACTIONS_KEY="$APP_HOME/.ssh/github_actions"
if [[ ! -f "$ACTIONS_KEY" ]]; then
  sudo -u "$APP_USER" -H ssh-keygen -q -t ed25519 -N "" -C "github-actions@chroma-flux" -f "$ACTIONS_KEY"
fi
touch "$APP_HOME/.ssh/authorized_keys"
grep -qF "$(cat "$ACTIONS_KEY.pub")" "$APP_HOME/.ssh/authorized_keys" || cat "$ACTIONS_KEY.pub" >> "$APP_HOME/.ssh/authorized_keys"
chown "$APP_USER:$APP_USER" "$APP_HOME/.ssh/authorized_keys"
chmod 600 "$APP_HOME/.ssh/authorized_keys"

IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"

# HTTPS só funciona depois que o DNS aponta para esta VPS.
if [[ "$(getent ahostsv4 "www.$DOMAIN" | awk 'NR==1{print $1}')" == "$IP" ]]; then
  bash "$APP_DIR/repo/deploy/ssl.sh"
else
  aviso "O DNS de www.$DOMAIN ainda não aponta para $IP. Depois de trocar o DNS, rode:  bash $APP_DIR/repo/deploy/ssl.sh"
fi

cat <<FIM

=============================================================================
 Pronto! O site já está rodando nesta VPS (IP $IP).

 Teste agora, antes de mexer no DNS:  http://$IP/login

 No GitHub (Settings > Secrets and variables > Actions > New repository secret):
   VPS_HOST    = $IP
   VPS_SSH_KEY = tudo o que aparece entre as linhas abaixo (inclusive BEGIN/END):
-----------------------------------------------------------------------------
$(cat "$ACTIONS_KEY")
-----------------------------------------------------------------------------
=============================================================================
FIM
