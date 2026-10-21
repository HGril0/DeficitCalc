-- Bateria do passo 5: pesos e estimativa de gasto.
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

update public.profiles set sexo='f', data_nascimento='1995-03-01', altura_cm=165,
       nivel_atividade='moderado', objetivo_kg_semana=0.50
 where id='aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set sexo='m', data_nascimento='1990-01-01', altura_cm=180,
       nivel_atividade='leve', objetivo_kg_semana=0.75
 where id='bbbbbbbb-0000-0000-0000-000000000002';
insert into public.pesos(utilizador_id,kg,medido_em) values
  ('aaaaaaaa-0000-0000-0000-000000000001',68.0,current_date),
  ('bbbbbbbb-0000-0000-0000-000000000002',82.5,current_date);

-- ------------------------------------------------- limites guardados na BD
do $$ begin
  begin update public.profiles set objetivo_kg_semana=1.5 where id='aaaaaaaa-0000-0000-0000-000000000001';
    perform public.verifica('1  BD recusa 1,5 kg/semana', false, 'aceitou');
  exception when check_violation then perform public.verifica('1  BD recusa 1,5 kg/semana', true); end;
end $$;
do $$ begin
  begin insert into public.pesos(utilizador_id,kg) values ('aaaaaaaa-0000-0000-0000-000000000001',12);
    perform public.verifica('2  BD recusa peso absurdo', false, 'aceitou');
  exception when check_violation then perform public.verifica('2  BD recusa peso absurdo', true); end;
end $$;
do $$ begin
  begin insert into public.pesos(utilizador_id,kg,medido_em) values ('aaaaaaaa-0000-0000-0000-000000000001',70,current_date);
    perform public.verifica('3  BD recusa dois pesos no mesmo dia', false, 'aceitou');
  exception when unique_violation then perform public.verifica('3  BD recusa dois pesos no mesmo dia', true); end;
end $$;

-- ------------------------------------------------------------- sem sessão
set role anon; select public.ser_ninguem();
do $$ declare n int; begin
  begin select count(*) into n from public.pesos;
    perform public.verifica('4  anon não lê pesos', n=0, 'leu '||n);
  exception when insufficient_privilege then perform public.verifica('4  anon não lê pesos', true, 'permissão negada'); end;
end $$;
reset role;

-- --------------------------------------------------------- Ana (aprovada)
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
select public.verifica('5  Ana vê só o seu peso', (select count(*) from public.pesos)=1);
select public.verifica('6  Ana não vê o peso do Bruno',
  (select count(*) from public.pesos where utilizador_id='bbbbbbbb-0000-0000-0000-000000000002')=0);
do $$ declare r record; begin
  select * into r from public.estimar_gasto();
  perform public.verifica('7  gasto da Ana calculado', r.gasto_estimado between 1800 and 2600, 'tdee='||coalesce(r.gasto_estimado::text,'nulo'));
  perform public.verifica('8  intervalo visível e coerente',
    r.gasto_minimo < r.gasto_estimado and r.gasto_estimado < r.gasto_maximo,
    r.gasto_minimo||'..'||r.gasto_maximo);
  perform public.verifica('9  objetivo da Ana acima do piso', r.kcal_objetivo >= r.kcal_minimo_seguro,
    'alvo='||r.kcal_objetivo||' piso='||r.kcal_minimo_seguro);
end $$;
do $$ begin
  begin insert into public.pesos(utilizador_id,kg,medido_em) values
    ('bbbbbbbb-0000-0000-0000-000000000002',99,current_date-1);
    perform public.verifica('10 Ana não regista peso do Bruno', false, 'conseguiu');
  exception when insufficient_privilege or check_violation then
    perform public.verifica('10 Ana não regista peso do Bruno', true, 'recusado');
  end;
end $$;
do $$ declare r record; begin
  select * into r from public.estimar_gasto('bbbbbbbb-0000-0000-0000-000000000002');
  perform public.verifica('11 Ana não estima o gasto do Bruno', r.gasto_estimado is null, 'devolveu '||coalesce(r.gasto_estimado::text,'nada'));
exception when no_data_found then perform public.verifica('11 Ana não estima o gasto do Bruno', true, 'sem linhas');
end $$;
do $$ begin
  begin update public.profiles set aprovado=true where id='cccccccc-0000-0000-0000-000000000003';
    perform public.verifica('12 Ana não aprova terceiros', false, 'conseguiu');
  exception when insufficient_privilege then perform public.verifica('12 Ana não aprova terceiros', true); end;
end $$;
reset role;

-- ------------------------------------------------ estranho (não aprovado)
set role authenticated; select public.ser('cccccccc-0000-0000-0000-000000000003');
select public.verifica('13 estranho não lê pesos nenhuns', (select count(*) from public.pesos)=0);
do $$ declare n int; begin
  insert into public.pesos(utilizador_id,kg) values ('cccccccc-0000-0000-0000-000000000003',70);
  get diagnostics n = row_count;
  perform public.verifica('14 estranho não regista peso', false, 'inseriu '||n);
exception when insufficient_privilege or check_violation then
  perform public.verifica('14 estranho não regista peso', true, 'recusado');
end $$;
reset role;

-- ------------------------------------------ limite de 25% (Bruno, 0,75kg)
set role authenticated; select public.ser('bbbbbbbb-0000-0000-0000-000000000002');
do $$ declare r record; begin
  select * into r from public.estimar_gasto();
  perform public.verifica('15 défice do Bruno foi travado nos 25%',
    r.objetivo_ajustado is true and r.motivo is not null, coalesce(r.motivo,'sem motivo'));
  perform public.verifica('16 objetivo do Bruno nunca abaixo do piso',
    r.kcal_objetivo >= 1500, 'alvo='||r.kcal_objetivo);
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
