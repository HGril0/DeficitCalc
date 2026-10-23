import { exigirSessao, textoErro } from './sessao.js';
import { alternarTema, desenharIconeTema, aplicarTema } from './tema.js';
import { montarPesquisa } from './pesquisa.js';

const $ = (id) => document.getElementById(id);
const PRINCIPAIS = ['pequeno_almoco', 'almoco', 'jantar'];
const NOMES = {
  pequeno_almoco: 'Pequeno-almoço',
  almoco: 'Almoço',
  jantar: 'Jantar',
  lanche: 'Lanches',
};

let supabase, perfil, eu;
let objetivo = null;         // kcal/dia, vindo de estimar_gasto
let registos = [];           // registos de hoje
let semana = [];             // [{data, kcal, completo}]
let diaSelecionado = null;
let refeicaoAberta = null;
let pesquisa = null;         // montada em principal()

const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });

function numero(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function aviso(texto, tipo) {
  const m = $('msg');
  m.textContent = texto || '';
  m.className = 'aviso ' + (tipo || '');
  m.classList.toggle('oculto', !texto);
  if (texto) window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------- dados
async function carregar() {
  const [r1, r2, r3] = await Promise.all([
    supabase.from('registos').select('*').eq('data', hojeISO()).order('criado_em'),
    supabase.rpc('ultimos_dias', { p_dias: 7 }),
    supabase.rpc('estimar_gasto'),
  ]);
  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;
  registos = r1.data || [];
  semana = r2.data || [];
  const g = Array.isArray(r3.data) ? r3.data[0] : r3.data;
  objetivo = (g && g.kcal_objetivo) ? g.kcal_objetivo : null;
  desenhar();
}

const totalDe = (ref) => registos.filter(r => r.refeicao === ref).reduce((s, r) => s + r.kcal, 0);
const saltada = (ref) => registos.some(r => r.refeicao === ref && r.nao_comi);
const itensDe = (ref) => registos.filter(r => r.refeicao === ref && !r.nao_comi);
const comidoHoje = () => registos.reduce((s, r) => s + r.kcal, 0);

// ---------------------------------------------------------------- ecrã
function desenhar() {
  const agora = new Date();
  $('data').textContent = agora.toLocaleDateString('pt-PT', {
    timeZone: 'Europe/Lisbon', weekday: 'long', day: 'numeric', month: 'short',
  }).replace(/^./, c => c.toUpperCase());

  const comido = comidoHoje();
  $('comido').textContent = numero(comido);

  if (objetivo) {
    $('objetivo').textContent = numero(objetivo);
    const restam = objetivo - comido;
    $('restam').textContent = numero(Math.abs(restam));
    $('restam').style.color = restam < 0 ? 'var(--barra-alta-texto)' : 'var(--texto)';
    $('restam').previousElementSibling.textContent = restam < 0 ? 'A MAIS' : 'RESTAM';
    const traco = document.createElement('span');
    traco.style.cssText = 'width:16px;border-top:1px dashed var(--texto)';
    $('legenda-objetivo').replaceChildren(traco, 'objetivo ' + numero(objetivo));
  } else {
    $('objetivo').textContent = '—';
    $('restam').textContent = '—';
    $('legenda-objetivo').textContent = '';
  }

  // défice da semana precisa do gasto, não do objetivo; sem perfil fica vazio
  const somaSemana = semana.reduce((s, d) => s + d.kcal, 0);
  $('defice').textContent = objetivo ? '−' + numero(Math.max(0, objetivo * 7 - somaSemana)) : '—';

  desenharGrafico();
  desenharRefeicoes();

  $('carregar').classList.add('oculto');
  $('conteudo').classList.remove('oculto');
}

function desenharGrafico() {
  const barras = $('barras');
  const dias = $('dias');
  barras.replaceChildren();
  dias.replaceChildren();

  const valores = semana.map(d => d.kcal);
  const teto = Math.max(objetivo || 0, ...valores, 1) * 1.08;
  const escala = 84 / teto;

  const linha = document.createElement('div');
  linha.className = 'linha-objetivo';
  linha.style.bottom = objetivo ? Math.round(objetivo * escala) + 'px' : '-100px';
  barras.append(linha);

  semana.forEach((d, i) => {
    const eHoje = d.data === hojeISO();
    const acima = objetivo && d.kcal > objetivo;
    const vazio = d.kcal === 0;

    const b = document.createElement('button');
    b.className = 'toque';
    b.setAttribute('aria-label', rotuloDia(d) + ', ' + numero(d.kcal) + ' kcal');
    b.addEventListener('click', () => {
      diaSelecionado = diaSelecionado === i ? null : i;
      desenharGrafico();
      tituloGrafico();
    });

    const v = document.createElement('span');
    v.className = 'valor';
    v.textContent = vazio ? '' : numero(d.kcal);
    if (acima) v.style.color = 'var(--barra-alta-texto)';
    if (eHoje) v.style.color = 'var(--texto)';

    const h = document.createElement('span');
    h.className = 'haste';
    h.style.height = Math.max(3, Math.round(d.kcal * escala)) + 'px';
    if (acima) h.style.background = 'var(--barra-alta)';
    // hoje ainda não acabou: fica tracejado até o dia estar completo
    if (eHoje && !d.completo) {
      h.style.background = 'var(--hoje-fundo)';
      h.style.border = 'var(--hoje-contorno)';
    }
    if (diaSelecionado === i) h.style.outline = '2px solid var(--acento)';

    b.append(v, h);
    barras.append(b);

    const s = document.createElement('span');
    s.textContent = eHoje ? 'hoje' : letraDia(d.data);
    if (diaSelecionado === i || eHoje) s.style.color = 'var(--texto)';
    dias.append(s);
  });
  tituloGrafico();
}

function letraDia(iso) {
  return ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][new Date(iso + 'T12:00:00').getDay()];
}
function rotuloDia(d) {
  if (d.data === hojeISO()) return 'Hoje';
  return new Date(d.data + 'T12:00:00')
    .toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' });
}

function tituloGrafico() {
  const t = $('titulo-grafico');
  if (diaSelecionado === null || !semana[diaSelecionado]) {
    t.textContent = 'ÚLTIMOS 7 DIAS';
    return;
  }
  const d = semana[diaSelecionado];
  let texto = rotuloDia(d).toUpperCase() + ' · ' + numero(d.kcal) + ' KCAL';
  if (objetivo && d.kcal > 0) {
    const dif = d.kcal - objetivo;
    texto += dif > 0 ? ' · +' + numero(dif) + ' ACIMA' : ' · ' + numero(-dif) + ' ABAIXO';
  }
  t.textContent = texto;
}

function desenharRefeicoes() {
  const lista = $('refeicoes');
  lista.replaceChildren();

  [...PRINCIPAIS, 'lanche'].forEach((ref) => {
    const total = totalDe(ref);
    const itens = itensDe(ref);
    const falta = saltada(ref);

    const b = document.createElement('button');
    b.className = 'linha-toque toque' + (falta ? ' saltada' : '');
    b.addEventListener('click', () => abrirFolha(ref));

    const esq = document.createElement('div');
    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = NOMES[ref];
    esq.append(nome);

    if (falta) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = 'Não comi';
      esq.append(sub);
    } else if (itens.length) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = itens.map(i => i.descricao || 'sem nome').join(', ');
      esq.append(sub);
    }

    const dir = document.createElement('div');
    if (falta) {
      dir.style.cssText = 'font-size:14px;color:var(--fraco)';
      dir.textContent = '—';
    } else if (itens.length) {
      dir.className = 'num kcal';
      const unidade = document.createElement('span');
      unidade.style.cssText = "font-family:'IBM Plex Sans',sans-serif;font-size:11px;color:var(--fraco)";
      unidade.textContent = 'kcal';
      dir.replaceChildren(numero(total) + ' ', unidade);
    } else {
      dir.style.cssText = 'font-size:15px;font-weight:500;color:var(--acento);white-space:nowrap';
      dir.textContent = (ref === 'lanche' ? 'Acrescentar' : 'Registar') + ' ›';
    }

    b.append(esq, dir);
    lista.append(b);
  });
}

