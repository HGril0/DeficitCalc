-- Bateria da tabela do INSA no catálogo.
-- O que tem de provar: a importação é fiel ao ficheiro e repetível; ninguém
-- consegue mexer nos valores do INSA a partir da app; as bebidas ficam por
-- ml; e a pesquisa nova encontra o que uma pessoa escreve à pressa sem
-- deixar de esconder os alimentos pessoais dos outros.
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
insert into public.alimentos_meus(utilizador_id,nome,kcal_100) values
  ('bbbbbbbb-0000-0000-0000-000000000002','Arroz de pato do Bruno',200),
  ('aaaaaaaa-0000-0000-0000-000000000001','Arroz de pato da Ana',180);
-- Um produto de código de barras com o mesmo nome de um do INSA, para a
-- ordem e o conflito.
insert into public.alimentos(nome,kcal_100,fonte,codigo_barras) values ('Arroz de pato',160,'codigo_barras','5600000000017');

-- ===================================================== importação
\i sql/13-insa-dados.sql
select public.verifica('1  importa os 1376 alimentos', (select count(*) from public.alimentos where fonte='insa') = 1376,
  (select count(*)::text from public.alimentos where fonte='insa'));
select public.verifica('2  36 bebidas alcoólicas marcadas por ml, e só essas',
  (select count(*) from public.alimentos where por_ml) = 36
  and not exists (select 1 from public.alimentos where por_ml and nome !~* '^(vinho|cerveja|licor|aguardente|brandy|gin|sidra)'),
  (select count(*)::text from public.alimentos where por_ml));
select public.verifica('3  valores fiéis: Abacate Hass 176 kcal, 17.4 g gordura',
  exists (select 1 from public.alimentos where codigo_insa='624' and nome='Abacate, Hass'
           and kcal_100=176 and gordura_100=17.4 and hidratos_100=2.3 and proteina_100=1.1));
select public.verifica('4  acentos e aspas intactos',
  exists (select 1 from public.alimentos where nome='Água mineral natural, "Luso"')
  and exists (select 1 from public.alimentos where nome='Vinho licoroso, teor alcoólico ≥20% vol.'));
select public.verifica('5  cerveja branca por 100 ml = 30 kcal',
  exists (select 1 from public.alimentos where codigo_insa='726' and por_ml and kcal_100=30));

-- Repetir a importação não duplica nada nem mexe em linhas iguais.
update public.alimentos set kcal_100 = 100 where codigo_insa='624';   -- "estragar" um valor
\i sql/13-insa-dados.sql
select public.verifica('6  repetir não duplica', (select count(*) from public.alimentos where fonte='insa') = 1376);
select public.verifica('7  repetir repõe o valor oficial', (select kcal_100 from public.alimentos where codigo_insa='624') = 176);
select public.verifica('8  o produto de código de barras ficou como estava',
  (select count(*) from public.alimentos where fonte='codigo_barras') = 1);

-- Regras da tabela.
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,codigo_insa) values ('Falso',10,'codigo_barras','123');
    perform public.verifica('9  código INSA só em linhas do INSA', false, 'aceitou');
  exception when check_violation then perform public.verifica('9  código INSA só em linhas do INSA', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,codigo_insa) values ('Repetido',10,'insa','624');
    perform public.verifica('10 dois alimentos com o mesmo código INSA não', false, 'aceitou');
  exception when unique_violation then perform public.verifica('10 dois alimentos com o mesmo código INSA não', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,codigo_insa) values ('Injeção',10,'insa','1; drop');
    perform public.verifica('11 código INSA só com algarismos', false, 'aceitou');
  exception when check_violation then perform public.verifica('11 código INSA só com algarismos', true); end;
end $$;

-- ===================================================== a Ana na app
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ declare n int; begin
  begin update public.alimentos set kcal_100 = 1 where codigo_insa = '624';
    get diagnostics n = row_count;
    perform public.verifica('12 aprovada não altera valores do INSA', n = 0, 'alterou '||n);
  exception when insufficient_privilege then perform public.verifica('12 aprovada não altera valores do INSA', true); end;
