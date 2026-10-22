// Restam — função "alimentos".
//
// Faz a ponte entre a app e o Open Food Facts. O browser nunca fala com o
// Open Food Facts diretamente: assim a política de conteúdo (CSP) da app
// continua fechada ao Supabase e o IP dos utilizadores não sai para fora.
//
// Ações (POST com JSON):
//   { acao: "codigo",   codigo: "5601234567890" }  → lê, valida e GUARDA no catálogo
//   { acao: "procurar", texto: "iogurte natural" }  → só MOSTRA candidatos; não guarda
//
// Só se guarda o que foi lido por código de barras. Guardar resultados de
// pesquisa por texto enchia o catálogo partilhado com lixo do Open Food Facts.
//
// Sem bibliotecas: só fetch. Menos código de terceiros com acesso à chave de
// serviço. A chave vem do ambiente da função e nunca sai daqui.

const env = (k) => (typeof Deno !== 'undefined' ? Deno.env.get(k) : globalThis.__ENV__?.[k]) || '';

function chaves() {
  const url = env('SUPABASE_URL');
  // Chaves novas (sb_publishable_/sb_secret_) vêm em JSON; as antigas, soltas.
  let publica = env('SUPABASE_ANON_KEY'), servico = env('SUPABASE_SERVICE_ROLE_KEY');
  try { const p = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}'); publica = p.default || Object.values(p)[0] || publica; } catch (_) {}
  try { const s = JSON.parse(env('SUPABASE_SECRET_KEYS') || '{}'); servico = s.default || Object.values(s)[0] || servico; } catch (_) {}
  return { url, publica, servico };
}

const ORIGENS = (env('ORIGENS_PERMITIDAS') || 'https://hgril0.github.io,https://restam.pages.dev')
  .split(',').map((s) => s.trim()).filter(Boolean);
const OFF = 'https://world.openfoodfacts.org';
// A pesquisa por texto usa o motor novo: o antigo (cgi/search.pl) recusa
// pedidos vindos de servidores em nuvem (testado a 23/10/2026: 502 a partir
// do Supabase, 200 a partir de casa).
const OFF_PESQUISA = 'https://search.openfoodfacts.org/search';
const AGENTE = 'Restam/1.0 (app pessoal de registo alimentar)';
const LIMITE_CORPO = 2048;
const LIMITE_RESPOSTA_OFF = 2_000_000;

// ------------------------------------------------------------------ respostas
function cors(origem) {
  const h = { 'Vary': 'Origin' };
  if (origem && ORIGENS.includes(origem)) {
    h['Access-Control-Allow-Origin'] = origem;
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
function resposta(estado, corpo, origem) {
  return new Response(JSON.stringify(corpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
               'X-Content-Type-Options': 'nosniff', ...cors(origem) },
  });
}

// ---------------------------------------------------------------- validação
// Tira caracteres de controlo e os de direção (usados para disfarçar texto),
// junta espaços e corta no tamanho máximo.
export function limparTexto(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

// Algarismo de controlo dos códigos EAN/UPC/GTIN. Um código errado não vale um
// pedido ao Open Food Facts.
export function codigoValido(c) {
  if (typeof c !== 'string' || !/^[0-9]{8,14}$/.test(c)) return false;
  if (![8, 12, 13, 14].includes(c.length)) return false;
  const d = c.split('').map(Number), ctrl = d.pop();
  const soma = d.reverse().reduce((s, x, i) => s + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === ctrl;
}

// O motor de pesquisa interpreta símbolos (AND, OR, *, :, aspas...). Texto com
// eles fazia o servidor do Open Food Facts responder 500. Fica só com letras,
// algarismos e espaços, e os operadores em maiúsculas passam a palavras.
export function textoPesquisa(s) {
  return limparTexto(s, 60)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\b(AND|OR|NOT|TO)\b/g, (m) => m.toLowerCase())
    .replace(/\s+/g, ' ').trim();
}

const num = (v) => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN));
const arred = (v) => Math.round(v * 10) / 10;

