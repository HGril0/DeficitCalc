// Receitas: lista, edição e registo de uma porção no dia de hoje.
// Texto vindo da base de dados só entra no ecrã como textContent.
import { exigirSessao, textoErro } from './sessao.js';
import { alternarTema, desenharIconeTema, aplicarTema } from './tema.js';
import { montarPesquisa } from './pesquisa.js';

const $ = (id) => document.getElementById(id);
const NOMES = { pequeno_almoco: 'pequeno-almoço', almoco: 'almoço', jantar: 'jantar', lanche: 'lanche' };
const hojeISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
const arred1 = (v) => Math.round(v * 10) / 10;

let supabase, receita = null, ingredientes = [], modoGramas = false, aApagar = false, pesquisa = null;

function aviso(texto, tipo) {
  const m = $('msg');
  m.textContent = texto || '';
  m.className = 'aviso ' + (tipo || '');
  m.classList.toggle('oculto', !texto);
  if (texto) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}

// ------------------------------------------------------------------ lista
async function carregarLista() {
  const { data, error } = await supabase.rpc('receitas_resumo');
  if (error) throw error;
  const ul = $('receitas');
  ul.replaceChildren();
  for (const r of data || []) {
    const b = el('button', 'item-receita toque');
    b.type = 'button';
    const esq = el('span');
    esq.append(el('div', 'nome', r.nome),
      el('div', 'meta', `${Number(r.porcoes)} ${Number(r.porcoes) === 1 ? 'porção' : 'porções'} · ${r.ingredientes} ${r.ingredientes === 1 ? 'ingrediente' : 'ingredientes'}`));
    const dir = el('span', 'kcal');
    dir.append(el('span', 'num', String(r.kcal_porcao)), el('small', null, ' kcal/porção'));
    b.append(esq, dir);
    b.addEventListener('click', () => abrir(r).catch((e) => aviso(textoErro(e), 'erro')));
    const li = el('li');
    li.append(b);
    ul.append(li);
  }
  $('sem-receitas').classList.toggle('oculto', (data || []).length > 0);
}

// ------------------------------------------------------------------ editor
function mostrarEditor(sim) {
  $('lista').classList.toggle('oculto', sim);
  $('editor').classList.toggle('oculto', !sim);
  $('voltar').classList.toggle('oculto', !sim);
  $('titulo').textContent = sim ? (receita ? receita.nome : 'Nova receita') : 'Receitas';
  aApagar = false;
  $('r-apagar').textContent = 'Apagar receita';
}

async function abrir(r) {
  aviso('', '');
  receita = r ? { id: r.id, nome: r.nome, porcoes: Number(r.porcoes), peso_final_g: r.peso_final_g == null ? null : Number(r.peso_final_g) } : null;
  $('r-nome').value = receita ? receita.nome : '';
  $('r-porcoes').value = receita ? String(receita.porcoes) : '4';
  $('r-peso').value = receita && receita.peso_final_g ? String(receita.peso_final_g) : '';
  $('r-guardar').textContent = receita ? 'Guardar alterações' : 'Criar receita';
  $('r-corpo').classList.toggle('oculto', !receita);
  ingredientes = [];
  if (receita) await carregarIngredientes();
  pesquisa.limpar();
  mostrarEditor(true);
  if (!receita) setTimeout(() => $('r-nome').focus(), 80);
}

async function carregarIngredientes() {
  const { data, error } = await supabase.from('receita_ingredientes')
    .select('id, nome, kcal_100, gramas, ordem').eq('receita_id', receita.id).order('ordem');
  if (error) throw error;
  ingredientes = data || [];
  desenharIngredientes();
}

function totalKcal() { return ingredientes.reduce((s, i) => s + Number(i.kcal_100) * Number(i.gramas) / 100, 0); }

