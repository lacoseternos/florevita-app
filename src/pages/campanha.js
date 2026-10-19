// ── PROGRAMA ESTRELAS — configuração (admin/gerente) — out/2026 ───────────
// Semanas de SEGUNDA a DOMINGO configuradas com antecedência, por setor
// (Atendimento/vendas, Expedição, Produção), seguindo o cardápio de 50 ⭐:
//   🟢 Fácil 13 · 🟡 Média 12 · 🔴 Difícil 12 · 🟣 Épica 5 · 🔁 Do ciclo 8
// Caixa de sugestões por setor (adaptar ou criar do zero), equipe por setor,
// alvo por pessoa, baixa manual, bônus/penalidades e ranking da semana.
// Tudo calculado no servidor (/campanha/*) — aqui só edita e exibe.
import { GET, PUT, POST, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { $c, esc } from '../utils/formatters.js';

let _data = null;     // GET /campanha/config
let _ranking = null;  // GET /campanha/ranking
let _loading = false;
let _erro = '';
const st = { tab: 'semanas', semana: null, setor: 'vendas', editor: null, abertoColab: '', rankAberto: '', baixa: null };
const _draft = {};    // semana → { setores } em edição
let _dirty = false;

async function _render() { const m = await import('../main.js'); m.render(); }

async function carregar() {
  _loading = true; _erro = '';
  try {
    const [cfg, rk] = await Promise.all([GET('/campanha/config'), GET('/campanha/ranking').catch(() => null)]);
    _data = cfg; _ranking = rk;
    if (!st.semana) st.semana = cfg.semanaAtual;
  } catch (e) { _erro = e.message || 'Erro ao carregar'; }
  _loading = false;
}
const recarregar = async () => { await carregar(); _render(); };

// ── datas ──
const segundaDe = (dia) => { const d = new Date(dia + 'T12:00:00Z'); const w = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w)); return d.toISOString().slice(0, 10); };
const somar = (dia, n) => new Date(new Date(dia + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const br = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';
const rotuloSemana = (wk) => `${br(wk)} a ${br(somar(wk, 6))}`;
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });

// ── cardápio ──
const tipoTxt = (m) => m.tipo === 'semana' ? 'semana inteira' : (Number(m.limite) >= 5 ? 'todo dia (até ' + m.limite + 'x)' : (m.limite || 1) + 'x na semana');
const maxM = (m) => (Number(m.estrelas) || 0) * (m.tipo === 'semana' ? 1 : Math.max(1, Number(m.limite) || 1));
const maxLista = (l) => (l || []).reduce((s, m) => s + maxM(m), 0);
function setoresDaSemana(wk) {
  if (!_draft[wk]) {
    const salvo = _data?.config?.semanas?.[wk]?.setores;
    const vazio = Object.fromEntries(Object.keys(_data?.setores || { vendas: 1, expedicao: 1, producao: 1 }).map(k => [k, []]));
    _draft[wk] = JSON.parse(JSON.stringify({ ...vazio, ...(salvo || {}) }));
  }
  return _draft[wk];
}
function alvoTxt(m) {
  const met = _data?.metricasMissao?.[m.metrica];
  if (!met) return '';
  if (m.metrica === 'manual') return 'a gerência dá baixa';
  let t = met.money ? $c(m.alvo) : String(m.alvo);
  if (m.metrica === 'vendaAcima') t = `${m.alvo} venda(s) acima de ${$c(m.valorMin)}`;
  if (m.metrica === 'itensCategoria') t = `${m.alvo} itens de ${m.categoria}`;
  if (m.metrica === 'itensNome') t = `${m.alvo} itens com "${m.nomeContem}"${m.soAdicional ? ' (só avulsos)' : ''}`;
  const extra = (m.horaIni || m.horaFim ? ` · ${m.horaIni ? 'das ' + m.horaIni + ' ' : ''}${m.horaFim ? 'até ' + m.horaFim : ''}` : '');
  if (met.semAlvo) return (/^metaLoja/.test(m.metrica) ? 'alvo = meta da loja (menu Metas)' : 'alvo = meta dela (menu Metas)') + (Number(m.acimaPct) ? ` + ${m.acimaPct}%` : '') + extra;
  return 'alvo: ' + t + extra;
}

// ── estilos (responsivos) ──
const ESTILO = `<style>
.es-wrap{display:flex;flex-direction:column;gap:14px;}
.es-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-radius:14px;padding:14px 16px;}
.es-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;}
.es-tabs button{flex:0 0 auto;border:1.5px solid var(--border);background:#fff;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;cursor:pointer;color:#475569;}
.es-tabs button.on{background:#FEF3C7;border-color:#F59E0B;color:#92400E;}
.es-semana{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.es-semana .es-wk{font-weight:800;font-size:15px;min-width:150px;text-align:center;}
.es-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:11px;background:#fff;cursor:pointer;}
.es-chip.on{background:#ECFDF5;border-color:#10B981;color:#065F46;font-weight:700;}
.es-setores{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;}
.es-setores button{border:1.5px solid var(--border);background:#fff;border-radius:12px;padding:10px;cursor:pointer;text-align:left;}
.es-setores button.on{border-color:#7C3AED;background:#F5F3FF;}
.es-cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:14px;align-items:start;}
.es-nivel{border:1px solid var(--border);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:#fff;}
.es-nivel-h{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;font-weight:800;font-size:13px;}
.es-bar{height:6px;border-radius:999px;background:#F1F5F9;overflow:hidden;margin-top:4px;}
.es-bar>div{height:100%;border-radius:999px;}
.es-mis{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px dashed #E2E8F0;}
.es-mis:first-of-type{border-top:none;}
.es-mis .es-ic{font-size:20px;line-height:1;}
.es-mis .es-tx{flex:1;min-width:0;}
.es-mis .es-nm{font-weight:700;font-size:13px;}
.es-mis .es-sb{font-size:11px;color:var(--muted);margin-top:2px;}
.es-mis .es-st{white-space:nowrap;font-weight:800;color:#B45309;font-size:12px;}
.es-btn{border:none;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;background:#F1F5F9;color:#334155;}
.es-btn.r{background:#FEE2E2;color:#991B1B;} .es-btn.g{background:#DCFCE7;color:#166534;} .es-btn.p{background:#EDE9FE;color:#5B21B6;}
.es-sug{display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px dashed #E2E8F0;}
.es-total{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-weight:800;}
.es-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9000;display:flex;align-items:flex-end;justify-content:center;}
.es-modal .es-box{background:#fff;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px;}
@media(min-width:700px){.es-modal{align-items:center;}.es-modal .es-box{border-radius:16px;}}
.es-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}
.es-form .full{grid-column:1/-1;}
.es-form label{font-size:11px;font-weight:700;color:#475569;display:flex;flex-direction:column;gap:4px;}
.es-form input,.es-form select{width:100%;}
.es-tab{width:100%;border-collapse:collapse;font-size:12.5px;}
.es-tab th{text-align:left;font-size:10px;text-transform:uppercase;color:#94A3B8;padding:6px;}
.es-tab td{padding:7px 6px;border-top:1px solid #F1F5F9;vertical-align:middle;}
@media(max-width:900px){.es-cols{grid-template-columns:1fr;}}
@media(max-width:560px){.es-setores{grid-template-columns:1fr;}.es-form{grid-template-columns:1fr;}.es-tab th:nth-child(n+4),.es-tab td:nth-child(n+4){display:none;}}
</style>`;

