// Bateria de produção. Colar na consola da app (sessão da PRIMEIRA conta) e
// correr:  await suite()
// Antes: plantar.sql. Depois: limpar.sql.
async function suite() {
  const API = 'https://dmjoafdbrgtrbpuqunwu.supabase.co', KEY = 'sb_publishable_k8f6LgMyxqkdQ41BbZoqdw_7tTQkkO9';
  const FN = API + '/functions/v1/alimentos';
  const TOK = JSON.parse(localStorage.getItem('dc.auth')).access_token;
  const EU = JSON.parse(atob(TOK.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub;
  const OUTRO = '2f92c1ce-b786-4f87-82e7-59bef040def5';
  const MREG = '7e570000-0000-0000-0000-00000000a001', MCAT = '7e570000-0000-0000-0000-00000000a003';
  async function req(metodo, caminho, corpo, { token = TOK, extra = {}, url = API + caminho } = {}) {
    const h = { apikey: KEY, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra };
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    if (token) h.Authorization = 'Bearer ' + token;
    const r = await fetch(url, { method: metodo, headers: h, credentials: 'omit', body: corpo == null ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {}
    return { s: r.status, t, j };
  }
  const negado = (r) => r.s >= 400, vazio = (r) => r.s < 300 && (r.t.trim() === '[]' || r.t.trim() === ''), ok2 = (r) => r.s >= 200 && r.s < 300;
  const res = [];
  async function T(nome, p, esp) { const r = await p; res.push(`${esp(r) ? 'PASSA' : '>>> FALHA'} | ${nome} | ${r.s} ${r.t.replace(/\s+/g, ' ').slice(0, 70)}`); return r; }
  const up = { extra: { Prefer: 'resolution=merge-duplicates,return=representation' } };
  const [h, p, s] = TOK.split('.'); const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const pl = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));

  // dados de outra pessoa
  await T('L1 registos de outra conta', req('GET', `/rest/v1/registos?id=eq.${MREG}`), vazio);
  await T('L2 pesos de outra conta', req('GET', `/rest/v1/pesos?utilizador_id=eq.${OUTRO}`), vazio);
  await T('L3 alimentos pessoais de outra conta', req('GET', `/rest/v1/alimentos_meus?utilizador_id=eq.${OUTRO}`), vazio);
  await T('L4 só o próprio perfil', req('GET', '/rest/v1/profiles?select=id'), (r) => r.s === 200 && r.j.length === 1 && r.j[0].id === EU);
  await T('L5 lista de convidados', req('GET', '/rest/v1/autorizados'), negado);
  await T('M1 alterar registo alheio', req('PATCH', `/rest/v1/registos?id=eq.${MREG}`, { kcal: 1 }), vazio);
  await T('M2 apagar registo alheio', req('DELETE', `/rest/v1/registos?id=eq.${MREG}`), vazio);
  await T('M3 apagar pesos alheios', req('DELETE', `/rest/v1/pesos?utilizador_id=eq.${OUTRO}`), vazio);
  await T('M4 registo em nome de outra', req('POST', '/rest/v1/registos', { utilizador_id: OUTRO, refeicao: 'almoco', kcal: 5 }), negado);
  await T('M5 peso em nome de outra', req('POST', '/rest/v1/pesos', { utilizador_id: OUTRO, kg: 50, medido_em: '2026-10-02' }), negado);
  await T('M6 upsert por cima do peso alheio', req('POST', '/rest/v1/pesos?on_conflict=utilizador_id,medido_em', { utilizador_id: OUTRO, kg: 1, medido_em: '2026-10-01' }, up), negado);
  await T('M7 alterar perfil alheio', req('PATCH', `/rest/v1/profiles?id=eq.${OUTRO}`, { nome: 'x' }), vazio);
  // subir de privilégios
  await T('P1 coluna admin', req('PATCH', `/rest/v1/profiles?id=eq.${EU}`, { admin: true }), negado);
  await T('P2 coluna aprovado', req('PATCH', `/rest/v1/profiles?id=eq.${EU}`, { aprovado: true }), negado);
  await T('P3 próprio id', req('PATCH', `/rest/v1/profiles?id=eq.${EU}`, { id: OUTRO }), negado);
  await T('P4 criar perfil por upsert', req('POST', '/rest/v1/profiles', { id: EU, admin: true, aprovado: true }, up), negado);
  await T('P5 entrar na lista de convidados', req('POST', '/rest/v1/autorizados', { email: 'atacante@exemplo.com' }), negado);
  await T('P6 passar registo para outra conta', req('PATCH', `/rest/v1/registos?utilizador_id=eq.${EU}`, { utilizador_id: OUTRO }), negado);
  await T('P7 escrever no registo de uso', req('POST', '/rest/v1/uso_funcoes', { utilizador_id: EU, funcao: 'x' }), negado);
  await T('P8 chamar a escrita do servidor no catálogo', req('POST', '/rest/v1/rpc/guardar_alimento_off', { p_codigo: '4006381333931', p_nome: 'Veneno', p_marca: null, p_kcal: 1, p_proteina: null, p_hidratos: null, p_gordura: null, p_gramas_unidade: null, p_nome_unidade: null }), negado);
  await T('P9 mexer no contador de uso', req('POST', '/rest/v1/rpc/registar_uso', { p_utilizador: EU, p_funcao: 'x' }), negado);
  // catálogo
  await T('C1 lê o catálogo', req('GET', `/rest/v1/alimentos?id=eq.${MCAT}&select=nome`), (r) => r.s === 200 && r.t.includes('MARCADOR'));
  await T('C2 escrever no catálogo', req('POST', '/rest/v1/alimentos', { nome: 'Veneno', kcal_100: 1, fonte: 'insa' }), negado);
  await T('C3 alterar o catálogo', req('PATCH', `/rest/v1/alimentos?id=eq.${MCAT}`, { kcal_100: 1 }), negado);
  await T('C4 apagar do catálogo', req('DELETE', `/rest/v1/alimentos?id=eq.${MCAT}`), negado);
  // funções
  await T('F1 gasto de outra conta (perfil preenchido)', req('POST', '/rest/v1/rpc/estimar_gasto', { p_id: OUTRO }), vazio);
  await T('F2 pesquisa sem alimentos alheios', req('POST', '/rest/v1/rpc/procurar_alimento', { p_texto: 'MARCADOR' }), (r) => r.s === 200 && r.t.includes('catalogo teste') && !r.t.includes('MARCADOR-TESTE-SEGURANCA'));
  await T('F3 função do trigger de perfis', req('POST', '/rest/v1/rpc/criar_perfil_novo_utilizador', {}), negado);
  await T('F4 função do trigger de datas', req('POST', '/rest/v1/rpc/marcar_atualizacao', {}), negado);
  // plataforma
  await T('X1 API de administração', req('GET', '/auth/v1/admin/users'), negado);
  await T('X2 token adulterado', req('GET', '/rest/v1/profiles?select=id', null, { token: `${h}.${enc({ ...pl, sub: OUTRO })}.${s}` }), negado);
  await T('X3 token alg none', req('GET', '/rest/v1/profiles?select=id', null, { token: `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ ...pl, sub: OUTRO })}.` }), negado);
  await T('X4 token service_role forjado', req('GET', '/rest/v1/autorizados', null, { token: `${h}.${enc({ ...pl, role: 'service_role' })}.${s}` }), negado);
  for (const t of ['profiles', 'registos', 'pesos', 'alimentos', 'alimentos_meus', 'autorizados', 'uso_funcoes'])
    await T(`A anónimo lê ${t}`, req('GET', `/rest/v1/${t}?select=*`, null, { token: null }), negado);
  for (const f of ['estimar_gasto', 'dia', 'ultimos_dias', 'procurar_alimento', 'alimento_por_codigo', 'esta_aprovado'])
    await T(`A anónimo chama ${f}`, req('POST', `/rest/v1/rpc/${f}`, {}, { token: null }), negado);
  // função alimentos
  // Sem o cabeçalho Prefer: a função só autoriza os cabeçalhos que o
  // supabase-js manda (apikey, authorization, content-type, x-client-info).
  const fn = (corpo, o = {}) => req('POST', '', corpo, { ...o, url: FN, extra: { Prefer: undefined } });
  await T('E1 função sem sessão', fn({ acao: 'codigo', codigo: '3017620422003' }, { token: null }), (r) => r.s === 401);
  await T('E2 função só com a chave pública', fn({ acao: 'codigo', codigo: '3017620422003' }, { token: KEY }), (r) => r.s === 401);
  await T('E3 função com token adulterado', fn({ acao: 'codigo', codigo: '3017620422003' }, { token: `${h}.${enc({ ...pl, sub: OUTRO })}.${s}` }), (r) => r.s === 401);
  await T('E4 código inválido', fn({ acao: 'codigo', codigo: "1'; drop table x;--" }), (r) => r.s === 400);
  await T('E5 ação inventada', fn({ acao: 'apagar' }), (r) => r.s === 400);
  await T('E6 corpo gigante', fn('{"x":"' + 'a'.repeat(4000) + '"}'), (r) => r.s === 413);
  await T('E7 lê um código real', fn({ acao: 'codigo', codigo: '3017620422003' }), (r) => r.s === 200 && r.j?.alimento?.kcal_100 > 0);
  await T('E8 pesquisa por texto', fn({ acao: 'procurar', texto: 'iogurte natural' }), (r) => r.s === 200 && Array.isArray(r.j?.candidatos));
  await T('E9 operadores de pesquisa não rebentam nada', fn({ acao: 'procurar', texto: 'arroz OR *:*' }), (r) => r.s === 200);
  // tabela do INSA (12-insa.sql e 13-insa-dados.sql)
  const pa = (p_texto, extra = {}) => req('POST', '/rest/v1/rpc/procurar_alimento', { p_texto, ...extra });
  await T('I1 "acucar" sem acento encontra o açúcar do INSA', pa('acucar'), (r) => r.s === 200 && (r.j || []).some((x) => x.nome === 'Açúcar branco' && x.fonte === 'insa'));
  await T('I2 cerveja vem marcada por ml', pa('cerveja branca'), (r) => r.s === 200 && r.j?.[0]?.por_ml === true);
  await T('I3 "arroz pato" encontra Arroz de pato', pa('arroz pato'), (r) => r.s === 200 && (r.j || []).some((x) => x.nome === 'Arroz de pato'));
  await T('I4 pesquisa por palavras não mostra o alimento alheio', pa('seguranca marcador teste'), (r) => r.s === 200 && !r.t.includes('MARCADOR-TESTE-SEGURANCA'));
  await T('I5 "%%" não é curinga', pa('%%'), vazio);
  await T('I6 máximo 50 resultados', pa('a e', { p_limite: 999 }), (r) => r.s === 200 && r.j?.length === 50);
  await T('I7 9 palavras não varrem o catálogo', pa('a b c d e f g h i'), vazio);
  await T('I8 alterar valor do INSA', req('PATCH', '/rest/v1/alimentos?codigo_insa=eq.624', { kcal_100: 1 }), negado);
  await T('I9 mudar por_ml', req('PATCH', '/rest/v1/alimentos?codigo_insa=eq.726', { por_ml: false }), negado);
  await T('I10 inserir como se fosse do INSA', req('POST', '/rest/v1/alimentos', { nome: 'Veneno', kcal_100: 1, fonte: 'insa', codigo_insa: '99999' }), negado);
  await T('I11 apagar o INSA', req('DELETE', '/rest/v1/alimentos?fonte=eq.insa'), negado);
  await T('I12 o abacate continua com 176 kcal', req('GET', '/rest/v1/alimentos?codigo_insa=eq.624&select=kcal_100'), (r) => r.s === 200 && Number(r.j?.[0]?.kcal_100) === 176);
  await T('I13 anónimo não lê o INSA', req('GET', '/rest/v1/alimentos?fonte=eq.insa&select=nome', null, { token: null }), negado);
  await T('I14 anónimo não pesquisa', req('POST', '/rest/v1/rpc/procurar_alimento', { p_texto: 'arroz' }, { token: null }), negado);
  // uso legítimo
  let r = await T('G1 cria registo', req('POST', '/rest/v1/registos', { refeicao: 'lanche', descricao: 'TESTE-LEGITIMO', kcal: 42 }), (r) => r.s === 201 && r.t.includes(EU));
  const id = r.j?.[0]?.id;
  await T('G2 altera registo', req('PATCH', `/rest/v1/registos?id=eq.${id}`, { kcal: 43, gramas: 50 }), (r) => r.s === 200 && r.t.includes('43'));
  await T('G3 dia() vê o registo', req('POST', '/rest/v1/rpc/dia', {}), (r) => r.s === 200 && r.t.includes('lanche'));
  await T('G4 apaga registo', req('DELETE', `/rest/v1/registos?id=eq.${id}`), (r) => r.s === 200 && r.t.includes(id));
  await T('G5 grava peso (perfil.html)', req('POST', '/rest/v1/pesos?on_conflict=utilizador_id,medido_em', { kg: 80.1, medido_em: '2026-10-03' }, up), ok2);
  await T('G6 corrige peso no mesmo dia', req('POST', '/rest/v1/pesos?on_conflict=utilizador_id,medido_em', { kg: 80.3, medido_em: '2026-10-03' }, up), (r) => ok2(r) && r.t.includes('80.3'));
  await T('G7 apaga peso de teste', req('DELETE', `/rest/v1/pesos?utilizador_id=eq.${EU}&medido_em=eq.2026-10-03`), ok2);
  r = await T('G8 alimento pessoal sem dono explícito', req('POST', '/rest/v1/alimentos_meus', { nome: 'TESTE-LEGITIMO', kcal_100: 100 }), (r) => r.s === 201 && r.t.includes(EU));
  await T('G9 pesquisa encontra o meu', req('POST', '/rest/v1/rpc/procurar_alimento', { p_texto: 'TESTE-LEG' }), (r) => r.s === 200 && r.t.includes('"meu":true'));
  await T('G10 apaga alimento pessoal', req('DELETE', `/rest/v1/alimentos_meus?id=eq.${r.j?.[0]?.id}`), ok2);
  // receitas (passo 8)
  const RA = '7e570000-0000-0000-0000-00000000b001', IA = '7e570000-0000-0000-0000-00000000b002', AMA = '7e570000-0000-0000-0000-00000000b003';
  await T('R1 receita alheia', req('GET', `/rest/v1/receitas?id=eq.${RA}`), vazio);
  await T('R2 ingredientes alheios', req('GET', `/rest/v1/receita_ingredientes?receita_id=eq.${RA}`), vazio);
  await T('R3 meter ingrediente na receita alheia', req('POST', '/rest/v1/receita_ingredientes', { receita_id: RA, nome: 'Sal a mais', kcal_100: 0, gramas: 9999 }), negado);
  await T('R4 alterar receita alheia', req('PATCH', `/rest/v1/receitas?id=eq.${RA}`, { porcoes: 1 }), vazio);
  await T('R5 apagar receita alheia', req('DELETE', `/rest/v1/receitas?id=eq.${RA}`), vazio);
  await T('R6 apagar ingrediente alheio', req('DELETE', `/rest/v1/receita_ingredientes?id=eq.${IA}`), vazio);
  await T('R7 resumo sem receitas alheias', req('POST', '/rest/v1/rpc/receitas_resumo', {}), (r) => r.s === 200 && !r.t.includes('MARCADOR'));
  await T('R8 anónimo lê receitas', req('GET', '/rest/v1/receitas?select=*', null, { token: null }), negado);
  r = await T('R9 cria receita minha', req('POST', '/rest/v1/receitas', { nome: 'TESTE receita', porcoes: 4, peso_final_g: 800 }), (r) => r.s === 201 && r.t.includes(EU));
  const RM = r.j?.[0]?.id;
  r = await T('R10 junta ingredientes', req('POST', '/rest/v1/receita_ingredientes', [{ receita_id: RM, nome: 'Arroz cru', kcal_100: 350, gramas: 200 }, { receita_id: RM, nome: 'Azeite', kcal_100: 884, gramas: 30 }]), (r) => r.s === 201 && r.j?.length === 2);
  const IM = r.j?.[1]?.id;
  await T('R11 resumo 965 / 241 / 120.7', req('POST', '/rest/v1/rpc/receitas_resumo', {}), (r) => { const x = (r.j || []).find((x) => x.id === RM); return x && x.kcal_total === 965 && x.kcal_porcao === 241 && Number(x.kcal_100_final) === 120.7; });
  await T('R12 mover ingrediente para receita alheia', req('PATCH', `/rest/v1/receita_ingredientes?id=eq.${IM}`, { receita_id: RA }), negado);
  await T('R13 ligar ao alimento pessoal alheio', req('POST', '/rest/v1/receita_ingredientes', { receita_id: RM, nome: 'Molho', kcal_100: 300, gramas: 10, alimento_meu_id: AMA }), negado);
  await T('R14 passar a receita para outra conta', req('PATCH', `/rest/v1/receitas?id=eq.${RM}`, { utilizador_id: OUTRO }), negado);
  await T('R15 apaga a receita de teste', req('DELETE', `/rest/v1/receitas?id=eq.${RM}`), ok2);
  const falhas = res.filter((x) => x.startsWith('>>>'));
  console.log(res.join('\n'));
  return `TOTAL ${res.length - falhas.length}/${res.length}` + (falhas.length ? '\n' + falhas.join('\n') : '');
}
