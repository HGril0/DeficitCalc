-- Restam — passo 7: base de alimentos.
-- Correr DEPOIS do 01, 02, 03 e 04. Pode ser corrido mais do que uma vez.
--
-- Há duas tabelas, e a diferença entre elas é de segurança, não de arrumação:
--
--   alimentos       catálogo partilhado pelos 8. Vem do Open Food Facts, da
--                   tabela do INSA e (mais tarde) da IA. Todos LEEM, ninguém
--                   ESCREVE: só o servidor escreve aqui, pela função Edge.
--                   Se qualquer pessoa pudesse escrever no catálogo, um valor
--                   errado — por descuido ou de propósito — passava a afetar
--                   as contas das outras 7.
--
--   alimentos_meus  alimentos criados por cada pessoa ("a sandes do café da
--                   esquina"). Privados, cada um só vê os seus.

-- ---------------------------------------------------------------------------
-- 1. Catálogo partilhado.
--    Sem restrição de nome único: duas fontes podem ter o mesmo alimento com
--    valores diferentes, e a decisão foi mostrar o conflito à pessoa em vez de
--    escolher um em silêncio. Por isso as duas linhas coexistem.
-- ---------------------------------------------------------------------------
create table if not exists public.alimentos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  marca          text,
  kcal_100       numeric(6,1) not null,
  proteina_100   numeric(5,1),
  hidratos_100   numeric(5,1),
  gordura_100    numeric(5,1),
  fonte          text not null,
  codigo_barras  text,
  -- Peso de uma unidade, quando a unidade faz mais sentido do que os gramas:
  -- um ovo, uma fatia de pão, uma banana. Nulo quando não se aplica.
  gramas_unidade numeric(6,1),
  nome_unidade   text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='alimentos_fonte_valida') then
    alter table public.alimentos add constraint alimentos_fonte_valida
      check (fonte in ('codigo_barras','insa','ia'));
  end if;

  -- 900 kcal/100 g é o óleo puro. Acima disso não existe comida.
  if not exists (select 1 from pg_constraint where conname='alimentos_kcal_plausivel') then
    alter table public.alimentos add constraint alimentos_kcal_plausivel
      check (kcal_100 >= 0 and kcal_100 <= 900);
  end if;

  -- Os macronutrientes de 100 g não podem somar mais de 100 g.
  if not exists (select 1 from pg_constraint where conname='alimentos_macros_plausiveis') then
    alter table public.alimentos add constraint alimentos_macros_plausiveis
      check (coalesce(proteina_100,0) + coalesce(hidratos_100,0)
             + coalesce(gordura_100,0) <= 100);
  end if;

  if not exists (select 1 from pg_constraint where conname='alimentos_nome_nao_vazio') then
    alter table public.alimentos add constraint alimentos_nome_nao_vazio
      check (length(btrim(nome)) between 1 and 200);
  end if;

  -- Se tem unidade, tem de ter peso e nome da unidade; ou nenhum dos dois.
  if not exists (select 1 from pg_constraint where conname='alimentos_unidade_coerente') then
    alter table public.alimentos add constraint alimentos_unidade_coerente
      check ((gramas_unidade is null) = (nome_unidade is null));
  end if;

  if not exists (select 1 from pg_constraint where conname='alimentos_unidade_plausivel') then
    alter table public.alimentos add constraint alimentos_unidade_plausivel
      check (gramas_unidade is null or (gramas_unidade > 0 and gramas_unidade <= 5000));
  end if;
end $$;

-- Um código de barras é um produto. Duas linhas com o mesmo código seriam
-- duas respostas para a mesma leitura.
create unique index if not exists alimentos_codigo_barras_unico
  on public.alimentos (codigo_barras)
  where codigo_barras is not null;

-- Pesquisa por texto sem acentos nem maiúsculas.
create index if not exists alimentos_por_nome
  on public.alimentos (lower(nome));

comment on table public.alimentos is
  'Catálogo partilhado. Leitura para todos os aprovados, escrita só pelo servidor.';
