// Guarda de entrada partilhada por todas as páginas da app menos a de login.
// A regra de quem pode ver uma página vive só aqui: se andar copiada por
// várias páginas, mais cedo ou mais tarde uma delas fica para trás.
//
// Isto NÃO é a segurança dos dados — essa está nas políticas da base de dados,
// que não confiam em nada que venha do browser. Isto é só para a pessoa ver o
// ecrã certo em vez de uma página partida.

import { CONFIG } from './config.js';

const FONTES = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/+esm',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'https://esm.sh/@supabase/supabase-js@2.112.4',
];

async function carregarBiblioteca() {
  let ultimo = null;
  for (const url of FONTES) {
    try {
      const mod = await import(url);
      if (mod && mod.createClient) return mod.createClient;
    } catch (e) { ultimo = e; }
  }
  throw new Error('Não foi possível carregar a biblioteca do Supabase. '
    + 'Verifica a ligação à internet. ' + (ultimo && ultimo.message ? ultimo.message : ''));
}

function armazenamento() {
  const manter = localStorage.getItem('dc.sessao.manter') !== '0';
  const store = manter ? localStorage : sessionStorage;
  const ehVerifier = (k) => String(k).includes('code-verifier');
  return {
    getItem:    (k) => (ehVerifier(k) ? localStorage : store).getItem(k),
    setItem:    (k, v) => (ehVerifier(k) ? localStorage : store).setItem(k, v),
    removeItem: (k) => (ehVerifier(k) ? localStorage : store).removeItem(k),
  };
}

/**
 * Devolve { supabase, sessao, perfil } para uma página interna.
 * Reencaminha para a entrada se não houver sessão ou se a conta não estiver
 * aprovada, e nesse caso nunca chega a devolver nada.
 */
export async function exigirSessao() {
  const createClient = await carregarBiblioteca();

  const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      flowType: CONFIG.FLOW_TYPE,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // o regresso do Google é tratado só na entrada
      storage: armazenamento(),
      storageKey: 'dc.auth',
    },
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const sessao = data?.session || null;
  if (!sessao) { location.replace('./'); return new Promise(() => {}); }

  const { data: perfil, error: erroPerfil } = await supabase
    .from('profiles')
    .select('nome, email, aprovado, admin, sexo, data_nascimento, altura_cm, nivel_atividade, objetivo_kg_semana')
    .maybeSingle();

  // Sem perfil legível não há como saber se a pessoa pode estar aqui.
  // Na dúvida, volta à entrada, que sabe explicar a situação.
  if (erroPerfil || !perfil || perfil.aprovado !== true) {
    location.replace('./');
    return new Promise(() => {});
  }

  return { supabase, sessao, perfil };
}

export function dataPT(ms) {
  return new Date(ms).toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function textoErro(e) {
  if (!e) return 'Erro desconhecido.';
  if (typeof e === 'string') return e;
  const p = [];
  if (e.name) p.push(e.name);
  if (e.message) p.push(e.message);
  return p.length ? p.join(': ') : String(e);
}
