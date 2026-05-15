// ── SISTEMA DE LICENCIAMENTO FLOREVITA ──────────────────────────────
// Gerencia trial, ativação e validação de licenças.
// Usa HMAC-SHA256 (Web Crypto API) para assinar e verificar licenças.

export const LICENSE_VERSION = '1.0.0';
export const TRIAL_DAYS = 7;

const SK = {
  MACHINE_ID:  'fv_machine_id',
  TRIAL_START: 'fv_trial_start',
  LAST_SEEN:   'fv_lic_last_seen',
  LICENSE:     'fv_license',
  ACT_LOG:     'fv_activation_log',
};

// Chave de assinatura — obfuscada em partes para dificultar extração simples
const _K = () => ['FLORE','VITA','LIC','2026','SYS','XM9T','ZBQR'].join('-');

// ── HMAC-SHA256 ─────────────────────────────────────────────────────
async function _sign(payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(_K()),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function _verify(payload, sig) {
  try {
    return (await _sign(payload)) === sig;
  } catch { return false; }
}

// ── MACHINE ID ──────────────────────────────────────────────────────
// Combinação de fingerprint de browser + UUID persistido em localStorage.
export async function getMachineId() {
  let mid = localStorage.getItem(SK.MACHINE_ID);
  if (mid) return mid;

  const fp = [
    navigator.userAgent.slice(0, 60),
    navigator.language,
    `${screen.width}x${screen.height}`,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
  ].join('|');

  const seed = fp + (typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36) + Date.now());

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  mid = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12)
    .toUpperCase();

  localStorage.setItem(SK.MACHINE_ID, mid);
  return mid;
}

// ── TRIAL ────────────────────────────────────────────────────────────
export function initTrial() {
  if (localStorage.getItem(SK.TRIAL_START)) return;
  const now = Date.now();
  localStorage.setItem(SK.TRIAL_START, String(now));
  localStorage.setItem(SK.LAST_SEEN, String(now));
  _log('trial_started', { date: new Date(now).toISOString() });
}

export function getTrialInfo() {
  const startStr = localStorage.getItem(SK.TRIAL_START);
  if (!startStr) return { started: false, daysLeft: 0, expired: true };

  const start = parseInt(startStr, 10);
  const now   = Date.now();

  // Detecta manipulação de relógio (rollback > 2 min)
  const lastSeen = parseInt(localStorage.getItem(SK.LAST_SEEN) || '0', 10);
  if (lastSeen > 0 && now < lastSeen - 120_000) {
    return { started: true, daysLeft: 0, expired: true, tampered: true };
  }
  localStorage.setItem(SK.LAST_SEEN, String(now));

  const elapsed  = now - start;
  const elapsedDays = Math.floor(elapsed / 86_400_000);
  const daysLeft = Math.max(0, TRIAL_DAYS - elapsedDays);
  const expireDate = new Date(start + TRIAL_DAYS * 86_400_000);

  return {
    started: true,
    daysLeft,
    expired: daysLeft <= 0,
    elapsedDays,
    startDate:  new Date(start).toLocaleDateString('pt-BR'),
    expireDate: expireDate.toLocaleDateString('pt-BR'),
  };
}

// ── ATIVAÇÃO ─────────────────────────────────────────────────────────
// activationCode = Base64( JSON.stringify({ data: {...}, sig: "..." }) )
export async function activateLicense(activationCode) {
  try {
    const raw     = activationCode.trim().replace(/\s+/g, '');
    const decoded = JSON.parse(atob(raw));
    const { data, sig } = decoded;

    if (!data || !sig) throw new Error('Formato de código inválido.');

    const dataStr = JSON.stringify(data);
    if (!(await _verify(dataStr, sig))) {
      throw new Error('Assinatura inválida — código incorreto ou adulterado.');
    }

    if (data.version && data.version !== LICENSE_VERSION) {
      throw new Error(`Versão incompatível (esperado ${LICENSE_VERSION}, recebido ${data.version}).`);
    }

    if (data.expirationDate) {
      const exp = new Date(data.expirationDate);
      if (exp < new Date()) throw new Error(`Licença vencida em ${exp.toLocaleDateString('pt-BR')}.`);
    }

    const myId = await getMachineId();
    if (data.machineId && data.machineId !== 'ANY' && data.machineId !== myId) {
      throw new Error(
        `Licença vinculada a outro dispositivo.\n` +
        `ID deste dispositivo: ${myId}\n` +
        `ID da licença: ${data.machineId}`
      );
    }

    const record = {
      ...data,
      activatedAt:    new Date().toISOString(),
      activationCode: raw,
    };
    localStorage.setItem(SK.LICENSE, JSON.stringify(record));
    _log('activated', { key: data.licenseKey, plan: data.plan, company: data.companyName });
    return { success: true, license: record };

  } catch (e) {
    return { success: false, error: e.message || 'Código de ativação inválido.' };
  }
}