comment on column public.alimentos.fonte is
  'codigo_barras = Open Food Facts; insa = tabela portuguesa; ia = estimado, a confirmar.';

-- ---------------------------------------------------------------------------
-- 2. RLS do catálogo: ler sim, escrever não.
--    Não há política de insert, update ou delete para authenticated. Sem
--    política, a operação é negada — e sem permissão na tabela, nem chega lá.
--    Quem escreve é a função Edge, com a chave de serviço, que passa à frente
--    do RLS por desenho.
-- ---------------------------------------------------------------------------
alter table public.alimentos enable row level security;
alter table public.alimentos no force row level security;

drop policy if exists "ler o catalogo" on public.alimentos;

create policy "ler o catalogo"
  on public.alimentos for select to authenticated
  using ( public.esta_aprovado() );

revoke all on public.alimentos from anon, authenticated;
grant select on public.alimentos to authenticated;

drop trigger if exists ao_alterar_alimento on public.alimentos;
create trigger ao_alterar_alimento
  before update on public.alimentos
  for each row execute function public.marcar_atualizacao();

-- ---------------------------------------------------------------------------
-- 3. Alimentos pessoais. Mesmo desenho das outras tabelas privadas.
-- ---------------------------------------------------------------------------
create table if not exists public.alimentos_meus (
  id             uuid primary key default gen_random_uuid(),
  utilizador_id  uuid not null references auth.users (id) on delete cascade,
  nome           text not null,
  kcal_100       numeric(6,1) not null,
  gramas_unidade numeric(6,1),
  nome_unidade   text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='alimentos_meus_kcal_plausivel') then
    alter table public.alimentos_meus add constraint alimentos_meus_kcal_plausivel
      check (kcal_100 >= 0 and kcal_100 <= 900);
  end if;

  if not exists (select 1 from pg_constraint where conname='alimentos_meus_nome_nao_vazio') then
    alter table public.alimentos_meus add constraint alimentos_meus_nome_nao_vazio
      check (length(btrim(nome)) between 1 and 200);
  end if;

  if not exists (select 1 from pg_constraint where conname='alimentos_meus_unidade_coerente') then
    alter table public.alimentos_meus add constraint alimentos_meus_unidade_coerente
      check ((gramas_unidade is null) = (nome_unidade is null));
  end if;

  if not exists (select 1 from pg_constraint where conname='alimentos_meus_unidade_plausivel') then
    alter table public.alimentos_meus add constraint alimentos_meus_unidade_plausivel
      check (gramas_unidade is null or (gramas_unidade > 0 and gramas_unidade <= 5000));
  end if;

  -- Dois alimentos pessoais com o mesmo nome só confundem quem os criou.
  if not exists (select 1 from pg_constraint where conname='alimentos_meus_nome_unico') then
    alter table public.alimentos_meus add constraint alimentos_meus_nome_unico
      unique (utilizador_id, nome);
  end if;
end $$;

alter table public.alimentos_meus enable row level security;
alter table public.alimentos_meus no force row level security;

drop policy if exists "ler os meus alimentos"     on public.alimentos_meus;
drop policy if exists "criar os meus alimentos"   on public.alimentos_meus;
drop policy if exists "alterar os meus alimentos" on public.alimentos_meus;
drop policy if exists "apagar os meus alimentos"  on public.alimentos_meus;

create policy "ler os meus alimentos"
  on public.alimentos_meus for select to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "criar os meus alimentos"
  on public.alimentos_meus for insert to authenticated
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "alterar os meus alimentos"
  on public.alimentos_meus for update to authenticated
  using      ( (select auth.uid()) = utilizador_id and public.esta_aprovado() )
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "apagar os meus alimentos"
  on public.alimentos_meus for delete to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

revoke all on public.alimentos_meus from anon, authenticated;
grant select, insert, delete on public.alimentos_meus to authenticated;
-- Coluna a coluna. utilizador_id fora do alcance do cliente: senão, uma
-- pessoa podia passar um alimento seu para a conta de outra.
grant update (nome, kcal_100, gramas_unidade, nome_unidade)
  on public.alimentos_meus to authenticated;

