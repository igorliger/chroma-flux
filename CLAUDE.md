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
| Proxy/HTTPS | Nginx (`/etc/nginx/sites-available/chroma-flux`) + Let's Encrypt (certbot, renovação automática) |
| Código em produção | `/opt/chroma-flux/current` → `/opt/chroma-flux/releases/<data>-<sha>` |
| Variáveis | `/opt/chroma-flux/shared/.env.production` (chmod 600, dono `flux`) |
| Banco, login, arquivos, funções | Supabase auto-hospedado (Docker) nesta VPS, `/opt/supabase` (compose oficial), exposto em `https://api.chromaflux.com.br` — migrado da nuvem em 26/09/2026, roteiro em `deploy/supabase/MIGRAR-SUPABASE.md` |
| Backup do banco | `/usr/local/bin/flux-backup` (`pg_dump` comprimido em `/opt/backups`, mantém 14 dias), cron do root às 03:30 |
| DNS | registro.br: `chromaflux.com.br` e `www` → A 179.199.150.51; `api` → A 179.199.150.51 (Supabase); `send`, `rsend`, `resend._domainkey`, `_dmarc` são do Resend — **não mexer** |
| Código-fonte | GitHub `igorliger/chroma-flux` (público), branch `main` |

A Vercel **não é mais usada** (projeto excluído em 27/09/2026).

## Fluxo de trabalho

- Editar e testar numa cópia de trabalho (não em `/opt/chroma-flux/repo`, que é
  a cópia de deploy e é resetada a cada publicação).
- Antes de commitar: `npm run typecheck` e `npx eslint <arquivos>`.
- Commits pequenos, mensagem em português. Enviar: `git push origin HEAD:main`.
- **Publicar**: `sudo -u flux flux-deploy` (baixa a main, `npm ci`, build numa
  pasta nova, troca o link `current`, `pm2 reload`; se o site não responder,
  volta sozinho para a versão anterior). Scripts em `deploy/`.
- Ver site: `sudo -u flux pm2 status` · logs: `sudo -u flux pm2 logs chroma-flux --lines 100`.
- Trocar chave do Resend: `flux-resend` (pede a chave sem mostrar).
- Variáveis `NEXT_PUBLIC_*` entram no build → mudou, tem que republicar.

## Supabase

- Migrações em `supabase/migrations/NNNN_nome.sql` (hoje até **0028**). Cada
  migração nova também é **anexada em `supabase/schema.sql`** antes do marcador
  `13. VERIFICAÇÃO`. Tipos à mão em `src/lib/database.types.ts`.
- Aplicar migração na VPS: `docker exec -i supabase-db psql -U postgres -d postgres
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
- Tarefa pode ter vários responsáveis (`co_assignee_ids`) ou "Todos"
  (`assigned_to_all`, acompanha quem entra no espaço depois). Conclusão é
  **por pessoa** (`task_completions`): se um conclui, continua aberta/atrasada
  para os outros; "Concluir para todos" fecha de vez.
- Grupos de acesso com janela de horário: fora da janela o login é bloqueado
  (tela `/fora-do-horario`, texto gentil). O proprietário nunca é bloqueado.
- Feriados (`holidays`, por proprietário, valem para todos os espaços dele):
  prazo que cai em feriado ou fim de semana vai para o próximo dia útil;
  sem resumo diário de push em feriado. Já cadastrados nacionais + BA +
  Salvador 2026–2027 e Dia do Comerciário (tipo "empresa").
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

- Publicação automática a cada push (hoje é manual com `flux-deploy`).
- Cópia do backup diário fora da VPS (ex.: Google Drive do Igor) — a
  combinar com ele.
- Excluir o projeto Supabase da nuvem depois de 10/10/2026, se tudo continuar
  estável.
- Opcional: marcar feriados na visão de calendário.
