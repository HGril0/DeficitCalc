-- Bateria do cliente: os comandos EXATOS que o Supabase (PostgREST) gera a
-- partir de cada botão da app. Existe porque um "upsert" do perfil.html
-- falhava sempre em produção e nenhuma outra bateria o reproduzia: elas
-- testavam "insert" simples, e o ecrã usa "insert ... on conflict do update
-- set <todas as colunas enviadas>".
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
revoke all on function public.verifica(text,boolean,text) from public;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated;

delete from auth.users; delete from public.autorizados;
insert into public.autorizados(email) values ('ana@exemplo.com'),('bruno@exemplo.com');
insert into auth.users(id,email,raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','ana@exemplo.com','{"full_name":"Ana"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','bruno@exemplo.com','{"full_name":"Bruno"}');
insert into public.pesos(utilizador_id,kg,medido_em) values ('bbbbbbbb-0000-0000-0000-000000000002',90,current_date);

set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');

-- perfil.html → guardar(): update das 5 colunas do formulário
do $$ begin
  update public.profiles set sexo='f', data_nascimento='1995-04-10', altura_cm=165,
         nivel_atividade='moderado', objetivo_kg_semana=0.5
   where id='aaaaaaaa-0000-0000-0000-000000000001';
  perform public.verifica('1  perfil.html grava o formulário', found, '');
exception when others then perform public.verifica('1  perfil.html grava o formulário', false, sqlerrm); end $$;

-- perfil.html → guardar(): upsert do peso, como o PostgREST o monta
do $$ begin
  insert into public.pesos(kg,medido_em) values (68.4,current_date)
  on conflict (utilizador_id,medido_em) do update set kg=excluded.kg, medido_em=excluded.medido_em;
  perform public.verifica('2  perfil.html grava o peso (1.ª vez)', true);
exception when others then perform public.verifica('2  perfil.html grava o peso (1.ª vez)', false, sqlerrm); end $$;

do $$ declare k numeric; begin
  insert into public.pesos(kg,medido_em) values (68.1,current_date)
  on conflict (utilizador_id,medido_em) do update set kg=excluded.kg, medido_em=excluded.medido_em;
  select kg into k from public.pesos where utilizador_id='aaaaaaaa-0000-0000-0000-000000000001' and medido_em=current_date;
  perform public.verifica('3  perfil.html corrige o peso no mesmo dia', k = 68.1, 'ficou '||k);
exception when others then perform public.verifica('3  perfil.html corrige o peso no mesmo dia', false, sqlerrm); end $$;

do $$ declare n int; begin
  select count(*) into n from public.pesos where medido_em=current_date;
  perform public.verifica('4  o peso ficou na conta certa (só vejo o meu)', n = 1, 'vi '||n);
end $$;

-- A forma antiga, que mandava utilizador_id: continua recusada, de propósito.
do $$ begin
  insert into public.pesos(utilizador_id,kg,medido_em) values ('aaaaaaaa-0000-0000-0000-000000000001',68,current_date)
  on conflict (utilizador_id,medido_em) do update set utilizador_id=excluded.utilizador_id, kg=excluded.kg;
  perform public.verifica('5  upsert que tenta mexer no dono continua recusado', false, 'passou');
exception when insufficient_privilege then
  perform public.verifica('5  upsert que tenta mexer no dono continua recusado', true, 'sem permissão na coluna'); end $$;

-- Ataque: upsert com o id do Bruno, a tentar escrever por cima do peso dele.
do $$ declare k numeric; begin
  begin
    insert into public.pesos(utilizador_id,kg,medido_em) values ('bbbbbbbb-0000-0000-0000-000000000002',1,current_date)
    on conflict (utilizador_id,medido_em) do update set kg=excluded.kg;
  exception when insufficient_privilege then null; end;
  reset role;
  select kg into k from public.pesos where utilizador_id='bbbbbbbb-0000-0000-0000-000000000002';
  perform public.verifica('6  upsert não escreve por cima do peso de outro', k = 90, 'peso do Bruno: '||k);
end $$;

set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
-- hoje.html → registar(): insert com utilizador_id explícito
do $$ begin
  insert into public.registos(utilizador_id,data,refeicao,descricao,kcal,fonte)
  values ('aaaaaaaa-0000-0000-0000-000000000001',current_date,'almoco','Massa',600,'manual');
  perform public.verifica('7  hoje.html regista um alimento', true);
exception when others then perform public.verifica('7  hoje.html regista um alimento', false, sqlerrm); end $$;

-- hoje.html → naoComi()
do $$ begin
  insert into public.registos(utilizador_id,data,refeicao,kcal,nao_comi)
  values ('aaaaaaaa-0000-0000-0000-000000000001',current_date,'jantar',0,true);
  perform public.verifica('8  hoje.html marca "não comi"', true);
exception when others then perform public.verifica('8  hoje.html marca "não comi"', false, sqlerrm); end $$;

-- hoje.html → apagar()
do $$ begin
  delete from public.registos where refeicao='jantar' and utilizador_id='aaaaaaaa-0000-0000-0000-000000000001';
  perform public.verifica('9  hoje.html apaga um registo', found);
exception when others then perform public.verifica('9  hoje.html apaga um registo', false, sqlerrm); end $$;

-- Alimento pessoal sem utilizador_id: fica com o dono certo.
do $$ declare d uuid; begin
  insert into public.alimentos_meus(nome,kcal_100) values ('Sandes do café',250) returning utilizador_id into d;
  perform public.verifica('10 alimento pessoal sem dono explícito fica meu', d='aaaaaaaa-0000-0000-0000-000000000001', 'dono '||d);
exception when others then perform public.verifica('10 alimento pessoal sem dono explícito fica meu', false, sqlerrm); end $$;

-- E o gasto calcula-se com o que o ecrã gravou.
do $$ declare g int; begin
  select gasto_estimado into g from public.estimar_gasto();
  perform public.verifica('11 gasto estimado sai depois de gravar o perfil', g between 1800 and 2500, 'deu '||coalesce(g::text,'nada'));
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