drop trigger if exists ao_alterar_alimento_meu on public.alimentos_meus;
create trigger ao_alterar_alimento_meu
  before update on public.alimentos_meus
  for each row execute function public.marcar_atualizacao();

-- ---------------------------------------------------------------------------
-- 4. Ligar os registos aos alimentos.
--    O registo continua a guardar descricao e kcal: é uma fotografia do
--    momento. Se o catálogo corrigir um valor amanhã, o histórico de ninguém
--    muda sozinho — num diário alimentar isso seria grave.
--    gramas e alimento_id servem para mostrar "80 g de arroz" e para o botão
--    de repetir o registo.
-- ---------------------------------------------------------------------------
alter table public.registos add column if not exists gramas numeric(7,1);
alter table public.registos add column if not exists alimento_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='registos_alimento_fk') then
    alter table public.registos add constraint registos_alimento_fk
      foreign key (alimento_id) references public.alimentos (id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname='registos_gramas_plausivel') then
    alter table public.registos add constraint registos_gramas_plausivel
      check (gramas is null or (gramas > 0 and gramas <= 10000));
  end if;
end $$;

-- A permissão nova tem de ser dada coluna a coluna, como as outras. Repetir o
-- grant antigo não tira nada: acrescenta.
grant update (gramas, alimento_id) on public.registos to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Pesquisa. Uma função só, para o cliente não ter de saber que há duas
--    tabelas, e para a ordem dos resultados ser decidida no servidor.
--
--    Ordem: alimentos meus primeiro (foram escolhidos por mim, acerto quase
--    sempre), depois INSA (tabela oficial portuguesa), depois produtos de
--    código de barras, e a IA em último porque é estimativa.
-- ---------------------------------------------------------------------------
create or replace function public.procurar_alimento(p_texto text, p_limite int default 20)
returns table (
  id             uuid,
  nome           text,
  marca          text,
  kcal_100       numeric,
  gramas_unidade numeric,
  nome_unidade   text,
  fonte          text,
  meu            boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with procura as (
    select btrim(p_texto) as t
  ),
  -- unaccent não está garantido em todos os projetos; lower + like resolve
  -- o caso comum sem depender de extensões.
  resultados as (
    select m.id, m.nome, null::text as marca, m.kcal_100,
           m.gramas_unidade, m.nome_unidade, 'meu'::text as fonte,
           true as meu, 0 as ordem
      from public.alimentos_meus m, procura p
     where m.utilizador_id = (select auth.uid())
       and lower(m.nome) like '%' || lower(p.t) || '%'
    union all
    select a.id, a.nome, a.marca, a.kcal_100,
           a.gramas_unidade, a.nome_unidade, a.fonte,
           false as meu,
           case a.fonte when 'insa' then 1 when 'codigo_barras' then 2 else 3 end
      from public.alimentos a, procura p
     where lower(a.nome) like '%' || lower(p.t) || '%'
  )
  select r.id, r.nome, r.marca, r.kcal_100, r.gramas_unidade,
         r.nome_unidade, r.fonte, r.meu
    from resultados r, procura p
   where public.esta_aprovado()
     and length(p.t) >= 2
   order by r.ordem, length(r.nome), r.nome
   limit least(greatest(p_limite, 1), 50);
$$;

-- Leitura por código de barras. Devolve no máximo uma linha.
create or replace function public.alimento_por_codigo(p_codigo text)
returns table (
  id             uuid,
  nome           text,
  marca          text,
  kcal_100       numeric,
  gramas_unidade numeric,
  nome_unidade   text,
  fonte          text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.nome, a.marca, a.kcal_100, a.gramas_unidade,
         a.nome_unidade, a.fonte
    from public.alimentos a
   where a.codigo_barras = btrim(p_codigo)
     and public.esta_aprovado()
   limit 1;
$$;

revoke all on function public.procurar_alimento(text, int) from public, anon, authenticated;
revoke all on function public.alimento_por_codigo(text) from public, anon, authenticated;
grant execute on function public.procurar_alimento(text, int) to authenticated;
grant execute on function public.alimento_por_codigo(text) to authenticated;
