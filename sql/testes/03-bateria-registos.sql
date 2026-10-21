-- Bateria do passo 6: registo diário.
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
insert into public.autorizados(email) values ('ana@exemplo.com'),('bruno@exemplo.com');
insert into auth.users(id,email,raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ana@exemplo.com','{"full_name":"Ana"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bruno@exemplo.com','{"full_name":"Bruno"}'),
  ('cccccccc-0000-0000-0000-000000000003','estranho@exemplo.com','{"full_name":"Estranho"}');

-- dados de partida, inseridos como dono para preparar o cenário
insert into public.registos(utilizador_id,data,refeicao,descricao,kcal) values
  ('aaaaaaaa-0000-0000-0000-000000000001',current_date,'pequeno_almoco','Pão',180),
  ('aaaaaaaa-0000-0000-0000-000000000001',current_date,'pequeno_almoco','Queijo',160),
  ('aaaaaaaa-0000-0000-0000-000000000001',current_date,'almoco','Massa com atum',620),
  ('aaaaaaaa-0000-0000-0000-000000000001',current_date-1,'almoco','Sopa',240),
  ('bbbbbbbb-0000-0000-0000-000000000002',current_date,'almoco','Bitoque',900);

-- =============================================== limites guardados na BD
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal) values ('aaaaaaaa-0000-0000-0000-000000000001','ceia',300);
    perform public.verifica('1  BD recusa refeição inventada', false, 'aceitou');
  exception when check_violation then perform public.verifica('1  BD recusa refeição inventada', true); end;
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal) values ('aaaaaaaa-0000-0000-0000-000000000001','almoco',9000);
    perform public.verifica('2  BD recusa 9000 kcal numa linha', false, 'aceitou');
  exception when check_violation then perform public.verifica('2  BD recusa 9000 kcal numa linha', true); end;
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal,nao_comi) values ('aaaaaaaa-0000-0000-0000-000000000001','jantar',500,true);
    perform public.verifica('3  BD recusa "não comi" com calorias', false, 'aceitou');
  exception when check_violation then perform public.verifica('3  BD recusa "não comi" com calorias', true); end;
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal,nao_comi) values ('aaaaaaaa-0000-0000-0000-000000000001','lanche',0,true);
    perform public.verifica('4  BD recusa "não comi" num lanche', false, 'aceitou');
  exception when check_violation then perform public.verifica('4  BD recusa "não comi" num lanche', true); end;
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,data,refeicao,kcal) values ('aaaaaaaa-0000-0000-0000-000000000001',current_date+5,'almoco',300);
    perform public.verifica('5  BD recusa data no futuro', false, 'aceitou');
  exception when check_violation then perform public.verifica('5  BD recusa data no futuro', true); end;
end $$;
do $$ begin
  insert into public.registos(utilizador_id,refeicao,kcal,nao_comi) values ('aaaaaaaa-0000-0000-0000-000000000001','jantar',0,true);
  begin insert into public.registos(utilizador_id,refeicao,kcal,nao_comi) values ('aaaaaaaa-0000-0000-0000-000000000001','jantar',0,true);
    perform public.verifica('6  BD recusa duas faltas na mesma refeição', false, 'aceitou');
  exception when unique_violation then perform public.verifica('6  BD recusa duas faltas na mesma refeição', true); end;
end $$;

-- ====================================================== sem sessão
set role anon; select public.ser_ninguem();
do $$ declare n int; begin
  begin select count(*) into n from public.registos;
    perform public.verifica('7  anon não lê registos', n=0, 'leu '||n);
  exception when insufficient_privilege then perform public.verifica('7  anon não lê registos', true, 'permissão negada'); end;
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal) values ('aaaaaaaa-0000-0000-0000-000000000001','almoco',500);
    perform public.verifica('8  anon não escreve registos', false, 'conseguiu');
  exception when insufficient_privilege then perform public.verifica('8  anon não escreve registos', true, 'permissão negada'); end;
end $$;
reset role;

-- ====================================================== Ana (aprovada)
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
select public.verifica('9  Ana vê só os seus registos',
  (select count(*) from public.registos where utilizador_id <> 'aaaaaaaa-0000-0000-0000-000000000001')=0);
