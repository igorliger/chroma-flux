# Migrar o Supabase do Chroma Flux da nuvem para a VPS

Roteiro para o **Claude Code rodando na VPS** (root@srv2012841) executar com o Igor
aprovando cada passo. Leia tudo antes de começar. Pare e pergunte ao Igor se algo
sair diferente do esperado — não improvise em cima de dados de produção.

## Contexto

- Site Next.js já roda nesta VPS: `/opt/chroma-flux` (PM2 do usuário `flux`,
  Nginx + Let's Encrypt, publicar com `sudo -u flux flux-deploy`).
- Supabase de origem (nuvem): projeto `zdkgujlkdtxiabxntuce`, Postgres 17,
  região ca-central-1. **Pequeno:** ~14 MB, 8 usuários, 57 tarefas, bucket
  `anexos` vazio.
- Extensões usadas: pgcrypto, uuid-ossp, pg_net, pg_cron, supabase_vault.
- 2 Edge Functions (ambas `verify_jwt = false`): `push` e `invite-login` —
  código em `/opt/chroma-flux/repo/supabase/functions/`.
- 1 job pg_cron: `push-reminders` (`*/5 * * * *`) → `public.call_push_function`.
- 3 segredos no Vault: `push_vapid_public_key`, `push_vapid_private_key`,
  `push_webhook_secret`. A chave pública VAPID também está fixa no código do site
  (`src/lib/push.ts`), então **o par VAPID precisa ser o mesmo** — copie os
  valores, não gere novos.
- Destino: Supabase auto-hospedado (Docker) nesta VPS, exposto em
  `https://api.chromaflux.com.br` pelo Nginx.

## Regras de segurança

- Nunca imprima segredos no terminal (senhas, JWT secret, service_role, chaves do
  Vault, chave do Resend). Passe por variáveis/arquivos com `chmod 600`.
- Nada do Supabase fica exposto direto na internet: Kong, Postgres e Supavisor
  escutam só em `127.0.0.1`. **Atenção:** o Docker ignora o UFW ao publicar portas
  — por isso é obrigatório trocar `"porta:porta"` por `"127.0.0.1:porta:porta"`
  no docker-compose.
- Não apague nem pause o projeto na nuvem. Ele é o plano de volta.

---

## Passo 0 — Antes (Igor)

1. hPanel › VPS › Backups e monitoramento: **criar um snapshot** da VPS.
2. registro.br › chromaflux.com.br › Configurar zona DNS: **Nova entrada**
   `A` · nome `api` · `179.199.150.51` · Salvar.
3. Ter à mão a **connection string do banco na nuvem**: Supabase › projeto
   Chroma Flux › botão **Connect** › *Session pooler* (porta 5432, IPv4). Se não
   souber a senha do banco: Project Settings › Database › *Reset database password*.
4. Salvar essa connection string (já com a senha no lugar de `[YOUR-PASSWORD]`)
   num arquivo que só o root lê — num SSH **separado**, fora do Claude:
   `install -m 600 /dev/null /root/.old_db_url && nano /root/.old_db_url`
   (colar com o botão direito, Ctrl+O, Enter, Ctrl+X). O Claude lê daí sem que
   a senha passe pela conversa. Apagar o arquivo no fim da migração.

## Passo 1 — Docker

```bash
apt-get update && apt-get install -y ca-certificates curl gnupg postgresql-client
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
docker compose version
```

`postgresql-client` precisa ser versão ≥ 17 para o `pg_dump` bater com a nuvem.
Se o do Ubuntu for mais antigo, use o `pg_dump` de dentro de um container
`postgres:17` (ver passo 5).

## Passo 2 — Supabase auto-hospedado

```bash
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase-src
cp -r /opt/supabase-src/docker /opt/supabase
bash /opt/chroma-flux/repo/deploy/supabase/gerar-env.sh
```

- Confira o `.env.example` da versão baixada: se houver variável nova com valor
  de exemplo que o script não cobriu, gere um valor aleatório para ela.
- `DASHBOARD_PASSWORD` foi gerada aleatória. Para o Igor acessar o Studio depois:
  túnel SSH (`ssh -L 8000:127.0.0.1:8000 root@179.199.150.51`) e
  http://localhost:8000. Mostre a senha a ele só se ele pedir.
- Em `/opt/supabase/docker-compose.yml`, prefixe **todas** as portas publicadas
  com `127.0.0.1:` (kong 8000/8443, supavisor 5432/6543, e qualquer outra).
  Confira depois com `ss -tlnp | grep docker` — nada pode aparecer em `0.0.0.0`.

```bash
cd /opt/supabase && docker compose pull && docker compose up -d
docker compose ps        # todos "healthy" (pode levar 1–2 min)
```

## Passo 3 — Edge Functions

```bash
cp -r /opt/chroma-flux/repo/supabase/functions/push        /opt/supabase/volumes/functions/
cp -r /opt/chroma-flux/repo/supabase/functions/invite-login /opt/supabase/volumes/functions/
cd /opt/supabase && docker compose restart functions
```

As duas usam `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, que o compose já
injeta. `FUNCTIONS_VERIFY_JWT=false` foi setado no `.env` (as duas funções
validam o chamador por conta própria).

## Passo 4 — Nginx + HTTPS para a API

```bash
install -m 644 /opt/chroma-flux/repo/deploy/supabase/nginx-api.conf /etc/nginx/sites-available/supabase-api
ln -sfn /etc/nginx/sites-available/supabase-api /etc/nginx/sites-enabled/supabase-api
nginx -t && systemctl reload nginx
dig +short api.chromaflux.com.br @a.sec.dns.br     # tem que dar 179.199.150.51
certbot --nginx -n --agree-tos -m contato@chromatechnology.com.br --redirect -d api.chromaflux.com.br
curl -s https://api.chromaflux.com.br/auth/v1/health -H "apikey: $(grep ^ANON_KEY= /opt/supabase/.env | cut -d= -f2-)"
```

## Passo 5 — Congelar e copiar os dados

Combine o horário com o Igor (poucos minutos de site fora do ar).

```bash
sudo -u flux pm2 stop chroma-flux          # ninguém grava mais na nuvem
mkdir -p /root/migracao && cd /root/migracao && chmod 700 .
OLD_DB_URL="$(cat /root/.old_db_url)"      # arquivo criado pelo Igor no passo 0
```

Dump (Postgres 17). Se o `pg_dump` local não for 17+, rode via Docker:
`docker run --rm -e PGPASSWORD... postgres:17 pg_dump ...` com `--network host`.

```bash
# Estrutura do schema public (tabelas, funções, triggers, RLS, views)
pg_dump "$OLD_DB_URL" --schema-only --schema=public --no-owner --no-privileges -f schema.sql
# Dados: public + auth (usuários, senhas com hash, identidades) + storage (buckets)
pg_dump "$OLD_DB_URL" --data-only --schema=public -f data_public.sql
pg_dump "$OLD_DB_URL" --data-only -t auth.users -t auth.identities -f data_auth.sql
pg_dump "$OLD_DB_URL" --data-only -t storage.buckets -f data_storage.sql
```

Alternativa oficial equivalente (usa Docker):
`npx supabase db dump --db-url "$OLD_DB_URL" -f schema.sql` e
`... --data-only --use-copy -f data.sql`.

## Passo 6 — Restaurar

```bash
DB="docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1"
$DB < schema.sql
( echo "SET session_replication_role = replica;"; cat data_auth.sql data_storage.sql data_public.sql ) | $DB
$DB < /opt/chroma-flux/repo/deploy/supabase/pos-restauracao.sql
```

- Se `schema.sql` reclamar de extensão ausente, crie-a (`create extension ...`)
  e rode de novo — a imagem supabase/postgres traz todas as usadas.
- Se `data_auth.sql` falhar por coluna que não existe na versão auto-hospedada,
  **pare e mostre ao Igor** o erro. Não apague colunas nem pule usuários.
- Os grants para `anon`, `authenticated` e `service_role` no schema public
  precisam existir (a imagem já cria os defaults). Confira com uma consulta
  como anon via REST no passo 9.
- A última saída do `pos-restauracao.sql` deve mostrar 8 usuários, 57 tarefas
  (ou mais, se alguém criou desde o levantamento), o job `push-reminders` e o
  bucket `anexos`.

## Passo 7 — Segredos do Vault

O dump trouxe as linhas de `vault.secrets` criptografadas com a chave da nuvem —
elas não abrem aqui. Apague e recrie com os mesmos valores, sem imprimir:

```bash
$DB -c "delete from vault.secrets where name in ('push_vapid_public_key','push_vapid_private_key','push_webhook_secret');"
for n in push_vapid_public_key push_vapid_private_key push_webhook_secret; do
  v="$(psql "$OLD_DB_URL" -Atc "select decrypted_secret from vault.decrypted_secrets where name='$n'")"
  $DB -q -v v="$v" -v n="$n" <<< "select vault.create_secret(:'v', :'n');" >/dev/null
  unset v
done
$DB -c "select name, length(decrypted_secret) from vault.decrypted_secrets;"
```

## Passo 8 — Apontar o site para o novo Supabase

Em `/opt/chroma-flux/shared/.env.production`:

- `NEXT_PUBLIC_SUPABASE_URL=https://api.chromaflux.com.br`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=` o `ANON_KEY` de `/opt/supabase/.env`

Edite com sed/python lendo o valor do arquivo (não digite a chave). As
variáveis `NEXT_PUBLIC_*` entram no build, então **tem que republicar**:

```bash
sudo -u flux flux-deploy
```

## Passo 9 — Testes (com o Igor)

1. https://www.chromaflux.com.br/login — entrar com a conta do Igor
   (a senha é a mesma; só a sessão antiga cai, todo mundo faz login de novo).
2. Ver espaços e tarefas; criar, editar e concluir uma tarefa de teste.
3. Configurações › Alterar senha — o código chega por e-mail (Resend).
4. Enviar um convite para um e-mail de teste e abrir o link.
5. "Esqueci minha senha" — e-mail do Auth via SMTP do Resend.
6. Notificações: ativar em Configurações e esperar um lembrete
   (`docker logs supabase-edge-functions --tail 50`).
7. Anexar um arquivo numa tarefa (bucket `anexos`).
8. `ss -tlnp` — nenhuma porta do Supabase em 0.0.0.0.

## Passo 10 — Backup diário (obrigatório)

Agora o banco é responsabilidade da VPS. Com a autorização do Igor, criar
`/usr/local/bin/flux-backup` (pg_dump comprimido em `/opt/backups`, mantendo 14
dias) e agendá-lo no cron do root para 03:30. Recomendar também uma cópia fora
da VPS (ex.: Google Drive do Igor) — combinar com ele.

## Plano de volta

Se algo der errado **antes** de liberar para a equipe: voltar o
`.env.production` para a URL/chave da nuvem, `sudo -u flux flux-deploy` e
`sudo -u flux pm2 start chroma-flux`. Os dados da nuvem estão intactos até o
momento do congelamento. Manter o projeto da nuvem **ativo por 2 semanas** antes
de excluir.
