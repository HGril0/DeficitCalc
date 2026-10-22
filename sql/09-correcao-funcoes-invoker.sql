-- Restam — reforço (22/10/2026). Correr depois do 08.
--
-- Cinco funções passam de security definer para security invoker. Com
-- definer corriam com os poderes do dono e ignoravam o RLS: a segurança
-- dependia só das condições escritas dentro delas — e foi uma dessas
-- condições que falhou hoje. Com invoker correm com os poderes de quem as
-- chama, e o RLS das tabelas aplica-se por baixo.
--
-- Testado: com as condições internas apagadas de propósito, ninguém passou a
-- ver dados de outra pessoa.
--
-- O esta_aprovado() fica como definer: precisa de ler auth.identities, a que
-- os utilizadores não têm acesso. Não recebe parâmetros e só responde sobre
-- quem pergunta.

alter function public.estimar_gasto(uuid)          security invoker;
alter function public.dia(date)                    security invoker;
alter function public.ultimos_dias(int)            security invoker;
alter function public.procurar_alimento(text, int) security invoker;
alter function public.alimento_por_codigo(text)    security invoker;
