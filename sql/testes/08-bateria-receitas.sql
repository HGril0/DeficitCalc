-- Bateria do passo 8: receitas.
-- O ataque que esta bateria existe para travar: pôr ingredientes na receita
-- de outra pessoa com um utilizador_id meu.
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
revoke all on function public.verifica(text,boolean,text) from public;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated;

delete from auth.users; delete from public.autorizados; delete from public.alimentos;
insert into public.autorizados(email) values ('ana@exemplo.com'),('bruno@exemplo.com');
insert into auth.users(id,email) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ana@exemplo.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bruno@exemplo.com'),
  ('cccccccc-0000-0000-0000-000000000003','estranho@exemplo.com');
insert into public.receitas(id,utilizador_id,nome,porcoes) values
  ('99999999-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Bacalhau do Bruno',4);
insert into public.receita_ingredientes(receita_id,utilizador_id,nome,kcal_100,gramas) values
  ('99999999-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Bacalhau',136,600);
insert into public.alimentos_meus(id,utilizador_id,nome,kcal_100) values
  ('88888888-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Molho secreto',300);

-- ======================================================= a Ana a cozinhar
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ declare rid uuid; begin
  insert into public.receitas(nome,porcoes,peso_final_g) values ('Arroz de legumes',4,800) returning id into rid;
  insert into public.receita_ingredientes(receita_id,nome,kcal_100,gramas,ordem) values
    (rid,'Arroz agulha cru',350,200,1),
    (rid,'Azeite',884,30,2);
  perform public.verifica('1  cria receita e ingredientes sem mandar o dono', true);
exception when others then perform public.verifica('1  cria receita e ingredientes sem mandar o dono', false, sqlerrm); end $$;

do $$ declare r record; begin
  select * into r from public.receitas_resumo() where nome='Arroz de legumes';
  perform public.verifica('2  total 700+265 = 965 kcal', r.kcal_total = 965, 'deu '||r.kcal_total);
  perform public.verifica('3  por porção (4) = 241', r.kcal_porcao = 241, 'deu '||r.kcal_porcao);
  perform public.verifica('4  por 100 g do tacho (800 g) = 120.7', r.kcal_100_final = 120.7, 'deu '||r.kcal_100_final);
  perform public.verifica('5  conta 2 ingredientes e 230 g', r.ingredientes = 2 and r.gramas_total = 230, r.ingredientes||' / '||r.gramas_total);
end $$;

do $$ declare n int; begin
  select count(*) into n from public.receitas_resumo();
  perform public.verifica('6  o resumo só mostra as receitas dela', n = 1, 'viu '||n);
end $$;
select public.verifica('7  não vê a receita do Bruno', (select count(*) from public.receitas where nome like '%Bruno%') = 0);
select public.verifica('8  não vê os ingredientes do Bruno', (select count(*) from public.receita_ingredientes where nome='Bacalhau') = 0);

