-- Imita as partes do Supabase de que o nosso SQL depende, para podermos
-- testar as políticas localmente antes de as pôr na base de dados a sério.
drop schema if exists auth cascade;
create schema auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='dono_sem_bypass') then create role dono_sem_bypass nologin nobypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O Supabase a sério concede TUDO a anon, authenticated e service_role em
-- cada tabela e função nova do schema public. Sem isto aqui, os testes de
-- "o anónimo não lê" passavam porque a permissão nunca tinha sido dada no
-- ambiente de teste — e não porque o revoke do ficheiro SQL a tirou.
-- Era um teste a mentir: no Supabase real a permissão existe de origem e só
-- desaparece se o revoke estiver escrito. Com estas linhas, o ambiente passa
-- a ser tão permissivo como o verdadeiro e os testes têm de provar o revoke.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz default now(),
  is_anonymous       boolean not null default false,
  created_at         timestamptz default now()
);

-- Por onde a pessoa entrou. No Supabase cada login (Google, email, ...) é uma
-- linha aqui. O porteiro passa a exigir uma identidade Google, por isso o
-- ambiente de teste tem de as ter.
create table auth.identities (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  provider      text not null,
  provider_id   text not null,
  identity_data jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

-- Para não ter de mexer em todas as baterias: um utilizador inserido nos
-- testes ganha uma identidade Google, como acontece no login real, a não ser
-- que o teste peça outra com raw_user_meta_data->>'_fornecedor'
-- ('email', 'anonymous' ou 'nenhum' para não criar identidade).
create or replace function auth._identidade_de_teste() returns trigger
language plpgsql as $f$
declare v text := coalesce(new.raw_user_meta_data->>'_fornecedor', 'google');
begin
  if v <> 'nenhum' then
    insert into auth.identities(user_id, provider, provider_id)
    values (new.id, v, new.id::text);
  end if;
  return new;
end $f$;
create trigger _identidade_de_teste after insert on auth.users
  for each row execute function auth._identidade_de_teste();

-- Como no Supabase: lê o "sub" das claims do pedido.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

-- Ajuda dos testes: passar a ser uma pessoa.
create or replace function public.ser(p_id uuid) returns void
language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id)::text, false);
$$;
create or replace function public.ser_ninguem() returns void
language sql as $$
  select set_config('request.jwt.claims', '', false);
$$;
