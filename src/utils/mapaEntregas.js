// ── MAPA DE ENTREGAS (Expedição / Acompanhamento) ────────────
// Marcia (19/jun/2026): mostra as entregas do dia num mapa pra facilitar
// montar rotas e visualizar onde fica cada uma.
//
// Usa Leaflet + OpenStreetMap (GRÁTIS, sem chave de API). Base map
// minimalista (CartoDB Positron). Os endereços dos pedidos sao texto
// (sem lat/lng), entao geocodificamos via Nominatim (OSM) com CACHE em
// localStorage — cada endereço so e buscado 1x.
//
// Cada entrega vira um balãozinho sempre visível com código + status +
// turno/horário, colorido por status. Popup completo no clique.

import { toast } from './helpers.js';

const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
const LEAFLET_JS  = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
const MANAUS = [-3.1190, -60.0217];
const GEO_CACHE_KEY = 'fv_geocache_v1';

// ── Carrega Leaflet (CSS + JS) uma única vez ─────────────────
let _leafletPromise = null;
function _ensureLeaflet() {
  if (window.L) return Promise.resolve();
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha ao carregar o mapa (Leaflet)'));
    document.head.appendChild(s);
  });
  return _leafletPromise;
}

// ── Cache de geocodificação ──────────────────────────────────
function _getGeoCache() {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function _saveGeoCache(c) {
  try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(c)); } catch (_) {}
}
function _normKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
const _delay = ms => new Promise(r => setTimeout(r, ms));

function _enderecoDoPedido(o) {
  const rua    = o.deliveryStreet || o.endereco?.rua || '';
  const num    = o.deliveryNumber || o.endereco?.numero || '';
  const bairro = o.deliveryNeighborhood || o.deliveryBairro || o.endereco?.bairro || '';
  const cidade = o.deliveryCity || o.endereco?.cidade || 'Manaus';
  if (rua) return `${rua}${num ? (', ' + num) : ''} - ${bairro}, ${cidade}, AM, Brasil`;
  if (o.deliveryAddress) return `${o.deliveryAddress}, Manaus, AM, Brasil`;
  if (bairro) return `${bairro}, ${cidade}, AM, Brasil`;
  return '';
}

async function _geocode(addr, cache) {
  const key = _normKey(addr);
  if (!key) return null;
  if (key in cache) return cache[key];
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(addr);
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await r.json();
    cache[key] = (Array.isArray(data) && data[0] && data[0].lat) ? { lat: +data[0].lat, lng: +data[0].lon } : null;
  } catch (_) {
    cache[key] = null;
  }
  _saveGeoCache(cache);
  return cache[key];
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

// Status → cor + rótulo. Ocorrência (reentrega) tem prioridade visual.
export function statusEntregaInfo(o) {
  const s = String(o.status || '').toLowerCase();
  const temOcorr = (Number(o.reentregaCount) > 0) || (Array.isArray(o.reentregas) && o.reentregas.length > 0);
  if (s.includes('entregue')) return { cor: '#16A34A', label: 'Entregue' };
  if (temOcorr && !s.includes('entregue')) return { cor: '#E11D48', label: 'Ocorrência' };
  if (s.includes('saiu'))   return { cor: '#7C3AED', label: 'Em rota' };
  if (s.includes('pronto')) return { cor: '#F59E0B', label: 'Pronto' };
  return { cor: '#2563EB', label: 'Em preparação' };
}

function _ensureMapaCss() {
  if (document.getElementById('me-balao-style')) return;
  const st = document.createElement('style');
  st.id = 'me-balao-style';
  st.textContent = `
    .me-pin{background:none;border:none;}
    .me-balao{position:relative;transform:translate(-50%,-100%);cursor:pointer;transition:transform .12s ease;}
    .me-balao:hover{transform:translate(-50%,-100%) scale(1.1);}
    .me-card{background:#fff;border-left:4px solid var(--cor);border-radius:9px;
      box-shadow:0 3px 10px rgba(0,0,0,.30);padding:3px 8px;display:flex;flex-direction:column;
      line-height:1.12;font-family:system-ui,Arial,sans-serif;}
    .me-code{font-weight:800;font-size:12.5px;color:#0F172A;}
    .me-sub{font-size:9.5px;font-weight:700;color:var(--cor);}
    .me-tip{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);width:0;height:0;
      border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid #fff;
      filter:drop-shadow(0 2px 1px rgba(0,0,0,.18));}
  `;
  document.head.appendChild(st);
}

function _balaoIcon(o) {
  const { cor, label } = statusEntregaInfo(o);
  const num = (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '');
  const turno = o.scheduledTime || o.scheduledPeriod || '';
  const sub = [label, turno].filter(Boolean).join(' · ');
  const html = `<div class="me-balao" style="--cor:${cor};">
      <div class="me-card"><span class="me-code">#${_esc(num)}</span><span class="me-sub">${_esc(sub)}</span></div>
      <span class="me-tip"></span>
    </div>`;
  return window.L.divIcon({ className: 'me-pin', html, iconSize: [0, 0], iconAnchor: [0, 0] });
}

