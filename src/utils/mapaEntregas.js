// ── MAPA DE ENTREGAS (Expedição) ─────────────────────────────
// Marcia (19/jun/2026): mostra as entregas do dia num mapa pra facilitar
// montar rotas e visualizar onde fica cada uma.
//
// Usa Leaflet + OpenStreetMap (GRÁTIS, sem chave de API). Os endereços
// dos pedidos sao texto (sem lat/lng), entao geocodificamos via Nominatim
// (OSM) com CACHE em localStorage — cada endereço so e buscado 1x.
//
// Marcadores por status: Pronto = âmbar, Em Rota = azul. Popup com o
// pedido, destinatário, endereço, turno, entregador e link de navegação.

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

// Monta o endereço textual do pedido pra geocodificar.
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

// Geocodifica via Nominatim, com cache. Retorna {lat,lng} ou null.
async function _geocode(addr, cache) {
  const key = _normKey(addr);
  if (!key) return null;
  if (key in cache) return cache[key]; // pode ser null (falha lembrada)
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(addr);
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await r.json();
    if (Array.isArray(data) && data[0] && data[0].lat) {
      cache[key] = { lat: +data[0].lat, lng: +data[0].lon };
    } else {
      cache[key] = null;
    }
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

// ── ABRE O MAPA ──────────────────────────────────────────────
// orders: lista de pedidos de entrega (Delivery) do dia.
export async function abrirMapaEntregas(orders, opts = {}) {
  const lista = (orders || []).filter(o => o && o.type === 'Delivery');
  if (!lista.length) return toast('❌ Nenhuma entrega (delivery) para mostrar no mapa', true);

  // Overlay
  const old = document.getElementById('mapa-entregas-overlay');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'mapa-entregas-overlay';
  ov.setAttribute('style',
    'position:fixed;inset:0;z-index:2147483600;background:#fff;display:flex;flex-direction:column;');
  ov.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#1F5C2E;color:#fff;flex-shrink:0;flex-wrap:wrap;">
      <div style="font-weight:800;font-size:16px;">🗺️ Mapa das Entregas ${opts.dataLabel ? '· ' + _esc(opts.dataLabel) : ''}</div>
      <div style="display:flex;gap:14px;align-items:center;font-size:12px;margin-left:8px;">
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:50%;background:#F59E0B;display:inline-block;border:2px solid #fff;"></span> Pronto</span>
        <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:50%;background:#2563EB;display:inline-block;border:2px solid #fff;"></span> Em rota</span>
      </div>
      <div id="mapa-entregas-status" style="font-size:12px;opacity:.9;margin-left:auto;"></div>
      <button id="mapa-entregas-close" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;font-size:13px;">✕ Fechar</button>
    </div>
    <div id="mapa-entregas-map" style="flex:1;width:100%;background:#E5E7EB;"></div>`;
  document.body.appendChild(ov);
  ov.querySelector('#mapa-entregas-close').onclick = () => ov.remove();

  const statusEl = ov.querySelector('#mapa-entregas-status');
  const setStatus = t => { if (statusEl) statusEl.textContent = t; };

  try {
    setStatus('Carregando mapa…');
    await _ensureLeaflet();
  } catch (e) {
    setStatus('');
    return toast('❌ ' + (e.message || 'Falha ao carregar o mapa'), true);
  }

  const L = window.L;
  const map = L.map('mapa-entregas-map').setView(MANAUS, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  // Garante render correto (o container acabou de aparecer)
  setTimeout(() => map.invalidateSize(), 200);

  const cache = _getGeoCache();
  const corStatus = o => (String(o.status || '').toLowerCase().includes('saiu') ? '#2563EB' : '#F59E0B');
  const pontos = [];
  const naoLocalizados = [];

  // Conta quantos precisam de busca na rede (pra estimativa de tempo)
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
    setStatus(`Localizando endereços… ${feitos}/${lista.length}`);
    const coord = await _geocode(addr, cache);
    feitos++;
    if (!coord) { naoLocalizados.push(o); }
    else {
      const cor = corStatus(o);
      const num = (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '');
      const recv = o.recipient || o.destinatario || o.recipientName || '';
      const turno = o.scheduledPeriod || '';
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
      const m = L.circleMarker([coord.lat, coord.lng], {
        radius: 9, fillColor: cor, color: '#fff', weight: 2, opacity: 1, fillOpacity: 0.9,
      }).addTo(map).bindPopup(popup);
      pontos.push([coord.lat, coord.lng]);
    }
    // Respeita o limite do Nominatim (~1 req/s) so quando foi busca nova.
    if (novo && pendentes > 1) await _delay(1100);
  }

  if (pontos.length) {
    map.fitBounds(pontos, { padding: [40, 40], maxZoom: 15 });
  }

  const okN = pontos.length;
  const failN = naoLocalizados.length;
  setStatus(`${okN} no mapa${failN ? ` · ${failN} sem localização` : ''}`);

  if (failN) {
    const nums = naoLocalizados.map(o => '#' + (o.orderNumber || o.numero || '').toString().replace(/^PED-?/i, '')).join(', ');
    toast(`⚠️ ${failN} endereço(s) não localizado(s) no mapa: ${nums}`, true);
  }
}