function desenharIngredientes() {
  const ul = $('r-ingredientes');
  ul.replaceChildren();
  for (const i of ingredientes) {
    const li = el('li');
    const esq = el('span');
    esq.append(el('div', 'ing-nome', i.nome), el('div', 'ing-meta', `${arred1(Number(i.gramas))} g · ${Math.round(Number(i.kcal_100))} kcal/100 g`));
    const dir = el('span', 'dir');
    const k = el('span', 'num', String(Math.round(Number(i.kcal_100) * Number(i.gramas) / 100)));
    const b = el('button', 'apagar toque', 'Tirar');
    b.type = 'button';
    b.setAttribute('aria-label', 'Tirar ' + i.nome);
    b.addEventListener('click', () => tirar(i.id).catch((e) => aviso(textoErro(e), 'erro')));
    dir.append(k, b);
    li.append(esq, dir);
    ul.append(li);
  }
  $('sem-ingredientes').classList.toggle('oculto', ingredientes.length > 0);
  const total = totalKcal();
  const porcoes = Number($('r-porcoes').value) || (receita && receita.porcoes) || 1;
  const peso = Number($('r-peso').value) || null;
  $('r-total').textContent = String(Math.round(total));
  $('r-porcao').textContent = String(Math.round(total / porcoes));
  $('r-100').textContent = peso ? String(Math.round(total * 100 / peso)) : '—';
  $('r-modos').classList.toggle('oculto', !peso);
  if (!peso && modoGramas) definirModo(false);
  atualizarRegisto();
}

async function guardar() {
  const nome = $('r-nome').value.trim();
  const porcoes = Number($('r-porcoes').value);
  const pesoTxt = $('r-peso').value.trim();
  const peso = pesoTxt ? Number(pesoTxt) : null;
  if (!nome) throw new Error('Dá um nome à receita.');
  if (!(porcoes > 0 && porcoes <= 100)) throw new Error('As porções têm de estar entre 0,5 e 100.');
  if (peso !== null && !(peso > 0 && peso <= 50000)) throw new Error('O peso final tem de estar entre 1 g e 50 kg.');
  const campos = { nome, porcoes, peso_final_g: peso };
  if (!receita) {
    const { data, error } = await supabase.from('receitas').insert(campos).select('id, nome, porcoes, peso_final_g').single();
    if (error) throw new Error(error.code === '23505' ? 'Já tens uma receita com esse nome.' : textoErro(error));
    receita = { ...data, porcoes: Number(data.porcoes), peso_final_g: data.peso_final_g == null ? null : Number(data.peso_final_g) };
    $('r-corpo').classList.remove('oculto');
    $('r-guardar').textContent = 'Guardar alterações';
    aviso('Receita criada. Agora junta os ingredientes.', 'bom');
  } else {
    const { error } = await supabase.from('receitas').update(campos).eq('id', receita.id);
    if (error) throw new Error(error.code === '23505' ? 'Já tens uma receita com esse nome.' : textoErro(error));
    Object.assign(receita, campos);
    aviso('Guardado.', 'bom');
  }
  $('titulo').textContent = receita.nome;
  desenharIngredientes();
}

async function juntar(d) {
  if (!receita) throw new Error('Cria a receita primeiro.');
  const { error } = await supabase.from('receita_ingredientes').insert({
    receita_id: receita.id,
    nome: d.nome,
    kcal_100: d.kcal_100,
    gramas: d.gramas,
    alimento_id: d.alimento_id,
    alimento_meu_id: d.alimento_meu_id,
    ordem: ingredientes.length + 1,
  });
  if (error) throw new Error(textoErro(error));
  await carregarIngredientes();
}

async function tirar(id) {
  const { error } = await supabase.from('receita_ingredientes').delete().eq('id', id);
  if (error) throw error;
  await carregarIngredientes();
}

async function apagarReceita() {
  if (!aApagar) {
    aApagar = true;
    $('r-apagar').textContent = 'Tocar outra vez para apagar de vez';
    return;
  }
  const { error } = await supabase.from('receitas').delete().eq('id', receita.id);
  if (error) throw error;
  receita = null;
  mostrarEditor(false);
  await carregarLista();
  aviso('Receita apagada.', 'bom');
}

