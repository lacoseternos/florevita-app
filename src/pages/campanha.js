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
const st = { tab: 'semanas', semana: null, setor: 'vendas', editor: null, abertoColab: '', rankAberto: '', baixa: null,
  rl: { aberto: false, modo: 'auto', metrica: 'vendas', publico: 'todas', comecarAgora: true } };
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
const tipoTxt = (m) => m.tipo === 'semana' ? 'semana inteira (conta a partir do 5º dia trabalhado)' : (Number(m.limite) >= 5 ? 'todo dia (até ' + m.limite + 'x)' : (m.limite || 1) + 'x na semana');
const maxM = (m) => (Number(m.estrelas) || 0) * (m.tipo === 'semana' ? 1 : Math.max(1, Number(m.limite) || 1));
const maxLista = (l) => (l || []).reduce((s, m) => s + maxM(m), 0);
function setoresDaSemana(wk) {
  if (!_draft[wk]) {
    const salvo = _data?.config?.semanas?.[wk]?.setores;
    const vazio = Object.fromEntries(Object.keys(_data?.setores || { vendas: 1, expedicao: 1, producao: 1 }).map(k => [k, []]));
    _draft[wk] = JSON.parse(JSON.stringify({ ...vazio, ...(salvo || {}) }));
    // Semana salva com o antigo bloco 'Compartilhadas da loja': passa pra
    // Loja · Vendas como compartilhadas (aparecem também na Montagem).
    const antigas = _draft[wk].loja_comum;
    if (Array.isArray(antigas)) {
      if (_draft[wk].loja_vendas) {
        const ids = new Set(_draft[wk].loja_vendas.map(m => m.id));
        _draft[wk].loja_vendas.push(...antigas.filter(m => !ids.has(m.id)).map(m => ({ ...m, compartilhada: true })));
      }
      delete _draft[wk].loja_comum;
    }
  }
  return _draft[wk];
}
// Missões COMPARTILHADAS que vêm do setor irmão (mesmo grupo, ex.: Loja · Vendas ↔ Loja · Montagem).
function vindasDe(setores, s) {
  const g = _data?.setores?.[s]?.grupo;
  if (!g) return [];
  return Object.keys(_data.setores).filter(k => k !== s && _data.setores[k].grupo === g)
    .flatMap(k => (setores[k] || []).filter(m => m.compartilhada).map(m => ({ ...m, origem: k })));
}
// ── quantidade editável direto na lista ──
// Missão automática: a quantidade é o alvo. Baixa manual: é o número do nome
// ("Montar 5 embalagens…"), sem pegar %, minutos ou horário.
const RE_NUM_MANUAL = /(^|\s)(\d+)(?=\s+(?!min\b|minutos\b|h\b)[A-Za-zÀ-ú])/;
function qtdDe(m) {
  const met = _data?.metricasMissao?.[m.metrica] || {};
  if (m.metrica === 'manual') { const r = RE_NUM_MANUAL.exec(m.nome || ''); return r ? Number(r[2]) : null; }
  if (met.semAlvo) return null;
  return Number(m.alvo) || 0;
}
// Troca o número no nome (o 1º número "solto" igual ao antigo; R$ 200 no caso do valor).
function trocaNoNome(nome, antigo, novo, dinheiro = false) {
  if (antigo == null || String(antigo) === String(novo)) return nome;
  const re = dinheiro ? new RegExp('R\\$\\s*' + antigo + '(?![\\d.,])') : new RegExp('(^|[^\\d.,$])' + antigo + '(?![\\d.,%]|h\\d)');
  if (dinheiro) return String(nome).replace(re, 'R$ ' + novo);
  // 1 venda → 2 vendas (e o contrário)
  const plural = (t) => Number(novo) === 1
    ? t.replace(/^(\s+)(venda|pedido)s\b/, '$1$2').replace(/^(\s+)itens\b/, '$1item')
    : t.replace(/^(\s+)(venda|pedido)\b/, '$1$2s').replace(/^(\s+)item\b/, '$1itens');
  const r = re.exec(String(nome)); if (!r) return nome;
  const fim = r.index + r[0].length;
  return String(nome).slice(0, r.index) + r[1] + novo + plural(String(nome).slice(fim));
}
function aplicarQtd(m, v) {
  const n = Math.max(0, Math.round(Number(v) || 0));
  if (m.metrica === 'manual') {
    const r = RE_NUM_MANUAL.exec(m.nome || '');
    if (r) m.nome = m.nome.slice(0, r.index) + r[1] + n + m.nome.slice(r.index + r[0].length);
  } else if (_data?.metricasMissao?.[m.metrica]?.pct) {
    // "90% das entregas" → "92% das entregas" ("Todos os…" fica como está)
    m.nome = String(m.nome).replace(new RegExp('(^|[^\\d])' + (Number(m.alvo) || 0) + '%'), (x, p) => p + n + '%'); m.alvo = n;
  } else { m.nome = trocaNoNome(m.nome, m.alvo, n); m.alvo = n; }
  return m;
}
function aplicarMinutos(m, v) {
  const n = Math.max(0, Math.round(Number(v) || 0));
  m.nome = String(m.nome).replace(new RegExp('(^|[^\\d])' + (Number(m.minutos) || 0) + '\\s*min'), (x, p) => p + n + ' min'); m.minutos = n;
  return m;
}
function aplicarValor(m, v) {
  const n = Math.max(0, Math.round(Number(v) || 0));
  m.nome = trocaNoNome(m.nome, m.valorMin, n, true); m.valorMin = n;
  return m;
}
function inputsQtd(m, i) {
  const q = qtdDe(m);
  const met = _data?.metricasMissao?.[m.metrica] || {};
  const parts = [];
  if (q != null) parts.push(`<label class="es-qtd">${met.money ? 'R$' : met.pct ? '%' : 'Qtd.'}<input type="number" min="0" value="${q}" onchange="esQtd(${i},this.value)" onclick="event.stopPropagation()"/></label>`);
  if (m.metrica === 'vendaAcima') parts.push(`<label class="es-qtd">acima de R$<input type="number" min="0" value="${Number(m.valorMin) || 0}" onchange="esValorMin(${i},this.value)"/></label>`);
  if (met.precisaMinutos) parts.push(`<label class="es-qtd">min<input type="number" min="0" value="${Number(m.minutos) || 0}" onchange="esMinutos(${i},this.value)"/></label>`);
  return parts.join('');
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
.es-qtd{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#334155;margin:4px 8px 0 0;}
.es-qtd input{width:70px;padding:3px 6px;border:1.5px solid #CBD5E1;border-radius:7px;font-size:12px;font-weight:700;text-align:right;}
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
  const tabs = [['semanas', '📅 Semanas'], ['relampago', '⚡ Relâmpago'], ['equipe', '👥 Equipe'], ['baixa', '✅ Baixa manual'], ['bonus', '💰 Bônus e penalidades'], ['ranking', '🏅 Ranking'], ['historico', '📈 Histórico']];
  const corpo = st.tab === 'historico' ? tabHistorico() : st.tab === 'equipe' ? tabEquipe() : st.tab === 'baixa' ? tabBaixa() : st.tab === 'bonus' ? tabBonus() : st.tab === 'ranking' ? tabRanking() : st.tab === 'relampago' ? tabRelampago() : tabSemanas();
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
  </div>${st.editor ? editorModal() : ''}${st.detalhe ? detalheModal() : ''}`;
}

// ── 📅 SEMANAS ──────────────────────────────────────────────────────────
function tabSemanas() {
  const wk = st.semana;
  const setores = setoresDaSemana(wk);
  const lista = setores[st.setor] || [];
  // Setor da Loja: também mostra as 👥 compartilhadas do setor irmão (editadas lá).
  const comuns = vindasDe(setores, st.setor);
  const salvas = Object.keys(_data.config?.semanas || {}).sort();
  const proximas = salvas.filter(w => w >= somar(_data.semanaAtual, -7)).slice(0, 8);
  const niveis = _data.niveis || {};
  const nivelHtml = Object.entries(niveis).map(([nk, nv]) => {
    const ms = lista.map((m, i) => ({ m, i })).filter(x => x.m.nivel === nk);
    const cs = comuns.filter(m => m.nivel === nk);
    const tot = maxLista(ms.map(x => x.m)) + maxLista(cs);
    const cor = tot > nv.teto ? '#DC2626' : tot === nv.teto ? '#10B981' : '#F59E0B';
    return `<div class="es-nivel">
      <div class="es-nivel-h"><span>${nv.icon} ${nv.label} <span style="font-weight:500;color:var(--muted);font-size:11px;">· ${esc(nv.qtd)}</span></span>
        <span style="color:${cor};">${tot}/${nv.teto} ⭐</span></div>
      <div class="es-bar"><div style="width:${Math.min(100, tot / nv.teto * 100)}%;background:${cor};"></div></div>
      ${ms.length ? ms.map(({ m, i }) => `<div class="es-mis">
        <div class="es-ic">${esc(m.icon || '🎯')}</div>
        <div class="es-tx"><div class="es-nm">${esc(m.nome)}</div><div class="es-sb">${m.compartilhada ? '<strong style="color:#0E7490;">👥 compartilhada</strong> · ' : ''}${tipoTxt(m)} · ${m.estrelas} ⭐ por vez · ${esc(alvoTxt(m))}</div>${inputsQtd(m, i)}</div>
        <div class="es-st">${maxM(m)} ⭐</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">
          <button class="es-btn" onclick="esEditar(${i})">✏️</button><button class="es-btn r" onclick="esRemover(${i})">✕</button></div>
      </div>`).join('') : (cs.length ? '' : '<div style="font-size:11px;color:var(--muted);padding:6px 0;">Nenhuma missão neste nível — use as sugestões ao lado.</div>')}
      ${cs.map(m => `<div class="es-mis" style="background:#ECFEFF;border-radius:8px;padding:8px;">
        <div class="es-ic">${esc(m.icon || '🎯')}</div>
        <div class="es-tx"><div class="es-nm">${esc(m.nome)}</div><div class="es-sb"><strong style="color:#0E7490;">👥 compartilhada (vem de ${esc(_data.setores[m.origem]?.label || m.origem)})</strong> · ${tipoTxt(m)} · ${m.estrelas} ⭐ por vez · ${esc(alvoTxt(m))}</div></div>
        <div class="es-st">${maxM(m)} ⭐</div>
        <div><button class="es-btn" onclick="esSetor('${m.origem}')" title="Editar no setor de onde ela vem">✏️ editar lá</button></div>
      </div>`).join('')}
    </div>`;
  }).join('');
  const total = maxLista(lista) + maxLista(comuns);
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
    const l = setores[k] || []; const lc = vindasDe(setores, k);
    const t = maxLista(l) + maxLista(lc);
    return `<button type="button" class="${st.setor === k ? 'on' : ''}" onclick="esSetor('${k}')"><div style="font-weight:800;">${s.icon} ${esc(s.label)}</div>
      <div style="font-size:11px;color:var(--muted);">${l.length}${lc.length ? ' + ' + lc.length + ' 👥' : ''} missões · ${t}/${_data.tetoSemana} ⭐</div></button>`;
  }).join('')}</div>
  ${_data.setores[st.setor]?.grupo ? `<div class="card" style="padding:10px 14px;background:#ECFEFF;font-size:12px;color:#155E75;">👥 Missão marcada como <strong>compartilhada</strong> aqui aparece e vale também em <strong>${Object.keys(_data.setores).filter(k => k !== st.setor && _data.setores[k].grupo === _data.setores[st.setor].grupo).map(k => esc(_data.setores[k].label)).join(', ')}</strong> — o limite de cada setor continua ${_data.tetoSemana} ⭐, contando elas.</div>` : ''}
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
// Modal de detalhe pra outras abas (Acompanhamento): CSS mínimo + o modal.
export function renderDetalheMissaoAvulso() {
  return `<style>.es-btn{border:none;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700;cursor:pointer;background:#F1F5F9;color:#334155;}
.es-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9000;display:flex;align-items:flex-end;justify-content:center;}
.es-modal .es-box{background:#fff;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px;}
@media(min-width:700px){.es-modal{align-items:center;}.es-modal .es-box{border-radius:16px;}}</style>${st.detalhe ? detalheModal() : ''}`;
}

// ── DETALHE DA MISSÃO (gerência): pedidos por trás de cada dia ──────────
function detalheModal() {
  const d = st.detalhe;
  const fechar = '<button class="es-btn" onclick="esFecharDetalhe()">✕</button>';
  if (d.carregando) return `<div class="es-modal" onclick="if(event.target===this)esFecharDetalhe()"><div class="es-box"><div style="display:flex;justify-content:space-between;">⏳ Carregando os pedidos…${fechar}</div></div></div>`;
  if (d.erro) return `<div class="es-modal" onclick="if(event.target===this)esFecharDetalhe()"><div class="es-box"><div style="display:flex;justify-content:space-between;color:#B91C1C;">⚠️ ${esc(d.erro)}${fechar}</div></div></div>`;
  const r = d.dados, m = r.missao;
  const fmt = (v) => v == null ? '—' : m.money ? $c(v) : m.pct ? v + '%' : v;
  const dia = (x) => /\d{4}-\d{2}-\d{2}$/.test(x) ? x.split('-').reverse().slice(0, 2).join('/') : x.replace(/(\d{4})-(\d{2})-(\d{2})/g, (a, y, mo, dd) => dd + '/' + mo);
  const bloco = (x) => `<div style="border:1px solid #E2E8F0;border-radius:12px;padding:10px;margin-top:10px;">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;">
        <strong>📅 ${esc(dia(x.dia))}</strong>
        <span>${fmt(x.valor)} de ${fmt(x.alvo)} · ${x.contou ? '<b style="color:#15803D;">✓ contou</b>' : `<span style="color:#64748B;">não contou${x.motivo ? ' — ' + esc(x.motivo) : ''}</span>`}${x.baixa ? ' (baixa manual)' : ''}</span>
      </div>
      ${x.pedidos.length ? `<div style="overflow-x:auto;margin-top:6px;"><table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead><tr style="color:#64748B;text-align:left;"><th style="padding:4px;">Pedido</th><th style="padding:4px;">Data</th><th style="padding:4px;">Cliente</th><th style="padding:4px;">Produtos</th><th style="padding:4px;text-align:right;">Valor</th>${x.pedidos.some(p => p.ok != null) ? '<th style="padding:4px;">Ok?</th>' : ''}</tr></thead>
        <tbody>${x.pedidos.map(p => `<tr style="border-top:1px solid #F1F5F9;">
          <td style="padding:4px;font-weight:700;white-space:nowrap;">#${esc(p.numero)}</td>
          <td style="padding:4px;white-space:nowrap;">${esc(dia(p.data || ''))} ${esc(p.hora || '')}</td>
          <td style="padding:4px;">${esc(p.cliente)}</td>
          <td style="padding:4px;">${p.contou ? `<b>${esc(p.contou)}</b>${p.contou !== p.itens ? `<div style="color:#94A3B8;font-size:10.5px;">${esc(p.itens)}</div>` : ''}` : esc(p.itens)}${p.detalhe
            // Missões com prazo: linha do tempo completa (aprovado → pronto → saiu → entregue, limite e quanto sobrou/atrasou).
            ? `<div style="margin-top:3px;padding:4px 6px;border-radius:6px;background:${p.ok === false ? '#FEF2F2' : p.ok ? '#F0FDF4' : '#F8FAFC'};color:${p.ok === false ? '#991B1B' : p.ok ? '#166534' : '#475569'};font-size:11px;font-weight:600;">⏱️ ${esc(p.detalhe)}</div>${p.obs ? `<div style="color:#94A3B8;font-size:10.5px;">${esc(p.obs)}</div>` : ''}`
            : p.prazo ? `<div style="color:#64748B;font-size:10.5px;">prazo ${esc(p.prazo)}${p.entregue ? ' · entregue ' + esc(p.entregue) : ''}${p.pronto ? ' · pronto ' + esc(p.pronto) : ''}</div>` : (p.pronto ? `<div style="color:#64748B;font-size:10.5px;">pronto ${esc(p.pronto)}</div>` : (p.obs ? `<div style="color:#94A3B8;font-size:10.5px;">${esc(p.obs)}</div>` : ''))}</td>
          <td style="padding:4px;text-align:right;white-space:nowrap;">${$c(p.total)}</td>
          ${x.pedidos.some(q => q.ok != null) ? `<td style="padding:4px;">${p.ok == null ? '—' : p.ok ? '✅' : '❌'}</td>` : ''}
        </tr>`).join('')}</tbody></table></div>` : '<div style="font-size:11.5px;color:var(--muted);margin-top:6px;">Nenhum pedido neste dia.</div>'}
    </div>`;
  return `<div class="es-modal" onclick="if(event.target===this)esFecharDetalhe()"><div class="es-box" style="max-width:820px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
      <div><div style="font-weight:900;font-size:15px;">${esc(m.icon || '🎯')} ${esc(m.label)}</div>
        <div style="font-size:12px;color:var(--muted);">${esc(r.nome)} · ${m.vezes || 0}/${m.limite || 1} vez(es) · ${m.ganhas || 0} ⭐</div></div>
      ${fechar}</div>
    ${(r.porDia || []).length ? r.porDia.slice().reverse().map(bloco).join('') : '<div style="color:var(--muted);margin-top:10px;">Sem dados nesta semana.</div>'}
  </div></div>`;
}

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
      <label id="ed-wrap-min" style="${cur.precisaMinutos ? '' : 'display:none;'}">Minutos<input class="fi" id="ed-min" type="number" min="0" value="${m.minutos ?? ''}"/></label>
      <label id="ed-wrap-fontes" style="${cur.usaFontes ? '' : 'display:none;'}">Só pedidos de (vazio = todos)<input class="fi" id="ed-fontes" value="${esc(m.fontes || '')}" placeholder="ifood, site"/></label>
      <label id="ed-wrap-prim" style="${cur.usaSoPrimeiro ? '' : 'display:none;'}"><span style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="ed-prim" ${m.soPrimeiro ? 'checked' : ''}/> Só o 1º pedido do dia</span></label>
      <label id="ed-wrap-ret" style="${cur.usaSoRetirada ? '' : 'display:none;'}"><span style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="ed-ret" ${m.soRetirada ? 'checked' : ''}/> Só pedidos de retirada</span></label>
      <label id="ed-wrap-ate" style="${cur.precisaAteHora ? '' : 'display:none;'}">Saída/pronto até (hora)<input class="fi" id="ed-ate" type="time" value="${esc(m.ateHora || '')}"/></label>
      <label id="ed-wrap-prazo" style="${cur.precisaPrazoAte ? '' : 'display:none;'}">Pedidos com entrega até (hora)<input class="fi" id="ed-prazo" type="time" value="${esc(m.prazoAte || '')}"/></label>
      <label id="ed-wrap-minped" style="${cur.usaMinPedidosDia ? '' : 'display:none;'}">Só em dia com N+ pedidos expedidos (0 = sempre)<input class="fi" id="ed-minped" type="number" min="0" value="${m.minPedidosDia || 0}"/></label>
      <label id="ed-wrap-cat" style="${m.metrica === 'itensCategoria' ? '' : 'display:none;'}">Categoria<select class="fi" id="ed-cat">${(_data.categorias || []).map(c => `<option ${m.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </div>
    <div id="ed-calc" style="margin-top:12px;font-size:12px;font-weight:700;color:#B45309;">Vale até ${maxM(m)} ⭐ na semana</div>
    <label style="display:flex;gap:6px;align-items:center;margin-top:10px;font-size:12px;"><input type="checkbox" id="ed-comp" ${m.compartilhada ? 'checked' : ''}/> 👥 <strong>Missão compartilhada</strong> — conta a equipe da meta junta (ex.: as 2 da Loja); se cumprir, as duas ganham</label>
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
    soAdicional: !!g('ed-soad')?.checked, compartilhada: !!g('ed-comp')?.checked, acimaPct: Number(g('ed-pct')?.value) || 0,
    horaIni: g('ed-hini')?.value || '', horaFim: g('ed-hfim')?.value || '',
    minutos: Number(g('ed-min')?.value) || 0, fontes: g('ed-fontes')?.value || '', soPrimeiro: !!g('ed-prim')?.checked, soRetirada: !!g('ed-ret')?.checked,
    ateHora: g('ed-ate')?.value || '', prazoAte: g('ed-prazo')?.value || '', minPedidosDia: Number(g('ed-minped')?.value) || 0,
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
    ${!_data.config?.ativa ? `<div style="font-size:11px;color:#5B21B6;background:#F5F3FF;border-radius:8px;padding:6px 10px;margin-bottom:8px;">👁️ <strong>Prévia:</strong> o programa está desligado, mas quem tiver "Prévia" marcado já vê as próprias missões no Meu Painel.</div>` : ''}
    <table class="es-tab"><thead><tr><th>Pessoa</th><th>Setor nas Estrelas</th><th></th><th>Sugerido</th><th title="Vê as missões no Meu Painel antes de ativar o programa">Prévia</th><th title="Horário de entrada — o atraso desconta estrelas sozinho: até 5 min −1, até 10 min −2, mais −3">Entrada ⏰</th></tr></thead><tbody>
    ${lista.map(c => {
      const s = eq[c.id]?.setor || '';
      const aberto = st.abertoColab === c.id;
      return `<tr><td style="font-weight:700;">${esc(c.nome)}</td>
        <td><select class="fi es-eq" data-colab="${c.id}" style="max-width:220px;">
          <option value="">— não participa —</option>
          ${Object.entries(_data.setores).map(([k, v]) => `<option value="${k}" ${s === k ? 'selected' : ''}>${v.icon} ${esc(v.label)}</option>`).join('')}
        </select></td>
        <td>${s ? `<button class="es-btn" onclick="esAbrirColab('${c.id}')">${aberto ? '▴' : '🎯 alvos'}</button>` : ''}</td>
        <td style="font-size:11px;color:var(--muted);">${sug[c.id] ? `${_data.setores[sug[c.id]].icon} ${esc(_data.setores[sug[c.id]].label)}${!s ? ` <button class="es-btn g" onclick="esUsarSugerido('${c.id}','${sug[c.id]}')">usar</button>` : ''}` : '—'}</td>
        <td style="text-align:center;"><input type="checkbox" class="es-prev" data-colab="${c.id}" ${(_data.config?.liberadas || []).includes(c.id) ? 'checked' : ''}/></td>
        <td><input type="time" class="fi es-ent" data-colab="${c.id}" value="${esc(_data.config?.entradas?.[c.id] || '')}" style="width:105px;"/></td></tr>
        ${aberto && s ? `<tr><td colspan="6" style="background:#FAFAFA;">${alvosDaPessoa(c, s, missoesSem[s] || [])}</td></tr>` : ''}`;
    }).join('')}</tbody></table>
    <button class="btn btn-primary" style="margin-top:12px;" onclick="esSalvarEquipe()">💾 Salvar equipe</button>
  </div>${cardFolgas()}`;
}

// ── 🗓️ FOLGAS DE CADA UMA (escala 5x2, semana própria) — Marcia 26/out ───
// cfg.folgas[colabId]['YYYY-MM'] = [folga1, folga2] (0 dom … 6 sáb; um número
// só = formato antigo). A semana dela fecha na folga depois da qual vem o trecho
// de trabalho mais longo (igual ao servidor). Mês sem cadastro herda o anterior.
// Ao lado: as folgas que o PONTO mostra (GET /campanha/folgas-ponto).
const DIAS_SEM = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const _DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const _mesAtual = () => hojeISO().slice(0, 7);
const _somarMes = (mes, n) => { const [y, m] = mes.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const _nomeMes = (mes) => new Date(mes + '-15T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const _diaOk = (x) => x !== '' && x != null && Number.isInteger(Number(x)) && Number(x) >= 0 && Number(x) <= 6;
const _folgasNorm = (raw) => { const u = [...new Set((Array.isArray(raw) ? raw : [raw]).filter(_diaOk).map(Number))].slice(0, 2); return u.length ? u : null; };
function _fimPelasFolgas(fs) {
  if (!fs) return 0;
  if (fs.length === 1) return fs[0];
  const [a, b] = [...fs].sort((x, y) => x - y);
  return (7 - (b - a) - 1) > (b - a - 1) ? b : a;
}
// Folgas que valem no mês (cadastradas ou herdadas) → { folgas, herdada, de }
function folgaDoMes(colabId, mes) {
  const f = _data.config?.folgas?.[colabId] || {};
  if (_folgasNorm(f[mes])) return { folgas: _folgasNorm(f[mes]), herdada: false };
  const antes = Object.keys(f).filter(m => m < mes && _folgasNorm(f[m])).sort().pop();
  return { folgas: antes ? _folgasNorm(f[antes]) : null, herdada: true, de: antes || null };
}
const _folgasTxt = (fs) => fs ? [...fs].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(i => _DIAS_CURTO[i]).join(' + ') : '—';
const _semanaTxt = (fs) => { const f = _fimPelasFolgas(fs); return `${_DIAS_CURTO[(f + 1) % 7]} → ${_DIAS_CURTO[f]}`; };
const _mesmas = (a, b) => !!a && !!b && a.length === b.length && a.every(x => b.includes(x));
let _folgasPonto = {}; // mes → resposta do servidor | 'carregando' | { erro }
function _carregarFolgasPonto(mes) {
  if (_folgasPonto[mes]) return;
  _folgasPonto[mes] = 'carregando';
  GET('/campanha/folgas-ponto?mes=' + mes)
    .then(r => { _folgasPonto[mes] = r; })
    .catch(e => { _folgasPonto[mes] = { erro: e.message || 'erro' }; })
    .finally(() => { if (st.tab === 'equipe') _render(); });
}
function cardFolgas() {
  const eq = _data.config?.equipe || {};
  const mes = st.folgaMes || (st.folgaMes = _mesAtual());
  const pessoas = (_data.colabs || []).filter(c => eq[c.id]?.setor).sort((a, b) => a.nome.localeCompare(b.nome));
  _carregarFolgasPonto(mes);
  const fp = _folgasPonto[mes];
  const pontoOk = fp && fp !== 'carregando' && !fp.erro;
  const mesNome = _nomeMes(mes).split(' ')[0];
  const sel = (c, k, v) => `<select class="fi es-folga" data-colab="${c.id}" data-k="${k}" style="max-width:120px;">
      <option value="" ${v == null ? 'selected' : ''}>—</option>
      ${DIAS_SEM.map((n, i) => `<option value="${i}" ${v === i ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:14px;">🗓️ Folgas de cada uma (5x2) — semana própria</div>
      <span style="display:flex;gap:6px;align-items:center;"><button class="es-btn" onclick="esFolgaMes(-1)">◀</button>
        <b style="min-width:130px;text-align:center;">${_nomeMes(mes).replace(/^./, c => c.toUpperCase())}</b>
        <button class="es-btn" onclick="esFolgaMes(1)">▶</button></span></div>
    <div style="font-size:11px;color:var(--muted);margin:4px 0 10px;line-height:1.45;">Escolha as 2 folgas de cada uma no mês. A semana dela fecha na 2ª folga (ex.: sáb + dom → seg a dom; ter + qua → qui a qua) e as missões, as vezes por semana e as estrelas contam nessa semana.
      Mês sem folgas escolhidas usa as do mês anterior; sem nenhuma, a semana é de segunda a domingo. Na virada do mês a semana pode ter de 4 a 10 dias.
      <br><b>Pelo ponto</b>: dias da semana em que ela quase não bateu ponto ${pontoOk ? (fp.base === 'mes' ? `em ${mesNome} (até ${br(fp.ate)})` : `nas últimas 4 semanas (${br(fp.de)} a ${br(fp.ate)})`) : ''}.</div>
    ${!pessoas.length ? '<div style="color:#B45309;font-size:12px;">Escolha os setores das pessoas acima primeiro.</div>' : `
    <div>
    ${pessoas.map(c => {
      const f = folgaDoMes(c.id, mes);
      const cad = _folgasNorm(_data.config?.folgas?.[c.id]?.[mes]);
      const pp = pontoOk ? fp.pessoas?.[c.id] : null;
      let ponto = fp === 'carregando' ? '<span style="color:var(--muted);">⏳</span>' : !pontoOk ? '<span style="color:var(--muted);">—</span>' : '';
      if (pontoOk) {
        if (!pp || pp.semDados) ponto = '<span style="color:var(--muted);">sem ponto</span>';
        else {
          const bate = _mesmas(pp.folgas, f.folgas);
          const aviso = pp.folgas.length < 2 ? ` <span style="color:#B45309;" title="No ponto ela folgou só ${pp.folgas.length} dia(s) por semana">⚠️ só ${pp.folgas.length} folga</span>` : '';
          ponto = `<b>${_folgasTxt(pp.folgas)}</b>${aviso} ${bate ? '<span style="color:#15803D;font-weight:800;">✅ bate</span>' : pp.folgas.length ? `${f.folgas ? '<span style="color:#B91C1C;font-weight:800;" title="Diferente das folgas cadastradas">≠ diferente</span>' : '<span style="color:var(--muted);">(não cadastrada)</span>'} <button class="es-btn" style="padding:1px 7px;" onclick="esFolgaUsarPonto('${c.id}')">usar</button>` : ''}
            ${pp.poucosDados ? '<div style="font-size:10px;color:var(--muted);">poucos dias de ponto</div>' : ''}`;
        }
      }
      // Um bloco por pessoa (cabe no celular): nome + semana · folgas · pelo ponto.
      return `<div style="border-top:1px solid #F1F5F9;padding:9px 0;">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><b>${esc(c.nome)} <span style="color:var(--muted);font-size:11px;">${_data.setores[eq[c.id].setor]?.icon || ''}</span></b>
          <span style="font-size:12px;">semana ${_semanaTxt(f.folgas)}${f.herdada && f.de ? ' <span style="color:var(--muted);font-size:11px;">(herdada)</span>' : ''}</span></div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px;"><span style="font-size:11px;color:var(--muted);">Folgas:</span>${sel(c, 0, cad?.[0] ?? null)} ${sel(c, 1, cad?.[1] ?? null)}</div>
        ${!cad && f.de ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">em branco = igual a ${_nomeMes(f.de).split(' ')[0]} (${_folgasTxt(f.folgas)})</div>` : ''}
        <div style="font-size:12px;margin-top:5px;"><span style="font-size:11px;color:var(--muted);">Pelo ponto:</span> ${ponto}</div>
      </div>`;
    }).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
      <button class="btn btn-primary" onclick="esSalvarFolgas()">💾 Salvar folgas de ${mesNome}</button>
      ${pontoOk ? `<button class="es-btn" onclick="esFolgaUsarPonto()">📋 Preencher todas pelo ponto</button>` : ''}</div>`}
  </div>`;
}
window.esFolgaMes = (n) => { st.folgaMes = _somarMes(st.folgaMes || _mesAtual(), n); _render(); };
// Só preenche os campos (não salva): confira e clique em Salvar.
window.esFolgaUsarPonto = (colabId) => {
  const fp = _folgasPonto[st.folgaMes || _mesAtual()];
  if (!fp?.pessoas) return;
  document.querySelectorAll('.es-folga').forEach(s => {
    const id = s.dataset.colab;
    if (colabId && id !== colabId) return;
    const fs = fp.pessoas[id]?.folgas;
    if (!fs?.length) return;
    const v = fs[Number(s.dataset.k)];
    s.value = v == null ? '' : String(v);
  });
  toast('📋 Preenchido pelo ponto — confira e clique em Salvar.');
};
window.esSalvarFolgas = async () => {
  const mes = st.folgaMes || _mesAtual();
  const folgas = JSON.parse(JSON.stringify(_data.config?.folgas || {}));
  const novas = {};
  document.querySelectorAll('.es-folga').forEach(s => {
    const id = s.dataset.colab;
    (novas[id] || (novas[id] = [])).push(s.value);
  });
  for (const [id, vals] of Object.entries(novas)) {
    const f = folgas[id] || (folgas[id] = {});
    const fs = _folgasNorm(vals);
    if (fs) f[mes] = fs; else delete f[mes];
    if (!Object.keys(f).length) delete folgas[id];
  }
  const umaSo = Object.entries(novas).filter(([, v]) => _folgasNorm(v)?.length === 1).map(([id]) => (_data.colabs || []).find(c => c.id === id)?.nome || id);
  if (umaSo.length && !confirm(`Na escala 5x2 são 2 folgas, mas ${umaSo.join(', ')} ficou com só 1. Salvar assim mesmo?`)) return;
  await salvarCfg({ folgas }, '🗓️ Folgas salvas — a semana de cada uma já segue as folgas.');
};
// "qui 22/10 a qua 28/10" quando a semana dela não é seg→dom.
const semanaDelaTxt = (ini, fim) => {
  if (!ini || !fim) return '';
  const d = (x) => _DIAS_CURTO[new Date(x + 'T12:00:00Z').getUTCDay()];
  if (d(ini) === 'seg' && d(fim) === 'dom') return '';
  return `📅 ${d(ini)} ${br(ini)} a ${d(fim)} ${br(fim)}`;
};
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
  <div class="card"><div style="font-weight:800;font-size:14px;">⭐ Dar ou tirar estrelas</div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 0;">Estrela extra por proatividade, ou desconto por falta, advertência, atraso… na quantidade que você escolher. O atraso pelo ponto já desconta sozinho (veja abaixo).</div>
    ${ajusteForm(pessoas.map(c => ({ id: c.id, nome: c.nome })), pen)}
    ${log.length ? `<table class="es-tab" style="margin-top:10px;"><tbody>${log.map(p => ajusteLinha(p)).join('')}</tbody></table>` : ''}
  </div>
  ${atrasosAutoCard()}`;
}
// Formulário de ajuste (aba Bônus e aba Acompanhamento). pessoas = [{id, nome}]; fixo = id já escolhido.
export const AJ_TIPOS = { extra: '⭐ Estrela extra (proatividade…)', falta: 'Falta', advertencia: 'Advertência', atraso: 'Atraso', outro: 'Outro desconto' };
export function ajusteForm(pessoas, pen = {}, fixo = '') {
  const padrao = { extra: 1, falta: pen.falta ?? 10, advertencia: pen.advertencia ?? 15, atraso: pen.atraso ?? 2, outro: 1 };
  return `<div class="es-form" style="margin-top:8px;">
      ${fixo ? `<input type="hidden" id="es-pen-colab" value="${esc(fixo)}" data-nome="${esc(pessoas.find(p => p.id === fixo)?.nome || '')}"/>`
        : `<label>Pessoa<select class="fi" id="es-pen-colab">${pessoas.map(c => `<option value="${c.id}" data-nome="${esc(c.nome)}">${esc(c.nome)}</option>`).join('')}</select></label>`}
      <label>Tipo<select class="fi" id="es-pen-tipo" onchange="document.getElementById('es-pen-qtd').value=({${Object.entries(padrao).map(([k, v]) => k + ':' + Number(v || 0)).join(',')}})[this.value]||1">${Object.entries(AJ_TIPOS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label>Estrelas<input class="fi" type="number" min="1" step="1" id="es-pen-qtd" value="1"/></label>
      <label>Dia<input class="fi" type="date" id="es-pen-data" value="${hojeISO()}"/></label>
      <label class="full">Motivo<input class="fi" id="es-pen-motivo" placeholder="Ex.: ajudou a montar os pedidos da loja sem pedir"/></label>
    </div>
    <button class="es-btn g" style="margin-top:10px;padding:8px 12px;" onclick="esAddPenalidade()">✔ Lançar</button>`;
}
export function ajusteLinha(p) {
  const cred = p.tipo === 'extra';
  return `<tr><td>${br(p.data)}</td><td style="font-weight:700;">${esc(p.colabNome || '')}</td><td>${esc(AJ_TIPOS[p.tipo] || p.tipo)}${p.motivo ? `<div style="font-size:10.5px;color:var(--muted);">${esc(p.motivo)}</div>` : ''}</td><td style="color:${cred ? '#15803D' : '#B91C1C'};font-weight:800;white-space:nowrap;">${cred ? '+' : '−'}${p.estrelas} ⭐</td><td style="text-align:right;"><button class="es-btn r" title="${p.auto ? 'Perdoar este atraso' : 'Apagar'}" onclick="esDelPenalidade('${p.id}')">${p.auto ? 'perdoar' : '✕'}</button></td></tr>`;
}
// Atrasos automáticos da semana (vêm do ranking: penalidades com auto=true).
function atrasosAutoCard() {
  const auto = (_ranking?.ranking || []).flatMap(p => (p.penalidades || []).filter(x => x.auto));
  const semEntrada = (_data.colabs || []).filter(c => _data.config?.equipe?.[c.id]?.setor && !_data.config?.entradas?.[c.id]).map(c => c.nome.split(' ')[0]);
  return `<div class="card"><div style="font-weight:800;font-size:14px;">⏰ Atrasos automáticos da semana</div>
    <div style="font-size:11px;color:var(--muted);margin:2px 0 6px;">Chegada no ponto × horário de entrada (aba Equipe): até 5 min −1 ⭐ · até 10 min −2 ⭐ · mais −3 ⭐. "Perdoar" tira o desconto daquele dia.</div>
    ${semEntrada.length ? `<div style="font-size:11px;color:#B45309;margin-bottom:6px;">Sem horário de entrada (não calcula): ${esc(semEntrada.join(', '))}</div>` : ''}
    ${auto.length ? `<table class="es-tab"><tbody>${auto.map(ajusteLinha).join('')}</tbody></table>` : '<div style="font-size:12px;color:var(--muted);">Nenhum atraso nesta semana. 👏</div>'}
  </div>`;
}

const faixaLinha = (f) => `<div class="es-faixa" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">
  <input class="fi es-fx-estr" type="number" min="1" value="${f.estrelas}" style="width:80px;"/> <span>⭐ =</span>
  <input class="fi es-fx-bonus" type="number" min="0" step="0.01" value="${f.bonus}" style="width:110px;"/> <span>R$</span>
  <button class="es-btn r" onclick="this.closest('.es-faixa').remove()">✕</button></div>`;

// ── 🏅 RANKING ──────────────────────────────────────────────────────────
// Pede pra TV da loja mostrar o ranking das Estrelas por 1 min (Marcia 22/out).
window.esMostrarNaTV = async () => {
  try { await POST('/campanha/tv-comando', {}); toast('📺 Pedido enviado — a TV mostra o ranking em até ~20 s, por 1 minuto.'); }
  catch (e) { toast('❌ ' + (e?.message || 'Não consegui avisar a TV'), true); }
};

function tabRanking() {
  const rk = _ranking?.ranking || [];
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:14px;">🏅 Ranking da semana ${_ranking?.weekKey ? rotuloSemana(_ranking.weekKey) : ''}</div>
      <span style="display:flex;gap:6px;flex-wrap:wrap;"><button class="es-btn p" onclick="esMostrarNaTV()" title="A TV da loja mostra o ranking das Estrelas por 1 minuto (chega em até ~20 s)">📺 Mostrar ranking na TV agora</button>
      <button class="es-btn" onclick="esRecarregar()">🔄 Atualizar</button></span></div>
    <div style="font-size:11px;color:var(--muted);margin-top:4px;">Na própria TV também dá: 3 toques rápidos no logo, ou a tecla <b>E</b>.</div>
    ${rk.length ? rk.map((p, i) => {
      const ab = st.rankAberto === p.colabId;
      const pct = p.estrelasPossiveis ? Math.min(100, p.estrelas / p.estrelasPossiveis * 100) : 0;
      return `<div style="border-top:1px solid #F1F5F9;padding:10px 0;">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="esRank('${p.colabId}')">
          <div style="width:26px;text-align:center;font-weight:900;">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</div>
          <div style="flex:1;min-width:0;"><div style="font-weight:800;">${esc(p.nome)} <span style="font-size:11px;color:var(--muted);">${p.setor ? _data.setores[p.setor].icon : ''} ${semanaDelaTxt(p.startISO, p.endISO)} ▾</span></div>
            <div class="es-bar"><div style="width:${pct}%;background:#F59E0B;"></div></div></div>
          <div style="text-align:right;white-space:nowrap;"><div style="font-weight:900;color:#B45309;">${p.estrelas} ⭐${p.estrelasPossiveis ? `<span style="font-size:10px;color:var(--muted);"> /${p.estrelasPossiveis}</span>` : ''}</div>
            <div style="font-size:11px;color:#15803D;font-weight:800;">${$c(p.bonus || 0)}</div></div>
        </div>
        ${ab ? `<div style="margin:8px 0 0 36px;">${(p.missoes || []).map(m => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding:3px 0;border-bottom:1px dashed #E2E8F0;">
          <span>${esc(m.icon)} ${esc(m.label || m.nome)}${m.semMeta ? ' <em style="color:#B45309;">(não está nas Metas do mês)</em>' : ''}</span>
          <span style="white-space:nowrap;">${m.limite ? `${m.vezes || 0}/${m.limite}` : ''} · <strong style="color:#B45309;">${m.ganhas} ⭐</strong>${m.manual ? '' : ` <button class="es-btn" style="padding:2px 7px;" title="Ver os pedidos desta missão" onclick="event.stopPropagation();esDetalhe('${p.colabId}','${esc(m.id)}')">🔍</button>`}</span></div>`).join('')}
          ${(p.relampago || []).length ? `<div style="font-size:11px;color:#7C3AED;margin-top:4px;">⚡ Metas relâmpago: ${(p.relampago || []).map(r => `${esc(r.nome)} +${r.estrelas}⭐`).join(' · ')}${p.relampagoBonusRs ? ` · bônus ${$c(p.relampagoBonusRs)}` : ''}</div>` : ''}
          ${p.extraEstrelas ? `<div style="font-size:11px;color:#15803D;margin-top:4px;">Estrelas extras: +${p.extraEstrelas} ⭐</div>` : ''}
          ${p.penalidadeEstrelas ? `<div style="font-size:11px;color:#B91C1C;margin-top:4px;">Penalidades: −${p.penalidadeEstrelas} ⭐</div>` : ''}</div>` : ''}
      </div>`;
    }).join('') : '<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px;">Sem estrelas nesta semana ainda (configure a semana e a equipe).</div>'}
  </div>`;
}

// ── 📈 HISTÓRICO DAS SEMANAS + SUGESTÕES DE ALVO (Marcia 26/out) ─────────
// Ranking e desempenho das últimas semanas e, por pessoa, o que fazer com cada
// alvo na próxima semana (aumentar / manter / diminuir). "Aplicar" grava o alvo
// por pessoa (porColab.overrides) — o mesmo da aba Equipe.
let _hist = null, _sug = null, _histErro = '', _histCarregando = false;
async function carregarHistorico() {
  if (_histCarregando) return;
  _histCarregando = true; _histErro = '';
  try {
    const [h, s] = await Promise.all([GET('/campanha/historico?semanas=6'), GET('/campanha/sugestoes-alvos')]);
    _hist = h; _sug = s;
    // Abre na última semana FECHADA (a atual costuma estar quase zerada).
    if (st.histSem == null) st.histSem = Math.max(0, (h.semanas || []).filter(x => (x.ranking || []).length).findIndex(x => !x.atual));
  } catch (e) { _histErro = e.message || 'Erro ao carregar o histórico'; }
  _histCarregando = false;
  _render();
}
const _ACAO = {
  aumentar: { t: '⬆️ Aumentar', cor: '#15803D', bg: '#DCFCE7' },
  diminuir: { t: '⬇️ Diminuir', cor: '#B91C1C', bg: '#FEE2E2' },
  manter: { t: '➡️ Manter', cor: '#475569', bg: '#F1F5F9' },
};
const _fmtAlvo = (v, it) => it.pct ? Math.round(v) + '%' : it.money ? $c(v) : String(Math.round(v * 10) / 10).replace('.', ',');
const _alvoAtualDe = (colabId, missaoId) => _data.config?.porColab?.[colabId]?.overrides?.[missaoId]?.alvo;

function tabHistorico() {
  if (!_hist && !_histErro) { carregarHistorico(); return '<div class="card" style="text-align:center;padding:30px;color:var(--muted);">⏳ Montando o histórico das semanas… (pode levar uns segundos)</div>'; }
  if (_histErro) return `<div class="card" style="color:var(--red);padding:20px;">⚠️ ${esc(_histErro)} <button class="es-btn" onclick="esHistRecarregar()">Tentar de novo</button></div>`;
  const semanas = (_hist.semanas || []).filter(s => (s.ranking || []).length);
  if (!semanas.length) return '<div class="card" style="text-align:center;padding:24px;color:var(--muted);">Ainda não tem semanas com estrelas pra mostrar.</div>';
  const i = Math.min(st.histSem || 0, semanas.length - 1);
  const sem = semanas[i];
  const setores = _data.setores || {};
  const icone = (s) => setores[s]?.icon || '';
  // Evolução: estrelas de cada pessoa em cada semana (mais antiga → mais nova).
  const cron = [...semanas].reverse();
  const nomes = new Map();
  for (const s of cron) for (const p of s.ranking) if (!nomes.has(p.colabId)) nomes.set(p.colabId, { nome: p.nome, setor: p.setor });
  const ultima = semanas[0];
  const ordemEvo = [...nomes.keys()].sort((a, b) => (ultima.ranking.find(p => p.colabId === b)?.estrelas || 0) - (ultima.ranking.find(p => p.colabId === a)?.estrelas || 0));

  const ranking = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:14px;">🏅 Ranking por semana</div>
      <button class="es-btn" onclick="esHistRecarregar()">🔄 Atualizar</button></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 4px;">${semanas.map((s, k) => `<button type="button" class="es-btn${k === i ? ' p' : ''}" onclick="esHistSem(${k})">${rotuloSemana(s.weekKey)}${s.atual ? ' · atual' : ''}</button>`).join('')}</div>
    ${sem.atual ? '<div style="font-size:11px;color:#B45309;margin-bottom:4px;">⏳ Semana em andamento — os números ainda vão mudar.</div>' : ''}
    ${sem.ranking.map((p, k) => {
      const pct = p.possiveis ? Math.round(p.estrelas / p.possiveis * 100) : 0;
      const ab = st.histAberto === sem.weekKey + '|' + p.colabId;
      const cumpridas = p.missoes.filter(m => m.ganhas > 0).length;
      return `<div style="border-top:1px solid #F1F5F9;padding:9px 0;">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="esHistAbrir('${sem.weekKey}|${p.colabId}')">
          <div style="width:26px;text-align:center;font-weight:900;">${k < 3 ? ['🥇', '🥈', '🥉'][k] : k + 1}</div>
          <div style="flex:1;min-width:0;"><div style="font-weight:800;">${esc(p.nome)} <span style="font-size:11px;color:var(--muted);">${icone(p.setor)} · ${cumpridas}/${p.missoes.length} missões com estrela ${semanaDelaTxt(p.inicio, p.fim)} ▾</span></div>
            <div class="es-bar"><div style="width:${Math.min(100, pct)}%;background:#F59E0B;"></div></div></div>
          <div style="text-align:right;white-space:nowrap;font-weight:900;color:#B45309;">${p.estrelas} ⭐<span style="font-size:10px;color:var(--muted);"> /${p.possiveis} · ${pct}%</span></div>
        </div>
        ${ab ? `<div style="margin:8px 0 0 36px;">${p.missoes.map(m => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding:3px 0;border-bottom:1px dashed #E2E8F0;">
          <span>${m.compartilhada ? '👥 ' : ''}${esc(m.label)}</span>
          <span style="white-space:nowrap;">${m.limite ? `${m.vezes || 0}/${m.limite}` : ''} · <strong style="color:${m.ganhas ? '#B45309' : '#94A3B8'};">${m.ganhas} ⭐</strong></span></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;

  const evolucao = cron.length > 1 ? `<div class="card" style="overflow-x:auto;">
    <div style="font-weight:800;font-size:14px;margin-bottom:8px;">📊 Evolução de cada uma (estrelas por semana)</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:${180 + cron.length * 70}px;">
      <tr style="color:var(--muted);font-size:11px;"><th style="text-align:left;padding:4px;">Pessoa</th>${cron.map(s => `<th style="padding:4px;">${br(s.weekKey)}${s.atual ? '*' : ''}</th>`).join('')}<th style="padding:4px;">Tendência</th></tr>
      ${ordemEvo.map(id => {
        const vals = cron.map(s => { const p = s.ranking.find(q => q.colabId === id); return p ? { e: p.estrelas, pos: s.ranking.indexOf(p) + 1, pct: p.possiveis ? Math.round(p.estrelas / p.possiveis * 100) : 0 } : null; });
        const fech = cron.map((s, k) => s.atual ? null : vals[k]).filter(Boolean);
        const tend = fech.length >= 2 ? fech[fech.length - 1].e - fech[fech.length - 2].e : null;
        return `<tr style="border-top:1px solid #F1F5F9;"><td style="padding:5px 4px;font-weight:700;">${esc(nomes.get(id).nome)} <span style="color:var(--muted);">${icone(nomes.get(id).setor)}</span></td>
          ${vals.map(v => `<td style="text-align:center;padding:5px 4px;">${v ? `<b style="color:#B45309;">${v.e}⭐</b><div style="font-size:10px;color:var(--muted);">${v.pos}º · ${v.pct}%</div>` : '<span style="color:#CBD5E1;">—</span>'}</td>`).join('')}
          <td style="text-align:center;font-weight:800;color:${tend == null ? '#94A3B8' : tend > 0 ? '#15803D' : tend < 0 ? '#B91C1C' : '#475569'};">${tend == null ? '—' : tend > 0 ? '▲ +' + tend : tend < 0 ? '▼ ' + tend : '= 0'}</td></tr>`;
      }).join('')}
    </table>
    ${cron.some(s => s.atual) ? '<div style="font-size:10.5px;color:var(--muted);margin-top:6px;">* semana em andamento (fica de fora da tendência).</div>' : ''}
  </div>` : '';

  return ranking + evolucao + blocoSugestoes();
}

function blocoSugestoes() {
  if (!_sug?.semanaBase) return `<div class="card"><div style="font-weight:800;font-size:14px;">💡 Sugestões para a próxima semana</div><div style="font-size:12px;color:var(--muted);margin-top:6px;">${esc(_sug?.aviso || 'Ainda não tem semana fechada pra comparar.')}</div></div>`;
  const b = _sug.semanaBase;
  return `<div class="card">
    <div style="font-weight:800;font-size:14px;">💡 Sugestões de alvo para a próxima semana</div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:4px;line-height:1.45;">Com base na semana <b>${rotuloSemana(b.weekKey)}</b>, dia a dia de cada uma (só dias trabalhados).
      ⬆️ cumpriu tudo com folga · ⬇️ não cumpriu nenhuma vez e ficou longe (desce no máx. pela metade) · ➡️ ficou perto ou está no ponto.
      Missão 👥 compartilhada vale o melhor da dupla. "Todos os pedidos" (100%) nunca baixa.<br>
      <b>Aplicar</b> grava o alvo dessa pessoa nessa missão (igual à aba Equipe) e vale dali pra frente em toda semana que tiver a mesma missão.</div>
    ${_sug.pessoas.map((p, pi) => {
      const mudar = p.itens.filter(it => it.acao !== 'manter');
      const pend = mudar.filter(it => _alvoAtualDe(p.colabId, it.missaoId) !== it.novoAlvo);
      const ab = st.sugAberto === p.colabId;
      const dif = p.estrelasAnterior == null ? '' : p.estrelas - p.estrelasAnterior;
      return `<div style="border:1px solid #E2E8F0;border-radius:12px;padding:10px 12px;margin-top:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div style="cursor:pointer;min-width:0;" onclick="esSugAbrir('${p.colabId}')"><div style="font-weight:800;">${esc(p.nome)} <span style="font-size:11px;color:var(--muted);">${_data.setores?.[p.setor]?.icon || ''} ▾</span></div>
            <div style="font-size:11px;color:var(--muted);">${p.estrelas}/${p.possiveis} ⭐${dif === '' ? '' : ` · ${dif > 0 ? '▲ +' + dif : dif < 0 ? '▼ ' + dif : '='} vs semana anterior`}
              · <span style="color:#15803D;">${p.itens.filter(x => x.acao === 'aumentar').length} ⬆️</span> <span style="color:#B91C1C;">${p.itens.filter(x => x.acao === 'diminuir').length} ⬇️</span> ${p.itens.filter(x => x.acao === 'manter').length} ➡️</div></div>
          ${pend.length ? `<button class="es-btn p" onclick="esAplicarSugTodas(${pi})">✅ Aplicar as ${pend.length} mudanças</button>` : mudar.length ? '<span style="font-size:11px;color:#15803D;font-weight:800;">✅ Mudanças aplicadas</span>' : '<span style="font-size:11px;color:var(--muted);">Nada pra mudar</span>'}
        </div>
        ${ab || mudar.length ? `<div style="margin-top:8px;">${(ab ? p.itens : mudar).map(it => {
          const a = _ACAO[it.acao];
          const ii = p.itens.indexOf(it);
          const aplicado = it.acao !== 'manter' && _alvoAtualDe(p.colabId, it.missaoId) === it.novoAlvo;
          // Etiqueta + alvo em cima; missão e motivo na largura toda (cabe no celular).
          return `<div style="padding:8px 0;border-top:1px dashed #E2E8F0;font-size:12px;">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span style="background:${a.bg};color:${a.cor};font-weight:800;border-radius:8px;padding:2px 7px;white-space:nowrap;font-size:11px;">${a.t}</span>
              <span style="margin-left:auto;white-space:nowrap;display:flex;gap:8px;align-items:center;">${it.acao === 'manter' ? `<b>${_fmtAlvo(it.alvoAtual, it)}</b>` : `<span><span style="color:var(--muted);text-decoration:line-through;">${_fmtAlvo(it.alvoAtual, it)}</span> → <b style="color:${a.cor};">${_fmtAlvo(it.novoAlvo, it)}</b></span>
                ${aplicado ? '<span style="font-size:11px;color:#15803D;font-weight:800;">✅ aplicado</span>' : `<button class="es-btn" style="padding:2px 8px;" onclick="esAplicarSug(${pi},${ii})">Aplicar</button>`}`}</span>
            </div>
            <div style="font-weight:700;margin-top:4px;">${esc(it.label)}</div>
            <div style="color:var(--muted);font-size:11px;margin-top:1px;">${esc(it.motivo)}${it.semanaAnterior ? ` · semana anterior: ${it.semanaAnterior.vezes}/${it.semanaAnterior.limite}` : ''}</div>
          </div>`;
        }).join('')}
        ${!ab && p.itens.length > mudar.length ? `<div style="font-size:11px;color:var(--muted);padding-top:6px;cursor:pointer;" onclick="esSugAbrir('${p.colabId}')">+ ${p.itens.length - mudar.length} pra manter — ver todas ▾</div>` : ''}</div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}
async function aplicarSugestoes(colabId, itens) {
  if (!itens.length) return;
  const atual = _data.config?.porColab?.[colabId] || {};
  const overrides = { ...(atual.overrides || {}) };
  for (const it of itens) overrides[it.missaoId] = { ...(overrides[it.missaoId] || {}), alvo: it.novoAlvo };
  const porColab = { ...(_data.config?.porColab || {}), [colabId]: { ...atual, desativadas: atual.desativadas || [], overrides } };
  await salvarCfg({ porColab }, itens.length > 1 ? `🎯 ${itens.length} alvos atualizados!` : '🎯 Alvo atualizado!');
}
window.esHistSem = (k) => { st.histSem = k; _render(); };
window.esHistAbrir = (k) => { st.histAberto = st.histAberto === k ? '' : k; _render(); };
window.esSugAbrir = (id) => { st.sugAberto = st.sugAberto === id ? '' : id; _render(); };
window.esHistRecarregar = () => { _hist = null; _sug = null; _histErro = ''; _render(); };
window.esAplicarSug = (pi, ii) => {
  const p = _sug?.pessoas?.[pi], it = p?.itens?.[ii];
  if (it) aplicarSugestoes(p.colabId, [it]);
};
window.esAplicarSugTodas = (pi) => {
  const p = _sug?.pessoas?.[pi];
  if (!p) return;
  const itens = p.itens.filter(it => it.acao !== 'manter' && _alvoAtualDe(p.colabId, it.missaoId) !== it.novoAlvo);
  if (!itens.length) return;
  if (!confirm(`Aplicar ${itens.length} novo(s) alvo(s) para ${p.nome}?\n\n` + itens.map(it => `• ${it.label}: ${_fmtAlvo(it.alvoAtual, it)} → ${_fmtAlvo(it.novoAlvo, it)}`).join('\n'))) return;
  aplicarSugestoes(p.colabId, itens);
};

// ── ⚡ METAS RELÂMPAGO (criador) ─────────────────────────────────────────
// Data/hora em Manaus (UTC-4) pros inputs datetime-local e exibição.
const _fmtManaus = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
// "agora" (ou now+min) como valor de <input type=datetime-local> em horário Manaus.
function _manausLocal(addMin = 0) {
  const d = new Date(Date.now() - 4 * 3600e3 + addMin * 60000);
  return d.toISOString().slice(0, 16);
}
// datetime-local (naïve, tratado como Manaus) → ISO absoluto.
const _localParaISO = (v) => v ? new Date(v + ':00-04:00').toISOString() : null;
const _publicoTxt = (p, setores, colabs) => {
  if (!p || p.tipo === 'todas') return '👥 Todas';
  if (p.tipo === 'setor') return '🏷️ ' + (p.setores || []).map(s => setores?.[s]?.label || s).join(', ');
  return '🙋 ' + (p.colabIds || []).map(id => (colabs || []).find(c => c.id === id)?.nome || '—').join(', ');
};

function tabRelampago() {
  const metas = _data.config?.metasRelampago || [];
  const setores = _data.setores || {};
  const colabs = _data.colabs || [];
  const now = Date.now();
  const ativas = metas.filter(m => new Date(m.fim).getTime() > now).sort((a, b) => new Date(a.fim) - new Date(b.fim));
  const encerradas = metas.filter(m => new Date(m.fim).getTime() <= now).sort((a, b) => new Date(b.fim) - new Date(a.fim)).slice(0, 12);
  const cardMeta = (m, enc) => {
    const ini = new Date(m.inicio).getTime(), fim = new Date(m.fim).getTime();
    const estado = enc ? '<span style="color:#64748B;">⛔ encerrada</span>' : (now < ini ? '<span style="color:#2563EB;">🕒 agendada</span>' : '<span style="color:#059669;font-weight:800;">🟢 no ar agora</span>');
    const alvoTx = m.modo === 'manual' ? '✋ baixa manual' : `${_data.metricasRelampago?.find(x => x.key === m.metrica)?.label || m.metrica}: ${m.metrica === 'faturamento' ? $c(m.alvo) : m.alvo}${m.metrica === 'vendaAcima' ? ` (acima de ${$c(m.valorMin)})` : ''}${m.metrica === 'itensNome' && m.nomeContem ? ` ["${esc(m.nomeContem)}"]` : ''}`;
    const baixas = m.baixas || [];
    return `<div style="border:1.5px solid ${enc ? '#E2E8F0' : '#DDD6FE'};border-radius:12px;padding:11px 12px;margin-bottom:9px;background:${enc ? '#F8FAFC' : '#FBFAFF'};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="min-width:0;"><div style="font-weight:800;font-size:13.5px;">${esc(m.icon || '⚡')} ${esc(m.nome)}</div>
          ${m.detalhes ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${esc(m.detalhes)}</div>` : ''}
          <div style="font-size:11px;color:#475569;margin-top:4px;">${estado} · ⏱️ ${_fmtManaus(m.inicio)} → ${_fmtManaus(m.fim)}</div>
          <div style="font-size:11px;color:#475569;margin-top:3px;">🎯 ${alvoTx} · 🎁 ${m.estrelas}⭐${m.bonusRs > 0 ? ' + ' + $c(m.bonusRs) : ''} · ${_publicoTxt(m.publico, setores, colabs)}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex:0 0 auto;">
          ${!enc ? `<button class="es-btn r" onclick="esRlEncerrar('${m.id}')" title="Terminar agora">⛔ Encerrar</button>` : ''}
          <button class="es-btn" onclick="esRlRemover('${m.id}')" title="Apagar">🗑️ Remover</button>
        </div>
      </div>
      ${m.modo === 'manual' ? `<div style="margin-top:8px;border-top:1px dashed #E2E8F0;padding-top:7px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          <select id="rl-bx-${m.id}" class="fi" style="max-width:190px;font-size:12px;"><option value="">— dar baixa pra… —</option>${colabs.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select>
          <button class="es-btn g" onclick="esRlBaixa('${m.id}')">✅ Cumpriu</button>
        </div>
        ${baixas.length ? `<div style="margin-top:6px;display:flex;gap:5px;flex-wrap:wrap;">${baixas.map(b => `<span style="background:#DCFCE7;color:#166534;border-radius:999px;padding:3px 9px;font-size:11px;font-weight:700;">✔ ${esc(b.colabNome || (colabs.find(c => c.id === String(b.colabId))?.nome) || 'colaboradora')} <button onclick="esRlDesfazBaixa('${m.id}','${b.colabId}')" style="border:none;background:none;cursor:pointer;color:#166534;">✕</button></span>`).join('')}</div>` : '<div style="font-size:11px;color:var(--muted);margin-top:5px;">Ninguém deu baixa ainda.</div>'}
      </div>` : ''}
    </div>`;
  };

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div><div style="font-weight:900;font-size:15px;">⚡ Metas Relâmpago</div>
        <div style="font-size:11.5px;color:var(--muted);">Missões com tempo curto que aparecem num card flutuante, ao vivo, na tela das colaboradoras.</div></div>
      <button class="btn btn-primary" style="justify-content:center;" onclick="esRlAbrir()">➕ Nova meta relâmpago</button>
    </div>
    ${st.rl.aberto ? rlFormulario(setores, colabs) : ''}
    <div style="margin-top:14px;font-weight:800;font-size:12.5px;color:#6D28D9;">No ar / agendadas (${ativas.length})</div>
    ${ativas.length ? ativas.map(m => cardMeta(m, false)).join('') : '<div style="font-size:12px;color:var(--muted);padding:10px 0;">Nenhuma meta relâmpago ativa. Crie uma acima. ⚡</div>'}
    ${encerradas.length ? `<div style="margin-top:12px;font-weight:800;font-size:12.5px;color:#94A3B8;">Encerradas</div>${encerradas.map(m => cardMeta(m, true)).join('')}` : ''}
  </div>`;
}

function rlFormulario(setores, colabs) {
  const r = st.rl;
  const mets = (_data.metricasRelampago || []).filter(x => x.key !== 'manual');
  return `<div style="border:2px solid #C4B5FD;border-radius:14px;padding:14px;margin-top:12px;background:linear-gradient(135deg,#FAF5FF,#fff);">
    <div style="font-weight:900;font-size:14px;margin-bottom:10px;color:#6D28D9;">➕ Nova meta relâmpago</div>
    <div class="es-form">
      <label style="max-width:84px;">Ícone<input class="fi" id="rl-icon" maxlength="4" value="⚡" style="text-align:center;font-size:18px;"/></label>
      <label class="full">Nome<input class="fi" id="rl-nome" placeholder="Ex.: Vender 10 chocolates em 1 hora!"/></label>
      <label class="full">Detalhes (opcional)<input class="fi" id="rl-det" placeholder="Explica a missão em poucas palavras"/></label>

      <label class="full" style="margin-top:2px;">Quando<div style="display:flex;gap:12px;flex-wrap:wrap;font-weight:600;">
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-quando" ${r.comecarAgora ? 'checked' : ''} onchange="esRlQuando(true)"/> Começar agora</span>
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-quando" ${!r.comecarAgora ? 'checked' : ''} onchange="esRlQuando(false)"/> Agendar início/fim</span>
      </div></label>
      ${r.comecarAgora
        ? `<label class="full">Duração<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
             <input class="fi" id="rl-dur" type="number" min="1" value="60" style="max-width:100px;"/> minutos
             ${[15, 30, 60, 120].map(n => `<button type="button" class="es-chip" onclick="document.getElementById('rl-dur').value=${n}">${n < 60 ? n + 'm' : (n / 60) + 'h'}</button>`).join('')}
           </div></label>`
        : `<label>Início<input class="fi" id="rl-ini" type="datetime-local" value="${_manausLocal(0)}"/></label>
           <label>Fim<input class="fi" id="rl-fim" type="datetime-local" value="${_manausLocal(60)}"/></label>`}

      <label class="full" style="margin-top:2px;">Como mede<div style="display:flex;gap:12px;flex-wrap:wrap;font-weight:600;">
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-modo" ${r.modo === 'auto' ? 'checked' : ''} onchange="esRlModo('auto')"/> 🤖 Automático (o sistema conta)</span>
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-modo" ${r.modo === 'manual' ? 'checked' : ''} onchange="esRlModo('manual')"/> ✋ Manual (a gerência dá baixa)</span>
      </div></label>
      ${r.modo === 'auto' ? `
        <label class="full">O que mede<select class="fi" id="rl-metrica" onchange="esRlMetrica(this.value)">${mets.map(x => `<option value="${x.key}" ${r.metrica === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
        <label>Alvo${r.metrica === 'faturamento' ? ' (R$)' : ''}<input class="fi" id="rl-alvo" type="number" min="0" value="0"/></label>
        ${r.metrica === 'vendaAcima' ? `<label>Valor mínimo da venda (R$)<input class="fi" id="rl-valor" type="number" min="0" value="0"/></label>` : ''}
        ${r.metrica === 'itensNome' ? `<label class="full">Nome do item contém (separe por vírgula)<input class="fi" id="rl-texto" placeholder="ferrero, bombom, chocolate"/></label>` : ''}
      ` : ''}

      <label>Recompensa ⭐<input class="fi" id="rl-estrelas" type="number" min="0" max="100" value="3"/></label>
      <label>Bônus em R$ (opcional)<input class="fi" id="rl-bonus" type="number" min="0" value="0"/></label>

      <label class="full" style="margin-top:2px;">Quem participa<div style="display:flex;gap:12px;flex-wrap:wrap;font-weight:600;">
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-pub" ${r.publico === 'todas' ? 'checked' : ''} onchange="esRlPublico('todas')"/> Todas</span>
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-pub" ${r.publico === 'setor' ? 'checked' : ''} onchange="esRlPublico('setor')"/> Por setor</span>
        <span style="display:flex;gap:5px;align-items:center;"><input type="radio" name="rl-pub" ${r.publico === 'pessoas' ? 'checked' : ''} onchange="esRlPublico('pessoas')"/> Pessoas específicas</span>
      </div></label>
      ${r.publico === 'setor' ? `<div class="full" style="display:flex;gap:6px;flex-wrap:wrap;">${Object.entries(setores).map(([k, v]) => `<label style="flex-direction:row;gap:5px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:4px 10px;"><input type="checkbox" class="rl-setor" value="${k}"/> ${v.icon} ${esc(v.label)}</label>`).join('')}</div>` : ''}
      ${r.publico === 'pessoas' ? `<div class="full" style="display:flex;gap:6px;flex-wrap:wrap;max-height:160px;overflow:auto;">${colabs.map(c => `<label style="flex-direction:row;gap:5px;align-items:center;border:1px solid var(--border);border-radius:999px;padding:4px 10px;"><input type="checkbox" class="rl-pessoa" value="${c.id}"/> ${esc(c.nome)}</label>`).join('')}</div>` : ''}
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn btn-ghost" style="flex:1;justify-content:center;" onclick="esRlFechar()">Cancelar</button>
      <button class="btn btn-primary" style="flex:2;justify-content:center;" onclick="esRlCriar()">⚡ Lançar meta relâmpago</button>
    </div>
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
window.esQtd = (i, v) => { const l = setoresDaSemana(st.semana)[st.setor]; if (!l[i]) return; aplicarQtd(l[i], v); _dirty = true; _render(); };
window.esMinutos = (i, v) => { const l = setoresDaSemana(st.semana)[st.setor]; if (!l[i]) return; aplicarMinutos(l[i], v); _dirty = true; _render(); };
window.esValorMin = (i, v) => { const l = setoresDaSemana(st.semana)[st.setor]; if (!l[i]) return; aplicarValor(l[i], v); _dirty = true; _render(); };
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
  show('ed-wrap-min', !!met.precisaMinutos); show('ed-wrap-fontes', !!met.usaFontes); show('ed-wrap-prim', !!met.usaSoPrimeiro); show('ed-wrap-ret', !!met.usaSoRetirada);
  show('ed-wrap-ate', !!met.precisaAteHora); show('ed-wrap-prazo', !!met.precisaPrazoAte); show('ed-wrap-minped', !!met.usaMinPedidosDia);
};
window.esEdCalc = () => { const el = document.getElementById('ed-calc'); if (el) el.textContent = `Vale até ${maxM(lerEditor())} ⭐ na semana`; };
window.esConfirmarEditor = async () => {
  const m = lerEditor();
  if (!m.nome) return toast('Dê um nome à missão', true);
  // Mudou o alvo/valor sem mexer no nome? Atualiza o número do nome junto.
  const orig = st.editor.mis || {};
  if (m.nome === orig.nome) {
    if (m.metrica !== 'manual' && Number(orig.alvo) !== Number(m.alvo)) m.nome = trocaNoNome(m.nome, orig.alvo, m.alvo);
    if (m.metrica === 'vendaAcima' && Number(orig.valorMin) !== Number(m.valorMin)) m.nome = trocaNoNome(m.nome, orig.valorMin, m.valorMin, true);
  }
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
  const liberadas = [...document.querySelectorAll('.es-prev:checked')].map(x => x.dataset.colab);
  const entradas = {};
  document.querySelectorAll('.es-ent').forEach(i => { if (i.value) entradas[i.dataset.colab] = i.value; });
  try {
    await PUT('/campanha/equipe', { equipe });
    await PUT('/campanha/config', { liberadas, entradas });
    toast('💾 Equipe salva!'); await recarregar();
  } catch (e) { toast('❌ ' + e.message, true); }
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
    const tipo = document.getElementById('es-pen-tipo')?.value, estrelas = Number(document.getElementById('es-pen-qtd')?.value) || 0;
    if (estrelas < 1) return toast('Informe quantas estrelas', true);
    await POST('/campanha/penalidade', { colabId, colabNome: sel.dataset?.nome || sel.selectedOptions?.[0]?.dataset.nome || '', tipo, estrelas,
      data: document.getElementById('es-pen-data')?.value || '', motivo: document.getElementById('es-pen-motivo')?.value || '' });
    toast(tipo === 'extra' ? `⭐ +${estrelas} estrela(s) lançada(s)!` : `⚠️ −${estrelas} estrela(s) descontada(s).`); await recarregar();
    window.dispatchEvent(new Event('estrelas-ajuste'));
  } catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esDelPenalidade = async (id) => {
  if (!confirm(id.startsWith('auto_') ? 'Perdoar este atraso (tira o desconto deste dia)?' : 'Apagar este lançamento?')) return;
  try { await DELETE('/campanha/penalidade/' + id); await recarregar(); window.dispatchEvent(new Event('estrelas-ajuste')); } catch (e) { toast('❌ ' + e.message, true); }
};
window.esDetalhe = async (colabId, missao) => {
  st.detalhe = { carregando: true }; _render();
  try {
    const q = new URLSearchParams({ colabId, missao });
    // Semana DELA (pode não ser seg→dom): o 1º dia da semana que o ranking mostrou.
    const dela = (_ranking?.ranking || []).find(p => String(p.colabId) === String(colabId));
    if (dela?.startISO) q.set('dia', dela.startISO); else if (_ranking?.weekKey) q.set('dia', _ranking.weekKey);
    st.detalhe = { dados: await GET('/campanha/detalhe?' + q.toString()) };
  } catch (e) { st.detalhe = { erro: e.message || 'Erro ao carregar' }; }
  _render();
};
window.esFecharDetalhe = () => { st.detalhe = null; _render(); };
window.esRank = (id) => { st.rankAberto = st.rankAberto === id ? '' : id; _render(); };

// ── ⚡ METAS RELÂMPAGO (handlers) ─────────────────────────────────────────
window.esRlAbrir = () => { st.rl = { aberto: true, modo: 'auto', metrica: 'vendas', publico: 'todas', comecarAgora: true }; _render(); };
window.esRlFechar = () => { st.rl.aberto = false; _render(); };
window.esRlQuando = (agora) => { st.rl.comecarAgora = !!agora; _render(); };
window.esRlModo = (modo) => { st.rl.modo = modo; _render(); };
window.esRlMetrica = (metrica) => { st.rl.metrica = metrica; _render(); };
window.esRlPublico = (tipo) => { st.rl.publico = tipo; _render(); };
window.esRlCriar = async () => {
  const g = (id) => document.getElementById(id);
  const nome = (g('rl-nome')?.value || '').trim();
  if (!nome) return toast('Dê um nome à meta', true);
  const body = {
    nome, detalhes: (g('rl-det')?.value || '').trim(), icon: g('rl-icon')?.value || '⚡',
    modo: st.rl.modo, estrelas: Number(g('rl-estrelas')?.value) || 0, bonusRs: Number(g('rl-bonus')?.value) || 0,
    publico: { tipo: st.rl.publico, setores: [], colabIds: [] },
  };
  if (st.rl.comecarAgora) { body.duracaoMin = Number(g('rl-dur')?.value) || 0; if (!(body.duracaoMin > 0)) return toast('Informe a duração em minutos', true); }
  else {
    const ini = g('rl-ini')?.value, fim = g('rl-fim')?.value;
    if (!ini || !fim) return toast('Informe início e fim', true);
    body.inicio = _localParaISO(ini); body.fim = _localParaISO(fim);
  }
  if (st.rl.modo === 'auto') {
    body.metrica = st.rl.metrica;
    body.alvo = Number(g('rl-alvo')?.value) || 0;
    if (!(body.alvo > 0)) return toast('Informe o alvo (quanto precisa atingir)', true);
    if (st.rl.metrica === 'vendaAcima') body.valorMin = Number(g('rl-valor')?.value) || 0;
    if (st.rl.metrica === 'itensNome') body.nomeContem = (g('rl-texto')?.value || '').trim();
  }
  if (st.rl.publico === 'setor') { body.publico.setores = [...document.querySelectorAll('.rl-setor:checked')].map(c => c.value); if (!body.publico.setores.length) return toast('Escolha pelo menos um setor', true); }
  if (st.rl.publico === 'pessoas') { body.publico.colabIds = [...document.querySelectorAll('.rl-pessoa:checked')].map(c => c.value); if (!body.publico.colabIds.length) return toast('Escolha pelo menos uma pessoa', true); }
  try { await POST('/campanha/relampago', body); toast('⚡ Meta relâmpago no ar! O card já apareceu pra equipe.'); st.rl.aberto = false; await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esRlEncerrar = async (id) => {
  if (!confirm('Encerrar esta meta agora? O card some da tela da equipe.')) return;
  try { await PUT('/campanha/relampago/' + id, { fim: new Date().toISOString() }); toast('⛔ Meta encerrada.'); await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esRlRemover = async (id) => {
  if (!confirm('Remover esta meta relâmpago de vez?')) return;
  try { await DELETE('/campanha/relampago/' + id); toast('🗑️ Removida.'); await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esRlBaixa = async (id) => {
  const sel = document.getElementById('rl-bx-' + id);
  const colabId = sel?.value; if (!colabId) return toast('Escolha a colaboradora', true);
  const colabNome = (_data.colabs || []).find(c => c.id === colabId)?.nome || '';
  try { await POST('/campanha/relampago/' + id + '/baixa', { colabId, colabNome }); toast('✅ Baixa dada!'); await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.esRlDesfazBaixa = async (id, colabId) => {
  try { await DELETE('/campanha/relampago/' + id + '/baixa/' + colabId); await recarregar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
