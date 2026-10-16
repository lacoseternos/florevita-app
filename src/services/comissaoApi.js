// ── COMISSÃO — leitura da FUNÇÃO ÚNICA do backend (Marcia out/2026) ──────
// Toda tela que mostra comissão pega o valor daqui (GET /comissoes/periodo),
// nunca calcula no navegador. Valores em CENTAVOS. Cache curto por período;
// enquanto carrega devolve o último valor conhecido (ou null) e re-renderiza
// quando chegar.
import { GET } from './api.js';
import { getPeriodRange } from '../utils/colabStats.js';

const _cache = new Map(); // 'from|to' → { at, carregando, lista, erro }

export const ymdLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Mesmo período do getPeriodRange (dia/semana/mes/mes_ant…), em datas.
export function periodoYmd(per) {
  const { start, end } = getPeriodRange(per);
  const hoje = ymdLocal(new Date());
  const from = start.getTime() <= 0 ? '2025-01-01' : ymdLocal(start);
  const to = end.getTime() > Date.now() + 86400000 * 365 ? hoje : (ymdLocal(end) > hoje ? hoje : ymdLocal(end));
  return [from < '2025-01-01' ? '2025-01-01' : from, to];
}

// opts.colabId: só uma pessoa; opts.detalhe: traz as linhas pedido a pedido.
export function comissoesDoPeriodo(from, to, opts = {}) {
  const colabId = opts.colabId ? String(opts.colabId) : '';
  const detalhe = !!opts.detalhe;
  const k = [from, to, colabId, detalhe ? 1 : 0].join('|');
  const c = _cache.get(k);
  if (c && (c.carregando || Date.now() - c.at < 60_000)) return c;
  const novo = { at: Date.now(), carregando: true, lista: c?.lista || null, erro: null };
  _cache.set(k, novo);
  const q = new URLSearchParams({ from, to });
  if (colabId) q.set('colabId', colabId);
  if (detalhe) q.set('detalhe', '1');
  GET('/comissoes/periodo?' + q.toString())
    .then(r => { novo.lista = r?.colaboradores || []; })
    .catch(e => { novo.erro = e.message || 'Erro ao carregar comissões'; })
    .finally(() => {
      novo.carregando = false; novo.at = Date.now();
      import('../main.js').then(m => m.render()).catch(() => {});
    });
  return novo;
}

// Item do backend → o formato antigo de stats (reais) usado pelas telas.
export function statsDeItem(it) {
  const z = { vendas: 0, fatVendas: 0, comissaoVenda: 0, montagens: 0, comissaoMontagem: 0, expedicoes: 0,
    comissaoExpedicao: 0, entregas: 0, comissaoEntrega: 0, comissaoTotal: 0, comissao: 0 };
  if (!it) return z;
  const t = it.porTipo, R = (c) => c / 100;
  return {
    vendas: t.venda.qtd, fatVendas: R(t.venda.base), comissaoVenda: R(t.venda.comissao),
    montagens: t.montagem.qtd, comissaoMontagem: R(t.montagem.comissao),
    expedicoes: t.expedicao.qtd, comissaoExpedicao: R(t.expedicao.comissao),
    entregas: t.entrega.qtd + t.reentrega.qtd, comissaoEntrega: R(t.entrega.comissao + t.reentrega.comissao),
    comissaoTotal: R(it.total), comissao: R(it.total),
  };
}

// Id da colab que o backend reconhece (Mongo _id / backendId / id).
export const idBackend = (colab) => String(colab?.backendId || colab?._id || colab?.id || '');

// Item da colab na lista do backend (por id; nome como último recurso).
export function daColab(lista, colab) {
  if (!Array.isArray(lista) || !colab) return null;
  const ids = [colab._id, colab.id, colab.backendId].filter(Boolean).map(String);
  return lista.find(l => ids.includes(l.colabId))
    || lista.find(l => String(l.nome || '').toLowerCase() === String(colab.name || colab.nome || '').toLowerCase())
    || null;
}

// Comissão total (R$) da colab no período `per`, ou null enquanto carrega.
export function comissaoTotalReais(colab, per = 'mes') {
  const [from, to] = periodoYmd(per);
  const r = comissoesDoPeriodo(from, to);
  const it = daColab(r.lista, colab);
  if (!r.lista) return null;
  return it ? it.total / 100 : 0;
}

// Contagens + comissão da colab no período (shape usado pelos cards de
// Colaboradores, Financeiro, Produção e Expedição). Reais.
export function statsColab(colab, per = 'mes') {
  const vazio = { vendas: 0, comissao: 0, comissaoVenda: 0, comissaoMontagem: 0, comissaoExpedicao: 0, comissaoEntrega: 0,
    montagens: 0, expedicoes: 0, fatVendas: 0, entregas: 0, carregando: false };
  if (!colab) return vazio;
  const [from, to] = periodoYmd(per);
  const r = comissoesDoPeriodo(from, to);
  const it = daColab(r.lista, colab);
  if (!it) return { ...vazio, carregando: !r.lista };
  const t = it.porTipo, R = (c) => c / 100;
  return {
    vendas: t.venda.qtd, fatVendas: R(t.venda.base),
    montagens: t.montagem.qtd, expedicoes: t.expedicao.qtd,
    entregas: t.entrega.qtd + t.reentrega.qtd,
    comissaoVenda: R(t.venda.comissao), comissaoMontagem: R(t.montagem.comissao),
    comissaoExpedicao: R(t.expedicao.comissao), comissaoEntrega: R(t.entrega.comissao + t.reentrega.comissao),
    comissao: R(it.total), carregando: false,
  };
}
