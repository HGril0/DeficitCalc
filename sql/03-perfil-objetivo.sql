-- DeficitCalc — passo 5: perfil físico, histórico de peso e objetivo de défice.
-- Correr DEPOIS do 01 e do 02. Pode ser corrido mais do que uma vez.

-- ---------------------------------------------------------------------------
-- 1. Dados do perfil necessários para estimar o gasto diário.
--    A data de nascimento fica em data, não a idade, para não envelhecer mal.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists sexo               text;
alter table public.profiles add column if not exists data_nascimento    date;
alter table public.profiles add column if not exists altura_cm          smallint;
alter table public.profiles add column if not exists nivel_atividade    text;
alter table public.profiles add column if not exists objetivo_kg_semana numeric(3,2);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='profiles_sexo_valido') then
    alter table public.profiles add constraint profiles_sexo_valido
      check (sexo is null or sexo in ('m','f'));
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_altura_plausivel') then
    alter table public.profiles add constraint profiles_altura_plausivel
      check (altura_cm is null or altura_cm between 120 and 230);
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_nascimento_plausivel') then
    alter table public.profiles add constraint profiles_nascimento_plausivel
      check (data_nascimento is null
             or data_nascimento between current_date - interval '100 years'
                                     and current_date - interval '16 years');
  end if;
  if not exists (select 1 from pg_constraint where conname='profiles_atividade_valida') then
    alter table public.profiles add constraint profiles_atividade_valida
      check (nivel_atividade is null
             or nivel_atividade in ('sedentario','leve','moderado','intenso','muito_intenso'));
  end if;
  -- Limite de ritmo de perda. Não é cosmético: impede que alguém se imponha
  -- um défice que a app depois teria de validar como saudável.
  if not exists (select 1 from pg_constraint where conname='profiles_objetivo_seguro') then
    alter table public.profiles add constraint profiles_objetivo_seguro
      check (objetivo_kg_semana is null or objetivo_kg_semana between 0 and 0.75);
  end if;
end $$;

comment on column public.profiles.objetivo_kg_semana is
  'Ritmo de perda pretendido. Limitado a 0,75 kg/semana pela restrição profiles_objetivo_seguro.';

-- O utilizador escreve nestas colunas, mas continua sem poder tocar em
-- admin, aprovado, email, id, criado_em nem atualizado_em.
grant update (nome, avatar_url, fuso,
              sexo, data_nascimento, altura_cm, nivel_atividade, objetivo_kg_semana)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Histórico de peso. Privado: nem com partilha ligada isto sai daqui.
--    Um registo por dia, para a média de 7 dias da validação semanal.
-- ---------------------------------------------------------------------------
create table if not exists public.pesos (
  id             uuid primary key default gen_random_uuid(),
  utilizador_id  uuid not null references auth.users (id) on delete cascade,
  kg             numeric(5,2) not null check (kg between 25 and 400),
  medido_em      date not null default current_date,
  criado_em      timestamptz not null default now(),
  unique (utilizador_id, medido_em)
);

create index if not exists pesos_por_pessoa_e_data
  on public.pesos (utilizador_id, medido_em desc);

alter table public.pesos enable row level security;
-- Sem force, pelo mesmo motivo do profiles (ver 01-profiles.sql).
alter table public.pesos no force row level security;

drop policy if exists "ler os meus pesos"    on public.pesos;
drop policy if exists "criar os meus pesos"  on public.pesos;
drop policy if exists "alterar os meus pesos" on public.pesos;
drop policy if exists "apagar os meus pesos" on public.pesos;

-- Duas condições em todas: a linha é minha, e eu tenho autorização.
create policy "ler os meus pesos"
  on public.pesos for select to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "criar os meus pesos"
  on public.pesos for insert to authenticated
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

create policy "alterar os meus pesos"
  on public.pesos for update to authenticated
  using      ( (select auth.uid()) = utilizador_id and public.esta_aprovado() )
  with check ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

