-- =============================================================================
-- Teste de isolamento entre workspaces
-- =============================================================================
-- Cole este arquivo inteiro no SQL Editor do Supabase e execute. Ele cria dois
-- usuários e dois workspaces, tenta cruzar a fronteira de todas as formas
-- possíveis e dá ROLLBACK no final — nada é persistido.
--
-- Resultado esperado: a mensagem final "TODOS OS TESTES DE RLS PASSARAM".
-- Qualquer vazamento aborta o script com a descrição exata da falha.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Cenário
-- -----------------------------------------------------------------------------
do $$
declare
  v_alice uuid := '11111111-1111-1111-1111-111111111111';
  v_bruno uuid := '22222222-2222-2222-2222-222222222222';
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password,
     email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
     created_at, updated_at)
  -- A senha não importa: o teste nunca autentica de verdade, apenas simula o
  -- JWT com `set_config`. Por isso o hash fica vazio e nenhuma extensão de
  -- criptografia é necessária.
  values
    (v_alice, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'alice@teste.local', '',
     now(), '{"provider":"email"}', '{"full_name":"Alice"}', now(), now()),
    (v_bruno, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'bruno@teste.local', '',
     now(), '{"provider":"email"}', '{"full_name":"Bruno"}', now(), now());
end $$;

-- Workspaces e tarefas de cada um (como superusuário, ignorando RLS).
insert into public.workspaces (id, name, owner_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Workspace da Alice',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Workspace do Bruno',
   '22222222-2222-2222-2222-222222222222');

insert into public.tasks (id, workspace_id, title, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Segredo da Alice',
   '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000001', 'Segredo do Bruno',
   '22222222-2222-2222-2222-222222222222');

insert into public.comments (workspace_id, task_id, author_id, body) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'Comentário confidencial da Alice');

-- -----------------------------------------------------------------------------
-- Passa a atuar como Bruno (papel `authenticated` + JWT dele)
-- -----------------------------------------------------------------------------
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',   '22222222-2222-2222-2222-222222222222',
    'email', 'bruno@teste.local',
    'role',  'authenticated'
  )::text,
  true
);
set local role authenticated;

-- -----------------------------------------------------------------------------
-- Leitura: Bruno não pode ver NADA do workspace da Alice
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.workspaces
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'FALHA: Bruno enxergou o workspace da Alice';

  select count(*) into n from public.tasks
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'FALHA: Bruno enxergou tarefas da Alice';

  select count(*) into n from public.comments
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'FALHA: Bruno enxergou comentários da Alice';

  select count(*) into n from public.workspace_members
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'FALHA: Bruno enxergou a lista de membros da Alice';

  -- Sem varredura por tabela inteira: só o que é dele aparece.
  select count(*) into n from public.tasks;
  assert n = 1, format('FALHA: Bruno enxergou %s tarefas; esperado 1', n);

  -- O perfil da Alice não deve vazar (não compartilham workspace).
  select count(*) into n from public.profiles
  where id = '11111111-1111-1111-1111-111111111111';
  assert n = 0, 'FALHA: Bruno enxergou o perfil da Alice';

  raise notice 'OK: leitura isolada entre workspaces';
end $$;

-- -----------------------------------------------------------------------------
-- Escrita: Bruno não pode criar nem alterar nada no workspace da Alice
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  -- Inserir tarefa no espaço da Alice deve ser bloqueado pela policy.
  begin
    insert into public.tasks (workspace_id, title, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'invasão',
            '22222222-2222-2222-2222-222222222222');
    assert false, 'FALHA: Bruno inseriu tarefa no espaço da Alice';
  exception when insufficient_privilege or check_violation then
    null; -- esperado
  end;

  -- UPDATE em linha invisível não afeta nada.
  update public.tasks set title = 'sequestrada'
  where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'FALHA: Bruno alterou tarefa da Alice';

  -- DELETE idem.
  delete from public.tasks where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'FALHA: Bruno apagou tarefa da Alice';

  -- Auto-promoção a membro do workspace alheio.
  begin
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            '22222222-2222-2222-2222-222222222222', 'admin');
    assert false, 'FALHA: Bruno se adicionou ao workspace da Alice';
  exception when insufficient_privilege then
    null; -- esperado
  end;

  raise notice 'OK: escrita bloqueada entre workspaces';
end $$;

