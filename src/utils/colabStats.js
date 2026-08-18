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
// Fonte única: o conjunto de pagamentos válidos vive em utils/sales.js.
// Reexportado aqui pra não quebrar quem importa PG_APROV de colabStats.
import { PG_APROV, isVendaRealizada } from './sales.js';
import { dataEntregaRef, entregaFutura } from './formatters.js';
export { PG_APROV, isVendaRealizada };

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

// ── FONTE ÚNICA da detecção de "adicional" (frontend) ────────────────
// Espelha comissaoService._detItemAdicional do backend. Usada por
// calcColabStats (RH/Relatórios/colaboradores/produção/expedição/financeiro)
// E por metas.js — pra montagem NUNCA contar adicional em NENHUMA superfície.
const _CATS_ADIC = new Set(['adicionais']);
const _EXC_MONT = ['petala', 'pétala', 'pétalas', 'petalas'];
const _ADIC_NOME = ['barra', 'chocolate', 'ferrero', 'kit kat', 'kitkat',
  'nutella', 'bombom', 'lacta', 'lacreme', 'ouro branco', 'sonho de valsa',
  'talento', 'urso', 'pelucia', 'balao', 'pergaminho', 'bilhete', 'cartao',
  'polaroid', 'polaroide', 'foto', 'trilho de fotos', 'vela'];
const _BASE_MONT = ['buque', 'cone', 'cesta', 'ramalhete', 'arranjo', 'box',
  'gift', 'caixa', 'jardim', 'orquidea', 'vaso', 'coroa', 'rosa', 'girassol',
  'gerbera', 'tulipa', 'lirio', 'margarida', 'flor', 'kit romantico', 'combo'];

