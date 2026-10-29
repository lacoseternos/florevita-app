// ── ⏳ TAXA DA REENTREGA (Marcia 29/out/2026) ────────────────────────
// Ao gerar o link da taxa de reentrega, o pedido fica "Aguardando pagamento da
// reentrega" (o.taxaReentrega.status = 'Aguardando') até o Mercado Pago
// confirmar (webhook) ou alguém confirmar à mão. O paymentStatus do pedido
// NÃO muda — a venda original já está paga e continua contando.
import { S } from '../state.js';
import { PUT } from '../services/api.js';
import { toast } from './helpers.js';

export const aguardandoReentrega = (o) => o?.taxaReentrega?.status === 'Aguardando';

const _brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

// Selo; comBotao = mostra "Confirmar pagamento" (expedição/gerência).
export function seloReentrega(o, comBotao = false, curto = false) {
  if (!aguardandoReentrega(o)) return '';
  const t = o.taxaReentrega;
  if (curto) return `<div title="Aguardando pagamento da reentrega" style="display:inline-flex;align-items:center;gap:4px;background:#FEF3C7;border:1.5px solid #F59E0B;color:#92400E;border-radius:999px;padding:1px 7px;font-size:10px;font-weight:800;margin-top:2px;white-space:nowrap;">⏳ Reentrega ${_brl(t.valor)}${comBotao ? ` <button type="button" title="Confirmar pagamento da reentrega" onclick="event.stopPropagation();fvConfirmarTaxaReentrega('${o._id}')" style="background:#92400E;color:#fff;border:none;border-radius:999px;padding:0 6px;font-size:10px;cursor:pointer;">✅</button>` : ''}</div>`;
  return `<div style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;background:#FEF3C7;border:1.5px solid #F59E0B;color:#92400E;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:800;margin-top:3px;">
    ⏳ Aguardando pagamento da reentrega · ${_brl(t.valor)}
    ${comBotao ? `<button type="button" onclick="event.stopPropagation();fvConfirmarTaxaReentrega('${o._id}')" style="background:#92400E;color:#fff;border:none;border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:800;cursor:pointer;">✅ Confirmar pagamento</button>` : ''}
  </div>`;
}

// Confirmação manual (pagou por Pix/dinheiro fora do link).
window.fvConfirmarTaxaReentrega = async (id) => {
  const o = (S.orders || []).find(x => x._id === id);
  if (!o || !aguardandoReentrega(o)) return;
  if (!confirm(`Confirmar que o cliente pagou a taxa da reentrega (${_brl(o.taxaReentrega.valor)})?`)) return;
  const agora = new Date().toISOString();
  const reentregas = Array.isArray(o.reentregas) ? [...o.reentregas] : [];
  if (reentregas.length) reentregas[reentregas.length - 1] = { ...reentregas[reentregas.length - 1], taxaPaga: true, taxaPagaEm: agora };
  const payload = {
    taxaReentrega: { ...o.taxaReentrega, status: 'Pago', pagoEm: agora, pagoPor: S.user?.name || S.user?.nome || '', manual: true },
    ...(reentregas.length ? { reentregas } : {}),
  };
  try {
    await PUT('/orders/' + id, payload);
    Object.assign(o, payload);
    toast('✅ Taxa da reentrega confirmada como paga.');
    import('../main.js').then(m => m.render()).catch(() => {});
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao confirmar'), true); }
};
