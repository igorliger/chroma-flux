# Chroma Flux — contexto para o Claude Code

Gerenciador de tarefas estilo Asana da **ChromaTech** (Igor Liger, Salvador/BA).
Em produção em **https://www.chromaflux.com.br**, usado pela equipe da empresa.

**Sempre responda em português do Brasil.** O Igor não é programador: explique em
linguagem simples, com passos numerados quando ele precisar fazer algo, e faça
você mesmo tudo o que puder.

## Stack

- Next.js 15.5 (App Router, Server Actions), React 19, TypeScript, Tailwind v4.
- Supabase: Auth + Postgres com RLS + Storage (bucket privado `anexos`) +
  Edge Functions + pg_cron + pg_net + Vault. Auto-hospedado (Docker) nesta
  própria VPS desde 26/09/2026, em `https://api.chromaflux.com.br` — ver
  "Supabase" abaixo. Projeto antigo na nuvem `zdkgujlkdtxiabxntuce`
  (ca-central-1) mantido **ativo** (não pausar/excluir) como plano de volta
  até 10/10/2026.
- E-mail: Resend, domínio `chromaflux.com.br`, remetente
  `Chroma Flux <convites@chromaflux.com.br>`.
- Push: Web Push (VAPID) via Edge Function `push`.

## Onde tudo roda

| Peça | Onde |
|---|---|
| Site (Next.js) | VPS Hostinger KVM 2 `srv2012841`, IP 179.199.150.51, Ubuntu 24.04 |
| Processo | PM2 do usuário `flux`, app `chroma-flux`, `next start` em 127.0.0.1:3000 |
| Proxy/HTTPS | Nginx (`/etc/nginx/sites-available/chroma-flux`) + Let's Encrypt (certbot, renovação automática). Buffers de cabeçalho em `/etc/nginx/conf.d/chroma-flux-buffers.conf` (cópia em `deploy/nginx-buffers.conf`) — sem eles, 502 para quem está logado e em consultas longas à API |
| Código em produção | `/opt/chroma-flux/current` → `/opt/chroma-flux/releases/<data>-<sha>` |
| Variáveis | `/opt/chroma-flux/shared/.env.production` (chmod 600, dono `flux`) |
| Banco, login, arquivos, funções | Supabase auto-hospedado (Docker) nesta VPS, `/opt/chroma-flux/supabase` (compose oficial; anexos em `volumes/storage`), exposto em `https://api.chromaflux.com.br` — migrado da nuvem em 26/09/2026, roteiro em `deploy/supabase/MIGRAR-SUPABASE.md` |
| Backup | `/usr/local/bin/flux-backup` → `/opt/chroma-flux/bin/flux-backup` (cópia em `deploy/flux-backup.sh`): `pg_dump` comprimido em `/opt/chroma-flux/backups` (mantém 14 dias) + cópia no Google Drive do Igor via `rclone` (pasta "Chroma Flux - Backups", sem limite de dias) **e os anexos** (`volumes/storage` → subpasta `anexos`, desde 14/10/2026). Cron do root às 03:30. Config do rclone em `/root/.config/rclone/rclone.conf` (chmod 600) — nunca imprimir o token. **Se o Drive der `invalid_grant`** (autorização expirou — aconteceu até 13/10): no PC do Igor, `rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"` (escopo `drive.file`); na VPS, `rclone config reconnect gdrive:` → `y` → `n` → colar o código. O erro "listing Team Drives failed" no fim é esperado e a conexão fica salva. |
| Supabase enxuto | `deploy/supabase/enxugar.sh` (`verificar` / `aplicar` / `desfazer` / `studio`): `docker-compose.override.yml` põe studio, meta, realtime, imgproxy, analytics, vector e supavisor no perfil "desligado" (o site não usa nenhum). Studio sob demanda: `enxugar.sh studio`. |
| Limpeza | `/usr/local/bin/vps-limpeza` (cópia em `deploy/vps-limpeza.sh`), cron `/etc/cron.d/vps-limpeza` a cada 3 dias às 04:15, registro em `/var/log/vps-limpeza.log`: cache de build e imagens órfãs do Docker, logs de container >100 MB, caches npm/apt, journal >200 MB. Nunca volumes nem imagens com nome. Em 22/10/2026 a limpeza manual levou o disco de 58 para 28 GB (31 GB eram cache de build do Docker). |
| DNS | registro.br: `chromaflux.com.br` e `www` → A 179.199.150.51; `api` → A 179.199.150.51 (Supabase); `send`, `rsend`, `resend._domainkey`, `_dmarc` são do Resend — **não mexer** |
| Código-fonte | GitHub `igorliger/chroma-flux` (público), branch `main` |

A Vercel **não é mais usada** (projeto excluído em 27/09/2026).

## Fluxo de trabalho

- Editar e testar numa cópia de trabalho (não em `/opt/chroma-flux/repo`, que é
  a cópia de deploy e é resetada a cada publicação).