// ---------------------------------------------------------------- folha
function abrirFolha(ref) {
  refeicaoAberta = ref;
  $('folha-titulo').textContent = NOMES[ref];
  $('folha-sub').textContent = ref === 'lanche'
    ? 'Acrescenta o que comeste entre refeições. Sem drama.'
    : 'Acrescenta cada alimento com as suas calorias.';
  $('nao-comi').classList.toggle('oculto', ref === 'lanche' || saltada(ref));
  $('nao-comi').textContent = 'Não comi esta refeição';
  desenharItens();
  $('veu').classList.remove('oculto');
  $('folha').classList.remove('oculto');
  $('descricao').value = '';
  $('kcal').value = '';
  pesquisa.limpar();
  pesquisa.focar();
}

function fecharFolha() {
  refeicaoAberta = null;
  $('veu').classList.add('oculto');
  $('folha').classList.add('oculto');
}

function desenharItens() {
  const ul = $('itens');
  ul.replaceChildren();
  if (!refeicaoAberta) return;

  if (saltada(refeicaoAberta)) {
    const li = document.createElement('li');
    li.style.color = 'var(--fraco)';
    const marca = document.createElement('span');
    marca.textContent = 'Marcado como não comido';
    li.append(marca);
    const btn = document.createElement('button');
    btn.className = 'apagar toque';
    btn.textContent = 'Anular';
    btn.addEventListener('click', () => apagar(registos.find(r => r.refeicao === refeicaoAberta && r.nao_comi).id));
    li.append(btn);
    ul.append(li);
    $('form-item').classList.add('oculto');
    return;
  }
  $('form-item').classList.remove('oculto');

  itensDe(refeicaoAberta).forEach((r) => {
    const li = document.createElement('li');
    const esq = document.createElement('span');
    esq.textContent = r.descricao || 'Sem nome';
    const dir = document.createElement('span');
    dir.style.cssText = 'display:flex;align-items:center;gap:10px';
    const k = document.createElement('span');
    k.className = 'num';
    k.style.fontSize = '17px';
    k.textContent = numero(r.kcal);
    const btn = document.createElement('button');
    btn.className = 'apagar toque';
    btn.textContent = 'Apagar';
    btn.setAttribute('aria-label', 'Apagar ' + (r.descricao || 'item'));
    btn.addEventListener('click', () => apagar(r.id));
    dir.append(k, btn);
    li.append(esq, dir);
    ul.append(li);
  });
}

