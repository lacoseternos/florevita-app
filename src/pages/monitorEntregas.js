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
import { montarMapaEntregas, rastrearEntregadores } from '../utils/mapaEntregas.js';
import { corDoPedido, labelDoPedido, corEntregador, inicialEntregador, COR_NA_LOJA, carregarCores, salvarCorEntregador } from '../utils/coresEntregadores.js';

let _monClockIv = null;
let _monState = { markers: null, map: null };
let _coresReady = false;

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
  const cor = corDoPedido(o);
  const label = labelDoPedido(o);
  const num = fmtOrderNum(o);
  const cli = o.clientName || o.client?.name || '—';
  const bairro = o.deliveryNeighborhood || o.deliveryBairro || o.deliveryCity || '';
  const hora = o.scheduledTime || o.scheduledPeriod || '';
  const driver = _driverNome(o);
  const rank = o._rotaRank;
  return `
    <div class="mon-card" style="border-left-color:${cor};" data-mon-focus="${_esc(String(o._id||o.id||''))}">
      <div class="mon-cic" style="background:${cor};position:relative;">🛍️${rank ? `<span style="position:absolute;top:-6px;right:-6px;background:#0F172A;color:#fff;font-size:9px;font-weight:800;border-radius:10px;min-width:16px;height:16px;display:flex;align-items:center;justify-content:center;padding:0 3px;border:2px solid #fff;">${rank}º</span>` : ''}</div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
          <span style="font-weight:800;font-size:13px;color:#0F172A;">${rank ? `<span style="color:#7C3AED;">${rank}º · </span>` : ''}${_esc(num)}</span>
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
  // Ordem da rota (1º, 2º, 3º…) por entregador, entre os que estão "em rota".
  (function _ranks() {
    doDia.forEach(o => { if (o._rotaRank) delete o._rotaRank; });
    const emRota = doDia.filter(o => o.type === 'Delivery' && String(o.status || '').toLowerCase().includes('saiu'));
    const byDrv = {};
    emRota.forEach(o => { const d = _driverNome(o) || '—'; (byDrv[d] = byDrv[d] || []).push(o); });
    Object.values(byDrv).forEach(arr => {
      arr.sort((a, b) => (Number(a.deliveryOrder) || 999) - (Number(b.deliveryOrder) || 999) || String(a.scheduledTime || '').localeCompare(String(b.scheduledTime || '')));
      arr.forEach((o, i) => { o._rotaRank = i + 1; });
    });
  })();
  const ativas = _entregasAtivas();            // delivery, não entregues, com filtro

  const nPrep = doDia.filter(o => ['aguard','prepar'].some(x => String(o.status||'').toLowerCase().includes(x))).length;
  const nSaiu = doDia.filter(o => String(o.status||'').toLowerCase().includes('saiu')).length;
  const nEntregue = doDia.filter(_entregue).length;
  const nOcorr = doDia.filter(_ocorrencia).length;

  // Chip de filtro ativo
  const chip = filtro ? `<div class="mon-chip">🛵 Só entregas de <b>${_esc(filtro)}</b><button id="mon-clear-filter" title="Limpar filtro">✕</button></div>` : '';

  // Legenda dinâmica: "Na loja" (cinza) + cada entregador com rota na cor dele.
  const driversEmRota = [...new Set(doDia
    .filter(o => o.type === 'Delivery' && String(o.status || '').toLowerCase().includes('saiu'))
    .map(_driverNome).filter(Boolean))];
  const _primeiroNome = d => _esc(String(d).replace(/^(sr|sra|dr|dra)\.?\s+/i, '').split(' ')[0] || d);
  const legendaHtml = `<span><i style="background:${COR_NA_LOJA}"></i>Na loja</span>`
    + driversEmRota.map(d => `<span><i style="background:${corEntregador(d)}"></i>${_primeiroNome(d)}</span>`).join('')
    + `<span><i style="background:#334155;border-radius:4px;"></i>🛵 entregador</span>`;

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
      const cor = corEntregador(d);
      return `<div class="mon-card" style="border-left-color:${cor};${sel?'background:#F5F3FF;':''}" data-mon-driver="${_esc(d)}">
        <div class="mon-av" style="width:40px;height:40px;font-size:15px;background:${cor};color:#fff;">${_esc(inicialEntregador(d))}</div>
        <div style="flex:1;min-width:0;"><div style="font-weight:800;font-size:13px;">${_esc(d)}</div>
        <div style="font-size:11px;color:#64748B;">${arr.length} entrega(s) · ${emRota} em rota</div></div>
        <label title="Mudar a cor de ${_esc(d)}" onclick="event.stopPropagation()" style="display:flex;align-items:center;cursor:pointer;flex-shrink:0;">
          <input type="color" value="${cor}" data-mon-color="${_esc(d)}" style="width:30px;height:30px;border:none;border-radius:8px;background:none;cursor:pointer;padding:0;"/>
        </label>
        <span style="font-size:10px;color:${cor};font-weight:700;flex-shrink:0;">${sel?'✓ filtrando':'ver →'}</span>
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
      <div class="mon-legend">${legendaHtml}</div>
    </div>
  </div>
