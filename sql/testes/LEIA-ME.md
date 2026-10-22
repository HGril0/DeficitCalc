# Testes da base de dados

Correm contra um PostgreSQL local, não contra o Supabase. Servem para provar
que as políticas fazem o que dizem **antes** de mexer na base de dados a sério.

## Correr

```bash
export PGDATA=/var/lib/postgresql/testdc
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -A trust -U postgres"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-k /tmp -p 5433' start"

psql -h /tmp -p 5433 -U postgres -f sql/testes/00-ambiente.sql   # imita o Supabase
psql -h /tmp -p 5433 -U postgres -f sql/01-profiles.sql
psql -h /tmp -p 5433 -U postgres -f sql/02-porteiro.sql
psql -h /tmp -p 5433 -U postgres -f sql/03-perfil-objetivo.sql
psql -h /tmp -p 5433 -U postgres -f sql/testes/01-bateria.sql        # perfis e porteiro
psql -h /tmp -p 5433 -U postgres -f sql/04-registos.sql
psql -h /tmp -p 5433 -U postgres -f sql/testes/02-bateria-pesos.sql    # pesos e gasto estimado
psql -h /tmp -p 5433 -U postgres -f sql/testes/03-bateria-registos.sql # registo diário
psql -h /tmp -p 5433 -U postgres -f sql/05-alimentos.sql
psql -h /tmp -p 5433 -U postgres -f sql/testes/04-bateria-alimentos.sql  # base de alimentos
```

No fim devem passar 93 verificações sem falhas: 16 + 16 + 28 + 33.

O `sql/06-correcao-permissoes.sql` não entra aqui: corrige uma base de dados
que já foi criada com a versão antiga dos ficheiros. Numa instalação do zero,
os ficheiros 01 a 05 já estão corrigidos.

## O ambiente tem de ser tão permissivo como o Supabase

O `00-ambiente.sql` concede **tudo** a `anon`, `authenticated` e `service_role`
em cada tabela e função nova, porque é isso que o Supabase faz. Sem isto, os
testes de "o anónimo não lê" passavam por a permissão nunca ter sido dada no
ambiente de teste, e não por o `revoke` do ficheiro a ter tirado — um teste a
passar por engano é pior do que não ter teste. Foi com esta correção que se
apanhou, a 22/10/2026, o `revoke` das funções que só tirava a permissão do
PUBLIC e deixava intacta a que o Supabase dá ao `anon`.

Daí a forma correcta, que vale para qualquer função nova:

```sql
revoke all on function public.f(...) from public, anon, authenticated;
grant execute on function public.f(...) to authenticated;
```

São duas permissões diferentes. Tirar só uma deixa a porta aberta pela outra.

## O pior caso

Depois de criar as tabelas, vale a pena repetir a bateria com um dono que não
ignora a RLS. Foi assim que se apanhou o erro do `force row level security`,
que fazia falhar o primeiro login de qualquer pessoa nova:

```sql
grant all on schema public to dono_sem_bypass;
grant all on public.profiles, public.autorizados to dono_sem_bypass;
alter function public.criar_perfil_novo_utilizador() owner to dono_sem_bypass;
alter table public.profiles owner to dono_sem_bypass;
alter table public.autorizados owner to dono_sem_bypass;
```

### O que este teste prova, e o que não prova

Serviu para apanhar o `force row level security`, e para isso continua a
servir. Mas **não** é verdade que passar aqui garanta passar em qualquer
configuração — eu afirmei isso antes e estava errado.

Ao passar as funções `security definer` para o `dono_sem_bypass` é preciso
dar-lhe também acesso ao schema `auth`, senão o `auth.uid()` falha e os testes
não correm (dão "permission denied for schema auth" em vez de resultado).

E mesmo com esse acesso, 6 verificações da bateria 04 falham nessa
configuração. A razão é legítima: as políticas estão declaradas `to
authenticated`, por isso não se aplicam a mais nenhum papel; com RLS ligado e
nenhuma política aplicável, o PostgreSQL nega tudo. A função passa a não ler
nada. No Supabase real isto não acontece, porque as funções pertencem ao
`postgres`, que é o dono das tabelas.

O que importa: as falhas são todas no sentido de **negar demasiado**, nunca de
deixar passar. Se alguma vez este teste mostrar o contrário — alguém a ler o
que não é seu — isso é um problema a sério.

## Limpar entre execuções

Apagar só as tabelas não chega. O `create or replace function` mantém o dono
anterior, por isso uma função que tenha ficado com outro dono num teste do pior
caso continua lá, sem direitos sobre as tabelas recriadas — e o resultado é um
"permission denied" no gatilho que faz falhar o registo e deixa metade da
bateria a testar o vazio. Apaga também as funções:

```sql
drop schema if exists auth cascade;
drop table if exists public.registos, public.pesos, public.profiles, public.autorizados,
  public.alimentos, public.alimentos_meus, public.resultado cascade;
drop function if exists public.criar_perfil_novo_utilizador() cascade;
drop function if exists public.marcar_atualizacao() cascade;
drop function if exists public.esta_aprovado() cascade;
drop function if exists public.estimar_gasto(uuid) cascade;
drop function if exists public.dia(date) cascade;
drop function if exists public.ultimos_dias(int) cascade;
drop function if exists public.procurar_alimento(text,int) cascade;
drop function if exists public.alimento_por_codigo(text) cascade;
drop function if exists public.verifica(text,boolean,text) cascade;
```

## Acrescentar uma tabela nova

Copia um bloco do `01-bateria.sql` e troca o nome. Cada tabela precisa de
provar, no mínimo: sem sessão não lê nem escreve; cada pessoa só vê as suas
linhas; não escreve nas colunas que são só do servidor; e o que deve funcionar
continua a funcionar.
