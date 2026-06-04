// ── COLETOR DE ERROS DO ADMIN ────────────────────────────────
// Captura erros JS e manda pro backend pra Marcia inspecionar
// quando algo der errado durante o pico de Namorados.
import { S, API } from '../state.js';

const seen = new Map();
const THROTTLE_MS = 60 * 1000;

function shouldSend(key) {
  const now = Date.now();
  const last = seen.get(key) || 0;
  if (now - last < THROTTLE_MS) return false;
  seen.set(key, now);
  return true;
}

function send(payload) {
  try {
    const body = JSON.stringify({
      ...payload,
      origin: 'admin',
      userId:   String(S.user?._id || S.user?.id || ''),
      userName: String(S.user?.name || S.user?.nome || ''),
    });
    if ('sendBeacon' in navigator) {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(`${API}/public/errors`, blob);
    } else {
      fetch(`${API}/public/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (_) {}
}

export function installErrorReporter() {
  if (typeof window === 'undefined') return;
  if (window._fvErrorReporterInstalled) return;
  window._fvErrorReporterInstalled = true;

  window.addEventListener('error', (e) => {
    const key = `js:${e.message}:${e.filename}:${e.lineno}`;
    if (!shouldSend(key)) return;
    send({
      kind: 'js',
      message: e.message || 'Unknown error',
      stack: e.error?.stack || '',
      name: e.error?.name || 'Error',
      page: S.page || window.location.pathname,
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      severity: 'warning',
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = reason?.message || String(reason || 'Unhandled rejection');
    const key = `promise:${msg}`;
    if (!shouldSend(key)) return;
    send({
      kind: 'promise',
      message: msg,
      stack: reason?.stack || '',
      name: reason?.name || 'UnhandledRejection',
      page: S.page || window.location.pathname,
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      severity: 'warning',
    });
  });

  // API manual pra logar erros conhecidos
  window.fvLogError = (msg, ctx = {}, severity = 'warning') => {
    send({
      kind: 'manual',
      message: String(msg).slice(0, 1000),
      stack: new Error().stack || '',
      name: 'ManualLog',
      page: S.page || window.location.pathname,
      url: window.location.href,
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      severity,
      ctx,
    });
  };
}
