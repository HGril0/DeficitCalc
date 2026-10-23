-- Restam — contas e limites da IA. Correr DEPOIS do 01 a 13.
-- Pode ser corrido mais do que uma vez.
--
-- A IA custa dinheiro a cada pedido, por isso o dinheiro é tratado aqui, na
-- base de dados, e não na função que chama a IA: se a função tiver um erro,
-- ou se alguém a chamar muitas vezes, o limite continua a valer.
--
-- Nada do que a pessoa escreve é guardado. Guarda-se quem pediu, quando, que
-- modelo respondeu e quanto custou. Os ingredientes que ela tem em casa são
-- assunto dela.

-- ---------------------------------------------------------------------------
-- 1. Registo de custos.
-- ---------------------------------------------------------------------------
create table if not exists public.ia_pedidos (
  id              bigint generated always as identity primary key,
  utilizador_id   uuid not null references auth.users (id) on delete cascade,
  funcao          text not null,
  modelo          text,
  tokens_entrada  int,
  tokens_saida    int,
  -- Em dólares: é a moeda em que as faturas vêm. O teto está em euros e a
  -- conversão está na função, num sítio só.
  custo_usd       numeric(10,6) not null default 0,
  respondeu       boolean not null default false,
  em              timestamptz not null default now()
);

create index if not exists ia_pedidos_por_mes on public.ia_pedidos (em desc);
create index if not exists ia_pedidos_por_pessoa on public.ia_pedidos (utilizador_id, em desc);

alter table public.ia_pedidos enable row level security;
alter table public.ia_pedidos no force row level security;
revoke all on public.ia_pedidos from anon, authenticated;
-- Sem políticas e sem permissões: ninguém lê nem escreve. Só o servidor.

comment on table public.ia_pedidos is
  'Contas da IA: quem pediu, quanto custou. Nunca o texto do pedido nem a resposta.';

-- ---------------------------------------------------------------------------
-- 2. Limites.
--
--    Três travões, do mais apertado para o mais largo:
--      por pessoa e por dia  — evita que uma pessoa gaste o mês dos outros;
--      por mês, em euros     — o teto combinado, com aviso aos 80%;
--      e o de 30/minuto do registar_uso, que já existe para todas as funções.
--
--    Com o modelo barato, um pedido anda pelos 0,0007 $. O teto de 20 € dá
--    para dezenas de milhares de pedidos: é uma rede de segurança contra um
--    erro em ciclo, não um orçamento apertado.
-- ---------------------------------------------------------------------------
create or replace function public.limites_ia()
returns table (teto_eur numeric, usd_por_eur numeric, por_pessoa_dia int)
language sql
immutable
as $$ select 20::numeric, 1.08::numeric, 25; $$;

comment on function public.limites_ia() is
  'Um sítio só para os limites da IA. Mudar aqui muda em todo o lado.';

-- Pede autorização para gastar. Devolve a linha criada (ou nada, se não
-- puder). A linha fica com custo zero até a resposta chegar: um pedido que
-- rebente conta como tentativa, mas não como dinheiro.
create or replace function public.pedir_ia(p_utilizador uuid, p_funcao text)
returns table (id bigint, permitido boolean, motivo text, gasto_eur numeric, teto_eur numeric, aviso boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lim record;
  v_mes numeric;
  v_dia int;
  v_id bigint;
begin
  select * into v_lim from public.limites_ia();

  if p_utilizador is null or p_funcao is null or length(p_funcao) > 40 then
    return query select null::bigint, false, 'pedido inválido'::text, 0::numeric, v_lim.teto_eur, false;
    return;
  end if;

  -- Gasto do mês corrente, em euros.
  select coalesce(sum(p.custo_usd), 0) / v_lim.usd_por_eur
    into v_mes
    from public.ia_pedidos p
   where p.em >= date_trunc('month', now());

  if v_mes >= v_lim.teto_eur then
    return query select null::bigint, false, 'teto do mês'::text, round(v_mes, 2), v_lim.teto_eur, true;
    return;
  end if;

  select count(*) into v_dia
    from public.ia_pedidos p
   where p.utilizador_id = p_utilizador
     and p.funcao = p_funcao
     and p.em > now() - interval '1 day';

  if v_dia >= v_lim.por_pessoa_dia then
    return query select null::bigint, false, 'limite diário'::text, round(v_mes, 2), v_lim.teto_eur, false;
    return;
  end if;

  insert into public.ia_pedidos (utilizador_id, funcao) values (p_utilizador, p_funcao)
  returning public.ia_pedidos.id into v_id;

  -- Arrumação: as contas de há mais de 18 meses já não servem para nada.
  delete from public.ia_pedidos where em < now() - interval '18 months';

  return query select v_id, true, null::text, round(v_mes, 2), v_lim.teto_eur,
                      v_mes >= v_lim.teto_eur * 0.8;
end;
$$;

-- Fecha a conta do pedido com o custo verdadeiro. Só mexe em linhas que ainda
-- não foram fechadas: chamar duas vezes não cobra duas vezes.
create or replace function public.fechar_ia(
  p_id bigint, p_modelo text, p_entrada int, p_saida int, p_custo_usd numeric
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if p_id is null or p_custo_usd is null or p_custo_usd < 0 or p_custo_usd > 5 then
    return false;   -- 5 $ num pedido só é erro, não é uso
  end if;
  update public.ia_pedidos
     set modelo = left(coalesce(p_modelo, ''), 60),
         tokens_entrada = greatest(coalesce(p_entrada, 0), 0),
         tokens_saida = greatest(coalesce(p_saida, 0), 0),
         custo_usd = p_custo_usd,
         respondeu = true
   where id = p_id and respondeu = false;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Painel de custos, só para o administrador (decisão do plano).
-- ---------------------------------------------------------------------------
-- security definer: a tabela das contas está fechada a toda a gente, por isso
-- a função tem de a ler com os poderes do dono. Quem manda é o teste de
-- administrador aqui dentro — para quem não o é, não há linha nenhuma.
create or replace function public.custos_ia()
returns table (dia date, pedidos bigint, pessoas bigint, custo_eur numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.em::date,
         count(*),
         count(distinct p.utilizador_id),
         round(sum(p.custo_usd) / (select l.usd_por_eur from public.limites_ia() l), 2)
    from public.ia_pedidos p
   where exists (select 1 from public.profiles f
                  where f.id = (select auth.uid()) and f.admin = true)
     and p.em >= date_trunc('month', now()) - interval '2 months'
   group by 1
   order by 1 desc;
$$;

revoke all on function public.pedir_ia(uuid, text) from public, anon, authenticated;
revoke all on function public.fechar_ia(bigint, text, int, int, numeric) from public, anon, authenticated;
revoke all on function public.custos_ia() from public, anon, authenticated;
revoke all on function public.limites_ia() from public, anon, authenticated;
grant execute on function public.pedir_ia(uuid, text) to service_role;
grant execute on function public.fechar_ia(bigint, text, int, int, numeric) to service_role;
grant execute on function public.limites_ia() to service_role;
-- O painel é para ele ver na app, por isso é o único que a sessão pode chamar.
-- A própria função confirma que quem chama é administrador.
grant execute on function public.custos_ia() to authenticated;
