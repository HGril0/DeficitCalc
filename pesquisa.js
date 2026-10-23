// Componente de pesquisa de alimentos, usado no registo de refeições e nas
// receitas. Cada página monta-o dentro de um elemento seu.
//
// Regra deste ficheiro: NADA passa por innerHTML — nem os dados (os nomes do
// Open Food Facts são escritos por qualquer pessoa na internet), nem o HTML do
// próprio componente. Tudo é construído com nós DOM e textContent.

const ROTULO_FONTE = {
  meu: 'teu', insa: 'INSA', codigo_barras: 'código de barras', ia: 'estimativa', off: 'Open Food Facts',
};
// Gorduras: o maior erro de quem regista à mão. A colher e a barra dão uma
// referência visual em vez de pedir gramas de cabeça.
const COLHER_SOPA_G = 13.7;   // 15 ml de azeite (0,915 g/ml)
const COLHER_CHA_G = 4.6;     //  5 ml
const PARTE_MANTEIGA_G = 10;  // barra de 100 g em 10 partes

// Condição de uso da tabela do INSA: a fonte tem de estar visível onde os
// dados aparecem. O texto é o que o próprio ficheiro pede, sem mudar nada.
export const FONTE_INSA = 'Fonte: Base de Dados da Composição de Alimentos. Instituto Nacional de Saúde Doutor Ricardo Jorge, I. P.- INSA. v 7.1 - 2026.';
const AVISO_INSA = 'Valores médios de referência: o alimento que comeste pode ser diferente.';

// Bebidas (valores por 100 ml): medidas habituais em vez de pedir mililitros
// de cabeça. A primeira é a que aparece escolhida.
export function medidasBebida(nome) {
  const n = normalizar(nome);
  if (/\bcerveja\b/.test(n)) return [['imperial', 200], ['mini', 250], ['garrafa', 330], ['caneca', 500]];
  if (/\bsidra\b/.test(n)) return [['garrafa', 330], ['copo', 200]];
  if (/\b(porto|madeira|licoroso)\b/.test(n) || /\blicor\b/.test(n)) return [['cálice', 50], ['copo', 100]];
  if (/\bespumante\b/.test(n)) return [['flute', 125], ['garrafa', 750]];
  if (/\bvinho\b/.test(n)) return [['copo', 150], ['garrafa', 750]];
  if (/\b(aguardente|brandy|gin|rum|whisky)\b/.test(n)) return [['dose', 40], ['dose dupla', 80]];
  return [];
}

const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
const plural = (s, n) => (n === 1 ? s : s.endsWith('ão') ? s.slice(0, -2) + 'ões' : s + 's');
const arred1 = (v) => Math.round(v * 10) / 10;
const virgula = (v) => String(arred1(v)).replace('.', ',');

// h('div', { id: 'x', className: 'y', type: 'button', aria: { pressed: 'true' } }, 'texto', filho, ...)
function h(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'aria') for (const [a, x] of Object.entries(v)) e.setAttribute('aria-' + a, x);
    else if (k === 'attrs') for (const [a, x] of Object.entries(v)) e.setAttribute(a, x);
    else e[k] = v;
  }
  for (const f of filhos.flat()) if (f != null) e.append(f);   // strings viram nós de texto
  return e;
}

export function tipoGordura(nome) {
  const n = normalizar(nome);
  if (/\b(manteiga|margarina|banha)\b/.test(n)) return 'manteiga';
  if (/\b(azeite|oleo)\b/.test(n)) return 'azeite';
  return null;
}