// ── NÚCLEO: plota os pedidos num elemento de mapa ────────────
// Retorna { map, markers: Map<orderId, marker> }.
async function _plotInto(mapEl, setStatus, orders, opts = {}) {
  _ensureMapaCss();
  await _ensureLeaflet();
  const L = window.L;
  const map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView(MANAUS, 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 200);

  const lista = (orders || []).filter(o => o && o.type === 'Delivery');
  const cache = _getGeoCache();
  const pontos = [];
  const markers = new Map();
  const naoLocalizados = [];

  let pendentes = 0;
  for (const o of lista) {
    const k = _normKey(_enderecoDoPedido(o));
    if (k && !(k in cache)) pendentes++;
  }
  let feitos = 0;

  for (const o of lista) {
    const addr = _enderecoDoPedido(o);
    if (!addr) { naoLocalizados.push(o); continue; }
    const k = _normKey(addr);
    const novo = k && !(k in cache);
    if (setStatus) setStatus(`Localizando… ${feitos}/${lista.length}`);
    const coord = await _geocode(addr, cache);
    feitos++;
    if (!coord) { naoLocalizados.push(o); }
    else {
      const num = (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '');
      const recv = o.recipient || o.destinatario || o.recipientName || '';
      const turno = o.scheduledTime || o.scheduledPeriod || '';
      const driver = o.driverName || o.assignedDriverName || '';
      const navUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
      const popup = `
        <div style="font-size:13px;line-height:1.5;min-width:180px;">
          <div style="font-weight:800;color:#9F1239;">#${_esc(num)} ${_esc(recv)}</div>
          <div style="color:#374151;">📍 ${_esc(addr.replace(/, AM, Brasil$/,''))}</div>
          ${turno ? `<div style="color:#6B7280;">🕐 ${_esc(turno)}</div>` : ''}
          ${driver ? `<div style="color:#2563EB;font-weight:600;">🛵 ${_esc(driver)}</div>` : `<div style="color:#B45309;font-weight:600;">⏳ Sem entregador</div>`}
          <a href="${navUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2563EB;font-weight:700;text-decoration:none;">➡️ Navegar (Google Maps)</a>
        </div>`;
      const mk = L.marker([coord.lat, coord.lng], { icon: _balaoIcon(o), riseOnHover: true })
        .addTo(map).bindPopup(popup);
      markers.set(String(o._id || o.id || num), mk);
      pontos.push([coord.lat, coord.lng]);
    }
    if (novo && pendentes > 1) await _delay(1100);
  }

  if (pontos.length) map.fitBounds(pontos, { padding: [50, 50], maxZoom: 15 });
  const okN = pontos.length, failN = naoLocalizados.length;
  if (setStatus) setStatus(`${okN} no mapa${failN ? ` · ${failN} sem localização` : ''}`);
  if (failN && opts.warnFail !== false) {
    const nums = naoLocalizados.map(o => '#' + (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '')).join(', ');
    toast(`⚠️ ${failN} endereço(s) não localizado(s): ${nums}`, true);
  }
  return { map, markers };
}

// ── OVERLAY (botão "Mapa das entregas" da Expedição) ─────────
export async function abrirMapaEntregas(orders, opts = {}) {
  const lista = (orders || []).filter(o => o && o.type === 'Delivery');
  if (!lista.length) return toast('❌ Nenhuma entrega (delivery) para mostrar no mapa', true);

  const old = document.getElementById('mapa-entregas-overlay');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'mapa-entregas-overlay';
  ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483600;background:#fff;display:flex;flex-direction:column;');
  ov.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#1F5C2E;color:#fff;flex-shrink:0;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:16px;">🗺️ Mapa das Entregas ${opts.dataLabel ? '· ' + _esc(opts.dataLabel) : ''}</div>
      <div style="display:flex;gap:14px;align-items:center;font-size:12px;margin-left:8px;flex-wrap:wrap;">
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:50%;background:#F59E0B;display:inline-block;border:2px solid #fff;"></span> Pronto</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:50%;background:#7C3AED;display:inline-block;border:2px solid #fff;"></span> Em rota</span>
      </div>
      <div id="mapa-entregas-status" style="font-size:12px;opacity:.9;margin-left:auto;"></div>
      <button id="mapa-entregas-close" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:13px;">✕ Fechar</button>
    </div>
    <div id="mapa-entregas-map" style="flex:1;width:100%;background:#E5E7EB;"></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#mapa-entregas-close').onclick = () => ov.remove();
  const statusEl = ov.querySelector('#mapa-entregas-status');
  try {
    await _plotInto(ov.querySelector('#mapa-entregas-map'), t => { if (statusEl) statusEl.textContent = t; }, lista, opts);
  } catch (e) {
    toast('❌ ' + (e.message || 'Falha ao carregar o mapa'), true);
  }
}

// ── INLINE (página de Acompanhamento) ────────────────────────
// Renderiza o mapa dentro de mapEl. Retorna { map, markers } ou null.
export async function montarMapaEntregas(mapEl, orders, opts = {}) {
  if (!mapEl) return null;
  try {
    return await _plotInto(mapEl, opts.setStatus || null, orders, opts);
  } catch (e) {
    toast('❌ ' + (e.message || 'Falha ao carregar o mapa'), true);
    return null;
  }
}
