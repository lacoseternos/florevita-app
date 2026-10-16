// ── CANAL DE VENDA — espelho de florevita-backend-2.0/src/utils/canalVenda.js ──
// Mesma ordem de regras do backend (fonte das Metas). Cada pedido cai em
// EXATAMENTE um canal; a soma dos canais é o total da empresa.
import { normalizeUnidade } from './unidadeRules.js';

export const CANAIS = ['cdle', 'site', 'loja2', 'ifood', 'giuliana'];
export const CANAL_INFO = {
  cdle:     { label: '📱 CDLE (atendentes)' },
  site:     { label: '🌐 Site / e-commerce' },
  loja2:    { label: '🏪 Loja 2 (Novo Aleixo)' },
  ifood:    { label: '🍔 iFood' },
  giuliana: { label: '💜 Giuliana' },
};

const low = (v) => String(v == null ? '' : v).toLowerCase();

export function canalDoPedido(o) {
  if (!o) return 'cdle';
  const src = low(o.source || o.salesChannel);
  const pay = low(o.payment || o.paymentMethod || o.formaPagamento);
  const tipo = low(o.type || o.tipo);
  if (src.includes('ifood')) return 'ifood';
  if (src.includes('giuli') || pay.includes('giuli')) return 'giuliana';
  if (src.includes('ecomm') || src.includes('e-comm') || src === 'site' || low(o.saleUnit).includes('commerce')) return 'site';
  if (tipo.includes('balc') || src.includes('balc') || normalizeUnidade(o.saleUnit) === 'novo_aleixo') return 'loja2';
  return 'cdle';
}
