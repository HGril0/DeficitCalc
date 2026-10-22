import { exigirSessao, textoErro } from './sessao.js';
import { alternarTema, desenharIconeTema, aplicarTema } from './tema.js';

const $ = (id) => document.getElementById(id);
let supabase, perfil, eu, sexoEscolhido = null;

function aviso(texto, tipo) {
  const m = $('msg');
  m.textContent = texto || '';
  m.className = 'aviso ' + (tipo || '');
  m.classList.toggle('oculto', !texto);
  if (texto) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function marcarSexo(v) {
  sexoEscolhido = v;
  $('sexo-f').setAttribute('aria-pressed', String(v === 'f'));
  $('sexo-m').setAttribute('aria-pressed', String(v === 'm'));
}

async function mostrarGasto() {
  const { data, error } = await supabase.rpc('estimar_gasto');
  const r = Array.isArray(data) ? data[0] : data;
  if (error) { aviso(textoErro(error), 'erro'); return; }
  if (!r || r.gasto_estimado == null) {
    $('gasto-vazio').classList.remove('oculto');
    $('gasto-conteudo').classList.add('oculto');
    return;
  }
  $('gasto-vazio').classList.add('oculto');
  $('gasto-conteudo').classList.remove('oculto');
  const sufixo = document.createElement('small');
  sufixo.textContent = 'kcal/dia';
  $('g-estimado').replaceChildren(r.gasto_estimado + ' ', sufixo);
  $('g-intervalo').textContent = `provavelmente entre ${r.gasto_minimo} e ${r.gasto_maximo}`;
  $('g-alvo').textContent = r.kcal_objetivo + ' kcal';
  $('g-nota').textContent =
    'O gasto é uma estimativa a partir da tua altura, peso, idade e atividade. '
    + 'A fórmula erra cerca de 10% para cima ou para baixo conforme a pessoa, por isso trata o '
    + 'intervalo como a resposta e o número do meio como o palpite central.';
  if (r.objetivo_ajustado) {
    $('g-ajuste').textContent = r.motivo + ' O objetivo foi ajustado para ' + r.kcal_objetivo
      + ' kcal, que é o mais baixo que esta app considera razoável para ti.';
    $('g-ajuste').classList.remove('oculto');
  } else {
    $('g-ajuste').classList.add('oculto');
  }
}

async function preencher() {
  if (perfil.sexo) marcarSexo(perfil.sexo);
  if (perfil.data_nascimento) $('nascimento').value = perfil.data_nascimento;
  if (perfil.altura_cm) $('altura').value = perfil.altura_cm;
  if (perfil.nivel_atividade) $('atividade').value = perfil.nivel_atividade;
  if (perfil.objetivo_kg_semana != null) $('objetivo').value = String(Number(perfil.objetivo_kg_semana));

  const { data } = await supabase.from('pesos')
    .select('kg, medido_em').order('medido_em', { ascending: false }).limit(1);
  if (data && data[0]) $('peso').value = data[0].kg;

  const hoje = new Date();
  const anos = (n) => new Date(hoje.getFullYear() - n, hoje.getMonth(), hoje.getDate())
    .toISOString().slice(0, 10);
  $('nascimento').min = anos(100);
  $('nascimento').max = anos(16);
}

async function guardar(ev) {
  ev.preventDefault();
  const btn = $('guardar');
  btn.disabled = true;
  aviso('', '');

  try {
    if (!sexoEscolhido) throw new Error('Escolhe o sexo — a fórmula do gasto precisa dele.');
    const altura = Number($('altura').value);
    const peso = Number($('peso').value);
    const nascimento = $('nascimento').value;
    const atividade = $('atividade').value;
    const objetivo = Number($('objetivo').value);

    if (!nascimento) throw new Error('Falta a data de nascimento.');
    if (!(altura >= 120 && altura <= 230)) throw new Error('A altura tem de estar entre 120 e 230 cm.');
    if (!(peso >= 25 && peso <= 400)) throw new Error('O peso tem de estar entre 25 e 400 kg.');
    if (!atividade) throw new Error('Escolhe o nível de atividade.');

    // Só as colunas que o utilizador pode escrever. As outras nem sequer vão
    // aqui, e a base de dados recusá-las-ia na mesma.
    const { error: e1 } = await supabase.from('profiles').update({
      sexo: sexoEscolhido,
      data_nascimento: nascimento,
      altura_cm: altura,
      nivel_atividade: atividade,
      objetivo_kg_semana: objetivo,
    }).eq('id', eu);
    if (e1) throw e1;

    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
    // Sem utilizador_id: o servidor preenche-o com quem tem a sessão. Enviá-lo
    // fazia o upsert pedir permissão para mudar essa coluna, e falhava sempre.
    const { error: e2 } = await supabase.from('pesos')
      .upsert({ kg: peso, medido_em: hoje },
              { onConflict: 'utilizador_id,medido_em' });
    if (e2) throw e2;

    aviso('Guardado.', 'bom');
    await mostrarGasto();
  } catch (e) {
    aviso(textoErro(e), 'erro');
  } finally {
    btn.disabled = false;
  }
}

async function principal() {
  const ctx = await exigirSessao();
  supabase = ctx.supabase;
  perfil = ctx.perfil;
  eu = ctx.sessao.user.id;

  desenharIconeTema($('btn-tema'));
  $('btn-tema').addEventListener('click', () => {
    alternarTema();
    desenharIconeTema($('btn-tema'));
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    aplicarTema();
    desenharIconeTema($('btn-tema'));
  });

  $('sexo-f').addEventListener('click', () => marcarSexo('f'));
  $('sexo-m').addEventListener('click', () => marcarSexo('m'));
  $('formulario').addEventListener('submit', guardar);
  await preencher();
  await mostrarGasto();
}

principal().catch((e) => aviso(textoErro(e), 'erro'));
