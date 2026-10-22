-- DeficitCalc — passo 1 da base de dados: tabela de perfis com RLS.
-- Correr no Supabase → SQL Editor. Pode ser corrido mais do que uma vez sem estragar nada.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  nome          text,
  avatar_url    text,
  fuso          text        not null default 'Europe/Lisbon',
  admin         boolean     not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table  public.profiles is 'Um perfil por utilizador. Cada pessoa só vê e edita o seu.';
comment on column public.profiles.admin is 'Só para o painel de custos. O próprio utilizador NÃO pode alterar esta coluna.';

-- ---------------------------------------------------------------------------
-- 2. RLS — ligada antes de existir qualquer dado
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- NÃO usar "force row level security" aqui. Testado num Postgres a sério:
-- com force ligado, o gatilho que cria o perfil ao primeiro login passa a
-- estar sujeito às políticas. Como nessa altura ainda não há sessão,
-- auth.uid() é nulo, o insert é recusado, e por o gatilho estar pendurado no
-- auth.users isso aborta o registo inteiro — a pessoa não consegue sequer
-- entrar. O force também não protege nada que interesse: a API liga-se
-- sempre como anon ou authenticated, nunca como dono da tabela.
alter table public.profiles no force row level security;

drop policy if exists "ler o proprio perfil"      on public.profiles;
drop policy if exists "criar o proprio perfil"    on public.profiles;
drop policy if exists "alterar o proprio perfil"  on public.profiles;

create policy "ler o proprio perfil"
  on public.profiles for select
  to authenticated
  using ( (select auth.uid()) = id );

create policy "criar o proprio perfil"
  on public.profiles for insert
  to authenticated
  with check ( (select auth.uid()) = id );

create policy "alterar o proprio perfil"
  on public.profiles for update
  to authenticated
  using      ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- Sem política de DELETE: ninguém apaga perfis pela app.
-- Sem política para anon: quem não tem sessão não lê nada.

-- ---------------------------------------------------------------------------
-- 3. Privilégios
-- ---------------------------------------------------------------------------
revoke all on public.profiles from anon, authenticated;
grant select, insert on public.profiles to authenticated;

-- A RLS trabalha ao nível da LINHA, por isso sozinha deixaria o utilizador
-- alterar qualquer COLUNA da sua própria linha, incluindo admin = true.
--
-- Não serve dar UPDATE à tabela e depois tentar retirar colunas: no PostgreSQL
-- uma permissão dada à tabela cobre todas as colunas, e um revoke ao nível da
-- coluna só retira permissões dadas ao nível da coluna. O revoke não dá erro,
-- simplesmente não faz nada. Testado: a escalada de privilégio passava.
--
-- A forma correta é nunca dar a tabela e listar só as colunas editáveis.
grant update (nome, avatar_url, fuso) on public.profiles to authenticated;

-- Fora da lista, e portanto só do servidor:
--   admin         -> senão qualquer pessoa se promovia ao painel de custos
--   email         -> vem do Google; mais à frente serve para a partilha
--   id, criado_em -> identidade e história da linha
--   atualizado_em -> mantido pelo trigger

-- ---------------------------------------------------------------------------
-- 4. Perfil criado automaticamente quando alguém entra pela primeira vez
--    search_path vazio e nomes qualificados: sem isto, a função com
--    security definer fica exposta a sequestro do search_path.
-- ---------------------------------------------------------------------------
create or replace function public.criar_perfil_novo_utilizador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, nome, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_utilizador on auth.users;
create trigger ao_criar_utilizador
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_utilizador();

-- ---------------------------------------------------------------------------
-- 5. atualizado_em mantido pelo servidor, não pelo cliente
-- ---------------------------------------------------------------------------
create or replace function public.marcar_atualizacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  new.criado_em := old.criado_em;
  return new;
end;
$$;

drop trigger if exists ao_alterar_perfil on public.profiles;
create trigger ao_alterar_perfil
  before update on public.profiles
  for each row execute function public.marcar_atualizacao();

-- ---------------------------------------------------------------------------
-- 6. Perfis para quem já entrou antes de isto existir
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, nome, avatar_url)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
from auth.users u
on conflict (id) do nothing;

-- As funções de trigger correm dentro do trigger. Ninguém as chama de fora,
-- por isso ninguém precisa de permissão para as executar.
revoke all on function public.criar_perfil_novo_utilizador() from public, anon, authenticated;
revoke all on function public.marcar_atualizacao() from public, anon, authenticated;
