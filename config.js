// config.js — definições públicas da Restam.
// Só entram aqui valores que podem ser públicos num repositório público

export const CONFIG = {
  // Supabase
  SUPABASE_URL: 'https://dmjoafdbrgtrbpuqunwu.supabase.co',

  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_k8f6LgMyxqkdQ41BbZoqdw_7tTQkkO9',

  // Para onde o Google devolve o utilizador depois do login.
  //
  // IMPORTANTE: este valor tem de estar, LETRA POR LETRA, na lista
  // Supabase → Authentication → URL Configuration → Redirect URLs.
  // Nunca uses wildcards (https://*.pages.dev/**) nessa lista: qualquer
  // pessoa pode criar um projeto .pages.dev e passaria a receber tokens
  // de login dos teus utilizadores. Só URLs exactos.
  //
  // Durante a mudança de alojamento a app vive em dois sítios. O endereço de
  // regresso escolhe-se pelo sítio onde a página está aberta, mas só entre
  // os desta lista fechada: um sítio que não esteja aqui cai no endereço
  // final, nunca num endereço construído a partir da barra do browser.
  REDIRECT_TO: ({
    'https://hgril0.github.io': 'https://hgril0.github.io/DeficitCalc/',
    'https://restam.pages.dev': 'https://restam.pages.dev/',
  })[globalThis.location?.origin] || 'https://restam.pages.dev/',

  // muda para 'implicit' e volta a testar.
  FLOW_TYPE: 'pkce',

  // Regra de sessão (ver nota: imposta pelo cliente, não pelo servidor)
  SESSAO_DIAS_INATIVIDADE: 30, // renovado a cada abertura
  SESSAO_DIAS_MAXIMO: 60,      // limite absoluto desde o login

  // Painel de diagnóstico no ecrã. Põe false quando já não precisares.
  DEBUG: true,
};