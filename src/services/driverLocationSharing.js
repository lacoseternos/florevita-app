// ── COMPARTILHAMENTO DE LOCALIZAÇÃO (ENTREGADOR) ─────────────
// Marcia (19/jun/2026): a localizacao do entregador aparece no Painel de
// Delivery. Regra combinada com a equipe:
//   • Liga automaticamente quando ele SAI COM A PRIMEIRA ROTA do dia.
//   • Fica ativa só até às 18h — OU, se ainda tiver rota após as 18h,
//     até finalizar a rota.
//   • Fora dessa janela NADA é enviado. Os dados ficam seguros.
// Essa politica e mostrada ao entregador no consentimento (1x).
//
// Implementacao: a pagina do entregador chama applyAutoPolicy(temRotaAtiva)
// a cada render. "temRotaAtiva" = ele tem pedido com status "Saiu p/
// entrega". O envio so acontece dentro da janela permitida.

import { POST } from './api.js';

const CONSENT_KEY = 'fv_driver_loc_consent';
const MIN_SEND_MS = 15000; // 15s entre envios

let _watchId = null;
let _lastSend = 0;
let _allowed = false;   // janela atual permite compartilhar?
let _onChange = null;

export function isSharing() { return _watchId !== null && _allowed; }
export function onSharingChange(cb) { _onChange = cb; }
function _emit() { try { _onChange && _onChange(isSharing()); } catch (_) {} }
function _consented() { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } }

function _horaManaus() {
  try {
    return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Manaus', hour: '2-digit', hour12: false }));
  } catch { return new Date().getHours(); }
}

// Janela permitida: tem rota ativa? então compartilha (cobre "após as 18h
// até finalizar a rota"). Sem rota: só antes das 18h NÃO compartilha
// (sem rota não faz sentido). Resultado prático: compartilha enquanto há
// rota ativa; para quando a rota acaba ou passa das 18h sem rota.
function _janelaPermite(temRotaAtiva) {
  if (temRotaAtiva) return true;          // tem rota → segue (até finalizar)
  return false;                            // sem rota → não compartilha
}

async function _send(lat, lng, acc) {
  try { await POST('/drivers/location', { lat, lng, acc }); }
  catch (e) { console.warn('[driverLoc] envio falhou:', e.message); }
}

function _startWatch() {
  if (_watchId !== null || !('geolocation' in navigator)) return;
  _watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (!_allowed) return; // fora da janela: nao envia
      const now = Date.now();
      if (now - _lastSend < MIN_SEND_MS) return;
      _lastSend = now;
      _send(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    },
    (err) => {
      if (err && err.code === 1) { // permissao negada
        try { localStorage.setItem(CONSENT_KEY, '0'); } catch (_) {}
        stopSharing();
      }
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 },
  );
}

export function stopSharing() {
  if (_watchId !== null) { try { navigator.geolocation.clearWatch(_watchId); } catch (_) {} _watchId = null; }
  _allowed = false;
  _emit();
}

// Modal com a politica — mostrado 1x quando vai ativar.
function _modalConsentimento() {
  return new Promise(resolve => {
    const old = document.getElementById('drv-loc-consent');
    if (old) old.remove();
    const ov = document.createElement('div');
    ov.id = 'drv-loc-consent';
    ov.setAttribute('style', 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px;');
    ov.innerHTML = `
      <div style="background:#fff;border-radius:18px;max-width:400px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.45);">
        <div style="font-size:36px;text-align:center;line-height:1;">📍</div>
        <h3 style="font-family:'Playfair Display',serif;font-size:19px;text-align:center;margin:8px 0 12px;color:#1E293B;">Compartilhar localização</h3>
        <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 8px;">
          Todo dia, ao sair com a primeira rota, sua localização será ativada e ficará ativa
          <b>somente até às 18h</b> — ou, caso você esteja com rota após esse horário,
          <b>até finalizar a rota</b>.
        </p>
        <p style="font-size:13px;color:#475569;line-height:1.6;margin:0;">
          Sua localização <b>não será compartilhada fora desse horário</b>. Seus dados estão seguros. 🔒
        </p>
        <div style="display:flex;gap:8px;margin-top:18px;">
          <button id="drv-no" style="flex:1;background:#fff;border:1px solid #E5E7EB;color:#64748B;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;">Agora não</button>
          <button id="drv-ok" style="flex:1.5;background:linear-gradient(135deg,#16A34A,#15803D);color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">Entendi, ativar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#drv-no').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#drv-ok').onclick = () => { ov.remove(); resolve(true); };
  });
}

let _pedindoConsent = false;

// Chamado pela pagina do entregador a cada render.
export async function applyAutoPolicy(temRotaAtiva) {
  const permitido = _janelaPermite(!!temRotaAtiva);
  if (!permitido) { if (_watchId !== null) stopSharing(); _allowed = false; _emit(); return; }
  // Permitido: precisa de consentimento (mostra 1x).
  if (!_consented()) {
    if (_pedindoConsent) return;
    _pedindoConsent = true;
    const ok = await _modalConsentimento();
    _pedindoConsent = false;
    if (!ok) { _allowed = false; _emit(); return; }
    try { localStorage.setItem(CONSENT_KEY, '1'); } catch (_) {}
  }
  _allowed = true;
  _startWatch();
  _emit();
}

// Mostra a politica (info) — usado pelo botao do app.
export async function mostrarPolitica() {
  const ok = await _modalConsentimento();
  if (ok) { try { localStorage.setItem(CONSENT_KEY, '1'); } catch (_) {} }
  return ok;
}
