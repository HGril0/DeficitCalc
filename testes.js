import { CONFIG } from './config.js';
const SB = CONFIG.SUPABASE_URL + '/rest/v1';
const CH = CONFIG.SUPABASE_PUBLISHABLE_KEY;
const FANTASMA = '00000000-0000-0000-0000-000000000001';
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Para acrescentar uma tabela nova: copia o bloco de profiles e troca o nome.
// Cada caso diz o que DEVE acontecer, não o que acontece.
// ---------------------------------------------------------------------------
function casos({ eu, tabela, colunasEditaveis, colunasProibidas, linhaAtual }) {
  const c = [];
  c.push({ nome:`[${tabela}] sem sessão não lê`, pedido:['GET',`/${tabela}?select=*`,null,'anon'],
           regra:(s,d)=>negado(s)||(Array.isArray(d)&&d.length===0) });
  c.push({ nome:`[${tabela}] sem sessão não escreve`, pedido:['POST',`/${tabela}`,{id:FANTASMA},'anon'],
           regra:(s)=>negado(s) });
  c.push({ nome:`[${tabela}] só vejo as minhas linhas`, pedido:['GET',`/${tabela}?select=id`,null,'auth'],
           regra:(s,d)=>s===200&&Array.isArray(d)&&d.every(r=>!r.id||r.id===eu) });
  c.push({ nome:`[${tabela}] não leio linhas de outros`, pedido:['GET',`/${tabela}?select=*&id=eq.${FANTASMA}`,null,'auth'],
           regra:(s,d)=>s===200&&Array.isArray(d)&&d.length===0 });
  c.push({ nome:`[${tabela}] não altero linhas de outros`, pedido:['PATCH',`/${tabela}?id=eq.${FANTASMA}`,{},'auth'],
           regra:(s,d)=>negado(s)||(Array.isArray(d)&&d.length===0) });
  c.push({ nome:`[${tabela}] não insiro com id de outro`, pedido:['POST',`/${tabela}`,{id:FANTASMA},'auth'],
           regra:(s)=>negado(s) });
  c.push({ nome:`[${tabela}] não apago`, pedido:['DELETE',`/${tabela}?id=eq.${eu}`,null,'auth'],
           regra:(s)=>negado(s) });
  for (const [col,val] of Object.entries(colunasProibidas)) {
    c.push({ nome:`[${tabela}] não escrevo em ${col}`, pedido:['PATCH',`/${tabela}?id=eq.${eu}`,{[col]:val},'auth'],
             regra:(s)=>negado(s) });
  }
  for (const col of colunasEditaveis) {
    c.push({ nome:`[${tabela}] escrevo em ${col} (deve passar)`,
             pedido:['PATCH',`/${tabela}?id=eq.${eu}`,{[col]:linhaAtual[col]},'auth'],
             regra:(s,d)=>s===200&&Array.isArray(d)&&d.length===1 });
  }
  return c;
}

const negado = (s) => s===401 || s===403;

async function correr() {
  const btn = $('correr'); btn.disabled = true;
  $('lista').innerHTML = ''; $('resumo').style.display='none';

  const bruto = localStorage.getItem('dc.auth');
  if (!bruto) {
    $('lista').innerHTML = '<div class="aviso">Não há sessão. Entra na app primeiro e volta aqui.</div>';
    btn.disabled = false; return;
  }
  const tok = JSON.parse(bruto).access_token;
  const eu  = JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
  const cab = {
    anon: { apikey:CH, Authorization:'Bearer '+CH, 'Content-Type':'application/json' },
    auth: { apikey:CH, Authorization:'Bearer '+tok, 'Content-Type':'application/json' },
  };

  const antes = await (await fetch(`${SB}/profiles?select=*&id=eq.${eu}`,{headers:cab.auth})).json();
  if (!antes[0]) {
    $('lista').innerHTML = '<div class="aviso">Não encontrei o teu perfil. Correste o SQL?</div>';
    btn.disabled = false; return;
  }

  const lista = casos({
    eu, tabela:'profiles',
    colunasEditaveis: ['nome','fuso'],
    colunasProibidas: { admin:true, email:'falso@exemplo.pt', id:FANTASMA, criado_em:'2000-01-01T00:00:00Z' },
    linhaAtual: antes[0],
  });

  let passou = 0;
  for (const t of lista) {
    const [metodo, url, corpo, quem] = t.pedido;
    const h = { ...cab[quem] };
    if (metodo==='PATCH'||metodo==='POST') h.Prefer = 'return=representation';
    let estado, dados;
    try {
      const r = await fetch(SB+url, { method:metodo, headers:h, body: corpo?JSON.stringify(corpo):undefined });
      estado = r.status; try { dados = await r.json(); } catch(_) { dados = null; }
    } catch (e) { estado = 0; dados = { message:String(e) }; }
    const ok = t.regra(estado, dados);
    if (ok) passou++;
    const det = Array.isArray(dados) ? `${dados.length} linha(s)` : (dados?.message || '');
    $('lista').insertAdjacentHTML('beforeend',
      `<div class="linha"><span class="selo ${ok?'p':'f'}">${ok?'PASSA':'FALHA'}</span>
       <div><div class="nome">${t.nome}</div>
       <div class="det">HTTP ${estado}${det?' · '+det.slice(0,90):''}</div></div></div>`);
  }

  // confirmar que os testes não deixaram estragos
  const dep = (await (await fetch(`${SB}/profiles?select=*&id=eq.${eu}`,{headers:cab.auth})).json())[0];
  const intacto = dep && dep.admin===antes[0].admin && dep.email===antes[0].email
                  && dep.id===antes[0].id && dep.criado_em===antes[0].criado_em;

  const tudoBem = passou===lista.length && intacto;
  const r = $('resumo');
  r.className = tudoBem ? 'verde' : 'vermelho';
  r.style.display = 'block';
  r.textContent = tudoBem
    ? `${passou}/${lista.length} — tudo como devia estar.`
    : `${passou}/${lista.length} passaram${intacto?'':' · OS DADOS FORAM ALTERADOS'} — vê as linhas vermelhas.`;
  btn.disabled = false;
}

$('correr').addEventListener('click', correr);