end $$;
do $$ begin
  begin update public.alimentos set por_ml = true where codigo_insa = '624';
    perform public.verifica('13 não muda a marca por_ml', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('13 não muda a marca por_ml', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,codigo_insa) values ('Meu INSA',1,'insa','99999');
    perform public.verifica('14 não insere no catálogo como se fosse do INSA', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('14 não insere no catálogo como se fosse do INSA', true); end;
end $$;
do $$ declare n int; begin
  begin delete from public.alimentos where fonte='insa';
    get diagnostics n = row_count;
    perform public.verifica('15 não apaga o INSA', n = 0, 'apagou '||n);
  exception when insufficient_privilege then perform public.verifica('15 não apaga o INSA', true); end;
end $$;
select public.verifica('16 lê as colunas novas', (select por_ml from public.alimentos where codigo_insa='726'));

-- Pesquisa.
select public.verifica('17 sem acentos: "acucar" encontra Açúcar',
  exists (select 1 from public.procurar_alimento('acucar') where nome='Açúcar branco'));
select public.verifica('18 com acentos também: "Açúcar"',
  exists (select 1 from public.procurar_alimento('Açúcar') where nome='Açúcar branco'));
select public.verifica('19 palavras soltas: "arroz pato" encontra Arroz de pato do INSA',
  exists (select 1 from public.procurar_alimento('arroz pato') where nome='Arroz de pato' and fonte='insa'));
select public.verifica('20 por outra ordem: "pato arroz"',
  exists (select 1 from public.procurar_alimento('pato arroz') where nome='Arroz de pato'));
select public.verifica('21 plural: "ovos" encontra Ovo de galinha',
  exists (select 1 from public.procurar_alimento('ovos') where nome like 'Ovo de galinha%'));
select public.verifica('22 plural em -ões: "limoes" encontra Limão',
  exists (select 1 from public.procurar_alimento('limoes') where nome='Limão'));
select public.verifica('23 o meu primeiro, depois INSA, depois código de barras',
  (select string_agg(fonte, '>' order by o) from (select fonte, row_number() over () o
     from public.procurar_alimento('arroz de pato')) t) = 'meu>insa>codigo_barras',
  (select string_agg(fonte||':'||nome, ' > ') from public.procurar_alimento('arroz de pato')));
select public.verifica('24 nunca o alimento pessoal do Bruno',
  not exists (select 1 from public.procurar_alimento('pato bruno'))
  and not exists (select 1 from public.procurar_alimento('arroz') where nome like '%Bruno%'));
-- "Arroz de pato" é mais curto do que "Pato com pele, cru": sem a regra do
-- começo, era ele o primeiro do INSA.
select public.verifica('25 quem começa pela pesquisa vem antes do que é só mais curto',
  (select nome from public.procurar_alimento('pato') where fonte='insa' limit 1) like 'Pato%',
  (select nome from public.procurar_alimento('pato') where fonte='insa' limit 1));
select public.verifica('26 "%" é um carácter, não um curinga',
  (select count(*) from public.procurar_alimento('%%')) = 0
  and exists (select 1 from public.procurar_alimento('0% açúcares')));
select public.verifica('27 "_" também',
  (select count(*) from public.procurar_alimento('__')) = 0);
select public.verifica('28 traz por_ml para o ecrã',
  (select por_ml from public.procurar_alimento('cerveja branca') limit 1));
select public.verifica('29 limite máximo de 50 resultados',
  (select count(*) from public.procurar_alimento('a e', 999)) = 50);
select public.verifica('30 limite nulo não rebenta', (select count(*) from public.procurar_alimento('arroz', null)) between 1 and 20);
select public.verifica('31 texto nulo devolve vazio', (select count(*) from public.procurar_alimento(null)) = 0);
select public.verifica('32 só espaços devolve vazio', (select count(*) from public.procurar_alimento('     ')) = 0);
select public.verifica('33 mais de 8 palavras devolve vazio (não serve para varrer o catálogo)',
  (select count(*) from public.procurar_alimento('a b c d e f g h i')) = 0);
select public.verifica('34 texto enorme é cortado, não rebenta',
  (select count(*) from public.procurar_alimento(repeat('arroz ', 5000))) >= 0);
reset role;

-- ===================================================== quem não deve
set role authenticated; select public.ser('cccccccc-0000-0000-0000-000000000003');
select public.verifica('35 por aprovar não vê o INSA', (select count(*) from public.alimentos) = 0);
select public.verifica('36 por aprovar: pesquisa vazia', (select count(*) from public.procurar_alimento('arroz')) = 0);
reset role;
set role anon; select public.ser_ninguem();
do $$ begin
  begin perform * from public.procurar_alimento('arroz');
    perform public.verifica('37 anónimo não pesquisa', false, 'CONSEGUIU');
  exception when insufficient_privilege then perform public.verifica('37 anónimo não pesquisa', true); end;
end $$;
do $$ declare n int; begin
  begin select count(*) into n from public.alimentos;
    perform public.verifica('38 anónimo não lê o catálogo', false, 'leu '||n);
  exception when insufficient_privilege then perform public.verifica('38 anónimo não lê o catálogo', true); end;
end $$;
reset role;

-- A função recriada não pode ter perdido as permissões pelo caminho.
select public.verifica('39 pesquisa continua fechada ao PUBLIC e ao anon',
  not has_function_privilege('anon', 'public.procurar_alimento(text,int)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where p.proname='procurar_alimento' and a.grantee = 0));
select public.verifica('40 pesquisa continua security invoker',
  not (select prosecdef from pg_proc where proname='procurar_alimento'));
select public.verifica('41 authenticated continua só com SELECT no catálogo',
  has_table_privilege('authenticated','public.alimentos','select')
  and not has_table_privilege('authenticated','public.alimentos','insert')
  and not has_table_privilege('authenticated','public.alimentos','update')
  and not has_table_privilege('authenticated','public.alimentos','delete')
  and not has_column_privilege('authenticated','public.alimentos','por_ml','update'));

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