// Converte um produto do Open Food Facts para o nosso formato, ou devolve
// null se os dados não forem de confiança. Nunca inventa valores.
export function converterProduto(p, codigo) {
  if (!p || typeof p !== 'object') return null;
  const nome = limparTexto(p.product_name_pt || p.product_name || p.generic_name_pt || p.generic_name || '', 120);
  if (!nome) return null;
  // O motor novo devolve a marca como lista; o antigo, como texto com vírgulas.
  const marcaBruta = Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0];
  const marca = limparTexto(String(marcaBruta || ''), 60) || null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (!Number.isFinite(kcal)) {
    const kj = Number.isFinite(num(n['energy-kj_100g'])) ? num(n['energy-kj_100g']) : num(n['energy_100g']);
    if (Number.isFinite(kj)) kcal = kj / 4.184;
  }
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 900) return null;
  let prot = num(n.proteins_100g), hid = num(n.carbohydrates_100g), gord = num(n.fat_100g);
  const macroOk = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
  let macros = [prot, hid, gord].map((v) => (macroOk(v) ? arred(v) : null));
  if (macros.reduce((s, v) => s + (v || 0), 0) > 100) macros = [null, null, null];  // dados partidos
  const porcao = num(p.serving_quantity);
  const temPorcao = Number.isFinite(porcao) && porcao > 0 && porcao <= 2000;
  return {
    codigo, nome, marca, kcal_100: arred(kcal),
    proteina_100: macros[0], hidratos_100: macros[1], gordura_100: macros[2],
    gramas_unidade: temPorcao ? arred(porcao) : null,
    nome_unidade: temPorcao ? 'porção' : null,
  };
}

