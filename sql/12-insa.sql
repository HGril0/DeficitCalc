-- Restam — tabela do INSA no catálogo partilhado.
-- Correr DEPOIS do 01 a 11. Pode ser corrido mais do que uma vez.
-- Os dados vêm a seguir, no 13-insa-dados.sql.
--
-- Fonte: Base de Dados da Composição de Alimentos. Instituto Nacional de Saúde
-- Doutor Ricardo Jorge, I. P.- INSA. v 7.1 - 2026.
-- O INSA autorizou o uso e não se responsabiliza por discrepâncias. A
-- condição de uso é a fonte estar visível onde os dados aparecem — isso está
-- no ecrã (pesquisa.js e perfil.html), não aqui.

-- ---------------------------------------------------------------------------
-- 1. Duas colunas novas no catálogo.
--
--    codigo_insa  o código do alimento na tabela. Serve para a importação ser
--                 repetível (atualiza em vez de duplicar) e para se saber de
--                 onde veio cada linha.
--    por_ml       as bebidas alcoólicas vêm na tabela por 100 ml, não por
--                 100 g. Sem esta marca, "330" numa cerveja seria lido como
--                 gramas — o número dá quase igual, mas o ecrã mostraria a
--                 unidade errada e as doses (copo, imperial) não teriam
--                 sentido.
-- ---------------------------------------------------------------------------
alter table public.alimentos add column if not exists codigo_insa text;
alter table public.alimentos add column if not exists por_ml boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='alimentos_codigo_insa_valido') then
    alter table public.alimentos add constraint alimentos_codigo_insa_valido
      check (codigo_insa is null or (codigo_insa ~ '^[0-9]{1,12}$' and fonte = 'insa'));
  end if;
end $$;

create unique index if not exists alimentos_codigo_insa_unico
  on public.alimentos (codigo_insa)
  where codigo_insa is not null;

comment on column public.alimentos.codigo_insa is
  'Código do alimento na tabela do INSA (BDCA v7.1). Só nas linhas com fonte insa.';
comment on column public.alimentos.por_ml is
  'Valores por 100 ml em vez de 100 g (bebidas alcoólicas do INSA). A quantidade registada fica em ml.';

-- As permissões da tabela não mudam: authenticated só tem SELECT, e o grant é
-- da tabela inteira, por isso as colunas novas ficam legíveis e não
-- escrevíveis sem mais nada. A bateria 09 confirma.

-- ---------------------------------------------------------------------------
-- 2. Pesquisa nova. Com 1376 alimentos do INSA, a de antes deixava de chegar:
--    - "acucar" não encontrava "Açúcar" (quem escreve depressa no telemóvel
--      salta os acentos);
--    - "arroz pato" não encontrava "Arroz de pato" (procurava a frase inteira);
--    - "ovos" não encontrava "Ovo de galinha".
--    Agora: sem acentos, cada palavra tem de aparecer no nome (por qualquer
--    ordem), e um plural simples também conta. Os nomes que COMEÇAM pela
--    pesquisa vêm primeiro.
--
--    position() em vez de like: um "%" ou "_" escrito pela pessoa é só um
--    carácter, não um curinga.
--
--    O tipo devolvido ganha por_ml, e o PostgreSQL não deixa mudar o tipo de
--    retorno com create or replace: é preciso apagar e criar de novo — e com
--    isso as permissões voltam ao padrão, por isso são repostas logo abaixo.
-- ---------------------------------------------------------------------------
drop function if exists public.procurar_alimento(text, int);

create function public.procurar_alimento(p_texto text, p_limite int default 20)
returns table (
  id             uuid,
  nome           text,
  marca          text,
  kcal_100       numeric,
  gramas_unidade numeric,
  nome_unidade   text,
  fonte          text,
  meu            boolean,
  por_ml         boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with procura as (
    select translate(lower(btrim(left(coalesce(p_texto, ''), 60))),
                     'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') as t
  ),
  palavras as (
    select coalesce(array_agg(w), '{}') as ws
      from procura p, regexp_split_to_table(p.t, '\s+') w
     where w <> ''
  ),
  candidatos as (
    select m.id, m.nome, null::text as marca, m.kcal_100,
           m.gramas_unidade, m.nome_unidade, 'meu'::text as fonte,
           true as meu, false as por_ml, 0 as ordem
      from public.alimentos_meus m
     where m.utilizador_id = (select auth.uid())
    union all
    select a.id, a.nome, a.marca, a.kcal_100,
           a.gramas_unidade, a.nome_unidade, a.fonte,
           false, a.por_ml,
           case a.fonte when 'insa' then 1 when 'codigo_barras' then 2 else 3 end
      from public.alimentos a
  ),
  normalizados as (
    select c.*, translate(lower(c.nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ',
                          'aaaaaeeeeiiiiooooouuuucn') as n
      from candidatos c
  )
  select r.id, r.nome, r.marca, r.kcal_100, r.gramas_unidade,
         r.nome_unidade, r.fonte, r.meu, r.por_ml
    from normalizados r, procura p, palavras pw
   where public.esta_aprovado()
     and length(p.t) >= 2
     and cardinality(pw.ws) between 1 and 8
     -- nenhuma palavra pode faltar no nome
     and not exists (
       select 1 from unnest(pw.ws) w
        where position(w in r.n) = 0
          -- plural simples: "ovos" → "ovo", "limoes" → "limao", "paes" → "pao"
          and not (length(w) >= 4 and w like '%s'
                   and position(regexp_replace(regexp_replace(w, '(oe|ae)s$', 'aos'), 's$', '') in r.n) > 0))
   order by r.ordem = 0 desc,
            left(r.n, length(p.t)) = p.t desc,
            r.ordem, length(r.nome), r.nome
   limit least(greatest(coalesce(p_limite, 20), 1), 50);
$$;

revoke all on function public.procurar_alimento(text, int) from public, anon, authenticated;
grant execute on function public.procurar_alimento(text, int) to authenticated;
