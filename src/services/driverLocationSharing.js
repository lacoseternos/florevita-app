// ── COMPARTILHAMENTO DE LOCALIZAÇÃO (ENTREGADOR) ─────────────
// Marcia (19/jun/2026): o entregador liga o compartilhamento no app e a
// posicao dele aparece no Painel de Acompanhamento ( icone de moto).
// Usa navigator.geolocation.watchPosition (precisa HTTPS + permissao).
// Envia pro backend no maximo a cada ~15s (throttle) pra economizar
// bateria/dados e nao sobrecarregar o servidor.

import { POST } from './api.js';

const PREF_KEY = 'fv_driver_loc_sharing';
const MIN_SEND_MS = 15000; // 15s entre envios

let _watchId = null;
let _lastSend = 0;
let _onChange = null; // callback de UI quando liga/desliga

export function isSharing() { return _watchId !== null; }

export function onSharingChange(cb) { _onChange = cb; }

function _emit() { try { _onChange && _onChange(isSharing()); } catch (_) {} }

async function _send(lat, lng, acc) {
  try { await POST('/drivers/location', { lat, lng, acc }); }
  catch (e) { console.warn('[driverLoc] envio falhou:', e.message); }
}

export function startSharing() {
  if (_watchId !== null) return true;
  if (!('geolocation' in navigator)) {
    alert('Seu aparelho não suporta localização.');
    return false;
  }
  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const now = Date.now();
      if (now - _lastSend < MIN_SEND_MS) return; // throttle
      _lastSend = now;
      _send(latitude, longitude, accuracy);
    },
    (err) => {
      console.warn('[driverLoc] erro geolocation:', err && err.message);
      if (err && err.code === 1) { // PERMISSION_DENIED
        stopSharing();
        alert('Permissão de localização negada. Ative a localização do navegador para compartilhar.');
      }
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
  );
  try { localStorage.setItem(PREF_KEY, '1'); } catch (_) {}
  _emit();
  return true;
}

export function stopSharing() {
  if (_watchId !== null) {
    try { navigator.geolocation.clearWatch(_watchId); } catch (_) {}
    _watchId = null;
  }
  try { localStorage.setItem(PREF_KEY, '0'); } catch (_) {}
  _emit();
}

export function toggleSharing() {
  if (isSharing()) { stopSharing(); return false; }
  return startSharing();
}

// Religa automaticamente se o entregador tinha deixado ligado.
export function resumeIfEnabled() {
  try {
    if (localStorage.getItem(PREF_KEY) === '1' && _watchId === null) startSharing();
  } catch (_) {}
}
