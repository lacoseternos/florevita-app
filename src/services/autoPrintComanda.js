// ─────────────────────────────────────────────────────────────
// IMPRESSAO AUTOMATICA DE COMANDAS (expedicao)
//
// Quando LIGADO (por PC), imprime a comanda automaticamente assim que um
// pedido de ENTREGA agendado para HOJE tem o pagamento APROVADO.
//
// - Configuracao por dispositivo (localStorage) — so o PC da expedicao imprime.
// - Ao LIGAR, "semeia" os pedidos ja qualificados como tratados: NAO imprime a
//   pilha existente, so os novos daqui pra frente.
// - Dedup proprio (fv_autoprint_done) pra nunca imprimir a mesma 2x.
// - Trava de seguranca: no maximo N por ciclo (evita avalanche de papel).
//
// Impressao silenciosa exige o Chrome em --kiosk-printing no PC da expedicao
// (senao abre a caixa de imprimir a cada comanda).
// ─────────────────────────────────────────────────────────────
import { S } from '../state.js';

const KEY_ON   = 'fv_autoprint_exped';  // '1' = ligado neste PC
const KEY_DONE = 'fv_autoprint_done';   // { orderId: timestamp } ja tratados
const CAP_POR_CICLO = 8;                // trava anti-avalanche

const APROVADOS = new Set([
  'Aprovado', 'Pago', 'Pago na Entrega', 'Recebido',
  'aprovado', 'pago', 'recebido',
]);

export function autoPrintOn(){
  try { return localStorage.getItem(KEY_ON) === '1'; } catch(_){ return false; }
}

function _loadDone(){ try { return JSON.parse(localStorage.getItem(KEY_DONE) || '{}') || {}; } catch(_){ return {}; } }
function _saveDone(d){ try { localStorage.setItem(KEY_DONE, JSON.stringify(d)); } catch(_){} }

function _hojeManaus(){ return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' }); }

// Pedido qualifica para auto-impressao:
//   - tipo ENTREGA (nao retirada, nao balcao)
//   - agendado para HOJE (Manaus)
//   - pagamento APROVADO
//   - nao cancelado
export function qualificaAutoPrint(o){
  if (!o || !o._id) return false;
  if (String(o.status || '') === 'Cancelado') return false;
  const tipo = String(o.type || o.tipo || '').toLowerCase();
  if (tipo.includes('retir') || tipo.includes('balc')) return false;
  const ehEntrega = tipo.includes('entrega') || tipo.includes('deliver');
  if (!ehEntrega) return false;
  const sd = String(o.scheduledDate || '').slice(0, 10);
  if (sd !== _hojeManaus()) return false;
  const ps = String(o.paymentStatus || o.status || '');
  return APROVADOS.has(ps);
}

// Liga/desliga no PC atual. Ao LIGAR, marca os ja-qualificados como tratados
// (nao imprime o que ja existe — so novos aprovados depois disso).
export function setAutoPrint(on){
  try {
    if (on) {
      const done = _loadDone();
      (S.orders || []).forEach(o => { if (qualificaAutoPrint(o)) done[o._id] = Date.now(); });
      _saveDone(done);
      localStorage.setItem(KEY_ON, '1');
    } else {
      localStorage.setItem(KEY_ON, '0');
    }
  } catch(_){}
  return autoPrintOn();
}

let _running = false;

// Verifica a fila e imprime os novos. Chamado a cada ciclo de polling.
export async function checkAutoPrint(){
  if (_running || !autoPrintOn()) return;
  const done = _loadDone();
  const pendentes = (S.orders || []).filter(o => qualificaAutoPrint(o) && !done[o._id]);
  if (!pendentes.length) return;

  _running = true;
  try {
    const mod = await import('../pages/impressao.js');
    let toastFn = null;
    try { toastFn = (await import('../utils/helpers.js')).toast; } catch(_){}

    const lote = pendentes.slice(0, CAP_POR_CICLO);
    for (const o of lote) {
      let ok = false;
      try { ok = await mod.printComandaSilent(o._id); } catch(_){ ok = false; }
      // marca tratado mesmo se falhou, pra nao entrar em loop de reimpressao
      done[o._id] = Date.now();
      _saveDone(done);
      if (ok && toastFn) toastFn('🖨️ Comanda impressa automaticamente — pedido ' + (o.orderNumber || o.numero || ''));
      await new Promise(r => setTimeout(r, 1200)); // espaca os jobs de impressao
    }

    if (pendentes.length > CAP_POR_CICLO && toastFn) {
      toastFn('⚠️ ' + (pendentes.length - CAP_POR_CICLO) + ' comanda(s) a mais na fila — imprimindo no proximo ciclo', true);
    }

    // Poda o historico (>3 dias) pra nao crescer sem fim
    const limite = Date.now() - 3 * 86400000;
    let mudou = false;
    for (const k of Object.keys(done)) if (done[k] < limite) { delete done[k]; mudou = true; }
    if (mudou) _saveDone(done);
  } finally {
    _running = false;
  }
}
