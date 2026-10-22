-- Restam — correção funcional (22/10/2026). Correr depois do 07.
--
-- Gravar o peso no ecrã de perfil falhava SEMPRE, até na primeira vez.
-- O ecrã usava um "upsert" (criar ou atualizar) e enviava utilizador_id.
-- O Supabase monta isso como "insert ... on conflict do update set
-- utilizador_id = ..., kg = ...", e o PostgreSQL pede permissão para mudar
-- todas as colunas do SET, mesmo que não haja conflito. A coluna
-- utilizador_id não pode ser mudada pelo cliente — de propósito, para
-- ninguém passar dados seus para a conta de outra pessoa —, por isso o
-- pedido era recusado.
--
-- Correção: o dono da linha passa a vir do servidor. O ecrã deixa de o
-- enviar, e a permissão continua fechada.

alter table public.pesos          alter column utilizador_id set default auth.uid();
alter table public.registos       alter column utilizador_id set default auth.uid();
alter table public.alimentos_meus alter column utilizador_id set default auth.uid();
