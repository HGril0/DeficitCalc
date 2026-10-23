-- Restam — passo 8: receitas. Correr DEPOIS do 01 a 10.
-- Pode ser corrido mais do que uma vez.
--
-- Uma receita é uma lista de ingredientes em gramas. Daí sai o total de
-- calorias e, dividindo pelas porções (ou pelo peso final, se a pessoa pesar
-- o tacho), quanto vale aquilo que pôs no prato.
--
-- Privada: cada pessoa só vê as suas. A partilha entre amigos é o passo 11.

-- ---------------------------------------------------------------------------
-- 1. Receitas.
-- ---------------------------------------------------------------------------
create table if not exists public.receitas (
  id             uuid primary key default gen_random_uuid(),
  utilizador_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome           text not null,
  porcoes        numeric(5,1) not null default 1,
  -- Opcional: o peso do tacho já cozinhado, sem o tacho. Com ele, o registo
  -- pode ser feito por gramas no prato em vez de por porções.
  peso_final_g   numeric(7,1),
  notas          text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='receitas_nome_valido') then
    alter table public.receitas add constraint receitas_nome_valido
      check (length(btrim(nome)) between 1 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname='receitas_porcoes_plausiveis') then
    alter table public.receitas add constraint receitas_porcoes_plausiveis
      check (porcoes > 0 and porcoes <= 100);
  end if;
  if not exists (select 1 from pg_constraint where conname='receitas_peso_plausivel') then
    alter table public.receitas add constraint receitas_peso_plausivel
      check (peso_final_g is null or (peso_final_g > 0 and peso_final_g <= 50000));
  end if;
  if not exists (select 1 from pg_constraint where conname='receitas_notas_curtas') then
    alter table public.receitas add constraint receitas_notas_curtas
      check (notas is null or length(notas) <= 2000);
  end if;
  if not exists (select 1 from pg_constraint where conname='receitas_nome_unico') then
    alter table public.receitas add constraint receitas_nome_unico unique (utilizador_id, nome);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ingredientes.
--    Guardam nome e kcal/100 g no momento em que foram postos (como os
--    registos): se o catálogo mudar, a receita não muda sozinha.
--    utilizador_id existe para o RLS — mas NÃO chega. Ver as políticas.
-- ---------------------------------------------------------------------------
create table if not exists public.receita_ingredientes (
  id              uuid primary key default gen_random_uuid(),
  receita_id      uuid not null references public.receitas (id) on delete cascade,
  utilizador_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome            text not null,
  kcal_100        numeric(6,1) not null,
  gramas          numeric(7,1) not null,
  alimento_id     uuid references public.alimentos (id) on delete set null,
  alimento_meu_id uuid references public.alimentos_meus (id) on delete set null,
  ordem           int not null default 0,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='ingredientes_nome_valido') then
    alter table public.receita_ingredientes add constraint ingredientes_nome_valido
      check (length(btrim(nome)) between 1 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conname='ingredientes_kcal_plausivel') then
    alter table public.receita_ingredientes add constraint ingredientes_kcal_plausivel
      check (kcal_100 >= 0 and kcal_100 <= 900);
  end if;
  if not exists (select 1 from pg_constraint where conname='ingredientes_gramas_plausiveis') then
    alter table public.receita_ingredientes add constraint ingredientes_gramas_plausiveis
      check (gramas > 0 and gramas <= 20000);
  end if;
  if not exists (select 1 from pg_constraint where conname='ingredientes_uma_origem') then
    alter table public.receita_ingredientes add constraint ingredientes_uma_origem
      check (alimento_id is null or alimento_meu_id is null);
  end if;
end $$;

create index if not exists receita_ingredientes_por_receita
  on public.receita_ingredientes (receita_id, ordem);

-- ---------------------------------------------------------------------------
-- 3. RLS.
--    Receitas: como as outras tabelas privadas.
--    Ingredientes: o ingrediente tem de ser meu E a receita onde entra tem de
--    ser minha. Só com a primeira condição, eu podia pôr ingredientes (com
--    utilizador_id meu) dentro da receita de outra pessoa e mexer-lhe nas
--    calorias. E a ligação ao alimento pessoal tem de ser a um alimento meu:
--    senão, a receita servia para confirmar que um id alheio existe.
-- ---------------------------------------------------------------------------
alter table public.receitas enable row level security;
alter table public.receitas no force row level security;
alter table public.receita_ingredientes enable row level security;
alter table public.receita_ingredientes no force row level security;