- Antes de commitar: `npm run typecheck` e `npx eslint <arquivos>`.
- Commits pequenos, mensagem em português. Enviar: `git push origin HEAD:main`.
- **Publicar é automático** (desde 02/10/2026): todo push/merge na `main`
  dispara o GitHub Actions `Deploy VPS` (`.github/workflows/deploy-vps.yml`),
  que entra por SSH como `flux` e roda `flux-deploy` (baixa a main, `npm ci`,
  build numa pasta nova, aplica migrações novas, troca o link `current`, `pm2 reload`; se o site não
  responder, volta sozinho para a versão anterior). Ou seja: **mesclar na
  main = publicar**. Na mão: `sudo -u flux flux-deploy` ou "Run workflow" na
  aba Actions. Scripts em `deploy/`.
  - Segredos do repositório: `VPS_HOST` (IP) e `VPS_SSH_KEY` (chave
    `/home/flux/.ssh/github_actions` em base64 numa linha:
    `sudo base64 -w0 /home/flux/.ssh/github_actions`). No `authorized_keys`
    do flux essa chave está presa a `command="/usr/local/bin/flux-deploy",restrict`.
  - O SSH tem `AllowUsers`; o flux foi liberado em
    `/etc/ssh/sshd_config.d/60-flux-deploy.conf`.
- Ver site: `sudo -u flux pm2 status` · logs: `sudo -u flux pm2 logs chroma-flux --lines 100`.
- Trocar chave do Resend: `flux-resend` (pede a chave sem mostrar).
- Variáveis `NEXT_PUBLIC_*` entram no build → mudou, tem que republicar.
- Aba aberta antes de uma publicação: o Next 15 troca o id das Server Actions
  a cada build ("Failed to find Server Action" no log, "Algo deu errado" na
  tela). `VersionWatcher` (layout raiz) compara `NEXT_PUBLIC_VERSAO` (marca do
  build, `next.config.ts`) com `/api/versao` ao voltar para a aba e a cada
  5 min: recarrega sozinho se não houver janela aberta, senão mostra faixa
  "Atualizar". Os `error.tsx` recarregam sozinhos nesse erro.

## Supabase

- Migrações em `supabase/migrations/NNNN_nome.sql` (hoje até **0041**). Cada
  migração nova também é **anexada em `supabase/schema.sql`** antes do marcador
  `13. VERIFICAÇÃO`. Tipos à mão em `src/lib/database.types.ts`.
- **Migrações são aplicadas sozinhas na publicação** (desde 14/10/2026):
  `deploy.sh` chama `sudo -n /usr/local/bin/flux-migrate` (cópia em
  `deploy/flux-migrate.sh`) depois do build e antes de trocar o site. Ele
  roda cada migração ainda não anotada em `flux.migrations` numa transação;
  se falhar, a publicação é cancelada e o site fica na versão anterior. O
  flux só pode rodar esse comando como root (`/etc/sudoers.d/flux-migrate`).
  Instalado com `sudo bash /opt/chroma-flux/repo/deploy/instalar-migracoes.sh`
  (uma vez; seguro repetir — também serve para atualizar o flux-migrate).
  Por isso, migração nova tem que ser segura de rodar numa transação.
