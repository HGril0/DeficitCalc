#!/usr/bin/env bash
# Reconstrói do zero um PostgreSQL que imita o Supabase, carrega os ficheiros
# de instalação e corre todas as baterias. Sai com código 1 se algo falhar.
#   bash sql/testes/correr-tudo.sh          → instalação nova (01..05)
#   bash sql/testes/correr-tudo.sh antigo   → só monta a base, sem baterias
set -u
cd "$(dirname "$0")/../.."
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
export PGDATA=/var/lib/postgresql/testrestam
SOCK=/tmp/pgsock; PORT=5433
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -m immediate stop" >/dev/null 2>&1 || true
rm -rf "$PGDATA"; mkdir -p "$PGDATA" "$SOCK"; chown postgres:postgres "$PGDATA" "$SOCK"
su postgres -c "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/tmp/initdb.log 2>&1 || { tail /tmp/initdb.log; exit 1; }
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k $SOCK -p $PORT' -l /tmp/pg.log start" >/dev/null 2>&1
for _ in $(seq 20); do pg_isready -q -h $SOCK -p $PORT && break; sleep 0.3; done
P="psql -h $SOCK -p $PORT -U postgres -q -v ON_ERROR_STOP=1"
$P -f sql/testes/00-ambiente.sql >/tmp/out.log 2>&1 || { echo "ERRO 00"; tail /tmp/out.log; exit 1; }
[ "${1:-}" = "antigo" ] && { echo "base vazia pronta (só ambiente)"; exit 0; }
if [ "${1:-}" = "producao" ]; then
  # A história real do Supabase: 01-04 na versão de fa64e6d (o que lá foi
  # posto primeiro), depois as correções pela ordem em que foram corridas.
  for f in 01-profiles 02-porteiro 03-perfil-objetivo 04-registos; do
    git show fa64e6d:sql/$f.sql | $P >/tmp/out.log 2>&1 || { echo "ERRO antigo $f"; tail /tmp/out.log; exit 1; }
  done
  for f in 06-correcao-permissoes 05-alimentos 07-correcao-porteiro 08-correcao-dono-por-omissao \
           09-correcao-funcoes-invoker 10-funcoes-servidor; do
    $P -f sql/$f.sql >/tmp/out.log 2>&1 || { echo "ERRO em $f"; tail -15 /tmp/out.log; exit 1; }
  done
  echo "(base montada com a história de produção)"
else
# Instalação nova: todos os ficheiros numerados MENOS os de correção, que só
# servem para atualizar uma base de dados criada com versões antigas.
for f in sql/[0-9][0-9]-*.sql; do
  case "$f" in *correcao*) continue;; esac
  $P -f "$f" >/tmp/out.log 2>&1 || { echo "ERRO em $f"; tail -15 /tmp/out.log; exit 1; }
done
fi
tot=0; fal=0
for b in sql/testes/[0-9][0-9]-bateria*.sql; do
  out=$(psql -h $SOCK -p $PORT -U postgres -t -A -F' ' -f "$b" 2>&1 | grep -E '^[0-9]+ [0-9]+$' | tail -1)
  f=${out%% *}; t=${out##* }
  [ -z "$out" ] && { echo "$(basename $b): SEM RESULTADO"; fal=$((fal+1)); continue; }
  tot=$((tot+t)); fal=$((fal+f))
  if [ "$f" = "0" ]; then printf '%-28s %s/%s\n' "$(basename $b .sql)" "$t" "$t"
  else printf '%-28s >>> %s FALHAS de %s\n' "$(basename $b .sql)" "$f" "$t"
       psql -h $SOCK -p $PORT -U postgres -f "$b" 2>&1 | grep FALHA; fi
done
echo "TOTAL $((tot-fal))/$tot"
[ "$fal" = "0" ]
