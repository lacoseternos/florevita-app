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
import { renderAcompanhamento, renderEstrelasEntregadoresGer } from './meuPainel.js';

export const CANAIS = ['cdle', 'site', 'loja2', 'ifood', 'giuliana'];
export const CANAL_LABEL = {
  cdle: 'WhatsApp — CDLE', site: 'Site / e-commerce', loja2: 'Balcão — Loja Novo Aleixo',
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
    <td style="padding:6px;white-space:nowrap;"><input class="fi mc-mdf" type="number" min="0" step="50" value="${a.metaDiaFixa || ''}" placeholder="auto" title="Meta diária fixa (R$). Vazio = calcula sozinha." style="width:90px;"/></td>
    <td style="padding:6px;white-space:nowrap;"><input class="fi mc-msf" type="number" min="0" step="100" value="${a.metaSemanaFixa || ''}" placeholder="auto" title="Meta semanal fixa (R$). Vazio = calcula sozinha." style="width:100px;"/></td>
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
    ? `${calc.batida ? `🎉 Mês batido — passou ${(calc.excedente / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`
      : `Falta ${(calc.falta / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no mês`} · meta fixa do dia hoje <strong>${$ri(calc.metaDiaria)}</strong>`
    : '';
  return `<div class="card" style="margin-top:14px;">
    <div class="card-title">👩‍💼 ${CANAL_LABEL[u]} — atendentes da meta</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin:8px 0 12px;">
      <label style="font-size:12px;">Ticket meta (R$)<br/>${inp(`mc-tm-${u}`, reais(un.ticketMeta))}</label>
      <label style="font-size:12px;">Ticket supermeta (R$)<br/>${inp(`mc-ts-${u}`, reais(un.ticketSuper))}</label>
      <div style="font-size:12px;align-self:flex-end;">Vendas que contam pra esta meta:<br/>
        ${[['cdle', '💬 WhatsApp'], ['loja2', '🏪 Balcão']].map(([c, l]) => `<label style="margin-right:10px;white-space:nowrap;"><input type="checkbox" class="mc-cc-${u}" value="${c}" ${(un.canaisContam?.length ? un.canaisContam : [u]).includes(c) ? 'checked' : ''}/> ${l}</label>`).join('')}</div>
      <label style="font-size:12px;display:flex;gap:6px;align-items:center;align-self:flex-end;" title="As vinculadas dividem a meta da loja: vale o vendido da loja inteira, não o de cada uma.">
        <input type="checkbox" id="mc-comp-${u}" ${un.compartilhada ? 'checked' : ''}/> 👥 Meta compartilhada (equipe)</label>
      <label style="font-size:12px;">Meta diária da equipe (R$)<br/><input class="fi" id="mc-cdf-${u}" type="number" min="0" step="50" value="${un.metaDiaFixa || ''}" placeholder="auto (meta da loja)" style="width:150px;"/></label>
      <label style="font-size:12px;">Meta semanal da equipe (R$)<br/><input class="fi" id="mc-csf-${u}" type="number" min="0" step="100" value="${un.metaSemanaFixa || ''}" placeholder="auto" style="width:150px;"/></label>
      <div style="font-size:12px;color:var(--muted);align-self:flex-end;">${resumo}</div>
    </div>
    <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="text-align:left;color:var(--muted);font-size:11px;">
        <th style="padding:6px;">Atendente</th><th style="padding:6px;">Dias trabalhados no mês</th>
        <th style="padding:6px;">Dias por semana</th><th style="padding:6px;">Meta diária fixa (R$)</th><th style="padding:6px;">Meta semanal fixa (R$)</th><th style="padding:6px;">Dias que ainda faltam</th><th></th>
      </tr></thead>
      <tbody id="mc-at-${u}">${(un.atendentes || []).map(a => linhaAtendente(u, a)).join('')}</tbody>
    </table></div>
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
      <select class="fi" id="mc-add-${u}" style="max-width:280px;"><option value="">+ vincular atendente…</option>${opcoes}</select>
      <button type="button" class="btn btn-ghost btn-sm" onclick="metasCfgAdd('${u}')">Adicionar</button>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-top:8px;">
      <strong>Meta diária/semanal fixa:</strong> preenchida, é a meta dela todo dia/semana; vazia, sai do planejamento do mês. Nos dois casos a meta do dia não muda com o que já vendeu: um dia acima não compensa os outros;
      vazia, o sistema calcula. Ela vê a diária, a semanal e só o <strong>%</strong> da meta do mês da equipe (nunca o valor do mês).<br/>
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
      <select class="fi" id="mc-cenario" style="max-width:180px;margin-left:8px;" onchange="metasCfgPlano()">
        <option value="realista" ${_cfg.cenarioAtivo === 'realista' ? 'selected' : ''}>Realista</option>
        <option value="agressiva" ${_cfg.cenarioAtivo !== 'realista' ? 'selected' : ''}>Agressiva</option>
      </select></label>
    <div style="font-size:11px;color:var(--muted);margin-top:6px;">iFood e Giuliana não entram na meta nem na comissão das atendentes.</div>
  </div>
  ${blocoDiasTipo()}
  ${UNIDADES.map(blocoUnidade).join('')}
  <div style="margin-top:14px;"><button type="button" class="btn btn-primary" style="width:100%;justify-content:center;padding:12px;" onclick="metasCfgSalvar()">💾 Salvar metas de ${esc(nomeMes(_mes))}</button></div>
  <div class="card" style="margin-top:14px;">
    <div class="card-title">🕑 Histórico de alterações</div>
    ${hist ? `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><tbody>${hist}</tbody></table></div>` : '<div style="color:var(--muted);font-size:12px;">Nenhuma alteração ainda.</div>'}
  </div>`;
}

const cent = (id) => Math.round((Number(document.getElementById(id)?.value) || 0) * 100);

// ── META POR TIPO DE DIA (out/2026) ─────────────────────────────────────
// Planejamento da EMPRESA por tipo de dia (seg–sex, sábado, domingo/feriado)
// e dias específicos do mês. É o "peso" de cada dia: o recálculo diário divide
// o que falta da meta (geral, por canal e das atendentes) nessa proporção.
const TIPOS = [['segSex', 'Seg a sex'], ['sab', 'Sábado'], ['dom', 'Domingo / feriado']];
const reaisDe = (c) => ((Number(c) || 0) / 100).toFixed(0);
function _linhaDiaEsp(x = {}) {
  return `<div class="mc-esp" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;align-items:end;padding:8px 0;border-top:1px dashed var(--border);">
    <label style="font-size:11px;">Data<input class="fi mc-esp-data" type="date" value="${x.data || ''}" min="${_mes}-01" max="${_mes}-31" oninput="metasCfgPlano()"/></label>
    <label style="font-size:11px;">Motivo<input class="fi mc-esp-motivo" value="${esc(x.motivo || '')}" placeholder="Ex.: Black Friday"/></label>
    <label style="font-size:11px;">Contar como<select class="fi mc-esp-tipo" onchange="metasCfgPlano()">
      ${[...TIPOS, ['valor', 'Valor próprio']].map(([k, l]) => `<option value="${k}" ${(x.tipo || 'valor') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label style="font-size:11px;">Realista (R$)<input class="fi mc-esp-r" type="number" min="0" value="${x.realista ? reaisDe(x.realista) : ''}" oninput="metasCfgPlano()"/></label>
    <label style="font-size:11px;">Agressiva (R$)<input class="fi mc-esp-a" type="number" min="0" value="${x.agressiva ? reaisDe(x.agressiva) : ''}" oninput="metasCfgPlano()"/></label>
    <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.mc-esp').remove();metasCfgPlano()">✕</button>
  </div>`;
}
function blocoDiasTipo() {
  const dt = _cfg.diasTipo || {};
  const feriados = (_cfg._calendario || []).filter(d => d.feriado).map(d => d.dia.slice(8, 10) + '/' + d.dia.slice(5, 7));
  const ini = _htmlPlano({ diasTipo: dt, diasEspecificos: _cfg.diasEspecificos || [] }, (c, cen) => Number(_cfg.canais?.[c]?.[cen]) || 0, _cfg.cenarioAtivo || 'agressiva');
  return `<div class="card" style="margin-top:14px;">
    <div class="card-title">📆 Meta por tipo de dia (empresa)</div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Quanto a loja planeja vender em cada tipo de dia. Serve de <strong>peso</strong>: a meta de cada dia
      (do sinaleiro da TV, de cada canal e das atendentes) é o que falta da meta do mês dividido nessa proporção — sábado e domingo pesam menos, dia especial pesa mais.
      ${feriados.length ? 'Feriados do mês contam como domingo: ' + feriados.join(', ') + '.' : ''}</div>
    <div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:13px;min-width:420px;">
      <thead><tr style="color:var(--muted);font-size:11px;text-align:left;"><th style="padding:6px;"></th>${TIPOS.map(([, l]) => `<th style="padding:6px;">${l}</th>`).join('')}</tr></thead>
      <tbody>${['realista', 'agressiva'].map(cen => `<tr><td style="padding:6px;font-weight:700;">${cen === 'realista' ? 'Realista' : 'Agressiva'}</td>
        ${TIPOS.map(([t]) => `<td style="padding:6px;"><input class="fi" id="mc-dt-${cen}-${t}" type="number" min="0" step="10" value="${reaisDe(dt[cen]?.[t])}" style="width:110px;text-align:right;" oninput="metasCfgPlano()"/></td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div id="mc-plano-resumo" style="margin-top:10px;font-size:12px;">${ini.resumo}</div>
    <button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="metasCfgAjustarPlano()">⚖️ Ajustar seg–sex, sábado e domingo para fechar a meta do mês</button>
    <div id="mc-plano-canais" style="margin-top:12px;">${ini.canais}</div>
    <div style="font-weight:800;font-size:13px;margin-top:14px;">📌 Dias específicos do mês</div>
    <div style="font-size:11px;color:var(--muted);">Datas com meta diferente (Black Friday, véspera de feriado…) — com valor próprio ou contando como outro tipo de dia.</div>
    <div id="mc-esp-lista">${(_cfg.diasEspecificos || []).map(_linhaDiaEsp).join('')}</div>
    <button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px;" onclick="metasCfgAddEsp()">+ dia específico</button>
  </div>`;
}
// Lê o planejamento da tela (centavos)
function _lerPlano() {
  const diasTipo = Object.fromEntries(['realista', 'agressiva'].map(cen => [cen, Object.fromEntries(TIPOS.map(([t]) => [t, cent(`mc-dt-${cen}-${t}`)]))]));
  const diasEspecificos = [...document.querySelectorAll('#mc-esp-lista .mc-esp')].map(row => ({
    data: row.querySelector('.mc-esp-data')?.value || '', motivo: row.querySelector('.mc-esp-motivo')?.value || '',
    tipo: row.querySelector('.mc-esp-tipo')?.value || 'valor',
    realista: Math.round((Number(row.querySelector('.mc-esp-r')?.value) || 0) * 100),
    agressiva: Math.round((Number(row.querySelector('.mc-esp-a')?.value) || 0) * 100),
  })).filter(x => x.data);
  return { diasTipo, diasEspecificos };
}
// Soma planejada do mês (centavos) e quantos dias de cada tipo
function _somaPlano(plano, cen) {
  const esp = new Map(plano.diasEspecificos.map(x => [x.data, x]));
  const n = { segSex: 0, sab: 0, dom: 0 }; let total = 0;
  for (const d of (_cfg._calendario || [])) {
    const e = esp.get(d.dia);
    let tipo = d.feriado ? 'dom' : (new Date(d.dia + 'T12:00:00Z').getUTCDay() === 0 ? 'dom' : new Date(d.dia + 'T12:00:00Z').getUTCDay() === 6 ? 'sab' : 'segSex');
    if (e) tipo = e.tipo;
    if (tipo === 'valor') { total += e[cen] || 0; continue; }
    n[tipo]++; total += plano.diasTipo[cen][tipo] || 0;
  }
  return { total, n };
}
// metaCanal(c, cen) → centavos. Usado no 1º desenho (do _cfg) e ao digitar (da tela).
function _htmlPlano(plano, metaCanal, cenAtivo) {
  const linhas = ['realista', 'agressiva'].map(cen => {
    const { total, n } = _somaPlano(plano, cen);
    const metaMes = CANAIS.reduce((s, c) => s + metaCanal(c, cen), 0);
    const dif = total - metaMes;
    const cor = Math.abs(dif) <= metaMes * 0.005 ? '#15803D' : '#B45309';
    return `<div><strong>${cen === 'realista' ? 'Realista' : 'Agressiva'}:</strong> ${n.segSex} seg–sex + ${n.sab} sáb + ${n.dom} dom/feriado${plano.diasEspecificos.some(x => x.tipo === 'valor') ? ' + dias específicos' : ''}
      = <strong>${$cc(total)}</strong> planejado · meta do mês ${$cc(metaMes)} · <span style="color:${cor};font-weight:700;">${dif === 0 ? 'fecha certinho' : (dif > 0 ? '+' : '') + $cc(dif)}</span></div>`;
  }).join('');
  // Meta típica de cada canal por tipo de dia (cenário ativo) = meta do canal × peso ÷ soma planejada
  const { total } = _somaPlano(plano, cenAtivo);
  const tab = total ? `<div style="font-size:11px;color:var(--muted);margin-bottom:4px;">Quanto isso dá por canal num dia típico (cenário ${cenAtivo}, antes do recálculo diário):</div>
    <div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:12px;min-width:420px;">
      <thead><tr style="color:var(--muted);font-size:10px;text-align:left;"><th style="padding:4px 6px;">Canal</th>${TIPOS.map(([, l]) => `<th style="padding:4px 6px;text-align:right;">${l}</th>`).join('')}</tr></thead>
      <tbody>${CANAIS.map(c => { const m = metaCanal(c, cenAtivo);
        return `<tr><td style="padding:4px 6px;">${CANAL_LABEL[c]}</td>${TIPOS.map(([t]) => `<td style="padding:4px 6px;text-align:right;">${$ri(Math.round(m * (plano.diasTipo[cenAtivo][t] || 0) / total / 100))}</td>`).join('')}</tr>`; }).join('')}</tbody>
    </table></div>` : '';
  return { resumo: linhas, canais: tab };
}
window.metasCfgPlano = () => {
  const elR = document.getElementById('mc-plano-resumo'); if (!elR) return;
  const h = _htmlPlano(_lerPlano(), (c, cen) => cent(`mc-${c}-${cen}`), document.getElementById('mc-cenario')?.value || 'agressiva');
  elR.innerHTML = h.resumo;
  const el = document.getElementById('mc-plano-canais'); if (el) el.innerHTML = h.canais;
};
window.metasCfgAjustarPlano = () => {
  const plano = _lerPlano();
  for (const cen of ['realista', 'agressiva']) {
    const { total, n } = _somaPlano(plano, cen);
    const especiais = total - TIPOS.reduce((s, [t]) => s + n[t] * (plano.diasTipo[cen][t] || 0), 0);
    const metaMes = CANAIS.reduce((s, c) => s + cent(`mc-${c}-${cen}`), 0);
    const base = total - especiais;
    if (base <= 0) continue;
    const f = (metaMes - especiais) / base;
    for (const [t] of TIPOS) { const el = document.getElementById(`mc-dt-${cen}-${t}`); if (el) el.value = Math.round((plano.diasTipo[cen][t] / 100) * f / 10) * 10; }
  }
  window.metasCfgPlano();
  toast('⚖️ Ajustado na mesma proporção — confira e salve.');
};
window.metasCfgAddEsp = () => { document.getElementById('mc-esp-lista')?.insertAdjacentHTML('beforeend', _linhaDiaEsp({ tipo: 'valor' })); };

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
        metaDiaFixa: Number(tr.querySelector('.mc-mdf')?.value) || 0,
        metaSemanaFixa: Number(tr.querySelector('.mc-msf')?.value) || 0,
        diasRestantesManual: manual, diasRestantesManualEm: manualEm,
      };
    });
    return [u, {
      ticketMeta: cent(`mc-tm-${u}`), ticketSuper: cent(`mc-ts-${u}`), atendentes,
      compartilhada: !!document.getElementById(`mc-comp-${u}`)?.checked,
      canaisContam: [...document.querySelectorAll(`.mc-cc-${u}:checked`)].map(x => x.value),
      metaDiaFixa: Number(document.getElementById(`mc-cdf-${u}`)?.value) || 0,
      metaSemanaFixa: Number(document.getElementById(`mc-csf-${u}`)?.value) || 0,
    }];
  }));
  return { canais, unidades, cenarioAtivo: document.getElementById('mc-cenario')?.value || 'agressiva', ..._lerPlano() };
}

window.metasCfgMes = async (mes) => { _mes = mes; _cfg = null; _rel = null; _hist = null; await carregar(); _render(); };
window.metasCfgSoma = () => {
  for (const k of ['realista', 'agressiva']) {
    const t = CANAIS.reduce((s, c) => s + cent(`mc-${c}-${k}`), 0);
    const el = document.getElementById(`mc-tot-${k}`); if (el) el.textContent = $cc(t);
  }
  window.metasCfgPlano();
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
      Sai sozinha das <strong>Metas do mês</strong>: para cada canal, a meta do mês repartida pelo planejamento dos dias (seg a sex, sábado,
      domingo/feriado), somando os canais. É <strong>fixa</strong>: vender mais num dia não baixa a meta dos outros, e o dia só fica verde se bater a meta dele.
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
  // Estrelas dos entregadores: no topo do Programa Estrelas, não no Dashboard (Marcia 28/out).
  const corpo = tab === 'estrelas' ? renderEstrelasEntregadoresGer() + renderCampanha() : tab === 'loja' ? renderMetaLoja() : tab === 'acomp' ? renderAcompanhamento() : renderMetasCanais();
  return `<div class="tabs" style="margin-bottom:14px;">${b('mes', '📅 Metas do mês')}${b('loja', '🚦 Meta da loja')}${b('estrelas', '⭐ Programa Estrelas')}${b('acomp', '👥 Acompanhamento')}</div>${corpo}`;
}

window.metasTab = (t) => { S._metasTab = t; if (t === 'loja') _lojaHoje = null; _render(); };