drop policy if exists "ler as minhas receitas"     on public.receitas;
drop policy if exists "criar as minhas receitas"   on public.receitas;
drop policy if exists "alterar as minhas receitas" on public.receitas;
drop policy if exists "apagar as minhas receitas"  on public.receitas;

create policy "ler as minhas receitas" on public.receitas for select to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );
create policy "criar as minhas receitas" on public.receitas for insert to authenticated
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );
create policy "alterar as minhas receitas" on public.receitas for update to authenticated
  using      ( (select auth.uid()) = utilizador_id and public.esta_aprovado() )
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );
create policy "apagar as minhas receitas" on public.receitas for delete to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

drop policy if exists "ler ingredientes meus"     on public.receita_ingredientes;
drop policy if exists "criar ingredientes meus"   on public.receita_ingredientes;
drop policy if exists "alterar ingredientes meus" on public.receita_ingredientes;
drop policy if exists "apagar ingredientes meus"  on public.receita_ingredientes;

create policy "ler ingredientes meus" on public.receita_ingredientes for select to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "criar ingredientes meus" on public.receita_ingredientes for insert to authenticated
  with check (
    (select auth.uid()) = utilizador_id
    and public.esta_aprovado()
    and exists (select 1 from public.receitas r
                 where r.id = receita_id and r.utilizador_id = (select auth.uid()))
    and (alimento_meu_id is null or exists (select 1 from public.alimentos_meus m
                 where m.id = alimento_meu_id and m.utilizador_id = (select auth.uid())))
  );

create policy "alterar ingredientes meus" on public.receita_ingredientes for update to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() )
  with check (
    (select auth.uid()) = utilizador_id
    and public.esta_aprovado()
    and exists (select 1 from public.receitas r
                 where r.id = receita_id and r.utilizador_id = (select auth.uid()))
    and (alimento_meu_id is null or exists (select 1 from public.alimentos_meus m
                 where m.id = alimento_meu_id and m.utilizador_id = (select auth.uid())))
  );

create policy "apagar ingredientes meus" on public.receita_ingredientes for delete to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

revoke all on public.receitas from anon, authenticated;
grant select, insert, delete on public.receitas to authenticated;
grant update (nome, porcoes, peso_final_g, notas) on public.receitas to authenticated;

revoke all on public.receita_ingredientes from anon, authenticated;
grant select, insert, delete on public.receita_ingredientes to authenticated;
-- receita_id e utilizador_id fora: um ingrediente não muda de receita nem de dono.
grant update (nome, kcal_100, gramas, alimento_id, alimento_meu_id, ordem)
  on public.receita_ingredientes to authenticated;

drop trigger if exists ao_alterar_receita on public.receitas;
create trigger ao_alterar_receita before update on public.receitas
  for each row execute function public.marcar_atualizacao();
drop trigger if exists ao_alterar_ingrediente on public.receita_ingredientes;
create trigger ao_alterar_ingrediente before update on public.receita_ingredientes
  for each row execute function public.marcar_atualizacao();

-- ---------------------------------------------------------------------------
-- 4. Totais. security invoker: o RLS das duas tabelas aplica-se por baixo.
-- ---------------------------------------------------------------------------
create or replace function public.receitas_resumo()
returns table (
  id              uuid,
  nome            text,
  porcoes         numeric,
  peso_final_g    numeric,
  ingredientes    int,
  gramas_total    numeric,
  kcal_total      int,
  kcal_porcao     int,
  kcal_100_final  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.nome, r.porcoes, r.peso_final_g,
         count(i.id)::int,
         coalesce(sum(i.gramas), 0),
         coalesce(round(sum(i.kcal_100 * i.gramas / 100)), 0)::int,
         coalesce(round(sum(i.kcal_100 * i.gramas / 100) / r.porcoes), 0)::int,
         case when r.peso_final_g is not null and r.peso_final_g > 0
              then round(coalesce(sum(i.kcal_100 * i.gramas / 100), 0) * 100 / r.peso_final_g, 1) end
    from public.receitas r
    left join public.receita_ingredientes i on i.receita_id = r.id
   where r.utilizador_id = (select auth.uid())
   group by r.id
   order by r.atualizado_em desc;
$$;

revoke all on function public.receitas_resumo() from public, anon, authenticated;
grant execute on function public.receitas_resumo() to authenticated;
