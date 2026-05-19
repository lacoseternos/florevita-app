// ── ALERTA E-COMMERCE (pedidos do site) ──────────────────────
// Quando um pedido novo chega do site (source='E-commerce'), exibe:
//   1) Toast "🛒 Novo Pedido no Site. Verificar Dados e Pagamento !!"
//   2) Beep agradavel (3 notas curtas, nao agressivo como iFood)
//   3) Card modal flutuante (canto superior direito) com link "Ver Pedido"
// Diferente do iFood (toque telefonico continuo + modal), o site eh
// menos urgente — atendente tem tempo de conferir dados/pagamento.

import { S } from '../state.js';
import { toast } from '../utils/helpers.js';

// IDs ja vistos (persistido em localStorage)
const SEEN_KEY = 'fv_ecomm_alerted_ids';
function getSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch (_) { return new Set(); }
}
function saveSeen(set) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500))); }
  catch (_) { /* quota cheia, ignora */ }
}

// Detecta E-commerce (source='E-commerce' ou contains 'ecomm'/'site')
function isFromEcommerce(o) {
  const s = String(o?.source || '').toLowerCase().trim();
  if (s === 'e-commerce' || s === 'ecommerce' || s === 'site') return true;
  if (s.includes('ecomm') || s.includes('e-comm')) return true;
  return false;
}

// Beep suave: 3 notas curtas (Do-Mi-Sol) — agradavel, nao agressivo
let _audioCtx = null;
function beep() {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(()=>{});
    const ctx = _audioCtx;
    const notes = [523.25, 659.25, 783.99]; // Do5, Mi5, Sol5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0;
      osc.connect(gain).connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.18);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    });
  } catch (e) { /* sem audio, segue silencioso */ }
}

// Modal flutuante (canto superior direito) — auto-fecha em 12s
function showEcommerceCard(order) {
  // Empilha varios cards se chegarem juntos
  let host = document.getElementById('fv-ecomm-alerts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'fv-ecomm-alerts';
    host.style.cssText = 'position:fixed;top:14px;right:14px;z-index:99998;display:flex;flex-direction:column;gap:10px;max-width:380px;width:calc(100vw - 28px);';
    document.body.appendChild(host);
  }

  const num = order.orderNumber || order.numero || '—';
  const cli = order.clientName || order.client?.name || order.recipient || 'Cliente';
  const total = Number(order.total || 0);
  const pay = order.payment || order.paymentMethod || '—';
  const fmtBR = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');

  const card = document.createElement('div');
  card.style.cssText = 'background:linear-gradient(135deg,#10B981,#059669);color:#fff;border-radius:14px;padding:16px 18px;box-shadow:0 18px 42px rgba(16,185,129,.4);animation:fvEcommSlide .4s cubic-bezier(.34,1.56,.64,1);cursor:pointer;border:2px solid #fff;';
  card.innerHTML = `
    <div style="display:flex;align-items:start;justify-content:space-between;gap:8px;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:28px;line-height:1;">🛒</span>
        <div>
          <div style="font-weight:900;font-size:15px;line-height:1.1;letter-spacing:.3px;">NOVO PEDIDO NO SITE</div>
          <div style="font-size:11px;opacity:.9;margin-top:2px;">Verificar Dados e Pagamento !!</div>
        </div>
      </div>
      <button style="background:rgba(255,255,255,.2);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;font-weight:700;line-height:1;" title="Fechar">×</button>
    </div>
    <div style="background:rgba(255,255,255,.15);border-radius:10px;padding:10px 12px;font-size:13px;">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
        <span style="opacity:.85;">Pedido</span>
        <strong>#${String(num).replace(/^#/,'')}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
        <span style="opacity:.85;">Cliente</span>
        <strong style="text-align:right;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cli}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;">
        <span style="opacity:.85;">Pagamento</span>
        <strong>${pay}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;gap:8px;border-top:1px dashed rgba(255,255,255,.3);padding-top:6px;margin-top:6px;">
        <span style="opacity:.85;">Valor total</span>
        <strong style="font-size:15px;color:#FEF3C7;">${fmtBR(total)}</strong>
      </div>
    </div>
    <div style="font-size:10px;opacity:.85;margin-top:8px;text-align:center;letter-spacing:.5px;">CLIQUE PARA ABRIR EM PEDIDOS →</div>
  `;
  host.appendChild(card);

  // Click → vai pra Pedidos (qualquer ponto do card)
  card.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    card.remove();
    try {
      S.page = 'pedidos';
      S._orderSearch = String(num).replace(/^#/, '');
      import('../main.js').then(m => m.render && m.render()).catch(()=>{});
    } catch(_){}
  });
  card.querySelector('button').addEventListener('click', () => card.remove());

  // Auto-remove em 15s
  setTimeout(() => { try { card.remove(); } catch(_){} }, 15000);

  // CSS animation (injeta uma vez)
  if (!document.getElementById('fv-ecomm-css')) {
    const style = document.createElement('style');
    style.id = 'fv-ecomm-css';
    style.textContent = `
      @keyframes fvEcommSlide {
        from { opacity: 0; transform: translateX(40px) scale(.85); }
        to   { opacity: 1; transform: translateX(0)   scale(1); }
      }
    `;
    document.head.appendChild(style);
  }
}

// Chamada principal — recebe lista atual de orders e detecta novos do site
export function checkAndAlertEcommerce(orders) {
  if (!Array.isArray(orders) || !orders.length) return;
  const seen = getSeen();
  const now = Date.now();
  const novos = [];
  for (const o of orders) {
    if (!isFromEcommerce(o)) continue;
    const id = o._id || o.id || o.orderNumber;
    if (!id || seen.has(id)) continue;
    // Pedidos com mais de 30 min de criados NAO disparam alerta
    // (evita alerta em massa quando usuario carrega pedidos antigos)
    const createdAt = new Date(o.createdAt || 0).getTime();
    if (createdAt && (now - createdAt) > 30 * 60 * 1000) {
      seen.add(id); // marca como visto sem alertar
      continue;
    }
    seen.add(id);
    novos.push(o);
  }
  saveSeen(seen);
  // Dispara alerta pra cada novo
  for (const o of novos) {
    try {
      beep();
      toast('🛒 Novo Pedido no Site! Verificar Dados e Pagamento !!');
      showEcommerceCard(o);
    } catch (e) { console.warn('[ecommAlert] erro:', e); }
  }
}

// Marca todos os existentes como vistos (chamado no init pra nao alertar
// em massa quando o usuario abre o sistema)
export function primeEcommerceSeen(orders) {
  if (!Array.isArray(orders)) return;
  const seen = getSeen();
  for (const o of orders) {
    if (!isFromEcommerce(o)) continue;
    const id = o._id || o.id || o.orderNumber;
    if (id) seen.add(id);
  }
  saveSeen(seen);
}

// Test manual via console: window.testEcommAlert()
if (typeof window !== 'undefined') {
  window.testEcommAlert = () => showEcommerceCard({
    orderNumber: '015999',
    clientName: 'Teste do Site',
    total: 189.90,
    payment: 'Pix',
  });
}
