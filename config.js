// config.js — definições públicas do DeficitCalc.
// Só entram aqui valores que podem ser públicos num repositório público.
// A chave secret / service_role NUNCA entra neste ficheiro.
// Chaves de APIs de IA NUNCA entram neste ficheiro (só em Edge Functions).

export const CONFIG = {
  // Supabase
  SUPABASE_URL: 'https://dmjoafdbrgtrbpuqunwu.supabase.co',

  // Cola aqui a chave publicável do painel (Settings → API Keys), começa por sb_publishable_
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_k8f6LgMyxqkdQ41BbZoqdw_7tTQkkO9',

  // Para onde o Google devolve depois do login. Tem de estar em
  // Supabase → Authentication → URL Configuration → Redirect URLs
  REDIRECT_TO: 'https://hgril0.github.io/DeficitCalc/',

  // 'pkce' é o correto e o predefinido.
  // Se na app instalada no ecrã principal aparecer erro de "code verifier",
  // muda para 'implicit' e volta a testar.
  FLOW_TYPE: 'pkce',

  // Regra de sessão (ver nota: imposta pelo cliente, não pelo servidor)
  SESSAO_DIAS_INATIVIDADE: 30, // renovado a cada abertura
  SESSAO_DIAS_MAXIMO: 60,      // limite absoluto desde o login

  // Painel de diagnóstico no ecrã. Põe false quando já não precisares.
  DEBUG: true,
};