- Aplicar migração à mão na VPS: `docker exec -i supabase-db psql -U postgres -d postgres
  -v ON_ERROR_STOP=1 < arquivo.sql`, ou Studio (túnel SSH `-L 8000:127.0.0.1:8000`,
  http://localhost:8000). Nunca imprimir senha, JWT secret ou service_role.
- Padrões do banco:
  - Funções `SECURITY DEFINER` sempre com `set search_path = public, pg_temp` e
    `revoke execute ... from anon, public` + `grant ... to authenticated`.
  - Flag de sessão `chroma.escrita_interna` = escrita interna que os triggers
    de proteção deixam passar. `chroma.reabrindo_parte` = reabertura parcial.
  - Triggers BEFORE rodam em ordem alfabética (`tasks_a_normalize_co_assignees_trg` primeiro).
  - View `task_overview` com `security_invoker = true`; colunas novas vão no
    **final** (`co_assignee_ids`, `completed_by_ids`, `assigned_to_all`).
  - Testes de banco: bloco `DO` que termina com `raise exception` mostrando o
    resultado (desfaz tudo). Um RAISE no mesmo bloco desfaz os INSERTs dele.
- Edge Functions (`supabase/functions`, fora do tsconfig/eslint):
  - `push` — verify_jwt false, autentica pelo header `x-flux-secret`; VAPID
    (`npm:web-push@3.6.7`). Chamada pelo job pg_cron `push-reminders`
    (*/5 min) via `public.call_push_function(jsonb)`.
    Tipos em `claim_push_reminders`: `due_soon` (15 min antes da hora),
    `digest` (resumo do dia, 08–20h) e `overdue` (0034: "Você tem N tarefas
    atrasadas" a cada 15 min, 08–20h, sem feriado; inclui lembretes pessoais;
    `ref` fixo para o aviso novo substituir o anterior no aparelho).
  - `invite-login` — gera link de acesso (`admin.generateLink`) e devolve
    `token_hash`; o site conclui com `verifyOtp`.
- Vault: `push_vapid_public_key`, `push_vapid_private_key`, `push_webhook_secret`.
  A chave pública VAPID também está fixa em `src/lib/push.ts` (o par não pode mudar).
- Código de troca de senha: HMAC-SHA256 de `userId:código` com a chave
  `"chroma-flux:alterar-senha:" + RESEND_API_KEY` (`src/lib/password-code.ts`).

## Regras de negócio (resumo)

- Papéis por espaço: proprietário, administrador, membro, visualizador.
  Só proprietário/admin criam espaços. Membro só cria tarefa para si mesmo.
- Equipe da empresa: convite por e-mail **uma vez só** (Configurações ›
  Convidados e funções); depois só se designa a pessoa a espaços. Link do
  e-mail leva a `/convite/<id>` (login rápido com e-mail preenchido).
  Quem **já tem conta** entra na equipe e nos espaços na hora, sem e-mail
  (0038, RPC `add_existing_to_team`); convite por e-mail só para quem ainda
  não tem conta.
  Conta em `auth.users` sem linha em `profiles` (aconteceu após a migração
  para a VPS) quebra equipe/espaços: 0039 cria os perfis que faltam, recria
  `on_auth_user_created` se puder, e `ensure_profile` é chamado pelas funções
  de equipe.
- Tarefa pode ter vários responsáveis (`co_assignee_ids`) ou "Todos"
  (`assigned_to_all`, acompanha quem entra no espaço depois). Conclusão é
  **por pessoa** (`task_completions`): se um conclui, continua aberta/atrasada
  para os outros; "Concluir para todos" fecha de vez.
  Repetida com vários responsáveis: a próxima ocorrência nasce na **primeira**
  parte concluída (0040, `spawn_next_occurrence`, chamado pelo gatilho e por
  `set_my_task_completion`); a antiga perde a repetição e segue aberta só
  para quem falta.
- Grupos de acesso com janela de horário: fora da janela o login é bloqueado
  (tela `/fora-do-horario`, texto gentil). O proprietário nunca é bloqueado.
- Liberação por dispositivo (0033, **opcional, desligada por padrão**): o
  proprietário liga em Configurações; aí membros/visualizadores só entram por
  navegador liberado (cookie `cf_device`, id aleatório). O middleware chama
  `device_status` e manda para `/dispositivo`, onde a pessoa pede; dono e
  admins liberam em Configurações. Dono e admins nunca são bloqueados.
  Erro na RPC (ou migração não aplicada) não bloqueia ninguém.
- Feriados (`holidays`, por proprietário, valem para todos os espaços dele):
  prazo que cai em feriado ou fim de semana vai para o próximo dia útil;
  sem resumo diário de push em feriado.
  Opção por tarefa repetida "Semana com feriado: adiar 1 dia" (0036,
  `holiday_week_shift`): cada feriado seg–sex da semana antes do dia adia a
  ocorrência 1 dia útil; o dia da agenda fica em `recurrence_anchor`, e a
  próxima ocorrência é calculada a partir dele. Recalcula ao ligar a opção e
  ao cadastrar/apagar feriado da semana. Interruptor do dono em Configurações › Feriados
  (0037, `holiday_settings.week_shift_all`, RPC `set_holiday_week_shift_all`):
  liga/desliga em todas as tarefas repetidas abertas e força nas novas. Já cadastrados nacionais + BA +
  Salvador 2026–2027 e Dia do Comerciário (tipo "empresa").
- Vídeo na tarefa (0041, `tasks.video_url`, só http/https): campo "Vídeo" no
  painel e na criação; botão "Assistir vídeo" abre o link numa aba nova (a
  página de compartilhamento da Asustor/EZ-Connect não pode ser embutida).
  Selo "Contém vídeo" nas listas; a próxima ocorrência herda o link.
- Concluir antes do dia do prazo é recusado (0031), exceto tarefa pessoal
  (`is_personal`) e lembrete pessoal (0035).
- Login: com senha errada o e-mail continua preenchido (React 19 reseta
  `<form action>` — usar `onSubmit` + `startTransition`).
- `friendlyError` repassa mensagens que começam com "Você ".

## Segurança

- Nunca commitar segredos. `.env*` está no `.gitignore`. A chave publishable do
  Supabase é pública por design (RLS protege os dados); a `service_role` não
  entra no site.
- Não imprimir no terminal senhas, chaves do Resend, service_role, JWT secret
  ou valores do Vault.
- Antes de mexer em banco de produção ou no servidor, explique ao Igor o que vai
  fazer e peça confirmação. Sugira snapshot da VPS (hPanel) antes de mudanças grandes.

## Pendências conhecidas

- Excluir o projeto Supabase da nuvem depois de 10/10/2026, se tudo continuar
  estável.
- Opcional: marcar feriados na visão de calendário.
