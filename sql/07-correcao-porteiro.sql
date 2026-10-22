-- Restam — segunda correção de segurança (22/10/2026). Correr depois do 06.
--
-- FALHA 3 — o porteiro confiava só no email.
--   O fornecedor "Email" do Supabase está ligado. Quem souber o email de um
--   convidado pode inscrever-se com esse email e uma palavra-passe, e o
--   porteiro aprova-o porque o email está na lista. Hoje só não entra porque a
--   confirmação de email está ligada e o impostor não abre a caixa de correio
--   da vítima. Se alguém desligar esse interruptor, entra de imediato.
--   Correção: a aprovação só conta para quem entrou pelo Google e tem o email
--   confirmado. Deve também desligar-se o fornecedor Email no painel.
--
-- FALHA 4 — o cliente podia criar perfis.
--   Não precisa: o perfil nasce do trigger no primeiro login. Com a permissão
--   de INSERT aberta, um perfil apagado pelo administrador podia ser recriado
--   pelo próprio já com "aprovado" e "admin" ligados.
--
-- Testado localmente (bateria 05) antes de vir para aqui.

drop policy if exists "criar o proprio perfil" on public.profiles;
revoke insert on public.profiles from anon, authenticated;

create or replace function public.esta_aprovado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.aprovado
       from public.profiles p
       join auth.users u on u.id = p.id
      where p.id = (select auth.uid())
        and u.email_confirmed_at is not null
        and exists (select 1 from auth.identities i
                     where i.user_id = p.id and i.provider = 'google')),
    false
  );
$$;

revoke all on function public.esta_aprovado() from public, anon, authenticated;
grant execute on function public.esta_aprovado() to authenticated;
