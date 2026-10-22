// Pesquisa de alimentos na folha de registo.
//
// Regra deste ficheiro: NENHUM texto vindo da base de dados ou do Open Food
// Facts passa por innerHTML. Os nomes dos produtos são escritos por qualquer
// pessoa na internet; aqui só entram como textContent.

const $ = (id) => document.getElementById(id);
const ROTULO_FONTE = {
  meu: 'teu', insa: 'INSA', codigo_barras: 'código de barras', ia: 'estimativa', off: 'Open Food Facts',
};

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}
const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const plural = (s, n) => (n === 1 ? s : s.endsWith('ão') ? s.slice(0, -2) + 'ões' : s + 's');
const arred1 = (v) => Math.round(v * 10) / 10;

export function montarPesquisa({ supabase, registar, aviso }) {
  let locais = [], deFora = [], escolhido = null, modoUnidade = false, temporizador = null, pedido = 0;

  // ------------------------------------------------------------ servidor
  async function funcao(corpo) {
    const { data, error } = await supabase.functions.invoke('alimentos', { body: corpo });
    if (!error) return { ok: true, corpo: data };
    let erro = 'Não foi possível contactar o servidor. Verifica a ligação.';
    let estado = 0;
    try { estado = error.context?.status || 0; const j = await error.context.json(); if (j && typeof j.erro === 'string') erro = j.erro; } catch (_) {}
    if (estado === 404) erro = 'Não encontrei esse produto no Open Food Facts.';
    return { ok: false, estado, erro };
  }

  // ------------------------------------------------------------ resultados
  function desenharResultados() {
    const ul = $('resultados');
    ul.replaceChildren();
    // Um produto que já está no catálogo não aparece duas vezes.
    const idsLocais = new Set(locais.map((a) => a.id));
    const todos = [...locais, ...deFora.filter((c) => !(c.id && idsLocais.has(c.id)))];
    for (const a of todos) {
      const li = el('li');
      const b = el('button', 'resultado toque');
      b.type = 'button';
      const esq = el('span', 'res-esq');
      esq.append(el('span', 'res-nome', a.nome));
      const linha = el('span', 'res-meta');
      if (a.marca) linha.append(el('span', null, a.marca + ' · '));
      linha.append(el('span', 'selo-fonte', ROTULO_FONTE[a.fonte] || a.fonte));
      esq.append(linha);
      const dir = el('span', 'res-kcal');
      dir.append(el('span', 'num', String(Math.round(a.kcal_100))), el('small', null, ' kcal/100 g'));
      b.append(esq, dir);
      b.addEventListener('click', () => escolher(a));
      li.append(b);
      ul.append(li);
    }
    // Conflitos entre fontes: mostrar, não escolher em silêncio (decisão do plano).
    const grupos = new Map();
    for (const a of todos) {
      const k = normalizar(a.nome);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(a);
    }
    const conflito = [...grupos.values()].find((g) => {
      const fontes = new Set(g.map((a) => a.fonte));
      const v = g.map((a) => Number(a.kcal_100));
      return fontes.size > 1 && Math.max(...v) > Math.min(...v) * 1.15;
    });
    const nota = $('nota-conflito');
    if (conflito) {
      const v = conflito.map((a) => Math.round(a.kcal_100));
      nota.textContent = `"${conflito[0].nome}" tem valores diferentes conforme a fonte (${Math.min(...v)} a ${Math.max(...v)} kcal por 100 g). `
        + 'Escolhe o que corresponde ao que comeste — a embalagem manda.';
      nota.classList.remove('oculto');
    } else {
      nota.classList.add('oculto');
    }
    $('sem-resultados').classList.toggle('oculto', todos.length > 0 || $('procura').value.trim().length < 2);
  }

  async function procurarLocal() {
    const texto = $('procura').value.trim();
    deFora = [];
    if (texto.length < 2) { locais = []; desenharResultados(); return; }
    const meu = ++pedido;
    const { data, error } = await supabase.rpc('procurar_alimento', { p_texto: texto, p_limite: 20 });
    if (meu !== pedido) return;                 // chegou uma resposta mais recente
    if (error) { aviso('Não consegui procurar: ' + (error.message || 'erro'), 'erro'); return; }
    locais = (data || []).map((a) => ({ ...a, fonte: a.meu ? 'meu' : a.fonte }));
    desenharResultados();
  }

  async function procurarFora() {
    const texto = $('procura').value.trim();
    if (texto.length < 2) { aviso('Escreve pelo menos duas letras.', 'erro'); return; }
    const btn = $('btn-off');
    btn.disabled = true; btn.textContent = 'A procurar…';
    try {
      const r = await funcao({ acao: 'procurar', texto });
      if (!r.ok) { aviso(r.erro, 'erro'); return; }
      deFora = (r.corpo.candidatos || []).map((c) => ({ ...c, fonte: 'off', id: null }));
      // Quais destes já estão no catálogo? Esses usam a linha que lá está.
      const codigos = deFora.map((c) => c.codigo).filter(Boolean);
      if (codigos.length) {
        const { data } = await supabase.from('alimentos').select('id, codigo_barras').in('codigo_barras', codigos);
        const porCodigo = new Map((data || []).map((x) => [x.codigo_barras, x.id]));
        deFora = deFora.map((c) => ({ ...c, id: porCodigo.get(c.codigo) || null }));
      }
      if (!deFora.length) aviso('O Open Food Facts não tem nada com esse nome à venda em Portugal.', 'bom');
      desenharResultados();
    } finally {
      btn.disabled = false; btn.textContent = 'Procurar no Open Food Facts';
    }
  }

  async function lerCodigo() {
    const codigo = $('codigo').value.replace(/\D/g, '');
    if (codigo.length < 8 || codigo.length > 14) { aviso('O código de barras tem entre 8 e 14 algarismos.', 'erro'); return; }
    const btn = $('btn-codigo');
    btn.disabled = true;
    try {
      const r = await funcao({ acao: 'codigo', codigo });
      if (!r.ok) { aviso(r.erro, 'erro'); return; }
      $('codigo').value = '';
      escolher({ ...r.corpo.alimento, fonte: 'codigo_barras' });
    } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ quantidade
  function gramasAtuais() {
    const q = Number($('quantidade').value);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return modoUnidade && escolhido.gramas_unidade ? q * Number(escolhido.gramas_unidade) : q;
  }
  function kcalAtuais() { return Math.round(Number(escolhido.kcal_100) * gramasAtuais() / 100); }
  function atualizarTotal() {
    $('esc-kcal').textContent = String(kcalAtuais());
    const g = gramasAtuais();
    $('esc-gramas').textContent = modoUnidade && g ? `= ${arred1(g)} g` : '';
  }
  function definirModo(unidade) {
    modoUnidade = unidade;
    $('modo-gramas').setAttribute('aria-pressed', String(!unidade));
    $('modo-unidade').setAttribute('aria-pressed', String(unidade));
    $('rot-quantidade').textContent = unidade ? plural(escolhido.nome_unidade, 2).replace(/^./, (c) => c.toUpperCase()) : 'Gramas';
    $('quantidade').value = unidade ? '1' : '100';
    $('quantidade').step = unidade ? '0.5' : '1';
    atualizarTotal();
  }
  function escolher(a) {
    escolhido = a;
    $('esc-nome').textContent = a.nome + (a.marca ? ` (${a.marca})` : '');
    $('esc-fonte').textContent = `${Math.round(a.kcal_100)} kcal por 100 g · ${ROTULO_FONTE[a.fonte] || a.fonte}`
      + (a.fonte === 'ia' ? ' — valor estimado, confirma se puderes' : '');
    const temUnidade = Number(a.gramas_unidade) > 0 && a.nome_unidade;
    $('unidades').classList.toggle('oculto', !temUnidade);
    if (temUnidade) $('modo-unidade').textContent = `${a.nome_unidade} (${arred1(Number(a.gramas_unidade))} g)`;
    definirModo(!!temUnidade);
    $('bloco-pesquisa').classList.add('oculto');
    $('form-item').classList.add('oculto');
    $('escolhido').classList.remove('oculto');
    setTimeout(() => $('quantidade').focus(), 80);
  }
  function largar() {
    escolhido = null;
    $('escolhido').classList.add('oculto');
    $('bloco-pesquisa').classList.remove('oculto');
    $('form-item').classList.remove('oculto');
  }

  async function registarEscolhido() {
    const g = gramasAtuais(), kcal = kcalAtuais();
    if (!(g > 0 && g <= 5000)) { aviso('A quantidade tem de estar entre 1 e 5000 g.', 'erro'); return; }
    if (kcal > 5000) { aviso('Isso passa de 5000 kcal num só registo. Divide em partes.', 'erro'); return; }
    const btn = $('registar-escolhido');
    btn.disabled = true;
    try {
      let id = escolhido.fonte === 'meu' ? null : escolhido.id || null;
      // Candidato do Open Food Facts ainda fora do catálogo: guarda-o primeiro,
      // pelo caminho que valida (o servidor), para ficar disponível a todos.
      if (!id && escolhido.fonte === 'off' && escolhido.codigo) {
        const r = await funcao({ acao: 'codigo', codigo: escolhido.codigo });
        if (r.ok && r.corpo.alimento) id = r.corpo.alimento.id;
      }
      const qtd = modoUnidade
        ? `${Number($('quantidade').value)} ${plural(escolhido.nome_unidade, Number($('quantidade').value))} (${arred1(g)} g)`
        : `${arred1(g)} g`;
      const descricao = `${escolhido.nome}${escolhido.marca ? ' (' + escolhido.marca + ')' : ''} · ${qtd}`.slice(0, 160);
      const fonte = { meu: 'manual', insa: 'insa', codigo_barras: 'codigo_barras', off: 'codigo_barras', ia: 'ia' }[escolhido.fonte] || 'manual';
      await registar({ descricao, kcal, gramas: arred1(g), alimento_id: id, fonte, estimativa: escolhido.fonte === 'ia' });
      $('procura').value = ''; locais = []; deFora = [];
      desenharResultados();
      largar();
    } catch (e) {
      aviso(e && e.message ? e.message : String(e), 'erro');
    } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ ligações
  $('procura').addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(procurarLocal, 250);
  });
  $('procura').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); procurarFora(); } });
  $('btn-off').addEventListener('click', procurarFora);
  $('btn-codigo').addEventListener('click', lerCodigo);
  $('codigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lerCodigo(); } });
  $('quantidade').addEventListener('input', atualizarTotal);
  $('modo-gramas').addEventListener('click', () => definirModo(false));
  $('modo-unidade').addEventListener('click', () => definirModo(true));
  $('registar-escolhido').addEventListener('click', registarEscolhido);
  $('cancelar-escolhido').addEventListener('click', largar);

  return {
    limpar() { $('procura').value = ''; $('codigo').value = ''; locais = []; deFora = []; desenharResultados(); largar(); },
  };
}
