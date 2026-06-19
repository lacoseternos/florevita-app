// ── PÁGINA: PAINEL DE DELIVERY (modo TV) ─────────────────────
// Marcia (19/jun/2026): painel em tela cheia pra ACOMPANHAR as entregas
// em rota / a sair (entregues NÃO aparecem). Lista à esquerda (abas
// Pedidos/Entregadores/Ocorrências) e mapa à direita com pinos coloridos
// + motos dos entregadores ao vivo. Clicar num entregador filtra só as
// entregas dele. Read-only (gerenciar continua na Expedição).

import { S } from '../state.js';
import { ini, fmtOrderNum } from '../utils/formatters.js';
import { manausDateStr as _manausDateStrSrv } from '../services/serverClock.js';
import { filtrarPedidosParaProducao } from '../utils/unidadeRules.js';
import { statusEntregaInfo, montarMapaEntregas, rastrearEntregadores } from '../utils/mapaEntregas.js';

let _monClockIv = null;
let _monState = { markers: null, map: null };

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

const _entregue = o => String(o.status || '').toLowerCase().includes('entregue');
const _ocorrencia = o => Number(o.reentregaCount) > 0 || (Array.isArray(o.reentregas) && o.reentregas.length > 0);
const _driverNome = o => o.driverName || o.assignedDriverName || '';

// Todas as entregas do dia (filtradas por unidade).
function _entregasDoDia() {
  const today = _manausDateStrSrv();
  const ops = filtrarPedidosParaProducao(S.user, S.orders || []);
  return ops.filter(o => {
    if (!o || o.status === 'Cancelado' || o.type === 'Balcão') return false;
    if (!o.scheduledDate) return true;
    return String(o.scheduledDate).slice(0, 10) === today;
  });
}

// Entregas ATIVAS pro mapa/lista: delivery, NÃO entregues. Aplica filtro
// por entregador (S._monFilter) quando setado.
function _entregasAtivas() {
  let arr = _entregasDoDia().filter(o => o.type === 'Delivery' && !_entregue(o));
  const f = S._monFilter;
  if (f && f.driver) {
    const fn = f.driver.toLowerCase();
    arr = arr.filter(o => _driverNome(o).toLowerCase() === fn);
  }
  return arr;
}

function _peso(o) {
  const s = String(o.status || '').toLowerCase();
  if (s.includes('saiu')) return 0;
  if (s.includes('pronto')) return 1;
  if (s.includes('aguard') || s.includes('prepar')) return 2;
  return 3;
}

function _cssOnce() {
  if (document.getElementById('monitor-style')) return;
  const st = document.createElement('style');
  st.id = 'monitor-style';
  st.textContent = `
    .mon-wrap{position:fixed;inset:0;z-index:4000;display:flex;flex-direction:column;background:#F8FAFC;}
    .mon-head{background:linear-gradient(120deg,#1D4ED8,#2563EB);color:#fff;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;flex-shrink:0;}
    .mon-title{display:flex;align-items:center;gap:12px;}
    .mon-title .ic{width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:24px;}
    .mon-stats{display:flex;gap:10px;flex-wrap:wrap;flex:1;justify-content:center;}
    .mon-stat{background:#fff;border-radius:12px;padding:8px 14px;display:flex;align-items:center;gap:10px;min-width:118px;box-shadow:0 2px 6px rgba(0,0,0,.12);}
    .mon-stat .sic{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff;}
    .mon-stat .sv{font-size:18px;font-weight:800;color:#0F172A;line-height:1;}
    .mon-stat .sl{font-size:10.5px;color:#64748B;font-weight:600;}
    .mon-clock{background:rgba(255,255,255,.15);border-radius:12px;padding:8px 14px;text-align:center;min-width:96px;}
    .mon-clock .t{font-size:20px;font-weight:800;line-height:1;letter-spacing:.5px;}
    .mon-clock .d{font-size:10px;opacity:.9;margin-top:2px;}
    .mon-clock .w{font-size:11px;opacity:.95;margin-top:2px;font-weight:700;}
    .mon-body{flex:1;display:flex;min-height:0;background:#F8FAFC;}
    .mon-left{width:380px;max-width:42%;background:#fff;border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0;}
    .mon-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0;}
    .mon-tab{flex:1;padding:12px 6px;font-size:13px;font-weight:700;color:#64748B;background:none;border:none;cursor:pointer;border-bottom:2px solid transparent;}
    .mon-tab.active{color:#2563EB;border-bottom-color:#2563EB;}
    .mon-chip{display:flex;align-items:center;gap:8px;margin:8px 10px 0;background:#EDE9FE;color:#5B21B6;border-radius:10px;padding:7px 11px;font-size:12px;font-weight:700;}
    .mon-chip button{margin-left:auto;background:#fff;border:none;border-radius:6px;width:22px;height:22px;cursor:pointer;font-weight:800;color:#5B21B6;}
    .mon-list{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:0;}
    .mon-card{display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;border:1px solid var(--border);border-left-width:5px;cursor:pointer;transition:background .12s;}
    .mon-card:hover{background:#F1F5F9;}
    .mon-cic{width:40px;height:40px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0;}
    .mon-badge{font-size:9.5px;font-weight:800;padding:2px 8px;border-radius:20px;color:#fff;}
    .mon-av{width:30px;height:30px;border-radius:50%;background:#E2E8F0;color:#475569;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .mon-mapwrap{flex:1;position:relative;min-width:0;}
    #mon-map{position:absolute;inset:0;background:#E5E7EB;}
    .mon-legend{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:500;background:#fff;border-radius:30px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:8px 16px;display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;font-weight:700;color:#334155;}
    .mon-legend span{display:flex;align-items:center;gap:5px;}
    .mon-legend i{width:11px;height:11px;border-radius:50%;display:inline-block;}
    @media(max-width:820px){ .mon-body{flex-direction:column;} .mon-left{width:100%;max-width:100%;height:42%;} .mon-mapwrap{height:58%;} }
  `;
  document.head.appendChild(st);
}

