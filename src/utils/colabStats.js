// ── COLAB STATS — FONTE ÚNICA DE VERDADE ─────────────────────
// Marcia (02/jun/2026): antes cada tela calculava vendas/montagens/
// expedições de um jeito diferente e os números não batiam entre
// Colaboradores, RH e Relatórios. Agora tudo passa por aqui.
//
// REGRAS OFICIAIS:
//
// VENDAS  — pedido com paymentStatus = Aprovado/Pago/Recebido/Pago na
//           Entrega, status != Cancelado, e a colab é o vendedor:
//           checa vendedorId/vendedorEmail (primário) ou createdById/
//           createdByEmail/createdByName (fallback p/ pedidos antigos).
//           CONTA: 1 por pedido + soma do total em R$.
//
// MONTAGEM — pedido com status >= Pronto (inclui "Pronto", "Saiu p/
//            entrega", "Entregue"), != Cancelado, e a colab é o
//            montadorId/montadorEmail/montadorNome.
//            CONTA: qty dos itens NÃO-adicionais (buquê, arranjo…).
//            Itens da categoria "Adicional" (pelúcia, chocolate, balão,
//            pergaminho etc.) NÃO geram comissão de montagem.
//
// EXPEDIÇÃO — pedido com status = Entregue, != Cancelado, e a colab
//             é o expedidorId/expedidorEmail/expedidorNome.
//             NÃO inclui driverColabId/driverName (entregador é métrica
//             separada — quem dirigiu pra entregar não é quem expediu).
//             CONTA: 1 por pedido.
//
// ENTREGA  — pedido com status = Entregue, != Cancelado, e a colab
//            é o driver (driverColabId/driverEmail/driverName).
//            CONTA: 1 por pedido.

import { S } from '../state.js';

export const PG_APROV = new Set([
  'Aprovado','aprovado',
  'Pago','pago',
  'Pago na Entrega',
  'Recebido',
]);

// Compara um valor de campo do pedido (string|id) com o colab pra
// dizer "esta linha é dela?". Tolerante a campos antigos: aceita id,
// backendId, email e nome (case-insensitive).
export function isMineForColab(colab, ...vals) {
  if (!colab) return false;
  const ids = new Set([colab._id, colab.id, colab.backendId].filter(Boolean).map(String));
  const emailLow = String(colab.email||'').toLowerCase();
  const nameLow  = String(colab.name || colab.nome || '').toLowerCase();
  for (const v of vals) {
    if (v == null || v === '') continue;
    const s = String(v);
    if (ids.has(s)) return true;
    const sLow = s.toLowerCase();
    if (emailLow && sLow === emailLow) return true;
    if (nameLow  && sLow === nameLow)  return true;
  }
  return false;
}

// Janela de período em formato { start: Date, end: Date }.
// 'dia' = hoje (00:00 a 23:59), 'semana' = últimos 7 dias incluindo hoje,
// 'mes' = mês corrente, 'mes_ant' = mês passado, 'tudo' = sem filtro,
// 'custom' = recebido em opts.start/end.
export function getPeriodRange(period, opts = {}) {
  const now = new Date();
  if (period === 'tudo' || period === 'todos' || period === 'all') {
    return { start: new Date(0), end: new Date(8.64e15) };
  }
  if (period === 'custom') {
    return {
      start: opts.start ? new Date(opts.start) : new Date(0),
      end:   opts.end   ? new Date(opts.end)   : new Date(8.64e15),
    };
  }
  const start = new Date(now);
  const end   = new Date(now);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);
  if (period === 'dia' || period === 'hoje') {
    // start/end já configurados
  } else if (period === 'semana') {
    start.setDate(now.getDate() - 6);
  } else if (period === 'mes' || period === 'mes_atual') {
    start.setDate(1);
  } else if (period === 'mes_ant') {
    start.setMonth(now.getMonth() - 1, 1);
    end.setMonth(now.getMonth(), 0); end.setHours(23,59,59,999);
  } else {
    // Default = mes
    start.setDate(1);
  }
  return { start, end };
}

// Função genérica de pertinência a período. Recebe um valor de data
// (string ISO / Date) e retorna boolean.
export function makeInPeriod(period, opts = {}) {
  const { start, end } = getPeriodRange(period, opts);
  const startMs = start.getTime();
  const endMs   = end.getTime();
  return (dataRef) => {
    if (!dataRef) return false;
    const t = new Date(dataRef).getTime();
    if (Number.isNaN(t)) return false;
    return t >= startMs && t <= endMs;
  };
}

