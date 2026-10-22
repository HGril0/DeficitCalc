-- Restam — correção de segurança. Correr no Supabase o quanto antes.
--
-- Duas falhas encontradas a 22/10/2026 ao escrever a bateria do passo 7.
-- Ambas estão na base de dados a sério neste momento.
--
-- FALHA 1 — todas as funções estavam abertas a visitantes anónimos.
--   O PostgreSQL dá EXECUTE ao PUBLIC em cada função nova, por omissão.
--   O "revoke all on function ... from anon" que eu tinha escrito não tirava
--   nada: a permissão não estava dada ao anon, estava dada ao PUBLIC, que o
--   inclui. É o mesmo tipo de erro do revoke por coluna que apanhámos antes:
--   um revoke que parece fazer algo e não faz.
--
--   E há DUAS permissões a tirar, não uma: a que o PostgreSQL dá ao PUBLIC em
--   qualquer função nova, e a que o Supabase dá explicitamente ao anon e ao
--   authenticated em tudo o que nasce no schema public. Tirar só uma delas
--   deixa a porta aberta pela outra. Por isso: from public, anon, authenticated.
--
-- FALHA 2 — e por isso a de verdade: estimar_gasto() devolvia o gasto e o
--   objetivo diário de qualquer pessoa a quem passasse o id, sem sessão
--   nenhuma. A guarda era "v_id <> auth.uid()". Sem sessão, auth.uid() é
--   NULL, a comparação dá NULL em vez de verdadeiro, o IF não dispara e a
--   função seguia em frente. Trocado por "is distinct from", que trata o NULL
--   como deve. Testado antes e depois.
--
-- As restantes funções não deixavam escapar dados mesmo abertas ao PUBLIC,
-- porque filtram por auth.uid() dentro de um WHERE (que com NULL não devolve
-- linhas) e não num IF. Ficam fechadas de qualquer forma: uma função que
-- qualquer pessoa na internet pode chamar é trabalho dado à base de dados
-- sem razão.

-- ---------------------------------------------------------------------------
-- 1. Fechar o PUBLIC em todas as funções.
-- ---------------------------------------------------------------------------
revoke all on function public.esta_aprovado()                      from public, anon, authenticated;
revoke all on function public.estimar_gasto(uuid)                   from public, anon, authenticated;
revoke all on function public.dia(date)                             from public, anon, authenticated;
revoke all on function public.ultimos_dias(int)                     from public, anon, authenticated;
revoke all on function public.criar_perfil_novo_utilizador()        from public, anon, authenticated;
revoke all on function public.marcar_atualizacao()                  from public, anon, authenticated;

-- Estas duas só existem depois de correr o 05-alimentos.sql.
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='procurar_alimento') then
    execute 'revoke all on function public.procurar_alimento(text,int) from public, anon, authenticated';
    execute 'revoke all on function public.alimento_por_codigo(text) from public, anon, authenticated';
    execute 'grant execute on function public.procurar_alimento(text,int) to authenticated';
    execute 'grant execute on function public.alimento_por_codigo(text) to authenticated';
  end if;
end $$;

-- Devolver só o que é preciso. As funções de trigger não ficam com ninguém:
-- correm dentro do trigger, não são para chamar de fora.
grant execute on function public.esta_aprovado()    to authenticated;
grant execute on function public.estimar_gasto(uuid) to authenticated;
grant execute on function public.dia(date)           to authenticated;
grant execute on function public.ultimos_dias(int)   to authenticated;

-- Evitar que o erro volte em funções futuras.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A guarda do estimar_gasto, corrigida.
--    (A mesma versão está no 03-perfil-objetivo.sql, para instalações novas.)
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
  -- "is distinct from" em vez de "<>": com <> , quando auth.uid() é NULL
  -- (visitante sem sessão) a comparação dá NULL, o IF não dispara e a guarda
  -- não guarda nada. Testado: um anónimo conseguia o gasto de outra pessoa
  -- só por passar o id dela.
  if v_id is null
     or (select auth.uid()) is null
     or v_id is distinct from (select auth.uid()) then
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

revoke all on function public.estimar_gasto(uuid) from public, anon, authenticated;
grant execute on function public.estimar_gasto(uuid) to authenticated;
