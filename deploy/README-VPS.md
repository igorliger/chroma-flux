# Chroma Flux na VPS (Hostinger)

Só o site (Next.js) roda na VPS. Banco, login, arquivos, e-mails de
notificação e cron continuam no Supabase — nada muda lá.

```
navegador ──► Nginx (HTTPS, Let's Encrypt) ──► PM2 ──► next start :3000
                                                         │
                                                         └──► Supabase (igual hoje)
```

## 1. Bootstrap (terminal da VPS, como root)

```bash
apt-get update && apt-get install -y git
ssh-keygen -t ed25519 -N "" -C chroma-flux-vps -f /root/.ssh/chroma_flux_deploy
cat /root/.ssh/chroma_flux_deploy.pub
```

Copie a linha `ssh-ed25519 ...` e cadastre em
GitHub > igorliger/chroma-flux > Settings > Deploy keys > Add deploy key
(título "VPS Hostinger", **sem** marcar "Allow write access").

```bash
GIT_SSH_COMMAND="ssh -i /root/.ssh/chroma_flux_deploy -o StrictHostKeyChecking=accept-new" \
  git clone git@github.com:igorliger/chroma-flux.git /root/chroma-flux-setup
bash /root/chroma-flux-setup/deploy/setup-vps.sh
```

## 2. Publicação automática

No fim, o script mostra o IP e uma chave privada. Crie dois segredos em
GitHub > Settings > Secrets and variables > Actions:
`VPS_HOST` (o IP) e `VPS_SSH_KEY` (a chave inteira, com BEGIN/END).

A partir daí, cada `git push origin master:main` publica na VPS
(aba Actions do GitHub mostra o andamento). Publicar na mão, na VPS:
`sudo -u flux flux-deploy`.

## 3. DNS e HTTPS

Aponte `chromaflux.com.br` e `www` (registros A) para o IP da VPS — troque só
esses dois registros; os do Resend (`send`, `resend._domainkey`, `_dmarc`)
precisam continuar como estão. Depois de propagar:
`bash /opt/chroma-flux/repo/deploy/ssl.sh`.

## Comandos úteis

| Para | Comando |
|---|---|
| Ver se está no ar | `sudo -u flux pm2 status` |
| Ver logs | `sudo -u flux pm2 logs chroma-flux --lines 100` |
| Reiniciar | `sudo -u flux pm2 reload chroma-flux` |
| Voltar uma versão | `ls /opt/chroma-flux/releases` e apontar `current` para a anterior |
| Trocar variável | editar `/opt/chroma-flux/shared/.env.production` e rodar `flux-deploy` |
