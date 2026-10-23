-- Bateria dos limites da IA.
-- O que tem de provar: o dinheiro para no teto, uma pessoa não gasta o mês
-- das outras, ninguém chega às contas a partir da app, e o painel de custos
-- só abre para o administrador.
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
revoke all on function public.verifica(text,boolean,text) from public;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated;

delete from auth.users; delete from public.autorizados; delete from public.ia_pedidos;
insert into public.autorizados(email) values ('ana@exemplo.com'),('bruno@exemplo.com'),('chefe@exemplo.com');
insert into auth.users(id,email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ana@exemplo.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bruno@exemplo.com'),
  ('dddddddd-0000-0000-0000-000000000004','chefe@exemplo.com');
update public.profiles set admin = true where id='dddddddd-0000-0000-0000-000000000004';

-- ===================================================== fluxo normal
do $$ declare r record; begin
  select * into r from public.pedir_ia('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia');
  perform public.verifica('1  o primeiro pedido é autorizado', r.permitido and r.id is not null, coalesce(r.motivo,''));
  perform public.verifica('2  começa com zero gasto no mês', r.gasto_eur = 0, r.gasto_eur::text);
  perform public.verifica('3  o teto são 20 €', r.teto_eur = 20, r.teto_eur::text);
  perform public.verifica('4  sem aviso de custo no início', r.aviso = false);
  perform public.verifica('5  a linha nasce por fechar e sem custo',
    exists (select 1 from public.ia_pedidos p where p.id = r.id and p.respondeu = false and p.custo_usd = 0));
  perform public.verifica('6  fechar a conta grava o custo verdadeiro',
    public.fechar_ia(r.id, 'claude-haiku-5-5', 600, 1200, 0.00066));
  perform public.verifica('7  fechar a mesma conta outra vez não cobra de novo',
    public.fechar_ia(r.id, 'claude-haiku-5-5', 600, 1200, 0.00066) = false);
  perform public.verifica('8  guarda modelo e tokens',
    exists (select 1 from public.ia_pedidos p where p.id=r.id and p.modelo='claude-haiku-5-5'
             and p.tokens_entrada=600 and p.tokens_saida=1200 and p.respondeu));
end $$;

select public.verifica('9  não guarda o texto do pedido (não há coluna para isso)',
  not exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='ia_pedidos'
                 and column_name in ('texto','pergunta','ingredientes','resposta','prompt')));

-- Um custo absurdo é erro, não uso.
do $$ declare r record; begin
  select * into r from public.pedir_ia('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia');
  perform public.verifica('10 recusa fechar com um custo impossível', public.fechar_ia(r.id,'x',1,1,99) = false);
  perform public.verifica('11 recusa custo negativo', public.fechar_ia(r.id,'x',1,1,-1) = false);
  delete from public.ia_pedidos where id = r.id;
end $$;

-- ===================================================== limite por pessoa
do $$ declare n int := 0; r record; begin
  delete from public.ia_pedidos;
  for i in 1..25 loop
    select * into r from public.pedir_ia('bbbbbbbb-0000-0000-0000-000000000002','receitas-ia');
    if r.permitido then n := n + 1; end if;
  end loop;
  select * into r from public.pedir_ia('bbbbbbbb-0000-0000-0000-000000000002','receitas-ia');
  perform public.verifica('12 deixa passar 25 pedidos por dia', n = 25, 'passaram '||n);
  perform public.verifica('13 o 26.º do dia é travado', not r.permitido and r.motivo = 'limite diário', coalesce(r.motivo,'(nenhum)'));
  -- a Ana não é travada pelo limite do Bruno
  select * into r from public.pedir_ia('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia');
  perform public.verifica('14 o limite de um não trava o outro', r.permitido);
  -- nem o limite de outra função
  select * into r from public.pedir_ia('bbbbbbbb-0000-0000-0000-000000000002','fotos');
  perform public.verifica('15 o limite é por função', r.permitido);
end $$;

