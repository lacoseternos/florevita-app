// ── ESTOQUE: FONTE ÚNICA DE VERDADE ──────────────────────────
// Marcia (jul/2026): antes cada tela calculava estoque de um jeito —
// a lista de Produtos lia `p.stock`, a tela de Estoque somava
// `stockByUnit`, o filtro "estoque baixo" fazia `estoque + stock`
// (dobrando o valor) e os alertas usavam uma quarta fórmula. Resultado:
// as telas mostravam números diferentes pro mesmo produto.
//
// REGRA: `stockByUnit` é a verdade. `estoque` e `stock` são espelhos da
// soma, mantidos só por compatibilidade com telas antigas.

export const STOCK_UNITS = ['CDLE', 'Loja Novo Aleixo'];

export const UNIT_LABEL = {
  'CDLE': 'CDLE',
  'Loja Novo Aleixo': 'Novo Aleixo',
};

// Saldo por unidade, normalizado (sempre com todas as chaves).
// Produto legado sem stockByUnit: joga o total conhecido no CDLE.
export function getStockByUnit(p) {
  const sbu = (p && p.stockByUnit && typeof p.stockByUnit === 'object') ? { ...p.stockByUnit } : {};
  STOCK_UNITS.forEach(u => { sbu[u] = Number(sbu[u]) || 0; });
  const soma = STOCK_UNITS.reduce((s, u) => s + sbu[u], 0);
  if (soma === 0) {
    const legado = Number(p?.stock) || Number(p?.estoque) || 0;
    if (legado > 0) sbu['CDLE'] = legado;
  }
  return sbu;
}

// Total do produto = SOMA das unidades. Use sempre esta função em vez de
// `p.stock` / `p.estoque` (que podem estar defasados).
export function getStockTotal(p) {
  const sbu = getStockByUnit(p);
  return STOCK_UNITS.reduce((s, u) => s + (Number(sbu[u]) || 0), 0);
}

// Saldo de UMA unidade específica.
export function getStockUnit(p, unit) {
  return Number(getStockByUnit(p)[unit]) || 0;
}

// Mínimo configurado do produto (aceita os dois nomes de campo).
export function getMinStock(p) {
  const m = Number(p?.minStock ?? p?.estoqueMinimo);
  return Number.isFinite(m) && m > 0 ? m : 5;
}

// Está baixo no TOTAL?
export function isLowStock(p) {
  return getStockTotal(p) <= getMinStock(p);
}

// Está zerado em ALGUMA unidade (mesmo tendo saldo na outra)? Serve pra
// alertar "acabou no Novo Aleixo" mesmo com estoque sobrando no CDLE.
export function unidadesZeradas(p) {
  const sbu = getStockByUnit(p);
  return STOCK_UNITS.filter(u => (Number(sbu[u]) || 0) <= 0);
}

// Monta o payload coerente pra gravar no backend. SEMPRE use isto ao
// salvar estoque — o hook do Mongoose que recalcularia o total NÃO roda
// em findByIdAndUpdate, então o total precisa ir pronto e correto.
export function buildStockPayload(sbu) {
  const limpo = {};
  STOCK_UNITS.forEach(u => { limpo[u] = Math.max(0, Number(sbu?.[u]) || 0); });
  const total = STOCK_UNITS.reduce((s, u) => s + limpo[u], 0);
  return { stockByUnit: limpo, estoque: total, stock: total };
}