</div>`;
}

// Coloca um ícone de alerta nos cards cujo endereço não foi localizado.
function _decorateFailed() {
  const failed = (_monState && _monState.failed) || [];
  failed.forEach(id => {
    const card = document.querySelector(`.mon-card[data-mon-focus="${id}"]`);
    if (!card || card.querySelector('.mon-alert')) return;
    const a = document.createElement('button');
    a.className = 'mon-alert';
    a.title = 'Endereço não localizado no mapa — clique para corrigir';
    a.textContent = '⚠️';
    a.style.cssText = 'background:#FEF3C7;border:1px solid #F59E0B;color:#92400E;border-radius:9px;padding:5px 8px;font-size:14px;cursor:pointer;flex-shrink:0;';
    a.addEventListener('click', (e) => { e.stopPropagation(); _abrirFixModal(id); });
    card.appendChild(a);
  });
}

function _pedidoPorId(id) { return (S.orders || []).find(o => String(o._id || o.id || '') === String(id)); }

// Modal pra corrigir o endereço OU marcar o ponto manualmente no mapa.
function _abrirFixModal(id) {
  const o = _pedidoPorId(id);
  if (!o) return;
  const num = fmtOrderNum(o);
  const old = document.getElementById('mon-fix');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'mon-fix';
  ov.setAttribute('style', 'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;');
  ov.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.45);">
      <div style="font-weight:800;font-size:16px;color:#1E293B;margin-bottom:4px;">📍 Localizar ${_esc(num)}</div>
      <div style="font-size:12px;color:#64748B;margin-bottom:14px;">O endereço não foi encontrado no mapa. Corrija o endereço ou marque o ponto manualmente.</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;">
        <input id="mon-fix-rua" value="${_esc(o.deliveryStreet||'')}" placeholder="Rua / Avenida" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;"/>
        <input id="mon-fix-num" value="${_esc(o.deliveryNumber||'')}" placeholder="Nº" style="width:70px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;"/>
      </div>
      <input id="mon-fix-bairro" value="${_esc(o.deliveryNeighborhood||o.deliveryBairro||'')}" placeholder="Bairro" style="width:100%;box-sizing:border-box;margin-top:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;"/>
      <button id="mon-fix-save" style="width:100%;margin-top:12px;background:#2563EB;color:#fff;border:none;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">💾 Salvar endereço e localizar</button>
      <button id="mon-fix-pick" style="width:100%;margin-top:8px;background:#fff;color:#7C3AED;border:1.5px solid #7C3AED;border-radius:9px;padding:11px;font-weight:800;cursor:pointer;">📌 Marcar o ponto no mapa</button>
      <button id="mon-fix-close" style="width:100%;margin-top:8px;background:none;color:#64748B;border:none;padding:8px;font-size:12px;cursor:pointer;">Cancelar</button>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#mon-fix-close').onclick = close;
  ov.querySelector('#mon-fix-save').onclick = async () => {
    const rua = ov.querySelector('#mon-fix-rua').value.trim();
    const numero = ov.querySelector('#mon-fix-num').value.trim();
    const bairro = ov.querySelector('#mon-fix-bairro').value.trim();
    try {
      const { PUT } = await import('../services/api.js');
      await PUT('/orders/' + (o._id || o.id), { deliveryStreet: rua, deliveryNumber: numero, deliveryNeighborhood: bairro, geoLat: null, geoLng: null });
      o.deliveryStreet = rua; o.deliveryNumber = numero; o.deliveryNeighborhood = bairro; o.geoLat = null; o.geoLng = null;
      const { toast } = await import('../utils/helpers.js'); toast('✅ Endereço atualizado — localizando…');
      close();
      import('../main.js').then(m => m.render());
    } catch (e) {
      const { toast } = await import('../utils/helpers.js'); toast('❌ Erro ao salvar endereço', true);
    }
  };
  ov.querySelector('#mon-fix-pick').onclick = () => { close(); _pickOnMap(o); };
}

// Modo "marcar ponto": mostra um banner e o próximo clique no mapa define
// geoLat/geoLng do pedido.
async function _pickOnMap(o) {
  const map = _monState && _monState.map;
  const { toast } = await import('../utils/helpers.js');
  if (!map) { toast('O mapa ainda está carregando — tente de novo em instantes.', true); return; }
  const wrap = document.querySelector('.mon-mapwrap');
  const banner = document.createElement('div');
  banner.id = 'mon-pick-banner';
  banner.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:1500;background:#7C3AED;color:#fff;padding:10px 14px;border-radius:30px;box-shadow:0 6px 18px rgba(0,0,0,.35);font-size:13px;font-weight:800;display:flex;align-items:center;gap:10px;white-space:nowrap;';
  banner.innerHTML = `📌 Toque no mapa para marcar ${_esc(fmtOrderNum(o))} <button id="mon-pick-cancel" style="background:rgba(255,255,255,.25);border:none;color:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-weight:800;">Cancelar</button>`;
  if (wrap) wrap.appendChild(banner);
  try { map.getContainer().style.cursor = 'crosshair'; } catch (_) {}
  let temp = null;
  const cleanup = () => {
    try { map.off('click', onClick); } catch (_) {}
    try { map.getContainer().style.cursor = ''; } catch (_) {}
    banner.remove();
    if (temp) { try { map.removeLayer(temp); } catch (_) {} }
  };
  const onClick = async (e) => {
    const lat = e.latlng.lat, lng = e.latlng.lng;
    if (temp) { try { map.removeLayer(temp); } catch (_) {} }
    temp = window.L.circleMarker([lat, lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#7C3AED', fillOpacity: 1 }).addTo(map);
    try { map.off('click', onClick); } catch (_) {}
    try { map.getContainer().style.cursor = ''; } catch (_) {}
    banner.innerHTML = '⏳ Salvando ponto…';
    try {
      const { PUT } = await import('../services/api.js');
      await PUT('/orders/' + (o._id || o.id), { geoLat: lat, geoLng: lng });
      o.geoLat = lat; o.geoLng = lng;
      toast('✅ Ponto definido no mapa');
      banner.remove();
      import('../main.js').then(m => m.render());
    } catch (_) { toast('❌ Erro ao salvar o ponto', true); cleanup(); }
  };
  banner.querySelector('#mon-pick-cancel')?.addEventListener('click', cleanup);
  map.on('click', onClick);
}

export function bindMonitorEntregasEvents() {
  const rerender = () => import('../main.js').then(m => m.render());
  const go = (p) => import('../utils/helpers.js').then(m => m.setPage(p)).catch(()=>{});

  // Carrega as cores dos entregadores 1x e re-renderiza pra aplicar.
  if (!_coresReady) {
    carregarCores().then(() => { _coresReady = true; rerender(); }).catch(() => { _coresReady = true; });
  }

  document.querySelectorAll('[data-mon-tab]').forEach(b => {
    b.onclick = () => { S._monTab = b.dataset.monTab; rerender(); };
  });
  // Mudar a cor de um entregador (aba Entregadores)
  document.querySelectorAll('[data-mon-color]').forEach(inp => {
    inp.addEventListener('change', async (e) => {
      e.stopPropagation();
      await salvarCorEntregador(inp.dataset.monColor, inp.value);
      rerender();
    });
    inp.addEventListener('click', (e) => e.stopPropagation());
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
      _decorateFailed(); // marca cards sem localização com ⚠️
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
