#!/usr/bin/env python3
"""Gera sql/13-insa-dados.sql a partir de dados/insa_tca_v7.1.tsv.

O TSV foi extraído do ficheiro oficial insa_tca.xlsx (BDCA v7.1, atualizado a
03-03-2026; sha256 do .xlsx 155d233b6e16e21848d766bb9a13c1965b8c990b6cd8e69e3f39f4df75c066ca),
com os números arredondados a uma casa decimal.

Uso: python3 -I dados/gerar-sql-insa.py
O SQL gerado não tem nada escrito à mão: tudo vem do TSV, e cada texto passa
por citar(), que dobra as plicas. Um nome com plica não parte o SQL.
"""
import csv
import hashlib
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
TSV = RAIZ / 'dados' / 'insa_tca_v7.1.tsv'
SAIDA = RAIZ / 'sql' / '13-insa-dados.sql'
SHA_TSV = 'f52586f6a117b5c45ab73a158b9cfd26bb9590baa81ff6f79de017bf4afd3d52'
GRUPO_BEBIDAS_ALCOOLICAS = '7'   # por 100 ml na tabela

bruto = TSV.read_bytes()
if hashlib.sha256(bruto).hexdigest() != SHA_TSV:
    sys.exit('O TSV não é o esperado (hash diferente). Não gero nada.')

linhas = list(csv.DictReader(bruto.decode('utf-8').splitlines(), delimiter='\t', quoting=csv.QUOTE_NONE))


def citar(s):
    return "'" + s.replace("'", "''") + "'"


def numero(s):
    v = float(s)
    if not (0 <= v <= 900):
        raise ValueError(s)
    v = round(v, 1)
    return str(int(v)) if v.is_integer() else str(v)


valores = []
for r in linhas:
    if not r['cod'].isdigit() or not r['nome'].strip():
        sys.exit('linha estranha: %r' % r)
    valores.append('(%s,%s,%s,%s,%s,%s,%s)' % (
        citar(r['cod']), citar(r['nome'].strip()), numero(r['kcal']), numero(r['proteinas']),
        numero(r['hidratos']), numero(r['lipidos']),
        'true' if r['grupo'] == GRUPO_BEBIDAS_ALCOOLICAS else 'false'))

sql = f"""-- Restam — dados da tabela do INSA ({len(valores)} alimentos). GERADO por
-- dados/gerar-sql-insa.py a partir de dados/insa_tca_v7.1.tsv; não editar à mão.
-- Correr DEPOIS do 12-insa.sql. Pode ser corrido mais do que uma vez: quem já
-- existe (pelo código do INSA) é atualizado, não duplicado.
--
-- Fonte: Base de Dados da Composição de Alimentos. Instituto Nacional de Saúde
-- Doutor Ricardo Jorge, I. P.- INSA. v 7.1 - 2026.
-- Valores por 100 g de parte edível; bebidas alcoólicas por 100 ml.

insert into public.alimentos
  (codigo_insa, nome, kcal_100, proteina_100, hidratos_100, gordura_100, por_ml, fonte)
select v.codigo, v.nome, v.kcal, v.prot, v.hc, v.gord, v.ml, 'insa'
  from (values
{(','+chr(10)).join('  ' + x for x in valores)}
  ) as v(codigo, nome, kcal, prot, hc, gord, ml)
on conflict (codigo_insa) where codigo_insa is not null do update
  set nome = excluded.nome, kcal_100 = excluded.kcal_100,
      proteina_100 = excluded.proteina_100, hidratos_100 = excluded.hidratos_100,
      gordura_100 = excluded.gordura_100, por_ml = excluded.por_ml
  where (public.alimentos.nome, public.alimentos.kcal_100, public.alimentos.proteina_100,
         public.alimentos.hidratos_100, public.alimentos.gordura_100, public.alimentos.por_ml)
        is distinct from
        (excluded.nome, excluded.kcal_100, excluded.proteina_100,
         excluded.hidratos_100, excluded.gordura_100, excluded.por_ml);
"""
SAIDA.write_text(sql, encoding='utf-8')
print(f'{SAIDA.relative_to(RAIZ)}: {len(valores)} alimentos, {len(sql)} caracteres')
