-- Bateria das funções do servidor: só a chave de serviço as usa.
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
revoke all on function public.verifica(text,boolean,text) from public;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated, service_role;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated, service_role;

delete from auth.users; delete from public.autorizados; delete from public.alimentos;
insert into public.autorizados(email) values ('ana@exemplo.com');
insert into auth.users(id,email) values ('aaaaaaaa-0000-0000-0000-000000000001','ana@exemplo.com');

-- ===================================================== utilizadores não
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  begin perform public.guardar_alimento_off('5601234567890','Veneno',null,1,null,null,null,null,null);
    perform public.verifica('1  utilizador NÃO usa a escrita do servidor no catálogo', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('1  utilizador NÃO usa a escrita do servidor no catálogo', true, 'sem permissão'); end;
end $$;
do $$ begin
  begin perform public.registar_uso('aaaaaaaa-0000-0000-0000-000000000001','alimentos');
    perform public.verifica('2  utilizador NÃO mexe no contador de uso', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('2  utilizador NÃO mexe no contador de uso', true, 'sem permissão'); end;
end $$;
do $$ declare n int; begin
  begin select count(*) into n from public.uso_funcoes;
    perform public.verifica('3  utilizador NÃO lê o registo de uso', false, 'leu '||n);
  exception when insufficient_privilege then
    perform public.verifica('3  utilizador NÃO lê o registo de uso', true, 'sem permissão'); end;
end $$;
reset role;
set role anon; select public.ser_ninguem();
do $$ begin
  begin perform public.guardar_alimento_off('5601234567890','Veneno',null,1,null,null,null,null,null);
    perform public.verifica('4  anónimo NÃO usa a escrita do servidor', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('4  anónimo NÃO usa a escrita do servidor', true, 'sem permissão'); end;
end $$;
reset role;

-- ===================================================== o servidor sim
set role service_role;
do $$ declare r public.alimentos; begin
  select * into r from public.guardar_alimento_off('5601234567890','  Iogurte natural ','Mimosa',61,3.5,4.6,3.2,125,'iogurte');
  perform public.verifica('5  servidor guarda um produto', r.nome = 'Iogurte natural' and r.fonte = 'codigo_barras', r.nome);
end $$;
do $$ declare r public.alimentos; n int; begin
  select * into r from public.guardar_alimento_off('5601234567890','Iogurte natural','Mimosa',63,3.5,4.6,3.2,125,'iogurte');
  select count(*) into n from public.alimentos where codigo_barras='5601234567890';
  perform public.verifica('6  o mesmo código atualiza em vez de duplicar', n = 1 and r.kcal_100 = 63, n||' linhas, '||r.kcal_100||' kcal');
end $$;
do $$ begin
  begin perform public.guardar_alimento_off('abc;drop table x','Lixo',null,10,null,null,null,null,null);
    perform public.verifica('7  código de barras com letras é recusado', false, 'aceitou');
  exception when check_violation then perform public.verifica('7  código de barras com letras é recusado', true); end;
end $$;
do $$ begin
  begin perform public.guardar_alimento_off('5600000000001','Mentira',null,5000,null,null,null,null,null);
    perform public.verifica('8  valor impossível do Open Food Facts é recusado', false, 'aceitou');
  exception when check_violation then perform public.verifica('8  valor impossível do Open Food Facts é recusado', true); end;
end $$;
do $$ declare ok boolean; i int; recusados int := 0; begin
  for i in 1..32 loop
    select public.registar_uso('aaaaaaaa-0000-0000-0000-000000000001','alimentos') into ok;
    if not ok then recusados := recusados + 1; end if;
  end loop;
  perform public.verifica('9  limite de 30 por minuto trava a 31.ª', recusados = 2, recusados||' recusados em 32');
end $$;
do $$ declare ok boolean; begin
  select public.registar_uso('aaaaaaaa-0000-0000-0000-000000000001','outra_funcao') into ok;
  perform public.verifica('10 o limite é por função', ok);
end $$;
do $$ declare ok boolean; begin
  select public.registar_uso(null,'alimentos') into ok;
  perform public.verifica('11 sem utilizador não conta', ok = false);
end $$;
reset role;

-- O que o servidor guardou aparece a quem está aprovado.
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ declare n text; begin
  select nome into n from public.alimento_por_codigo('5601234567890');
  perform public.verifica('12 o produto guardado aparece na leitura do código', n = 'Iogurte natural', coalesce(n,'(nada)'));
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
