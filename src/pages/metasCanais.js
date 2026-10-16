// ── CONFIGURAR METAS (só gerência) — Marcia out/2026 ─────────────────
// Meta mensal por canal × cenário (Realista/Agressiva), cenário ativo das
// atendentes, atendentes vinculadas por unidade (CDLE, Loja 2) com dias de
// trabalho, ticket meta/supermeta. Tudo salvo no banco (/metas/config/:mes),
// com histórico de quem alterou e quando. Valores trafegam em CENTAVOS.
import { GET, PUT } from '../services/api.js';
import { S } from '../state.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';
import { renderCampanha } from './campanha.js';

export const CANAIS = ['cdle', 'site', 'loja2', 'ifood', 'giuliana'];
export const CANAL_LABEL = {
  cdle: 'CDLE (atendentes)', site: 'Site / e-commerce', loja2: 'Loja 2 (Novo Aleixo)',
  ifood: 'iFood', giuliana: 'Giuliana',
};
export const UNIDADES = ['cdle', 'loja2'];

// Centavos → "R$ 1.234,56"
export const $cc = (c) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((Number(c) || 0) / 100);
// Reais inteiros → "R$ 3.946"
export const $ri = (r) => r == null ? '—' : 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(r);

export function ehGerencia() {
  const r = String(S.user?.role || '').toLowerCase(), c = String(S.user?.cargo || '').toLowerCase();
  return r === 'administrador' || c === 'admin' || c === 'administrador' || r === 'gerente' || c === 'gerente';
}

export function mesAtualManaus() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' }).slice(0, 7);
}
export function mesesOpcoes() {
  const set = new Set(['2026-10', '2026-11', '2026-12']);
  const atual = mesAtualManaus();
  const [y, m] = atual.split('-').map(Number);
  set.add(atual);
  set.add(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7));
  return [...set].sort();
}
export const nomeMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

let _mes = null;
let _cfg = null;        // config do mês (centavos)
let _rel = null;        // /metas/relatorio do mês (dias restantes atuais)
let _hist = null;
let _colabs = null;
let _loading = false;
let _erro = '';

async function _render() { const m = await import('../main.js'); m.render(); }

async function carregar() {
  _loading = true; _erro = '';
  try {
    const [cfg, rel, hist, colabs] = await Promise.all([
      GET('/metas/config/' + _mes),
      GET(`/metas/relatorio?mes=${_mes}`).catch(() => null),
      GET(`/metas/config/${_mes}/historico`).catch(() => []),
      _colabs ? Promise.resolve(_colabs) : GET('/collaborators').catch(() => []),
    ]);
    _cfg = cfg; _rel = rel; _hist = hist; _colabs = colabs;
  } catch (e) { _erro = e.message || 'Erro ao carregar'; }
  _loading = false;
}

const reais = (c) => ((Number(c) || 0) / 100).toFixed(2);
const inp = (id, val, extra = '') =>
  `<input class="fi" id="${id}" type="number" step="0.01" min="0" value="${val}" ${extra} style="width:120px;text-align:right;"/>`;

function linhaAtendente(u, a) {
  const atual = (_rel?.porAtendente || []).find(x => x.colabId === String(a.colabId));
  const restante = a.diasRestantesManual != null ? a.diasRestantesManual : (atual?.diasRestantes ?? '');
  const marca = a.diasRestantesManual != null
    ? `<span title="Ajustado à mão em ${esc(a.diasRestantesManualEm || '')}" style="color:#B45309;font-size:11px;">✋ manual</span>
       <button type="button" class="btn btn-ghost btn-sm" onclick="metasCfgAuto('${u}','${a.colabId}')">↺ automático</button>`
    : `<span style="color:var(--muted);font-size:11px;">automático (ponto)</span>`;
  return `<tr data-u="${u}" data-colab="${esc(a.colabId)}" data-nome="${esc(a.nome)}" data-manual="${a.diasRestantesManual != null ? '1' : ''}">
    <td style="padding:6px;font-weight:600;">${esc(a.nome || a.colabId)}</td>
    <td style="padding:6px;"><input class="fi mc-dt" type="number" min="0" max="31" value="${a.diasTrabalhados ?? ''}" style="width:70px;"/></td>
    <td style="padding:6px;"><input class="fi mc-ds" type="number" min="1" max="7" value="${a.diasSemana ?? 5}" style="width:60px;"/></td>
    <td style="padding:6px;"><input class="fi mc-dr" type="number" min="0" max="31" value="${restante}" data-orig="${restante}" style="width:70px;"/> ${marca}</td>
    <td style="padding:6px;text-align:right;"><button type="button" onclick="this.closest('tr').remove()" style="background:#FEE2E2;color:#991B1B;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;">✕</button></td>
  </tr>`;
}

