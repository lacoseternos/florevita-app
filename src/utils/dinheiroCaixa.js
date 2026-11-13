// ── DINHEIRO DO DIA POR UNIDADE (Marcia 13/nov/2026) ──────────────────
// Onde o dinheiro em espécie fica fisicamente:
//   • Novo Aleixo: vendas de BALCÃO em dinheiro + baixas do "Falta pagar" em
//     dinheiro de pedidos de RETIRADA na loja (o cliente pagou lá na hora).
//   • CDLE: entregas em dinheiro (Pagar na Entrega/dinheiro, ou a parte em
//     dinheiro de um pagamento múltiplo) — o entregador traz pro CD — e as
//     retiradas feitas no CDLE.
// Pagamento múltiplo conta só a parte em dinheiro. Baixa do "Falta pagar"
// conta o valor recebido menos o troco, no dia da baixa.

const _low = (v) => String(v == null ? '' : v).toLowerCase();
const _dia = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? new Date(t - 4 * 3600e3).toISOString().slice(0, 10) : ''; };
const _n = (v) => Number(v) || 0;
const PAGOS = ['pago', 'aprovado', 'pago na entrega', 'recebido'];

export const ehNovoAleixo = (u) => { const s = _low(u); return s.includes('aleixo') || s === 'loja2'; };
export const ehCdle = (u) => { const s = _low(u); return s.includes('cdle') || (s.includes('centro') && s.includes('distrib')); };

function _tipo(o) {
  const t = _low(o.type || o.tipo);
  if (t.includes('balc')) return 'balcao';
  if (t.includes('retir')) return 'retirada';
  return 'entrega';
}

// Quanto do pedido foi em dinheiro (sem contar a baixa do "Falta pagar").
function _dinheiroDoPedido(o) {
  const splits = Array.isArray(o.paymentSplits) ? o.paymentSplits : [];
  if (splits.length) return splits.filter(s => _low(s.method).includes('dinheiro')).reduce((s, x) => s + _n(x.amount), 0);
  const pg = _low(o.payment);
  if (pg.startsWith('múltiplo') || pg.startsWith('multiplo')) {
    const m = String(o.payment).match(/dinheiro\s*r\$\s*([\d.,]+)/i);
    return m ? _n(m[1].replace(/,(?=\d{2}$)/, '.').replace(/,/g, '')) : 0;
  }
  if (pg.includes('dinheiro')) return _n(o.total);
  if (pg.includes('entrega') && _low(o.paymentOnDelivery).includes('dinheiro')) return _n(o.total);
  return 0;
}

// Lista do dinheiro do dia: [{ unidade: 'novoAleixo'|'cdle'|'outra', valor, origem, pedido }]
export function dinheiroDoDia(orders, dia) {
  const out = [];
  for (const o of orders || []) {
    if (!o || _low(o.status) === 'cancelado') continue;
    const tipo = _tipo(o);
    const q = o.pagamentoQuitacao;
    const local = tipo === 'balcao' ? (o.unit || o.unidade) : tipo === 'retirada' ? (o.pickupUnit || o.unit || o.unidade) : 'CDLE';
    const unidade = ehNovoAleixo(local) ? 'novoAleixo' : ehCdle(local) ? 'cdle' : 'outra';
    // Baixa do "Falta pagar" em dinheiro: conta no dia da baixa.
    if (q && _low(q.metodo).includes('dinheiro')) {
      if (_dia(q.data) !== dia) continue;
      const valor = Math.max(0, Math.min(_n(q.valorRecebido) - _n(q.troco), _n(o.total)));
      if (valor > 0) out.push({ unidade, valor, origem: tipo === 'entrega' ? 'Falta pagar (entrega)' : 'Falta pagar (retirada)', pedido: o });
      continue;
    }
    if (!PAGOS.includes(_low(o.paymentStatus))) continue;
    const valor = _dinheiroDoPedido(o);
    if (!(valor > 0)) continue;
    const quando = tipo === 'entrega' && _low(o.payment).includes('entrega') ? (o.deliveredAt || o.paymentApprovedAt || o.updatedAt) : (o.paymentApprovedAt || o.createdAt);
    if (_dia(quando) !== dia) continue;
    out.push({ unidade, valor, origem: tipo === 'balcao' ? 'Balcão' : tipo === 'retirada' ? 'Retirada' : 'Entrega', pedido: o });
  }
  return out;
}

export function totaisDinheiro(lista) {
  const t = { novoAleixo: 0, cdle: 0, outra: 0 };
  for (const x of lista) t[x.unidade] += x.valor;
  return t;
}
