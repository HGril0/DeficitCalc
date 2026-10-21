// Escolha de tema, partilhada por todas as páginas.
// Por omissão segue o sistema; a escolha manual fica guardada e ganha.

const CHAVE = 'dc.tema';

export function temaGuardado() {
  try { return localStorage.getItem(CHAVE); } catch (_) { return null; }
}

export function aplicarTema() {
  const t = temaGuardado();
  if (t === 'claro' || t === 'escuro') {
    document.documentElement.setAttribute('data-tema', t);
  } else {
    document.documentElement.removeAttribute('data-tema');
  }
  corDaBarra();
}

export function temaEfetivo() {
  const t = temaGuardado();
  if (t === 'claro' || t === 'escuro') return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}

export function alternarTema() {
  const novo = temaEfetivo() === 'escuro' ? 'claro' : 'escuro';
  try { localStorage.setItem(CHAVE, novo); } catch (_) {}
  aplicarTema();
  return novo;
}

// A barra de estado do iOS tem de acompanhar o fundo, senão fica um risco
// branco no topo da app instalada.
function corDaBarra() {
  const cor = temaEfetivo() === 'escuro' ? '#04060A' : '#E6E8EB';
  let m = document.querySelector('meta[name="theme-color"]');
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  m.content = cor;
}

/** Desenha o ícone certo (sol no escuro, lua no claro) dentro de um botão. */
export function desenharIconeTema(botao) {
  const escuro = temaEfetivo() === 'escuro';
  botao.setAttribute('aria-label', escuro ? 'Mudar para modo claro' : 'Mudar para modo escuro');
  botao.innerHTML = escuro
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.4A8.2 8.2 0 0 1 9.6 4 8.4 8.4 0 1 0 20 14.4z"/></svg>';
}

// Aplica antes de a página pintar, para não haver um salto de cor.
aplicarTema();