function blocoUnidade(u) {
  const un = _cfg.unidades?.[u] || { atendentes: [] };
  const vinculadas = new Set((un.atendentes || []).map(a => String(a.colabId)));
  const opcoes = (_colabs || [])
    .filter(c => c.active !== false && !/entregador/i.test(c.cargo || '') && !vinculadas.has(String(c._id)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(c => `<option value="${esc(c._id)}" data-nome="${esc(c.name)}">${esc(c.name)}${c.unidade ? ' — ' + esc(c.unidade) : ''}</option>`).join('');
  const calc = _rel?.unidades?.[u];
  const resumo = calc
    ? (calc.batida ? `🎉 Meta batida — passou ${(calc.excedente / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
      : `Falta ${(calc.falta / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${calc.somaDias} dias · meta diária hoje <strong>${$ri(calc.metaDiaria)}</strong>`)
    : '';
  return `<div class="card" style="margin-top:14px;">
    <div class="card-title">👩‍💼 ${CANAL_LABEL[u]} — atendentes da meta</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 12px;">
      <label style="font-size:12px;">Ticket meta (R$)<br/>${inp(`mc-tm-${u}`, reais(un.ticketMeta))}</label>
      <label style="font-size:12px;">Ticket supermeta (R$)<br/>${inp(`mc-ts-${u}`, reais(un.ticketSuper))}</label>
      <div style="font-size:12px;color:var(--muted);align-self:flex-end;">${resumo}</div>
    </div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--muted);font-size:11px;">
        <th style="padding:6px;">Atendente</th><th style="padding:6px;">Dias trabalhados no mês</th>
        <th style="padding:6px;">Dias por semana</th><th style="padding:6px;">Dias que ainda faltam</th><th></th>
      </tr></thead>
      <tbody id="mc-at-${u}">${(un.atendentes || []).map(a => linhaAtendente(u, a)).join('')}</tbody>
    </table></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <select class="fi" id="mc-add-${u}" style="max-width:280px;"><option value="">+ vincular atendente…</option>${opcoes}</select>
      <button type="button" class="btn btn-ghost btn-sm" onclick="metasCfgAdd('${u}')">Adicionar</button>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px;">
      "Dias que ainda faltam" é calculado pelo ponto (dias trabalhados − dias já batidos). Se você digitar outro número
      (folga, férias, atestado), ele passa a valer a partir de hoje e vai descontando conforme ela bate o ponto.
    </div>
  </div>`;
}

export function renderMetasCanais() {
  if (!ehGerencia()) {
    return `<div class="card" style="text-align:center;padding:40px;">🔒 Só a gerência configura as metas.</div>`;
  }
  if (!_mes) _mes = mesAtualManaus();
  if (!_cfg && !_loading && !_erro) carregar().then(_render);
  if (_erro) return `<div class="card" style="color:var(--red);padding:20px;">⚠️ ${esc(_erro)} <button class="btn btn-ghost btn-sm" onclick="metasCfgMes('${_mes}')">Tentar de novo</button></div>`;
  if (!_cfg) return `<div class="card"><div class="card-title">🎯 Configurar metas</div><div style="text-align:center;padding:30px;color:var(--muted);">⏳ Carregando…</div></div>`;

  const somaCen = (k) => CANAIS.reduce((s, c) => s + (Number(_cfg.canais?.[c]?.[k]) || 0), 0);
  const hist = (_hist || []).slice(0, 30).map(h => `<tr>
      <td style="padding:4px 6px;white-space:nowrap;">${new Date(h.em).toLocaleString('pt-BR', { timeZone: 'America/Manaus' })}</td>
      <td style="padding:4px 6px;">${esc(h.por || '—')}</td>
      <td style="padding:4px 6px;font-size:11px;">${(h.mudancas || []).slice(0, 12).map(m => `${esc(m.campo)}: <s>${esc(JSON.stringify(m.antes))}</s> → <strong>${esc(JSON.stringify(m.depois))}</strong>`).join('<br/>')}${(h.mudancas || []).length > 12 ? `<br/>… +${h.mudancas.length - 12}` : ''}</td>
    </tr>`).join('');

  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div class="card-title" style="margin:0;">🎯 Configurar metas — ${esc(nomeMes(_mes))}</div>
      <select class="fi" style="max-width:200px;" onchange="metasCfgMes(this.value)">
        ${mesesOpcoes().map(m => `<option value="${m}" ${m === _mes ? 'selected' : ''}>${esc(nomeMes(m))}</option>`).join('')}
      </select>
    </div>
    <div style="overflow-x:auto;margin-top:12px;"><table style="border-collapse:collapse;font-size:13px;">
      <thead><tr style="color:var(--muted);font-size:11px;text-align:left;"><th style="padding:6px;">Canal</th><th style="padding:6px;">Realista (R$)</th><th style="padding:6px;">Agressiva (R$)</th></tr></thead>
      <tbody>
        ${CANAIS.map(c => `<tr><td style="padding:6px;font-weight:600;">${CANAL_LABEL[c]}</td>
          <td style="padding:6px;">${inp(`mc-${c}-realista`, reais(_cfg.canais?.[c]?.realista), 'oninput="metasCfgSoma()"')}</td>
          <td style="padding:6px;">${inp(`mc-${c}-agressiva`, reais(_cfg.canais?.[c]?.agressiva), 'oninput="metasCfgSoma()"')}</td></tr>`).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:800;"><td style="padding:6px;">Empresa (soma)</td>
          <td style="padding:6px;text-align:right;" id="mc-tot-realista">${$cc(somaCen('realista'))}</td>
          <td style="padding:6px;text-align:right;" id="mc-tot-agressiva">${$cc(somaCen('agressiva'))}</td></tr>
      </tbody>
    </table></div>
    <label style="display:block;margin-top:12px;font-size:13px;">Cenário ativo das atendentes neste mês:
      <select class="fi" id="mc-cenario" style="max-width:180px;margin-left:8px;">
        <option value="realista" ${_cfg.cenarioAtivo === 'realista' ? 'selected' : ''}>Realista</option>
        <option value="agressiva" ${_cfg.cenarioAtivo !== 'realista' ? 'selected' : ''}>Agressiva</option>
      </select></label>
    <div style="font-size:11px;color:var(--muted);margin-top:6px;">iFood e Giuliana não entram na meta nem na comissão das atendentes.</div>
  </div>
  ${UNIDADES.map(blocoUnidade).join('')}
  <div style="margin-top:14px;"><button type="button" class="btn btn-primary" style="width:100%;justify-content:center;padding:12px;" onclick="metasCfgSalvar()">💾 Salvar metas de ${esc(nomeMes(_mes))}</button></div>
  <div class="card" style="margin-top:14px;">
    <div class="card-title">🕑 Histórico de alterações</div>
    ${hist ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><tbody>${hist}</tbody></table></div>` : '<div style="color:var(--muted);font-size:12px;">Nenhuma alteração ainda.</div>'}
  </div>`;
}

const cent = (id) => Math.round((Number(document.getElementById(id)?.value) || 0) * 100);

function coletar() {
  const canais = Object.fromEntries(CANAIS.map(c => [c, { realista: cent(`mc-${c}-realista`), agressiva: cent(`mc-${c}-agressiva`) }]));
  const unidades = Object.fromEntries(UNIDADES.map(u => {
    const prev = _cfg.unidades?.[u]?.atendentes || [];
    const atendentes = [...document.querySelectorAll(`#mc-at-${u} tr`)].map(tr => {
      const id = tr.dataset.colab;
      const p = prev.find(a => String(a.colabId) === id) || {};
      const dr = tr.querySelector('.mc-dr');
      const mudouDias = dr && dr.value !== '' && dr.value !== dr.dataset.orig;
      let manual = tr.dataset.manual ? p.diasRestantesManual : null;
      let manualEm = tr.dataset.manual ? p.diasRestantesManualEm : null;
      if (mudouDias) { manual = Number(dr.value); manualEm = null; } // backend carimba hoje
      return {
        colabId: id, nome: tr.dataset.nome,
        diasTrabalhados: Number(tr.querySelector('.mc-dt')?.value) || 0,
        diasSemana: Number(tr.querySelector('.mc-ds')?.value) || 5,
        diasRestantesManual: manual, diasRestantesManualEm: manualEm,
      };
    });
    return [u, { ticketMeta: cent(`mc-tm-${u}`), ticketSuper: cent(`mc-ts-${u}`), atendentes }];
  }));
  return { canais, unidades, cenarioAtivo: document.getElementById('mc-cenario')?.value || 'agressiva' };
}