// ────────────────────────────────────────────────────────────────────────
export function renderCampanha() {
  if (!_data && !_loading && !_erro) carregar().then(_render);
  if (_erro) return `<div class="card" style="color:var(--red);padding:20px;">⚠️ ${esc(_erro)} <button class="es-btn" onclick="esRecarregar()">Tentar de novo</button></div>`;
  if (!_data) return `<div class="card" style="text-align:center;padding:36px;color:var(--muted);">⏳ Carregando o Programa Estrelas…</div>`;
  const cfg = _data.config || {};
  const ativa = cfg.ativa === true;
  const configuradaAtual = !!cfg.semanas?.[_data.semanaAtual];
  const tabs = [['semanas', '📅 Semanas'], ['equipe', '👥 Equipe'], ['baixa', '✅ Baixa manual'], ['bonus', '💰 Bônus e penalidades'], ['ranking', '🏅 Ranking']];
  const corpo = st.tab === 'equipe' ? tabEquipe() : st.tab === 'baixa' ? tabBaixa() : st.tab === 'bonus' ? tabBonus() : st.tab === 'ranking' ? tabRanking() : tabSemanas();
  return `${ESTILO}<div class="es-wrap">
    <div class="es-top" style="background:${ativa ? 'linear-gradient(135deg,#FEF9C3,#FDE68A)' : 'linear-gradient(135deg,#F1F5F9,#fff)'};border:1.5px solid ${ativa ? '#F59E0B' : '#CBD5E1'};">
      <div style="min-width:0;">
        <div style="font-size:18px;font-weight:900;">⭐ Programa Estrelas</div>
        <div style="font-size:12px;font-weight:700;margin-top:2px;color:${ativa ? '#92400E' : '#64748B'};">
          ${ativa ? '🟢 ATIVO — as colaboradoras veem as missões no Meu Painel' : '⚪ DESLIGADO — só a gerência vê (modo configuração)'}
          · semana atual ${rotuloSemana(_data.semanaAtual)} ${configuradaAtual ? '✅ configurada' : '⚠️ sem missões'}
        </div>
      </div>
      <button type="button" onclick="esAtivar()" style="background:${ativa ? '#DC2626' : '#059669'};color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:800;cursor:pointer;">${ativa ? '⏸️ Desativar' : '▶️ Ativar para a equipe'}</button>
    </div>
    <div class="es-tabs">${tabs.map(([k, l]) => `<button type="button" class="${st.tab === k ? 'on' : ''}" onclick="esTab('${k}')">${l}</button>`).join('')}</div>
    ${corpo}
  </div>${st.editor ? editorModal() : ''}`;
}