select public.verifica('10 Ana não vê o bitoque do Bruno',
  (select count(*) from public.registos where descricao='Bitoque')=0);
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal) values ('bbbbbbbb-0000-0000-0000-000000000002','almoco',500);
    perform public.verifica('11 Ana não regista em nome do Bruno', false, 'conseguiu');
  exception when insufficient_privilege or check_violation then
    perform public.verifica('11 Ana não regista em nome do Bruno', true, 'recusado'); end;
end $$;
do $$ declare n int; begin
  update public.registos set kcal=1 where descricao='Bitoque';
  get diagnostics n = row_count;
  perform public.verifica('12 Ana não altera registos do Bruno', n=0, n||' linhas');
end $$;
do $$ declare n int; begin
  delete from public.registos where descricao='Bitoque';
  get diagnostics n = row_count;
  perform public.verifica('13 Ana não apaga registos do Bruno', n=0, n||' linhas');
end $$;
do $$ begin
  begin update public.registos set utilizador_id='bbbbbbbb-0000-0000-0000-000000000002' where descricao='Pão';
    perform public.verifica('14 Ana não oferece um registo ao Bruno', false, 'conseguiu');
  exception when insufficient_privilege then perform public.verifica('14 Ana não oferece um registo ao Bruno', true, 'permissão negada'); end;
end $$;

-- totais do dia
do $$ declare pa int; al int; ja boolean; begin
  select kcal into pa from public.dia() where refeicao='pequeno_almoco';
  select kcal into al from public.dia() where refeicao='almoco';
  select nao_comi into ja from public.dia() where refeicao='jantar';
  perform public.verifica('15 soma as duas linhas do pequeno-almoço', pa=340, 'deu '||coalesce(pa::text,'nulo'));
  perform public.verifica('16 almoço com um item', al=620, 'deu '||coalesce(al::text,'nulo'));
  perform public.verifica('17 jantar marcado como saltado', ja is true);
end $$;
do $$ declare total int; begin
  select sum(kcal) into total from public.ultimos_dias(7) where data=current_date;
  perform public.verifica('18 total de hoje na semana', total=960, 'deu '||coalesce(total::text,'nulo'));
end $$;
do $$ declare n int; begin
  select count(*) into n from public.ultimos_dias(7);
  perform public.verifica('19 semana traz 7 dias mesmo com dias vazios', n=7, 'deu '||n);
end $$;
do $$ declare c boolean; begin
  -- hoje tem as três principais (jantar saltado conta), logo está completo
  select completo into c from public.ultimos_dias(7) where data=current_date;
  perform public.verifica('20 jantar saltado conta para o dia completo', c is true);
end $$;
do $$ declare c boolean; begin
  -- ontem só teve almoço
  select completo into c from public.ultimos_dias(7) where data=current_date-1;
  perform public.verifica('20b dia só com almoço não está completo', c is false);
end $$;
do $$ declare c boolean; begin
  select completo into c from public.ultimos_dias(7) where data=current_date-4;
  perform public.verifica('20c dia sem nada não está completo', c is false);
end $$;
do $$ declare n int; begin
  select count(*) into n from public.ultimos_dias(1000);
  perform public.verifica('21 pedido absurdo de dias é limitado', n<=90, 'devolveu '||n);
end $$;
reset role;

-- ====================================================== Bruno não vê a Ana
set role authenticated; select public.ser('bbbbbbbb-0000-0000-0000-000000000002');
do $$ declare total int; begin
  select sum(kcal) into total from public.ultimos_dias(7) where data=current_date;
  perform public.verifica('22 Bruno só soma o que é dele', total=900, 'deu '||coalesce(total::text,'nulo'));
end $$;
reset role;

-- ====================================================== estranho por aprovar
set role authenticated; select public.ser('cccccccc-0000-0000-0000-000000000003');
select public.verifica('23 estranho não lê registos nenhuns', (select count(*) from public.registos)=0);
do $$ declare n int; begin
  select count(*) into n from public.dia();
  perform public.verifica('24 dia() não responde a quem não está aprovado', n=0, 'devolveu '||n);
end $$;
do $$ declare total int; begin
  select coalesce(sum(kcal),0) into total from public.ultimos_dias(7);
  perform public.verifica('25 semana vazia para quem não está aprovado', total=0, 'deu '||total);
end $$;
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal) values ('cccccccc-0000-0000-0000-000000000003','almoco',500);
    perform public.verifica('26 estranho não regista nada', false, 'conseguiu');
  exception when insufficient_privilege or check_violation then
    perform public.verifica('26 estranho não regista nada', true, 'recusado'); end;
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
