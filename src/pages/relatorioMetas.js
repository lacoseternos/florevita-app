// ── RELATÓRIO: abas "Metas" e "Comissão detalhada" (gerência) ──────────
// Marcia (out/2026). Os números vêm PRONTOS do backend:
//   Metas              → GET /metas/relatorio   (metasService)
//   Comissão detalhada → GET /comissoes/periodo (FUNÇÃO ÚNICA da comissão)
// Nada de conta de comissão aqui — só exibição. Valores em centavos.
import { S } from '../state.js';
import { GET } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';
import { normalizeUnidade } from '../utils/unidadeRules.js';
import { CANAIS, CANAL_LABEL, $cc, $ri, mesAtualManaus, mesesOpcoes, nomeMes } from './metasCanais.js';

async function _render() { const m = await import('../main.js'); m.render(); }
const hojeISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
const somarDias = (d, n) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
const br = (d) => d ? d.split('-').reverse().join('/') : '';
const pct = (v) => v == null ? '—' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const STATUS_ICON = { estrela: '⭐', verde: '🟢', amarelo: '🟡', vermelho: '🔴' };

const st = {
  metas: { mes: null, cenario: '', periodo: 'mes_hoje', from: '', to: '', canal: 'todos', colabId: '' },
  comissao: { preset: 'mes', from: '', to: '', modo: 'funcionaria', pessoa: '', unidade: '', detalhe: false },
};
let _atendentes = null; // [{colabId, nome, unidade}] do mês escolhido
let _pessoas = null;    // colaboradores (pra comissão)

