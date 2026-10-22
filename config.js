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
  // Durante a mudança de alojamento, mantém os dois URLs na lista do
  // Supabase e muda só esta linha para testar cada um.
  // Antigo (GitHub Pages, a desligar): 'https://hgril0.github.io/DeficitCalc/'
  REDIRECT_TO: 'https://restam.pages.dev/',

  // muda para 'implicit' e volta a testar.
  FLOW_TYPE: 'pkce',

  // Regra de sessão (ver nota: imposta pelo cliente, não pelo servidor)
  SESSAO_DIAS_INATIVIDADE: 30, // renovado a cada abertura
  SESSAO_DIAS_MAXIMO: 60,      // limite absoluto desde o login

  // Painel de diagnóstico no ecrã. Põe false quando já não precisares.
  DEBUG: true,
};