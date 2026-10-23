#!/usr/bin/env bash
# Corre todos os testes que não tocam em produção. Sai com 1 se algum falhar.
set -u
cd "$(dirname "$0")"
falhou=0
passo() { printf '\n=== %s ===\n' "$1"; }

passo "Caracteres invisíveis ou de direção no código"
python3 - <<'PY' || falhou=1
import pathlib, sys
maus = []
for f in pathlib.Path('.').rglob('*'):
    if not f.is_file() or '.git' in f.parts or f.suffix not in {'.js','.ts','.mjs','.html','.css','.sql','.json','.md','.sh','.py','.tsv'}:
        continue
    for n, linha in enumerate(f.read_text(encoding='utf-8', errors='replace').splitlines(), 1):
        for c in linha:
            o = ord(c)
            if 0x300 <= o <= 0x36f or 0x200b <= o <= 0x200f or 0x202a <= o <= 0x202e or 0x2066 <= o <= 0x2069 or o == 0xfeff:
                maus.append(f'{f}:{n} U+{o:04X}')
print('\n'.join(maus) if maus else 'nenhum')
sys.exit(1 if maus else 0)
PY

passo "innerHTML no código da app"
if grep -nE "innerHTML|insertAdjacentHTML|outerHTML|document\.write" index.js hoje.js perfil.js receitas.js pesquisa.js sessao.js | grep -v "^\S*:\s*//"; then
  echo ">>> há HTML montado a partir de texto"; falhou=1
else echo "nenhum (tema.js usa ícones fixos, de propósito)"; fi

passo "Base de dados — instalação nova"
bash sql/testes/correr-tudo.sh | tail -1 || falhou=1
bash sql/testes/correr-tudo.sh >/dev/null || falhou=1
passo "Base de dados — história de produção"
bash sql/testes/correr-tudo.sh producao | tail -1 || falhou=1
bash sql/testes/correr-tudo.sh producao >/dev/null || falhou=1

passo "Função alimentos"
node --experimental-strip-types --no-warnings supabase/functions/alimentos/teste.mjs 2>/dev/null | tail -1
node --experimental-strip-types --no-warnings supabase/functions/alimentos/teste.mjs >/dev/null 2>&1 || falhou=1

passo "Ecrã (Chromium com a CSP e os cabeçalhos reais)"
node testes-ecra/correr.mjs > /tmp/ecra.log 2>&1 || falhou=1
grep -E ">>> FALHA|TOTAL" /tmp/ecra.log

echo
[ "$falhou" = "0" ] && echo "TUDO A PASSAR" || echo ">>> HÁ FALHAS"
exit $falhou
