-- DeficitCalc — passo 6: registo diário de refeições.
-- Correr DEPOIS do 01, 02 e 03. Pode ser corrido mais do que uma vez.

-- ---------------------------------------------------------------------------
-- 1. Uma linha por alimento registado.
--    Várias linhas podem pertencer à mesma refeição do mesmo dia: o
--    pequeno-almoço pode ser pão, queijo e café, cada um com as suas calorias.
-- ---------------------------------------------------------------------------
create table if not exists public.registos (
  id            uuid primary key default gen_random_uuid(),
  utilizador_id uuid not null references auth.users (id) on delete cascade,
  data          date not null default current_date,
  refeicao      text not null,
  descricao     text,
  kcal          integer not null default 0,
  nao_comi      boolean not null default false,
  fonte         text not null default 'manual',
  estimativa    boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='registos_refeicao_valida') then
    alter table public.registos add constraint registos_refeicao_valida
      check (refeicao in ('pequeno_almoco','almoco','jantar','lanche'));
  end if;

  -- 5000 kcal numa só linha já não é um alimento, é um erro de digitação.
  if not exists (select 1 from pg_constraint where conname='registos_kcal_plausivel') then
    alter table public.registos add constraint registos_kcal_plausivel
      check (kcal between 0 and 5000);
  end if;

  -- "Não comi" é a ausência de comida, por isso não pode trazer calorias.
  if not exists (select 1 from pg_constraint where conname='registos_nao_comi_sem_kcal') then
    alter table public.registos add constraint registos_nao_comi_sem_kcal
      check (not nao_comi or kcal = 0);
  end if;

  -- Só as refeições principais geram lembretes, por isso só elas precisam de
  -- poder ser marcadas como saltadas. Um lanche que não houve simplesmente
  -- não se regista.
  if not exists (select 1 from pg_constraint where conname='registos_nao_comi_so_principais') then
    alter table public.registos add constraint registos_nao_comi_so_principais
      check (not nao_comi or refeicao <> 'lanche');
  end if;

  if not exists (select 1 from pg_constraint where conname='registos_fonte_valida') then
    alter table public.registos add constraint registos_fonte_valida
      check (fonte in ('manual','codigo_barras','insa','ia','foto'));
  end if;

  -- Nada de datas no futuro, nem histórico anterior à app.
  if not exists (select 1 from pg_constraint where conname='registos_data_plausivel') then
    alter table public.registos add constraint registos_data_plausivel
      check (data >= date '2026-01-01' and data <= current_date + 1);
  end if;
end $$;

comment on table public.registos is
  'Um alimento por linha. Várias linhas por refeição. nao_comi marca uma refeição principal saltada.';
comment on column public.registos.estimativa is
  'Verdadeiro quando o valor veio da IA e não de uma tabela de composição.';

-- Uma refeição ou foi saltada ou teve comida, nunca as duas coisas.
create unique index if not exists registos_uma_falta_por_refeicao
  on public.registos (utilizador_id, data, refeicao)
  where nao_comi;

create index if not exists registos_por_dia
  on public.registos (utilizador_id, data desc);

-- ---------------------------------------------------------------------------
-- 2. RLS: a linha é minha E eu tenho autorização.
-- ---------------------------------------------------------------------------
-- O dono da linha vem do servidor, não do cliente. Assim o ecrã não precisa
-- de enviar utilizador_id, e o "upsert" (criar ou atualizar) não pede
-- permissão para mudar essa coluna — permissão que não existe de propósito,
-- para ninguém passar dados seus para a conta de outra pessoa. Sem isto,
-- gravar o peso falhava sempre (encontrado em produção a 22/10/2026).
alter table public.registos alter column utilizador_id set default auth.uid();

alter table public.registos enable row level security;
alter table public.registos no force row level security;

drop policy if exists "ler os meus registos"    on public.registos;
drop policy if exists "criar os meus registos"  on public.registos;
drop policy if exists "alterar os meus registos" on public.registos;
drop policy if exists "apagar os meus registos" on public.registos;

create policy "ler os meus registos"
  on public.registos for select to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "criar os meus registos"
  on public.registos for insert to authenticated
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "alterar os meus registos"
  on public.registos for update to authenticated
  using      ( (select auth.uid()) = utilizador_id and public.esta_aprovado() )
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "apagar os meus registos"
  on public.registos for delete to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

revoke all on public.registos from anon, authenticated;
grant select, insert, delete on public.registos to authenticated;
-- Coluna a coluna, como nas outras tabelas: criado_em, atualizado_em e
-- utilizador_id ficam fora do alcance do cliente.
grant update (data, refeicao, descricao, kcal, nao_comi, fonte, estimativa)
  on public.registos to authenticated;

drop trigger if exists ao_alterar_registo on public.registos;
create trigger ao_alterar_registo
  before update on public.registos
  for each row execute function public.marcar_atualizacao();

-- ---------------------------------------------------------------------------
-- 3. O dia: totais por refeição, para o ecrã principal.
-- ---------------------------------------------------------------------------
-- security invoker: corre com os poderes de quem chama, por isso o RLS da
-- tabela aplica-se por baixo. A segurança não depende só das condições
-- escritas aqui dentro (foi uma delas, a do NULL no estimar_gasto, que falhou
-- a 22/10/2026). Só o esta_aprovado() precisa de security definer.
create or replace function public.dia(p_data date default null)
returns table (
  refeicao   text,
  kcal       integer,
  itens      integer,
  nao_comi   boolean,
  estimativa boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.refeicao,
         coalesce(sum(r.kcal), 0)::int,
         count(*) filter (where not r.nao_comi)::int,
         bool_or(r.nao_comi),
         bool_or(r.estimativa)
    from public.registos r
   where r.utilizador_id = (select auth.uid())
     and r.data = coalesce(p_data, current_date)
     and public.esta_aprovado()
   group by r.refeicao;
$$;

-- ---------------------------------------------------------------------------
-- 4. A semana: um total por dia, para o gráfico, com os dias vazios incluídos
--    para o gráfico não encolher quando falta um dia.
-- ---------------------------------------------------------------------------
-- security invoker: corre com os poderes de quem chama, por isso o RLS da
-- tabela aplica-se por baixo. A segurança não depende só das condições
-- escritas aqui dentro (foi uma delas, a do NULL no estimar_gasto, que falhou
-- a 22/10/2026). Só o esta_aprovado() precisa de security definer.
create or replace function public.ultimos_dias(p_dias int default 7)
returns table (
  data      date,
  kcal      integer,
  completo  boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.data::date,
         coalesce(sum(r.kcal), 0)::int,
         -- completo = as três principais registadas, com comida ou com falta
         count(distinct r.refeicao) filter (
           where r.refeicao in ('pequeno_almoco','almoco','jantar')
         ) = 3
    from generate_series(
           current_date - (least(greatest(p_dias, 1), 90) - 1),
           current_date,
           interval '1 day'
         ) as d(data)
    left join public.registos r
      on r.data = d.data::date
     and r.utilizador_id = (select auth.uid())
   where public.esta_aprovado()
   group by d.data
   order by d.data;
$$;

revoke all on function public.dia(date) from public, anon, authenticated;
revoke all on function public.ultimos_dias(int) from public, anon, authenticated;
grant execute on function public.dia(date) to authenticated;
grant execute on function public.ultimos_dias(int) to authenticated;
