-- Bateria de ataques: tentativas reais de entrar sem ser convidado ou de
-- subir de privilégios. Cada teste descreve o ataque e espera que falhe.
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
revoke all on function public.verifica(text,boolean,text) from public;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated;

delete from auth.users;
delete from public.autorizados;
insert into public.autorizados(email) values ('namorada@exemplo.com'),('amigo@exemplo.com');

-- A pessoa verdadeira, que entra pelo Google.
insert into auth.users(id,email,raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001','amigo@exemplo.com','{"full_name":"Amigo"}');

-- ATAQUE A: alguém sabe o email da namorada (está na lista) e inscreve-se com
-- email e palavra-passe, sem acesso à caixa de correio dela. O email fica por
-- confirmar.
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
  ('eeeeeeee-0000-0000-0000-000000000001','namorada@exemplo.com',
   '{"full_name":"Impostor","_fornecedor":"email"}', null);

-- ATAQUE B: o mesmo, mas num projeto em que alguém desligou a confirmação de
-- email. O Supabase dá o email como confirmado logo na inscrição.
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
  ('eeeeeeee-0000-0000-0000-000000000002','NAMORADA@exemplo.com.pt',
   '{"full_name":"Impostor 2","_fornecedor":"email"}', now());
-- (email diferente para não chocar com a unicidade; o caso que interessa é o
--  da linha seguinte, com o email exacto da lista)
delete from auth.users where id='eeeeeeee-0000-0000-0000-000000000002';
delete from auth.users where id='eeeeeeee-0000-0000-0000-000000000001';
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values
  ('eeeeeeee-0000-0000-0000-000000000002','namorada@exemplo.com',
   '{"full_name":"Impostor 2","_fornecedor":"email"}', now());

-- ATAQUE C: login anónimo (se alguém o ligar no painel).
insert into auth.users(id,email,raw_user_meta_data,is_anonymous,email_confirmed_at) values
  ('eeeeeeee-0000-0000-0000-000000000003',null,'{"_fornecedor":"anonymous"}',true,null);

-- ============================================== o porteiro não se deixa enganar
set role authenticated; select public.ser('eeeeeeee-0000-0000-0000-000000000002');
select public.verifica('A1 inscrição por email com email da lista NÃO fica aprovada',
  public.esta_aprovado() = false, 'esta_aprovado='||public.esta_aprovado()::text);
select public.verifica('A2 e não lê o catálogo',
  (select count(*) from public.alimentos) = 0);
do $$ begin
  begin insert into public.registos(utilizador_id,refeicao,kcal)
         values ('eeeeeeee-0000-0000-0000-000000000002','almoco',100);
    perform public.verifica('A3 e não regista refeições', false, 'CONSEGUIU');
  exception when insufficient_privilege then
    perform public.verifica('A3 e não regista refeições', true, 'recusado'); end;
end $$;
reset role;

-- O mesmo atacante, agora com email por confirmar (o caso de hoje no Supabase).
update auth.users set email_confirmed_at = null where id='eeeeeeee-0000-0000-0000-000000000002';
set role authenticated; select public.ser('eeeeeeee-0000-0000-0000-000000000002');
select public.verifica('B1 email por confirmar também não fica aprovado',
  public.esta_aprovado() = false, 'esta_aprovado='||public.esta_aprovado()::text);
reset role;

set role authenticated; select public.ser('eeeeeeee-0000-0000-0000-000000000003');
select public.verifica('C1 login anónimo não fica aprovado', public.esta_aprovado() = false);
reset role;

-- Controlo: quem entra pelo Google com email da lista continua a entrar.
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
select public.verifica('D1 convidado pelo Google continua aprovado', public.esta_aprovado() = true);
reset role;

-- ==================================== subir de privilégios pela tabela profiles
-- ATAQUE E: o administrador apaga o perfil de alguém para lhe tirar o acesso.
-- A pessoa continua com conta e tenta recriar o perfil como aprovada e admin.
delete from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000001';
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  begin insert into public.profiles(id,email,aprovado,admin)
         values ('aaaaaaaa-0000-0000-0000-000000000001','amigo@exemplo.com',true,true);
    perform public.verifica('E1 perfil apagado NÃO se recria como admin', false, 'CONSEGUIU: aprovado e admin');
  exception when insufficient_privilege then
    perform public.verifica('E1 perfil apagado NÃO se recria como admin', true, 'sem permissão'); end;
end $$;
do $$ begin
  begin insert into public.profiles(id,email)
         values ('aaaaaaaa-0000-0000-0000-000000000001','amigo@exemplo.com');
    perform public.verifica('E2 nem sequer se recria sem privilégios', false, 'conseguiu recriar');
  exception when insufficient_privilege then
    perform public.verifica('E2 nem sequer se recria sem privilégios', true, 'sem permissão'); end;
end $$;
reset role;

-- ATAQUE F: com o perfil existente, tentar o "upsert" que o PostgREST faz com
-- Prefer: resolution=merge-duplicates.
-- Repor o perfil como o trigger o deixaria, com admin desligado: o teste não
-- pode herdar o resultado do E1 (foi assim que o F1 deu um falso alarme).
insert into public.profiles(id,email,aprovado,admin) values
  ('aaaaaaaa-0000-0000-0000-000000000001','amigo@exemplo.com',true,false)
  on conflict (id) do update set aprovado=true, admin=false;
set role authenticated; select public.ser('aaaaaaaa-0000-0000-0000-000000000001');
do $$ declare a boolean; begin
  begin insert into public.profiles(id,email,admin)
         values ('aaaaaaaa-0000-0000-0000-000000000001','amigo@exemplo.com',true)
         on conflict (id) do update set admin = excluded.admin;
  exception when insufficient_privilege then null; end;
  select admin into a from public.profiles where id='aaaaaaaa-0000-0000-0000-000000000001';
  perform public.verifica('F1 upsert não promove a admin', a is not true, 'admin='||coalesce(a::text,'nulo'));
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from public.resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from public.resultado;