// --------------------------------------------------------------- chamadas
async function buscar(url, opcoes = {}, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { redirect: 'error', ...opcoes, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}
async function jsonLimitado(r, limite) {
  const txt = await r.text();
  if (txt.length > limite) throw new Error('resposta demasiado grande');
  return JSON.parse(txt);
}
function cabServico(k) {
  // As chaves sb_secret_ vão só no apikey; as antigas (JWT) também no Authorization.
  return k.servico.startsWith('sb_secret_')
    ? { apikey: k.servico, 'Content-Type': 'application/json' }
    : { apikey: k.servico, Authorization: 'Bearer ' + k.servico, 'Content-Type': 'application/json' };
}
async function rpcServico(k, nome, args) {
  const r = await buscar(`${k.url}/rest/v1/rpc/${nome}`, { method: 'POST', headers: cabServico(k), body: JSON.stringify(args) });
  if (!r.ok) throw new Error('rpc ' + nome + ' ' + r.status);
  return r.json();
}

async function quemPede(k, token) {
  const r = await buscar(`${k.url}/auth/v1/user`, { headers: { apikey: k.publica, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && typeof u.id === 'string' ? u : null;
}
async function estaAprovado(k, token) {
  const r = await buscar(`${k.url}/rest/v1/rpc/esta_aprovado`, {
    method: 'POST', headers: { apikey: k.publica, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: '{}' });
  return r.ok && (await r.json()) === true;
}

async function porCodigo(k, codigo) {
  // 1) Já está no catálogo e é recente? Não incomoda o Open Food Facts.
  const c = await buscar(`${k.url}/rest/v1/alimentos?codigo_barras=eq.${codigo}&select=*&limit=1`, { headers: cabServico(k) });
  if (c.ok) {
    const [linha] = await c.json();
    if (linha && Date.now() - Date.parse(linha.atualizado_em) < 30 * 864e5) return { estado: 200, corpo: { alimento: linha, origem: 'catalogo' } };
  }
  // 2) Pergunta ao Open Food Facts.
  const campos = 'code,product_name,product_name_pt,generic_name,generic_name_pt,brands,nutriments,serving_quantity';
  const r = await buscar(`${OFF}/api/v2/product/${codigo}?fields=${campos}`, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' }, redirect: 'follow' });
  if (r.status === 404) return { estado: 404, corpo: { encontrado: false } };
  if (!r.ok) {
    console.warn('alimentos: produto no Open Food Facts respondeu', r.status);
    return { estado: 502, corpo: { erro: 'O Open Food Facts não respondeu. Tenta daqui a pouco.' } };
  }
  const d = await jsonLimitado(r, LIMITE_RESPOSTA_OFF);
  if (d.status !== 1 || !d.product) return { estado: 404, corpo: { encontrado: false } };
  const a = converterProduto(d.product, codigo);
  if (!a) return { estado: 422, corpo: { erro: 'O produto existe, mas os valores nutricionais estão em falta ou não fazem sentido.' } };
  // 3) Guarda (ou atualiza) no catálogo partilhado.
  const [guardado] = await rpcServico(k, 'guardar_alimento_off', {
    p_codigo: codigo, p_nome: a.nome, p_marca: a.marca, p_kcal: a.kcal_100,
    p_proteina: a.proteina_100, p_hidratos: a.hidratos_100, p_gordura: a.gordura_100,
    p_gramas_unidade: a.gramas_unidade, p_nome_unidade: a.nome_unidade,
  });
  return { estado: 200, corpo: { alimento: guardado, origem: 'open_food_facts' } };
}

async function procurar(texto) {
  const campos = 'code,product_name,product_name_pt,generic_name,generic_name_pt,brands,nutriments,serving_quantity';
  const q = new URLSearchParams({
    q: `${texto} countries_tags:"en:portugal"`, langs: 'pt', page_size: '20', fields: campos,
  });
  const r = await buscar(`${OFF_PESQUISA}?${q}`, { headers: { 'User-Agent': AGENTE, Accept: 'application/json' }, redirect: 'follow' }, 8000);
  if (!r.ok) {
    console.warn('alimentos: pesquisa no Open Food Facts respondeu', r.status);
    return { estado: 502, corpo: { erro: 'O Open Food Facts não respondeu. Tenta daqui a pouco.' } };
  }
  const d = await jsonLimitado(r, LIMITE_RESPOSTA_OFF);
  const lista = (Array.isArray(d.hits) ? d.hits : [])
    .filter((p) => codigoValido(String(p.code || '')))
    .map((p) => converterProduto(p, String(p.code)))
    .filter(Boolean)
    .slice(0, 15);
  return { estado: 200, corpo: { candidatos: lista } };
}

// ------------------------------------------------------------------ entrada
export async function tratar(req) {
  const origem = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origem) });
  if (req.method !== 'POST') return resposta(405, { erro: 'Método não permitido.' }, origem);

  const k = chaves();
  if (!k.url || !k.publica || !k.servico) return resposta(500, { erro: 'Função mal configurada.' }, origem);

  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return resposta(401, { erro: 'Sem sessão.' }, origem);

    const txt = await req.text();
    if (txt.length > LIMITE_CORPO) return resposta(413, { erro: 'Pedido demasiado grande.' }, origem);
    let corpo; try { corpo = JSON.parse(txt); } catch (_) { return resposta(400, { erro: 'Pedido inválido.' }, origem); }
    if (!corpo || typeof corpo !== 'object') return resposta(400, { erro: 'Pedido inválido.' }, origem);

    const u = await quemPede(k, token);
    if (!u) return resposta(401, { erro: 'Sessão inválida ou expirada.' }, origem);
    if (!(await estaAprovado(k, token))) return resposta(403, { erro: 'Conta ainda não autorizada.' }, origem);
    if (!(await rpcServico(k, 'registar_uso', { p_utilizador: u.id, p_funcao: 'alimentos' })))
      return resposta(429, { erro: 'Muitos pedidos seguidos. Espera um minuto.' }, origem);

    if (corpo.acao === 'codigo') {
      const codigo = String(corpo.codigo || '').trim();
      if (!codigoValido(codigo)) return resposta(400, { erro: 'Código de barras inválido.' }, origem);
      const r = await porCodigo(k, codigo);
      return resposta(r.estado, r.corpo, origem);
    }
    if (corpo.acao === 'procurar') {
      const texto = textoPesquisa(String(corpo.texto || ''));
      if (texto.length < 2) return resposta(400, { erro: 'Escreve pelo menos duas letras.' }, origem);
      const r = await procurar(texto);
      return resposta(r.estado, r.corpo, origem);
    }
    return resposta(400, { erro: 'Ação desconhecida.' }, origem);
  } catch (e) {
    // O detalhe fica no registo da função, nunca na resposta.
    console.error('alimentos:', e && e.message ? e.message : e);
    const tempo = e && e.name === 'AbortError';
    return resposta(tempo ? 504 : 502, { erro: tempo ? 'O Open Food Facts demorou demasiado.' : 'Erro no servidor.' }, origem);
  }
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function' && !globalThis.__EM_TESTE__) Deno.serve(tratar);
