-- DeficitCalc — porteiro: separar "entrou com o Google" de "tem conta na app".
-- Correr DEPOIS do 01-profiles.sql. Pode ser corrido mais do que uma vez.
--
-- ATENÇÃO: este repositório é público. Não escrevas aqui os emails verdadeiros
-- nem faças commit deles. Substitui os marcadores na janela do SQL Editor do
-- Supabase, corre, e deixa o ficheiro como está.

-- ---------------------------------------------------------------------------
-- 1. Lista de quem pode entrar.
--    Sem permissões para ninguém: nem anon nem authenticated lhe tocam.
--    É lida só pelo trigger, que corre com security definer.
-- ---------------------------------------------------------------------------
create table if not exists public.autorizados (
  email     text primary key,
  nota      text,
  criado_em timestamptz not null default now()
);

alter table public.autorizados enable row level security;
-- Mesmo motivo do profiles, e um pior: com force, nem o gatilho conseguiria
-- LER esta lista, e toda a gente nasceria por aprovar sem erro nenhum à vista.
alter table public.autorizados no force row level security;
-- O que protege esta tabela não é a RLS, é não existir permissão nenhuma
-- nem política nenhuma para anon e authenticated. Pela API é invisível.
revoke all on public.autorizados from anon, authenticated;

comment on table public.autorizados is
  'Emails com acesso. Editada só pelo painel. Sem políticas: ninguém a lê pela API.';

-- Limpa marcadores de exemplo que tenham entrado numa execução anterior,
-- para o ficheiro poder ser corrido vezes sem conta sem deixar lixo.
delete from public.autorizados where email like '%@exemplo.com';

-- Troca os marcadores pelos emails reais ANTES de correr, na janela do Supabase.
-- Acrescenta ou tira linhas conforme precisares.
insert into public.autorizados (email, nota) values
  ('EMAIL_1@exemplo.com', 'eu'),
  ('EMAIL_2@exemplo.com', ''),
  ('EMAIL_3@exemplo.com', ''),
  ('EMAIL_4@exemplo.com', ''),
  ('EMAIL_5@exemplo.com', ''),
  ('EMAIL_6@exemplo.com', ''),
  ('EMAIL_7@exemplo.com', ''),
  ('EMAIL_8@exemplo.com', '')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. O interruptor, um por pessoa.
--    Não é preciso protegê-lo: como o UPDATE é dado coluna a coluna
--    (ver 01-profiles.sql), uma coluna nova nasce impossível de escrever
--    pelo utilizador.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists aprovado boolean not null default false;

comment on column public.profiles.aprovado is
  'Decisão do administrador. Nasce falso. Só liga sozinho se o email estiver em autorizados.';

-- ---------------------------------------------------------------------------
-- 3. No primeiro login, aprova sozinho quem está na lista.
-- ---------------------------------------------------------------------------
create or replace function public.criar_perfil_novo_utilizador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, nome, avatar_url, aprovado)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    exists (select 1 from public.autorizados a where lower(a.email) = lower(new.email))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Quem já tinha entrado antes disto existir.
-- ---------------------------------------------------------------------------
update public.profiles p
   set aprovado = true
  from public.autorizados a
 where lower(a.email) = lower(p.email)
   and p.aprovado is distinct from true;

-- Administrador do painel de custos. Troca pelo teu email na janela do Supabase.
update public.profiles
   set admin = true
 where lower(email) = lower('EMAIL_1@exemplo.com')
   and admin is distinct from true;

-- ---------------------------------------------------------------------------
-- 5. A condição que as tabelas seguintes vão usar, ao lado de "esta linha é tua":
--      using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() )
-- ---------------------------------------------------------------------------
create or replace function public.esta_aprovado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.aprovado from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

grant execute on function public.esta_aprovado() to authenticated;
