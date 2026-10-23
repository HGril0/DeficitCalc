// Substituto da biblioteca do Supabase, só para os testes do ecrã.
// Guarda tudo em memória e imita as regras da base de dados que já nos
// apanharam: um upsert/update que toque numa coluna sem permissão falha com
// 42501, como no PostgreSQL. Foi assim que o ecrã de perfil falhou em produção.
(function () {
  const EU = 'aaaaaaaa-0000-0000-0000-000000000001';
  const PODE_ALTERAR = {
    profiles: ['nome', 'avatar_url', 'fuso', 'sexo', 'data_nascimento', 'altura_cm', 'nivel_atividade', 'objetivo_kg_semana'],
    pesos: ['kg', 'medido_em'],
    registos: ['data', 'refeicao', 'descricao', 'kcal', 'nao_comi', 'fonte', 'estimativa', 'gramas', 'alimento_id'],
    alimentos_meus: ['nome', 'kcal_100', 'gramas_unidade', 'nome_unidade'],
    receitas: ['nome', 'porcoes', 'peso_final_g', 'notas'],
    receita_ingredientes: ['nome', 'kcal_100', 'gramas', 'alimento_id', 'alimento_meu_id', 'ordem'],
  };
  const cenario = window.__CENARIO__ || {};
  const bd = {
    profiles: [{ id: EU, email: 'ana@exemplo.com', nome: 'Ana', aprovado: cenario.aprovado !== false, admin: false,
                 sexo: null, data_nascimento: null, altura_cm: null, nivel_atividade: null, objetivo_kg_semana: null }],
    pesos: [], registos: cenario.registos || [], alimentos: cenario.alimentos || [], alimentos_meus: [],
    receitas: cenario.receitas || [], receita_ingredientes: cenario.receita_ingredientes || [],
  };
  window.__BD__ = bd;
  window.__PEDIDOS__ = [];
  let n = 0; const id = () => 'id-' + (++n);
  const erro = (code, message) => ({ data: null, error: { code, message } });

  function construtor(tabela) {
    const q = { tabela, modo: 'select', filtros: [], ordem: null, limite: null, um: false, corpo: null, opcoes: {} };
    const api = {
      select() { if (q.modo !== 'select') q.devolver = true; return api; },
      insert(c) { q.modo = 'insert'; q.corpo = c; return api; },
      update(c) { q.modo = 'update'; q.corpo = c; return api; },
      upsert(c, o) { q.modo = 'upsert'; q.corpo = c; q.opcoes = o || {}; return api; },
      delete() { q.modo = 'delete'; return api; },
      eq(k, v) { q.filtros.push([k, v]); return api; },
      in(k, lista) { q.filtrosIn = [...(q.filtrosIn || []), [k, lista.map(String)]]; return api; },
      order(k, o) { q.ordem = [k, (o && o.ascending === false) ? -1 : 1]; return api; },
      limit(x) { q.limite = x; return api; },
      maybeSingle() { q.um = true; return api; },
      single() { q.um = true; return api; },
      then(ok, ko) { return Promise.resolve(executar(q)).then(ok, ko); },
    };
    return api;
  }
  function meus(t) {
    const linhas = bd[t] || [];
    if (t === 'profiles') return linhas.filter(r => r.id === EU);
    if (t === 'alimentos') return linhas;
    return linhas.filter(r => r.utilizador_id === EU);
  }
  function executar(q) {
    window.__PEDIDOS__.push({ tabela: q.tabela, modo: q.modo, corpo: q.corpo });
    const t = q.tabela;
    if (!(t in bd)) return erro('42P01', 'tabela desconhecida ' + t);
    const filtra = (r) => q.filtros.every(([k, v]) => String(r[k]) === String(v))
      && (q.filtrosIn || []).every(([k, l]) => l.includes(String(r[k])));
    if (q.modo === 'select') {
      let r = meus(t).filter(filtra);
      if (q.ordem) r = [...r].sort((a, b) => (a[q.ordem[0]] > b[q.ordem[0]] ? 1 : -1) * q.ordem[1]);
      if (q.limite) r = r.slice(0, q.limite);
      return { data: q.um ? (r[0] || null) : r, error: null };
    }
    if (q.modo === 'insert') {
      if (t === 'profiles' || t === 'alimentos') return erro('42501', 'permission denied for table ' + t);
      const linhas = Array.isArray(q.corpo) ? q.corpo : [q.corpo];
      const novas = [];
      for (const l of linhas) {
        const dono = l.utilizador_id ?? EU;
        if (dono !== EU) return erro('42501', 'new row violates row-level security policy');
        // Como a política verdadeira: o ingrediente só entra numa receita minha.
        if (t === 'receita_ingredientes' && !bd.receitas.some(r => r.id === l.receita_id && r.utilizador_id === EU))
          return erro('42501', 'new row violates row-level security policy for table "receita_ingredientes"');
        if (t === 'receitas' && bd.receitas.some(r => r.utilizador_id === EU && r.nome === l.nome))
          return erro('23505', 'duplicate key value violates unique constraint "receitas_nome_unico"');
        const linha = { id: id(), criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), ...l, utilizador_id: dono };
        bd[t].push(linha); novas.push(linha);
      }
      if (q.devolver) return { data: q.um ? novas[0] : novas, error: null };
      return { data: null, error: null };
    }
    if (q.modo === 'update' || q.modo === 'upsert') {
      const cols = Object.keys(q.corpo);
      const proibidas = cols.filter(c => !(PODE_ALTERAR[t] || []).includes(c));
      if (proibidas.length) return erro('42501', 'permission denied for table ' + t + ' (colunas: ' + proibidas.join(', ') + ')');
      if (q.modo === 'update') {
        if (t === 'receitas' && q.corpo.nome && bd.receitas.some(r => r.utilizador_id === EU && r.nome === q.corpo.nome && !filtra(r)))
          return erro('23505', 'duplicate key value violates unique constraint "receitas_nome_unico"');
        meus(t).filter(filtra).forEach(r => Object.assign(r, q.corpo)); return { data: null, error: null };
      }
      const chave = (q.opcoes.onConflict || 'id').split(',');
      const linha = { utilizador_id: EU, ...q.corpo };
      const existe = meus(t).find(r => chave.every(k => String(r[k]) === String(linha[k])));
      if (existe) Object.assign(existe, q.corpo); else bd[t].push({ id: id(), ...linha });
      return { data: null, error: null };
    }
    if (q.modo === 'delete') {
      const sai = (bd[t] || []).filter(r => meus(t).includes(r) && filtra(r));
      const fica = (bd[t] || []).filter(r => !sai.includes(r));
      bd[t].length = 0; bd[t].push(...fica);
      if (t === 'receitas') { const ids = new Set(sai.map(r => r.id)); const f2 = bd.receita_ingredientes.filter(i => !ids.has(i.receita_id)); bd.receita_ingredientes.length = 0; bd.receita_ingredientes.push(...f2); }
      return { data: null, error: null };
    }
  }
  function rpc(nome, args) {
    window.__PEDIDOS__.push({ rpc: nome, args });
    const p = bd.profiles[0];
    const peso = [...bd.pesos].sort((a, b) => a.medido_em < b.medido_em ? 1 : -1)[0];
    if (nome === 'estimar_gasto') {
      if (!p.sexo || !p.altura_cm || !p.data_nascimento || !p.nivel_atividade || !peso) return { data: [], error: null };
      return { data: [{ gasto_estimado: 2169, gasto_minimo: 1952, gasto_maximo: 2386, kcal_objetivo: 1627,
                        kcal_minimo_seguro: 1200, objetivo_ajustado: false, motivo: null }], error: null };
    }
    if (nome === 'ultimos_dias') {
      const dias = [];
      for (let i = (args?.p_dias || 7) - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
        const kcal = bd.registos.filter(r => r.data === d).reduce((s, r) => s + r.kcal, 0);
        dias.push({ data: d, kcal, completo: false });
      }
      return { data: dias, error: null };
    }
    if (nome === 'receitas_resumo') {
      return { data: bd.receitas.filter(r => r.utilizador_id === EU).map(r => {
        const ing = bd.receita_ingredientes.filter(i => i.receita_id === r.id);
        const tot = ing.reduce((s, i) => s + Number(i.kcal_100) * Number(i.gramas) / 100, 0);
        return { id: r.id, nome: r.nome, porcoes: r.porcoes, peso_final_g: r.peso_final_g ?? null, ingredientes: ing.length,
                 gramas_total: ing.reduce((s, i) => s + Number(i.gramas), 0), kcal_total: Math.round(tot),
                 kcal_porcao: Math.round(tot / Number(r.porcoes)), kcal_100_final: r.peso_final_g ? Math.round(tot * 1000 / r.peso_final_g) / 10 : null };
      }), error: null };
    }
    if (nome === 'procurar_alimento') {
      // Mesmas regras do sql/12-insa.sql: sem acentos, todas as palavras por
      // qualquer ordem, plural simples, o que começa pela pesquisa primeiro.
      const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const t = sem(String(args?.p_texto || '').slice(0, 60)).trim();
      const ws = t.split(/\s+/).filter(Boolean);
      if (t.length < 2 || ws.length > 8) return { data: [], error: null };
      const tem = (n, w) => n.includes(w) || (w.length >= 4 && w.endsWith('s') && n.includes(w.replace(/(oe|ae)s$/, 'aos').replace(/s$/, '')));
      const meus_ = bd.alimentos_meus.map(a => ({ ...a, fonte: 'meu', meu: true, por_ml: false }));
      const cat = bd.alimentos.map(({ codigo_barras, ...a }) => ({ por_ml: false, ...a, meu: false }));  // como o rpc real
      const ordem = (a) => (a.meu ? 0 : { insa: 1, codigo_barras: 2 }[a.fonte] || 3);
      const r = [...meus_, ...cat].filter(a => ws.every(w => tem(sem(a.nome), w)))
        .sort((x, y) => (ordem(x) === 0) !== (ordem(y) === 0) ? ordem(x) - ordem(y)
          : (sem(y.nome).startsWith(t) - sem(x.nome).startsWith(t)) || ordem(x) - ordem(y) || x.nome.length - y.nome.length);
      return { data: r.slice(0, 20), error: null };
    }
    return erro('PGRST202', 'função desconhecida ' + nome);
  }
  const sessao = cenario.semSessao ? null : {
    access_token: 'falso', refresh_token: 'falso', expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: EU, email: 'ana@exemplo.com', user_metadata: { full_name: 'Ana' } },
  };
  window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: sessao }, error: null }; },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          async signInWithOAuth() { window.__OAUTH__ = true; return { data: {}, error: null }; },
          async signOut() { return { error: null }; },
        },
        from: construtor,
        rpc: async (n, a) => rpc(n, a),
        // Imita a função "alimentos" do servidor, incluindo os erros (o
        // supabase-js devolve-os com a resposta em error.context).
        functions: {
          async invoke(nome, o) {
            const corpo = o && o.body;
            window.__PEDIDOS__.push({ funcao: nome, corpo });
            const off = cenario.off || {};
            const falha = (status, obj) => ({ data: null, error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify(obj), { status }) } });
            if (nome === 'receitas-ia') {
              const ia = cenario.ia || {};
              if (ia.estado) return falha(ia.estado, { erro: ia.erro || 'erro', desligado: !!ia.desligado });
              return { data: { receitas: ia.receitas || [], aviso_custo: !!ia.aviso_custo }, error: null };
            }
            if (nome !== 'alimentos') return falha(404, { erro: 'sem função' });
            if (off.estado) return falha(off.estado, { erro: off.erro || 'erro' });
            if (corpo.acao === 'procurar') return { data: { candidatos: off.candidatos || [] }, error: null };
            if (corpo.acao === 'codigo') {
              const a = (off.codigos || {})[corpo.codigo];
              if (!a) return falha(404, { encontrado: false });
              const linha = { id: 'cat-' + corpo.codigo, fonte: 'codigo_barras', codigo_barras: corpo.codigo, ...a };
              if (!bd.alimentos.some(x => x.codigo_barras === corpo.codigo)) bd.alimentos.push(linha);
              return { data: { alimento: linha, origem: 'open_food_facts' }, error: null };
            }
            return falha(400, { erro: 'Ação desconhecida.' });
          },
        },
      };
    },
  };
})();
