# Chroma Flux

Aplicativo de gerenciamento de tarefas com espaços de trabalho isolados, tarefas e
subtarefas, responsáveis, prazos com repetição, comentários, anexos, filtros e um
painel responsivo.

Construído com **Next.js 15** (App Router), **TypeScript**, **Tailwind CSS 4** e
**Supabase** (Auth + Postgres com Row Level Security).

---

## Funcionalidades

| Área | O que está incluído |
| --- | --- |
| Contas | Cadastro e login por e-mail e senha, confirmação por e-mail, recuperação de senha |
| Espaços de trabalho | Criação, edição, exclusão; troca rápida entre espaços |
| Permissões | Proprietário, administrador, membro e visualizador — aplicadas no banco, não só na interface |
| Responsável do espaço | Um membro designado pelo administrador; enquanto houver um, só ele e quem administra veem as tarefas de lá |
| Convites | Convite por e-mail sem `service_role`: o convidado aceita ao entrar com o mesmo e-mail |
| Tarefas | Lista única por espaço: responsável, prioridade, prazo com hora opcional, repetição, descrição, subtarefas (um nível) |
| Anexos | Até 3 MB por arquivo, em bucket privado com URL assinada |
| Comentários | Por tarefa, com exclusão pelo autor e moderação por administradores |
| Filtros e busca | Busca textual + filtros por responsável, prioridade, situação e prazo |
| Painel | Métricas de tarefas em aberto, atrasadas, a vencer e concluídas; carga por pessoa |
| Responsividade | Navegação em gaveta no celular, barra lateral fixa no computador |

---

## Configuração

### 1. Instalar dependências

```bash
npm install
```

### 2. Criar o projeto no Supabase