export function montarPesquisa({
  supabase, aviso, raiz, prefixo = '', rotuloConfirmar = 'Registar',
  separador = null, esconderAoEscolher = [], aoConfirmar,
}) {
  const id = (s) => prefixo + s;
  let locais = [], deFora = [], escolhido = null, modoUnidade = false, temporizador = null, pedido = 0;
  let colheres = { sopa: 0, cha: 0 };

  // ------------------------------------------------------------ marcação
  const procura = h('input', { id: id('procura'), type: 'search', maxLength: 60, autocomplete: 'off',
    placeholder: 'iogurte natural, arroz, pão…', attrs: { enterkeyhint: 'search' } });
  const resultados = h('ul', { id: id('resultados'), className: 'resultados' });
  const notaConflito = h('p', { id: id('nota-conflito'), className: 'nota-fonte oculto' });
  const notaInsa = h('p', { id: id('nota-insa'), className: 'nota-fonte nota-insa oculto' }, FONTE_INSA);
  const semResultados = h('p', { id: id('sem-resultados'), className: 'nota-fonte oculto' },
    'Nada no catálogo com esse nome. Experimenta o Open Food Facts.');
  const btnOff = h('button', { id: id('btn-off'), type: 'button', className: 'secundario toque' }, 'Procurar no Open Food Facts');
  const codigo = h('input', { id: id('codigo'), type: 'text', maxLength: 14, autocomplete: 'off',
    placeholder: '5601234567892', attrs: { inputmode: 'numeric' } });
  const btnCodigo = h('button', { id: id('btn-codigo'), type: 'button', className: 'secundario toque' }, 'Ler');
  const blocoPesquisa = h('div', { id: id('bloco-pesquisa') },
    h('label', { htmlFor: id('procura') }, 'Procurar alimento'), procura, resultados, notaConflito, notaInsa, semResultados, btnOff,
    h('div', { className: 'dupla linha-codigo' },
      h('div', {}, h('label', { htmlFor: id('codigo') }, 'Código de barras'), codigo), btnCodigo),
    separador ? h('p', { className: 'separador' }, separador) : null);

  const escNome = h('div', { id: id('esc-nome'), className: 'esc-nome' });
  const escFonte = h('div', { id: id('esc-fonte'), className: 'esc-fonte' });
  const modoGramas = h('button', { id: id('modo-gramas'), type: 'button', className: 'chip toque', aria: { pressed: 'true' } }, 'gramas');
  const modoUnid = h('button', { id: id('modo-unidade'), type: 'button', className: 'chip toque', aria: { pressed: 'false' } });
  const unidades = h('div', { id: id('unidades'), className: 'unidades oculto', attrs: { role: 'group', 'aria-label': 'Medir em' } }, modoGramas, modoUnid);
  const rotQtd = h('label', { id: id('rot-quantidade'), htmlFor: id('quantidade') }, 'Gramas');
  const quantidade = h('input', { id: id('quantidade'), type: 'number', min: '0.5', max: '5000', step: '1', attrs: { inputmode: 'decimal' } });
  const escGramas = h('div', { id: id('esc-gramas'), className: 'esc-gramas' });
  const escKcal = h('span', { id: id('esc-kcal'), className: 'num' }, '0');
  const ajuda = h('div', { id: id('ajuda-gordura'), className: 'ajuda-gordura oculto' });
  const medidas = h('div', { id: id('medidas'), className: 'medidas oculto', attrs: { role: 'group', 'aria-label': 'Medidas habituais' } });
  const escInsa = h('p', { id: id('esc-insa'), className: 'nota-fonte nota-insa oculto' });
  const btnConfirmar = h('button', { id: id('registar-escolhido'), type: 'button', className: 'principal toque' }, rotuloConfirmar);
  const btnCancelar = h('button', { id: id('cancelar-escolhido'), type: 'button', className: 'toque ligacao' }, 'Escolher outro');
  const escolhidoEl = h('div', { id: id('escolhido'), className: 'escolhido oculto' },
    escNome, escFonte, unidades, medidas, ajuda,
    h('div', { className: 'dupla' },
      h('div', {}, rotQtd, quantidade, escGramas),
      h('div', { className: 'esc-total' }, escKcal, h('small', {}, ' kcal'))),
    btnConfirmar, btnCancelar, escInsa);

  raiz.replaceChildren(blocoPesquisa, escolhidoEl);

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
    resultados.replaceChildren();
    const idsLocais = new Set(locais.map((a) => a.id));
    const todos = [...locais, ...deFora.filter((c) => !(c.id && idsLocais.has(c.id)))];
    for (const a of todos) {
      const meta = h('span', { className: 'res-meta' },
        a.marca ? a.marca + ' · ' : null, h('span', { className: 'selo-fonte' }, ROTULO_FONTE[a.fonte] || a.fonte));
      const b = h('button', { type: 'button', className: 'resultado toque' },
        h('span', { className: 'res-esq' }, h('span', { className: 'res-nome' }, a.nome), meta),
        h('span', { className: 'res-kcal' }, h('span', { className: 'num' }, String(Math.round(a.kcal_100))), h('small', {}, a.por_ml ? ' kcal/100 ml' : ' kcal/100 g')));
      b.addEventListener('click', () => escolher(a));
      resultados.append(h('li', {}, b));
    }
    // Conflitos entre fontes: mostrar, não escolher em silêncio (decisão do plano).
    const grupos = new Map();
    for (const a of todos) {
      const k = normalizar(a.nome);
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(a);
    }
    const conflito = [...grupos.values()].find((g) => {
      const v = g.map((a) => Number(a.kcal_100));
      return new Set(g.map((a) => a.fonte)).size > 1 && Math.max(...v) > Math.min(...v) * 1.15;
    });
    if (conflito) {
      const v = conflito.map((a) => Math.round(a.kcal_100));
      notaConflito.textContent = `"${conflito[0].nome}" tem valores diferentes conforme a fonte (${Math.min(...v)} a ${Math.max(...v)} kcal por 100 g). `
        + 'Escolhe o que corresponde ao que comeste — a embalagem manda.';
    }
    notaConflito.classList.toggle('oculto', !conflito);
    notaInsa.classList.toggle('oculto', !todos.some((a) => a.fonte === 'insa'));
    semResultados.classList.toggle('oculto', todos.length > 0 || procura.value.trim().length < 2);
  }

  async function procurarLocal() {
    const texto = procura.value.trim();
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
    const texto = procura.value.trim();
    if (texto.length < 2) { aviso('Escreve pelo menos duas letras.', 'erro'); return; }
    btnOff.disabled = true; btnOff.textContent = 'A procurar…';
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
      btnOff.disabled = false; btnOff.textContent = 'Procurar no Open Food Facts';
    }
  }

  async function lerCodigo() {
    const c = codigo.value.replace(/\D/g, '');
    if (c.length < 8 || c.length > 14) { aviso('O código de barras tem entre 8 e 14 algarismos.', 'erro'); return; }
    btnCodigo.disabled = true;
    try {
      const r = await funcao({ acao: 'codigo', codigo: c });
      if (!r.ok) { aviso(r.erro, 'erro'); return; }
      codigo.value = '';
      escolher({ ...r.corpo.alimento, fonte: 'codigo_barras' });
    } finally { btnCodigo.disabled = false; }
  }

  // ------------------------------------------------------------ gorduras
  function desenharAjuda() {
    const tipo = escolhido && tipoGordura(escolhido.nome);
    ajuda.classList.toggle('oculto', !tipo);
    ajuda.replaceChildren();
    if (tipo === 'manteiga') {
      const g = gramasAtuais();
      const partes = Math.round(g / PARTE_MANTEIGA_G);
      const barra = h('div', { className: 'barra-manteiga', attrs: { role: 'group', 'aria-label': 'Partes da barra de manteiga' } });
      for (let i = 1; i <= 10; i++) {
        const p = h('button', { type: 'button', className: 'parte toque' + (i <= partes ? ' cheia' : ''),
          aria: { label: `${i * PARTE_MANTEIGA_G} gramas`, pressed: String(i <= partes) } });
        p.addEventListener('click', () => { definirModo(false); quantidade.value = String(i * PARTE_MANTEIGA_G); atualizarTotal(); });
        barra.append(p);
      }
      ajuda.append(h('div', { className: 'ajuda-titulo' }, 'Barra de 100 g — toca até onde usaste'), barra,
        h('div', { className: 'ajuda-nota' }, `cada parte são ${PARTE_MANTEIGA_G} g · uma noz de manteiga anda pelos 10 g`));
    } else if (tipo === 'azeite') {
      const linha = (qual, rotulo, g) => {
        const n = colheres[qual];
        const pintas = h('span', { className: 'pintas', aria: { hidden: 'true' } });
        for (let i = 0; i < Math.max(n, 1); i++) pintas.append(h('span', { className: 'pinta' + (i < n ? ' cheia' : '') }));
        const menos = h('button', { type: 'button', className: 'contador toque', aria: { label: 'menos uma ' + rotulo } }, '−');
        const mais = h('button', { type: 'button', className: 'contador toque', aria: { label: 'mais uma ' + rotulo } }, '+');
        const mudar = (d) => {
          colheres[qual] = Math.max(0, Math.min(20, colheres[qual] + d));
          definirModo(false);
          quantidade.value = String(arred1(colheres.sopa * COLHER_SOPA_G + colheres.cha * COLHER_CHA_G) || '');
          atualizarTotal();
          desenharAjuda();             // o contador e as pintas acompanham
          ajuda.querySelector(`[aria-label="${d > 0 ? 'mais' : 'menos'} uma ${rotulo}"]`)?.focus();
        };
        menos.addEventListener('click', () => mudar(-1));
        mais.addEventListener('click', () => mudar(+1));
        return h('div', { className: 'linha-colher' },
          h('span', { className: 'colher-rotulo' }, `${rotulo} `, h('small', {}, `≈ ${virgula(g)} g`)),
          pintas, h('span', { className: 'colher-n num', attrs: { 'data-colher': qual } }, String(n)), menos, mais);
      };
      ajuda.append(h('div', { className: 'ajuda-titulo' }, 'Quantas colheres?'),
        linha('sopa', 'Colher de sopa', COLHER_SOPA_G), linha('cha', 'Colher de chá', COLHER_CHA_G),
        h('div', { className: 'ajuda-nota' }, 'um fio "a olho" numa frigideira costuma ser uma a duas colheres de sopa'));
    }
  }

  // ------------------------------------------------------------ bebidas
  function desenharMedidas() {
    const lista = escolhido && escolhido.por_ml ? medidasBebida(escolhido.nome) : [];
    medidas.classList.toggle('oculto', !lista.length);
    medidas.replaceChildren();
    const q = Number(quantidade.value);
    for (const [nome, ml] of lista) {
      const b = h('button', { type: 'button', className: 'chip toque', aria: { pressed: String(q === ml) } },
        `${nome} · ${ml >= 100 && ml % 10 === 0 ? ml / 10 + ' cl' : ml + ' ml'}`);
      b.addEventListener('click', () => { quantidade.value = String(ml); atualizarTotal(); });
      medidas.append(b);
    }
  }

  // ------------------------------------------------------------ quantidade
  function gramasAtuais() {
    const q = Number(quantidade.value);
    if (!escolhido || !Number.isFinite(q) || q <= 0) return 0;
    return modoUnidade && escolhido.gramas_unidade ? q * Number(escolhido.gramas_unidade) : q;
  }
  const kcalAtuais = () => Math.round(Number(escolhido.kcal_100) * gramasAtuais() / 100);
  function atualizarTotal() {
    escKcal.textContent = String(kcalAtuais());
    const g = gramasAtuais();
    escGramas.textContent = modoUnidade && g ? `= ${arred1(g)} g` : '';
    if (tipoGordura(escolhido.nome) === 'manteiga') desenharAjuda();
    if (escolhido.por_ml) desenharMedidas();
  }
  function definirModo(unidade) {
    if (modoUnidade === unidade && quantidade.value) return;
    modoUnidade = unidade;
    modoGramas.setAttribute('aria-pressed', String(!unidade));
    modoUnid.setAttribute('aria-pressed', String(unidade));
    rotQtd.textContent = unidade ? plural(escolhido.nome_unidade, 2).replace(/^./, (c) => c.toUpperCase())
      : escolhido.por_ml ? 'Mililitros' : 'Gramas';
    const bebida = escolhido.por_ml ? medidasBebida(escolhido.nome) : [];
    quantidade.value = unidade ? '1' : bebida.length ? String(bebida[0][1]) : (tipoGordura(escolhido.nome) ? '' : '100');
    quantidade.step = unidade ? '0.5' : '1';
    atualizarTotal();
  }
  function escolher(a) {
    escolhido = a;
    colheres = { sopa: 0, cha: 0 };
    escNome.textContent = a.nome + (a.marca ? ` (${a.marca})` : '');
    escFonte.textContent = `${Math.round(a.kcal_100)} kcal por 100 ${a.por_ml ? 'ml' : 'g'} · ${ROTULO_FONTE[a.fonte] || a.fonte}`
      + (a.fonte === 'ia' ? ' — valor estimado, confirma se puderes' : '');
    const temUnidade = Number(a.gramas_unidade) > 0 && a.nome_unidade;
    unidades.classList.toggle('oculto', !temUnidade);
    if (temUnidade) modoUnid.textContent = `${a.nome_unidade} (${arred1(Number(a.gramas_unidade))} g)`;
    escInsa.replaceChildren();
    if (a.fonte === 'insa') escInsa.append(FONTE_INSA, ' ', AVISO_INSA);
    escInsa.classList.toggle('oculto', a.fonte !== 'insa');
    modoUnidade = null;                          // força definirModo a desenhar
    definirModo(!!temUnidade);
    desenharAjuda();
    desenharMedidas();
    blocoPesquisa.classList.add('oculto');
    esconderAoEscolher.forEach((e) => e.classList.add('oculto'));
    escolhidoEl.classList.remove('oculto');
    setTimeout(() => quantidade.focus(), 80);
  }
  function largar() {
    escolhido = null;
    escolhidoEl.classList.add('oculto');
    blocoPesquisa.classList.remove('oculto');
    esconderAoEscolher.forEach((e) => e.classList.remove('oculto'));
  }

  async function confirmar() {
    const g = gramasAtuais(), kcal = kcalAtuais();
    const un = escolhido.por_ml ? 'ml' : 'g';
    if (!(g > 0 && g <= 5000)) { aviso(`A quantidade tem de estar entre 1 e 5000 ${un}.`, 'erro'); return; }
    if (kcal > 5000) { aviso('Isso passa de 5000 kcal de uma vez. Divide em partes.', 'erro'); return; }
    btnConfirmar.disabled = true;
    try {
      let alimentoId = escolhido.fonte === 'meu' ? null : escolhido.id || null;
      // Candidato do Open Food Facts ainda fora do catálogo: guarda-o primeiro,
      // pelo caminho que valida (o servidor), para ficar disponível a todos.
      if (!alimentoId && escolhido.fonte === 'off' && escolhido.codigo) {
        const r = await funcao({ acao: 'codigo', codigo: escolhido.codigo });
        if (r.ok && r.corpo.alimento) alimentoId = r.corpo.alimento.id;
      }
      const n = Number(quantidade.value);
      const qtdTexto = modoUnidade ? `${n} ${plural(escolhido.nome_unidade, n)} (${arred1(g)} g)` : `${arred1(g)} ${un}`;
      const nome = `${escolhido.nome}${escolhido.marca ? ' (' + escolhido.marca + ')' : ''}`;
      await aoConfirmar({
        nome: nome.slice(0, 140), kcal_100: Number(escolhido.kcal_100), gramas: arred1(g), unidade: un, kcal, qtdTexto,
        descricao: `${nome} · ${qtdTexto}`.slice(0, 160),
        alimento_id: alimentoId,
        alimento_meu_id: escolhido.fonte === 'meu' ? escolhido.id : null,
        fonte: { meu: 'manual', insa: 'insa', codigo_barras: 'codigo_barras', off: 'codigo_barras', ia: 'ia' }[escolhido.fonte] || 'manual',
        estimativa: escolhido.fonte === 'ia',
      });
      procura.value = ''; locais = []; deFora = [];
      desenharResultados();
      largar();
    } catch (e) {
      aviso(e && e.message ? e.message : String(e), 'erro');
    } finally { btnConfirmar.disabled = false; }
  }

  // ------------------------------------------------------------ ligações
  procura.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(procurarLocal, 250); });
  procura.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); procurarFora(); } });
  btnOff.addEventListener('click', procurarFora);
  btnCodigo.addEventListener('click', lerCodigo);
  codigo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lerCodigo(); } });
  quantidade.addEventListener('input', () => { colheres = { sopa: 0, cha: 0 }; atualizarTotal(); if (tipoGordura(escolhido?.nome) === 'azeite') desenharAjuda(); });
  modoGramas.addEventListener('click', () => definirModo(false));
  modoUnid.addEventListener('click', () => definirModo(true));
  btnConfirmar.addEventListener('click', confirmar);
  btnCancelar.addEventListener('click', largar);

  return {
    limpar() { procura.value = ''; codigo.value = ''; locais = []; deFora = []; desenharResultados(); largar(); },
    focar() { setTimeout(() => procura.focus(), 120); },
  };
}
