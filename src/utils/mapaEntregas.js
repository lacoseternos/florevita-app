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
    .me-pin2{position:relative;transform:translate(-50%,-100%);cursor:pointer;font-family:system-ui,Arial,sans-serif;}
    .me-pin2:hover{z-index:1200;}
    .me-glow{position:absolute;left:50%;bottom:2px;transform:translateX(-50%);width:30px;height:14px;
      background:var(--cor);opacity:.35;filter:blur(7px);border-radius:50%;}
    .me-lbl{position:absolute;left:50%;bottom:54px;transform:translateX(-50%);background:#fff;border-radius:11px;
      box-shadow:0 4px 12px rgba(0,0,0,.22);padding:3px 9px;white-space:nowrap;text-align:center;line-height:1.15;}
    .me-lbl b{display:block;font-size:12px;font-weight:800;color:#0F172A;}
    .me-lbl span{font-size:10px;font-weight:800;}
    .me-drop{position:relative;width:42px;height:52px;}
    .me-bag{position:absolute;top:8px;left:50%;transform:translateX(-50%);font-size:17px;line-height:1;}
    .me-drv{background:none;border:none;}
    .me-drvbox{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;
      font-size:18px;border:3px solid #fff;box-shadow:0 3px 9px rgba(0,0,0,.38);}
  `;
  document.head.appendChild(st);
}

function _balaoIcon(o) {
  const { cor, label } = statusEntregaInfo(o);
  const num = (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '');
  const driver = o.driverName || o.assignedDriverName || '';
  const sub = driver || label;
  const html = `<div class="me-pin2" style="--cor:${cor};">
      <div class="me-lbl"><b>#${_esc(num)}</b><span style="color:${cor};">${_esc(sub)}</span></div>
      <div class="me-glow"></div>
      <div class="me-drop">
        <svg width="42" height="52" viewBox="0 0 42 52"><path d="M21 1.5C11 1.5 2.5 9.3 2.5 20 2.5 34 21 50.5 21 50.5S39.5 34 39.5 20C39.5 9.3 31 1.5 21 1.5Z" fill="${cor}" stroke="#fff" stroke-width="2.5"/></svg>
        <span class="me-bag">🛍️</span>
      </div>
    </div>`;
  return window.L.divIcon({ className: 'me-pin', html, iconSize: [0, 0], iconAnchor: [0, 0] });
}

// Cor por entregador (consistente pelo id) — igual ao estilo do mockup.
const _DRV_PALETTE = ['#F59E0B', '#7C3AED', '#2563EB', '#16A34A', '#DB2777', '#0891B2', '#EA580C'];
function _drvColor(id) {
  let h = 0; const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return _DRV_PALETTE[h % _DRV_PALETTE.length];
}

// ── NÚCLEO: plota os pedidos num elemento de mapa ────────────
// Retorna { map, markers: Map<orderId, marker> }.
async function _plotInto(mapEl, setStatus, orders, opts = {}) {
  _ensureMapaCss();
  await _ensureLeaflet();
  const L = window.L;
  const map = L.map(mapEl, { zoomControl: true, attributionControl: true }).setView(MANAUS, 12);
  // Base clara com bairros/parques/água em destaque (CARTO Voyager) —
  // estilo do mockup, nomes dos bairros legíveis.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO',
  }).addTo(map);
  // Camada só de rótulos por cima — reforça os nomes dos bairros.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, subdomains: 'abcd', attribution: '',
  }).addTo(map);
  setTimeout(() => map.invalidateSize(), 200);

  const lista = (orders || []).filter(o => o && o.type === 'Delivery');
  const cache = _getGeoCache();
  const pontos = [];
  const markers = new Map();
  const naoLocalizados = [];

  // So conta como pendente quem nao tem coordenada manual nem cache.
  const _temGeo = (o) => o.geoLat != null && o.geoLng != null && o.geoLat !== '' && o.geoLng !== ''
    && Number.isFinite(Number(o.geoLat)) && Number.isFinite(Number(o.geoLng));

  let pendentes = 0;
  for (const o of lista) {
    if (_temGeo(o)) continue;
    const k = _normKey(_enderecoDoPedido(o));
    if (k && !(k in cache)) pendentes++;
  }
  let feitos = 0;

  for (const o of lista) {
    const addr = _enderecoDoPedido(o) || '';
    // 1) Coordenada manual salva no pedido tem prioridade (ponto no mapa).
    let coord = null;
    if (_temGeo(o)) {
      coord = { lat: Number(o.geoLat), lng: Number(o.geoLng) };
    } else if (addr) {
      const k = _normKey(addr);
      const novo = k && !(k in cache);
      if (setStatus) setStatus(`Localizando… ${feitos}/${lista.length}`);
      coord = await _geocode(addr, cache);
      feitos++;
      if (novo && pendentes > 1) await _delay(1100);
    }
    if (!coord) { naoLocalizados.push(o); continue; }
    const num = (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '');
    const recv = o.recipient || o.destinatario || o.recipientName || '';
    const turno = o.scheduledTime || o.scheduledPeriod || '';
    const driver = o.driverName || o.assignedDriverName || '';
    const navUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr || `${coord.lat},${coord.lng}`);
    const popup = `
        <div style="font-size:13px;line-height:1.5;min-width:180px;">
          <div style="font-weight:800;color:#9F1239;">#${_esc(num)} ${_esc(recv)}</div>
          ${addr ? `<div style="color:#374151;">📍 ${_esc(addr.replace(/, AM, Brasil$/,''))}</div>` : ''}
          ${turno ? `<div style="color:#6B7280;">🕐 ${_esc(turno)}</div>` : ''}
          ${driver ? `<div style="color:#2563EB;font-weight:600;">🛵 ${_esc(driver)}</div>` : `<div style="color:#B45309;font-weight:600;">⏳ Sem entregador</div>`}
          <a href="${navUrl}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;color:#2563EB;font-weight:700;text-decoration:none;">➡️ Navegar (Google Maps)</a>
        </div>`;
    const mk = L.marker([coord.lat, coord.lng], { icon: _balaoIcon(o), riseOnHover: true })
      .addTo(map).bindPopup(popup);
    markers.set(String(o._id || o.id || num), mk);
    pontos.push([coord.lat, coord.lng]);
  }

  if (pontos.length) map.fitBounds(pontos, { padding: [50, 50], maxZoom: 15 });
  const okN = pontos.length, failN = naoLocalizados.length;
  if (setStatus) setStatus(`${okN} no mapa${failN ? ` · ${failN} sem localização` : ''}`);
  if (failN && opts.warnFail) {
    const nums = naoLocalizados.map(o => '#' + (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '')).join(', ');
    toast(`⚠️ ${failN} endereço(s) não localizado(s): ${nums}`, true);
  }
  return { map, markers, failed: naoLocalizados.map(o => String(o._id || o.id || '')) };
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

// ── RASTREAMENTO DOS ENTREGADORES (tempo real) ───────────────
// Faz polling em /drivers/location e desenha/atualiza um ícone de moto
// pra cada entregador que está compartilhando a localização. Para sozinho
// quando o mapa sai da tela (mapEl desconectado do DOM).
let _drvIv = null;
const _drvMarkers = new Map();

export function pararRastreamentoEntregadores() {
  if (_drvIv) { clearInterval(_drvIv); _drvIv = null; }
}

export function rastrearEntregadores(map, mapEl, filtroNome) {
  pararRastreamentoEntregadores();
  for (const [, mk] of _drvMarkers) { try { map.removeLayer(mk); } catch (_) {} }
  _drvMarkers.clear();
  if (!map || !window.L) return;
  const L = window.L;
  const fNorm = filtroNome ? _normKey(filtroNome) : '';
  const mkIcon = (cor) => L.divIcon({
    className: 'me-drv',
    html: `<div class="me-drvbox" style="background:${cor};color:#fff;">🛵</div>`,
    iconSize: [36, 36], iconAnchor: [18, 18],
  });
  const tick = async () => {
    if (mapEl && !mapEl.isConnected) { pararRastreamentoEntregadores(); return; }
    try {
      const { GET } = await import('../services/api.js');
      const r = await GET('/drivers/location');
      let locs = (r && Array.isArray(r.locations)) ? r.locations : [];
      if (fNorm) locs = locs.filter(l => _normKey(l.name).includes(fNorm) || fNorm.includes(_normKey(l.name)));
      const vistos = new Set();
      locs.forEach(l => {
        if (!Number.isFinite(Number(l.lat))) return;
        const id = String(l.id);
        vistos.add(id);
        const cor = _drvColor(id);
        const hora = (() => { try { return new Date(l.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })();
        const popup = `<div style="font-size:12px;"><b>🛵 ${_esc(l.name)}</b><br/><span style="color:#6B7280;">Atualizado ${hora}</span></div>`;
        let mk = _drvMarkers.get(id);
        if (mk) { mk.setLatLng([l.lat, l.lng]); mk.setPopupContent(popup); }
        else {
          mk = L.marker([l.lat, l.lng], { icon: mkIcon(cor), zIndexOffset: 1000 }).addTo(map).bindPopup(popup);
          _drvMarkers.set(id, mk);
        }
      });
      for (const [id, mk] of _drvMarkers) {
        if (!vistos.has(id)) { try { map.removeLayer(mk); } catch (_) {} _drvMarkers.delete(id); }
      }
    } catch (_) {}
  };
  tick();
  _drvIv = setInterval(tick, 10000);
}
