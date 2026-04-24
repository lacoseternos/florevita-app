// ── RELOGIO DO SERVIDOR (fuso Manaus) ────────────────────────
// Motivo: alguns computadores/tablets dos colaboradores tem o RELOGIO
// DO SISTEMA errado (fuso ou hora incorreta). Isso fazia o Ponto
// Eletronico registrar "06:10" quando a colaboradora batia as "07:10".
//
// Solucao: nunca confiar em Date.now() do dispositivo. Sincronizamos
// um OFFSET com o servidor (fonte canonica) e usamos ele para toda
// exibicao de hora critica (ponto, logs, comanda).
//
// Manaus = UTC-4 FIXO (sem horario de verao) — calculo feito em
// matematica pura, independente de ICU/tz database do navegador.

import { API } from '../state.js';

const MANAUS_OFFSET_MS = 4 * 3600 * 1000;

// Offset = serverMs - deviceMs (aplicado em toda chamada de now())
let _offsetMs = 0;
let _synced = false;
let _lastSyncAt = 0;

// Sincroniza com o servidor. Seguro chamar varias vezes.
export async function syncServerClock() {
  try {
    const t0 = Date.now();
    const r = await fetch(API + '/time', { cache: 'no-store' });
    const t1 = Date.now();
    const data = await r.json();
    if (!data?.serverMs) return false;
    // Compensa metade do RTT (latencia de rede)
    const rtt = t1 - t0;
    const estimatedServerNow = data.serverMs + Math.floor(rtt / 2);
    _offsetMs = estimatedServerNow - t1;
    _synced = true;
    _lastSyncAt = t1;
    return true;
  } catch (e) {
    console.warn('[serverClock] sync falhou, usando relogio local:', e.message);
    return false;
  }
}

// Hora "agora" em ms UTC, corrigida pelo offset do servidor.
export function serverNowMs() {
  return Date.now() + _offsetMs;
}

// Date corrigido (use em vez de new Date() para operacoes criticas).
export function serverNow() {
  return new Date(serverNowMs());
}

// Hora Manaus HH:MM (sempre correto, mesmo se o fuso do device estiver errado)
export function manausTimeHM(d) {
  const ms = d ? d.getTime() : serverNowMs();
  const m = new Date(ms - MANAUS_OFFSET_MS);
  const hh = String(m.getUTCHours()).padStart(2, '0');
  const mm = String(m.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Hora Manaus HH:MM:SS
export function manausTimeHMS(d) {
  const ms = d ? d.getTime() : serverNowMs();
  const m = new Date(ms - MANAUS_OFFSET_MS);
  const hh = String(m.getUTCHours()).padStart(2, '0');
  const mm = String(m.getUTCMinutes()).padStart(2, '0');
  const ss = String(m.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Data Manaus YYYY-MM-DD
export function manausDateStr(d) {
  const ms = d ? d.getTime() : serverNowMs();
  const m = new Date(ms - MANAUS_OFFSET_MS);
  const y  = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(m.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${dd}`;
}

// Partes de data (y, m, d, dayOfWeek) em Manaus
export function manausDateParts(d) {
  const ms = d ? d.getTime() : serverNowMs();
  const m = new Date(ms - MANAUS_OFFSET_MS);
  return {
    y: m.getUTCFullYear(),
    m: m.getUTCMonth() + 1,
    d: m.getUTCDate(),
    dayOfWeek: m.getUTCDay(),
  };
}

// Diagnostico (para exibir em tela se precisar)
export function getClockStatus() {
  return {
    synced: _synced,
    offsetMs: _offsetMs,
    offsetSec: Math.round(_offsetMs / 1000),
    lastSyncAt: _lastSyncAt,
    deviceNow: new Date().toISOString(),
    serverNow: serverNow().toISOString(),
    manausTime: manausTimeHM(),
    manausDate: manausDateStr(),
  };
}

// Re-sincroniza a cada 10min (mantem precisao mesmo com drift)
if (typeof window !== 'undefined') {
  setInterval(() => { syncServerClock().catch(()=>{}); }, 10 * 60 * 1000);
}
