-- Bateria de segurança do lado da base de dados.
-- Corre contra o Postgres de teste, não contra o Supabase.
\set ON_ERROR_STOP off
drop table if exists public.resultado;
create table public.resultado(ordem serial, nome text, passou boolean, obs text);

-- security definer para os papéis de teste poderem registar resultados
create or replace function public.verifica(p_nome text, p_cond boolean, p_obs text default '')
returns void language plpgsql security definer set search_path='' as $$
begin insert into public.resultado(nome,passou,obs) values(p_nome,coalesce(p_cond,false),p_obs); end $$;
grant execute on function public.verifica(text,boolean,text) to anon, authenticated;
grant execute on function public.ser(uuid), public.ser_ninguem() to anon, authenticated;

-- ---------------------------------------------------------------- preparação
delete from auth.users;
delete from public.autorizados;
insert into public.autorizados(email,nota) values ('convidado@exemplo.com','amigo');

-- alguém da lista entra pela primeira vez
insert into auth.users(id,email,raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111','convidado@exemplo.com','{"full_name":"Convidado"}');
-- um estranho entra pela primeira vez
insert into auth.users(id,email,raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222222222','estranho@exemplo.com','{"full_name":"Estranho"}');

-- --------------------------------------------------------------- 1. o gatilho
select public.verifica('1  gatilho cria perfil ao convidado',
  exists(select 1 from public.profiles where id='11111111-1111-1111-1111-111111111111'));
select public.verifica('2  gatilho cria perfil ao estranho',
  exists(select 1 from public.profiles where id='22222222-2222-2222-2222-222222222222'));
select public.verifica('3  convidado nasce aprovado',
  (select aprovado from public.profiles where id='11111111-1111-1111-1111-111111111111') is true);
select public.verifica('4  estranho nasce por aprovar',
  (select aprovado from public.profiles where id='22222222-2222-2222-2222-222222222222') is false);

-- ------------------------------------------------------------- 2. sem sessão
set role anon;
select public.ser_ninguem();
do $$ declare n int; begin
  begin select count(*) into n from public.profiles;
    perform public.verifica('5  anon não lê profiles', n=0, 'leu '||n||' linhas');
  exception when insufficient_privilege then
    perform public.verifica('5  anon não lê profiles', true, 'permissão negada');
  end;
end $$;
do $$ declare n int; begin
  begin select count(*) into n from public.autorizados;
    perform public.verifica('6  anon não lê a lista', n=0, 'leu '||n||' linhas');
  exception when insufficient_privilege then
    perform public.verifica('6  anon não lê a lista', true, 'permissão negada');
  end;
end $$;
reset role;

-- ---------------------------------------------------- 3. como o estranho
set role authenticated;
select public.ser('22222222-2222-2222-2222-222222222222');
select public.verifica('7  estranho só vê a própria linha',
  (select count(*) from public.profiles)=1);
select public.verifica('8  esta_aprovado() diz não ao estranho',
  public.esta_aprovado() is false);
do $$ declare n int; begin
  begin select count(*) into n from public.autorizados;
    perform public.verifica('9  estranho não lê a lista', n=0, 'leu '||n||' linhas');
  exception when insufficient_privilege then
    perform public.verifica('9  estranho não lê a lista', true, 'permissão negada');
  end;
end $$;
do $$ begin
  begin update public.profiles set aprovado=true where id='22222222-2222-2222-2222-222222222222';
    perform public.verifica('10 estranho não se aprova a si', false, 'conseguiu escrever');
  exception when insufficient_privilege then
    perform public.verifica('10 estranho não se aprova a si', true, 'permissão negada');
  end;
end $$;
do $$ begin
  begin update public.profiles set admin=true where id='22222222-2222-2222-2222-222222222222';
    perform public.verifica('11 estranho não se faz admin', false, 'conseguiu escrever');
  exception when insufficient_privilege then
    perform public.verifica('11 estranho não se faz admin', true, 'permissão negada');
  end;
end $$;
do $$ begin
  begin insert into public.autorizados(email) values ('estranho2@exemplo.com');
    perform public.verifica('12 estranho não se põe na lista', false, 'conseguiu inserir');
  exception when insufficient_privilege then
    perform public.verifica('12 estranho não se põe na lista', true, 'permissão negada');
  end;
end $$;
reset role;

-- ---------------------------------------------------- 4. como o convidado
set role authenticated;
select public.ser('11111111-1111-1111-1111-111111111111');
select public.verifica('13 esta_aprovado() diz sim ao convidado',
  public.esta_aprovado() is true);
select public.verifica('14 convidado não vê a linha do estranho',
  (select count(*) from public.profiles where id='22222222-2222-2222-2222-222222222222')=0);
do $$ begin
  begin update public.profiles set nome='Novo Nome' where id='11111111-1111-1111-1111-111111111111';
    perform public.verifica('15 convidado muda o próprio nome', true);
  exception when others then
    perform public.verifica('15 convidado muda o próprio nome', false, sqlerrm);
  end;
end $$;
do $$ declare n int; begin
  update public.profiles set nome='Invadido' where id='22222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  perform public.verifica('16 convidado não altera o estranho', n=0, n||' linhas afectadas');
end $$;
reset role;

select nome, case when passou then 'PASSA' else '>>> FALHA' end as estado, obs
from resultado order by ordem;
select count(*) filter (where not passou) as falhas, count(*) as total from resultado;