-- ===================================================== teto do mês
do $$ declare r record; begin
  delete from public.ia_pedidos;
  -- 19,50 € gastos: ainda passa, mas já avisa (80% de 20 € são 16 €).
  insert into public.ia_pedidos(utilizador_id,funcao,custo_usd,respondeu)
    values ('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia', 19.50 * 1.08, true);
  select * into r from public.pedir_ia('bbbbbbbb-0000-0000-0000-000000000002','receitas-ia');
  perform public.verifica('16 aos 19,50 € ainda deixa pedir', r.permitido);
  perform public.verifica('17 e avisa que passou os 80%', r.aviso, 'gasto '||r.gasto_eur::text);
  perform public.verifica('18 conta o gasto do mês em euros', r.gasto_eur = 19.50, r.gasto_eur::text);

  delete from public.ia_pedidos;
  insert into public.ia_pedidos(utilizador_id,funcao,custo_usd,respondeu)
    values ('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia', 20.00 * 1.08, true);
  select * into r from public.pedir_ia('bbbbbbbb-0000-0000-0000-000000000002','receitas-ia');
  perform public.verifica('19 aos 20 € trava toda a gente', not r.permitido and r.motivo = 'teto do mês', coalesce(r.motivo,'(nenhum)'));
  perform public.verifica('20 e não cria linha nenhuma', r.id is null);

  -- o gasto do mês passado não conta para este
  delete from public.ia_pedidos;
  insert into public.ia_pedidos(utilizador_id,funcao,custo_usd,respondeu,em)
    values ('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia', 50, true, now() - interval '2 months');
  select * into r from public.pedir_ia('bbbbbbbb-0000-0000-0000-000000000002','receitas-ia');
  perform public.verifica('21 o mês passado não gasta o deste', r.permitido and r.gasto_eur = 0, r.gasto_eur::text);
end $$;

-- ===================================================== entradas estranhas
do $$ declare r record; begin
  select * into r from public.pedir_ia(null,'receitas-ia');
  perform public.verifica('22 sem pessoa não autoriza', not r.permitido);
  select * into r from public.pedir_ia('aaaaaaaa-0000-0000-0000-000000000001', repeat('x',50));
  perform public.verifica('23 nome de função absurdo não autoriza', not r.permitido);
  perform public.verifica('24 fechar com id inexistente devolve falso', public.fechar_ia(999999,'x',1,1,0.001) = false);
  perform public.verifica('25 fechar com id nulo devolve falso', public.fechar_ia(null,'x',1,1,0.001) = false);
end $$;

-- ===================================================== ninguém chega às contas
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ declare n int; begin
  begin select count(*) into n from public.ia_pedidos;
    perform public.verifica('26 aprovada não lê as contas da IA', false, 'leu '||n);
  exception when insufficient_privilege then perform public.verifica('26 aprovada não lê as contas da IA', true); end;
end $$;
do $$ begin
  begin insert into public.ia_pedidos(utilizador_id,funcao) values ('aaaaaaaa-0000-0000-0000-000000000001','x');
    perform public.verifica('27 nem escreve lá', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('27 nem escreve lá', true); end;
end $$;
do $$ begin
  begin perform public.pedir_ia('aaaaaaaa-0000-0000-0000-000000000001','receitas-ia');
    perform public.verifica('28 não pede autorização de gasto por fora da função', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('28 não pede autorização de gasto por fora da função', true); end;
end $$;
do $$ begin
  begin perform public.fechar_ia(1,'x',1,1,0);
    perform public.verifica('29 não fecha contas à mão', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('29 não fecha contas à mão', true); end;
end $$;
do $$ begin
  begin perform * from public.limites_ia();
    perform public.verifica('30 não lê os limites por fora', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('30 não lê os limites por fora', true); end;
end $$;
do $$ declare n int; begin
  select count(*) into n from public.custos_ia();
  perform public.verifica('31 quem não é administrador vê o painel vazio', n = 0, 'viu '||n);
end $$;
reset role;

-- ===================================================== o administrador vê
set role authenticated; select public.ser('dddddddd-0000-0000-0000-000000000004');
do $$ declare n int; begin
  select count(*) into n from public.custos_ia();
  perform public.verifica('32 o administrador vê o painel de custos', n >= 1, 'viu '||n);
end $$;
reset role;

set role anon; select public.ser_ninguem();
do $$ begin
  begin perform * from public.custos_ia();
    perform public.verifica('33 anónimo não vê o painel', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('33 anónimo não vê o painel', true); end;
end $$;
reset role;

select public.verifica('34 as funções do dinheiro estão fechadas ao PUBLIC e ao anon',
  not has_function_privilege('anon','public.pedir_ia(uuid,text)','execute')
  and not has_function_privilege('anon','public.fechar_ia(bigint,text,int,int,numeric)','execute')
  and not has_function_privilege('authenticated','public.pedir_ia(uuid,text)','execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.proname in ('pedir_ia','fechar_ia','limites_ia') and a.grantee = 0));
select public.verifica('35 o service_role é que pode gastar',
  has_function_privilege('service_role','public.pedir_ia(uuid,text)','execute')
  and has_function_privilege('service_role','public.fechar_ia(bigint,text,int,int,numeric)','execute'));
select public.verifica('36 o painel corre como dono, porque a tabela está fechada',
  (select prosecdef from pg_proc where proname='custos_ia'));
select public.verifica('37 e tem o caminho de pesquisa fixo (senão o dono era enganável)',
  (select bool_or(c like 'search_path=%') from pg_proc p, unnest(p.proconfig) c where p.proname='custos_ia'));

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
