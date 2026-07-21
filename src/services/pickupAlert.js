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

// ── Aviso na tela, com foto e nome do produto ───────────────────
// O toast padrão não serve: é texto puro (textContent) e some em 3,5s.
// Aqui montamos um cartão que fica na tela até a colaboradora confirmar.

function _imgDoItem(it) {
  const direta = it?.image || it?.imagem || it?.foto;
  if (direta) return direta;
  const pid = String(it?.product || it?.productId || '');
  const p = (S.products || []).find(x => String(x._id) === pid);
  return p?.imagem || p?.images?.[0] || p?.image || '';
}

function _escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _mostrarCardRetirada(order) {
  let wrap = document.getElementById('fv-retirada-alerts');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'fv-retirada-alerts';
    wrap.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);'
      + 'z-index:99998;display:flex;flex-direction:column;gap:10px;width:min(94vw,460px);';
    document.body.appendChild(wrap);
  }

  const itens = Array.isArray(order.items) ? order.items : [];
  const num     = order.orderNumber || order.numero || '';
  const cliente = order.client?.name || order.clientName || 'Cliente';
  const hora    = order.scheduledTime ? String(order.scheduledTime) : '';
  const turno   = order.scheduledPeriod ? String(order.scheduledPeriod) : '';

  const linhasItens = itens.slice(0, 4).map(it => {
    const img = _imgDoItem(it);
    const nome = _escapar(it.name || it.productName || it.nome || 'Item');
    const qtd = Number(it.qty) || 1;
    return `<div style="display:flex;align-items:center;gap:9px;padding:5px 0;">
      ${img
        ? `<img src="${_escapar(img)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex:none;border:1px solid rgba(0,0,0,.08);"/>`
        : `<span style="width:44px;height:44px;border-radius:8px;background:#FDF2F8;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none;">🌸</span>`}
      <div style="min-width:0;flex:1;">
        <div style="font-size:13px;font-weight:700;color:#1F2937;line-height:1.25;">${qtd}× ${nome}</div>
      </div>
    </div>`;
  }).join('');

  const resto = itens.length > 4
    ? `<div style="font-size:11px;color:#6B7280;padding-top:2px;">+ mais ${itens.length - 4} item(ns)</div>`
    : '';

  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;border:3px solid #B45309;border-radius:14px;'
    + 'box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;animation:fvRetIn .25s ease-out;';
  card.innerHTML = `
    <div style="background:linear-gradient(135deg,#F59E0B,#B45309);color:#fff;padding:10px 14px;">
      <div style="font-size:15px;font-weight:900;letter-spacing:.4px;line-height:1.2;">🛍️ RETIRADA HOJE — NOVO ALEIXO</div>
      <div style="font-size:12px;opacity:.95;margin-top:2px;">
        Pedido <strong>${_escapar(num)}</strong> · ${_escapar(cliente)}${hora ? ` · <strong>${_escapar(hora)}</strong>` : (turno ? ` · ${_escapar(turno)}` : '')}
      </div>
    </div>
    <div style="padding:10px 14px 12px;">
      ${linhasItens || '<div style="font-size:12px;color:#6B7280;">Sem itens detalhados</div>'}
      ${resto}
      <button type="button" data-ret-ok style="width:100%;margin-top:10px;background:#B45309;color:#fff;
        border:none;border-radius:9px;padding:10px;font-size:13px;font-weight:800;cursor:pointer;">
        ✓ Vi, vou preparar
      </button>
    </div>`;

  card.querySelector('[data-ret-ok]').onclick = () => card.remove();
  wrap.appendChild(card);

  // Animação (injeta só uma vez)
  if (!document.getElementById('fv-ret-anim')) {
    const st = document.createElement('style');
    st.id = 'fv-ret-anim';
    st.textContent = '@keyframes fvRetIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:none}}';
    document.head.appendChild(st);
  }
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

    // Cartão na tela com foto e nome dos produtos (fica até confirmar)
    try { _mostrarCardRetirada(order); } catch (_) {}

    // Resumo dos itens também na notificação do sininho
    const itensTxt = (Array.isArray(order.items) ? order.items : [])
      .slice(0, 3)
      .map(i => `${Number(i.qty)||1}× ${i.name || i.productName || 'Item'}`)
      .join(' · ');

    import('./notifications.js').then(m => m.addNotification && m.addNotification({
      id: 'retirada-hoje-' + id,
      type: 'alert',
      title: '🛍️ Retirada HOJE no Novo Aleixo',
      body: `Pedido ${num} · ${cliente}${hora}${itensTxt ? ' — ' + itensTxt : ''}`,
      meta: { orderId: id },
    })).catch(() => {});
  } catch (_) {}
}