// ── modal ──────────────────────────────────────────────────────────────
export async function abrirRelatorioExtra(tipo, voltarVendas) {
  const { relTiposAbas } = await import('../main.js');
  if (tipo === 'metas' && !st.metas.mes) st.metas.mes = mesAtualManaus();

  const opt = (v, l, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(l)}</option>`;
  const sel = (id, opts) => `<select id="${id}" style="width:100%;padding:8px 10px;border:1.5px solid #E5E7EB;border-radius:6px;font-size:13px;margin-bottom:12px;">${opts}</select>`;
  const lab = (t) => `<div style="font-size:12px;font-weight:700;color:#1F2937;margin-bottom:6px;">${t}</div>`;
  const datas = (o) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
      <input type="date" id="rx-from" value="${o.from}" style="padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;"/>
      <input type="date" id="rx-to" value="${o.to}" style="padding:8px;border:1.5px solid #E5E7EB;border-radius:6px;"/></div>`;

  const corpoMetas = () => {
    const m = st.metas;
    return lab('Mês') + sel('rx-mes', mesesOpcoes().map(x => opt(x, nomeMes(x), x === m.mes)).join('')) +
      lab('Cenário') + sel('rx-cen', opt('', 'Cenário ativo do mês', !m.cenario) + opt('realista', 'Realista', m.cenario === 'realista') + opt('agressiva', 'Agressiva', m.cenario === 'agressiva')) +
      lab('Período') + sel('rx-per', opt('mes_hoje', 'Mês até hoje', m.periodo === 'mes_hoje') + opt('mes_ontem', 'Mês até ontem', m.periodo === 'mes_ontem') + opt('intervalo', 'Intervalo de datas', m.periodo === 'intervalo')) +
      (m.periodo === 'intervalo' ? datas(m) : '') +
      lab('Canal') + sel('rx-canal', opt('todos', 'Todos', m.canal === 'todos') + CANAIS.map(c => opt(c, CANAL_LABEL[c], m.canal === c)).join('')) +
      lab('Atendente') + sel('rx-colab', opt('', 'Todas', !m.colabId) + (_atendentes || []).map(a => opt(a.colabId, `${a.nome} (${CANAL_LABEL[a.unidade]})`, m.colabId === a.colabId)).join(''));
  };
  const corpoComissao = () => {
    const c = st.comissao;
    const pessoas = (_pessoas || []).filter(p => p.active !== false && (c.modo === 'entregador' ? /entregador/i.test(p.cargo || '') : !/entregador/i.test(p.cargo || '')));
    return lab('Período') + sel('rx-preset', [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana', 'Esta semana (seg → hoje)'], ['mes', 'Este mês'], ['mes_ant', 'Mês anterior'], ['custom', 'Intervalo de datas']].map(([k, l]) => opt(k, l, c.preset === k)).join('')) +
      (c.preset === 'custom' ? datas(c) : '') +
      lab('Gerar') + sel('rx-modo', opt('dia', 'Por dia', c.modo === 'dia') + opt('funcionaria', 'Por funcionária', c.modo === 'funcionaria') + opt('entregador', 'Por entregador', c.modo === 'entregador')) +
      lab(c.modo === 'entregador' ? 'Entregador' : 'Funcionária') + sel('rx-pessoa', opt('', 'Todos', !c.pessoa) + pessoas.map(p => opt(p._id, p.name, c.pessoa === p._id)).join('')) +
      lab('Unidade') + sel('rx-un', opt('', 'Todas', !c.unidade) + [['cdle', 'CDLE'], ['novo_aleixo', 'Loja Novo Aleixo'], ['allegro', 'Loja Allegro Mall']].map(([k, l]) => opt(k, l, c.unidade === k)).join('')) +
      `<label style="display:flex;gap:8px;align-items:center;font-size:12px;margin-bottom:14px;cursor:pointer;"><input type="checkbox" id="rx-det" ${c.detalhe ? 'checked' : ''} style="accent-color:#9D174D;"/> Abrir o detalhe por pedido (nº, data, cliente, valor, base e comissão)</label>`;
  };

  const desenhar = () => {
    S._modal = `<div class="mo" id="mo" style="backdrop-filter:blur(4px);">
      <div class="mo-box" onclick="event.stopPropagation()" style="max-width:520px;padding:0;overflow:hidden;border-radius:14px;">
        <div style="background:linear-gradient(135deg,#9D174D,#831843);color:#fff;padding:16px 20px;">
          <div style="font-size:11px;opacity:.9;letter-spacing:.5px;text-transform:uppercase;">📊 Relatório</div>
          <div style="font-size:18px;font-weight:800;margin-top:4px;">${tipo === 'metas' ? '🎯 Metas' : '💰 Comissão detalhada'}</div>
        </div>
        ${relTiposAbas(tipo)}
        <div style="padding:18px 20px;background:#fff;">
          ${tipo === 'metas' ? corpoMetas() : corpoComissao()}
          <div style="display:flex;gap:8px;">
            <button type="button" id="rx-cancel" style="flex:1;padding:11px;border:1.5px solid #E5E7EB;background:#fff;border-radius:8px;font-weight:700;cursor:pointer;color:#374151;">Cancelar</button>
            <button type="button" id="rx-gen" style="flex:2;padding:11px;border:none;background:#9D174D;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;">📄 Gerar</button>
          </div>
        </div>
      </div></div>`;
    _render().then(() => setTimeout(ligar, 30));
  };

  const ler = () => {
    const v = (id) => document.getElementById(id)?.value;
    if (tipo === 'metas') {
      const m = st.metas;
      m.mes = v('rx-mes') || m.mes; m.cenario = v('rx-cen') || ''; m.periodo = v('rx-per') || m.periodo;
      m.canal = v('rx-canal') || 'todos'; m.colabId = v('rx-colab') || '';
      if (v('rx-from') != null) { m.from = v('rx-from'); m.to = v('rx-to'); }
    } else {
      const c = st.comissao;
      c.preset = v('rx-preset') || c.preset; c.modo = v('rx-modo') || c.modo; c.pessoa = v('rx-pessoa') || '';
      c.unidade = v('rx-un') || ''; c.detalhe = !!document.getElementById('rx-det')?.checked;
      if (v('rx-from') != null) { c.from = v('rx-from'); c.to = v('rx-to'); }
    }
  };

  const ligar = () => {
    document.getElementById('mo')?.addEventListener('click', e => { if (e.target.id === 'mo') { S._modal = ''; _render(); } });
    document.getElementById('rx-cancel')?.addEventListener('click', () => { S._modal = ''; _render(); });
    document.querySelectorAll('[data-rel-tipo]').forEach(b => b.addEventListener('click', () => {
      ler();
      const t = b.dataset.relTipo;
      if (t === 'vendas') return voltarVendas();
      if (t !== tipo) abrirRelatorioExtra(t, voltarVendas);
    }));
    // Campos que mudam o formulário: redesenha
    for (const id of ['rx-mes', 'rx-per', 'rx-preset', 'rx-modo']) {
      document.getElementById(id)?.addEventListener('change', async () => {
        ler();
        if (id === 'rx-mes') { st.metas.colabId = ''; await carregarAtendentes(st.metas.mes); }
        if (id === 'rx-modo') st.comissao.pessoa = '';
        desenhar();
      });
    }
    document.getElementById('rx-gen')?.addEventListener('click', async () => {
      ler();
      try {
        if (tipo === 'metas') await gerarMetas(); else await gerarComissao();
      } catch (e) { toast('❌ ' + (e.message || 'Erro ao gerar'), true); }
    });
  };

  try {
    if (tipo === 'metas') await carregarAtendentes(st.metas.mes);
    else if (!_pessoas) _pessoas = await GET('/collaborators').catch(() => []);
  } catch (_) { /* segue */ }
  desenhar();
}

async function carregarAtendentes(mes) {
  const cfg = await GET('/metas/config/' + mes).catch(() => null);
  _atendentes = cfg ? ['cdle', 'loja2'].flatMap(u => (cfg.unidades?.[u]?.atendentes || []).map(a => ({ colabId: String(a.colabId), nome: a.nome, unidade: u }))) : [];
}

// ── janela de impressão (PDF pelo "Imprimir" do navegador) ──────────────
function abrirJanela(titulo, corpo, extrasBotoes = '') {
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${esc(titulo)}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;}
  body{padding:24px;background:#fff;color:#111;max-width:1000px;margin:0 auto;}
  h1{font-family:Georgia,serif;font-size:22px;margin:0 0 4px;color:#9D174D;}
  h2{font-size:14px;margin:18px 0 8px;color:#9D174D;border-bottom:2px solid #FDF2F8;padding-bottom:4px;}
  h3{font-size:13px;margin:14px 0 6px;color:#374151;}
  .sub{color:#555;font-size:12px;margin-bottom:14px;}
  table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;}
  th,td{padding:5px 7px;text-align:left;border-bottom:1px solid #eee;}
  th{background:#FDF2F8;color:#9D174D;font-size:10px;text-transform:uppercase;letter-spacing:.4px;}
  td.n,th.n{text-align:right;white-space:nowrap;}
  .grand{background:#FAFAFA;font-weight:800;}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}
  .kpi{background:#FDF2F8;border-radius:8px;padding:10px;text-align:center;}
  .kpi .l{font-size:10px;color:#666;text-transform:uppercase;} .kpi .v{font-size:17px;font-weight:800;color:#9D174D;}
  .ok{color:#15803D;} .red{color:#991B1B;} .small{font-size:11px;color:#777;}
  .btnp{background:#9D174D;color:#fff;padding:10px 20px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;text-decoration:none;display:inline-block;}
  @media print{ body{padding:10px;} .no-print{display:none!important;} tr{break-inside:avoid;} h2,h3{break-after:avoid;} }
</style></head><body>
  <div class="no-print" style="display:flex;gap:8px;justify-content:space-between;margin-bottom:16px;">
    <span style="display:flex;gap:8px;"><button class="btnp" onclick="window.print()">🖨️ Imprimir / PDF</button>${extrasBotoes}</span>
    <button class="btnp" style="background:#6B7280;" onclick="window.close()">✕ Fechar</button>
  </div>
  <h1>🌹 Floricultura Laços Eternos</h1>
  ${corpo}
  <div class="small" style="margin-top:20px;border-top:2px solid #9D174D;padding-top:10px;text-align:center;">
    Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Manaus' })} por ${esc(S.user?.name || S.user?.nome || '—')} ·
    vendas = pagamento confirmado, no dia da aprovação (Manaus) · comissão pela função única do sistema (igual ao RH)
  </div></body></html>`;
  const w = window.open('', '_blank', 'width=1050,height=760');
  if (!w) { toast('❌ Permita pop-ups para abrir o relatório', true); return; }
  w.document.write(html); w.document.close();
}

// ── METAS ──────────────────────────────────────────────────────────────
async function gerarMetas() {
  const m = st.metas;
  const hoje = hojeISO();
  let from = `${m.mes}-01`, to;
  const [y, mm] = m.mes.split('-').map(Number);
  const fimMes = `${m.mes}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`;
  if (m.periodo === 'intervalo') {
    if (!m.from || !m.to || m.from > m.to) throw new Error('Datas inválidas');
    if (m.from.slice(0, 7) !== m.mes || m.to.slice(0, 7) !== m.mes) throw new Error('O intervalo precisa estar dentro do mês escolhido');
    from = m.from; to = m.to;
  } else {
    const ref = m.periodo === 'mes_ontem' ? somarDias(hoje, -1) : hoje;
    to = ref < fimMes ? ref : fimMes;
    if (to < from) to = from;
  }
  toast('⏳ Calculando metas...');
  const q = new URLSearchParams({ mes: m.mes, from, to, canal: m.canal });
  if (m.cenario) q.set('cenario', m.cenario);
  if (m.colabId) q.set('colabId', m.colabId);
  const r = await GET('/metas/relatorio?' + q.toString());
  S._modal = ''; _render();
  abrirJanela(`Metas — ${nomeMes(m.mes)}`, htmlMetas(r));
}

export function htmlMetas(r) {
  const rs = r.resumo;
  const escopo = r.colabId ? (r.porAtendente[0]?.nome || 'Atendente') : (r.canal === 'todos' ? 'Todos os canais' : CANAL_LABEL[r.canal]);
  const kpi = (l, v, cls = '') => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls}">${v}</div></div>`;
  const dif = rs.diferenca;
  const resumo = `<div class="kpi-grid">
      ${kpi('Meta do mês', $cc(rs.metaMes))}${kpi('Meta acumulada até a data', $cc(rs.metaAcumulada))}
      ${kpi('Realizado', $cc(rs.realizado))}${kpi('Diferença', `${dif >= 0 ? '+' : ''}${$cc(dif)}<br/><span style="font-size:12px;">${rs.diferencaPct == null ? '' : (rs.diferencaPct >= 0 ? '+' : '') + pct(rs.diferencaPct)}</span>`, dif >= 0 ? 'ok' : 'red')}
      ${kpi('Falta para o mês', rs.faltaMes > 0 ? $cc(rs.faltaMes) : 'Meta batida 🎉')}${kpi('Projeção de fechamento', rs.projecao == null ? '—' : $cc(rs.projecao))}
      ${kpi('Ticket médio', $cc(rs.ticketMedio))}${kpi('Pedidos', rs.pedidos)}
    </div>`;
  const canais = `<h2>📡 Por canal</h2><table>
      <thead><tr><th>Canal</th><th class="n">Meta do mês</th><th class="n">Meta acumulada</th><th class="n">Realizado</th><th class="n">%</th><th class="n">Falta (mês)</th><th class="n">Pedidos</th><th class="n">Ticket</th></tr></thead>
      <tbody>${r.porCanal.map(c => `<tr><td>${esc(CANAL_LABEL[c.canal])}</td><td class="n">${$cc(c.meta)}</td><td class="n">${$cc(c.metaAcumulada)}</td><td class="n"><strong>${$cc(c.realizado)}</strong></td><td class="n">${pct(c.pct)}</td><td class="n">${c.falta > 0 ? $cc(c.falta) : '🎉'}</td><td class="n">${c.pedidos}</td><td class="n">${$cc(c.ticket)}</td></tr>`).join('')}
      <tr class="grand"><td>EMPRESA</td><td class="n">${$cc(r.totalEmpresa.meta)}</td><td class="n">${$cc(r.totalEmpresa.metaAcumulada)}</td><td class="n">${$cc(r.totalEmpresa.realizado)}</td><td class="n">${pct(r.totalEmpresa.pct)}</td><td class="n">${$cc(r.totalEmpresa.falta)}</td><td class="n">${r.totalEmpresa.pedidos}</td><td class="n">${$cc(r.totalEmpresa.ticket)}</td></tr>
      </tbody></table>`;
  const atend = r.porAtendente.length ? `<h2>👩‍💼 Por atendente <span class="small">(metas recalculadas em ${br(r.diaRef)}, cenário ${r.cenario})</span></h2><table>
      <thead><tr><th>Atendente</th><th class="n">Dias trab. (mês)</th><th class="n">Dias restantes</th><th class="n">Realizado</th><th class="n">Ticket × meta</th><th class="n">Meta diária</th><th class="n">Meta semanal</th><th class="n">Supermeta sem.</th><th class="n">Parte do restante</th><th class="n">Comissão</th></tr></thead>
      <tbody>${r.porAtendente.map(a => `<tr><td>${esc(a.nome)} <span class="small">${esc(CANAL_LABEL[a.unidade])}</span></td>
        <td class="n">${a.diasTrabalhadosMes}</td><td class="n">${a.diasRestantes}${a.diasRestantesManual ? ' ✋' : ''}</td>
        <td class="n"><strong>${$cc(a.realizado)}</strong></td>
        <td class="n ${a.ticketMedio >= a.ticketMeta ? 'ok' : 'red'}">${$cc(a.ticketMedio)} × ${$cc(a.ticketMeta)}</td>
        <td class="n">${$ri(a.metaDiaria)}</td><td class="n">${$ri(a.metaSemanal)}</td>
        <td class="n">${$ri(a.superSemanal)}</td><td class="n">${a.batida ? '—' : $ri(a.parte)}</td>
        <td class="n"><strong>${$cc(a.comissao)}</strong></td></tr>`).join('')}</tbody></table>
      ${Object.entries(r.unidades).filter(([u]) => r.porAtendente.some(a => a.unidade === u)).map(([u, x]) => `<div class="small">${esc(CANAL_LABEL[u])}: meta fixa do dia ${$ri(x.metaDiaria)} · ${x.batida ? `mês batido 🎉 — passou ${$cc(x.excedente)}` : `falta ${$cc(x.falta)} no mês`}</div>`).join('')}` : '';
  const dias = `<h2>📅 Dia a dia</h2><table>
      <thead><tr><th>Data</th><th class="n">Meta</th><th class="n">Realizado</th><th class="n">%</th><th class="n">Pedidos</th><th class="n">Ticket</th><th>Status</th></tr></thead>
      <tbody>${r.diaADia.map(d => `<tr><td>${br(d.dia)}</td><td class="n">${d.meta == null ? '—' : $cc(d.meta)}</td><td class="n">${$cc(d.realizado)}</td><td class="n">${pct(d.pct)}</td><td class="n">${d.pedidos}</td><td class="n">${$cc(d.ticket)}</td><td>${STATUS_ICON[d.status] || ''}</td></tr>`).join('')}
      <tr class="grand"><td>TOTAL</td><td class="n">${$cc(r.diaADia.reduce((s, d) => s + (d.meta || 0), 0))}</td><td class="n">${$cc(r.diaADia.reduce((s, d) => s + d.realizado, 0))}</td><td></td><td class="n">${r.diaADia.reduce((s, d) => s + d.pedidos, 0)}</td><td></td><td></td></tr></tbody></table>
      <div class="small">⭐ 17%+ acima da agressiva · 🟢 bateu a agressiva (ou a realista com ticket ≥ ticket meta) · 🟡 até 5% abaixo da realista · 🔴 abaixo disso</div>`;
  return `<div class="sub"><strong>🎯 Metas — ${esc(nomeMes(r.mes))}</strong> · ${esc(escopo)} · ${br(r.from)} a ${br(r.to)} · cenário <strong>${esc(r.cenario)}</strong>${r.cenario === r.cenarioAtivo ? ' (ativo)' : ''}</div>
    ${resumo}${canais}${atend}${dias}`;
}

// ── COMISSÃO DETALHADA ─────────────────────────────────────────────────
function periodoComissao(c) {
  const hoje = hojeISO();
  if (c.preset === 'hoje') return [hoje, hoje];
  if (c.preset === 'ontem') { const d = somarDias(hoje, -1); return [d, d]; }
  if (c.preset === 'semana') {
    const dow = new Date(hoje + 'T12:00:00Z').getUTCDay();
    return [somarDias(hoje, dow === 0 ? -6 : 1 - dow), hoje];
  }
  if (c.preset === 'mes') return [hoje.slice(0, 7) + '-01', hoje];
  if (c.preset === 'mes_ant') {
    const [y, m] = hoje.slice(0, 7).split('-').map(Number);
    const ini = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    return [ini, new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)];
  }
  if (!c.from || !c.to || c.from > c.to) throw new Error('Datas inválidas');
  return [c.from, c.to];
}

const TIPO_LABEL = { venda: 'Venda', montagem: 'Montagem', expedicao: 'Expedição', entrega: 'Entrega', reentrega: 'Reentrega' };

async function gerarComissao() {
  const c = st.comissao;
  const [from, to] = periodoComissao(c);
  toast('⏳ Calculando comissões...');
  // Sempre com as linhas: o dia a dia (pedidos, vendido, entregas) sai delas.
  const q = new URLSearchParams({ from, to, detalhe: '1' });
  if (c.pessoa) q.set('colabId', c.pessoa);
  const r = await GET('/comissoes/periodo?' + q.toString());
  let lista = r.colaboradores || [];
  if (c.unidade) lista = lista.filter(p => normalizeUnidade(p.unidade) === c.unidade);
  const ehEnt = (p) => /entregador/i.test(p.cargo || '');
  if (c.modo === 'entregador') lista = lista.filter(ehEnt);
  else if (c.modo === 'funcionaria') lista = lista.filter(p => !ehEnt(p));
  lista = lista.filter(p => p.total > 0 || (p.porDia || []).length);
  S._modal = ''; _render();
  const { html, csv } = htmlComissao({ from, to, modo: c.modo, detalhe: c.detalhe, lista });
  const href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('﻿' + csv);
  abrirJanela(`Comissão detalhada ${br(from)} a ${br(to)}`, html,
    `<a class="btnp" style="background:#15803D;" download="comissao_${from}_${to}.csv" href="${href}">📊 Baixar planilha</a>`);
}

const num = (c) => ((Number(c) || 0) / 100).toFixed(2).replace('.', ',');

export function htmlComissao({ from, to, modo, detalhe, lista }) {
  const total = lista.reduce((s, p) => s + p.total, 0);
  const csv = [];
  let corpo = `<div class="sub"><strong>💰 Comissão detalhada — ${modo === 'dia' ? 'por dia' : modo === 'entregador' ? 'por entregador' : 'por funcionária'}</strong> · ${br(from)} a ${br(to)}</div>
    <div class="kpi-grid"><div class="kpi"><div class="l">Total de comissão</div><div class="v">${$cc(total)}</div></div>
    <div class="kpi"><div class="l">Pessoas</div><div class="v">${lista.length}</div></div></div>`;

  if (modo === 'dia') {
    const dias = {};
    for (const p of lista) for (const d of p.porDia) (dias[d.dia] ||= []).push({ nome: p.nome, valor: d.comissao });
    const ord = Object.keys(dias).sort();
    csv.push(['Data', 'Pessoa', 'Comissão'].join(';'));
    corpo += `<table><thead><tr><th>Data</th><th class="n">Total do dia</th><th>Quem gerou</th></tr></thead><tbody>
      ${ord.map(d => { const t = dias[d].reduce((s, x) => s + x.valor, 0);
        dias[d].forEach(x => csv.push([br(d), x.nome, num(x.valor)].join(';')));
        return `<tr><td>${br(d)}</td><td class="n"><strong>${$cc(t)}</strong></td><td>${dias[d].sort((a, b) => b.valor - a.valor).map(x => `${esc(x.nome)}: ${$cc(x.valor)}`).join(' · ')}</td></tr>`; }).join('')}
      <tr class="grand"><td>TOTAL</td><td class="n">${$cc(total)}</td><td></td></tr></tbody></table>`;
  } else if (modo === 'entregador') {
    csv.push(['Entregador', 'Data', 'Entregas', 'Reentregas', 'Comissão'].join(';'));
    corpo += `<h2>Resumo</h2><table><thead><tr><th>Entregador</th><th class="n">Entregas</th><th class="n">Reentregas</th><th class="n">Comissão</th></tr></thead><tbody>
      ${lista.map(p => `<tr><td>${esc(p.nome)}</td><td class="n">${p.porTipo.entrega.qtd}</td><td class="n">${p.porTipo.reentrega.qtd}</td><td class="n"><strong>${$cc(p.total)}</strong></td></tr>`).join('')}
      <tr class="grand"><td>TOTAL</td><td class="n">${lista.reduce((s, p) => s + p.porTipo.entrega.qtd, 0)}</td><td class="n">${lista.reduce((s, p) => s + p.porTipo.reentrega.qtd, 0)}</td><td class="n">${$cc(total)}</td></tr></tbody></table>`;
    for (const p of lista) {
      corpo += `<h3>🚚 ${esc(p.nome)} — ${$cc(p.total)}</h3><table><thead><tr><th>Data</th><th class="n">Entregas</th><th class="n">Reentregas</th><th class="n">Comissão</th></tr></thead><tbody>
        ${p.porDia.map(d => { const ne = (p.linhas || []).filter(l => l.dia === d.dia && l.tipo === 'entrega').length;
          const nr = (p.linhas || []).filter(l => l.dia === d.dia && l.tipo === 'reentrega').length;
          csv.push([p.nome, br(d.dia), p.linhas ? ne : '', p.linhas ? nr : '', num(d.comissao)].join(';'));
          return `<tr><td>${br(d.dia)}</td><td class="n">${p.linhas ? ne : '—'}</td><td class="n">${p.linhas ? nr : '—'}</td><td class="n">${$cc(d.comissao)}</td></tr>`; }).join('')}
        <tr class="grand"><td>TOTAL</td><td class="n">${p.porTipo.entrega.qtd}</td><td class="n">${p.porTipo.reentrega.qtd}</td><td class="n">${$cc(p.total)}</td></tr></tbody></table>`;
    }
  } else {
    csv.push(['Funcionária', 'Data', 'Pedidos', 'Vendido', 'Comissão venda', 'Montagem', 'Expedição', 'Comissão total'].join(';'));
    corpo += `<h2>Resumo</h2><table><thead><tr><th>Funcionária</th><th class="n">Pedidos</th><th class="n">Vendido (base)</th><th class="n">Com. venda</th><th class="n">Montagem</th><th class="n">Expedição</th><th class="n">Comissão</th></tr></thead><tbody>
      ${lista.map(p => `<tr><td>${esc(p.nome)}</td><td class="n">${p.porTipo.venda.qtd}</td><td class="n">${$cc(p.porTipo.venda.base)}</td><td class="n">${$cc(p.porTipo.venda.comissao)}</td><td class="n">${$cc(p.porTipo.montagem.comissao)}</td><td class="n">${$cc(p.porTipo.expedicao.comissao)}</td><td class="n"><strong>${$cc(p.total)}</strong></td></tr>`).join('')}
      <tr class="grand"><td>TOTAL</td><td class="n">${lista.reduce((s, p) => s + p.porTipo.venda.qtd, 0)}</td><td class="n">${$cc(lista.reduce((s, p) => s + p.porTipo.venda.base, 0))}</td><td class="n">${$cc(lista.reduce((s, p) => s + p.porTipo.venda.comissao, 0))}</td><td class="n">${$cc(lista.reduce((s, p) => s + p.porTipo.montagem.comissao, 0))}</td><td class="n">${$cc(lista.reduce((s, p) => s + p.porTipo.expedicao.comissao, 0))}</td><td class="n">${$cc(total)}</td></tr></tbody></table>`;
    for (const p of lista) {
      corpo += `<h3>👩‍💼 ${esc(p.nome)} — ${$cc(p.total)}</h3><table><thead><tr><th>Data</th><th class="n">Pedidos</th><th class="n">Vendido</th><th class="n">Com. venda</th><th class="n">Montagem</th><th class="n">Expedição</th><th class="n">Comissão do dia</th></tr></thead><tbody>
        ${p.porDia.map(d => { const vs = (p.linhas || []).filter(l => l.dia === d.dia && l.tipo === 'venda');
          const vend = vs.reduce((s, l) => s + l.base, 0);
          csv.push([p.nome, br(d.dia), vs.length, num(vend), num(d.venda), num(d.montagem), num(d.expedicao), num(d.comissao)].join(';'));
          return `<tr><td>${br(d.dia)}</td><td class="n">${vs.length}</td><td class="n">${$cc(vend)}</td><td class="n">${$cc(d.venda)}</td><td class="n">${$cc(d.montagem)}</td><td class="n">${$cc(d.expedicao)}</td><td class="n">${$cc(d.comissao)}</td></tr>`; }).join('')}
        <tr class="grand"><td>TOTAL</td><td class="n">${p.porTipo.venda.qtd}</td><td class="n">${$cc(p.porTipo.venda.base)}</td><td class="n">${$cc(p.porTipo.venda.comissao)}</td><td class="n">${$cc(p.porTipo.montagem.comissao)}</td><td class="n">${$cc(p.porTipo.expedicao.comissao)}</td><td class="n">${$cc(p.total)}</td></tr></tbody></table>`;
      csv.push([p.nome, 'TOTAL', p.porTipo.venda.qtd, num(p.porTipo.venda.base), num(p.porTipo.venda.comissao), num(p.porTipo.montagem.comissao), num(p.porTipo.expedicao.comissao), num(p.total)].join(';'));
    }
  }

  if (detalhe) {
    csv.push('', ['Pessoa', 'Pedido', 'Data', 'Cliente', 'Tipo', 'Valor do pedido', 'Base', 'Comissão'].join(';'));
    corpo += `<h2>🔎 Detalhe por pedido</h2>`;
    for (const p of lista) {
      const ls = p.linhas || [];
      if (!ls.length) continue;
      corpo += `<h3>${esc(p.nome)}</h3><table><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Tipo</th><th class="n">Valor do pedido</th><th class="n">Base</th><th class="n">Comissão</th></tr></thead><tbody>
        ${ls.map(l => { const base = l.tipo === 'montagem' ? `${l.qtd} item(ns) × ${$cc(l.unitario)}` : l.tipo === 'venda' ? `${$cc(l.base)} × ${String(l.pct).replace('.', ',')}%` : $cc(l.base);
          csv.push([p.nome, l.orderNumber, br(l.dia), l.cliente, TIPO_LABEL[l.tipo], num(l.valorPedido), l.tipo === 'montagem' ? l.qtd : num(l.base), num(l.comissao)].map(v => String(v).replace(/;/g, ',')).join(';'));
          return `<tr><td>${esc(l.orderNumber)}</td><td>${br(l.dia)}</td><td>${esc(l.cliente)}</td><td>${TIPO_LABEL[l.tipo]}</td><td class="n">${$cc(l.valorPedido)}</td><td class="n">${base}</td><td class="n">${$cc(l.comissao)}</td></tr>`; }).join('')}
        <tr class="grand"><td colspan="6">TOTAL ${esc(p.nome)}</td><td class="n">${$cc(ls.reduce((s, l) => s + l.comissao, 0))}</td></tr></tbody></table>`;
    }
  }
  return { html: corpo, csv: csv.join('\r\n') };
}
