// Testes da função "alimentos" em Node, com fetch simulado.
//   node --experimental-strip-types supabase/functions/alimentos/teste.mjs
globalThis.__EM_TESTE__ = true;
globalThis.__ENV__ = { SUPABASE_URL: 'https://projeto.supabase.co', SUPABASE_ANON_KEY: 'chave-publica',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_SEGREDO' }) };
const { tratar, limparTexto, codigoValido, converterProduto, textoPesquisa } = await import('./index.ts');

let cenario, chamadas;
const jr = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, op = {}) => {
  const h = Object.fromEntries(Object.entries(op.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  chamadas.push({ url: String(url), h, corpo: op.body });
  const u = new URL(url);
  if (u.host === 'projeto.supabase.co') {
    if (u.pathname === '/auth/v1/user') return h.authorization === 'Bearer token-bom' || h.authorization === 'Bearer token-por-aprovar'
      ? jr({ id: h.authorization.includes('aprovar') ? 'u-2' : 'u-1' }) : jr({ msg: 'bad jwt' }, 401);
    if (u.pathname === '/rest/v1/rpc/esta_aprovado') return jr(h.authorization === 'Bearer token-bom');
    if (u.pathname === '/rest/v1/rpc/registar_uso') return jr(!cenario.limite);
    if (u.pathname === '/rest/v1/alimentos') return jr(cenario.cache ? [cenario.cache] : []);
    if (u.pathname === '/rest/v1/rpc/guardar_alimento_off') { const a = JSON.parse(op.body); cenario.guardado = a;
      return jr([{ id: 'novo', nome: a.p_nome, kcal_100: a.p_kcal, fonte: 'codigo_barras', codigo_barras: a.p_codigo }]); }
    return jr({ erro: 'rota ' + u.pathname }, 404);
  }
  if (u.host === 'world.openfoodfacts.org') {
    if (cenario.offLento) await new Promise((_, ko) => { op.signal.addEventListener('abort', () => ko(Object.assign(new Error('abort'), { name: 'AbortError' }))); });
    if (u.pathname.startsWith('/api/v2/product/')) return cenario.produto === 404 ? jr({ status: 0 }, 404) : jr({ status: cenario.produto ? 1 : 0, product: cenario.produto });
  }
  if (u.host === 'search.openfoodfacts.org' && u.pathname === '/search') return jr({ hits: cenario.lista || [] });
  throw new Error('pedido inesperado a ' + url);
};
async function pedir(corpo, { token = 'token-bom', origem = 'https://hgril0.github.io', metodo = 'POST', bruto } = {}) {
  const h = { 'Content-Type': 'application/json', Origin: origem }; if (token) h.Authorization = 'Bearer ' + token;
  const r = await tratar(new Request('https://projeto.supabase.co/functions/v1/alimentos',
    { method: metodo, headers: h, body: metodo === 'POST' ? (bruto ?? JSON.stringify(corpo)) : undefined }));
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {}
  return { s: r.status, j, t, h: r.headers };
}
const res = []; const T = (n, ok, obs = '') => res.push(`${ok ? 'PASSA' : '>>> FALHA'} | ${n}${ok ? '' : ' | ' + obs}`);
const novo = (c = {}) => { cenario = c; chamadas = []; };
const PROD = { product_name_pt: 'Iogurte natural', brands: 'Mimosa,Lactogal', nutriments: { 'energy-kcal_100g': 61, proteins_100g: 3.5, carbohydrates_100g: 4.6, fat_100g: 3.2 }, serving_quantity: 125 };

// --- funções puras
T('P1 código EAN-13 real (exemplo da norma) é aceite', codigoValido('4006381333931'));
T('P2 o mesmo código com o último algarismo trocado é recusado', !codigoValido('4006381333932'));
T('P3 código com letras é recusado', !codigoValido('56012345678a9'));
T('P4 tamanho impossível é recusado', !codigoValido('1234567890'));
T('P5 texto perde controlo e direção', limparTexto('Iog\u202eurte\u0000  natural\u200b', 120) === 'Iog urte natural', JSON.stringify(limparTexto('Iog\u202eurte\u0000  natural\u200b', 120)));
T('P6 texto cortado no máximo', limparTexto('a'.repeat(500), 120).length === 120);
T('P7 só kJ é convertido para kcal', converterProduto({ product_name: 'X', nutriments: { energy_100g: 418.4 } }, '1').kcal_100 === 100);
T('P8 mais de 900 kcal é recusado', converterProduto({ product_name: 'X', nutriments: { 'energy-kcal_100g': 5000 } }, '1') === null);
T('P9 kcal negativo é recusado', converterProduto({ product_name: 'X', nutriments: { 'energy-kcal_100g': -5 } }, '1') === null);
T('P10 sem nome é recusado', converterProduto({ nutriments: { 'energy-kcal_100g': 50 } }, '1') === null);
T('P11 sem energia é recusado (não inventa)', converterProduto({ product_name: 'X', nutriments: {} }, '1') === null);
const partido = converterProduto({ product_name: 'X', nutriments: { 'energy-kcal_100g': 300, proteins_100g: 80, carbohydrates_100g: 80, fat_100g: 10 } }, '1');
T('P12 macros a somar mais de 100 g são descartados', partido.kcal_100 === 300 && partido.proteina_100 === null);
T('P13 texto como número ("12,5") é lido', converterProduto({ product_name: 'X', nutriments: { 'energy-kcal_100g': '12,5' } }, '1').kcal_100 === 12.5);
T('P14 porção absurda é ignorada', converterProduto({ product_name: 'X', nutriments: { 'energy-kcal_100g': 50 }, serving_quantity: 99999 }, '1').gramas_unidade === null);

// --- entrada e autorização
const EAN = '5601234567892'; // algarismo de controlo certo
T('P0 o código de teste é válido', codigoValido(EAN), 'escolhe outro EAN');
novo(); let r = await pedir(null, { metodo: 'OPTIONS' });
T('A1 pré-pedido CORS da origem da app', r.s === 204 && r.h.get('access-control-allow-origin') === 'https://hgril0.github.io');
novo(); r = await pedir(null, { metodo: 'OPTIONS', origem: 'https://site-do-atacante.com' });
T('A2 outra origem não recebe CORS', !r.h.get('access-control-allow-origin'));
novo(); r = await pedir({ acao: 'codigo', codigo: EAN }, { token: null });
T('A3 sem sessão → 401', r.s === 401 && chamadas.length === 0, r.s);
novo(); r = await pedir({ acao: 'codigo', codigo: EAN }, { token: 'token-forjado' });
T('A4 token inválido → 401', r.s === 401, r.s);
novo(); r = await pedir({ acao: 'codigo', codigo: EAN }, { token: 'token-por-aprovar' });
T('A5 conta por aprovar → 403, e o Open Food Facts nem é chamado', r.s === 403 && !chamadas.some(c => c.url.includes('openfoodfacts')), r.s);
novo({ limite: true }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('A6 acima do limite → 429', r.s === 429, r.s);
novo(); r = await pedir(null, { metodo: 'GET' });
T('A7 GET → 405', r.s === 405);
novo(); r = await pedir(null, { bruto: '{isto não é json' });
T('A8 JSON partido → 400', r.s === 400);
novo(); r = await pedir(null, { bruto: JSON.stringify({ acao: 'codigo', codigo: EAN, lixo: 'x'.repeat(5000) }) });
T('A9 corpo gigante → 413', r.s === 413);
novo(); r = await pedir({ acao: 'apagar_tudo' });
T('A10 ação desconhecida → 400', r.s === 400);

// --- código de barras
novo(); r = await pedir({ acao: 'codigo', codigo: '5601234567891' });
T('C1 algarismo de controlo errado → 400 sem chamar ninguém de fora', r.s === 400 && !chamadas.some(c => c.url.includes('openfoodfacts')));
novo(); r = await pedir({ acao: 'codigo', codigo: '../../admin' });
T('C2 tentativa de fugir no caminho → 400', r.s === 400);
novo({ cache: { id: 'c1', nome: 'Do catálogo', atualizado_em: new Date().toISOString() } }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('C3 já no catálogo e recente → não pergunta ao Open Food Facts', r.s === 200 && r.j.origem === 'catalogo' && !chamadas.some(c => c.url.includes('openfoodfacts')));
novo({ produto: PROD }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('C4 produto novo → guarda e devolve', r.s === 200 && r.j.origem === 'open_food_facts' && cenario.guardado?.p_kcal === 61 && cenario.guardado?.p_marca === 'Mimosa', r.t);
T('C5 a guardar vai com a chave de serviço só no apikey', chamadas.filter(c => c.url.includes('guardar_alimento_off')).every(c => c.h.apikey === 'sb_secret_SEGREDO' && !c.h.authorization));
T('C6 o Open Food Facts não recebe token nem chave', chamadas.filter(c => c.url.includes('openfoodfacts')).every(c => !c.h.authorization && !c.h.apikey && !JSON.stringify(c).includes('SEGREDO')));
T('C7 a chave de serviço nunca aparece na resposta', !r.t.includes('SEGREDO'));
novo({ produto: { ...PROD, product_name_pt: '<img src=x onerror=alert(1)>\u202e', nutriments: { 'energy-kcal_100g': 61 } } }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('C8 nome com HTML fica texto simples, sem caracteres de direção', r.s === 200 && cenario.guardado.p_nome === '<img src=x onerror=alert(1)>', JSON.stringify(cenario.guardado?.p_nome));
novo({ produto: { ...PROD, nutriments: { 'energy-kcal_100g': 9999 } } }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('C9 valores absurdos → 422 e nada é guardado', r.s === 422 && !cenario.guardado, r.s);
novo({ produto: 404 }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('C10 produto inexistente → 404', r.s === 404 && r.j.encontrado === false);
novo({ produto: PROD, offLento: true }); r = await pedir({ acao: 'codigo', codigo: EAN });
T('C11 Open Food Facts lento → 504 com mensagem simples', r.s === 504 && !r.t.includes('abort'), r.s + ' ' + r.t);

// --- pesquisa por texto
novo({ lista: [ { code: EAN, ...PROD }, { code: 'abc', ...PROD }, { code: '8712345678906', product_name: 'Sem energia', nutriments: {} } ] });
r = await pedir({ acao: 'procurar', texto: 'iogurte & json=0' });
T('S1 pesquisa devolve só candidatos válidos', r.s === 200 && r.j.candidatos.length === 1 && r.j.candidatos[0].nome === 'Iogurte natural', r.t);
T('S2 pesquisa NÃO guarda no catálogo', !cenario.guardado && !chamadas.some(c => c.url.includes('guardar')));
const urlPesq = chamadas.find(c => c.url.includes('search.openfoodfacts.org')).url;
const qp = new URL(urlPesq).searchParams;
T('S3 texto não consegue injetar parâmetros no pedido', qp.get('langs') === 'pt' && qp.get('q') === 'iogurte json 0 countries_tags:"en:portugal"', urlPesq);
T('S5 operadores de pesquisa são neutralizados', textoPesquisa('arroz OR *:* AND "x"') === 'arroz or and x', textoPesquisa('arroz OR *:* AND "x"'));
T('S6 acentos e cedilhas mantêm-se', textoPesquisa('pão de forma, açúcar') === 'pão de forma açúcar', textoPesquisa('pão de forma, açúcar'));
T('P15 marca em lista (motor novo) é lida', converterProduto({ product_name: 'X', brands: ['Continente', 'Bio'], nutriments: { 'energy-kcal_100g': 69 } }, '1').marca === 'Continente');
novo(); r = await pedir({ acao: 'procurar', texto: ' a ' });
T('S4 menos de duas letras → 400', r.s === 400);

const f = res.filter(x => x.startsWith('>>>')).length;
console.log(res.join('\n') + `\n\nTOTAL ${res.length - f}/${res.length}`); process.exit(f ? 1 : 0);