async function acrescentar(ev) {
  ev.preventDefault();
  const btn = $('guardar');
  btn.disabled = true;
  try {
    const kcal = Number($('kcal').value);
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > 5000) {
      throw new Error('As calorias têm de estar entre 0 e 5000.');
    }
    const { error } = await supabase.from('registos').insert({
      utilizador_id: eu,
      data: hojeISO(),
      refeicao: refeicaoAberta,
      descricao: $('descricao').value.trim() || null,
      kcal: Math.round(kcal),
      fonte: 'manual',
    });
    if (error) throw error;
    $('descricao').value = '';
    $('kcal').value = '';
    $('descricao').focus();
    await carregar();
    desenharItens();
  } catch (e) {
    aviso(textoErro(e), 'erro');
  } finally {
    btn.disabled = false;
  }
}

async function marcarNaoComi() {
  const btn = $('nao-comi');
  btn.disabled = true;
  try {
    if (itensDe(refeicaoAberta).length) {
      throw new Error('Esta refeição já tem alimentos. Apaga-os primeiro.');
    }
    const { error } = await supabase.from('registos').insert({
      utilizador_id: eu,
      data: hojeISO(),
      refeicao: refeicaoAberta,
      kcal: 0,
      nao_comi: true,
    });
    if (error) throw error;
    await carregar();
    desenharItens();
    $('nao-comi').classList.add('oculto');
  } catch (e) {
    aviso(textoErro(e), 'erro');
  } finally {
    btn.disabled = false;
  }
}

async function apagar(id) {
  try {
    const { error } = await supabase.from('registos').delete().eq('id', id);
    if (error) throw error;
    await carregar();
    if (refeicaoAberta) {
      $('nao-comi').classList.toggle('oculto', refeicaoAberta === 'lanche' || saltada(refeicaoAberta));
      desenharItens();
    }
  } catch (e) {
    aviso(textoErro(e), 'erro');
  }
}

// ---------------------------------------------------------------- arranque
async function principal() {
  const ctx = await exigirSessao();
  supabase = ctx.supabase;
  perfil = ctx.perfil;
  eu = ctx.sessao.user.id;

  const n = new Date();
  const inicio = new Date(n.getFullYear(), 0, 1);
  $('semana').textContent = 'SEMANA ' + Math.ceil((((n - inicio) / 86400000) + inicio.getDay() + 1) / 7);

  desenharIconeTema($('btn-tema'));
  $('btn-tema').addEventListener('click', () => {
    alternarTema();
    desenharIconeTema($('btn-tema'));
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    aplicarTema();
    desenharIconeTema($('btn-tema'));
  });

  pesquisa = montarPesquisa({
    supabase,
    aviso,
    raiz: $('pesquisa-raiz'),
    separador: 'ou escreve à mão',
    esconderAoEscolher: [$('form-item')],
    // Chamado quando a pessoa escolhe um alimento e a quantidade.
    async aoConfirmar(d) {
      if (!refeicaoAberta) throw new Error('Abre uma refeição primeiro.');
      if (saltada(refeicaoAberta)) throw new Error('Esta refeição está marcada como não comida. Anula isso primeiro.');
      const { error } = await supabase.from('registos').insert({
        data: hojeISO(),
        refeicao: refeicaoAberta,
        descricao: d.descricao,
        kcal: d.kcal,
        gramas: d.gramas,
        alimento_id: d.alimento_id,
        fonte: d.fonte,
        estimativa: d.estimativa,
      });
      if (error) throw new Error(textoErro(error));
      await carregar();
      desenharItens();
    },
  });

  $('veu').addEventListener('click', fecharFolha);
  $('fechar').addEventListener('click', fecharFolha);
  $('form-item').addEventListener('submit', acrescentar);
  $('nao-comi').addEventListener('click', marcarNaoComi);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharFolha(); });

  await carregar();

  if (!objetivo) {
    aviso('Falta o teu perfil para calcular o objetivo diário. Os registos funcionam na mesma.', 'bom');
  }
}

principal().catch((e) => {
  $('carregar').textContent = '';
  aviso(textoErro(e), 'erro');
});