window.metasCfgMes = async (mes) => { _mes = mes; _cfg = null; _rel = null; _hist = null; await carregar(); _render(); };
window.metasCfgSoma = () => {
  for (const k of ['realista', 'agressiva']) {
    const t = CANAIS.reduce((s, c) => s + cent(`mc-${c}-${k}`), 0);
    const el = document.getElementById(`mc-tot-${k}`); if (el) el.textContent = $cc(t);
  }
};
window.metasCfgAdd = (u) => {
  const sel = document.getElementById(`mc-add-${u}`);
  const id = sel?.value; if (!id) return;
  const nome = sel.selectedOptions[0]?.dataset.nome || '';
  const [y, m] = _mes.split('-').map(Number);
  const dias = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const tbody = document.getElementById(`mc-at-${u}`);
  tbody.insertAdjacentHTML('beforeend', linhaAtendente(u, { colabId: id, nome, diasTrabalhados: Math.round(dias * 5 / 7), diasSemana: 5, diasRestantesManual: null }));
  sel.selectedOptions[0].remove(); sel.value = '';
};
window.metasCfgAuto = (u, id) => {
  const tr = document.querySelector(`#mc-at-${u} tr[data-colab="${CSS.escape(id)}"]`);
  if (!tr) return;
  tr.dataset.manual = '';
  const dr = tr.querySelector('.mc-dr'); if (dr) { dr.value = ''; dr.dataset.orig = ''; }
  toast('Dias restantes voltam ao automático ao salvar.');
};
window.metasCfgSalvar = async () => {
  try {
    const r = await PUT('/metas/config/' + _mes, coletar());
    toast(r?.mudancas?.length ? `✅ Metas salvas (${r.mudancas.length} alteração(ões))` : 'Nada mudou.');
    _cfg = null; await carregar(); _render();
  } catch (e) { toast('❌ Erro ao salvar: ' + (e.message || ''), true); }
};

