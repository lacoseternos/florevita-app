// ── CORES DOS ENTREGADORES ───────────────────────────────────
// Marcia (20/jun/2026): cada entregador tem uma cor. A cor vale pra:
//   • o pino do pedido quando ele JÁ está em rota com aquele entregador;
//   • a moto da localização ao vivo dele no Painel de Delivery.
// Pedido que AINDA está na loja (não saiu — aguardando/preparo/pronto) =
// CINZA, independente do status.
//
// As cores ficam salvas no backend (Settings 'driverColors') por NOME
// normalizado, e podem ser editadas no Painel de Delivery (aba
// Entregadores). Defaults pra David/José/Jucy/Gisele.

export const COR_NA_LOJA = '#9CA3AF'; // cinza — pedido ainda na loja

const _PALETTE_FALLBACK = ['#2563EB', '#16A34A', '#7C3AED', '#DB2777', '#F59E0B', '#0891B2', '#EA580C'];

let _map = {};        // { nomeNormalizado: hex }
let _carregado = false;

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Default por nome (sementes pedidas pela Marcia).
function _defaultPorNome(nome) {
  const n = _norm(nome);
  if (n.includes('david')) return '#2563EB'; // azul
  if (n.includes('jose'))  return '#16A34A'; // verde (Sr José)
  if (n.includes('jucy'))  return '#7C3AED'; // roxo
  if (n.includes('gisele') || /\bgi\b/.test(n)) return '#DB2777'; // rosa (Gi)
  return null;
}

// Cor do entregador: salva > default por nome > paleta por hash (estável).
export function corEntregador(nome) {
  const key = _norm(nome);
  if (key && _map[key]) return _map[key];
  const def = _defaultPorNome(nome);
  if (def) return def;
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return _PALETTE_FALLBACK[h % _PALETTE_FALLBACK.length];
}

// Inicial (ignora títulos como "Sr"): "Sr José" → "J".
export function inicialEntregador(nome) {
  const limpo = String(nome || '').replace(/^\s*(sr|sra|dr|dra|seu|dona)\.?\s+/i, '').trim();
  return (limpo[0] || '?').toUpperCase();
}

// Cor do PEDIDO: em rota → cor do entregador; senão (na loja) → cinza.
export function corDoPedido(o) {
  const s = String(o?.status || '').toLowerCase();
  if (s.includes('saiu')) return corEntregador(o.driverName || o.assignedDriverName || '');
  return COR_NA_LOJA;
}

// Rótulo curto do pedido pro balão/card.
export function labelDoPedido(o) {
  const s = String(o?.status || '').toLowerCase();
  if (s.includes('saiu')) return (o.driverName || o.assignedDriverName || 'Em rota');
  if (s.includes('pronto')) return 'Pronto';
  if (s.includes('entregue')) return 'Entregue';
  return 'Em preparação';
}

// Carrega as cores salvas (1x, com cache). Best-effort.
export async function carregarCores() {
  if (_carregado) return _map;
  try {
    const { GET } = await import('../services/api.js');
    const r = await GET('/settings/driverColors');
    const val = (r && r.value && typeof r.value === 'object') ? r.value : {};
    _map = val;
    _carregado = true;
  } catch (_) { _carregado = true; }
  return _map;
}

export function coresAtuais() { return _map; }

// Salva/atualiza a cor de um entregador (por nome). Persiste no backend.
export async function salvarCorEntregador(nome, hex) {
  const key = _norm(nome);
  if (!key) return;
  _map = { ..._map, [key]: hex };
  try {
    const { PUT } = await import('../services/api.js');
    await PUT('/settings/driverColors', { value: _map });
  } catch (e) { console.warn('[cores] salvar falhou:', e.message); }
}