function _statBadge(cor, icon, val, label) {
  return `<div class="mon-stat"><div class="sic" style="background:${cor}">${icon}</div><div><div class="sv">${val}</div><div class="sl">${label}</div></div></div>`;
}

function _orderCard(o) {
  const { cor, label } = statusEntregaInfo(o);
  const num = fmtOrderNum(o);
  const cli = o.clientName || o.client?.name || '—';
  const bairro = o.deliveryNeighborhood || o.deliveryBairro || o.deliveryCity || '';
  const hora = o.scheduledTime || o.scheduledPeriod || '';
  const driver = _driverNome(o);
  return `
    <div class="mon-card" style="border-left-color:${cor};" data-mon-focus="${_esc(String(o._id||o.id||''))}">
      <div class="mon-cic" style="background:${cor}">🛍️</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
          <span style="font-weight:800;font-size:13px;color:#0F172A;">${_esc(num)}</span>
          <span class="mon-badge" style="background:${cor}">${_esc(label)}</span>
        </div>
        <div style="font-size:12px;color:#334155;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(cli)}</div>
        <div style="font-size:11px;color:#94A3B8;margin-top:1px;">📍 ${_esc(bairro)}${hora?` · 🕐 ${_esc(hora)}`:''}</div>
      </div>
      ${driver ? `<div style="text-align:center;"><div class="mon-av">${_esc(ini(driver))}</div><div style="font-size:9px;color:#64748B;margin-top:2px;max-width:48px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(driver.split(' ')[0])}</div></div>` : `<div class="mon-av" title="Sem entregador">⏳</div>`}
    </div>`;
}

export function renderMonitorEntregas() {
  _cssOnce();
  if (!['pedidos', 'entregadores', 'ocorrencias'].includes(S._monTab)) S._monTab = 'pedidos';
  const tab = S._monTab;
  const filtro = S._monFilter && S._monFilter.driver ? S._monFilter.driver : '';

  const doDia = _entregasDoDia();
  const ativas = _entregasAtivas();            // delivery, não entregues, com filtro

  const nPrep = doDia.filter(o => ['aguard','prepar'].some(x => String(o.status||'').toLowerCase().includes(x))).length;
  const nSaiu = doDia.filter(o => String(o.status||'').toLowerCase().includes('saiu')).length;
  const nEntregue = doDia.filter(_entregue).length;
  const nOcorr = doDia.filter(_ocorrencia).length;

  // Chip de filtro ativo
  const chip = filtro ? `<div class="mon-chip">🛵 Só entregas de <b>${_esc(filtro)}</b><button id="mon-clear-filter" title="Limpar filtro">✕</button></div>` : '';

  let listaHtml = '';
  if (tab === 'pedidos') {
    const ord = ativas.slice().sort((a,b)=> _peso(a)-_peso(b) || String(a.scheduledTime||'').localeCompare(String(b.scheduledTime||'')));
    listaHtml = ord.length ? ord.map(_orderCard).join('') : `<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">Nenhuma entrega ${filtro?'desse entregador':'em rota ou a sair'}</div>`;
  } else if (tab === 'entregadores') {
    // Agrupa por entregador (entre as entregas ativas, ignorando o filtro
    // pra sempre listar todos — o clique aplica o filtro).
    const base = _entregasDoDia().filter(o => o.type === 'Delivery' && !_entregue(o));
    const byDrv = {};
    base.forEach(o => { const d = _driverNome(o); if (d) (byDrv[d] = byDrv[d] || []).push(o); });
    const drivers = Object.keys(byDrv).sort();
    listaHtml = drivers.length ? drivers.map(d => {
      const arr = byDrv[d];
      const emRota = arr.filter(o=>String(o.status||'').toLowerCase().includes('saiu')).length;
      const sel = filtro && filtro.toLowerCase() === d.toLowerCase();
      return `<div class="mon-card" style="border-left-color:#7C3AED;${sel?'background:#F5F3FF;':''}" data-mon-driver="${_esc(d)}">
        <div class="mon-av" style="width:40px;height:40px;font-size:14px;background:#EDE9FE;color:#6D28D9;">${_esc(ini(d))}</div>
        <div style="flex:1;"><div style="font-weight:800;font-size:13px;">${_esc(d)}</div>
        <div style="font-size:11px;color:#64748B;">${arr.length} entrega(s) · ${emRota} em rota</div></div>
        <span style="font-size:11px;color:#7C3AED;font-weight:700;">${sel?'✓ filtrando':'ver no mapa →'}</span>
      </div>`;
    }).join('') : `<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">Nenhum entregador com rota hoje</div>`;
  } else {
    const ocs = doDia.filter(_ocorrencia);
    listaHtml = ocs.length ? ocs.map(o => {
      const last = Array.isArray(o.reentregas) && o.reentregas.length ? o.reentregas[o.reentregas.length-1] : null;
      const motivo = last?.motivo || last?.reason || 'Reentrega registrada';
      return `<div class="mon-card" style="border-left-color:#E11D48;" data-mon-focus="${_esc(String(o._id||o.id||''))}">
        <div class="mon-cic" style="background:#E11D48">⚠️</div>
        <div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:13px;">${_esc(fmtOrderNum(o))}</div>
        <div style="font-size:11.5px;color:#334155;">${_esc(o.clientName||'—')}</div>
        <div style="font-size:11px;color:#E11D48;">↩️ ${_esc(motivo)}</div></div>
      </div>`;
    }).join('') : `<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">Nenhuma ocorrência hoje 🎉</div>`;
  }

  const tabBtn = (k, label) => `<button class="mon-tab ${tab===k?'active':''}" data-mon-tab="${k}">${label}</button>`;

  return `
<div class="mon-wrap">
  <div class="mon-head">
    <div class="mon-title">
      <div class="ic">🚚</div>
      <div>
        <div style="font-size:20px;font-weight:800;line-height:1.1;">Painel de Delivery</div>
        <div style="font-size:12px;opacity:.9;">Acompanhe as entregas em tempo real</div>
      </div>
    </div>
    <div class="mon-stats">
      ${_statBadge('#2563EB','📦',nPrep,'Em preparação')}
      ${_statBadge('#7C3AED','🛵',nSaiu,'Saiu para entrega')}
      ${_statBadge('#16A34A','✅',nEntregue,'Entregues hoje')}
      ${_statBadge('#E11D48','⚠️',nOcorr,'Ocorrências')}
    </div>
    <div class="mon-clock">
      <div class="t" id="mon-clock-t">--:--</div>
      <div class="d" id="mon-clock-d"></div>
      <div class="w" id="mon-weather">🌤️ --°</div>
    </div>
    <button class="btn btn-ghost btn-sm" id="mon-back" style="background:rgba(255,255,255,.18);color:#fff;border:none;">✕ Sair</button>
  </div>
  <div class="mon-body">
    <aside class="mon-left">
      <div class="mon-tabs">
        ${tabBtn('pedidos','Pedidos')}
        ${tabBtn('entregadores','Entregadores')}
        ${tabBtn('ocorrencias','Ocorrências')}
      </div>
      ${chip}
      <div class="mon-list">${listaHtml}</div>
      <button class="btn btn-ghost btn-sm" id="mon-ver-todos" style="margin:8px;">Ir para a Expedição →</button>
    </aside>
    <div class="mon-mapwrap">
      <div id="mon-map"></div>
      <div class="mon-legend">
        <span><i style="background:#2563EB"></i>Em preparação</span>
        <span><i style="background:#F59E0B"></i>Pronto</span>
        <span><i style="background:#7C3AED"></i>Em rota</span>
        <span><i style="background:#E11D48"></i>Ocorrência</span>
        <span><i style="background:#7C3AED;border-radius:4px;"></i>🛵 Entregador</span>
      </div>
    </div>
  </div>
</div>`;
}