-- O peso é dos poucos sítios onde apagar faz sentido: engana-se a escrever.
create policy "apagar os meus pesos"
  on public.pesos for delete to authenticated
  using ( (select auth.uid()) = utilizador_id and public.esta_aprovado() );

revoke all on public.pesos from anon, authenticated;
grant select, insert, delete on public.pesos to authenticated;
grant update (kg, medido_em) on public.pesos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gasto diário estimado, calculado no servidor.
--    Mifflin-St Jeor. Devolve um intervalo, não um número: a fórmula tem um
--    desvio de cerca de 10% entre pessoas, e esconder isso dá uma falsa
--    precisão que depois estraga a validação semanal.
-- ---------------------------------------------------------------------------
create or replace function public.estimar_gasto(p_id uuid default null)
returns table (
  gasto_estimado   int,
  gasto_minimo     int,
  gasto_maximo     int,
  kcal_objetivo    int,
  kcal_minimo_seguro int,
  objetivo_ajustado boolean,
  motivo           text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id      uuid := coalesce(p_id, (select auth.uid()));
  v         record;
  v_peso    numeric;
  v_idade   int;
  v_bmr     numeric;
  v_fator   numeric;
  v_tdee    numeric;
  v_corte   numeric;
  v_piso    int;
  v_alvo    int;
  v_ajust   boolean := false;
  v_motivo  text := '';
begin
  -- Só o próprio. Sem isto, a função com security definer seria uma porta
  -- lateral para ler o peso dos outros.
  if v_id is null or v_id <> (select auth.uid()) then
    return;
  end if;

  select p.sexo, p.data_nascimento, p.altura_cm, p.nivel_atividade, p.objetivo_kg_semana
    into v from public.profiles p where p.id = v_id;

  select pe.kg into v_peso from public.pesos pe
   where pe.utilizador_id = v_id order by pe.medido_em desc limit 1;

  if v.sexo is null or v.data_nascimento is null or v.altura_cm is null
     or v.nivel_atividade is null or v_peso is null then
    return;  -- falta informação; o ecrã trata disso
  end if;

  v_idade := extract(year from age(current_date, v.data_nascimento));

  v_bmr := 10 * v_peso + 6.25 * v.altura_cm - 5 * v_idade
           + case when v.sexo = 'm' then 5 else -161 end;

  v_fator := case v.nivel_atividade
               when 'sedentario'   then 1.20
               when 'leve'         then 1.375
               when 'moderado'     then 1.55
               when 'intenso'      then 1.725
               when 'muito_intenso' then 1.90
             end;

  v_tdee := v_bmr * v_fator;

  -- 1 kg de gordura ≈ 7700 kcal
  v_corte := coalesce(v.objetivo_kg_semana, 0) * 7700 / 7.0;

  -- Limite 1: o défice não passa de 25% do gasto.
  if v_corte > v_tdee * 0.25 then
    v_corte := v_tdee * 0.25;
    v_ajust := true;
    v_motivo := 'O défice pedido passava de 25% do teu gasto estimado.';
  end if;

  -- Limite 2: piso absoluto de energia diária.
  v_piso := case when v.sexo = 'm' then 1500 else 1200 end;
  v_alvo := round(v_tdee - v_corte);

  if v_alvo < v_piso then
    v_alvo := v_piso;
    v_ajust := true;
    v_motivo := trim(v_motivo || ' O objetivo ficava abaixo do mínimo de '
                || v_piso || ' kcal por dia.');
  end if;

  return query select
    round(v_tdee)::int,
    round(v_tdee * 0.90)::int,
    round(v_tdee * 1.10)::int,
    v_alvo,
    v_piso,
    v_ajust,
    nullif(trim(v_motivo), '');
end;
$$;

revoke all on function public.estimar_gasto(uuid) from anon, authenticated;
grant execute on function public.estimar_gasto(uuid) to authenticated;
