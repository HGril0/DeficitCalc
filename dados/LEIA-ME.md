# Dados do INSA

Fonte: Base de Dados da Composição de Alimentos. Instituto Nacional de Saúde
Doutor Ricardo Jorge, I. P.- INSA. v 7.1 - 2026.

- Ficheiro original: `insa_tca.xlsx`, descarregado do PortFIR
  (https://portfir.insa.min-saude.pt/) a 23/10/2026. "Atualizado em
  03-03-2026". SHA-256 `155d233b6e16e21848d766bb9a13c1965b8c990b6cd8e69e3f39f4df75c066ca`.
- Autorização: o INSA autorizou o uso nesta app (contacto do Hugo) e não se
  responsabiliza por discrepâncias.
- Condição do próprio ficheiro: a fonte tem de estar **visível** onde os dados
  aparecem. Na app está em três sítios: por baixo dos resultados da pesquisa
  quando há algum do INSA, no alimento escolhido (com o aviso de que os
  valores são médios) e no fim do Perfil. Os testes do ecrã E26 e E27
  confirmam o texto exato.

## O que está aqui

`insa_tca_v7.1.tsv` — 1376 alimentos, extraídos do .xlsx sem mudar nada além
de arredondar a uma casa decimal. Colunas: código, nome, grupo (0–21, pela
ordem em que aparecem no ficheiro), kcal, lípidos, hidratos, proteínas,
álcool, fibra, sal. SHA-256
`f52586f6a117b5c45ab73a158b9cfd26bb9590baa81ff6f79de017bf4afd3d52`.

O grupo 7 (Bebidas alcoólicas) está por **100 ml**; todos os outros por 100 g
de parte edível. Na base de dados isso é a coluna `por_ml`.

`gerar-sql-insa.py` — gera `sql/13-insa-dados.sql` a partir do TSV. Recusa
correr se o hash do TSV não for o de cima. Uso: `python3 -I dados/gerar-sql-insa.py`.

## Em produção

Importado a 23/10/2026 (12-insa.sql e depois 13-insa-dados.sql). Impressão
dos valores, igual em produção e na base de testes:
`aa3d66098fa69921deee1cdeb8616ab1` — calculada com

```sql
select md5(string_agg(codigo_insa||'|'||nome||'|'||kcal_100||'|'||coalesce(proteina_100::text,'')
  ||'|'||coalesce(hidratos_100::text,'')||'|'||coalesce(gordura_100::text,'')||'|'||por_ml,
  ';' order by codigo_insa::bigint))
from public.alimentos where fonte='insa';
```

Quando sair uma versão nova da tabela: substituir o TSV, mudar o hash no
gerador, gerar, correr o 13 outra vez (atualiza pelo código, não duplica) e
mudar o texto da fonte em `pesquisa.js` e `perfil.html` (a versão faz parte
do texto exigido).
