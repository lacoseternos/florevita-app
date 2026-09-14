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
const KEY_CFG  = 'fv_autoprint_cfg';    // { copies } config por PC
const CAP_POR_CICLO = 8;                // trava anti-avalanche

// Config (por PC): numero de copias por pedido.
export function getAutoPrintCfg(){
  let c = {};
  try { c = JSON.parse(localStorage.getItem(KEY_CFG) || '{}') || {}; } catch(_){}
  return { copies: Math.min(Math.max(parseInt(c.copies) || 1, 1), 3) };
}
export function setAutoPrintCfg(cfg){
  try { localStorage.setItem(KEY_CFG, JSON.stringify({ copies: Math.min(Math.max(parseInt(cfg?.copies) || 1, 1), 3) })); } catch(_){}
  return getAutoPrintCfg();
}

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
  ensureAutoPrintLoop();   // liga/desliga o verificador independente
  return autoPrintOn();
}

// ── LOOP INDEPENDENTE DA TELA ──────────────────────────────────
// O polling das paginas so roda em telas operacionais. Como a expedicao
// navega por outros modulos, este loop proprio garante que a auto-impressao
// funcione em QUALQUER tela enquanto estiver ligada: ele mesmo busca os
// pedidos AGENDADOS PARA HOJE (completos, com itens) e imprime os novos.
let _timer = null;

export function ensureAutoPrintLoop(){
  const on = autoPrintOn();
  if (on && !_timer) {
    _timer = setInterval(() => { _tick().catch(()=>{}); }, 12000);
    _tick().catch(()=>{});     // roda ja ao ligar/abrir
  } else if (!on && _timer) {
    clearInterval(_timer); _timer = null;
  }
}

async function _tick(){
  if (!autoPrintOn()) { if (_timer) { clearInterval(_timer); _timer = null; } return; }
  // Busca os pedidos agendados para hoje (objetos COMPLETOS, com itens) e
  // mescla em S.orders — independe do polling da pagina atual.
  try {
    const hoje = _hojeManaus();
    const { GET } = await import('./api.js');
    const arr = await GET(`/orders?scheduledFrom=${hoje}&scheduledTo=${hoje}&limit=500`);
    if (Array.isArray(arr) && arr.length) {
      const byId = new Map();
      for (const o of (S.orders || [])) if (o?._id) byId.set(String(o._id), o);
      for (const o of arr) { if (!o?._id) continue; const id = String(o._id); byId.set(id, byId.has(id) ? { ...byId.get(id), ...o } : o); }
      S.orders = [...byId.values()];
    }
  } catch(_){}
  await checkAutoPrint();
}

let _running = false;

// Verifica a fila e imprime os novos. Chamado pelo loop proprio e pelo polling.
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

    const copies = getAutoPrintCfg().copies;
    const lote = pendentes.slice(0, CAP_POR_CICLO);
    for (const o of lote) {
      let ok = false;
      try {
        for (let i = 0; i < copies; i++) {
          ok = await mod.printComandaSilent(o._id) || ok;
          if (copies > 1 && i < copies - 1) await new Promise(r => setTimeout(r, 800));
        }
      } catch(_){ ok = false; }
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