// ── MÓDULO ÚNICO DE METAS (out/2026) ────────────────────────────────────
// Um menu só pra gerência, com 3 abas:
//   📅 Metas do mês  — canais × cenário, atendentes, dias (acima)
//   🚦 Meta da loja  — o sinaleiro da TV, calculado SOZINHO pela meta do mês
//   ⭐ Programa Estrelas — missões e bônus semanais (pages/campanha.js)

let _lojaHoje = null;      // /comissoes/resumo-dia → loja
let _lojaLoading = false;
const STATUS_TXT = { estrela: '⭐ Estrela', verde: '🟢 Bateu', amarelo: '🟡 Perto', vermelho: '🔴 Abaixo' };

function renderMetaLoja() {
  if (!_lojaHoje && !_lojaLoading) {
    _lojaLoading = true;
    GET('/comissoes/resumo-dia').then(r => { _lojaHoje = r?.loja || {}; })
      .catch(() => { _lojaHoje = {}; }).finally(() => { _lojaLoading = false; _render(); });
  }
  if (!_cfg && !_loading && !_erro) { if (!_mes) _mes = mesAtualManaus(); carregar().then(_render); }
  const l = _lojaHoje || {};
  const dias = (_rel?.diaADia || []);
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
  return `<div class="card">
    <div class="card-title">🚦 Meta da loja (sinaleiro da TV)</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">
      Calculada sozinha a partir das <strong>Metas do mês</strong>: para cada canal, o que falta da meta do mês ÷ os dias que faltam,
      somando os canais. Recalcula todo dia com as vendas até ontem — não precisa digitar nada aqui.
    </div>
    ${_lojaHoje ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
      <div style="background:#F0FDF4;border-radius:10px;padding:10px;"><div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;">Meta de hoje — realista</div><div style="font-size:20px;font-weight:900;color:#15803D;">${$ri(Math.round(l.realista || 0))}</div></div>
      <div style="background:#FDF2F8;border-radius:10px;padding:10px;"><div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;">Meta de hoje — agressiva</div><div style="font-size:20px;font-weight:900;color:#9D174D;">${$ri(Math.round(l.agressiva || 0))}</div></div>
      <div style="background:#EFF6FF;border-radius:10px;padding:10px;"><div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;">Vendido hoje</div><div style="font-size:20px;font-weight:900;color:#1E40AF;">${$cc(Math.round((l.faturamento || 0) * 100))}</div><div style="font-size:11px;">${STATUS_TXT[l.status] || ''}</div></div>
    </div>
    ${l.origem !== 'metas-do-mes' ? `<div style="margin-top:10px;font-size:12px;color:#B45309;">⚠️ Este mês ainda não tem Metas do mês preenchidas — a TV está usando a meta manual antiga.</div>` : ''}`
    : '<div style="color:var(--muted);padding:12px;">⏳ Carregando…</div>'}
  </div>
  ${dias.length ? `<div class="card" style="margin-top:14px;"><div class="card-title">📅 Meta do dia × vendido (${esc(nomeMes(_mes))}, cenário ${esc(_rel.cenario)})</div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="color:var(--muted);font-size:10px;text-align:left;"><th style="padding:5px;">Dia</th><th style="padding:5px;text-align:right;">Meta</th><th style="padding:5px;text-align:right;">Vendido</th><th style="padding:5px;">Status</th></tr></thead>
      <tbody>${dias.filter(d => d.dia <= hoje).map(d => `<tr style="border-top:1px solid var(--border);"><td style="padding:5px;">${d.dia.split('-').reverse().join('/')}</td><td style="padding:5px;text-align:right;">${d.meta == null ? '—' : $cc(d.meta)}</td><td style="padding:5px;text-align:right;font-weight:700;">${$cc(d.realizado)}</td><td style="padding:5px;">${STATUS_TXT[d.status] || ''}</td></tr>`).join('')}</tbody>
    </table></div></div>` : ''}`;
}

export function renderMetasHub() {
  if (!ehGerencia()) {
    return `<div class="card" style="text-align:center;padding:40px;">🔒 Só a gerência configura as metas.</div>`;
  }
  const tab = S._metasTab || 'mes';
  const b = (k, l) => `<button type="button" class="tab ${tab === k ? 'active' : ''}" onclick="metasTab('${k}')">${l}</button>`;
  const corpo = tab === 'estrelas' ? renderCampanha() : tab === 'loja' ? renderMetaLoja() : renderMetasCanais();
  return `<div class="tabs" style="margin-bottom:14px;">${b('mes', '📅 Metas do mês')}${b('loja', '🚦 Meta da loja')}${b('estrelas', '⭐ Programa Estrelas')}</div>${corpo}`;
}

window.metasTab = (t) => { S._metasTab = t; if (t === 'loja') _lojaHoje = null; _render(); };