-- O ATAQUE: ingrediente com utilizador_id da Ana, dentro da receita do Bruno.
do $$ begin
  begin insert into public.receita_ingredientes(receita_id,nome,kcal_100,gramas)
         values ('99999999-0000-0000-0000-00000000000b','Sal a mais',0,9999);
    perform public.verifica('9  NÃO mete ingredientes na receita do Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('9  NÃO mete ingredientes na receita do Bruno', true, 'recusado pelo RLS'); end;
end $$;
reset role;
select public.verifica('9b e a receita do Bruno continua com 1 ingrediente',
  (select count(*) from public.receita_ingredientes where receita_id='99999999-0000-0000-0000-00000000000b') = 1);

set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
-- Mudar um ingrediente seu para a receita do Bruno.
do $$ begin
  begin update public.receita_ingredientes set receita_id='99999999-0000-0000-0000-00000000000b' where nome='Azeite';
    perform public.verifica('10 NÃO muda um ingrediente para a receita do Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('10 NÃO muda um ingrediente para a receita do Bruno', true, 'coluna sem permissão'); end;
end $$;
do $$ begin
  begin update public.receita_ingredientes set utilizador_id='bbbbbbbb-0000-0000-0000-000000000002' where nome='Azeite';
    perform public.verifica('11 NÃO passa um ingrediente para o Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('11 NÃO passa um ingrediente para o Bruno', true, 'coluna sem permissão'); end;
end $$;
do $$ begin
  begin update public.receitas set utilizador_id='bbbbbbbb-0000-0000-0000-000000000002' where nome='Arroz de legumes';
    perform public.verifica('12 NÃO passa a receita para o Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('12 NÃO passa a receita para o Bruno', true, 'coluna sem permissão'); end;
end $$;
-- Ligar um ingrediente ao alimento pessoal do Bruno.
do $$ declare rid uuid; begin
  select id into rid from public.receitas where nome='Arroz de legumes';
  begin insert into public.receita_ingredientes(receita_id,nome,kcal_100,gramas,alimento_meu_id)
         values (rid,'Molho',300,10,'88888888-0000-0000-0000-00000000000b');
    perform public.verifica('13 NÃO liga ao alimento pessoal do Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('13 NÃO liga ao alimento pessoal do Bruno', true, 'recusado'); end;
end $$;
do $$ declare n int; begin
  delete from public.receita_ingredientes where receita_id='99999999-0000-0000-0000-00000000000b';
  delete from public.receitas where id='99999999-0000-0000-0000-00000000000b';
  perform public.verifica('14 apagar coisas do Bruno não tem efeito', true);
end $$;
reset role;
select public.verifica('14b a receita do Bruno continua lá',
  (select count(*) from public.receitas where id='99999999-0000-0000-0000-00000000000b') = 1
  and (select count(*) from public.receita_ingredientes where receita_id='99999999-0000-0000-0000-00000000000b') = 1);

-- ================================================================ limites
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  begin insert into public.receitas(nome,porcoes) values ('Zero porções',0);
    perform public.verifica('15 recusa 0 porções', false, 'aceitou');
  exception when check_violation then perform public.verifica('15 recusa 0 porções', true); end;
end $$;
do $$ begin
  begin insert into public.receitas(nome) values ('Arroz de legumes');
    perform public.verifica('16 recusa duas receitas com o mesmo nome', false, 'aceitou');
  exception when unique_violation then perform public.verifica('16 recusa duas receitas com o mesmo nome', true); end;
end $$;
do $$ declare rid uuid; begin
  select id into rid from public.receitas where nome='Arroz de legumes';
  begin insert into public.receita_ingredientes(receita_id,nome,kcal_100,gramas) values (rid,'Impossível',1200,10);
    perform public.verifica('17 recusa mais de 900 kcal/100 g', false, 'aceitou');
  exception when check_violation then perform public.verifica('17 recusa mais de 900 kcal/100 g', true); end;
  begin insert into public.receita_ingredientes(receita_id,nome,kcal_100,gramas) values (rid,'Nada',100,0);
    perform public.verifica('18 recusa 0 gramas', false, 'aceitou');
  exception when check_violation then perform public.verifica('18 recusa 0 gramas', true); end;
end $$;
-- Apagar a receita leva os ingredientes atrás.
do $$ declare n int; begin
  delete from public.receitas where nome='Arroz de legumes';
  select count(*) into n from public.receita_ingredientes;
  perform public.verifica('19 apagar a receita apaga os ingredientes', n = 0, 'sobraram '||n);
end $$;
reset role;

-- ============================================ sem sessão e por aprovar
set role anon; select public.ser_ninguem();
do $$ begin
  begin perform count(*) from public.receitas;
    perform public.verifica('20 anónimo não lê receitas', false, 'leu');
  exception when insufficient_privilege then perform public.verifica('20 anónimo não lê receitas', true); end;
  begin perform * from public.receitas_resumo();
    perform public.verifica('21 anónimo não chama o resumo', false, 'chamou');
  exception when insufficient_privilege then perform public.verifica('21 anónimo não chama o resumo', true); end;
end $$;
reset role;
set role authenticated; select public.ser('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  begin insert into public.receitas(nome) values ('Receita do estranho');
    perform public.verifica('22 por aprovar não cria receitas', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('22 por aprovar não cria receitas', true); end;
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