// FUNÇÃO PRINCIPAL — calcula stats da colab dentro de um período.
// `inPeriod` é função (dataRef) => boolean. Use `makeInPeriod` pra criar.
// Se nada for passado, usa "tudo".
export function calcColabStats(colab, inPeriod) {
  const stats = {
    vendas: 0,           fatVendas: 0,
    montagens: 0,        // soma de itens montados (qty)
    expedicoes: 0,       // pedidos expedidos
    entregas: 0,         // pedidos entregues (como driver)
    // comissões (R$) — calculadas se colab tem metas configuradas
    comissaoVenda: 0,
    comissaoMontagem: 0,
    comissaoExpedicao: 0,
    comissaoTotal: 0,
  };
  if (!colab) return stats;
  const pctV = Number(colab.metas?.comissaoVenda ?? colab.metas?.vendaPct ?? 0) || 0;
  const vM   = Number(colab.metas?.comissaoMontagem  ?? 0) || 0;
  const vE   = Number(colab.metas?.comissaoExpedicao ?? 0) || 0;
  const accept = typeof inPeriod === 'function' ? inPeriod : () => true;

  const orders   = Array.isArray(S.orders)   ? S.orders   : [];
  const products = Array.isArray(S.products) ? S.products : [];

  // Categoria que NÃO gera comissão de montagem — itens de "Adicionais"
  // (pelúcia, chocolate, balão, etc.) não são montados pela colaboradora.
  const CATS_ADICIONAL = new Set(['adicionais']);

  // Exceções dentro de "Adicionais": produtos que exigem montagem e DEVEM
  // gerar comissão mesmo estando nessa categoria. Basta o nome do item
  // conter qualquer um desses termos (case-insensitive, sem acento).
  const EXCECOES_MONTAGEM = ['petala', 'pétala', 'pétalas', 'petalas'];

  function _normNome(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Retorna true se o item é um "adicional" que NÃO conta para comissão.
  function _isItemAdicional(item) {
    // Exceção: pacote de pétalas fica em Adicionais mas é montado → conta.
    const nomeItem = _normNome(item.name || item.productName || '');
    if (EXCECOES_MONTAGEM.some(t => nomeItem.includes(_normNome(t)))) return false;

    // 1. Campo direto no item (gravado no momento da venda)
    const cats = Array.isArray(item.categories) ? item.categories
               : item.category ? [item.category] : [];
    if (cats.some(c => CATS_ADICIONAL.has(String(c).toLowerCase().trim()))) return true;
    // 2. Fallback: busca no catálogo atual pelo id do produto
    const pid  = String(item.product || item.productId || '');
    if (!pid) return false;
    const prod = products.find(p => String(p._id || p.id || '') === pid);
    if (!prod) return false;
    // Também checa exceção pelo nome do produto no catálogo
    if (EXCECOES_MONTAGEM.some(t => _normNome(prod.name || '').includes(_normNome(t)))) return false;
    const pCats = Array.isArray(prod.categories) ? prod.categories
                : prod.category ? [prod.category] : [];
    return pCats.some(c => CATS_ADICIONAL.has(String(c).toLowerCase().trim()));
  }

  for (const o of orders) {
    if (!o) continue;
    // Cancelado NUNCA conta — nem vendas, nem comissão.
    if (o.status === 'Cancelado') continue;
    const dataRef = o.createdAt || o.scheduledDate;
    if (!accept(dataRef)) continue;

    // Conta apenas itens NÃO adicionais para comissão de montagem.
    // Se todos os itens forem adicionais (caso raro), itemsQty fica 0
    // e nenhuma comissão de montagem é gerada.
    const itemsQty = (o.items || []).reduce(
      (s, i) => _isItemAdicional(i) ? s : s + (Number(i.qty) || 1),
      0,
    );

    const st = String(o.status || '').toLowerCase();

    // ── VENDAS — pagamento aprovado + colab é o vendedor
    if (PG_APROV.has(String(o.paymentStatus || ''))) {
      const ehMinha = isMineForColab(colab, o.vendedorId, o.vendedorEmail, o.vendedorNome) ||
        (!o.vendedorId && isMineForColab(colab,
          o.createdById, o.createdByEmail, o.createdByName,
          o.criadoPorId, o.criadoPorEmail, o.criadoPorNome,
          o.createdBy, o.criadoPor));
      if (ehMinha) {
        stats.vendas += 1;
        stats.fatVendas += Number(o.total) || 0;
        stats.comissaoVenda += (Number(o.total) || 0) * (pctV / 100);
      }
    }

    // ── MONTAGEM — status >= Pronto + colab é montador
    if (['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) {
      if (isMineForColab(colab, o.montadorId, o.montadorEmail, o.montadorNome)) {
        stats.montagens += itemsQty;
        stats.comissaoMontagem += vM * itemsQty;
      }
    }

    // ── EXPEDIÇÃO — status Entregue + colab é o EXPEDIDOR (não driver)
    if (st.includes('entregue')) {
      if (isMineForColab(colab, o.expedidorId, o.expedidorEmail, o.expedidorNome)) {
        stats.expedicoes += 1;
        stats.comissaoExpedicao += vE;
      }
    }

    // ── ENTREGA — status Entregue + colab é o driver (métrica separada)
    if (st.includes('entregue')) {
      if (isMineForColab(colab, o.driverColabId, o.driverBackendId, o.driverEmail, o.driverName, o.assignedDriverName)) {
        stats.entregas += 1;
      }
    }
  }

  stats.comissaoTotal = stats.comissaoVenda + stats.comissaoMontagem + stats.comissaoExpedicao;
  return stats;
}

// Calcula stats pra uma lista de colabs de uma vez (otimização: itera
// orders uma só vez ao invés de N vezes).
export function calcAllColabStats(colabs, inPeriod) {
  const result = new Map();
  if (!Array.isArray(colabs) || !colabs.length) return result;
  for (const c of colabs) {
    if (!c) continue;
    const id = String(c._id || c.id || c.backendId || c.email || c.name || '');
    if (!id) continue;
    result.set(id, calcColabStats(c, inPeriod));
  }
  return result;
}