export function bindMonitorEntregasEvents() {
  const rerender = () => import('../main.js').then(m => m.render());
  const go = (p) => import('../utils/helpers.js').then(m => m.setPage(p)).catch(()=>{});

  document.querySelectorAll('[data-mon-tab]').forEach(b => {
    b.onclick = () => { S._monTab = b.dataset.monTab; rerender(); };
  });
  document.getElementById('mon-back')?.addEventListener('click', () => go('expedicao'));
  document.getElementById('mon-ver-todos')?.addEventListener('click', () => go('expedicao'));

  // Filtrar por entregador (aba Entregadores) + limpar filtro
  document.querySelectorAll('[data-mon-driver]').forEach(c => {
    c.addEventListener('click', () => {
      const d = c.dataset.monDriver;
      S._monFilter = (S._monFilter && S._monFilter.driver === d) ? null : { driver: d };
      S._monTab = 'pedidos';
      rerender();
    });
  });
  document.getElementById('mon-clear-filter')?.addEventListener('click', (e) => {
    e.stopPropagation(); S._monFilter = null; rerender();
  });

  // Relógio ao vivo (fuso de Manaus) + data
  if (_monClockIv) { clearInterval(_monClockIv); _monClockIv = null; }
  const tickClock = () => {
    const t = document.getElementById('mon-clock-t');
    const d = document.getElementById('mon-clock-d');
    if (!t) { if (_monClockIv) { clearInterval(_monClockIv); _monClockIv = null; } return; }
    try {
      const now = new Date();
      t.textContent = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit' });
      if (d) d.textContent = now.toLocaleDateString('pt-BR', { timeZone: 'America/Manaus', weekday: 'short', day: '2-digit', month: '2-digit' });
    } catch (_) {}
  };
  tickClock();
  _monClockIv = setInterval(tickClock, 1000 * 20);

  // Clima atual de Manaus (open-meteo, sem chave)
  (async () => {
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=-3.119&longitude=-60.0217&current=temperature_2m');
      const j = await r.json();
      const temp = j?.current?.temperature_2m;
      const el = document.getElementById('mon-weather');
      if (el && temp != null) el.textContent = `🌤️ ${Math.round(temp)}°`;
    } catch (_) {}
  })();

  // Mapa inline — só entregas ativas (não entregues), com filtro aplicado
  const mapEl = document.getElementById('mon-map');
  if (mapEl) {
    const ativas = _entregasAtivas();
    const filtroNome = S._monFilter && S._monFilter.driver ? S._monFilter.driver : '';
    montarMapaEntregas(mapEl, ativas, { warnFail: false }).then(res => {
      _monState = res || { markers: null, map: null };
      if (_monState && _monState.map) {
        try { rastrearEntregadores(_monState.map, mapEl, filtroNome); } catch (_) {}
      }
    });
  }

  // Clicar num card → centraliza/abre o balão no mapa
  document.querySelectorAll('[data-mon-focus]').forEach(c => {
    c.addEventListener('click', () => {
      const id = c.dataset.monFocus;
      const mk = _monState.markers && _monState.markers.get(id);
      if (mk && _monState.map) {
        _monState.map.setView(mk.getLatLng(), 16, { animate: true });
        mk.openPopup();
      }
    });
  });
}
