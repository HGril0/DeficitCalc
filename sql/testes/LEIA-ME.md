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
psql -h /tmp -p 5433 -U postgres -f sql/testes/01-bateria.sql    # 16 verificações
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

## Acrescentar uma tabela nova

Copia um bloco do `01-bateria.sql` e troca o nome. Cada tabela precisa de
provar, no mínimo: sem sessão não lê nem escreve; cada pessoa só vê as suas
linhas; não escreve nas colunas que são só do servidor; e o que deve funcionar
continua a funcionar.
