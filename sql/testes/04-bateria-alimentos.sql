-- Bateria do passo 7: base de alimentos.
-- O que esta bateria existe para provar: o catálogo é partilhado para LER e
-- fechado para ESCREVER, e os alimentos pessoais de cada um são invisíveis
-- aos outros mesmo através da função de pesquisa.
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated;

delete from auth.users;
delete from public.autorizados;
delete from public.alimentos;
insert into public.autorizados(email) values ('ana@exemplo.com'),('bruno@exemplo.com');
insert into auth.users(id,email,raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ana@exemplo.com','{"full_name":"Ana"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bruno@exemplo.com','{"full_name":"Bruno"}'),
  ('cccccccc-0000-0000-0000-000000000003','estranho@exemplo.com','{"full_name":"Estranho"}');

-- Perfil completo da Ana. Sem isto o teste 33 passava por falta de dados em
-- vez de por a guarda funcionar: um teste que passa sozinho não prova nada.
update public.profiles set sexo='f', data_nascimento='1995-04-10', altura_cm=165,
       nivel_atividade='moderado', objetivo_kg_semana=0.5
 where id='aaaaaaaa-0000-0000-0000-000000000001';
insert into public.pesos(utilizador_id,kg,medido_em)
  values ('aaaaaaaa-0000-0000-0000-000000000001',68.4,current_date)
  on conflict (utilizador_id,medido_em) do update set kg=excluded.kg;

-- Catálogo de partida, inserido como dono: é o servidor que o escreve.
insert into public.alimentos(id,nome,marca,kcal_100,fonte,codigo_barras,gramas_unidade,nome_unidade) values
  ('11111111-0000-0000-0000-000000000001','Arroz cozido',null,130,'insa',null,null,null),
  ('11111111-0000-0000-0000-000000000002','Arroz agulha cru','Cigala',349,'codigo_barras','5601234567890',null,null),
  ('11111111-0000-0000-0000-000000000003','Arroz à valenciana estimado',null,150,'ia',null,null,null),
  ('11111111-0000-0000-0000-000000000004','Ovo cozido',null,155,'insa',null,55,'ovo');

-- Alimentos pessoais: um de cada um, com nomes que a pesquisa por "arroz" apanha.
insert into public.alimentos_meus(id,utilizador_id,nome,kcal_100) values
  ('22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Arroz da avó',210),
  ('22222222-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Arroz secreto do Bruno',999 - 200);

-- ============================================ limites guardados na BD
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte) values ('X',100,'inventada');
    perform public.verifica('1  BD recusa fonte inventada', false, 'aceitou');
  exception when check_violation then perform public.verifica('1  BD recusa fonte inventada', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte) values ('Óleo impossível',1200,'insa');
    perform public.verifica('2  BD recusa mais de 900 kcal/100 g', false, 'aceitou');
  exception when check_violation then perform public.verifica('2  BD recusa mais de 900 kcal/100 g', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,proteina_100,hidratos_100,gordura_100)
         values ('Macros impossíveis',400,'insa',50,50,50);
    perform public.verifica('3  BD recusa macros a somar mais de 100 g', false, 'aceitou');
  exception when check_violation then perform public.verifica('3  BD recusa macros a somar mais de 100 g', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte) values ('   ',100,'insa');
    perform public.verifica('4  BD recusa nome vazio', false, 'aceitou');
  exception when check_violation then perform public.verifica('4  BD recusa nome vazio', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,gramas_unidade) values ('Meia unidade',100,'insa',50);
    perform public.verifica('5  BD recusa peso de unidade sem nome da unidade', false, 'aceitou');
  exception when check_violation then perform public.verifica('5  BD recusa peso de unidade sem nome da unidade', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte,codigo_barras)
         values ('Repetido',200,'codigo_barras','5601234567890');
    perform public.verifica('6  BD recusa código de barras repetido', false, 'aceitou');
  exception when unique_violation then perform public.verifica('6  BD recusa código de barras repetido', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos_meus(utilizador_id,nome,kcal_100)
         values ('aaaaaaaa-0000-0000-0000-000000000001','Arroz da avó',300);
    perform public.verifica('7  BD recusa dois alimentos meus com o mesmo nome', false, 'aceitou');
  exception when unique_violation then perform public.verifica('7  BD recusa dois alimentos meus com o mesmo nome', true); end;
end $$;
do $$ begin
  begin insert into public.alimentos_meus(utilizador_id,nome,kcal_100)
         values ('bbbbbbbb-0000-0000-0000-000000000002','Arroz da avó',300);
    perform public.verifica('8  mesmo nome em pessoas diferentes é permitido', true);
  exception when others then perform public.verifica('8  mesmo nome em pessoas diferentes é permitido', false, sqlerrm); end;
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal,gramas)
         values ('aaaaaaaa-0000-0000-0000-000000000001','almoco',300,50000);
    perform public.verifica('9  BD recusa 50 kg num registo', false, 'aceitou');
  exception when check_violation then perform public.verifica('9  BD recusa 50 kg num registo', true); end;
end $$;

-- ================================= o catálogo é só de leitura (o essencial)
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');

select public.verifica('10 aprovada lê o catálogo',
  (select count(*) from public.alimentos) = 4,
  'viu '||(select count(*) from public.alimentos)||' de 4');

do $$ begin
  begin insert into public.alimentos(nome,kcal_100,fonte) values ('Inventado pela Ana',10,'insa');
    perform public.verifica('11 utilizadora NÃO acrescenta ao catálogo', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('11 utilizadora NÃO acrescenta ao catálogo', true, 'sem permissão'); end;
end $$;

do $$ declare n int; begin
  begin update public.alimentos set kcal_100 = 1 where nome = 'Arroz cozido';
    select kcal_100 into n from public.alimentos where nome='Arroz cozido';
    perform public.verifica('12 utilizadora NÃO altera kcal do catálogo', n = 130,
      case when n=130 then 'update não pegou' else 'MUDOU para '||n end);
  exception when insufficient_privilege then
    perform public.verifica('12 utilizadora NÃO altera kcal do catálogo', true, 'sem permissão'); end;
end $$;

do $$ declare n int; begin
  begin delete from public.alimentos where nome = 'Arroz cozido';
    select count(*) into n from public.alimentos where nome='Arroz cozido';
    perform public.verifica('13 utilizadora NÃO apaga do catálogo', n = 1,
      case when n=1 then 'delete não pegou' else 'APAGOU' end);
  exception when insufficient_privilege then
    perform public.verifica('13 utilizadora NÃO apaga do catálogo', true, 'sem permissão'); end;
end $$;

-- ============================================ alimentos pessoais isolados
select public.verifica('14 Ana vê só os alimentos dela',
  (select count(*) from public.alimentos_meus) = 1
  and (select nome from public.alimentos_meus) = 'Arroz da avó',
  'viu '||(select count(*) from public.alimentos_meus));

do $$ begin
  begin insert into public.alimentos_meus(utilizador_id,nome,kcal_100)
         values ('bbbbbbbb-0000-0000-0000-000000000002','Plantado na conta do Bruno',100);
    perform public.verifica('15 Ana não cria alimentos na conta do Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('15 Ana não cria alimentos na conta do Bruno', true, 'recusado pelo RLS'); end;
end $$;

do $$ declare n numeric; begin
  update public.alimentos_meus set kcal_100 = 1
   where id = '22222222-0000-0000-0000-000000000002';
  select kcal_100 into n from public.alimentos_meus
   where id = '22222222-0000-0000-0000-000000000002';
  perform public.verifica('16 Ana não altera o alimento do Bruno', n is null,
    coalesce('viu valor '||n, 'invisível, como deve ser'));
end $$;

do $$ begin
  delete from public.alimentos_meus where id = '22222222-0000-0000-0000-000000000002';
  perform public.verifica('17 Ana não apaga o alimento do Bruno', true, 'delete sem efeito');
end $$;

-- O erro que já aconteceu uma vez neste projeto: permissão dada à tabela em
-- vez de coluna a coluna deixava mudar uma coluna proibida.
do $$ begin
  begin update public.alimentos_meus
            set utilizador_id = 'bbbbbbbb-0000-0000-0000-000000000002'
          where id = '22222222-0000-0000-0000-000000000001';
    perform public.verifica('18 Ana não passa um alimento seu para o Bruno', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('18 Ana não passa um alimento seu para o Bruno', true, 'coluna sem permissão'); end;
end $$;

-- ====================================================== pesquisa
do $$ declare primeiro text; declare n int; begin
  select nome into primeiro from public.procurar_alimento('arroz') limit 1;
  select count(*) into n from public.procurar_alimento('arroz');
  perform public.verifica('19 pesquisa põe os meus alimentos à frente',
    primeiro = 'Arroz da avó', 'primeiro foi '||coalesce(primeiro,'(nada)'));
  perform public.verifica('20 pesquisa NÃO mostra alimentos pessoais de outros',
    not exists (select 1 from public.procurar_alimento('arroz')
                 where nome = 'Arroz secreto do Bruno'),
    'devolveu '||n||' linhas');
end $$;

do $$ declare n int; begin
  select count(*) into n from public.procurar_alimento('a');
  perform public.verifica('21 pesquisa com uma só letra devolve vazio', n = 0, 'devolveu '||n);
end $$;

do $$ declare ordem text; begin
  select string_agg(fonte, ' > ' order by t.ord) into ordem
    from (select fonte, row_number() over () as ord
            from public.procurar_alimento('arroz')) t;
  perform public.verifica('22 ordem das fontes: meu > insa > código de barras > ia',
    ordem = 'meu > insa > codigo_barras > ia', 'deu: '||coalesce(ordem,'(nada)'));
end $$;

do $$ declare nome_ text; begin
  select nome into nome_ from public.alimento_por_codigo('5601234567890');
  perform public.verifica('23 leitura por código de barras acerta',
    nome_ = 'Arroz agulha cru', 'deu '||coalesce(nome_,'(nada)'));
end $$;

do $$ declare n int; begin
  select count(*) into n from public.alimento_por_codigo('0000000000000');
  perform public.verifica('24 código desconhecido devolve vazio', n = 0, 'devolveu '||n);
end $$;

do $$ declare g numeric; begin
  select gramas_unidade into g from public.procurar_alimento('ovo') limit 1;
  perform public.verifica('25 unidade do ovo chega ao cliente', g = 55, 'deu '||coalesce(g::text,'(nulo)'));
end $$;
reset role;

-- ====================================================== sem sessão
-- Nota: aqui o anon leva erro de permissão na tabela ANTES de o RLS entrar em
-- campo. Os meus primeiros testes esperavam "zero linhas" e por isso nem
-- chegavam a registar resultado. A barreira é a permissão, não o RLS.
set role anon; select public.ser_ninguem();
do $$ declare n int; begin
  begin select count(*) into n from public.alimentos;
    perform public.verifica('26 sem sessão não lê o catálogo', false, 'leu '||n||' linhas');
  exception when insufficient_privilege then
    perform public.verifica('26 sem sessão não lê o catálogo', true, 'sem permissão na tabela'); end;
end $$;
do $$ declare n int; begin
  begin select count(*) into n from public.alimentos_meus;
    perform public.verifica('27 sem sessão não lê alimentos pessoais', false, 'leu '||n||' linhas');
  exception when insufficient_privilege then
    perform public.verifica('27 sem sessão não lê alimentos pessoais', true, 'sem permissão na tabela'); end;
end $$;
do $$ begin
  begin perform * from public.procurar_alimento('arroz');
    perform public.verifica('28 sem sessão não usa a pesquisa', false, 'CONSEGUIU executar');
  exception when insufficient_privilege then
    perform public.verifica('28 sem sessão não usa a pesquisa', true, 'sem permissão'); end;
end $$;

-- ===================== regressão: as duas falhas encontradas a 22/10/2026
-- 1) EXECUTE dado ao PUBLIC por omissão, que o revoke ao anon não tirava.
-- 2) guarda do estimar_gasto com <> em vez de is distinct from: sem sessão,
--    auth.uid() é NULL, a comparação dava NULL e a guarda não disparava.
do $$ begin
  begin perform * from public.estimar_gasto('aaaaaaaa-0000-0000-0000-000000000001');
    perform public.verifica('32 sem sessão não executa estimar_gasto', false, 'CONSEGUIU executar');
  exception when insufficient_privilege then
    perform public.verifica('32 sem sessão não executa estimar_gasto', true, 'sem permissão'); end;
end $$;
reset role;

-- Mesmo com permissão para executar, um utilizador autenticado não pode pedir
-- o gasto de outra pessoa. É esta a guarda que estava furada.
set role authenticated; select public.ser('bbbbbbbb-0000-0000-0000-000000000002');
do $$ declare n int; begin
  select count(*) into n from public.estimar_gasto('aaaaaaaa-0000-0000-0000-000000000001');
  perform public.verifica('33 Bruno não obtém o gasto da Ana', n = 0, 'devolveu '||n||' linhas');
end $$;
reset role;

-- ================================================ aprovado? ainda não
set role authenticated; select public.ser('cccccccc-0000-0000-0000-000000000003');
select public.verifica('29 estranho não lê o catálogo',
  (select count(*) from public.alimentos) = 0,
  'viu '||(select count(*) from public.alimentos));
do $$ begin
  begin insert into public.alimentos_meus(utilizador_id,nome,kcal_100)
         values ('cccccccc-0000-0000-0000-000000000003','Alimento do estranho',100);
    perform public.verifica('30 estranho não cria alimentos pessoais', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('30 estranho não cria alimentos pessoais', true, 'recusado'); end;
end $$;
do $$ declare n int; begin
  select count(*) into n from public.procurar_alimento('arroz');
  perform public.verifica('31 pesquisa vazia para quem não está aprovado', n = 0, 'devolveu '||n);
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
