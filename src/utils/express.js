// ── ⚡ ENTREGA EXPRESS (Marcia 29/out/2026) ──────────────────────────
// Turno "Express" no PDV: o prazo é de 2 horas contadas da APROVAÇÃO do
// pagamento (paymentApprovedAt). Enquanto não aprova, o prazo ainda não corre.
// Fonte única pra comanda, pedidos, expedição, produção e app do entregador.
export const EXPRESS = 'Express';
export const EXPRESS_HORAS = 2;

export const isExpress = (o) => /express/i.test(String(o?.scheduledPeriod || ''));

// Date do prazo, ou null se ainda não foi pago.
export function prazoExpress(o) {
  if (!isExpress(o) || !o?.paymentApprovedAt) return null;
  const t = new Date(o.paymentApprovedAt).getTime();
  return Number.isFinite(t) ? new Date(t + EXPRESS_HORAS * 3600e3) : null;
}

// "10:45" no horário de Manaus, ou '' se ainda não foi pago.
export function horaExpress(o) {
  const p = prazoExpress(o);
  return p ? p.toLocaleTimeString('pt-BR', { timeZone: 'America/Manaus', hour: '2-digit', minute: '2-digit' }) : '';
}

// Texto curto pra listas: "⚡ Express até 10:45" / "⚡ Express (2h após o pagamento)".
export function expressTexto(o) {
  if (!isExpress(o)) return '';
  const h = horaExpress(o);
  return h ? `⚡ Express até ${h}` : `⚡ Express (${EXPRESS_HORAS}h após o pagamento)`;
}

// Selo colorido pra telas do sistema.
export function expressSelo(o) {
  if (!isExpress(o)) return '';
  return `<span style="background:#7C3AED;color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:800;white-space:nowrap;">${expressTexto(o)}</span>`;
}