// ------------------------------------------------------------------ registar
function definirModo(gramas) {
  modoGramas = gramas;
  $('r-modo-porcoes').setAttribute('aria-pressed', String(!gramas));
  $('r-modo-gramas').setAttribute('aria-pressed', String(gramas));
  $('r-rot-qtd').textContent = gramas ? 'Gramas no prato' : 'Porções';
  $('r-qtd').value = gramas ? String(Math.round((Number($('r-peso').value) || 0) / (Number($('r-porcoes').value) || 1))) : '1';
  $('r-qtd').step = gramas ? '1' : '0.25';
  atualizarRegisto();
}
function contaRegisto() {
  const q = Number($('r-qtd').value);
  const total = totalKcal();
  const porcoes = Number($('r-porcoes').value) || 1;
  const peso = Number($('r-peso').value) || null;
  if (!(q > 0)) return null;
  if (modoGramas) {
    if (!peso) return null;
    return { kcal: Math.round(total * q / peso), gramas: arred1(q), texto: `${arred1(q)} g` };
  }
  return { kcal: Math.round(total * q / porcoes), gramas: peso ? arred1(peso * q / porcoes) : null,
           texto: `${q} ${q === 1 ? 'porção' : 'porções'}` };
}
function atualizarRegisto() {
  const c = contaRegisto();
  $('r-kcal').textContent = c ? String(c.kcal) : '0';
}
async function registar() {
  if (!receita) throw new Error('Cria a receita primeiro.');
  if (!ingredientes.length) throw new Error('A receita ainda não tem ingredientes.');
  const c = contaRegisto();
  if (!c) throw new Error('Diz quanto comeste.');
  if (c.kcal > 5000) throw new Error('Isso passa de 5000 kcal de uma vez. Confirma a quantidade.');
  if (c.gramas !== null && !(c.gramas > 0 && c.gramas <= 10000)) throw new Error('A quantidade tem de estar entre 1 g e 10 kg.');
  const refeicao = $('r-refeicao').value;
  const hoje = hojeISO();
  // Uma refeição marcada como "não comi" não leva comida (a mesma regra do Hoje).
  const { data: falta, error: e1 } = await supabase.from('registos')
    .select('id').eq('data', hoje).eq('refeicao', refeicao).eq('nao_comi', true).limit(1);
  if (e1) throw e1;
  if (falta && falta.length) throw new Error(`O ${NOMES[refeicao]} de hoje está marcado como não comido. Anula isso no Hoje primeiro.`);
  const { error } = await supabase.from('registos').insert({
    data: hoje, refeicao, descricao: `${receita.nome} (receita) · ${c.texto}`.slice(0, 160),
    kcal: c.kcal, gramas: c.gramas, fonte: 'manual',
  });
  if (error) throw new Error(textoErro(error));
  aviso(`Registado no ${NOMES[refeicao]} de hoje: ${c.kcal} kcal.`, 'bom');
}

// ------------------------------------------------------------------ arranque
async function principal() {
  const ctx = await exigirSessao();
  supabase = ctx.supabase;

  desenharIconeTema($('btn-tema'));
  $('btn-tema').addEventListener('click', () => { alternarTema(); desenharIconeTema($('btn-tema')); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { aplicarTema(); desenharIconeTema($('btn-tema')); });

  pesquisa = montarPesquisa({
    supabase, aviso, raiz: $('ing-raiz'), prefixo: 'ing-', rotuloConfirmar: 'Juntar à receita', aoConfirmar: juntar,
  });

  const seguro = (f) => () => f().catch((e) => aviso(e && e.message ? e.message : textoErro(e), 'erro'));
  $('nova').addEventListener('click', seguro(() => abrir(null)));
  $('voltar').addEventListener('click', seguro(async () => { receita = null; mostrarEditor(false); await carregarLista(); }));
  $('r-guardar').addEventListener('click', seguro(guardar));
  $('r-apagar').addEventListener('click', seguro(apagarReceita));
  $('r-registar').addEventListener('click', seguro(registar));
  $('r-modo-porcoes').addEventListener('click', () => definirModo(false));
  $('r-modo-gramas').addEventListener('click', () => definirModo(true));
  $('r-qtd').addEventListener('input', atualizarRegisto);
  $('r-porcoes').addEventListener('input', desenharIngredientes);
  $('r-peso').addEventListener('input', desenharIngredientes);
  // A refeição sugerida pela hora: menos um toque na maior parte das vezes.
  const hora = Number(new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false }));
  $('r-refeicao').value = hora < 11 ? 'pequeno_almoco' : hora < 16 ? 'almoco' : hora < 19 ? 'lanche' : 'jantar';

  await carregarLista();
}

principal().catch((e) => aviso(textoErro(e), 'erro'));
