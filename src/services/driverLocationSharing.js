// ── COMPARTILHAMENTO DE LOCALIZAÇÃO (ENTREGADOR) ─────────────
// Marcia (20/jun/2026): a localizacao do entregador aparece no Painel de
// Delivery (icone de moto). Regras:
//   • AUTOMÁTICO: liga sozinho quando ele tem rota ativa ("Saiu p/ entrega").
//   • MANUAL: o botao do app liga/desliga na hora — e isso vale pelo dia
//     (no dia seguinte volta pro automatico). Ligar manual compartilha
//     mesmo sem rota (o entregador escolheu).
// Usa navigator.geolocation.watchPosition (precisa HTTPS + permissao).

import { POST } from './api.js';

const CONSENT_KEY = 'fv_driver_loc_consent';
const MANUAL_KEY  = 'fv_driver_loc_manual'; // { day, state:'on'|'off' }
const MIN_SEND_MS = 15000; // 15s entre envios do watch

let _watchId = null;
let _lastSend = 0;
let _allowed = false;     // pode enviar agora?
let _lastTemRota = false; // ultima rota ativa conhecida (pra modo auto)
let _onChange = null;
let _pedindoConsent = false;

export function onSharingChange(cb) { _onChange = cb; }
function _emit() { try { _onChange && _onChange(estaLigada()); } catch (_) {} }
function _consented() { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } }
function _setConsent() { try { localStorage.setItem(CONSENT_KEY, '1'); } catch (_) {} }

function _hojeStr() { try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' }); } catch { return new Date().toISOString().slice(0, 10); } }
function _getState() { try { const r = localStorage.getItem(MANUAL_KEY); if (!r) return null; const o = JSON.parse(r); return o.day === _hojeStr() ? o.state : null; } catch { return null; } }
function _setState(state) { try { localStorage.setItem(MANUAL_KEY, JSON.stringify({ day: _hojeStr(), state })); } catch (_) {} }

// Estado efetivo: manual ('on'/'off') manda; senao segue a rota (auto).
function _effective() { const st = _getState(); if (st === 'on') return true; if (st === 'off') return false; return _lastTemRota; }
export function estaLigada() { return _effective(); }

async function _send(lat, lng, acc) {
  try { await POST('/drivers/location', { lat, lng, acc }); return { ok: true }; }
  catch (e) { console.warn('[driverLoc] envio falhou:', e.message); return { ok: false, error: e.message }; }
}

// ── 2º plano: Wake Lock (segura a aba viva) + reenvio ao voltar ──
// Limitacao do navegador: localizacao 100% em background so com app nativo.
// No web, mantemos a aba ativa com Wake Lock (tela ligada) e reenviamos
// assim que o entregador volta pro app — cobrindo o uso real (ele fica
// navegando no Maps e volta). watchPosition continua rodando em background
// enquanto a aba nao for descartada.
let _wakeLock = null;
let _bgInit = false;

async function _acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && _allowed && document.visibilityState === 'visible') {
      _wakeLock = await navigator.wakeLock.request('screen');
      _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    }
  } catch (_) {}
}
function _releaseWakeLock() { try { _wakeLock && _wakeLock.release(); } catch (_) {} _wakeLock = null; }

function _enviarAgora() {
  if (!_allowed || !('geolocation' in navigator)) return;
  try {
    navigator.geolocation.getCurrentPosition(
      (p) => { if (_allowed) { _lastSend = Date.now(); _send(p.coords.latitude, p.coords.longitude, p.coords.accuracy); } },
      () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  } catch (_) {}
}

function _initBg() {
  if (_bgInit) return;
  _bgInit = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _allowed) {
      _acquireWakeLock();   // wake lock cai quando esconde; readquire ao voltar
      _enviarAgora();       // manda a posicao atual assim que volta pro app
    }
  });
}