// ── 📅 SEMANAS ──────────────────────────────────────────────────────────
function tabSemanas() {
  const wk = st.semana;
  const setores = setoresDaSemana(wk);
  const lista = setores[st.setor] || [];
  const salvas = Object.keys(_data.config?.semanas || {}).sort();
  const proximas = salvas.filter(w => w >= somar(_data.semanaAtual, -7)).slice(0, 8);
  const niveis = _data.niveis || {};
  const nivelHtml = Object.entries(niveis).map(([nk, nv]) => {
    const ms = lista.map((m, i) => ({ m, i })).filter(x => x.m.nivel === nk);
    const tot = maxLista(ms.map(x => x.m));
    const cor = tot > nv.teto ? '#DC2626' : tot === nv.teto ? '#10B981' : '#F59E0B';
    return `<div class="es-nivel">
      <div class="es-nivel-h"><span>${nv.icon} ${nv.label} <span style="font-weight:500;color:var(--muted);font-size:11px;">· ${esc(nv.qtd)}</span></span>
        <span style="color:${cor};">${tot}/${nv.teto} ⭐</span></div>
      <div class="es-bar"><div style="width:${Math.min(100, tot / nv.teto * 100)}%;background:${cor};"></div></div>
      ${ms.length ? ms.map(({ m, i }) => `<div class="es-mis">
        <div class="es-ic">${esc(m.icon || '🎯')}</div>
        <div class="es-tx"><div class="es-nm">${esc(m.nome)}</div><div class="es-sb">${tipoTxt(m)} · ${m.estrelas} ⭐ por vez · ${esc(alvoTxt(m))}</div></div>
        <div class="es-st">${maxM(m)} ⭐</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="es-btn" onclick="esEditar(${i})">✏️</button><button class="es-btn r" onclick="esRemover(${i})">✕</button></div>
      </div>`).join('') : '<div style="font-size:11px;color:var(--muted);padding:6px 0;">Nenhuma missão neste nível — use as sugestões ao lado.</div>'}
    </div>`;
  }).join('');
  const total = maxLista(lista);
  const corT = total > _data.tetoSemana ? '#DC2626' : total === _data.tetoSemana ? '#059669' : '#B45309';
  return `<div class="card">
    <div class="es-semana">
      <button class="es-btn" onclick="esSemana(-7)">‹ anterior</button>
      <div class="es-wk">📅 ${rotuloSemana(wk)}${wk === _data.semanaAtual ? ' <span style="font-size:11px;color:#059669;">(esta semana)</span>' : ''}</div>
      <button class="es-btn" onclick="esSemana(7)">próxima ›</button>
      <input type="date" class="fi" style="max-width:160px;" value="${wk}" onchange="esIrPara(this.value)" title="Escolha qualquer dia — a semana começa na segunda"/>
    </div>
    ${proximas.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:var(--muted);align-items:center;">Semanas configuradas:
      ${proximas.map(w => `<span class="es-chip ${w === wk ? 'on' : ''}" onclick="esIrPara('${w}')">${rotuloSemana(w)}</span>`).join('')}</div>` : ''}
  </div>
  <div class="es-setores">${Object.entries(_data.setores).map(([k, s]) => {
    const l = setores[k] || []; const t = maxLista(l);
    return `<button type="button" class="${st.setor === k ? 'on' : ''}" onclick="esSetor('${k}')"><div style="font-weight:800;">${s.icon} ${esc(s.label)}</div>
      <div style="font-size:11px;color:var(--muted);">${l.length} missões · ${t}/${_data.tetoSemana} ⭐</div></button>`;
  }).join('')}</div>
  <div class="es-cols">
    <div>
      <div class="card" style="padding:12px 14px;">
        <div class="es-total" style="justify-content:space-between;">
          <span>${_data.setores[st.setor].icon} ${esc(_data.setores[st.setor].label)} — <span style="color:${corT};">${total}/${_data.tetoSemana} ⭐</span></span>
          <span style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="es-btn p" onclick="esCardapio()">✨ Montar pelo cardápio</button>
            <button class="es-btn" onclick="esCopiarAnterior()">📋 Copiar semana anterior</button>
            <button class="es-btn" onclick="esNova()">➕ Missão nova</button>
          </span>
        </div>
      </div>
      <div style="margin-top:10px;">${nivelHtml}</div>
    </div>
    <div class="card" style="padding:12px 14px;">${caixaSugestoes()}</div>
  </div>
  <div style="position:sticky;bottom:0;z-index:5;background:var(--bg,#fff);padding:10px 0;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-primary" style="flex:1;justify-content:center;min-width:200px;" onclick="esSalvarSemana()">💾 Salvar semana ${rotuloSemana(wk)} (todos os setores)${_dirty ? ' •' : ''}</button>
    ${_data.config?.semanas?.[wk] ? `<button class="btn btn-ghost" onclick="esApagarSemana()">🗑️ Apagar semana</button>` : ''}
  </div>`;
}

function caixaSugestoes() {
  const setor = st.setor;
  const base = _data.sugestoes?.[setor] || [];
  const minhas = _data.config?.sugestoesCustom?.[setor] || [];
  const usados = new Set((setoresDaSemana(st.semana)[setor] || []).map(m => String(m.id).replace(/_\d+$/, '')));
  const linha = (m, origem, idx) => `<div class="es-sug">
    <div style="font-size:18px;">${esc(m.icon || '🎯')}</div>
    <div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:700;">${esc(m.nome)}</div>
      <div style="font-size:10.5px;color:var(--muted);">${_data.niveis[m.nivel]?.icon || ''} ${_data.niveis[m.nivel]?.label || ''} · ${tipoTxt(m)} · ${m.estrelas} ⭐ · ${esc(alvoTxt(m))}</div></div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <button class="es-btn g" onclick="esUsarSugestao('${origem}',${idx})">${usados.has(m.id) ? '+ de novo' : '+ usar'}</button>
      ${origem === 'minha' ? `<button class="es-btn r" onclick="esApagarSugestao(${idx})">✕</button>` : ''}
    </div>
  </div>`;
  return `<div style="font-weight:800;font-size:14px;">💡 Sugestões — ${esc(_data.setores[setor].label)}</div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 8px;">Clique em <strong>+ usar</strong>: abre para você adaptar (nome, alvo, estrelas) antes de entrar na semana.</div>
    ${minhas.length ? `<div style="font-size:11px;font-weight:800;color:#5B21B6;margin-top:6px;">⭐ Minhas sugestões</div>${minhas.map((m, i) => linha(m, 'minha', i)).join('')}` : ''}
    ${Object.keys(_data.niveis).map(nk => {
      const l = base.map((m, i) => ({ m, i })).filter(x => x.m.nivel === nk);
      return l.length ? `<div style="font-size:11px;font-weight:800;color:#334155;margin-top:10px;">${_data.niveis[nk].icon} ${_data.niveis[nk].label}</div>${l.map(x => linha(x.m, 'base', x.i)).join('')}` : '';
    }).join('')}
    <button class="es-btn p" style="width:100%;margin-top:10px;padding:8px;" onclick="esNova()">➕ Criar missão 100% personalizada</button>`;
}

// ── editor (adaptar / criar) ──
function editorModal() {
  const e = st.editor, m = e.mis;
  const met = _data.metricasMissao || {};
  const base = _data.setores[st.setor]?.base || st.setor;
  const metOpts = Object.entries(met).filter(([, v]) => v.setor === 'todos' || v.setor === base)
    .map(([k, v]) => `<option value="${k}" ${m.metrica === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  const cur = met[m.metrica] || {};
  const tipoSel = m.tipo === 'semana' ? 'semana' : 'dia';
  return `<div class="es-modal" onclick="if(event.target===this)esFecharEditor()"><div class="es-box">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <div style="font-weight:900;font-size:16px;">${e.idx == null ? '➕ Nova missão' : '✏️ Editar missão'} · ${esc(_data.setores[st.setor].label)}</div>
      <button class="es-btn" onclick="esFecharEditor()">✕</button></div>
    <div class="es-form">
      <label style="max-width:90px;">Ícone<input class="fi" id="ed-icon" maxlength="4" value="${esc(m.icon || '🎯')}" style="text-align:center;font-size:18px;"/></label>
      <label class="full">Nome da missão<input class="fi" id="ed-nome" value="${esc(m.nome || '')}" placeholder="Ex.: Fazer 2 vendas acima de R$ 300 no dia"/></label>
      <label>Nível<select class="fi" id="ed-nivel">${Object.entries(_data.niveis).map(([k, v]) => `<option value="${k}" ${m.nivel === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
      <label>Quando conta<select class="fi" id="ed-tipo" onchange="esEdTipo()"><option value="dia" ${tipoSel === 'dia' ? 'selected' : ''}>Por dia cumprido</option><option value="semana" ${tipoSel === 'semana' ? 'selected' : ''}>Na semana inteira (1x)</option></select></label>
      <label id="ed-wrap-limite" style="${tipoSel === 'semana' ? 'display:none;' : ''}">Vezes na semana (máx.)<input class="fi" id="ed-limite" type="number" min="1" max="7" value="${m.limite || 1}" oninput="esEdCalc()"/></label>
      <label>Estrelas por vez<input class="fi" id="ed-estrelas" type="number" min="0" max="50" value="${m.estrelas ?? 1}" oninput="esEdCalc()"/></label>
      <label class="full">O que mede<select class="fi" id="ed-metrica" onchange="esEdMetrica()">${metOpts}</select></label>
      <label id="ed-wrap-alvo" style="${cur.semAlvo ? 'display:none;' : ''}">Alvo${cur.money ? ' (R$)' : ''}<input class="fi" id="ed-alvo" type="number" min="0" value="${m.alvo || 0}"/></label>
      <label id="ed-wrap-valor" style="${m.metrica === 'vendaAcima' ? '' : 'display:none;'}">Valor mínimo da venda (R$)<input class="fi" id="ed-valor" type="number" min="0" value="${m.valorMin || 0}"/></label>
      <label id="ed-wrap-texto" class="full" style="${m.metrica === 'itensNome' ? '' : 'display:none;'}">Nome do item contém (separe por vírgula)<input class="fi" id="ed-texto" value="${esc(m.nomeContem || '')}" placeholder="Ex.: ferrero, bombom, chocolate"/>
        <span style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:4px;"><input type="checkbox" id="ed-soad" ${m.soAdicional ? 'checked' : ''}/> Só itens avulsos (adicionais) — não conta buquê "com Ferrero"</span></label>
      <label id="ed-wrap-pct" style="${/^(metaDia|metaSemana|metaLojaDia|metaLojaSemana)$/.test(m.metrica) ? '' : 'display:none;'}">% acima da meta<input class="fi" id="ed-pct" type="number" min="0" max="500" value="${m.acimaPct || 0}"/></label>
      <label>A partir de (hora)<input class="fi" id="ed-hini" type="time" value="${esc(m.horaIni || '')}"/></label>
      <label>Até (hora)<input class="fi" id="ed-hfim" type="time" value="${esc(m.horaFim || '')}"/></label>
      <label id="ed-wrap-cat" style="${m.metrica === 'itensCategoria' ? '' : 'display:none;'}">Categoria<select class="fi" id="ed-cat">${(_data.categorias || []).map(c => `<option ${m.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>
    <div id="ed-calc" style="margin-top:12px;font-size:12px;font-weight:700;color:#B45309;">Vale até ${maxM(m)} ⭐ na semana</div>
    <label style="display:flex;gap:6px;align-items:center;margin-top:10px;font-size:12px;"><input type="checkbox" id="ed-guardar"/> Guardar também em <strong>Minhas sugestões</strong> deste setor</label>
    <div style="display:flex;gap:8px;margin-top:14px;"><button class="btn btn-ghost" style="flex:1;justify-content:center;" onclick="esFecharEditor()">Cancelar</button>
      <button class="btn btn-primary" style="flex:2;justify-content:center;" onclick="esConfirmarEditor()">${e.idx == null ? '➕ Colocar na semana' : '✅ Atualizar'}</button></div>
  </div></div>`;
}
function lerEditor() {
  const g = (id) => document.getElementById(id);
  const tipo = g('ed-tipo')?.value || 'dia';
  return {
    ...st.editor.mis,
    icon: g('ed-icon')?.value || '🎯', nome: (g('ed-nome')?.value || '').trim(), nivel: g('ed-nivel')?.value || 'facil',
    tipo, limite: tipo === 'semana' ? 1 : Math.max(1, Math.min(7, Number(g('ed-limite')?.value) || 1)),
    estrelas: Math.max(0, Number(g('ed-estrelas')?.value) || 0), metrica: g('ed-metrica')?.value || 'manual',
    alvo: Number(g('ed-alvo')?.value) || 0, valorMin: Number(g('ed-valor')?.value) || 0,
    nomeContem: g('ed-texto')?.value || '', categoria: g('ed-cat')?.value || '',
    soAdicional: !!g('ed-soad')?.checked, acimaPct: Number(g('ed-pct')?.value) || 0,
    horaIni: g('ed-hini')?.value || '', horaFim: g('ed-hfim')?.value || '',
  };
}

// ── 👥 EQUIPE (setor + alvo por pessoa) ─────────────────────────────────
function tabEquipe() {
  const eq = _data.config?.equipe || {};
  const sug = _data.setorSugerido || {};
  const lista = (_data.colabs || []).slice().sort((a, b) => a.nome.localeCompare(b.nome));
  const missoesSem = setoresDaSemana(st.semana);
  return `<div class="card">
    <div style="font-weight:800;font-size:14px;">👥 Quem participa e em qual setor</div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 10px;">Todas estão cadastradas como "Atendimento", então o setor das Estrelas é escolhido aqui. A sugestão vem do que cada uma mais fez nos últimos 14 dias.</div>
    <table class="es-tab"><thead><tr><th>Pessoa</th><th>Setor nas Estrelas</th><th></th><th>Sugerido</th></tr></thead><tbody>
    ${lista.map(c => {
      const s = eq[c.id]?.setor || '';
      const aberto = st.abertoColab === c.id;
      return `<tr><td style="font-weight:700;">${esc(c.nome)}</td>
        <td><select class="fi es-eq" data-colab="${c.id}" style="max-width:220px;">
          <option value="">— não participa —</option>
          ${Object.entries(_data.setores).map(([k, v]) => `<option value="${k}" ${s === k ? 'selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('')}
        </select></td>
        <td>${s ? `<button class="es-btn" onclick="esAbrirColab('${c.id}')">${aberto ? '▴' : '🎯 alvos'}</button>` : ''}</td>
        <td style="font-size:11px;color:var(--muted);">${sug[c.id] ? `${_data.setores[sug[c.id]].icon} ${esc(_data.setores[sug[c.id]].label)}${!s ? ` <button class="es-btn g" onclick="esUsarSugerido('${c.id}','${sug[c.id]}')">usar</button>` : ''}` : '—'}</td></tr>
        ${aberto && s ? `<tr><td colspan="4" style="background:#FAFAFA;">${alvosDaPessoa(c, s, missoesSem[s] || [])}</td></tr>` : ''}`;
    }).join('')}</tbody></table>
    <button class="btn btn-primary" style="margin-top:12px;" onclick="esSalvarEquipe()">💾 Salvar equipe</button>
  </div>`;
}
function alvosDaPessoa(c, setor, lista) {
  const pc = _data.config?.porColab?.[c.id] || {};
  const med = lista.filter(m => m.metrica !== 'manual' && !_data.metricasMissao?.[m.metrica]?.semAlvo);
  if (!med.length) return `<div style="font-size:12px;color:var(--muted);padding:6px;">A semana ${rotuloSemana(st.semana)} ainda não tem missões com alvo para este setor.</div>`;
  return `<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">Alvo só dela na semana ${rotuloSemana(st.semana)} (em branco = alvo da missão). Desmarque para ela não participar.</div>
    ${med.map(m => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;flex-wrap:wrap;" data-pc-colab="${c.id}" data-pc-mis="${esc(m.id)}">
      <input type="checkbox" class="pc-ativa" ${(pc.desativadas || []).includes(m.id) ? '' : 'checked'}/>
      <span style="flex:1;min-width:160px;font-size:12px;">${esc(m.icon)} ${esc(m.nome)} <span style="color:var(--muted);">(padrão ${m.alvo})</span></span>
      <input class="fi pc-alvo" type="number" min="0" style="max-width:110px;" placeholder="${m.alvo}" value="${pc.overrides?.[m.id]?.alvo ?? ''}"/>
    </div>`).join('')}
    <button class="es-btn g" style="margin-top:6px;" onclick="esSalvarAlvos('${c.id}')">💾 Salvar alvos de ${esc(c.nome.split(' ')[0])}</button>`;
}

// ── ✅ BAIXA MANUAL ─────────────────────────────────────────────────────
function tabBaixa() {
  const eq = _data.config?.equipe || {};
  const pessoas = (_data.colabs || []).filter(c => eq[c.id]?.setor).sort((a, b) => a.nome.localeCompare(b.nome));
  const b = st.baixa || (st.baixa = { colab: pessoas[0]?.id || '', dia: hojeISO() });
  const wk = segundaDe(b.dia);
  const setor = eq[b.colab]?.setor;
  const missoes = (_data.config?.semanas?.[wk]?.setores?.[setor] || []);
  const baixas = (_data.config?.baixas || []).filter(x => x.weekKey === wk).sort((x, y) => (y.em || '').localeCompare(x.em || ''));
  const nomeMis = (id) => { for (const k of Object.keys(_data.setores)) { const m = (_data.config?.semanas?.[wk]?.setores?.[k] || []).find(x => x.id === id); if (m) return m.icon + ' ' + m.nome; } return id; };
  return `<div class="card">
    <div style="font-weight:800;font-size:14px;">✅ Dar baixa manual</div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 10px;">Para missões que o sistema não mede sozinho (organização, conferência, avaliação no Google…) ou para corrigir alguma. A TV comemora em seguida.</div>
    ${!pessoas.length ? '<div style="color:#B45309;font-size:12px;">Escolha os setores das pessoas na aba 👥 Equipe primeiro.</div>' : `
    <div class="es-form">
      <label>Pessoa<select class="fi" id="bx-colab" onchange="esBaixaCampo()">${pessoas.map(c => `<option value="${c.id}" ${b.colab === c.id ? 'selected' : ''}>${esc(c.nome)} · ${_data.setores[eq[c.id].setor].icon}</option>`).join('')}</select></label>
      <label>Dia<input class="fi" type="date" id="bx-dia" value="${b.dia}" onchange="esBaixaCampo()"/></label>
      <label class="full">Missão (semana ${rotuloSemana(wk)})<select class="fi" id="bx-mis">${missoes.length ? missoes.map(m => `<option value="${esc(m.id)}">${esc(m.icon)} ${esc(m.nome)}${m.metrica === 'manual' ? ' · manual' : ''}</option>`).join('') : '<option value="">— semana sem missões neste setor —</option>'}</select></label>
    </div>
    <button class="btn btn-primary" style="margin-top:12px;" onclick="esDarBaixa()" ${missoes.length ? '' : 'disabled'}>✅ Dar baixa</button>`}
  </div>
  <div class="card"><div style="font-weight:800;font-size:13px;margin-bottom:6px;">Baixas da semana ${rotuloSemana(wk)}</div>
    ${baixas.length ? `<table class="es-tab"><tbody>${baixas.map(x => `<tr><td>${br(x.dia)}</td><td style="font-weight:700;">${esc(x.colabNome)}</td><td>${esc(nomeMis(x.missaoId))}</td><td style="color:var(--muted);font-size:11px;">por ${esc(x.por || '—')}</td>
      <td style="text-align:right;"><button class="es-btn r" onclick="esDesfazerBaixa('${x.id}')">desfazer</button></td></tr>`).join('')}</tbody></table>` : '<div style="font-size:12px;color:var(--muted);">Nenhuma baixa nesta semana.</div>'}
  </div>`;
}

// ── 💰 BÔNUS E PENALIDADES ──────────────────────────────────────────────
function tabBonus() {
  const cfg = _data.config || {};
  const pen = cfg.penalidades || { falta: 10, advertencia: 15, atraso: 2 };
  const faixas = [...(cfg.faixas || [])].sort((a, b) => a.estrelas - b.estrelas);
  const eq = cfg.equipe || {};
  const pessoas = (_data.colabs || []).filter(c => eq[c.id]?.setor);
  const log = [...(cfg.penalidadesLog || [])].reverse().slice(0, 30);
  return `<div class="es-cols" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr));">
    <div class="card"><div style="font-weight:800;font-size:14px;">💰 Faixas de bônus da semana</div>
      <div style="font-size:11px;color:var(--muted);margin:2px 0 10px;">No fim da semana (domingo), o total de estrelas cai na maior faixa atingida. Máximo possível: ${_data.tetoSemana} ⭐.</div>
      <div id="es-faixas">${faixas.map(f => faixaLinha(f)).join('')}</div>
      <button class="es-btn g" style="margin-top:6px;" onclick="esAddFaixa()">+ faixa</button>
    </div>
    <div class="card"><div style="font-weight:800;font-size:14px;">⚠️ Penalidades (estrelas perdidas)</div>
      ${[['falta', 'Falta', pen.falta], ['adv', 'Advertência', pen.advertencia], ['atraso', 'Atraso', pen.atraso]].map(([id, l, v]) => `
        <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;margin-top:8px;">${l}<span><input id="es-pen-${id}" class="fi" type="number" min="0" value="${v}" style="width:80px;text-align:right;"/> ⭐</span></label>`).join('')}
    </div>
  </div>
  <button class="btn btn-primary" onclick="esSalvarBonus()">💾 Salvar bônus e penalidades</button>
  <div class="card"><div style="font-weight:800;font-size:14px;">Lançar penalidade</div>
    <div class="es-form" style="margin-top:8px;">
      <label>Pessoa<select class="fi" id="es-pen-colab">${pessoas.map(c => `<option value="${c.id}" data-nome="${esc(c.nome)}">${esc(c.nome)}</option>`).join('')}</select></label>
      <label>Tipo<select class="fi" id="es-pen-tipo"><option value="falta">Falta</option><option value="advertencia">Advertência</option><option value="atraso">Atraso</option></select></label>
      <label>Dia<input class="fi" type="date" id="es-pen-data" value="${hojeISO()}"/></label>
      <label>Motivo (opcional)<input class="fi" id="es-pen-motivo" placeholder="Ex.: faltou sem avisar"/></label>
    </div>
    <button class="es-btn r" style="margin-top:10px;padding:8px 12px;" onclick="esAddPenalidade()">− Descontar estrelas</button>
    ${log.length ? `<table class="es-tab" style="margin-top:10px;"><tbody>${log.map(p => `<tr><td>${br(p.data)}</td><td style="font-weight:700;">${esc(p.colabNome || '')}</td><td>${({ falta: 'Falta', advertencia: 'Advertência', atraso: 'Atraso' })[p.tipo] || esc(p.tipo)}</td><td style="color:#B91C1C;font-weight:800;">−${p.estrelas} ⭐</td><td style="text-align:right;"><button class="es-btn r" onclick="esDelPenalidade('${p.id}')">✕</button></td></tr>`).join('')}</tbody></table>` : ''}
  </div>`;
}
const faixaLinha = (f) => `<div class="es-faixa" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
  <input class="fi es-fx-estr" type="number" min="1" value="${f.estrelas}" style="width:80px;"/> <span>⭐ =</span>
  <input class="fi es-fx-bonus" type="number" min="0" step="0.01" value="${f.bonus}" style="width:110px;"/> <span>R$</span>
  <button class="es-btn r" onclick="this.closest('.es-faixa').remove()">✕</button></div>`;

// ── 🏅 RANKING ──────────────────────────────────────────────────────────
function tabRanking() {
  const rk = _ranking?.ranking || [];
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:14px;">🏅 Ranking da semana ${_ranking?.weekKey ? rotuloSemana(_ranking.weekKey) : ''}</div>
      <button class="es-btn" onclick="esRecarregar()">🔄 Atualizar</button></div>
    ${rk.length ? rk.map((p, i) => {
      const ab = st.rankAberto === p.colabId;
      const pct = p.estrelasPossiveis ? Math.min(100, p.estrelas / p.estrelasPossiveis * 100) : 0;
      return `<div style="border-top:1px solid #F1F5F9;padding:10px 0;">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="esRank('${p.colabId}')">
          <div style="width:26px;text-align:center;font-weight:900;">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</div>
          <div style="flex:1;min-width:0;"><div style="font-weight:800;">${esc(p.nome)} <span style="font-size:11px;color:var(--muted);">${p.setor ? _data.setores[p.setor].icon : ''} ▾</span></div>
            <div class="es-bar"><div style="width:${pct}%;background:#F59E0B;"></div></div></div>
          <div style="text-align:right;white-space:nowrap;"><div style="font-weight:900;color:#B45309;">${p.estrelas} ⭐${p.estrelasPossiveis ? `<span style="font-size:10px;color:var(--muted);"> /${p.estrelasPossiveis}</span>` : ''}</div>
            <div style="font-size:11px;color:#15803D;font-weight:800;">${$c(p.bonus || 0)}</div></div>
        </div>
        ${ab ? `<div style="margin:8px 0 0 36px;">${(p.missoes || []).map(m => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding:3px 0;border-bottom:1px dashed #E2E8F0;">
          <span>${esc(m.icon)} ${esc(m.label || m.nome)}${m.semMeta ? ' <em style="color:#B45309;">(não está nas Metas do mês)</em>' : ''}</span>
          <span style="white-space:nowrap;">${m.limite ? `${m.vezes || 0}/${m.limite}` : ''} · <strong style="color:#B45309;">${m.ganhas} ⭐</strong></span></div>`).join('')}
          ${p.penalidadeEstrelas ? `<div style="font-size:11px;color:#B91C1C;margin-top:4px;">Penalidades: −${p.penalidadeEstrelas} ⭐</div>` : ''}</div>` : ''}
      </div>`;
    }).join('') : '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px;">Sem estrelas nesta semana ainda (configure a semana e a equipe).</div>'}
  </div>`;
}

// ── ações ───────────────────────────────────────────────────────────────
async function salvarCfg(patch, msg) {
  try { await PUT('/campanha/config', patch); toast(msg || '✅ Salvo!'); await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
}
const idUnico = (base, lista) => { let id = base, n = 2; while (lista.some(m => m.id === id)) id = base + '_' + n++; return id; };

window.esRecarregar = () => { _data = null; _ranking = null; carregar().then(_render); };
window.esTab = (t) => { st.tab = t; _render(); };
window.esSetor = (s) => { st.setor = s; _render(); };
window.esSemana = (n) => { st.semana = somar(st.semana, n); _render(); };
window.esIrPara = (d) => { if (d) { st.semana = segundaDe(d); _render(); } };
window.esAtivar = async () => {
  const novo = !(_data?.config?.ativa === true);
  if (novo && !_data.config?.semanas?.[_data.semanaAtual]) { if (!confirm('A semana atual ainda não tem missões salvas. Ativar mesmo assim?')) return; }
  if (novo && !confirm('Ativar o Programa Estrelas? As colaboradoras passam a ver as missões no Meu Painel.')) return;
  await salvarCfg({ ativa: novo }, novo ? '🟢 Programa Estrelas ativado!' : '⏸️ Programa Estrelas desligado.');
};
window.esCardapio = () => {
  const setores = setoresDaSemana(st.semana);
  if ((setores[st.setor] || []).length && !confirm('Trocar as missões deste setor pela semana pronta do cardápio?')) return;
  setores[st.setor] = JSON.parse(JSON.stringify(_data.semanaPadrao?.[st.setor] || []));
  _dirty = true; _render(); toast('✨ Cardápio aplicado — revise e salve a semana.');
};
window.esCopiarAnterior = () => {
  const ant = _data.config?.semanas?.[somar(st.semana, -7)]?.setores?.[st.setor];
  if (!ant?.length) return toast('A semana anterior não tem missões neste setor.', true);
  setoresDaSemana(st.semana)[st.setor] = JSON.parse(JSON.stringify(ant));
  _dirty = true; _render(); toast('📋 Copiado — revise e salve.');
};
window.esNova = () => { st.editor = { idx: null, mis: { icon: '🎯', nome: '', nivel: 'facil', tipo: 'dia', limite: 2, estrelas: 1, metrica: (_data.setores[st.setor]?.base || st.setor) === 'vendas' ? 'vendas' : 'manual', alvo: 0 } }; _render(); };
window.esEditar = (i) => { st.editor = { idx: i, mis: { ...setoresDaSemana(st.semana)[st.setor][i] } }; _render(); };
window.esRemover = (i) => { setoresDaSemana(st.semana)[st.setor].splice(i, 1); _dirty = true; _render(); };
window.esUsarSugestao = (origem, i) => {
  const src = origem === 'minha' ? _data.config?.sugestoesCustom?.[st.setor]?.[i] : _data.sugestoes?.[st.setor]?.[i];
  if (!src) return;
  const { semana, ...m } = src;
  st.editor = { idx: null, mis: { ...m } }; _render();
};
window.esApagarSugestao = async (i) => {
  const lista = [...(_data.config?.sugestoesCustom?.[st.setor] || [])]; lista.splice(i, 1);
  try { await PUT('/campanha/sugestoes', { setor: st.setor, lista }); await recarregar(); } catch (e) { toast('❌ ' + e.message, true); }
};
window.esFecharEditor = () => { st.editor = null; _render(); };
window.esEdTipo = () => { const t = document.getElementById('ed-tipo')?.value; const w = document.getElementById('ed-wrap-limite'); if (w) w.style.display = t === 'semana' ? 'none' : ''; window.esEdCalc(); };
window.esEdMetrica = () => {
  const k = document.getElementById('ed-metrica')?.value; const met = _data.metricasMissao?.[k] || {};
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  show('ed-wrap-alvo', !met.semAlvo); show('ed-wrap-valor', k === 'vendaAcima'); show('ed-wrap-texto', k === 'itensNome'); show('ed-wrap-cat', k === 'itensCategoria');
  show('ed-wrap-pct', /^(metaDia|metaSemana|metaLojaDia|metaLojaSemana)$/.test(k));
};
window.esEdCalc = () => { const el = document.getElementById('ed-calc'); if (el) el.textContent = `Vale até ${maxM(lerEditor())} ⭐ na semana`; };
window.esConfirmarEditor = async () => {
  const m = lerEditor();
  if (!m.nome) return toast('Dê um nome à missão', true);
  const met = _data.metricasMissao?.[m.metrica] || {};
  if (!met.semAlvo && !(m.alvo > 0)) return toast('Defina um alvo maior que zero', true);
  const lista = setoresDaSemana(st.semana)[st.setor];
  if (st.editor.idx == null) { m.id = idUnico(m.id || ('m_' + Date.now().toString(36)), lista); lista.push(m); }
  else lista[st.editor.idx] = m;
  const guardar = document.getElementById('ed-guardar')?.checked;
  st.editor = null; _dirty = true;
  if (guardar) {
    const minhas = [...(_data.config?.sugestoesCustom?.[st.setor] || []), { ...m, id: 'minha_' + Date.now().toString(36) }];
    try { await PUT('/campanha/sugestoes', { setor: st.setor, lista: minhas }); _data.config.sugestoesCustom = { ...(_data.config.sugestoesCustom || {}), [st.setor]: minhas }; } catch (e) { toast('❌ ' + e.message, true); }
  }
  _render();
};
window.esSalvarSemana = async () => {
  const wk = st.semana; const setores = setoresDaSemana(wk);
  try {
    const r = await PUT('/campanha/semana/' + wk, { setores });
    const avisos = Object.entries(r.conferencia || {}).flatMap(([k, c]) => (c.avisos || []).map(a => `${_data.setores[k].label}: ${a}`));
    delete _draft[wk]; _dirty = false;
    toast(avisos.length ? '💾 Salvo, mas atenção: ' + avisos.join(' · ') : `💾 Semana ${rotuloSemana(wk)} salva!`, !!avisos.length);
    await recarregar();
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
};
window.esApagarSemana = async () => {
  if (!confirm(`Apagar as missões da semana ${rotuloSemana(st.semana)}?`)) return;
  try { await DELETE('/campanha/semana/' + st.semana); delete _draft[st.semana]; _dirty = false; await recarregar(); toast('Semana apagada.'); } catch (e) { toast('❌ ' + e.message, true); }
};
window.esAbrirColab = (id) => { st.abertoColab = st.abertoColab === id ? '' : id; _render(); };
window.esUsarSugerido = (id, setor) => { const sel = document.querySelector(`.es-eq[data-colab="${id}"]`); if (sel) sel.value = setor; };
window.esSalvarEquipe = async () => {
  const equipe = {};
  document.querySelectorAll('.es-eq').forEach(s => { equipe[s.dataset.colab] = { setor: s.value }; });
  try { await PUT('/campanha/equipe', { equipe }); toast('💾 Equipe salva!'); await recarregar(); } catch (e) { toast('❌ ' + e.message, true); }
};
window.esSalvarAlvos = async (colabId) => {
  const desativadas = [], overrides = {}, vistos = [];
  document.querySelectorAll(`[data-pc-colab="${colabId}"]`).forEach(row => {
    const k = row.dataset.pcMis; vistos.push(k);
    if (!row.querySelector('.pc-ativa')?.checked) desativadas.push(k);
    const v = row.querySelector('.pc-alvo')?.value;
    if (v !== '' && v != null) overrides[k] = { alvo: Number(v) };
  });
  const atual = _data.config?.porColab?.[colabId] || {};
  const outrosOv = Object.fromEntries(Object.entries(atual.overrides || {}).filter(([k]) => !vistos.includes(k)));
  const porColab = { ...(_data.config?.porColab || {}), [colabId]: {
    desativadas: [...new Set([...(atual.desativadas || []).filter(k => !vistos.includes(k)), ...desativadas])],
    overrides: { ...outrosOv, ...overrides },
  } };
  await salvarCfg({ porColab }, '🎯 Alvos salvos!');
};
window.esBaixaCampo = () => { st.baixa = { colab: document.getElementById('bx-colab')?.value, dia: document.getElementById('bx-dia')?.value || hojeISO() }; _render(); };
window.esDarBaixa = async () => {
  const colabId = document.getElementById('bx-colab')?.value, dia = document.getElementById('bx-dia')?.value, missaoId = document.getElementById('bx-mis')?.value;
  if (!colabId || !dia || !missaoId) return toast('Escolha pessoa, dia e missão', true);
  const colabNome = (_data.colabs || []).find(c => c.id === colabId)?.nome || '';
  try { await POST('/campanha/baixa', { colabId, colabNome, missaoId, dia }); toast('✅ Baixa dada — a TV vai comemorar!'); await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esDesfazerBaixa = async (id) => { try { await DELETE('/campanha/baixa/' + id); await recarregar(); toast('Baixa desfeita.'); } catch (e) { toast('❌ ' + e.message, true); } };
window.esAddFaixa = () => { document.getElementById('es-faixas')?.insertAdjacentHTML('beforeend', faixaLinha({ estrelas: '', bonus: '' })); };
window.esSalvarBonus = () => {
  const faixas = [...document.querySelectorAll('.es-faixa')].map(d => ({ estrelas: Number(d.querySelector('.es-fx-estr')?.value) || 0, bonus: Number(d.querySelector('.es-fx-bonus')?.value) || 0 })).filter(f => f.estrelas > 0).sort((a, b) => a.estrelas - b.estrelas);
  if (new Set(faixas.map(f => f.estrelas)).size !== faixas.length) return toast('❌ Duas faixas com o mesmo número de estrelas', true);
  const v = (id) => Number(document.getElementById(id)?.value) || 0;
  salvarCfg({ faixas, penalidades: { falta: v('es-pen-falta'), advertencia: v('es-pen-adv'), atraso: v('es-pen-atraso') } }, '💾 Bônus e penalidades salvos!');
};
window.esAddPenalidade = async () => {
  const sel = document.getElementById('es-pen-colab');
  const colabId = sel?.value; if (!colabId) return toast('Escolha a pessoa', true);
  try {
    await POST('/campanha/penalidade', { colabId, colabNome: sel.selectedOptions[0]?.dataset.nome || '', tipo: document.getElementById('es-pen-tipo')?.value,
      data: document.getElementById('es-pen-data')?.value || '', motivo: document.getElementById('es-pen-motivo')?.value || '' });
    toast('⚠️ Penalidade registrada.'); await recarregar();
  } catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esDelPenalidade = async (id) => { try { await DELETE('/campanha/penalidade/' + id); await recarregar(); } catch (e) { toast('❌ ' + e.message, true); } };
window.esRank = (id) => { st.rankAberto = st.rankAberto === id ? '' : id; _render(); };
