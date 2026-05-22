#!/usr/bin/env node
/**
 * SMOKE TEST — Florevita
 * Verifica saúde do site + backend em poucos segundos.
 *
 * Uso:
 *   node scripts/health-check.js
 *
 * Sai com código 0 se tudo OK, 1 se algo falhou.
 * Imprime relatório limpo no terminal.
 */
const BACKEND = 'https://florevita-backend-2-0.onrender.com/api';
const SITE = 'https://floriculturalacoseternos.com.br';

const PROBES = [
  {
    nome: 'Backend /health',
    fn: async () => {
      const r = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return 'OK';
    },
  },
  {
    nome: 'Backend /public/products (>=1 produto)',
    fn: async () => {
      const r = await fetch(`${BACKEND}/public/products?limit=200`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const arr = await r.json();
      if (!Array.isArray(arr)) throw new Error('Resposta não é array');
      if (arr.length === 0) throw new Error('ZERO produtos retornados — site vai aparecer vazio!');
      return `${arr.length} produtos`;
    },
  },
  {
    nome: 'Backend /settings/public/ecommerce',
    fn: async () => {
      const r = await fetch(`${BACKEND}/settings/public/ecommerce`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cfg = await r.json();
      if (!cfg || typeof cfg !== 'object') throw new Error('Config inválida');
      if (!cfg.acceptingOrders) throw new Error('⚠️ acceptingOrders=false — site não aceita pedidos!');
      return `mode=${cfg.mode || '?'}, accepting=${cfg.acceptingOrders}`;
    },
  },
  {
    nome: 'Site / (home retorna HTML)',
    fn: async () => {
      const r = await fetch(SITE, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      if (html.length < 5000) throw new Error(`HTML muito curto (${html.length} bytes)`);
      const prods = html.match(/produto\/[a-f0-9]{24}/g);
      if (!prods || prods.length === 0) throw new Error('Home sem produtos linkados — visual vazio!');
      return `${new Set(prods).size} produtos linkados`;
    },
  },
  {
    nome: 'Site /produtos (lista populada)',
    fn: async () => {
      const r = await fetch(`${SITE}/produtos`, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const prods = html.match(/produto\/[a-f0-9]{24}/g);
      if (!prods || prods.length === 0) throw new Error('Lista de produtos VAZIA!');
      return `${new Set(prods).size} produtos`;
    },
  },
  {
    nome: 'Site /lojas',
    fn: async () => {
      const r = await fetch(`${SITE}/lojas`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return 'OK';
    },
  },
  {
    nome: 'Site /checkout',
    fn: async () => {
      const r = await fetch(`${SITE}/checkout`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return 'OK';
    },
  },
];

const COR = {
  ok: '\x1b[32m', erro: '\x1b[31m', amarelo: '\x1b[33m',
  bold: '\x1b[1m', reset: '\x1b[0m', dim: '\x1b[2m',
};

(async () => {
  const inicio = Date.now();
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Manaus' });
  console.log(`\n${COR.bold}🌹 FLOREVITA HEALTH CHECK${COR.reset} ${COR.dim}— ${hora}${COR.reset}\n`);
  let falhas = 0;
  const resultados = [];
  for (const probe of PROBES) {
    process.stdout.write(`  ${probe.nome.padEnd(50)} `);
    const t0 = Date.now();
    try {
      const detalhe = await probe.fn();
      const ms = Date.now() - t0;
      console.log(`${COR.ok}✓${COR.reset} ${detalhe} ${COR.dim}(${ms}ms)${COR.reset}`);
      resultados.push({ probe: probe.nome, ok: true, detalhe, ms });
    } catch (e) {
      falhas++;
      const ms = Date.now() - t0;
      console.log(`${COR.erro}✗ ${e.message}${COR.reset} ${COR.dim}(${ms}ms)${COR.reset}`);
      resultados.push({ probe: probe.nome, ok: false, erro: e.message, ms });
    }
  }
  const tot = Date.now() - inicio;
  console.log('');
  if (falhas === 0) {
    console.log(`${COR.bold}${COR.ok}✓ Tudo OK${COR.reset} — ${PROBES.length} testes em ${tot}ms\n`);
    process.exit(0);
  } else {
    console.log(`${COR.bold}${COR.erro}✗ ${falhas} falha(s) de ${PROBES.length} testes${COR.reset} em ${tot}ms\n`);
    process.exit(1);
  }
})().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(2);
});