-- -----------------------------------------------------------------------------
-- Convites: só o dono do e-mail aceita
-- -----------------------------------------------------------------------------
reset role;
insert into public.workspace_invitations (id, workspace_id, email, role, invited_by)
values ('cccccccc-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'outra.pessoa@teste.local',
        'member', '11111111-1111-1111-1111-111111111111');
set local role authenticated;

do $$
begin
  begin
    perform public.accept_invitation('cccccccc-0000-0000-0000-000000000001');
    assert false, 'FALHA: Bruno aceitou convite destinado a outro e-mail';
  exception when insufficient_privilege then
    null; -- esperado
  end;
  raise notice 'OK: convite só é aceito pelo e-mail convidado';
end $$;

-- -----------------------------------------------------------------------------
-- Integridade estrutural: FKs compostas impedem cruzar tenants mesmo com
-- privilégio total (é o cinto de segurança embaixo das policies).
-- -----------------------------------------------------------------------------
reset role;
do $$
begin
  -- Subtarefa marcada como do workspace do Bruno, mas pendurada na tarefa da
  -- Alice: a FK composta (parent_task_id, workspace_id) recusa.
  begin
    insert into public.tasks (workspace_id, parent_task_id, title, created_by)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000003', 'híbrida',
            '22222222-2222-2222-2222-222222222222');
    assert false, 'FALHA: FK composta permitiu subtarefa cruzando workspaces';
  exception when foreign_key_violation then
    null; -- esperado
  end;

  -- Comentário do espaço do Bruno apontando para a tarefa da Alice.
  begin
    insert into public.comments (workspace_id, task_id, author_id, body)
    values ('bbbbbbbb-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000003',
            '22222222-2222-2222-2222-222222222222', 'espionagem');
    assert false, 'FALHA: FK composta permitiu comentário cruzando workspaces';
  exception when foreign_key_violation then
    null; -- esperado
  end;

  -- E uma tarefa marcada como de um espaço que não existe também é recusada:
  -- é a âncora `tasks_workspace_fkey`.
  begin
    insert into public.tasks (workspace_id, title, created_by)
    values ('dddddddd-0000-0000-0000-000000000009', 'órfã',
            '22222222-2222-2222-2222-222222222222');
    assert false, 'FALHA: tarefa aceita sem espaço de trabalho existente';
  exception when foreign_key_violation then
    null; -- esperado
  end;

  raise notice 'OK: FKs compostas impedem cruzamento de workspaces';
end $$;

-- -----------------------------------------------------------------------------
-- Responsável do espaço: designar alguém esconde as tarefas dos demais membros
-- -----------------------------------------------------------------------------
reset role;

-- Bruno entra no espaço da Alice como membro comum, e passa a enxergar as
-- tarefas de lá — ninguém está designado ainda.
insert into public.workspace_members (workspace_id, user_id, role)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'member');

set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.tasks
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 1, 'FALHA: membro não enxergou as tarefas do espaço compartilhado';
end $$;
reset role;

-- A Alice se designa. O espaço vira dela.
update public.workspaces set responsible_id = '11111111-1111-1111-1111-111111111111'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.tasks
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'FALHA: com responsável designado, o membro ainda vê as tarefas';

  select count(*) into n from public.comments
  where workspace_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  assert n = 0, 'FALHA: com responsável designado, o membro ainda vê os comentários';

  -- Sem enxergar, também não escreve: a policy de UPDATE repete a checagem.
  update public.tasks set title = 'invisível'
  where id = 'aaaaaaaa-0000-0000-0000-000000000003';
  get diagnostics n = row_count;
  assert n = 0, 'FALHA: membro alterou tarefa que não pode ver';

  raise notice 'OK: espaço com responsável fica privado dele';
end $$;
reset role;

-- A designação não pode apontar para quem não é membro deste espaço.
do $$
begin
  begin
    update public.workspaces
    set responsible_id = '99999999-9999-9999-9999-999999999999'
    where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    assert false, 'FALHA: designou alguém de fora do espaço';
  exception when foreign_key_violation then
    null; -- esperado
  end;
  raise notice 'OK: só membros do espaço podem ser designados';
end $$;

do $$ begin
  raise notice '=============================================';
  raise notice ' TODOS OS TESTES DE RLS PASSARAM';
  raise notice '=============================================';
end $$;

rollback;
