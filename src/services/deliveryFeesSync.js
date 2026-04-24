// ── SYNC DE TAXAS DE ENTREGA COM BACKEND ─────────────────────
// Arquivo separado para evitar dependencia circular em state.js.
// state.js eh o modulo mais importado do app e NAO pode importar
// api.js diretamente (api.js ja importa state.js → ciclo).
//
// Estrategia: registramos window._syncDeliveryFeesToBackend() para
// state.saveDeliveryFees() chamar. Aqui e o unico lugar que conhece
// a API + o state simultaneamente.
import { GET, PUT } from './api.js';
import { DELIVERY_FEES } from '../state.js';

const KEY = 'delivery-fees';

// Fire-and-forget: envia objeto atual para o backend
function syncToBackend(feesObj) {
  try {
    PUT('/settings/' + KEY, { value: feesObj }).catch(e => {
      console.warn('[delivery-fees sync] falha:', e.message || e);
    });
  } catch (e) { console.warn('[delivery-fees sync] throw:', e.message); }
}

// Carrega do backend e sobrescreve cache local. Backend vence conflitos.
export async function loadDeliveryFeesFromBackend() {
  try {
    const resp = await GET('/settings/' + KEY).catch(()=>null);
    const remote = (resp && typeof resp === 'object')
      ? (resp.value || resp.data || resp)
      : null;
    if (remote && typeof remote === 'object' && !Array.isArray(remote)) {
      // Substitui in-place para preservar a referencia exportada
      Object.keys(DELIVERY_FEES).forEach(k => delete DELIVERY_FEES[k]);
      Object.assign(DELIVERY_FEES, remote);
      try { localStorage.setItem('fv_delivery_fees', JSON.stringify(DELIVERY_FEES)); } catch(_){}
    }
  } catch (e) {
    console.warn('[delivery-fees] offline:', e.message || e);
  }
  return DELIVERY_FEES;
}

// Registra a ponte no window para state.saveDeliveryFees() chamar
if (typeof window !== 'undefined') {
  window._syncDeliveryFeesToBackend = syncToBackend;
}
