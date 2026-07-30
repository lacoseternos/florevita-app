// ── FONTE ÚNICA DA VERDADE: o que conta como VENDA REALIZADA ──
// Marcia (30/jul/2026): antes cada tela somava vendas de um jeito e os
// números divergiam (faturamento, financeiro, site, comissões, cliente).
// Agora TODA soma de venda/comissão passa por aqui.
//
// REGRA OFICIAL (estrita):
//   Uma venda só entra na soma de faturamento/comissão se:
//     1) o pedido NÃO está Cancelado, E
//     2) o pagamento está explicitamente marcado como válido:
//        Aprovado · Pago · Pago na Entrega · Recebido
//   Pagamento EM BRANCO **não conta** — mesmo que o pedido esteja
//   Entregue (a equipe precisa marcar o pagamento). "Ag. Pagamento na
//   Entrega", "Pendente", "Aguardando", "Negado", "Estornado" e
//   "Cancelado" NUNCA contam.

// Rótulos de pagamento que representam dinheiro de verdade no caixa.
export const PAID_STATUSES = ['Aprovado', 'Pago', 'Pago na Entrega', 'Recebido'];

// Set (com variações de caixa) para quem já chama .has(paymentStatus).
// Mantido p/ compatibilidade com colabStats/relatorios.
export const PG_APROV = new Set([
  'Aprovado', 'aprovado',
  'Pago', 'pago',
  'Pago na Entrega', 'pago na entrega',
  'Recebido', 'recebido',
]);

const _NORM_PAID = new Set(PAID_STATUSES.map(s => s.toLowerCase()));

// pagamento válido? (case-insensitive, ignora espaços em volta)
export function isPagoValido(paymentStatus) {
  return _NORM_PAID.has(String(paymentStatus == null ? '' : paymentStatus).trim().toLowerCase());
}

// pedido cancelado?
export function isCancelado(order) {
  return String(order && order.status != null ? order.status : '').trim().toLowerCase() === 'cancelado';
}

// A venda entra na soma de faturamento/comissão?
export function isVendaRealizada(order) {
  return !!order && !isCancelado(order) && isPagoValido(order.paymentStatus);
}

// Filtra uma lista deixando só as vendas realizadas.
export function apenasVendasRealizadas(orders) {
  return (Array.isArray(orders) ? orders : []).filter(isVendaRealizada);
}