function _startWatch() {
  if (_watchId !== null || !('geolocation' in navigator)) return;
  _initBg();
  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!_allowed) return;
      const now = Date.now();
      if (now - _lastSend < MIN_SEND_MS) return;
      _lastSend = now;
      _send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => { if (err && err.code === 1) { try { localStorage.setItem(CONSENT_KEY, '0'); } catch (_) {} stopSharing(); } },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
  );
  // Envio imediato (aparece no painel em segundos).
  try {
    navigator.geolocation.getCurrentPosition(
      (p) => { if (_allowed) { _lastSend = Date.now(); _send(p.coords.latitude, p.coords.longitude, p.coords.accuracy); } },
      () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  } catch (_) {}
  _acquireWakeLock(); // mantem a aba viva enquanto compartilha
}

export function stopSharing() {
  if (_watchId !== null) { try { navigator.geolocation.clearWatch(_watchId); } catch (_) {} _watchId = null; }
  _allowed = false;
  _releaseWakeLock();
  _emit();
}

// Modal com a politica — mostrado 1x ao ativar.
function _modalConsentimento() {
  return new Promise(resolve => {
    const old = document.getElementById('drv-loc-consent');
    if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'drv-loc-consent';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px;');
    ov.innerHTML = `
      <div style="background:#fff;border-radius:18px;max-width:380px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.45);">
        <div style="font-size:36px;text-align:center;line-height:1;">📍</div>
        <h3 style="font-family:'Playfair Display',serif;font-size:19px;text-align:center;margin:8px 0 10px;color:#1E293B;">Ativar localização</h3>
        <p style="font-size:13.5px;color:#475569;line-height:1.6;margin:0;text-align:center;">
          A loja acompanha sua rota no mapa. Liga ao sair com a rota e desliga às <b>18h</b> (ou quando você terminar a rota). Fora disso, nada é compartilhado. 🔒
        </p>
        <div style="display:flex;gap:8px;margin-top:18px;">
          <button id="drv-no" style="flex:1;background:#fff;border:1px solid #E5E7EB;color:#64748B;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Agora não</button>
          <button id="drv-ok" style="flex:1.5;background:linear-gradient(135deg,#16A34A,#15803D);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Ativar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#drv-no').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#drv-ok').onclick = () => { ov.remove(); resolve(true); };
  });
}

// Chamado pela pagina do entregador a cada render.
export async function applyAutoPolicy(temRotaAtiva) {
  _lastTemRota = !!temRotaAtiva;
  const enabled = _effective();
  if (!enabled) { if (_watchId !== null) stopSharing(); _allowed = false; _emit(); return; }
  if (!_consented()) {
    if (_pedindoConsent) return;
    _pedindoConsent = true;
    const ok = await _modalConsentimento();
    _pedindoConsent = false;
    if (!ok) { _setState('off'); _allowed = false; _emit(); return; }
    _setConsent();
  }
  _allowed = true;
  _startWatch();
  _emit();
}

// Faz UM envio de teste imediato (GPS + POST) e retorna {ok,error}.
function _envioTeste() {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve({ ok: false, error: 'GPS indisponível neste aparelho' });
    navigator.geolocation.getCurrentPosition(
      async (p) => { _lastSend = Date.now(); resolve(await _send(p.coords.latitude, p.coords.longitude, p.coords.accuracy)); },
      (err) => resolve({ ok: false, error: (err && err.code === 1) ? 'Permissão de localização negada' : 'Não consegui o GPS' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

// Botao do app: liga/desliga. Vale pelo dia. Retorna o resultado pra UI.
export async function toggleManual(temRotaAtiva) {
  _lastTemRota = !!temRotaAtiva;
  if (_effective()) {
    _setState('off');
    stopSharing();
    return { ligada: false };
  }
  if (!_consented()) {
    const ok = await _modalConsentimento();
    if (!ok) return { ligada: false, cancelado: true };
    _setConsent();
  }
  _setState('on');
  _allowed = true;
  _startWatch();
  _emit();
  const r = await _envioTeste();        // feedback imediato pro entregador
  return { ligada: true, ok: r.ok, error: r.error };
}
