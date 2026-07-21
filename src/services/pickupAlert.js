// ── ALERTA SONORO: RETIRADA HOJE NO NOVO ALEIXO ──────────────────
// Marcia (jul/2026): pedido de RETIRADA no MESMO DIA no Novo Aleixo não
// pode passar despercebido — a cliente aparece no balcão e o arranjo
// precisa estar pronto. Toca um alerta só nos aparelhos das
// colaboradoras dessa unidade.
//
// Regras (todas precisam bater):
//   1. Quem está logado é da unidade Loja Novo Aleixo
//   2. O pedido é RETIRADA (não delivery, não balcão)
//   3. A retirada é no Novo Aleixo
//   4. A data de retirada é HOJE (fuso de Manaus)

import { S } from '../state.js';

const UNIDADE_ALVO = 'novo aleixo';

// ── Áudio (mesmo padrão do painel-tv, que já funciona nas TVs) ──
let _ctx = null;
function _getCtx() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {}
  }
  // Navegador suspende o áudio até haver um gesto do usuário
  if (_ctx && _ctx.state === 'suspended') { try { _ctx.resume(); } catch (_) {} }
  return _ctx;
}

function _beep(freq, dur, vol = 0.5, type = 'sine') {
  try {
    const ctx = _getCtx(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = freq; o.type = type;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch (_) {}
}

// Toque característico (3 notas ascendentes), repetido 2x para não passar
// batido no movimento do balcão.
function tocarAlerta() {
  const seq = () => {
    _beep(784, 0.16, 0.55);                        // Sol
    setTimeout(() => _beep(988, 0.16, 0.55), 180); // Si
    setTimeout(() => _beep(1319, 0.28, 0.6), 360); // Mi agudo
  };
  seq();
  setTimeout(seq, 1100);
}

// O navegador só libera áudio depois de um clique/toque. Chamamos isto no
// boot: no primeiro gesto o contexto é criado e destravado.
export function initPickupAlertAudio() {
  const destravar = () => { _getCtx(); };
  ['click', 'touchstart', 'keydown'].forEach(ev =>
    window.addEventListener(ev, destravar, { once: true, passive: true })
  );
}

// ── Regras ──────────────────────────────────────────────────────
function _hojeManaus() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
}

// Extrai YYYY-MM-DD de um campo de data (aceita 'YYYY-MM-DD' e ISO).
// Meia-noite UTC (Date do Mongo) é tratada como data pura, senão o
// pedido cairia no dia anterior ao converter para Manaus.
function _diaDe(valor) {
  if (!valor) return '';
  const s = String(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d+)?Z?$/.test(s)) return s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
  } catch (_) { return ''; }
}

function _ehDoNovoAleixo(txt) {
  return String(txt || '').toLowerCase().includes(UNIDADE_ALVO);
}

// A pessoa logada é do Novo Aleixo?
export function usuarioEhNovoAleixo(user = S.user) {
  return _ehDoNovoAleixo(user?.unit) || _ehDoNovoAleixo(user?.unidade);
}

// O pedido é retirada HOJE no Novo Aleixo?
export function ehRetiradaHojeNovoAleixo(o) {
  if (!o) return false;
  const tipo = String(o.type || o.tipo || '').toLowerCase();
  if (!(tipo.includes('retir') || tipo === 'pickup')) return false;
  // Loja da retirada — cai para a unidade do pedido se pickupUnit vier vazio
  const loja = o.pickupUnit || o.retiradaLoja || o.unit || o.unidade || '';
  if (!_ehDoNovoAleixo(loja)) return false;
  // Sem data agendada, assume que é para hoje (retirada de balcão imediata)
  const dia = _diaDe(o.scheduledDate) || _diaDe(o.createdAt);
  return !dia || dia === _hojeManaus();
}

// ── Entrada principal: chamado quando chega um pedido novo ──────
const _jaAvisados = new Set();

export function avisarSeRetiradaHoje(order) {
  try {
    if (!order || !order._id) return;
    if (!usuarioEhNovoAleixo()) return;          // só o Novo Aleixo ouve
    if (!ehRetiradaHojeNovoAleixo(order)) return;
    const id = String(order._id);
    if (_jaAvisados.has(id)) return;             // não repete o mesmo pedido
    _jaAvisados.add(id);

    tocarAlerta();

    const num = order.orderNumber || order.numero || '';
    const cliente = order.client?.name || order.clientName || 'Cliente';
    const hora = order.scheduledTime ? ` às ${order.scheduledTime}` : '';
    const msg = `🛍️ RETIRADA HOJE${hora} — Novo Aleixo · Pedido ${num} · ${cliente}`;

    import('../utils/helpers.js').then(m => m.toast && m.toast(msg, true)).catch(() => {});
    import('./notifications.js').then(m => m.addNotification && m.addNotification({
      id: 'retirada-hoje-' + id,
      type: 'alert',
      title: '🛍️ Retirada HOJE no Novo Aleixo',
      body: `Pedido ${num} · ${cliente}${hora}`,
      meta: { orderId: id },
    })).catch(() => {});
  } catch (_) {}
}
