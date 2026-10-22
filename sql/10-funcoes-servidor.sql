-- Restam — passo 7, parte do servidor. Correr DEPOIS do 01 a 09.
-- Pode ser corrido mais do que uma vez.
--
-- Duas funções que SÓ a função Edge (com a chave de serviço) pode chamar.
-- Nenhum utilizador, com ou sem sessão, tem permissão para as executar.

-- ---------------------------------------------------------------------------
-- 1. Registo de uso das funções do servidor.
--    Serve para limitar abusos hoje e, no passo 10, para o teto de 20 €.
--    Não guarda o que foi pesquisado: só quem, que função e quando.
-- ---------------------------------------------------------------------------
create table if not exists public.uso_funcoes (
  id            bigint generated always as identity primary key,
  utilizador_id uuid not null references auth.users (id) on delete cascade,
  funcao        text not null,
  em            timestamptz not null default now()
);

create index if not exists uso_funcoes_recente
  on public.uso_funcoes (utilizador_id, funcao, em desc);

alter table public.uso_funcoes enable row level security;
alter table public.uso_funcoes no force row level security;
revoke all on public.uso_funcoes from anon, authenticated;
-- Sem políticas e sem permissões: ninguém lê nem escreve, só o servidor.

-- Regista uma utilização e diz se ainda está dentro do limite.
-- Limites: 30 por minuto e 500 por dia, por pessoa e por função.
-- Pesquisar com o teclado dispara pedidos seguidos; 30/min chega com folga.
create or replace function public.registar_uso(p_utilizador uuid, p_funcao text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_min int;
  v_dia int;
begin
  if p_utilizador is null or p_funcao is null or length(p_funcao) > 40 then
    return false;
  end if;

  select count(*) filter (where u.em > now() - interval '1 minute'),
         count(*)
    into v_min, v_dia
    from public.uso_funcoes u
   where u.utilizador_id = p_utilizador
     and u.funcao = p_funcao
     and u.em > now() - interval '1 day';

  if v_min >= 30 or v_dia >= 500 then
    return false;
  end if;

  insert into public.uso_funcoes (utilizador_id, funcao) values (p_utilizador, p_funcao);

  -- Arrumação: o que tem mais de 40 dias já não conta para nada.
  delete from public.uso_funcoes where em < now() - interval '40 days';
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Guardar no catálogo um produto lido por código de barras.
--    A função Edge já validou os valores; as restrições da tabela voltam a
--    validá-los aqui. Se o código já existir, atualiza (o Open Food Facts é
--    corrigido com o tempo).
-- ---------------------------------------------------------------------------
create or replace function public.guardar_alimento_off(
  p_codigo text, p_nome text, p_marca text, p_kcal numeric,
  p_proteina numeric, p_hidratos numeric, p_gordura numeric,
  p_gramas_unidade numeric, p_nome_unidade text
)
returns setof public.alimentos
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.alimentos (nome, marca, kcal_100, proteina_100, hidratos_100,
                                gordura_100, fonte, codigo_barras, gramas_unidade, nome_unidade)
  values (btrim(p_nome), nullif(btrim(p_marca), ''), p_kcal, p_proteina, p_hidratos,
          p_gordura, 'codigo_barras', btrim(p_codigo), p_gramas_unidade, p_nome_unidade)
  on conflict (codigo_barras) where codigo_barras is not null
  do update set nome = excluded.nome, marca = excluded.marca, kcal_100 = excluded.kcal_100,
                proteina_100 = excluded.proteina_100, hidratos_100 = excluded.hidratos_100,
                gordura_100 = excluded.gordura_100, gramas_unidade = excluded.gramas_unidade,
                nome_unidade = excluded.nome_unidade
  returning *;
$$;

-- Código de barras só com algarismos e com um tamanho real (EAN-8 a EAN-14).
do $$ begin
  if not exists (select 1 from pg_constraint where conname='alimentos_codigo_valido') then
    alter table public.alimentos add constraint alimentos_codigo_valido
      check (codigo_barras is null or codigo_barras ~ '^[0-9]{8,14}$');
  end if;
end $$;

revoke all on function public.registar_uso(uuid, text) from public, anon, authenticated;
revoke all on function public.guardar_alimento_off(text, text, text, numeric, numeric, numeric, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.registar_uso(uuid, text) to service_role;
grant execute on function public.guardar_alimento_off(text, text, text, numeric, numeric, numeric, numeric, numeric, text)
  to service_role;
