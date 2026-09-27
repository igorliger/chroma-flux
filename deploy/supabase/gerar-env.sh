#!/usr/bin/env bash
# Gera o /opt/supabase/.env do Supabase auto-hospedado com segredos novos.
# Rodar como root, depois de copiar supabase/docker para /opt/supabase.
# Nada aqui é impresso na tela: os valores ficam só no .env (chmod 600).
set -euo pipefail
cd /opt/supabase
[[ -f .env ]] && { echo ".env já existe — não sobrescrevo. Apague-o antes se quiser gerar de novo."; exit 1; }
cp .env.example .env
chmod 600 .env

set_env() {  # set_env CHAVE VALOR
  if grep -q "^$1=" .env; then
    python3 - "$1" "$2" <<'PY'
import sys,re,pathlib
k,v=sys.argv[1],sys.argv[2]; p=pathlib.Path(".env"); s=p.read_text()
s=re.sub(rf"^{re.escape(k)}=.*$", lambda m:f"{k}={v}", s, flags=re.M); p.write_text(s)
PY
  else
    echo "$1=$2" >> .env
  fi
}
hex() { openssl rand -hex "$1"; }

jwt() {  # jwt SEGREDO PAPEL
  node -e '
    const c=require("crypto"),[s,role]=process.argv.slice(1);
    const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
    const now=Math.floor(Date.now()/1000);
    const h=b({alg:"HS256",typ:"JWT"}), p=b({role,iss:"supabase",iat:now,exp:now+10*365*24*3600});
    console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"));
  ' "$1" "$2"
}

JWT_SECRET="$(hex 32)"
set_env POSTGRES_PASSWORD "$(hex 24)"
set_env JWT_SECRET "$JWT_SECRET"
set_env ANON_KEY "$(jwt "$JWT_SECRET" anon)"
set_env SERVICE_ROLE_KEY "$(jwt "$JWT_SECRET" service_role)"
set_env DASHBOARD_USERNAME "igor"
set_env DASHBOARD_PASSWORD "$(hex 16)"
set_env SECRET_KEY_BASE "$(hex 32)"
set_env VAULT_ENC_KEY "$(hex 16)"          # 32 caracteres
set_env PG_META_CRYPTO_KEY "$(hex 16)"
set_env LOGFLARE_PUBLIC_ACCESS_TOKEN "$(hex 24)"
set_env LOGFLARE_PRIVATE_ACCESS_TOKEN "$(hex 24)"
set_env POOLER_TENANT_ID "chromaflux"

set_env SITE_URL "https://www.chromaflux.com.br"
set_env ADDITIONAL_REDIRECT_URLS "https://www.chromaflux.com.br/**,https://chromaflux.com.br/**"
set_env API_EXTERNAL_URL "https://api.chromaflux.com.br"
set_env SUPABASE_PUBLIC_URL "https://api.chromaflux.com.br"
set_env FUNCTIONS_VERIFY_JWT "false"
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "false"
set_env ENABLE_ANONYMOUS_USERS "false"

# E-mails do login (recuperar senha, confirmação) saem pelo Resend via SMTP,
# com a mesma chave que o site já usa.
RESEND_KEY="$(grep '^RESEND_API_KEY=' /opt/chroma-flux/shared/.env.production | cut -d= -f2-)"
set_env SMTP_HOST "smtp.resend.com"
set_env SMTP_PORT "465"
set_env SMTP_USER "resend"
set_env SMTP_PASS "$RESEND_KEY"
set_env SMTP_ADMIN_EMAIL "convites@chromaflux.com.br"
set_env SMTP_SENDER_NAME "Chroma Flux"
unset RESEND_KEY JWT_SECRET

echo "OK: /opt/supabase/.env gerado. Placeholders que sobraram (conferir):"
grep -nE "your-|super-secret|this_password|changeme" .env | cut -d= -f1 || echo "  nenhum"
