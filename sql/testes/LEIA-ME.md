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
psql -h /tmp -p 5433 -U postgres -f sql/testes/02-bateria-pesos.sql  # pesos e gasto estimado
```

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

Se a bateria passar assim, passa em qualquer configuração do Supabase.

## Limpar entre execuções

Apagar só as tabelas não chega. O `create or replace function` mantém o dono
anterior, por isso uma função que tenha ficado com outro dono num teste do pior
caso continua lá, sem direitos sobre as tabelas recriadas — e o resultado é um
"permission denied" no gatilho que faz falhar o registo e deixa metade da
bateria a testar o vazio. Apaga também as funções:

```sql
drop schema if exists auth cascade;
drop table if exists public.pesos, public.profiles, public.autorizados, public.resultado cascade;
drop function if exists public.criar_perfil_novo_utilizador() cascade;
drop function if exists public.marcar_atualizacao() cascade;
drop function if exists public.esta_aprovado() cascade;
drop function if exists public.estimar_gasto(uuid) cascade;
drop function if exists public.verifica(text,boolean,text) cascade;
```

## Acrescentar uma tabela nova

Copia um bloco do `01-bateria.sql` e troca o nome. Cada tabela precisa de
provar, no mínimo: sem sessão não lê nem escreve; cada pessoa só vê as suas
linhas; não escreve nas colunas que são só do servidor; e o que deve funcionar
continua a funcionar.
