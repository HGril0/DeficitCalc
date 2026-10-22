import { CONFIG } from './config.js';

const DIA = 86400000;
const K_INICIO = 'dc.sessao.inicio';
const K_VISTO  = 'dc.sessao.visto';
const K_MANTER = 'dc.sessao.manter';

const $ = (id) => document.getElementById(id);
const cartao = $('cartao');

let supabase = null;
let estadoPerfil = { lido: false };
const manterSessao = localStorage.getItem(K_MANTER) !== '0';
const store = manterSessao ? localStorage : sessionStorage;

// ---------- erros à vista, que no iPhone não há consola ----------
function textoErro(e) {
  if (!e) return 'Erro desconhecido.';
  if (typeof e === 'string') {
    return e === 'Script error.'
      ? 'Script error. (erro vindo de código externo; o detalhe foi escondido pelo browser)'
      : e;
  }
  const p = [];
  if (e.name) p.push(e.name);
  if (e.message) p.push(e.message);
  if (e.status) p.push('estado HTTP ' + e.status);
  return p.length ? p.join(': ') : String(e);
}
function mostrarErro(e) {
  const cx = $('erro');
  cx.classList.remove('oculto');
  cx.textContent = (cx.textContent ? cx.textContent + '\n\n' : '') + textoErro(e);
}
window.addEventListener('error', (ev) => mostrarErro(ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => mostrarErro(ev.reason));

function dataPT(ms) {
  return new Date(ms).toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ---------- sessão: 30 dias renovados, 60 no máximo ----------
function limiteUltrapassado() {
  const agora = Date.now();
  const inicio = Number(store.getItem(K_INICIO) || 0);
  const visto = Number(store.getItem(K_VISTO) || 0);
  if (inicio && agora - inicio > CONFIG.SESSAO_DIAS_MAXIMO * DIA) return 'maximo';
  if (visto && agora - visto > CONFIG.SESSAO_DIAS_INATIVIDADE * DIA) return 'inatividade';
  return null;
}
function marcarAbertura(novoLogin) {
  const agora = Date.now();
  if (novoLogin || !store.getItem(K_INICIO)) store.setItem(K_INICIO, String(agora));
  store.setItem(K_VISTO, String(agora));
}
function limparMarcas() { store.removeItem(K_INICIO); store.removeItem(K_VISTO); }

// Os "code verifier" de logins anteriores são segredos de curta duração.
// Não há razão para ficarem lá depois de a sessão estar criada.
function limparVerifiersAntigos() {
  for (const k of Object.keys(localStorage)) {
    if (k.includes('code-verifier')) localStorage.removeItem(k);
  }
}

// ---------- ecrãs ----------
function ecra(id) { cartao.replaceChildren($(id).content.cloneNode(true)); }

function mostrarEntrada(mensagem, desativado) {
  ecra('t-entrada');
  $('chk-manter').checked = manterSessao;
  if (mensagem) {
    const p = document.createElement('p');
    p.className = 'sub';
    p.style.margin = '16px 0 0';
    p.textContent = mensagem;
    cartao.append(p);
  }
  if (desativado) $('btn-entrar').disabled = true;
  else $('btn-entrar').addEventListener('click', entrar);
  $('chk-manter').addEventListener('change', (ev) => {
    localStorage.setItem(K_MANTER, ev.target.checked ? '1' : '0');
  });
}

function mostrarEspera(user) {
  ecra('t-espera');
  const m = user.user_metadata || {};
  $('nome').textContent = m.full_name || m.name || (user.email || '').split('@')[0];
  $('email').textContent = user.email || '';
  const foto = m.avatar_url || m.picture;
  if (foto) $('avatar').src = foto; else $('avatar').remove();
  $('espera-texto').textContent =
    'A tua conta ainda não foi autorizada. Entraste com o Google, mas falta alguém dar-te '
    + 'acesso à app. Quando isso acontecer, é só voltar a abrir — não precisas de entrar outra vez.';
  $('btn-sair').addEventListener('click', sair);
}

// ---------- ações ----------
async function entrar() {
  const btn = $('btn-entrar');
  btn.disabled = true;
  try {
    localStorage.setItem(K_MANTER, $('chk-manter').checked ? '1' : '0');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: CONFIG.REDIRECT_TO, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw error;
    setTimeout(() => {
      if (!document.hidden) {
        btn.disabled = false;
        mostrarErro('O reencaminhamento para o Google não aconteceu. Confirma no Supabase que '
          + CONFIG.REDIRECT_TO + ' está em Redirect URLs.');
      }
    }, 4000);
  } catch (e) {
    btn.disabled = false;
    mostrarErro(e);
  }
}

async function sair() {
  $('btn-sair').disabled = true;
  try { await supabase.auth.signOut(); } catch (e) { mostrarErro(e); }
  limparMarcas();
  limparVerifiersAntigos();
  mostrarEntrada();
  diagnostico(null);
}

// ---------- diagnóstico ----------
function modoApresentacao() {
  if (window.navigator.standalone === true) return 'instalada (iOS)';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'instalada';
  return 'browser';
}
function diagnostico(session) {
  const d = $('diag');
  if (!CONFIG.DEBUG) { d.classList.add('oculto'); return; }
  d.classList.remove('oculto');
  const chave = (CONFIG.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const inicio = Number(store.getItem(K_INICIO) || 0);
  const visto = Number(store.getItem(K_VISTO) || 0);
  const linhas = [
    `<b>Modo:</b> ${modoApresentacao()}`,
    `<b>Fluxo:</b> ${CONFIG.FLOW_TYPE}`,
    `<b>Armazenamento:</b> ${manterSessao ? 'localStorage' : 'sessionStorage'}`,
    `<b>Chave:</b> ${chave.slice(0, 15)}… (${chave.length} caracteres)`,
    `<b>Biblioteca:</b> ${window.supabase ? 'supabase-js 2.112.4 (verificada)' : 'não carregada'}`,
    `<b>Sessão Supabase:</b> ${session ? 'ativa' : 'nenhuma'}`,
    session ? `<b>Perfil:</b> ${estadoPerfil.lido ? (estadoPerfil.aprovado ? 'aprovado' : 'à espera') : 'não lido (' + (estadoPerfil.motivo || '?') + ')'}` : '',
    session ? `<b>Token expira:</b> ${dataPT(session.expires_at * 1000)}` : '',
    inicio ? `<b>Login em:</b> ${dataPT(inicio)}` : '',
    visto ? `<b>Última abertura:</b> ${dataPT(visto)}` : '',
  ].filter(Boolean);
  // Montado com nós de texto: os valores podem trazer mensagens do servidor.
  d.replaceChildren(...linhas.flatMap((l, i) => {
    const [, rotulo, valor] = l.match(/^<b>(.*?)<\/b>\s?(.*)$/s) || [, '', l];
    const b = document.createElement('b'); b.textContent = rotulo;
    return [...(i ? [document.createElement('br')] : []), b, ' ' + valor];
  }));
}

// ---------- biblioteca ----------
// A biblioteca do Supabase é carregada no <head> por um <script> com
// impressão digital (integrity). Se o servidor entregar um ficheiro diferente
// do publicado, o browser recusa-o e window.supabase fica vazio.
async function carregarBiblioteca() {
  const lib = window.supabase;
  if (lib && typeof lib.createClient === 'function') return lib.createClient;
  throw new Error('Não foi possível carregar a biblioteca do Supabase. Verifica a ligação '
    + 'à internet. Se persistir, o ficheiro recebido não corresponde à versão esperada '
    + 'e foi bloqueado por segurança.');
}

async function lerPerfil() {
  try {
    const { data, error } = await supabase.from('profiles').select('nome, aprovado').maybeSingle();
    if (error) return { lido: false, motivo: error.message };
    if (!data) return { lido: false, motivo: 'sem linha em profiles' };
    return { lido: true, aprovado: data.aprovado === true };
  } catch (e) {
    return { lido: false, motivo: (e && e.message) ? e.message : String(e) };
  }
}

// O ecrã de espera é cortesia, não é segurança: quem manda é a RLS. Por isso,
// se a leitura falhar, deixamos entrar e anotamos — trancar a porta por um
// erro de configuração não protegia nada e bloqueava o próprio dono.
async function encaminhar(session) {
  estadoPerfil = await lerPerfil();
  if (estadoPerfil.lido && !estadoPerfil.aprovado) {
    mostrarEspera(session.user);
    diagnostico(session);
    return;
  }
  location.replace('hoje.html');
}

// ---------- arranque ----------
async function principal() {
  const chave = (CONFIG.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const chaveOk = /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(chave)
               || /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(chave);
  if (!chaveOk) {
    mostrarErro('Falta a chave publicável. Abre o config.js e substitui o valor de '
      + 'SUPABASE_PUBLISHABLE_KEY pela chave do painel do Supabase (Settings → API Keys), '
      + 'que começa por sb_publishable_. Valor atual: "' + (chave.slice(0, 20) || '(vazio)') + '…"');
    mostrarEntrada('Configuração incompleta.', true);
    diagnostico(null);
    return;
  }

  const createClient = await carregarBiblioteca();

  // O "code verifier" do PKCE é escrito antes de sair para o Google e lido no
  // regresso. Se a caixa "manter sessão" mudar nesse intervalo, o
  // armazenamento mudava e o verifier desaparecia — por isso fica sempre em
  // localStorage; só a sessão respeita a escolha.
  const ehVerifier = (k) => String(k).includes('code-verifier');
  const armazenamento = {
    getItem:    (k) => (ehVerifier(k) ? localStorage : store).getItem(k),
    setItem:    (k, v) => (ehVerifier(k) ? localStorage : store).setItem(k, v),
    removeItem: (k) => (ehVerifier(k) ? localStorage : store).removeItem(k),
  };

  supabase = createClient(CONFIG.SUPABASE_URL, chave, {
    auth: {
      flowType: CONFIG.FLOW_TYPE,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: armazenamento,
      storageKey: 'dc.auth',
    },
  });

  supabase.auth.onAuthStateChange(async (evento, session) => {
    if (evento === 'SIGNED_IN' && session) {
      limparVerifiersAntigos();
      marcarAbertura(!store.getItem(K_INICIO));
      encaminhar(session).catch(mostrarErro);
    }
    if (evento === 'SIGNED_OUT') { mostrarEntrada(); diagnostico(null); }
  });

  const params = new URLSearchParams(location.search || location.hash.replace('#', '?'));
  const erroUrl = params.get('error_description') || params.get('error');
  if (erroUrl) mostrarErro('Erro de autenticação: ' + erroUrl);

  const veioDoLogin = /[?#].*(code=|access_token=)/.test(location.href);

  const { data, error } = await supabase.auth.getSession();
  if (error) mostrarErro(error);
  const session = data?.session || null;

  if (location.search || location.hash) history.replaceState({}, '', location.pathname);

  if (session) {
    if (veioDoLogin) {
      limparVerifiersAntigos();
      marcarAbertura(true);
      await encaminhar(session);
      return;
    }
    const limite = limiteUltrapassado();
    if (limite) {
      await supabase.auth.signOut();
      limparMarcas();
      mostrarEntrada(limite === 'maximo'
        ? 'A sessão atingiu o limite de 60 dias. Entra outra vez.'
        : 'A sessão esteve mais de 30 dias sem uso. Entra outra vez.');
      diagnostico(null);
      return;
    }
    marcarAbertura(false);
    await encaminhar(session);
    return;
  }
  mostrarEntrada();
  diagnostico(session);
}

principal().catch((e) => {
  mostrarErro(e);
  try { mostrarEntrada('Não foi possível arrancar.', true); diagnostico(null); } catch (_) {}
});