function _normAd(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function _temBaseAd(...nomes) {
  return nomes.map(n => _normAd(n || '')).filter(Boolean)
    .some(n => _BASE_MONT.some(b => n.includes(b)));
}
function _adicPorNomeAd(...nomes) {
  const ns = nomes.map(n => _normAd(n || '')).filter(Boolean);
  if (!ns.length) return false;
  if (_temBaseAd(...ns)) return false; // é arranjo → conta
  return ns.some(n => _ADIC_NOME.some(a => n.includes(a)));
}

// Cria o predicado "este item é adicional (NÃO conta montagem)?" ligado ao
// catálogo `products` (adicNomes pré-computado uma vez, por performance).
export function makeIsAdicional(products) {
  const prods = Array.isArray(products) ? products : [];
  const adicNomes = prods.reduce((acc, p) => {
    const cats = Array.isArray(p.categories) ? p.categories : p.category ? [p.category] : [];
    if (!cats.some(c => _CATS_ADIC.has(String(c).toLowerCase().trim()))) return acc;
    const nome = _normAd(p.name || '');
    if (nome && !_EXC_MONT.some(t => nome.includes(_normAd(t)))) acc.push(nome);
    return acc;
  }, []);
  return function isItemAdicional(item) {
    const nomeItem = _normAd(item.name || item.productName || '');
    if (_EXC_MONT.some(t => nomeItem.includes(_normAd(t)))) return false; // pétala conta
    const cats = Array.isArray(item.categories) ? item.categories : item.category ? [item.category] : [];
    if (cats.some(c => _CATS_ADIC.has(String(c).toLowerCase().trim()))) return true;
    const pid = String(item.product || item.productId || '').split(':')[0];
    let prod = pid ? prods.find(p => String(p._id || p.id || '') === pid) : null;
    if (!prod && nomeItem) prod = prods.find(p => _normAd(p.name || '') === nomeItem);
    const nomeProd = prod ? _normAd(prod.name || '') : '';
    if (nomeProd && _EXC_MONT.some(t => nomeProd.includes(_normAd(t)))) return false;
    if (prod) {
      const pCats = Array.isArray(prod.categories) ? prod.categories : prod.category ? [prod.category] : [];
      if (pCats.some(c => _CATS_ADIC.has(String(c).toLowerCase().trim()))) return true;
    }
    if (_temBaseAd(nomeItem, nomeProd)) return false; // arranjo montado → conta
    for (const an of adicNomes) {
      if (!an || an.length < 5) continue;
      if (nomeItem && (nomeItem.includes(an) || (nomeItem.length >= 5 && an.includes(nomeItem)))) return true;
      if (nomeProd && (nomeProd.includes(an) || (nomeProd.length >= 5 && an.includes(nomeProd)))) return true;
    }
    if (_adicPorNomeAd(nomeItem, nomeProd)) return true;
    return false;
  };
}

// FUNÇÃO PRINCIPAL — calcula stats da colab dentro de um período.
// `inPeriod` é função (dataRef) => boolean. Use `makeInPeriod` pra criar.
// Se nada for passado, usa "tudo".
export function calcColabStats(colab, inPeriod, ordersOverride) {
  const stats = {
    vendas: 0,           fatVendas: 0,
    montagens: 0,        // soma de itens montados (qty)
    expedicoes: 0,       // pedidos expedidos
    entregas: 0,         // pedidos entregues (como driver) — INCLUI reentregas
    reentregas: 0,       // tentativas que falharam (subconjunto de entregas)
    comissaoReentrega: 0,// R$ das reentregas (taxa digitada caso a caso)
    // comissões (R$) — calculadas se colab tem metas configuradas
    comissaoVenda: 0,
    comissaoMontagem: 0,
    comissaoExpedicao: 0,
    comissaoEntrega: 0,  // R$/entrega × entregas (entregadores)
    comissaoTotal: 0,
  };
  if (!colab) return stats;
  const pctV = Number(colab.metas?.comissaoVenda ?? colab.metas?.vendaPct ?? 0) || 0;
  const vM   = Number(colab.metas?.comissaoMontagem  ?? 0) || 0;
  const vE   = Number(colab.metas?.comissaoExpedicao ?? 0) || 0;
  const vEnt = Number(colab.metas?.valorEntrega ?? 0) || 0;
  const accept = typeof inPeriod === 'function' ? inPeriod : () => true;

  // Fonte de pedidos: usa a lista passada (ex: Meu Painel passa seu
  // historico) ou, por padrao, o S.orders global (RH/Relatorios). As
  // REGRAS sao identicas — so muda de onde vem a lista. Marcia (28/jun/2026).
  const orders   = (Array.isArray(ordersOverride) && ordersOverride.length)
    ? ordersOverride
    : (Array.isArray(S.orders) ? S.orders : []);
  const products = Array.isArray(S.products) ? S.products : [];

  // Detecção de adicional — FONTE ÚNICA (makeIsAdicional, no topo do módulo,
  // também usada por metas.js). Não conta adicional como montagem em nenhuma
  // superfície (RH/Relatórios/Meu Painel/Produção/Expedição/Financeiro/Metas).
  const _isItemAdicional = makeIsAdicional(products);

  for (const o of orders) {
    if (!o) continue;
    // Cancelado NUNCA conta — nem vendas, nem comissão.
    if (o.status === 'Cancelado') continue;
    const dataRef = o.createdAt || o.scheduledDate;
    // Venda/montagem/expedição são atribuídas pela criação; ENTREGA pela data
    // REAL da entrega (deliveredAt) — senão a entrega cai no dia errado
    // (ex.: pedido agendado 06/08 aparecia como entrega de 06/08).
    const noPeriodo = accept(dataRef);
    // ENTREGA: deliveredAt real → data agendada (Manaus) → createdAt. NUNCA
    // updatedAt (jogava a entrega no dia de edição). Regra única: dataEntregaRef.
    const noPeriodoEntrega = accept(dataEntregaRef(o));
    if (!noPeriodo && !noPeriodoEntrega) continue;
    // Entrega com DIA (Manaus) no futuro não conta — cobre deliveredAt futuro
    // (artefato) E data agendada futura (pedido marcado entregue antes da hora).
    const _entregaFutura = entregaFutura(o);

    // Conta apenas itens NÃO adicionais para comissão de montagem.
    // Se todos os itens forem adicionais (caso raro), itemsQty fica 0
    // e nenhuma comissão de montagem é gerada.
    const itemsQty = (o.items || []).reduce(
      (s, i) => _isItemAdicional(i) ? s : s + (Number(i.qty) || 1),
      0,
    );

    const st = String(o.status || '').toLowerCase();

    // ── VENDAS — pagamento aprovado + colab é o vendedor
    if (noPeriodo && PG_APROV.has(String(o.paymentStatus || ''))) {
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
    if (noPeriodo && ['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) {
      if (isMineForColab(colab, o.montadorId, o.montadorEmail, o.montadorNome)) {
        stats.montagens += itemsQty;
        stats.comissaoMontagem += vM * itemsQty;
      }
    }

    // ── EXPEDIÇÃO — status Entregue + colab é o EXPEDIDOR (não driver).
    // Retirada/balcão NÃO conta como expedição (não há despacho pra entrega).
    const _ehRetiradaExp = /retir|balc/.test(String(o.type || o.tipo || '').toLowerCase());
    if (noPeriodo && st.includes('entregue') && !_ehRetiradaExp) {
      if (isMineForColab(colab, o.expedidorId, o.expedidorEmail, o.expedidorNome)) {
        stats.expedicoes += 1;
        stats.comissaoExpedicao += vE;
      }
    }

    // ── ENTREGA — status Entregue + colab é o driver REAL (não só atribuído).
    // assignedDriverName só conta quando NÃO há entregador real — senão pedido
    // atribuído (ou entregue por outro) creditava/duplicava indevidamente.
    if (noPeriodoEntrega && !_entregaFutura && st.includes('entregue')) {
      const _temDriverReal = !!(o.driverColabId || o.driverBackendId || o.driverEmail || o.driverName);
      const _ehDriver = isMineForColab(colab, o.driverColabId, o.driverBackendId, o.driverEmail, o.driverName)
        || (!_temDriverReal && isMineForColab(colab, o.assignedDriverName));
      if (_ehDriver) stats.entregas += 1;
    }

    // ── REENTREGA — cada tentativa que FALHOU rende 1 taxa pro entregador
    // que tentou. O entregador final ganha a dele no bloco ENTREGA acima
    // quando o pedido fica Entregue. Ex: 1 reentrega = 1 taxa pro 1º + 1
    // taxa pro 2º (que pode ser o mesmo). Marcia (20/jun/2026).
    if (noPeriodoEntrega && !_entregaFutura && Array.isArray(o.reentregas) && o.reentregas.length) {
      for (const re of o.reentregas) {
        if (!re) continue;
        if (isMineForColab(colab, re.driverColabId, re.driverBackendId, re.driverEmail, re.driverName, re.driverId)) {
          stats.entregas   += 1;
          stats.reentregas += 1;
          // Marcia (jul/2026): a taxa da reentrega e DIGITADA no modal
          // (os valores variam caso a caso). Registros antigos sem valor
          // gravado caem no valor padrao por entrega da colaboradora.
          const _t = Number(re.taxa);
          stats.comissaoReentrega += (Number.isFinite(_t) && _t > 0) ? _t : vEnt;
        }
      }
    }
  }

  // Comissao de ENTREGA (entregadores) = R$/entrega × entregas (inclui
  // reentregas, ja somadas em stats.entregas). Antes ficava de fora do
  // comissaoTotal, fazendo o RH divergir do relatorio de usuarios (que
  // mostra valorEntrega × entregas). Marcia (jun/2026).
  // Entregas normais pagam o valor padrao da colaboradora; as REENTREGAS
  // pagam a taxa digitada em cada ocorrencia (ja acumulada acima).
  stats.comissaoEntrega = vEnt * Math.max(0, stats.entregas - stats.reentregas)
                        + stats.comissaoReentrega;
  stats.comissaoTotal = stats.comissaoVenda + stats.comissaoMontagem
                      + stats.comissaoExpedicao + stats.comissaoEntrega;
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