Em [supabase.com/dashboard](https://supabase.com/dashboard), clique em **New project**,
escolha um nome, defina uma senha forte para o banco e selecione uma região próxima.

### 3. Configurar as variáveis de ambiente

```bash
cp .env.example .env.local
```

No painel do projeto, abra **Connect** (ou **Project Settings → API**) e preencha
`.env.local`:

| Variável | Onde encontrar |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | *Project URL* |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | *Publishable key* (começa com `sb_publishable_`) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` em desenvolvimento |

> Em projetos criados antes da renomeação das chaves, o painel mostra **anon public**
> em vez de *publishable key*. Nesse caso use `NEXT_PUBLIC_SUPABASE_ANON_KEY` — a
> aplicação aceita os dois nomes.

> **Sobre segredos:** a *publishable key* é pública por design — quem protege os dados
> é a RLS, não o sigilo da chave. Já a **secret key** (`sb_secret_...`, antiga
> `service_role`) e a **senha do banco** ignoram todas as policies: nunca as coloque
> no repositório nem em variáveis `NEXT_PUBLIC_*`. Esta aplicação **não usa** a secret
> key em lugar nenhum, nem no servidor. `.env.local` está no `.gitignore`.

### 4. Criar o banco de dados

No **SQL Editor** do Supabase, cole o conteúdo de **`supabase/schema.sql`** e clique em
**Run**. Ele cria tudo de uma vez — tabelas, relacionamentos, índices, gatilhos e as
políticas de RLS — e termina com uma consulta de verificação que deve listar as 8
tabelas com `rls_ativa = true`.

O script é seguro para reexecutar (`if not exists` / `create or replace`).

<details>
<summary>Prefere aplicar como migrações separadas?</summary>

Os mesmos comandos estão divididos em `supabase/migrations/`, para uso com a CLI:

1. `0001_schema.sql` — tabelas, tipos, gatilhos
2. `0002_rls.sql` — funções auxiliares e policies
3. `0003_views.sql` — view de apoio com contadores

```bash
npx supabase link --project-ref SEU_REF
npx supabase db push
```

</details>

### 5. Ajustar a autenticação

Em **Authentication → URL Configuration**, defina:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs**: `http://localhost:3000/auth/callback`

### 6. Rodar

```bash
npm run dev
```

Abra <http://localhost:3000>.

---

## Verificar o isolamento entre espaços de trabalho

O arquivo `supabase/tests/rls_isolation_test.sql` cria dois usuários e dois espaços,
tenta cruzar a fronteira de todas as formas (leitura, escrita, auto-promoção a membro,
aceite de convite alheio, cruzamento de chaves estrangeiras) e dá `ROLLBACK` no final.

Cole o conteúdo no **SQL Editor** e execute. O resultado esperado é:

```
TODOS OS TESTES DE RLS PASSARAM
```

Qualquer vazamento aborta o script apontando exatamente qual garantia falhou.

---

## Como o isolamento funciona

Há duas camadas independentes, e as duas precisariam falhar para haver vazamento.

**1. Estrutura — chaves estrangeiras compostas.** Toda tabela de conteúdo carrega
`workspace_id`, e as FKs são compostas:

```sql
workspaces  (id, responsible_id)           → workspace_members (workspace_id, user_id)
tasks       (workspace_id)                 → workspaces (id)
tasks       (parent_task_id, workspace_id) → tasks      (id, workspace_id)
comments    (task_id,        workspace_id) → tasks      (id, workspace_id)
attachments (task_id,        workspace_id) → tasks      (id, workspace_id)
```

Uma subtarefa marcada como do espaço A não pode pender de uma tarefa do espaço B —
o banco recusa, independentemente de policies ou da aplicação. A primeira linha usa
o mesmo mecanismo para outro fim: o responsável de um espaço só pode ser alguém que
já é membro dele, e quem sai deixa de ser o responsável automaticamente
(`on delete set null`).

**2. Acesso — RLS com funções `SECURITY DEFINER`.** Toda tabela tem RLS ativa. A
leitura de tarefas, comentários e anexos passa por `can_see_workspace_tasks()`; a
escrita, por `has_capability()`, que consulta a matriz de permissões do proprietário
do espaço.

`can_see_workspace_tasks()` é onde vive a regra do **responsável do espaço**: sem
ninguém designado, todos os membros veem; com alguém designado, só ele e quem tem a
capacidade `member.manage`. A checagem consulta a matriz diretamente em vez de chamar
`has_capability()`, porque esta última também aplica a janela de uso — e a janela
restringe escrita, não leitura; usá-la ali esconderia as tarefas do administrador
fora do horário.

As policies de `update` e `delete` repetem essa checagem no próprio `using`. Sem
isso, quem tem `task.edit` poderia alterar ou apagar às cegas tarefas que não
consegue enxergar: a policy de `select` não governa as de escrita.

Essas funções precisam ser `SECURITY DEFINER` por um motivo específico: a policy de
`workspace_members` precisa consultar `workspace_members`. Se o `SELECT` fosse direto,
o Postgres reaplicaria a policy sobre a subconsulta e entraria em recursão infinita
(erro `42P17`). Dentro da função, a consulta roda como dona da função e ignora RLS —
e como ela só responde sobre o `auth.uid()` da requisição atual, nada vaza. Todas usam
`set search_path` fixo, para que um schema malicioso não possa sequestrar os nomes das
tabelas.

Padrão de cada papel — editável em **Configurações → Permissões por papel**, que
grava no banco e vale para todos os espaços de que você é proprietário:

| Papel | Lê | Cria/edita tarefas e comentários | Gerencia membros | Exclui o espaço |
| --- | :-: | :-: | :-: | :-: |
| Proprietário | ✓ | ✓ | ✓ | ✓ |
| Administrador | ✓ | ✓ | ✓ | |
| Membro | ✓ | ✓ | | |
| Visualizador | ✓ | | | |

---

## Publicar na Vercel

1. Suba o repositório para o GitHub.
2. Na Vercel, **Add New → Project** e importe o repositório. O framework é detectado
   automaticamente; não é preciso mudar comandos de build.
3. Em **Settings → Environment Variables**, adicione para *Production*, *Preview* e
   *Development*:

   ```
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   NEXT_PUBLIC_SITE_URL   → https://seu-app.vercel.app
   ```

   Só essas três. A secret key e a senha do banco não entram na Vercel.

4. No Supabase, em **Authentication → URL Configuration**, acrescente:
   - **Site URL**: `https://seu-app.vercel.app`
   - **Redirect URLs**: `https://seu-app.vercel.app/auth/callback`

5. Faça o deploy.

> Se `NEXT_PUBLIC_SITE_URL` não for definida, a aplicação usa `VERCEL_URL`, que a
> Vercel injeta em cada deploy. Defini-la explicitamente é melhor em produção, para
> que os links de confirmação apontem sempre para o domínio final.

---

## Estrutura do projeto

```
src/
├── app/
│   ├── (auth)/                     login, cadastro, recuperação de senha
│   ├── (app)/
│   │   ├── espacos/                seleção e criação de espaços
│   │   ├── configuracoes/          perfil, permissões por papel, janela de uso
│   │   └── e/[workspaceId]/
│   │       ├── page.tsx            painel
│   │       ├── tarefas/            lista do espaço, com busca e filtros
│   │       ├── minhas-tarefas/
│   │       ├── membros/
│   │       └── configuracoes/      nome, cor e exclusão do espaço
│   ├── actions/                    Server Actions (auth, workspaces, tasks, comments)
│   └── auth/callback/              troca do código do e-mail por sessão
├── components/
│   ├── task/                       painel da tarefa, lista, diálogo de criação
│   ├── filters/                    barra de busca e filtros
│   ├── layout/                     shell responsivo com barra lateral
│   └── ui.tsx                      componentes base
├── lib/
│   ├── supabase/                   clientes browser, server e middleware
│   ├── database.types.ts           tipos do banco
│   ├── queries.ts                  leituras server-side
│   ├── filters.ts                  busca e filtros
│   └── utils.ts                    datas, prioridades, papéis, posições
└── middleware.ts                   renovação de sessão e proteção de rotas

supabase/
├── schema.sql                      arquivo único para colar no SQL Editor
├── migrations/                     0001 schema · 0002 RLS · 0003 view · 0004 recorrência
│                                   0005 anexos · 0006 hora do prazo
│                                   0007 permissões · 0008 remoção de projetos
│                                   0009 remoção do quadro Kanban
│                                   0010 responsável do espaço
└── tests/                          teste de isolamento entre espaços
```

---

## Scripts

```bash
npm run dev        # servidor de desenvolvimento
npm run build      # build de produção
npm run start      # servir o build
npm run lint       # ESLint
npm run typecheck  # TypeScript sem emitir arquivos
```

---

## Decisões de projeto

**Perfis resolvidos por mapa, não por `embed`.** As consultas não usam os
relacionamentos aninhados do PostgREST. Os membros do espaço são carregados uma vez por
página e responsável/autor são resolvidos em memória. São poucos registros, o
resultado é previsível e não depende da inferência de relacionamentos — que é frágil
com as chaves estrangeiras compostas usadas aqui.

**Filtros no cliente.** O volume de tarefas por espaço é pequeno, então busca e filtros
rodam sobre a lista já carregada. Os controles respondem sem ida ao servidor.

**Arrastar e soltar otimista.** O cartão se move na hora e o servidor confirma depois.
Se a ação for recusada — um visualizador tentando mover, por exemplo — o React descarta
o estado otimista e o cartão volta sozinho, com o erro exibido acima do quadro.

**Posições fracionárias.** A ordem das tarefas usa `double precision`: ao soltar entre
dois cartões, a nova posição é a média das vizinhas. Reordenar não reescreve a coluna
inteira.

**Convites sem `service_role`.** Convidar alguém que ainda não tem conta exigiria a
chave administrativa. Em vez disso, o convite fica registrado numa tabela que o
convidado enxerga pelo próprio e-mail (`email = auth.jwt()->>'email'`), e o aceite passa
por uma função `SECURITY DEFINER` que valida o e-mail antes de criar o vínculo.