// ── VERIFICAÇÃO GERAL ─────────────────────────────────────────────────
// Retorna: { status, license?, trial?, daysLeft?, plan?, message? }
// status: 'active' | 'trial' | 'trial_expired' | 'expired_license'
//         | 'wrong_machine' | 'tampered' | 'invalid'
export async function checkLicense() {
  // 1. Licença ativada?
  const licStr = localStorage.getItem(SK.LICENSE);
  if (licStr) {
    try {
      const license = JSON.parse(licStr);

      if (license.expirationDate) {
        const exp = new Date(license.expirationDate);
        if (exp < new Date()) {
          return {
            status: 'expired_license',
            license,
            message: `Licença expirou em ${exp.toLocaleDateString('pt-BR')}.`,
          };
        }
      }

      const myId = await getMachineId();
      if (license.machineId && license.machineId !== 'ANY' && license.machineId !== myId) {
        return {
          status: 'wrong_machine',
          license,
          message: 'Licença vinculada a outro dispositivo.',
        };
      }

      return { status: 'active', license, plan: license.plan || 'Básico' };

    } catch {
      localStorage.removeItem(SK.LICENSE);
    }
  }

  // 2. Período de teste
  initTrial();
  const trial = getTrialInfo();

  if (trial.tampered) {
    return { status: 'tampered', message: 'Manipulação de relógio detectada.' };
  }
  if (trial.expired) {
    return { status: 'trial_expired', trial, message: 'Período de teste encerrado.' };
  }

  return { status: 'trial', trial, daysLeft: trial.daysLeft };
}

// ── UTILITÁRIOS ───────────────────────────────────────────────────────
export function getLicenseInfo() {
  try {
    const s = localStorage.getItem(SK.LICENSE);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export function getActivationLog() {
  try {
    return JSON.parse(localStorage.getItem(SK.ACT_LOG) || '[]');
  } catch { return []; }
}

// Apenas para uso do desenvolvedor / reset de demo
export function resetLicenseData() {
  [SK.LICENSE, SK.TRIAL_START, SK.LAST_SEEN].forEach(k => localStorage.removeItem(k));
}

function _log(event, data) {
  try {
    const logs = JSON.parse(localStorage.getItem(SK.ACT_LOG) || '[]');
    logs.push({ event, data, ts: new Date().toISOString() });
    if (logs.length > 100) logs.splice(0, logs.length - 100);
    localStorage.setItem(SK.ACT_LOG, JSON.stringify(logs));
  } catch (_) {}
}

// ── GERADOR (usado pelo gerador-licenca.html via importação direta) ──
// Gera o código de ativação Base64 a partir dos dados da licença.
export async function generateActivationCode(data) {
  const sig  = await _sign(JSON.stringify(data));
  const code = btoa(JSON.stringify({ data, sig }));
  return code;
}

// Formata Machine ID para exibição amigável: XXXX-XXXX-XXXX
export function formatMachineId(mid) {
  if (!mid || mid.length < 12) return mid || '---';
  return `${mid.slice(0,4)}-${mid.slice(4,8)}-${mid.slice(8,12)}`;
}

// Gera chave de licença display-friendly: FLORI-XXXX-XXXX-XXXX-XXXX
export function generateLicenseKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `FLORI-${seg()}-${seg()}-${seg()}-${seg()}`;
}
