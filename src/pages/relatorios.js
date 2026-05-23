import { S } from '../state.js';
import { $c, $d, sc, rolec, ini, segc, esc, fmtOrderNum } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';
import { ZONAS_MANAUS, resolveZona, getTurnoPedido, TURNOS } from '../utils/zonasManaus.js';

// ─────────────────────────────────────────────────────────────
// RECIBO/RELATORIO DE FECHAMENTO DE CAIXA (print-friendly)
// Chamado pelo botao "🖨️ Gerar Recibo" na aba Caixa do relatorio.
// Abre nova janela com layout otimizado para impressao em A4.
// ─────────────────────────────────────────────────────────────
export function gerarReciboCaixa({ id, date, unit } = {}) {
  const all = (S._relCaixaRegs || []);
  // Match por _id ou (date+unit) — registros antigos podem nao ter _id consistente
  const reg = all.find(r => String(r._id||r.id||'') === String(id||'')) ||
              all.find(r => r.date === date && r.unit === unit);
  if (!reg) { toast('❌ Registro de caixa não encontrado'); return; }

  // Cross-ref orders pra detalhamento de pagto
  const PAGOS = ['Pago','Aprovado','Pago na Entrega'];
  const orders = (S.orders||[]).filter(o => {
    if (o.status === 'Cancelado') return false;
    if (!PAGOS.includes(o.paymentStatus)) return false;
    const d = String(o.createdAt||'').slice(0,10);
    const u = o.unit || o.saleUnit || '';
    return d === reg.date && u === reg.unit;
  });
  const porPagto = {};
  let totalVendas = 0;
  orders.forEach(o => {
    const pg = o.payment || o.paymentMethod || '—';
    if (!porPagto[pg]) porPagto[pg] = { qty:0, total:0 };
    porPagto[pg].qty++;
    porPagto[pg].total += (o.total||0);
    totalVendas += (o.total||0);
  });

  const sangrias = (reg.movimentos||[]).filter(m=>m.tipo==='Sangria');
  const suprimentos = (reg.movimentos||[]).filter(m=>m.tipo==='Suprimento');
  const totSang = sangrias.reduce((a,b)=>a+(b.valor||0),0);
  const totSupr = suprimentos.reduce((a,b)=>a+(b.valor||0),0);
  const saldoFundo = reg.abertura?.saldo || 0;
  const fechado = !!reg.fechamento;
  const dif = reg.fechamento?.diferenca || 0;
  const [yy,mm,dd] = String(reg.date||'').split('-');
  const dataBr = `${dd}/${mm}/${yy}`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Recibo Caixa ${reg.unit||''} — ${dataBr}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;}
  body{padding:24px;background:#fff;color:#111;max-width:760px;margin:0 auto;}
  h1{font-family:Georgia,serif;font-size:24px;margin:0 0 4px;color:#9D174D;}
  .sub{color:#555;font-size:13px;margin-bottom:18px;}
  .box{border:1px solid #ccc;border-radius:8px;padding:14px 16px;margin-bottom:14px;}
  .row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px dashed #ddd;}
  .row:last-child{border-bottom:none;}
  .row strong{color:#111;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eee;}
  th{background:#FDF2F8;color:#9D174D;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
  .grand{background:#FAFAFA;font-weight:800;}
  .lbl{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;}
  .val{font-size:18px;font-weight:800;color:#111;}
  .ok{color:#15803D;} .red{color:#991B1B;} .blue{color:#1E40AF;} .gold{color:#92400E;}
  .footer{margin-top:24px;padding-top:14px;border-top:2px solid #9D174D;font-size:11px;color:#555;text-align:center;}
  @media print{ body{padding:12px;} .no-print{display:none!important;} .box{break-inside:avoid;} }
  .btnp{background:#9D174D;color:#fff;padding:10px 22px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;}
</style></head>
<body>
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
    <button class="btnp" onclick="window.print()">🖨️ Imprimir</button>
    <button class="btnp" style="background:#6B7280;" onclick="window.close()">✕ Fechar</button>
  </div>
  <h1>🌹 Floricultura Laços Eternos</h1>
  <div class="sub">Recibo / Relatório de Fechamento de Caixa</div>

  <div class="box">
    <div class="row"><span class="lbl">Loja</span><strong>${esc(reg.unit||'—')}</strong></div>
    <div class="row"><span class="lbl">Data</span><strong>${dataBr}</strong></div>
    <div class="row"><span class="lbl">Status</span><strong class="${fechado?'ok':'gold'}">${fechado?'🔒 Encerrado':'🟢 Em aberto'}</strong></div>
    <div class="row"><span class="lbl">Abertura</span><strong>${esc(reg.abertura?.usuario||'—')} às ${esc(reg.abertura?.hora||'—')}</strong></div>
    ${fechado?`<div class="row"><span class="lbl">Fechamento</span><strong>${esc(reg.fechamento.usuario||'—')} às ${esc(reg.fechamento.hora||'—')}</strong></div>`:''}
    <div class="row"><span class="lbl">Total de pedidos</span><strong>${orders.length}</strong></div>
  </div>

  <div class="box">
    <div class="lbl" style="margin-bottom:8px;">💳 Detalhamento por Forma de Pagamento</div>
    ${Object.keys(porPagto).length===0?`<div style="font-size:12px;color:#888;font-style:italic;">Nenhum pedido pago neste dia.</div>`:`
    <table>
      <thead><tr><th>Forma</th><th>Qtd</th><th>Total</th><th>% do dia</th></tr></thead>
      <tbody>
        ${Object.entries(porPagto).sort((a,b)=>b[1].total-a[1].total).map(([k,v])=>`
          <tr><td>${esc(k)}</td><td>${v.qty}</td><td class="ok"><strong>${$c(v.total)}</strong></td><td>${totalVendas>0?Math.round(v.total/totalVendas*100):0}%</td></tr>
        `).join('')}
        <tr class="grand"><td>TOTAL</td><td>${orders.length}</td><td class="ok">${$c(totalVendas)}</td><td>100%</td></tr>
      </tbody>
    </table>`}
  </div>

  ${(sangrias.length||suprimentos.length)?`
  <div class="box">
    <div class="lbl" style="margin-bottom:8px;">📤 Sangrias e 📥 Suprimentos</div>
    <table>
      <thead><tr><th>Tipo</th><th>Hora</th><th>Operadora</th><th>Motivo</th><th>Valor</th></tr></thead>
      <tbody>
        ${sangrias.map(m=>`<tr><td class="red">📤 Sangria</td><td>${esc(m.hora||'—')}</td><td>${esc(m.usuario||'—')}</td><td>${esc(m.motivo||'—')}</td><td class="red"><strong>− ${$c(m.valor||0)}</strong></td></tr>`).join('')}
        ${suprimentos.map(m=>`<tr><td class="blue">📥 Suprimento</td><td>${esc(m.hora||'—')}</td><td>${esc(m.usuario||'—')}</td><td>${esc(m.motivo||'—')}</td><td class="blue"><strong>+ ${$c(m.valor||0)}</strong></td></tr>`).join('')}
      </tbody>
    </table>
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;">
      <span>Total sangrias: <strong class="red">${$c(totSang)}</strong></span>
      <span>Total suprimentos: <strong class="blue">${$c(totSupr)}</strong></span>
    </div>
  </div>`:''}

  ${fechado?`
  <div class="box" style="background:#FDF2F8;">
    <div class="lbl" style="margin-bottom:10px;">📊 Conferência Final</div>
    <div class="row"><span>Fundo de abertura</span><strong>${$c(saldoFundo)}</strong></div>
    <div class="row"><span>Vendas totais</span><strong class="ok">+ ${$c(totalVendas)}</strong></div>
    <div class="row"><span>Sangrias</span><strong class="red">− ${$c(totSang)}</strong></div>
    <div class="row"><span>Suprimentos</span><strong class="blue">+ ${$c(totSupr)}</strong></div>
    <div class="row" style="font-size:15px;padding-top:8px;border-top:2px solid #9D174D;"><span><strong>Saldo esperado</strong></span><strong>${$c(reg.fechamento.saldoEsperado||0)}</strong></div>
    <div class="row" style="font-size:15px;"><span><strong>Saldo contado (físico)</strong></span><strong>${$c(reg.fechamento.saldoFinal||0)}</strong></div>
    <div class="row" style="font-size:16px;background:${Math.abs(dif)<0.01?'#DCFCE7':(dif<0?'#FEE2E2':'#FEF3C7')};padding:8px;border-radius:6px;margin-top:6px;border:none;">
      <span><strong>Diferença</strong></span>
      <strong style="color:${Math.abs(dif)<0.01?'#15803D':(dif<0?'#991B1B':'#92400E')};">${dif>=0?'+':''}${$c(dif)}</strong>
    </div>
  </div>`:''}

  ${(reg.observacoes||reg.notes)?`
  <div class="box" style="background:#FFFBEB;">
    <div class="lbl" style="margin-bottom:6px;">📝 Observações</div>
    <div style="font-size:13px;">${esc(reg.observacoes||reg.notes||'')}</div>
  </div>`:''}

  <div class="box">
    <div class="lbl" style="margin-bottom:6px;">✍️ Assinaturas</div>
    <div style="display:flex;gap:30px;margin-top:30px;">
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;">
        Quem abriu o caixa<br/><strong>${esc(reg.abertura?.usuario||'')}</strong>
      </div>
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;">
        Quem fechou o caixa<br/><strong>${esc(reg.fechamento?.usuario||'(em aberto)')}</strong>
      </div>
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;">
        Conferido por (gerência)<br/>&nbsp;
      </div>
    </div>
  </div>

  <div class="footer">
    Gerado em ${new Date().toLocaleString('pt-BR',{timeZone:'America/Manaus'})} · Florevita Sistema · Documento auditável
  </div>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast('❌ Permita pop-ups para gerar o recibo', true); return; }
  w.document.write(html);
  w.document.close();
}

// ─────────────────────────────────────────────────────────────
// RECIBO/RELATORIO DETALHADO POR PERIODO (semana/mes/custom)
// Layout proximo ao gerarReciboCaixa, mas consolidado pra um
// intervalo de datas. ADAPTATIVO POR ABA — chame com tab:
//   'geral'           → relatorio completo (vendas, produtos, canais, equipe)
//   'usuarios'        → so vendedores/montadores/expedidores
//   'produtos'        → so produtos vendidos
//   'caixa'           → so financeiro/pagamentos
//   'montagens'       → so montadores
//   'entregadores'    → so entregadores
//   'clientes'        → so top clientes
//   (qualquer outro)  → fallback geral
// ─────────────────────────────────────────────────────────────

// Helper: identifica canal de venda padronizado
function _canalDeVenda(o) {
  const src = String(o.source||'').toLowerCase();
  const tipo = String(o.type||o.tipo||'').toLowerCase();
  if (src.includes('ifood')) return { key:'ifood', label:'🍔 iFood' };
  if (src.includes('ecomm') || src.includes('e-comm') || src === 'site') return { key:'site', label:'🌐 E-commerce (site)' };
  if (tipo.includes('balc') || src.includes('balc')) return { key:'balcao', label:'🏪 Balcão' };
  if (src.includes('whatsapp')) return { key:'whatsapp', label:'📱 WhatsApp' };
  // PDV/Online/vazio → WhatsApp+PDV (canal padrao)
  return { key:'pdv', label:'📱 WhatsApp/PDV' };
}

export function gerarReciboPeriodo({ from, to, unit, label, tab } = {}) {
  if (!from || !to) { toast('❌ Datas inválidas pro relatório'); return; }
  const _PG_OK = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega','Recebido']);
  // Date helpers
  const _toDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : String(s||'').slice(0,10);
  const _br = (s) => { const [y,m,d] = String(s).split('-'); return d&&m&&y ? `${d}/${m}/${y}` : s; };
  const dateIn = (d) => { const ds = _toDate(d); return ds >= from && ds <= to; };

  const allBase = (S.orders||[]).filter(o => {
    if (!o || !o.createdAt) return false;
    if (!dateIn(o.createdAt)) return false;
    if (unit) {
      if (unit === 'E-commerce') {
        if (!(o.source === 'E-commerce' || String(o.source||'').toLowerCase().includes('ecomm'))) return false;
      } else if (o.unit !== unit && o.saleUnit !== unit) return false;
    }
    return true;
  });
  const validos = allBase.filter(o => o.status !== 'Cancelado' && _PG_OK.has(String(o.paymentStatus||'')));
  const cancelados = allBase.filter(o => o.status === 'Cancelado');
  const entregues = allBase.filter(o => o.status === 'Entregue');

  const fat = validos.reduce((s,o)=>s+(o.total||0),0);
  const ticket = validos.length ? fat / validos.length : 0;
  const totalDesc = validos.reduce((s,o)=>s+(Number(o.discount)||0),0);
  const totalAcre = validos.reduce((s,o)=>s+(Number(o.surcharge)||0),0);
  const totalTaxa = validos.reduce((s,o)=>s+(Number(o.deliveryFee)||0),0);

  // Por forma de pagamento
  const porPagto = {};
  validos.forEach(o => {
    const pg = o.payment || o.paymentMethod || '—';
    if (!porPagto[pg]) porPagto[pg] = { qty:0, total:0 };
    porPagto[pg].qty++;
    porPagto[pg].total += (o.total||0);
  });

  // Por dia (timeline)
  const porDia = {};
  validos.forEach(o => {
    const d = _toDate(o.createdAt);
    if (!porDia[d]) porDia[d] = { qty:0, total:0 };
    porDia[d].qty++;
    porDia[d].total += (o.total||0);
  });
  const diasOrd = Object.keys(porDia).sort();

  // Por unidade (so se nao filtrado)
  const porUnit = {};
  validos.forEach(o => {
    const u = (o.source === 'E-commerce' || String(o.source||'').toLowerCase().includes('ecomm'))
      ? 'E-commerce' : (o.unit || o.saleUnit || '—');
    if (!porUnit[u]) porUnit[u] = { qty:0, total:0 };
    porUnit[u].qty++;
    porUnit[u].total += (o.total||0);
  });

  // Produtos mais vendidos
  const byProd = {};
  validos.forEach(o => (o.items||[]).forEach(i => {
    const n = i.name || '—';
    if (!byProd[n]) byProd[n] = { qty:0, rev:0 };
    byProd[n].qty += (i.qty||1);
    byProd[n].rev += (Number(i.totalPrice)||(Number(i.unitPrice||i.price||0)*Number(i.qty||1)));
  }));
  const topProd = Object.entries(byProd).sort((a,b)=>b[1].rev-a[1].rev).slice(0,15);

  // Vendedores
  const byVend = {};
  validos.forEach(o => {
    const v = o.vendedorNome || o.createdByName || o.vendedor || '—';
    if (!byVend[v]) byVend[v] = { qty:0, total:0 };
    byVend[v].qty++;
    byVend[v].total += (o.total||0);
  });
  const topVend = Object.entries(byVend).sort((a,b)=>b[1].total-a[1].total);

  // Montadores
  const byMontador = {};
  validos.forEach(o => {
    if (!o.montadorNome && !o.montadoEm) return;
    const m = o.montadorNome || '—';
    if (!byMontador[m]) byMontador[m] = { qty:0 };
    byMontador[m].qty++;
  });
  const topMontador = Object.entries(byMontador).sort((a,b)=>b[1].qty-a[1].qty);

  // Expedidores
  const byExped = {};
  validos.forEach(o => {
    if (!o.expedidorNome && !o.expedidoEm) return;
    const e = o.expedidorNome || '—';
    if (!byExped[e]) byExped[e] = { qty:0 };
    byExped[e].qty++;
  });
  const topExped = Object.entries(byExped).sort((a,b)=>b[1].qty-a[1].qty);

  // Entregadores
  const byDriver = {};
  entregues.forEach(o => {
    const d = o.driverName || '—';
    if (!byDriver[d]) byDriver[d] = { qty:0, total:0 };
    byDriver[d].qty++;
    byDriver[d].total += (Number(o.assignedDeliveryFee)||Number(o.deliveryFee)||0);
  });
  const topDriver = Object.entries(byDriver).sort((a,b)=>b[1].qty-a[1].qty);

  // Tipo
  const porTipo = { Delivery:{qty:0,total:0}, Retirada:{qty:0,total:0}, Balcao:{qty:0,total:0} };
  validos.forEach(o => {
    const t = String(o.type||o.tipo||'').toLowerCase();
    if (t.includes('retir')) { porTipo.Retirada.qty++; porTipo.Retirada.total += (o.total||0); }
    else if (t.includes('balc')) { porTipo.Balcao.qty++; porTipo.Balcao.total += (o.total||0); }
    else { porTipo.Delivery.qty++; porTipo.Delivery.total += (o.total||0); }
  });

  // Canal de venda (origem do pedido)
  const byCanal = {};
  validos.forEach(o => {
    const c = _canalDeVenda(o);
    if (!byCanal[c.label]) byCanal[c.label] = { qty:0, total:0, key:c.key };
    byCanal[c.label].qty++;
    byCanal[c.label].total += (o.total||0);
  });
  const canaisOrd = Object.entries(byCanal).sort((a,b)=>b[1].total-a[1].total);

  // Melhor e pior dia
  const diasComMov = diasOrd.filter(d => porDia[d].qty > 0);
  const melhorDia = diasComMov.length ? diasComMov.reduce((best, d) => porDia[d].total > porDia[best].total ? d : best, diasComMov[0]) : null;
  const piorDia   = diasComMov.length ? diasComMov.reduce((worst, d) => porDia[d].total < porDia[worst].total ? d : worst, diasComMov[0]) : null;

  // Top clientes
  const byCli = {};
  validos.forEach(o => {
    const k = o.clientName || o.recipient || '—';
    if (!byCli[k]) byCli[k] = { qty:0, total:0 };
    byCli[k].qty++;
    byCli[k].total += (o.total||0);
  });
  const topCli = Object.entries(byCli).sort((a,b)=>b[1].total-a[1].total).slice(0,20);

  const dataLabel = (from === to) ? _br(from) : `${_br(from)} a ${_br(to)}`;
  const unitLabel = unit || 'Todas as unidades';
  const periodLabel = label || `${from} → ${to}`;
  const tabName = tab || 'geral';

  // ── BLOCOS HTML (snippets reutilizáveis) ─────────────────────
  const blocoPagto = () => `
    <h2>💳 Por Forma de Pagamento</h2>
    <div class="box">
      ${Object.keys(porPagto).length===0?`<div class="small">Nenhum pedido.</div>`:`
      <table>
        <thead><tr><th>Forma</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Total</th><th style="text-align:right;">%</th></tr></thead>
        <tbody>
          ${Object.entries(porPagto).sort((a,b)=>b[1].total-a[1].total).map(([k,v])=>`
            <tr><td>${esc(k)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.total)}</strong></td><td style="text-align:right;">${fat>0?Math.round(v.total/fat*100):0}%</td></tr>
          `).join('')}
          <tr class="grand"><td>TOTAL</td><td style="text-align:center;">${validos.length}</td><td class="ok" style="text-align:right;">${$c(fat)}</td><td style="text-align:right;">100%</td></tr>
        </tbody>
      </table>`}
    </div>`;

  const blocoCanais = () => `
    <h2>📡 Canal de Venda</h2>
    <div class="box">
      ${canaisOrd.length===0?`<div class="small">Sem dados.</div>`:`
      <table>
        <thead><tr><th>Canal</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Total</th><th style="text-align:right;">%</th></tr></thead>
        <tbody>
          ${canaisOrd.map(([k,v])=>`
            <tr><td>${esc(k)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.total)}</strong></td><td style="text-align:right;">${fat>0?Math.round(v.total/fat*100):0}%</td></tr>
          `).join('')}
        </tbody>
      </table>`}
    </div>`;

  const blocoDias = () => `
    <h2>📅 Vendas Dia a Dia</h2>
    <div class="box">
      ${diasOrd.length===0?`<div class="small">Nenhum pedido.</div>`:`
      <table>
        <thead><tr><th>Data</th><th style="text-align:center;">Pedidos</th><th style="text-align:right;">Faturamento</th><th style="text-align:right;">Ticket médio</th></tr></thead>
        <tbody>
          ${diasOrd.map(d => {
            const r = porDia[d];
            const t = r.qty ? r.total/r.qty : 0;
            const isMelhor = d === melhorDia;
            const isPior = d === piorDia && melhorDia !== piorDia;
            const tag = isMelhor ? ' 🏆' : (isPior ? ' 📉' : '');
            const bgrow = isMelhor ? 'background:#F0FDF4;' : (isPior ? 'background:#FEF2F2;' : '');
            return `<tr style="${bgrow}"><td><strong>${_br(d)}</strong>${tag}</td><td style="text-align:center;">${r.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(r.total)}</strong></td><td style="text-align:right;">${$c(t)}</td></tr>`;
          }).join('')}
          <tr class="grand"><td>TOTAL</td><td style="text-align:center;">${validos.length}</td><td class="ok" style="text-align:right;">${$c(fat)}</td><td style="text-align:right;">${$c(ticket)}</td></tr>
        </tbody>
      </table>
      ${melhorDia ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">
        <div style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:8px;padding:10px 12px;">
          <div class="lbl" style="margin-bottom:4px;">🏆 Melhor dia</div>
          <div style="font-size:13px;font-weight:700;color:#15803D;">${_br(melhorDia)} — ${$c(porDia[melhorDia].total)} (${porDia[melhorDia].qty} pedidos)</div>
        </div>
        ${piorDia && piorDia !== melhorDia ? `
        <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:10px 12px;">
          <div class="lbl" style="margin-bottom:4px;">📉 Pior dia</div>
          <div style="font-size:13px;font-weight:700;color:#991B1B;">${_br(piorDia)} — ${$c(porDia[piorDia].total)} (${porDia[piorDia].qty} pedidos)</div>
        </div>` : ''}
      </div>` : ''}
      `}
    </div>`;

  const blocoUnidade = () => (!unit && Object.keys(porUnit).length>1) ? `
    <h2>🏪 Vendas por Unidade</h2>
    <div class="box">
      <table>
        <thead><tr><th>Unidade</th><th style="text-align:center;">Pedidos</th><th style="text-align:right;">Faturamento</th><th style="text-align:right;">%</th></tr></thead>
        <tbody>
          ${Object.entries(porUnit).sort((a,b)=>b[1].total-a[1].total).map(([k,v])=>`
            <tr><td>${esc(k)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.total)}</strong></td><td style="text-align:right;">${fat>0?Math.round(v.total/fat*100):0}%</td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>` : '';

  const blocoTipo = () => `
    <h2>📦 Tipo de Pedido</h2>
    <div class="box">
      <table>
        <thead><tr><th>Tipo</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Faturamento</th></tr></thead>
        <tbody>
          <tr><td>🚚 Delivery</td><td style="text-align:center;">${porTipo.Delivery.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(porTipo.Delivery.total)}</strong></td></tr>
          <tr><td>📦 Retirada</td><td style="text-align:center;">${porTipo.Retirada.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(porTipo.Retirada.total)}</strong></td></tr>
          <tr><td>🏪 Balcão</td><td style="text-align:center;">${porTipo.Balcao.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(porTipo.Balcao.total)}</strong></td></tr>
        </tbody>
      </table>
    </div>`;

  const blocoProdutos = (lim=15) => `
    <h2>🌹 Top ${lim} Produtos</h2>
    <div class="box">
      ${topProd.length===0?`<div class="small">Nenhum produto vendido.</div>`:`
      <table>
        <thead><tr><th>#</th><th>Produto</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Faturamento</th></tr></thead>
        <tbody>
          ${topProd.slice(0,lim).map(([n,v],i)=>`<tr><td><strong style="color:#9D174D;">${i+1}</strong></td><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.rev)}</strong></td></tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  const blocoProdutosCompleto = () => `
    <h2>🌹 Todos os Produtos Vendidos</h2>
    <div class="box">
      ${topProd.length===0?`<div class="small">Nenhum produto vendido.</div>`:`
      <table>
        <thead><tr><th>#</th><th>Produto</th><th style="text-align:center;">Qtd</th><th style="text-align:right;">Faturamento</th><th style="text-align:right;">% do período</th></tr></thead>
        <tbody>
          ${topProd.map(([n,v],i)=>`<tr><td><strong style="color:#9D174D;">${i+1}</strong></td><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.rev)}</strong></td><td style="text-align:right;">${fat>0?(v.rev/fat*100).toFixed(1):0}%</td></tr>`).join('')}
          <tr class="grand"><td colspan="2">TOTAL</td><td style="text-align:center;">${topProd.reduce((s,[,v])=>s+v.qty,0)}</td><td class="ok" style="text-align:right;">${$c(topProd.reduce((s,[,v])=>s+v.rev,0))}</td><td style="text-align:right;">—</td></tr>
        </tbody>
      </table>`}
    </div>`;

  const blocoVendedores = () => `
    <h2>👩‍💼 Vendedores</h2>
    <div class="box">
      ${topVend.length===0?`<div class="small">Sem dados de vendedores.</div>`:`
      <table>
        <thead><tr><th>Vendedor(a)</th><th style="text-align:center;">Pedidos</th><th style="text-align:right;">Faturamento</th><th style="text-align:right;">Ticket médio</th></tr></thead>
        <tbody>
          ${topVend.map(([n,v])=>`<tr><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.total)}</strong></td><td style="text-align:right;">${$c(v.qty?v.total/v.qty:0)}</td></tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  const blocoMontadores = () => `
    <h2>🌿 Montadores</h2>
    <div class="box">
      ${topMontador.length===0?`<div class="small">Sem dados de montagem nos pedidos do período.</div>`:`
      <table>
        <thead><tr><th>Montador(a)</th><th style="text-align:center;">Pedidos montados</th><th style="text-align:right;">% das montagens</th></tr></thead>
        <tbody>
          ${(() => {
            const totMont = topMontador.reduce((s,[,v])=>s+v.qty,0);
            return topMontador.map(([n,v])=>`<tr><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td style="text-align:right;">${totMont>0?Math.round(v.qty/totMont*100):0}%</td></tr>`).join('');
          })()}
          <tr class="grand"><td>TOTAL</td><td style="text-align:center;">${topMontador.reduce((s,[,v])=>s+v.qty,0)}</td><td style="text-align:right;">100%</td></tr>
        </tbody>
      </table>`}
    </div>`;

  const blocoExpedidores = () => `
    <h2>📤 Expedidores</h2>
    <div class="box">
      ${topExped.length===0?`<div class="small">Sem dados de expedição nos pedidos do período.</div>`:`
      <table>
        <thead><tr><th>Expedidor(a)</th><th style="text-align:center;">Pedidos expedidos</th><th style="text-align:right;">% das expedições</th></tr></thead>
        <tbody>
          ${(() => {
            const totE = topExped.reduce((s,[,v])=>s+v.qty,0);
            return topExped.map(([n,v])=>`<tr><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td style="text-align:right;">${totE>0?Math.round(v.qty/totE*100):0}%</td></tr>`).join('');
          })()}
          <tr class="grand"><td>TOTAL</td><td style="text-align:center;">${topExped.reduce((s,[,v])=>s+v.qty,0)}</td><td style="text-align:right;">100%</td></tr>
        </tbody>
      </table>`}
    </div>`;

  const blocoEntregadores = () => topDriver.length>0 ? `
    <h2>🚚 Entregadores</h2>
    <div class="box">
      <table>
        <thead><tr><th>Entregador</th><th style="text-align:center;">Entregas</th><th style="text-align:right;">A pagar (taxa)</th></tr></thead>
        <tbody>
          ${topDriver.map(([n,v])=>`<tr><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.total)}</strong></td></tr>`).join('')}
          <tr class="grand"><td>TOTAL</td><td style="text-align:center;">${topDriver.reduce((s,[,v])=>s+v.qty,0)}</td><td class="ok" style="text-align:right;">${$c(topDriver.reduce((s,[,v])=>s+v.total,0))}</td></tr>
        </tbody>
      </table>
    </div>` : '<div class="box small">Sem entregas no período.</div>';

  const blocoClientes = () => `
    <h2>👥 Top 20 Clientes</h2>
    <div class="box">
      ${topCli.length===0?`<div class="small">Sem clientes.</div>`:`
      <table>
        <thead><tr><th>#</th><th>Cliente</th><th style="text-align:center;">Pedidos</th><th style="text-align:right;">Total gasto</th><th style="text-align:right;">Ticket médio</th></tr></thead>
        <tbody>
          ${topCli.map(([n,v],i)=>`<tr><td><strong style="color:#9D174D;">${i+1}</strong></td><td>${esc(n)}</td><td style="text-align:center;">${v.qty}</td><td class="ok" style="text-align:right;"><strong>${$c(v.total)}</strong></td><td style="text-align:right;">${$c(v.qty?v.total/v.qty:0)}</td></tr>`).join('')}
        </tbody>
      </table>`}
    </div>`;

  const blocoFinanceiro = () => `
    <h2>💰 Resumo Financeiro</h2>
    <div class="box" style="background:#FDF2F8;">
      <div class="row"><span>Faturamento bruto (sem taxas/descontos)</span><strong>${$c(fat - totalTaxa + totalDesc - totalAcre)}</strong></div>
      <div class="row"><span>🟢 Descontos concedidos</span><strong class="ok">− ${$c(totalDesc)}</strong></div>
      <div class="row"><span>🔴 Acréscimos cobrados</span><strong class="gold">+ ${$c(totalAcre)}</strong></div>
      <div class="row"><span>🚚 Taxas de entrega arrecadadas</span><strong class="blue">+ ${$c(totalTaxa)}</strong></div>
      <div class="row" style="font-size:15px;padding-top:8px;border-top:2px solid #9D174D;border-bottom:none;"><span><strong>TOTAL FATURADO</strong></span><strong class="ok" style="font-size:18px;">${$c(fat)}</strong></div>
    </div>`;

  const blocoCancelados = () => cancelados.length>0 ? `
    <h2>⚠️ Pedidos Cancelados</h2>
    <div class="box" style="background:#FEF2F2;">
      <div class="row"><span>Total de cancelamentos no período</span><strong class="red">${cancelados.length}</strong></div>
      <div class="row"><span>Valor estornado</span><strong class="red">${$c(cancelados.reduce((s,o)=>s+(o.total||0),0))}</strong></div>
    </div>` : '';

  // ── KPIs por tab ─────────────────────────────────────────────
  const kpiBlock = (() => {
    if (tabName === 'usuarios') {
      return `<div class="kpi-grid">
        <div class="kpi"><div class="lbl">Pedidos válidos</div><div class="v">${validos.length}</div></div>
        <div class="kpi"><div class="lbl">Vendedores ativos</div><div class="v">${topVend.length}</div></div>
        <div class="kpi"><div class="lbl">Montadores ativos</div><div class="v">${topMontador.length}</div></div>
        <div class="kpi"><div class="lbl">Expedidores ativos</div><div class="v">${topExped.length}</div></div>
      </div>`;
    }
    if (tabName === 'produtos') {
      const totUnits = topProd.reduce((s,[,v])=>s+v.qty,0);
      const totRev   = topProd.reduce((s,[,v])=>s+v.rev,0);
      return `<div class="kpi-grid">
        <div class="kpi"><div class="lbl">Produtos vendidos</div><div class="v">${topProd.length}</div></div>
        <div class="kpi"><div class="lbl">Unidades</div><div class="v">${totUnits}</div></div>
        <div class="kpi"><div class="lbl">Faturamento</div><div class="v">${$c(totRev)}</div></div>
        <div class="kpi"><div class="lbl">Preço médio/un</div><div class="v">${$c(totUnits>0?totRev/totUnits:0)}</div></div>
      </div>`;
    }
    if (tabName === 'caixa') {
      return `<div class="kpi-grid">
        <div class="kpi"><div class="lbl">Pedidos pagos</div><div class="v">${validos.length}</div></div>
        <div class="kpi"><div class="lbl">Faturamento</div><div class="v">${$c(fat)}</div></div>
        <div class="kpi"><div class="lbl">Descontos</div><div class="v">${$c(totalDesc)}</div></div>
        <div class="kpi"><div class="lbl">Acréscimos</div><div class="v">${$c(totalAcre)}</div></div>
      </div>`;
    }
    if (tabName === 'entregadores') {
      return `<div class="kpi-grid">
        <div class="kpi"><div class="lbl">Entregas</div><div class="v">${entregues.length}</div></div>
        <div class="kpi"><div class="lbl">Entregadores ativos</div><div class="v">${topDriver.length}</div></div>
        <div class="kpi"><div class="lbl">A pagar (total)</div><div class="v">${$c(topDriver.reduce((s,[,v])=>s+v.total,0))}</div></div>
        <div class="kpi"><div class="lbl">Custo/entrega</div><div class="v">${$c(entregues.length>0?topDriver.reduce((s,[,v])=>s+v.total,0)/entregues.length:0)}</div></div>
      </div>`;
    }
    if (tabName === 'clientes') {
      return `<div class="kpi-grid">
        <div class="kpi"><div class="lbl">Clientes únicos</div><div class="v">${Object.keys(byCli).length}</div></div>
        <div class="kpi"><div class="lbl">Pedidos</div><div class="v">${validos.length}</div></div>
        <div class="kpi"><div class="lbl">Faturamento</div><div class="v">${$c(fat)}</div></div>
        <div class="kpi"><div class="lbl">Ticket médio</div><div class="v">${$c(ticket)}</div></div>
      </div>`;
    }
    if (tabName === 'montagens') {
      return `<div class="kpi-grid">
        <div class="kpi"><div class="lbl">Pedidos montados</div><div class="v">${topMontador.reduce((s,[,v])=>s+v.qty,0)}</div></div>
        <div class="kpi"><div class="lbl">Montadores ativos</div><div class="v">${topMontador.length}</div></div>
        <div class="kpi"><div class="lbl">Faturamento (pedidos)</div><div class="v">${$c(fat)}</div></div>
        <div class="kpi"><div class="lbl">Total pedidos</div><div class="v">${validos.length}</div></div>
      </div>`;
    }
    // Geral (default)
    return `<div class="kpi-grid">
      <div class="kpi"><div class="lbl">Pedidos válidos</div><div class="v">${validos.length}</div></div>
      <div class="kpi"><div class="lbl">Faturamento</div><div class="v">${$c(fat)}</div></div>
      <div class="kpi"><div class="lbl">Ticket médio</div><div class="v">${$c(ticket)}</div></div>
      <div class="kpi"><div class="lbl">Entregues</div><div class="v">${entregues.length}</div></div>
    </div>`;
  })();

  // ── Subtítulo + corpo adaptados por tab ─────────────────────
  const TAB_INFO = {
    geral:        { sub:'Relatório Geral Detalhado',        body: blocoPagto() + blocoCanais() + blocoDias() + blocoUnidade() + blocoTipo() + blocoProdutos(15) + blocoVendedores() + blocoMontadores() + blocoExpedidores() + blocoEntregadores() + blocoFinanceiro() + blocoCancelados() },
    usuarios:     { sub:'Relatório por Usuário',            body: blocoVendedores() + blocoMontadores() + blocoExpedidores() },
    produtos:     { sub:'Relatório de Produtos',            body: blocoProdutosCompleto() },
    caixa:        { sub:'Relatório de Caixa (Pagamentos)',  body: blocoPagto() + blocoCanais() + blocoDias() + blocoFinanceiro() + blocoCancelados() },
    montagens:    { sub:'Relatório de Montagens',           body: blocoMontadores() },
    entregadores: { sub:'Relatório de Entregadores',        body: blocoEntregadores() },
    clientes:     { sub:'Relatório de Clientes',            body: blocoClientes() },
    vendas:       { sub:'Relatório de Vendas Detalhado',    body: blocoPagto() + blocoCanais() + blocoDias() + blocoTipo() + blocoVendedores() },
    vendasUnidade:{ sub:'Vendas por Unidade',               body: blocoUnidade() + blocoCanais() + blocoTipo() },
  };
  const tabInfo = TAB_INFO[tabName] || TAB_INFO.geral;

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Recibo ${tabInfo.sub} — ${dataLabel}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;}
  body{padding:24px;background:#fff;color:#111;max-width:820px;margin:0 auto;}
  h1{font-family:Georgia,serif;font-size:24px;margin:0 0 4px;color:#9D174D;}
  h2{font-size:14px;margin:18px 0 8px;color:#9D174D;border-bottom:2px solid #FDF2F8;padding-bottom:4px;}
  .sub{color:#555;font-size:13px;margin-bottom:18px;}
  .box{border:1px solid #ccc;border-radius:8px;padding:14px 16px;margin-bottom:14px;}
  .row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px dashed #ddd;}
  .row:last-child{border-bottom:none;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eee;}
  th{background:#FDF2F8;color:#9D174D;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
  .grand{background:#FAFAFA;font-weight:800;}
  .lbl{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.5px;}
  .val{font-size:18px;font-weight:800;color:#111;}
  .kpi{background:#FDF2F8;border-radius:8px;padding:10px;text-align:center;}
  .kpi .lbl{margin-bottom:4px;}
  .kpi .v{font-size:18px;font-weight:800;color:#9D174D;}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;}
  .ok{color:#15803D;} .red{color:#991B1B;} .blue{color:#1E40AF;} .gold{color:#92400E;}
  .footer{margin-top:24px;padding-top:14px;border-top:2px solid #9D174D;font-size:11px;color:#555;text-align:center;}
  @media print{ body{padding:12px;font-size:12px;} .no-print{display:none!important;} .box{break-inside:avoid;} h2{break-after:avoid;} table{break-inside:auto;} tr{break-inside:avoid;} }
  .btnp{background:#9D174D;color:#fff;padding:10px 22px;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;}
  .small{font-size:11px;color:#888;}
  .badge{display:inline-block;background:#FDF2F8;color:#9D174D;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.5px;margin-left:8px;}
</style></head>
<body>
  <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
    <button class="btnp" onclick="window.print()">🖨️ Imprimir</button>
    <button class="btnp" style="background:#6B7280;" onclick="window.close()">✕ Fechar</button>
  </div>
  <h1>🌹 Floricultura Laços Eternos <span class="badge">${tabName.toUpperCase()}</span></h1>
  <div class="sub">${tabInfo.sub}</div>

  <div class="box">
    <div class="row"><span class="lbl">Período</span><strong>${dataLabel} <span class="small">(${periodLabel})</span></strong></div>
    <div class="row"><span class="lbl">Unidade</span><strong>${esc(unitLabel)}</strong></div>
    <div class="row"><span class="lbl">Dias úteis no período</span><strong>${diasOrd.length}</strong></div>
    <div class="row"><span class="lbl">Gerado em</span><strong>${new Date().toLocaleString('pt-BR',{timeZone:'America/Manaus'})}</strong></div>
    <div class="row"><span class="lbl">Gerado por</span><strong>${esc(S.user?.name || S.user?.nome || '—')}</strong></div>
  </div>

  ${kpiBlock}

  ${tabInfo.body}

  <div class="box">
    <div class="lbl" style="margin-bottom:6px;">✍️ Assinaturas</div>
    <div style="display:flex;gap:30px;margin-top:30px;">
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;">
        Gerado por<br/><strong>${esc(S.user?.name || S.user?.nome || '')}</strong>
      </div>
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;">
        Conferido por (gerência)<br/>&nbsp;
      </div>
      <div style="flex:1;border-top:1px solid #333;padding-top:6px;text-align:center;font-size:12px;">
        Aprovado (administração)<br/>&nbsp;
      </div>
    </div>
  </div>

  <div class="footer">
    Gerado em ${new Date().toLocaleString('pt-BR',{timeZone:'America/Manaus'})} · Florevita Sistema · Documento auditável<br/>
    Inclui apenas pedidos com pagamento confirmado (Aprovado/Pago/Recebido). Cancelados listados separadamente quando aplicável.
  </div>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast('❌ Permita pop-ups para gerar o recibo', true); return; }
  w.document.write(html);
  w.document.close();
}

// ── Helpers locais (substituem os antigos do modulo metas removido) ──
// Filtra colaboradores ativos por setor segundo o cargo cadastrado.
// Atendimento aparece em todos os 3 setores operacionais (faz rodizio
// semanal entre vendas, montagem e expedicao).
function getEquipePorSetor(setor){
  const colabs = getColabs().filter(c => c.active !== false);
  const norm = (s) => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const car = c => norm(c.cargo);
  const isAtend  = c => car(c).includes('atend');
  const isProd   = c => car(c).includes('producao') || car(c).includes('montad');
  const isExp    = c => car(c).includes('expedicao');
  const isEntreg = c => car(c).includes('entregador');
  if (setor === 'vendas')    return colabs.filter(c => isAtend(c) && !isEntreg(c));
  if (setor === 'montagem')  return colabs.filter(c => (isAtend(c) || isProd(c)) && !isEntreg(c));
  if (setor === 'expedicao') return colabs.filter(c => (isAtend(c) || isExp(c))  && !isEntreg(c));
  return colabs;
}
function getEntregadores(){
  return getColabs().filter(c => c.active !== false && String(c.cargo||'').toLowerCase().includes('entregador'));
}

// ── Helpers locais (atividades / metas) ──────────────────────
function getActivities(){ return JSON.parse(localStorage.getItem('fv_activities')||'[]'); }

function getMetasPeriod(per){
  const now = new Date();
  const start = new Date();
  if(per==='dia'){
    start.setHours(0,0,0,0);
  } else if(per==='semana'){
    const day = now.getDay();
    start.setDate(now.getDate() - day);
    start.setHours(0,0,0,0);
  } else {
    start.setDate(1); start.setHours(0,0,0,0);
  }
  return start;
}

// ── HELPERS UNIFICADOS (v2) ──────────────────────────────────
// Status de pagamento que contam como venda confirmada (faturamento).
const _PG_APROV = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega','Recebido']);

// Identifica se 'orderField' (string|id) bate com o colab informado.
// Usa _id, backendId, email e nome (case-insensitive). Tolerante a
// pedidos antigos com valores em formatos diferentes.
function _isMine(colab, ...vals) {
  if (!colab) return false;
  const ids = new Set([colab._id, colab.id, colab.backendId].filter(Boolean).map(String));
  const emailLow = String(colab.email||'').toLowerCase();
  const nameLow  = String(colab.name ||'').toLowerCase();
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

// Usa S.orders (fonte da verdade) — campos vendedorId / montadorId /
// expedidorId / driverColabId / driverName + paymentStatus aprovado.
// Activities (legado) fica como complemento — soma so o que NAO veio
// pelo orders (evita duplicar).
function getColabStatsForPeriod(colab, inPeriod){
  const base = {
    vendas:0, fatVendas:0, comissaoVenda:0,
    montagens:0, comissaoMontagem:0,
    expedicoes:0, comissaoExpedicao:0,
    comissaoTotal:0
  };
  if(!colab) return base;
  const pctV = Number(colab.metas?.comissaoVenda ?? colab.metas?.vendaPct ?? 0) || 0;
  const vM   = Number(colab.metas?.comissaoMontagem  ?? 0) || 0;
  const vE   = Number(colab.metas?.comissaoExpedicao ?? 0) || 0;

  const orders = Array.isArray(S.orders) ? S.orders : [];
  for (const o of orders) {
    const dataRef = o.createdAt || o.scheduledDate;
    if (!inPeriod(dataRef)) continue;
    // FIX: Cancelado nunca conta — mesmo se o pagamento estava 'Aprovado'
    // antes do cancelamento, comissao e zerada pra evitar pagar pelo
    // que nao foi entregue
    if (o.status === 'Cancelado') continue;
    const itemsQty = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1), 0) || 1;

    // VENDAS — pedido APROVADO + colab e o vendedor (fallback createdBy)
    const aprov = _PG_APROV.has(String(o.paymentStatus||''));
    if (aprov) {
      const ehMinhaVenda = _isMine(colab, o.vendedorId, o.vendedorEmail) ||
        (!o.vendedorId && _isMine(colab, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName));
      if (ehMinhaVenda) {
        base.vendas++;
        base.fatVendas += Number(o.total)||0;
        base.comissaoVenda += (Number(o.total)||0) * (pctV/100);
      }
    }

    // MONTAGEM — status >= Pronto + colab e o montador
    const st = String(o.status||'').toLowerCase();
    if (['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) {
      if (_isMine(colab, o.montadorId, o.montadorEmail)) {
        base.montagens += itemsQty;
        base.comissaoMontagem += vM * itemsQty;
      }
    }

    // EXPEDICAO — status Entregue + colab eh EXPEDIDOR (nao driver!)
    // FIX: antes contava tbm driverColabId/driverName, o que inflava o numero
    // de expedicoes pra entregadores. Driver eh contado separado em "Por entregador".
    if (st.includes('entregue')) {
      if (_isMine(colab, o.expedidorId, o.expedidorEmail)) {
        base.expedicoes++;
        base.comissaoExpedicao += vE;
      }
    }
  }

  base.comissaoTotal = base.comissaoVenda + base.comissaoMontagem + base.comissaoExpedicao;
  return base;
}

// Versao "simples" usada no card antigo de Metas — periodos do colab.
// Agora delegada para a versao unificada usando inPeriod baseado na meta.
function getColabStats(colab){
  if(!colab) return {vendas:0,comissao:0,montagens:0,expedicoes:0};
  const mPer = colab.metas?.montagemPer || 'dia';
  const mStart = getMetasPeriod(mPer);
  const inPeriod = d => { const dt = new Date(d); return !isNaN(dt) && dt >= mStart; };
  const s = getColabStatsForPeriod(colab, inPeriod);
  return {
    vendas: s.vendas,
    comissao: s.comissaoTotal,
    montagens: s.montagens,
    expedicoes: s.expedicoes,
  };
}

function metaBar(atual, meta, label, unit=''){
  if(!meta) return '';
  const pct = Math.min(100, Math.round((atual/meta)*100));
  const cor = pct>=100?'var(--leaf)':pct>=60?'#F59E0B':'var(--red)';
  return`<div style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px;">
      <span>${label}</span>
      <span style="font-weight:700;color:${cor}">${atual}/${meta}${unit} <span style="color:var(--muted)">(${pct}%)</span></span>
    </div>
    <div style="height:5px;background:#E5E7EB;border-radius:3px;overflow:hidden;">
      <div style="height:100%;width:${pct}%;background:${cor};border-radius:3px;transition:width .4s;"></div>
    </div>
  </div>`;
}

// ── render() via dynamic import ──────────────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── RELATÓRIOS CUSTOMIZADOS — API com fallback localStorage ──
export async function getRelatorios() {
  try { const d = await GET('/settings/relatorios'); return d?.value || []; }
  catch { return JSON.parse(localStorage.getItem('fv_relatorios')||'[]'); }
}
export async function saveRelatorios(list) {
  try { await PUT('/settings/relatorios', { value: list }); }
  catch { localStorage.setItem('fv_relatorios', JSON.stringify(list)); }
}

// Versoes sync para compatibilidade com render
function getRelatoriosSync(){ return JSON.parse(localStorage.getItem('fv_relatorios')||'[]'); }
function saveRelatoriosSync(list){ localStorage.setItem('fv_relatorios', JSON.stringify(list)); }

// ── Constantes de relatórios customizados ─────────────────────
const REP_MODULES={
  pedidos:{label:'📋 Pedidos',fields:['orderNumber','createdAt','total','status','payment','type','unit','source','clientName','scheduledDate']},
  clientes:{label:'👥 Clientes',fields:['name','phone','email','segment','createdAt']},
  produtos:{label:'🌹 Produtos',fields:['name','category','salePrice','costPrice','stock','activeOnSite']},
  financeiro:{label:'💰 Financeiro',fields:['date','amount','description','category']},
};
const REP_FIELD_LABELS={
  orderNumber:'Nº Pedido',createdAt:'Data',total:'Total',status:'Status',payment:'Pagamento',
  type:'Tipo',unit:'Unidade',source:'Canal',clientName:'Cliente',scheduledDate:'Data Entrega',
  name:'Nome',phone:'Telefone',email:'E-mail',segment:'Segmento',
  category:'Categoria',salePrice:'Preço Venda',costPrice:'Custo',stock:'Estoque',activeOnSite:'Ativo Site',
  date:'Data',amount:'Valor',description:'Descrição',
};

// ── getReportData ─────────────────────────────────────────────
export function getReportData(rep){
  const period=rep.period||'mes'; const now=new Date();
  const inP=d=>{const dt=new Date(d); if(period==='hoje')return dt.toDateString()===now.toDateString(); if(period==='semana'){const w=new Date(now);w.setDate(now.getDate()-7);return dt>=w;} if(period==='mes')return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear(); return true;};
  const rows=[];
  if((rep.modules||[]).includes('pedidos')) S.orders.filter(o=>inP(o.createdAt)).forEach(o=>{const r={};(rep.fields||[]).filter(f=>REP_MODULES.pedidos.fields.includes(f)).forEach(f=>r[f]=o[f]||'');if(Object.keys(r).length)rows.push({_mod:'pedidos',...r});});
  if((rep.modules||[]).includes('clientes')) S.clients.forEach(c=>{const r={};(rep.fields||[]).filter(f=>REP_MODULES.clientes.fields.includes(f)).forEach(f=>r[f]=c[f]||'');if(Object.keys(r).length)rows.push({_mod:'clientes',...r});});
  if((rep.modules||[]).includes('produtos')) S.products.forEach(p=>{const r={};(rep.fields||[]).filter(f=>REP_MODULES.produtos.fields.includes(f)).forEach(f=>r[f]=p[f]||'');if(Object.keys(r).length)rows.push({_mod:'produtos',...r});});
  return rows.filter(row=>(rep.filters||[]).every(f=>{const v=String(row[f.field]||'').toLowerCase();if(f.op==='eq')return v===String(f.value||'').toLowerCase();if(f.op==='contains')return v.includes(String(f.value||'').toLowerCase());if(f.op==='gt')return parseFloat(row[f.field]||0)>parseFloat(f.value||0);if(f.op==='lt')return parseFloat(row[f.field]||0)<parseFloat(f.value||0);return true;}));
}

// ── renderCustomReports ───────────────────────────────────────
export function renderCustomReports(){
  const reps=getRelatoriosSync(); const view=S._repView||'list';
  if(view==='list') return renderRepList(reps);
  if(view==='builder') return renderRepBuilder();
  if(view==='view') return renderRepView();
  return '';
}

// ── renderRepList ─────────────────────────────────────────────
export function renderRepList(reps){return`
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
  <div><div style="font-family:'Playfair Display',serif;font-size:20px;color:var(--primary);">📋 Meus Relatórios</div>
  <div style="font-size:12px;color:var(--muted);">Crie, personalize e exporte relatórios profissionais</div></div>
  ${S.user?.role==='Administrador'?`<button class="btn btn-primary" onclick="repNew()">+ Novo Relatório</button>`:''}
</div>
${reps.length===0?`<div class="card" style="text-align:center;padding:60px 20px;">
  <div style="font-size:60px;margin-bottom:16px;">📊</div>
  <h3 style="color:var(--primary);margin-bottom:8px;">Nenhum relatório criado</h3>
  <p style="color:var(--muted);font-size:13px;margin-bottom:20px;">Crie relatórios personalizados com campos, filtros e gráficos.</p>
  ${S.user?.role==='Administrador'?`<button class="btn btn-primary" onclick="repNew()">+ Criar Primeiro Relatório</button>`:''}</div>`:`
<div style="display:flex;flex-direction:column;gap:12px;">
${reps.map((r,i)=>`<div class="card" style="padding:16px;">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="width:44px;height:44px;border-radius:10px;background:${r.color||'var(--primary)'};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📊</div>
      <div>
        <div style="font-weight:700;font-size:15px;">${r.name}</div>
        <div style="font-size:11px;color:var(--muted);">${(r.modules||[]).map(m=>REP_MODULES[m]?.label||m).join(' · ')} · ${r.fields?.length||0} campos · ${r.layout||'tabela'}</div>
        <div style="font-size:10px;color:var(--muted);">${new Date(r.updatedAt||r.createdAt||Date.now()).toLocaleDateString('pt-BR')}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" onclick="repView(${i})">👁️ Ver</button>
      <button class="btn btn-ghost btn-sm" onclick="repPresent(${i})">🎯 Apresentar</button>
      ${S.user?.role==='Administrador'?`
      <button class="btn btn-ghost btn-sm" onclick="repEdit(${i})">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="repDuplicate(${i})">📄</button>
      <button class="btn btn-ghost btn-sm" onclick="repDelete(${i})" style="color:var(--red);">🗑️</button>`:''}
    </div>
  </div>
</div>`).join('')}
</div>`}`;}

// ── renderRepBuilder ──────────────────────────────────────────
export function renderRepBuilder(){
  const draft=S._repDraft||{name:'',modules:[],fields:[],filters:[],groupBy:'',layout:'tabela',chartType:'bar',color:'#8B2252',period:'mes',extraFields:[]};
  return`
<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
  <button class="btn btn-ghost btn-sm" onclick="S._repView='list';render()">← Voltar</button>
  <h3 style="font-family:'Playfair Display',serif;color:var(--primary);">${S._repEditIdx!==null?'✏️ Editar':'+ Novo'} Relatório</h3>
</div>
<div class="g2" style="gap:16px;align-items:start;">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📝 Identificação</div>
      <div class="fr2" style="gap:10px;">
        <div class="fg" style="grid-column:span 2"><label class="fl">Nome *</label><input class="fi" id="rep-name" value="${draft.name||''}" placeholder="Ex: Vendas por Canal — Mensal"/></div>
        <div class="fg"><label class="fl">Período</label><select class="fi" id="rep-period">${['hoje','semana','mes','todos'].map(p=>`<option value="${p}" ${draft.period===p?'selected':''}>${{hoje:'Hoje',semana:'7 dias',mes:'Este mês',todos:'Todos'}[p]}</option>`).join('')}</select></div>
        <div class="fg"><label class="fl">Cor de destaque</label><input type="color" class="fi" id="rep-color" value="${draft.color||'#8B2252'}" style="height:38px;padding:2px 6px;"/></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🗂️ 1. Módulos</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${Object.entries(REP_MODULES).map(([k,m])=>`<label style="display:flex;align-items:center;gap:8px;padding:10px;border:1.5px solid ${(draft.modules||[]).includes(k)?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;background:${(draft.modules||[]).includes(k)?'var(--primary-pale)':'#fff'};">
          <input type="checkbox" class="rep-mod-cb" data-mod="${k}" ${(draft.modules||[]).includes(k)?'checked':''} style="accent-color:var(--primary)"/>
          <span style="font-size:13px;font-weight:500;">${m.label}</span></label>`).join('')}
      </div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📌 2. Campos</div>
      ${Object.entries(REP_MODULES).filter(([k])=>(draft.modules||[]).includes(k)).map(([k,m])=>`
      <div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--primary);margin-bottom:6px;">${m.label}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${m.fields.map(f=>`<button onclick="repToggleField('${f}')" style="padding:4px 10px;border-radius:20px;border:1.5px solid ${(draft.fields||[]).includes(f)?'var(--primary)':'var(--border)'};background:${(draft.fields||[]).includes(f)?'var(--primary)':'#fff'};color:${(draft.fields||[]).includes(f)?'#fff':'var(--muted)'};font-size:12px;cursor:pointer;">${REP_FIELD_LABELS[f]||f}</button>`).join('')}
        </div>
      </div>`).join('')}
      ${!(draft.modules||[]).length?`<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px;">Selecione módulos acima primeiro</div>`:''}
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🔍 3. Filtros <button class="btn btn-ghost btn-sm" onclick="repAddFilter()">+ Filtro</button></div>
      ${(draft.filters||[]).map((f,i)=>`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
        <select class="fi" style="flex:1;" onchange="repUpdateFilter(${i},'field',this.value)">${Object.entries(REP_FIELD_LABELS).map(([k,l])=>`<option value="${k}" ${f.field===k?'selected':''}>${l}</option>`).join('')}</select>
        <select class="fi" style="width:100px;" onchange="repUpdateFilter(${i},'op',this.value)"><option value="eq" ${f.op==='eq'?'selected':''}>= igual</option><option value="contains" ${f.op==='contains'?'selected':''}>contém</option><option value="gt" ${f.op==='gt'?'selected':''}>maior</option><option value="lt" ${f.op==='lt'?'selected':''}>menor</option></select>
        <input class="fi" style="flex:1;" value="${f.value||''}" placeholder="Valor..." onchange="repUpdateFilter(${i},'value',this.value)"/>
        <button class="btn btn-ghost btn-xs" onclick="repRemoveFilter(${i})" style="color:var(--red);">✕</button>
      </div>`).join('')}
      ${!(draft.filters||[]).length?`<div style="color:var(--muted);font-size:12px;">Nenhum filtro</div>`:''}
    </div>
    <div class="card">
      <div class="card-title">🎨 4. Layout</div>
      <div class="fr2" style="gap:10px;">
        <div class="fg"><label class="fl">Layout</label><select class="fi" id="rep-layout"><option value="tabela" ${(draft.layout||'tabela')==='tabela'?'selected':''}>📋 Tabela</option><option value="cards" ${draft.layout==='cards'?'selected':''}>🃏 Cards</option><option value="grafico" ${draft.layout==='grafico'?'selected':''}>📊 Gráfico</option></select></div>
        <div class="fg"><label class="fl">Gráfico</label><select class="fi" id="rep-chart-type"><option value="bar" ${(draft.chartType||'bar')==='bar'?'selected':''}>📊 Barra</option><option value="pie" ${draft.chartType==='pie'?'selected':''}>🍕 Pizza</option><option value="line" ${draft.chartType==='line'?'selected':''}>📈 Linha</option></select></div>
        <div class="fg"><label class="fl">Agrupar por</label><select class="fi" id="rep-groupby"><option value="">Sem agrupamento</option><option value="day" ${draft.groupBy==='day'?'selected':''}>Dia</option><option value="month" ${draft.groupBy==='month'?'selected':''}>Mês</option><option value="status" ${draft.groupBy==='status'?'selected':''}>Status</option><option value="category" ${draft.groupBy==='category'?'selected':''}>Categoria</option><option value="unit" ${draft.groupBy==='unit'?'selected':''}>Unidade</option><option value="payment" ${draft.groupBy==='payment'?'selected':''}>Pagamento</option></select></div>
        <div class="fg"><label class="fl">Campos extras (vírgula)</label><input class="fi" id="rep-extra" value="${(draft.extraFields||[]).join(', ')}" placeholder="Ex: Comanda, Cartão"/></div>
      </div>
    </div>
  </div>
  <div style="position:sticky;top:80px;">
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">💾 Salvar</div>
      <button class="btn btn-primary" onclick="repSave()" style="width:100%;padding:13px;font-size:15px;margin-bottom:8px;">💾 Salvar Relatório</button>
      <button class="btn btn-ghost" onclick="S._repView='list';render()" style="width:100%;">Cancelar</button>
    </div>
    <div class="card"><div class="card-title">Resumo</div>
      <div style="font-size:12px;color:var(--muted);">Módulos: <strong>${(draft.modules||[]).length}</strong> · Campos: <strong>${(draft.fields||[]).length}</strong> · Filtros: <strong>${(draft.filters||[]).length}</strong></div>
      <div style="margin-top:10px;background:${draft.color||'var(--primary)'};border-radius:6px;height:6px;"></div>
    </div>
  </div>
</div>`;}

// ── renderRepView ─────────────────────────────────────────────
export function renderRepView(){
  const rep=getRelatoriosSync()[S._repViewIdx||0]; if(!rep) return`<div class="card"><p>Relatório não encontrado</p></div>`;
  const rows=getReportData(rep); const fields=rep.fields||[]; const color=rep.color||'#8B2252';
  const total=rows.reduce((s,r)=>s+parseFloat(r.total||r.amount||0),0);
  const grpMap={}; if(rep.groupBy) rows.forEach(r=>{let k=''; if(rep.groupBy==='day')k=new Date(r.createdAt||Date.now()).toLocaleDateString('pt-BR'); else if(rep.groupBy==='month')k=new Date(r.createdAt||Date.now()).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}); else k=r[rep.groupBy]||'—'; if(!grpMap[k])grpMap[k]={key:k,count:0,total:0}; grpMap[k].count++; grpMap[k].total+=parseFloat(r.total||0);});
  const grps=Object.values(grpMap).sort((a,b)=>b.total-a.total); const maxGrp=Math.max(...grps.map(g=>g.total),1);
  return`
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
  <div style="display:flex;align-items:center;gap:10px;"><button class="btn btn-ghost btn-sm" onclick="S._repView='list';render()">← Voltar</button><h3 style="font-family:'Playfair Display',serif;color:var(--primary);">${rep.name}</h3></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="btn btn-ghost btn-sm" onclick="repPresent(${S._repViewIdx||0})">🎯 Apresentar</button>
    <button class="btn btn-ghost btn-sm" onclick="repExportCSV(${S._repViewIdx||0})">📊 CSV</button>
    <button class="btn btn-ghost btn-sm" onclick="repExportPDF(${S._repViewIdx||0})">🖨️ PDF</button>
  </div>
</div>
<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Registros</div><div class="mc-val">${rows.length}</div></div>
  ${total>0?`<div class="mc leaf"><div class="mc-label">Total</div><div class="mc-val">${$c(total)}</div></div>`:''}
  ${grps.length?`<div class="mc gold"><div class="mc-label">Grupos</div><div class="mc-val">${grps.length}</div></div>`:''}
  <div class="mc blue"><div class="mc-label">Período</div><div class="mc-val" style="font-size:13px;">${{hoje:'Hoje',semana:'7 dias',mes:'Este mês',todos:'Tudo'}[rep.period]||rep.period}</div></div>
</div>
${grps.length?`<div class="card" style="margin-bottom:14px;">
  <div class="card-title">📊 Gráfico — ${rep.groupBy}</div>
  <div style="overflow-x:auto;"><div style="display:flex;gap:4px;align-items:flex-end;min-height:120px;padding:8px 0;">
    ${grps.slice(0,20).map(g=>`<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:36px;">
      <div style="font-size:10px;color:var(--muted);font-weight:600;">${g.count}</div>
      <div style="width:100%;background:${color};border-radius:4px 4px 0 0;height:${Math.round((g.total/maxGrp)*100)}px;min-height:4px;"></div>
      <div style="font-size:9px;color:var(--muted);text-align:center;">${g.key.slice(0,10)}</div>
    </div>`).join('')}
  </div></div>
</div>`:''}
<div class="card">
  <div class="card-title">${rep.name} <span style="font-size:12px;font-weight:400;color:var(--muted);">${rows.length} registro(s)</span></div>
  ${rows.length===0?`<div class="empty"><div class="empty-icon">📊</div><p>Nenhum dado</p></div>`:`
  <div style="overflow-x:auto;"><table><thead><tr>
    ${fields.map(f=>`<th>${REP_FIELD_LABELS[f]||f}</th>`).join('')}
    ${(rep.extraFields||[]).map(ef=>`<th>${ef}</th>`).join('')}
  </tr></thead><tbody>
    ${rows.slice(0,200).map(row=>`<tr>${fields.map(f=>{let v=row[f]||'—'; if(['total','amount','salePrice','costPrice'].includes(f))v=$c(parseFloat(v)||0); if(['createdAt','scheduledDate','date'].includes(f))v=v&&v!=='—'?new Date(v).toLocaleDateString('pt-BR'):'—'; if(f==='status'){const c2={Entregue:'t-green',Cancelado:'t-red','Em produção':'t-yellow',Pendente:'t-gray'}; v=`<span class="tag ${c2[v]||'t-gray'}">${v}</span>`;} return`<td>${v}</td>`;}).join('')}${(rep.extraFields||[]).map(()=>`<td></td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`}
</div>`;}

// ── repNew / repEdit / repView ────────────────────────────────
export function repNew(){S._repView='builder';S._repDraft={name:'',modules:[],fields:[],filters:[],groupBy:'',layout:'tabela',chartType:'bar',color:'#8B2252',period:'mes',extraFields:[]};S._repEditIdx=null;render();}
export function repEdit(i){const rep=getRelatoriosSync()[i];if(!rep)return;S._repView='builder';S._repDraft={...rep};S._repEditIdx=i;render();}
export function repView(i){S._repView='view';S._repViewIdx=i;render();}
export function repToggleField(f){const d=S._repDraft||{};const fields=d.fields||[];d.fields=fields.includes(f)?fields.filter(x=>x!==f):[...fields,f];S._repDraft=d;render();}
export function repAddFilter(){const d=S._repDraft||{};d.filters=[...(d.filters||[]),{field:'status',op:'eq',value:''}];S._repDraft=d;render();}
export function repRemoveFilter(i){const d=S._repDraft||{};d.filters=(d.filters||[]).filter((_,j)=>j!==i);S._repDraft=d;render();}
export function repUpdateFilter(i,key,val){if(S._repDraft?.filters?.[i])S._repDraft.filters[i][key]=val;}

export function repDuplicate(i){const list=getRelatoriosSync();const copy={...list[i],name:list[i].name+' (cópia)',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};list.splice(i+1,0,copy);saveRelatoriosSync(list);saveRelatorios(list);render();toast('📄 Duplicado!');}
export function repDelete(i){if(!confirm('Excluir este relatório?'))return;const list=getRelatoriosSync();list.splice(i,1);saveRelatoriosSync(list);saveRelatorios(list);render();toast('🗑️ Excluído');}

export function repSave(){
  const g=id=>document.getElementById(id);
  const name=g('rep-name')?.value?.trim(); if(!name)return toast('❌ Nome obrigatório',true);
  const modules=[...document.querySelectorAll('.rep-mod-cb:checked')].map(c=>c.dataset.mod);
  if(!modules.length)return toast('⚠️ Selecione ao menos um módulo',true);
  const extra=g('rep-extra')?.value?.split(',').map(s=>s.trim()).filter(Boolean)||[];
  const d=S._repDraft||{};
  const rep={...d,name,modules,layout:g('rep-layout')?.value||'tabela',chartType:g('rep-chart-type')?.value||'bar',groupBy:g('rep-groupby')?.value||'',period:g('rep-period')?.value||'mes',color:g('rep-color')?.value||'#8B2252',extraFields:extra,updatedAt:new Date().toISOString()};
  if(!rep.createdAt)rep.createdAt=new Date().toISOString();
  const list=getRelatoriosSync(); if(S._repEditIdx!==null)list[S._repEditIdx]=rep; else list.unshift(rep);
  saveRelatoriosSync(list);saveRelatorios(list);S._repView='list';S._repDraft=null;S._repEditIdx=null;render();toast('✅ Relatório salvo!');
}

// ── repExportCSV ──────────────────────────────────────────────
export function repExportCSV(i){
  const rep=getRelatoriosSync()[i];if(!rep)return;const rows=getReportData(rep);const fields=rep.fields||[];
  const header=fields.map(f=>REP_FIELD_LABELS[f]||f).join(',');
  const lines=rows.map(r=>fields.map(f=>`"${String(r[f]||'').replace(/"/g,'""')}"`).join(','));
  const csv='\uFEFF'+[header,...lines].join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=rep.name.replace(/[^a-zA-Z0-9]/g,'_')+'.csv';a.click();toast('✅ CSV exportado!');
}

// ── repExportPDF ──────────────────────────────────────────────
export function repExportPDF(i){
  const rep=getRelatoriosSync()[i]; if(!rep) return;
  const rows=getReportData(rep); const fields=rep.fields||[]; const color=rep.color||'#8B2252';
  const total=rows.reduce((s,r)=>s+parseFloat(r.total||r.amount||0),0);
  const th=fields.map(f=>'<th>'+(REP_FIELD_LABELS[f]||f)+'</th>').join('');
  const tb=rows.slice(0,500).map(r=>'<tr>'+fields.map(f=>'<td>'+(r[f]||'-')+'</td>').join('')+'</tr>').join('');
  const css='body{font-family:Arial,sans-serif;margin:24px}h1{color:'+color+';font-size:22px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:16px}th{background:'+color+';color:#fff;padding:7px 8px}td{padding:6px 8px;border-bottom:1px solid #ddd}@media print{@page{margin:1cm}}';
  const kv=total>0?'R$ '+total.toFixed(2).replace('.',','):'';
  const w=window.open('','_blank'); if(!w) return toast('Permita popups para gerar PDF',true);
  w.document.open();
  w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+rep.name+'</title><style>'+css+'</style></head><body>');
  w.document.write('<h1>'+rep.name+'</h1>');
  w.document.write('<p style="color:#999;font-size:12px">'+new Date().toLocaleString('pt-BR')+' · '+rows.length+' registros</p>');
  if(kv) w.document.write('<p><b style="color:'+color+'">Total: '+kv+'</b></p>');
  w.document.write('<table><thead><tr>'+th+'</tr></thead><tbody>'+tb+'</tbody></table>');
  w.document.write('</body></html>');
  w.document.close();
  w.onload=()=>w.print();
}

// ── repPresent ────────────────────────────────────────────────
export function repPresent(i){
  const rep=getRelatoriosSync()[i];if(!rep)return;
  const rows=getReportData(rep);const color=rep.color||'#8B2252';const total=rows.reduce((s,r)=>s+parseFloat(r.total||r.amount||0),0);
  const grpMap={};rows.forEach(r=>{const k=r.unit||r.category||r.status||'Geral';if(!grpMap[k])grpMap[k]={key:k,count:0,total:0};grpMap[k].count++;grpMap[k].total+=parseFloat(r.total||0);});
  const grps=Object.values(grpMap).sort((a,b)=>b.total-a.total).slice(0,8);const maxGrp=Math.max(...grps.map(g=>g.total),1);
  const slides=[
    `<div style="background:linear-gradient(135deg,${color},${color}99);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:40px;box-sizing:border-box;"><div style="font-size:64px;margin-bottom:20px;">📊</div><h1 style="font-size:clamp(28px,5vw,52px);font-weight:700;margin-bottom:12px;font-family:'Playfair Display',serif;">${rep.name}</h1><p style="font-size:18px;opacity:.85;margin-bottom:8px;">Laços Eternos Floricultura</p><p style="font-size:14px;opacity:.7;">${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}</p></div>`,
    `<div style="background:#fff;min-height:100vh;padding:60px;box-sizing:border-box;"><h2 style="color:${color};font-family:'Playfair Display',serif;font-size:36px;margin-bottom:32px;">📋 Resumo</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px;"><div style="background:${color}15;border-radius:16px;padding:24px;border-left:6px solid ${color};"><div style="font-size:36px;font-weight:700;color:${color};">${rows.length}</div><div style="font-size:14px;color:#666;">Registros</div></div>${total>0?`<div style="background:${color}15;border-radius:16px;padding:24px;border-left:6px solid ${color};"><div style="font-size:36px;font-weight:700;color:${color};">R$ ${total.toFixed(2).replace('.',',')}</div><div style="font-size:14px;color:#666;">Total</div></div>`:''}<div style="background:${color}15;border-radius:16px;padding:24px;border-left:6px solid ${color};"><div style="font-size:36px;font-weight:700;color:${color};">${grps.length}</div><div style="font-size:14px;color:#666;">Grupos</div></div></div></div>`,
    `<div style="background:#F8F4F2;min-height:100vh;padding:60px;box-sizing:border-box;"><h2 style="color:${color};font-family:'Playfair Display',serif;font-size:36px;margin-bottom:32px;">📊 Análise</h2><div style="background:#fff;border-radius:16px;padding:32px;">${grps.length?`<div style="display:flex;gap:12px;align-items:flex-end;height:280px;padding-bottom:24px;">${grps.map(g=>`<div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;"><div style="font-size:11px;font-weight:700;color:${color};">R$ ${(g.total/1000).toFixed(1)}k</div><div style="width:100%;background:${color};border-radius:6px 6px 0 0;height:${Math.round((g.total/maxGrp)*240)}px;"></div><div style="font-size:10px;color:#666;text-align:center;">${g.key.slice(0,10)}</div></div>`).join('')}</div>`:'<p style="color:#999;text-align:center;padding:40px;">Sem dados</p>'}</div></div>`,
    `<div style="background:#fff;min-height:100vh;padding:60px;box-sizing:border-box;"><h2 style="color:${color};font-family:'Playfair Display',serif;font-size:36px;margin-bottom:32px;">🏆 Destaques</h2><div style="display:flex;flex-direction:column;gap:12px;">${grps.slice(0,6).map((g,i)=>`<div style="display:flex;align-items:center;gap:16px;padding:16px 20px;background:${i===0?color+'15':'#F8F4F2'};border-radius:12px;border-left:4px solid ${color};"><div style="font-size:24px;font-weight:700;color:${color};min-width:28px;">${i+1}</div><div style="flex:1;"><div style="font-weight:700;font-size:16px;">${g.key}</div><div style="font-size:13px;color:#666;">${g.count} registros</div></div><div style="font-weight:700;font-size:18px;color:${color};">R$ ${g.total.toFixed(2).replace('.',',')}</div></div>`).join('')}</div></div>`,
    `<div style="background:linear-gradient(135deg,#1A0A10,${color});min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;padding:40px;box-sizing:border-box;"><div style="font-size:64px;margin-bottom:20px;">🌸</div><h1 style="font-size:clamp(24px,4vw,44px);font-weight:700;margin-bottom:12px;font-family:'Playfair Display',serif;">Laços Eternos Floricultura</h1><p style="font-size:14px;opacity:.7;margin-top:16px;">${rep.name} · ${rows.length} registros</p></div>`,
  ];
  window._repSlides=slides;window._repCurrentSlide=0;
  const overlay=document.createElement('div');
  overlay.id='rep-present-overlay';
  overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;';
  overlay.innerHTML=`<div id="rep-slide-content" style="flex:1;overflow:auto;">${slides[0]}</div>
  <div style="background:#1A0A10;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;color:#fff;font-size:13px;">
    <button onclick="this.closest('#rep-present-overlay').remove()" style="background:rgba(255,255,255,.1);border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;">✕ Fechar (Esc)</button>
    <div style="display:flex;align-items:center;gap:12px;">
      <button onclick="repSlideNav(-1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:18px;">‹</button>
      <span id="rep-slide-num">1 / ${slides.length}</span>
      <button onclick="repSlideNav(1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:18px;">›</button>
    </div>
    <button onclick="window.print()" style="background:rgba(255,255,255,.1);border:none;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;">🖨️ Imprimir</button>
  </div>`;
  document.body.appendChild(overlay);
  document.addEventListener('keydown',function repKey(e){if(!document.getElementById('rep-present-overlay')){document.removeEventListener('keydown',repKey);return;}if(e.key==='ArrowRight'||e.key==='ArrowDown')repSlideNav(1);if(e.key==='ArrowLeft'||e.key==='ArrowUp')repSlideNav(-1);if(e.key==='Escape')document.getElementById('rep-present-overlay')?.remove();});
}

// ── repSlideNav ───────────────────────────────────────────────
export function repSlideNav(dir){
  const slides=window._repSlides||[];const n=slides.length;
  window._repCurrentSlide=Math.max(0,Math.min(n-1,(window._repCurrentSlide||0)+dir));
  const c=document.getElementById('rep-slide-content');const num=document.getElementById('rep-slide-num');
  if(c)c.innerHTML=slides[window._repCurrentSlide];if(num)num.textContent=`${window._repCurrentSlide+1} / ${n}`;
}

// ── Sync exports ────────────────────────────────────────────
export { getRelatoriosSync, saveRelatoriosSync };

// ── Window registrations for inline onclick handlers ─────────
window.repNew = repNew;
window.repEdit = repEdit;
window.repView = repView;
window.repToggleField = repToggleField;
window.repAddFilter = repAddFilter;
window.repRemoveFilter = repRemoveFilter;
window.repUpdateFilter = repUpdateFilter;
window.repDuplicate = repDuplicate;
window.repDelete = repDelete;
window.repSave = repSave;
window.repExportCSV = repExportCSV;
window.repExportPDF = repExportPDF;
window.repPresent = repPresent;
window.repSlideNav = repSlideNav;

// ── RENDERRELATORIOS (principal) ─────────────────────────────
export function renderRelatorios(){
  const period = S._relPeriod||'mes';
  const unit   = S._relUnit||'';
  const tab    = S._relTab||'geral';
  const now    = new Date();

  // ── CARGA SOB DEMANDA DE PEDIDOS DO PERIODO ─────────────────
  // FIX (19/05/2026): cache global so carregava 150 pedidos, entao
  // relatorios de periodos longos (Dia das Maes, mes) ficavam truncados.
  // Marcia consultou 01-18/05: relatorio mostrava R$ 25.680 (150 pedidos)
  // quando o real era R$ 100.364 (604 pedidos validos).
  // Solucao: relatorio dispara fetch de TODOS os pedidos do range
  // direto do servidor (GET /orders?from=...&to=...&limit=5000) e
  // mescla no S.orders local.
  (function _fetchRelOrders() {
    // Calcula range em YYYY-MM-DD conforme period selecionado
    const _hojeMan = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
    let from = '', to = '';
    if (period === 'hoje') { from = _hojeMan; to = _hojeMan; }
    else if (period === 'semana') {
      const d = new Date(); d.setDate(d.getDate() - 7);
      from = d.toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
      to = _hojeMan;
    } else if (period === 'mes') {
      const d = new Date();
      from = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
      to = _hojeMan;
    } else if (period === 'mes_ant') {
      const d = new Date();
      const mAnt = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
      const yAnt = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
      from = `${yAnt}-${String(mAnt+1).padStart(2,'0')}-01`;
      const last = new Date(yAnt, mAnt+1, 0).getDate();
      to = `${yAnt}-${String(mAnt+1).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
    } else if (period === 'custom') {
      from = (S._relDate1||'').slice(0,10);
      to   = (S._relDate2||'').slice(0,10);
    }
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    const key = `${from}|${to}|${unit||'all'}`;
    if (S._relOrdersKey === key) return; // ja carregado pra este range
    S._relOrdersKey = key;
    // Dispara fetch e mescla
    GET(`/orders?from=${from}&to=${to}&limit=5000`).then(arr => {
      if (!Array.isArray(arr) || !arr.length) return;
      const byId = new Map();
      for (const o of (S.orders || [])) { if (o && o._id) byId.set(String(o._id), o); }
      let mudou = 0;
      for (const o of arr) {
        if (!o || !o._id) continue;
        const id = String(o._id);
        if (!byId.has(id)) { mudou++; byId.set(id, o); }
        else byId.set(id, { ...byId.get(id), ...o });
      }
      S.orders = [...byId.values()];
      if (mudou > 0) {
        import('../main.js').then(m => m.render()).catch(()=>{});
      }
    }).catch(()=>{});
  })();


  // Filtro por datas especificas (data inicial + data final)
  // Quando period==='custom', usa S._relDate1 e S._relDate2 (formato YYYY-MM-DD).
  // Qualquer data ausente e tratada como "sem limite" daquele lado.
  const dt1Str = S._relDate1 || '';
  const dt2Str = S._relDate2 || '';

  // Helper: data em Manaus YYYY-MM-DD (TZ-safe, alinhado com modulo Pedidos)
  // FIX: date-only strings (YYYY-MM-DD) ja vem corretos — nao converte TZ
  // (evita bug de mostrar dia anterior).
  const _dManaus = (ts) => {
    if (!ts) return '';
    const s = String(ts).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0,10);
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
  };
  const inPeriod = d=>{
    const dt=new Date(d);
    if(isNaN(dt.getTime())) return false;
    // 'hoje' = mesma data Manaus (UTC-4). Antes usava toDateString() do
    // browser, que falhava se browser nao estivesse na TZ de Manaus —
    // pedidos feitos a noite em Manaus podiam cair em dias diferentes
    // entre Pedidos e Relatorio.
    if(period==='hoje') return _dManaus(dt) === _dManaus(now);
    if(period==='semana'){const w=new Date(now);w.setDate(now.getDate()-7);return dt>=w;}
    if(period==='mes') return dt.getMonth()===now.getMonth()&&dt.getFullYear()===now.getFullYear();
    if(period==='mes_ant'){const m=now.getMonth()===0?11:now.getMonth()-1;const y=now.getMonth()===0?now.getFullYear()-1:now.getFullYear();return dt.getMonth()===m&&dt.getFullYear()===y;}
    if(period==='custom'){
      // Datas sao YYYY-MM-DD — monta inicio do dia (00:00) e fim do dia (23:59:59)
      if (dt1Str) {
        const ini = new Date(dt1Str + 'T00:00:00');
        if (dt < ini) return false;
      }
      if (dt2Str) {
        const fim = new Date(dt2Str + 'T23:59:59.999');
        if (dt > fim) return false;
      }
      return true;
    }
    return true;
  };

  const base = unit
    ? unit==='E-commerce'
      ? S.orders.filter(o=>o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))
      : S.orders.filter(o=>o.unit===unit&&o.source!=='E-commerce')
    : S.orders;
  // Regra unica: pedido eh do periodo se foi CRIADO/LANCADO no periodo.
  // Pedidos com entrega agendada (vendidos em outros dias) NAO entram —
  // sao "operacao do dia" e aparecem na aba Operacao do modulo Pedidos.
  const filtered = base.filter(o => inPeriod(o.createdAt));
  // RELATORIOS DE VENDAS = pedidos validos (nao-cancelados) com pagamento
  // CONFIRMADO. Pedidos com paymentStatus 'Aguardando Pagamento' /
  // 'Aguardando Comprovante' NAO entram no faturamento ate confirmar.
  // Status considerados confirmados:
  //   'Aprovado', 'Pago', 'Pago na Entrega', 'Recebido'
  const PAGAMENTOS_CONFIRMADOS = ['Aprovado', 'Pago', 'Pago na Entrega', 'Recebido'];
  const PAGAMENTOS_AG_ENTREGA = ['Ag. Pagamento na Entrega']; // legitimo, mas separado
  // Predicado: pedido eh uma venda valida (nao-cancelada, pagamento confirmado)
  const _ehVendaValida = (o) => {
    if (o.status === 'Cancelado') return false;
    const ps = String(o.paymentStatus || '').trim();
    if (PAGAMENTOS_AG_ENTREGA.includes(ps)) return o.status === 'Entregue';
    if (!ps) return ['Entregue','Pronto','Saiu p/ entrega'].includes(o.status);
    return PAGAMENTOS_CONFIRMADOS.includes(ps);
  };
  const validos = filtered.filter(_ehVendaValida);
  const entregues=filtered.filter(o=>o.status==='Entregue');
  const fat     = validos.reduce((s,o)=>s+(o.total||0),0);
  const ticket  = validos.length ? fat/validos.length : 0;
  const acts    = getActivities().filter(a=>inPeriod(a.date));

  // Produtos
  const byProd={};
  validos.forEach(o=>(o.items||[]).forEach(i=>{
    if(!byProd[i.name])byProd[i.name]={qty:0,rev:0};
    byProd[i.name].qty+=i.qty||1;
    byProd[i.name].rev+=(i.totalPrice||i.unitPrice*(i.qty||1)||0);
  }));
  const prodList=Object.entries(byProd).sort((a,b)=>b[1].rev-a[1].rev);
  const maxRev=prodList[0]?.[1]?.rev||1;

  // Por usuario (colaboradores nao-Entregadores) — comissões calculadas sobre o período
  const colabsAll = getColabs().filter(c=>c.active!==false);
  const selColab  = S._relColab||'';
  const colabsUsr = colabsAll
    .filter(c=>c.cargo!=='Entregador')
    .filter(c=>!selColab || c.id===selColab || c.backendId===selColab || (c.email||'')===selColab);
  const byUser = colabsUsr.map(c=>{
    const st = getColabStatsForPeriod(c, inPeriod);
    return {
      colab:c,
      name:c.name, role:c.cargo||'—', email:c.email||'',
      ...st
    };
  });
  // Fallback: incluir atividades de usuários não cadastrados como colaboradores
  const knownKeys = new Set();
  colabsAll.forEach(c=>{
    if(c.id) knownKeys.add(String(c.id));
    if(c.backendId) knownKeys.add(String(c.backendId));
    if(c.email) knownKeys.add((c.email||'').toLowerCase());
    if(c.name)  knownKeys.add((c.name ||'').toLowerCase());
  });
  const orphanMap={};
  // Pedidos cancelados nao contam (mesmo no fallback orphan)
  const cancelledIdsRel = new Set(
    (S.orders||[]).filter(o => o.status === 'Cancelado').map(o => String(o._id))
  );
  acts.forEach(a=>{
    if (a.orderId && cancelledIdsRel.has(String(a.orderId))) return;
    const k1 = a.userId   ? String(a.userId)            : '';
    const k2 = a.userEmail? (a.userEmail||'').toLowerCase() : '';
    const k3 = a.userName ? (a.userName ||'').toLowerCase() : '';
    if((k1 && knownKeys.has(k1))||(k2 && knownKeys.has(k2))||(k3 && knownKeys.has(k3))) return;
    const key = k1||k2||k3||'—';
    if(!orphanMap[key]) orphanMap[key]={name:a.userName||'Sem cadastro',role:a.userRole||'—',email:a.userEmail||'',vendas:0,fatVendas:0,comissaoVenda:0,montagens:0,comissaoMontagem:0,expedicoes:0,comissaoExpedicao:0,comissaoTotal:0,colab:null};
    if(a.type==='venda'){ orphanMap[key].vendas++; orphanMap[key].fatVendas+=(a.total||0); }
    if(a.type==='montagem') orphanMap[key].montagens++;
    if(a.type==='expedicao') orphanMap[key].expedicoes++;
  });
  if(!selColab) Object.values(orphanMap).forEach(o=>byUser.push(o));

  // Por entregador — usa a TAXA REAL APLICADA em cada pedido (auditoria)
  // v2: identifica o entregador por driverColabId/expedidorId/driverName
  // (qualquer um) — pedidos antigos so tem driverName, novos tem ID.
  // FIX: pra contar ENTREGAS POR DIA, usamos data de QUANDO foi entregue.
  // Cascata: deliveredAt (definida na confirmacao) → updatedAt (ultima
  // modificacao, geralmente quando virou Entregue) → createdAt (legado).
  // Antes caia no createdAt como fallback: pedidos antigos entregues
  // hoje nao apareciam. Agora updatedAt cobre 99% dos casos legados.
  const entreguesPorData = base.filter(o => {
    if (o.status !== 'Entregue') return false;
    const dataRef = o.deliveredAt || o.updatedAt || o.createdAt;
    return inPeriod(dataRef);
  });
  const byDriver={};
  const entregadoresAtivos = getColabs().filter(c => c.cargo === 'Entregador' && c.active !== false);
  entregadoresAtivos.forEach(c => {
    const key = (c.name||'').trim();
    if (key) byDriver[key] = { entregas:0, total:0, ganho:0,
      valorPorEntrega: c.metas?.valorEntrega || 0,
      colabId: c._id || c.id,
      _idsAceitos: new Set([c._id, c.id, c.backendId, (c.email||'').toLowerCase(), (c.name||'').toLowerCase()].filter(Boolean).map(String)),
      _kind: 'delivery',
    };
  });
  entreguesPorData.forEach(o=>{
    const appliedFee = (typeof o.assignedDeliveryFee === 'number') ? o.assignedDeliveryFee
                     : (typeof o.deliveryFee === 'number' ? o.deliveryFee : 0);

    // Detecta tipo: Retirada/Balcão NÃO têm entregador por natureza —
    // foram retirados pelo cliente na loja. Antes caiam em 'Sem entregador'
    // (errado). Agora vão pra categoria propria de retiradas.
    const tipo = String(o.type || o.tipo || '').toLowerCase();
    const ehRetiradaOuBalcao = tipo === 'retirada' || tipo === 'balcao' || tipo === 'balcão' || tipo.includes('retir') || tipo.includes('balc');
    if (ehRetiradaOuBalcao) {
      // Identifica unidade pra agrupar Balcão/Retirada por LOJA.
      // pickupUnit pode vir como 'cdle', 'novo_aleixo', 'allegro', etc.
      const pu = String(o.pickupUnit || o.saleUnit || o.unit || o.unidade || '').toLowerCase();
      let loja = 'Loja não identificada';
      if (pu.includes('cdle') || pu.includes('distribui')) loja = 'CDLE';
      else if (pu.includes('aleixo')) loja = 'Novo Aleixo';
      else if (pu.includes('allegro')) loja = 'Allegro Mall';
      else if (pu.includes('ecomm')) loja = 'E-commerce';
      else if (pu) loja = pu.toUpperCase();

      const ehBalcao = tipo.includes('balc');
      const emoji = ehBalcao ? '🏪' : '📦';
      const kind  = ehBalcao ? 'Balcão' : 'Retirada na loja';
      const label = `${emoji} ${kind} — ${loja}`;
      if (!byDriver[label]) byDriver[label] = {
        entregas:0, total:0, ganho:0, valorPorEntrega:0,
        colabId:null, _idsAceitos:new Set(),
        _kind: 'pickup', // marca pra separar na aba
        _loja: loja, _tipo: ehBalcao ? 'balcao' : 'retirada',
      };
      byDriver[label].entregas++;
      byDriver[label].total += (o.total||0);
      return;
    }

    // Pedido é DELIVERY — tenta identificar entregador por todos os campos
    const candidates = [
      o.driverId,
      o.driverColabId,
      o.driverBackendId,
      o.driverEmail && o.driverEmail.toLowerCase(),
      o.expedidorId,
      o.expedidorEmail && o.expedidorEmail.toLowerCase(),
      (o.driverName||'').toLowerCase(),
      (o.assignedDriverName||'').toLowerCase(),
    ].filter(Boolean).map(String);
    let key = null;
    for (const k of Object.keys(byDriver)) {
      const aceitos = byDriver[k]._idsAceitos;
      if (candidates.some(c => aceitos.has(c))) { key = k; break; }
    }
    // Fallback: usa driverName mesmo se o entregador nao esta ativo no cadastro
    if (!key) {
      const d = (o.driverName||'').trim() || (o.assignedDriverName||'').trim();
      if (!d) {
        if (!byDriver['🚚 Sem entregador (delivery)']) byDriver['🚚 Sem entregador (delivery)'] = { entregas:0, total:0, ganho:0, valorPorEntrega:0, colabId:null, _idsAceitos:new Set(), _kind:'delivery' };
        key = '🚚 Sem entregador (delivery)';
      } else {
        if (!byDriver[d]) byDriver[d] = { entregas:0, total:0, ganho:0, valorPorEntrega:0, colabId:null, _idsAceitos:new Set([d.toLowerCase()]), _kind:'delivery' };
        key = d;
      }
    }
    byDriver[key].entregas++;
    byDriver[key].total += (o.total||0);
    byDriver[key].ganho += appliedFee;
  });

  // Por pgto
  const byPay={};
  validos.forEach(o=>{const p=o.payment||'—';if(!byPay[p])byPay[p]={qty:0,total:0};byPay[p].qty++;byPay[p].total+=(o.total||0);});

  // Por canal de venda (origem do pedido — WhatsApp/Balcao/iFood/E-commerce)
  const byCanalView = {};
  validos.forEach(o => {
    const c = _canalDeVenda(o);
    if (!byCanalView[c.label]) byCanalView[c.label] = { qty:0, total:0 };
    byCanalView[c.label].qty++;
    byCanalView[c.label].total += (o.total||0);
  });

  // Por unidade
  const byUnit={};
  validos.forEach(o=>{
    const u=(o.source==='E-commerce'||(o.source||'').toLowerCase().includes('ecomm'))?'E-commerce':(o.unit||'—');
    if(!byUnit[u])byUnit[u]={qty:0,total:0};
    byUnit[u].qty++;byUnit[u].total+=(o.total||0);
  });

  const periodLabel = period === 'custom'
    ? (dt1Str && dt2Str ? `${dt1Str.split('-').reverse().join('/')} – ${dt2Str.split('-').reverse().join('/')}`
       : dt1Str          ? `A partir de ${dt1Str.split('-').reverse().join('/')}`
       : dt2Str          ? `Até ${dt2Str.split('-').reverse().join('/')}`
       : 'Período personalizado')
    : ({hoje:'Hoje',semana:'Semana',mes:'Este Mês',mes_ant:'Mês Anterior',todos:'Todo o Período'}[period]||'');

  // ── PERIODO ANTERIOR pra comparativo ─────────────────────────
  // Calcula o range equivalente "uma janela antes": para hoje, ontem;
  // para semana, semana anterior; para mês, mês anterior; etc.
  const _calcPrevRange = () => {
    const today = new Date(now);
    today.setHours(0,0,0,0);
    if (period === 'hoje') {
      const y = new Date(today); y.setDate(today.getDate()-1);
      const ini = new Date(y); ini.setHours(0,0,0,0);
      const fim = new Date(y); fim.setHours(23,59,59,999);
      return { ini, fim, label: 'Ontem' };
    }
    if (period === 'semana') {
      const ini = new Date(today); ini.setDate(today.getDate()-14);
      const fim = new Date(today); fim.setDate(today.getDate()-7); fim.setHours(23,59,59,999);
      return { ini, fim, label: 'Semana anterior' };
    }
    if (period === 'mes') {
      const m = now.getMonth()===0 ? 11 : now.getMonth()-1;
      const y = now.getMonth()===0 ? now.getFullYear()-1 : now.getFullYear();
      const ini = new Date(y, m, 1, 0,0,0,0);
      const fim = new Date(y, m+1, 0, 23,59,59,999);
      return { ini, fim, label: 'Mês anterior' };
    }
    if (period === 'mes_ant') {
      const m = now.getMonth()<=1 ? (now.getMonth()===0?10:11) : now.getMonth()-2;
      const y = now.getMonth()<=1 ? now.getFullYear()-1 : now.getFullYear();
      const ini = new Date(y, m, 1, 0,0,0,0);
      const fim = new Date(y, m+1, 0, 23,59,59,999);
      return { ini, fim, label: 'Dois meses atrás' };
    }
    if (period === 'custom' && dt1Str && dt2Str) {
      const d1 = new Date(dt1Str + 'T00:00:00');
      const d2 = new Date(dt2Str + 'T23:59:59.999');
      const diasDur = Math.max(1, Math.round((d2-d1)/86400000));
      const ini = new Date(d1); ini.setDate(d1.getDate()-diasDur);
      const fim = new Date(d1); fim.setMilliseconds(-1);
      return { ini, fim, label: `${diasDur} dias antes` };
    }
    return null; // 'todos' não tem comparativo
  };
  const prevRange = _calcPrevRange();
  const prevValidos = prevRange
    ? base.filter(o => {
        const d = new Date(o.createdAt);
        return !isNaN(d.getTime()) && d >= prevRange.ini && d <= prevRange.fim && _ehVendaValida(o);
      })
    : [];
  const totalAtual    = validos.reduce((s,o) => s + (o.total||0), 0);
  const totalAnterior = prevValidos.reduce((s,o) => s + (o.total||0), 0);
  const variacao = totalAnterior > 0 ? ((totalAtual - totalAnterior) / totalAnterior) * 100 : (totalAtual > 0 ? 100 : 0);

  // Agrupa por dia (YYYY-MM-DD) pro grafico
  const _byDay = (orders) => {
    const map = {};
    orders.forEach(o => {
      const d = _dManaus(o.createdAt);
      if (!d) return;
      map[d] = (map[d] || 0) + (o.total||0);
    });
    return map;
  };
  const atualByDay = _byDay(validos);
  const anteriorByDay = _byDay(prevValidos);

  // Helpers comuns para os gráficos comparativos
  const fmtBrl = (v) => v >= 1000 ? `R$${(v/1000).toFixed(1)}k` : `R$${Math.round(v)}`;
  const fmtPct = (n) => `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(1)}%`;
  const corPct = (n) => n >= 0 ? '#166534' : '#991B1B';
  const corBgPct = (n) => n >= 0 ? '#DCFCE7' : '#FEE2E2';
  const corBorderPct = (n) => n >= 0 ? '#86EFAC' : '#FCA5A5';
  const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const calcVar = (a, b) => b > 0 ? ((a - b) / b) * 100 : (a > 0 ? 100 : 0);

  // Detecta se o periodo eh "semana" — mostra dia da semana no eixo X
  const ehPeriodoComDiasSemana = () => {
    if (period === 'semana') return true;
    if (period === 'custom' && dt1Str && dt2Str) {
      const dias = Math.round((new Date(dt2Str)-new Date(dt1Str))/86400000) + 1;
      return dias >= 5 && dias <= 14;
    }
    return false;
  };

  // ── KPIs adicionais pro comparativo ────────────────────────
  const ticketAtual = validos.length > 0 ? totalAtual / validos.length : 0;
  const ticketAnterior = prevValidos.length > 0 ? totalAnterior / prevValidos.length : 0;
  const variaPedidos = calcVar(validos.length, prevValidos.length);
  const variaTicket  = calcVar(ticketAtual, ticketAnterior);
  const itensAtual    = validos.reduce((s,o) => s + (o.items||[]).reduce((x,i)=>x+(i.qty||1),0), 0);
  const itensAnterior = prevValidos.reduce((s,o) => s + (o.items||[]).reduce((x,i)=>x+(i.qty||1),0), 0);
  const variaItens   = calcVar(itensAtual, itensAnterior);

  // ── Render do bloco de KPIs (6 cards) ──────────────────────
  const _renderKpis = () => {
    const kpis = [
      { label: 'Receita',       atual: $c(totalAtual),    anterior: $c(totalAnterior),    delta: variacao },
      { label: 'Nº de Pedidos', atual: validos.length,    anterior: prevValidos.length,    delta: variaPedidos },
      { label: 'Ticket Médio',  atual: $c(ticketAtual),   anterior: $c(ticketAnterior),    delta: variaTicket },
      { label: 'Itens Vendidos',atual: itensAtual,        anterior: itensAnterior,         delta: variaItens },
    ];
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px;">
      ${kpis.map(k => `
      <div style="background:linear-gradient(135deg,${corBgPct(k.delta)},#fff);border:1px solid ${corBorderPct(k.delta)};border-radius:10px;padding:12px;">
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.5px;font-weight:700;">${k.label}</div>
        <div style="font-size:18px;font-weight:800;color:#1E293B;margin-top:3px;">${k.atual}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:1px;">Antes: <strong>${k.anterior}</strong></div>
        <div style="font-size:11px;font-weight:700;color:${corPct(k.delta)};margin-top:4px;">${fmtPct(k.delta)}</div>
      </div>`).join('')}
    </div>`;
  };

  // ── Gráfico SVG base (receita por dia) ─────────────────────
  const _renderCompareChart = () => {
    if (!prevRange || (validos.length === 0 && prevValidos.length === 0)) return '';
    const diasAtual = Object.keys(atualByDay).sort();
    const diasAnterior = Object.keys(anteriorByDay).sort();
    const N = Math.max(diasAtual.length, diasAnterior.length, 1);
    if (N > 31) return '';
    const useDow = ehPeriodoComDiasSemana();
    const len = Math.max(diasAtual.length, diasAnterior.length, useDow ? 7 : 1);
    const dataPoints = [];
    for (let i = 0; i < len; i++) {
      const dA = diasAtual[i];
      const dB = diasAnterior[i];
      const dowA = dA ? new Date(dA + 'T12:00:00').getDay() : null;
      dataPoints.push({
        labelDateA: dA ? dA.split('-').reverse().slice(0,2).join('/') : '',
        labelDowA: dowA != null ? DIAS_SEMANA[dowA] : '',
        valA: dA ? atualByDay[dA] : 0,
        labelDateB: dB ? dB.split('-').reverse().slice(0,2).join('/') : '',
        valB: dB ? anteriorByDay[dB] : 0,
      });
    }
    const maxVal = Math.max(...dataPoints.map(p => Math.max(p.valA, p.valB)), 1);
    const w = 740, h = 240, padL = 50, padR = 20, padT = 20, padB = useDow ? 56 : 40;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const groupW = innerW / dataPoints.length;
    const barW = Math.min(groupW * 0.35, 22);

    const bars = dataPoints.map((p, i) => {
      const cx = padL + i * groupW + groupW/2;
      const hA = (p.valA / maxVal) * innerH;
      const hB = (p.valB / maxVal) * innerH;
      const yA = padT + innerH - hA;
      const yB = padT + innerH - hB;
      const xB = cx - barW - 1;
      const xA = cx + 1;
      return `
        <rect x="${xB}" y="${yB}" width="${barW}" height="${hB}" fill="#CBD5E1" rx="2">
          <title>${p.labelDateB || '—'}: ${fmtBrl(p.valB)} (anterior)</title>
        </rect>
        <rect x="${xA}" y="${yA}" width="${barW}" height="${hA}" fill="#C8736A" rx="2">
          <title>${p.labelDateA || '—'}${p.labelDowA?' ('+p.labelDowA+')':''}: ${fmtBrl(p.valA)} (atual)</title>
        </rect>
        ${useDow && p.labelDowA ? `<text x="${cx}" y="${h-padB+14}" text-anchor="middle" font-size="10" fill="#1E293B" font-weight="700">${p.labelDowA}</text>` : ''}
        ${p.labelDateA ? `<text x="${cx}" y="${h-padB+(useDow?28:14)}" text-anchor="middle" font-size="9" fill="#64748B">${p.labelDateA}</text>` : ''}
      `;
    }).join('');

    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = padT + innerH - innerH * f;
      const v = maxVal * f;
      return `
        <line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="2 3"/>
        <text x="${padL-5}" y="${y+3}" text-anchor="end" font-size="9" fill="#94A3B8">${fmtBrl(v)}</text>
      `;
    }).join('');

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <span>📊 Comparativo: ${periodLabel} vs ${prevRange.label}</span>
          <span style="display:flex;gap:14px;font-size:11px;font-weight:500;">
            <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#C8736A;border-radius:2px;display:inline-block;"></span>Atual</span>
            <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#CBD5E1;border-radius:2px;display:inline-block;"></span>Anterior</span>
          </span>
        </div>
        ${_renderKpis()}
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
          ${grid}
          ${bars}
        </svg>
        <div style="text-align:center;font-size:10px;color:var(--muted);margin-top:6px;">Receita por dia${useDow?' · dias da semana indicados':''}</div>
      </div>
    `;
  };
  const compareChartHtml = _renderCompareChart();

  // ── Análise por DIA DA SEMANA (agrega cumulativo, ideal pra ranges longos) ──
  // Mostra qual dia da semana vende mais em media, comparando atual vs anterior.
  const _renderDowAnalysis = () => {
    if (!prevRange) return '';
    const ehSemana = period === 'semana' || (period === 'custom' && dt1Str && dt2Str);
    const diasInterval = period === 'custom' && dt1Str && dt2Str
      ? Math.round((new Date(dt2Str)-new Date(dt1Str))/86400000) + 1
      : (period === 'semana' ? 7 : 0);
    if (!ehSemana && period !== 'mes' && period !== 'mes_ant') return '';
    if (period === 'custom' && diasInterval < 7) return '';

    const agregaDow = (orders) => {
      const arr = [0,0,0,0,0,0,0];
      const counts = [0,0,0,0,0,0,0];
      orders.forEach(o => {
        const d = new Date(o.createdAt);
        if (isNaN(d.getTime())) return;
        const dow = d.getDay();
        arr[dow] += (o.total||0);
        counts[dow]++;
      });
      return { totais: arr, contagens: counts };
    };
    const dowAtual = agregaDow(validos);
    const dowAnt   = agregaDow(prevValidos);
    const maxV = Math.max(...dowAtual.totais, ...dowAnt.totais, 1);
    if (maxV <= 0) return '';

    const dadosDow = DIAS_SEMANA.map((nome, i) => ({
      nome,
      atual: dowAtual.totais[i],
      anterior: dowAnt.totais[i],
      qtyAtual: dowAtual.contagens[i],
      qtyAnt: dowAnt.contagens[i],
    }));
    // Melhor dia da semana (atual)
    const melhorAtual = [...dadosDow].sort((a,b)=>b.atual-a.atual)[0];
    const piorAtual = [...dadosDow].filter(d=>d.atual>0).sort((a,b)=>a.atual-b.atual)[0];

    const w = 740, h = 220, padL = 50, padR = 20, padT = 20, padB = 56;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const groupW = innerW / 7;
    const barW = Math.min(groupW * 0.32, 28);

    const bars = dadosDow.map((d, i) => {
      const cx = padL + i * groupW + groupW/2;
      const hA = (d.atual / maxV) * innerH;
      const hB = (d.anterior / maxV) * innerH;
      const yA = padT + innerH - hA;
      const yB = padT + innerH - hB;
      const xB = cx - barW - 2;
      const xA = cx + 2;
      const isMelhor = d.nome === melhorAtual?.nome && d.atual > 0;
      return `
        <rect x="${xB}" y="${yB}" width="${barW}" height="${hB}" fill="#CBD5E1" rx="2"><title>${d.nome}: ${fmtBrl(d.anterior)} · ${d.qtyAnt} pedidos (anterior)</title></rect>
        <rect x="${xA}" y="${yA}" width="${barW}" height="${hA}" fill="${isMelhor?'#15803D':'#C8736A'}" rx="2"><title>${d.nome}: ${fmtBrl(d.atual)} · ${d.qtyAtual} pedidos (atual)</title></rect>
        ${isMelhor && d.atual > 0 ? `<text x="${cx}" y="${yA-4}" text-anchor="middle" font-size="9" fill="#15803D" font-weight="700">🏆</text>` : ''}
        <text x="${cx}" y="${h-padB+14}" text-anchor="middle" font-size="12" fill="#1E293B" font-weight="700">${d.nome}</text>
        <text x="${cx}" y="${h-padB+28}" text-anchor="middle" font-size="9" fill="#64748B">${d.qtyAtual} ped.</text>
      `;
    }).join('');

    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = padT + innerH - innerH * f;
      const v = maxV * f;
      return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="2 3"/><text x="${padL-5}" y="${y+3}" text-anchor="end" font-size="9" fill="#94A3B8">${fmtBrl(v)}</text>`;
    }).join('');

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">📅 Análise por dia da semana — ${periodLabel}</div>
        ${melhorAtual && melhorAtual.atual > 0 ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px;">
          <div style="background:linear-gradient(135deg,#DCFCE7,#fff);border:1px solid #86EFAC;border-radius:10px;padding:10px 12px;">
            <div style="font-size:10px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">🏆 Melhor dia (atual)</div>
            <div style="font-size:15px;font-weight:800;color:#14532D;margin-top:3px;">${melhorAtual.nome}-feira · ${fmtBrl(melhorAtual.atual)}</div>
            <div style="font-size:10px;color:#166534;">${melhorAtual.qtyAtual} pedidos</div>
          </div>
          ${piorAtual && piorAtual.nome !== melhorAtual.nome ? `
          <div style="background:linear-gradient(135deg,#FEE2E2,#fff);border:1px solid #FCA5A5;border-radius:10px;padding:10px 12px;">
            <div style="font-size:10px;color:#991B1B;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">📉 Dia mais fraco</div>
            <div style="font-size:15px;font-weight:800;color:#7F1D1D;margin-top:3px;">${piorAtual.nome}-feira · ${fmtBrl(piorAtual.atual)}</div>
            <div style="font-size:10px;color:#991B1B;">${piorAtual.qtyAtual} pedidos</div>
          </div>` : ''}
        </div>` : ''}
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">${grid}${bars}</svg>
        <div style="text-align:center;font-size:10px;color:var(--muted);margin-top:6px;">Receita acumulada por dia da semana · 🏆 destaca o melhor</div>
      </div>
    `;
  };
  const dowChartHtml = _renderDowAnalysis();

  // ── Comparativo por FORMA DE PAGAMENTO (atual vs anterior) ──
  const _renderPagamentoCompare = () => {
    if (!prevRange) return '';
    const agrega = (orders) => {
      const m = {};
      orders.forEach(o => {
        const p = o.payment || '—';
        m[p] = (m[p] || 0) + (o.total || 0);
      });
      return m;
    };
    const a = agrega(validos), b = agrega(prevValidos);
    const formas = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    if (formas.length === 0) return '';
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">💳 Comparativo por forma de pagamento</div>
        <div class="tw"><table>
          <thead><tr><th style="text-align:left;">Forma</th><th style="text-align:right;">Atual</th><th style="text-align:right;">Anterior</th><th style="text-align:right;">Variação</th></tr></thead>
          <tbody>
          ${formas.map(f => {
            const v = calcVar(a[f]||0, b[f]||0);
            return `<tr>
              <td style="font-weight:600;">${f}</td>
              <td style="text-align:right;font-weight:700;color:#9F1239;">${$c(a[f]||0)}</td>
              <td style="text-align:right;color:#64748B;">${$c(b[f]||0)}</td>
              <td style="text-align:right;font-weight:700;color:${corPct(v)};">${fmtPct(v)}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  };
  const pagCompareHtml = _renderPagamentoCompare();

  // ── Comparativo de horários de pico ────────────────────────
  const _renderHoraPicoCompare = () => {
    if (!prevRange) return '';
    const horaAtual = new Array(24).fill(0);
    const horaAnt = new Array(24).fill(0);
    validos.forEach(o => {
      const d = new Date(o.createdAt);
      if (!isNaN(d.getTime())) horaAtual[d.getHours()] += (o.total||0);
    });
    prevValidos.forEach(o => {
      const d = new Date(o.createdAt);
      if (!isNaN(d.getTime())) horaAnt[d.getHours()] += (o.total||0);
    });
    const max = Math.max(...horaAtual, ...horaAnt, 1);
    if (max <= 0) return '';
    const picoAtual = horaAtual.indexOf(Math.max(...horaAtual));
    const picoAnt   = horaAnt.indexOf(Math.max(...horaAnt));
    const w = 740, h = 180, padL = 50, padR = 20, padT = 16, padB = 32;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const stepX = innerW / 23;
    // Polilinhas (line chart)
    const polyA = horaAtual.map((v,i) => `${padL + i*stepX},${padT + innerH - (v/max)*innerH}`).join(' ');
    const polyB = horaAnt.map((v,i) => `${padL + i*stepX},${padT + innerH - (v/max)*innerH}`).join(' ');
    const ticks = [0,4,8,12,16,20,23].map(i => `<text x="${padL+i*stepX}" y="${h-padB+12}" text-anchor="middle" font-size="9" fill="#64748B">${String(i).padStart(2,'0')}h</text>`).join('');
    const grid = [0, 0.5, 1].map(f => {
      const y = padT + innerH - innerH * f;
      const v = max * f;
      return `<line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="2 3"/><text x="${padL-5}" y="${y+3}" text-anchor="end" font-size="9" fill="#94A3B8">${fmtBrl(v)}</text>`;
    }).join('');
    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <span>⏰ Horários de pico (vendas por hora)</span>
          <span style="display:flex;gap:14px;font-size:11px;font-weight:500;">
            <span style="display:flex;align-items:center;gap:5px;"><span style="width:14px;height:3px;background:#C8736A;display:inline-block;"></span>Atual</span>
            <span style="display:flex;align-items:center;gap:5px;"><span style="width:14px;height:3px;background:#CBD5E1;display:inline-block;"></span>Anterior</span>
          </span>
        </div>
        <div style="display:flex;gap:10px;font-size:11px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="background:#FAE8E6;border:1px solid #FCD9D2;border-radius:8px;padding:6px 10px;"><strong style="color:#9F1239;">🔥 Pico atual:</strong> ${String(picoAtual).padStart(2,'0')}h</span>
          <span style="background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;padding:6px 10px;"><strong style="color:#475569;">Pico anterior:</strong> ${String(picoAnt).padStart(2,'0')}h</span>
        </div>
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
          ${grid}
          <polyline points="${polyB}" fill="none" stroke="#CBD5E1" stroke-width="2.5"/>
          <polyline points="${polyA}" fill="none" stroke="#C8736A" stroke-width="3"/>
          ${ticks}
        </svg>
      </div>
    `;
  };
  const horaPicoHtml = _renderHoraPicoCompare();

  // Junta tudo num bloco unico (so na aba Geral)
  const compareBlockHtml = compareChartHtml + dowChartHtml + pagCompareHtml + horaPicoHtml;

  const tabBtn=(k,l)=>`<button class="tab ${tab===k?'active':''}" data-rel-tab="${k}">${l}</button>`;

  return`
<!-- Filtros -->
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <div style="display:flex;gap:3px;">
      ${[{k:'hoje',l:'Hoje'},{k:'semana',l:'Semana'},{k:'mes',l:'Este Mês'},{k:'mes_ant',l:'Mês Ant.'},{k:'todos',l:'Todos'}].map(p=>`
      <button class="btn btn-sm ${period===p.k?'btn-primary':'btn-ghost'}" data-rel-period="${p.k}">${p.l}</button>`).join('')}
      <button class="btn btn-sm ${period==='custom'?'btn-primary':'btn-ghost'}" data-rel-period="custom">📅 Por Datas</button>
    </div>
    ${(( S.user?.role==='Administrador'||S.user?.cargo==='admin')||S.user.role==='Gerente')?`
    <select class="fi" id="rel-unit-filter" style="width:auto;">
      <option value="">Todas as unidades</option>
      <option value="Loja Novo Aleixo" ${unit==='Loja Novo Aleixo'?'selected':''}>N. Aleixo</option>
      <option value="Loja Allegro Mall" ${unit==='Loja Allegro Mall'?'selected':''}>Allegro</option>
      <option value="CDLE" ${unit==='CDLE'?'selected':''}>CDLE</option>
      <option value="E-commerce" ${unit==='E-commerce'?'selected':''}>Site</option>
    </select>`:''}
    <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Imprimir Tela</button>
    <button class="btn btn-primary btn-sm" id="btn-rel-recibo" title="Recibo detalhado pronto pra imprimir (semana/mês/datas)">📄 Recibo Detalhado</button>
  </div>

  ${period==='custom' ? `
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;padding:10px 12px;background:linear-gradient(135deg,#FDF2F8,#FCE7F3);border:1px solid #F9A8D4;border-radius:8px;">
    <span style="font-size:12px;font-weight:700;color:#9D174D;">📅 Consulta por datas específicas:</span>
    <div class="fg" style="margin:0;">
      <label class="fl" style="font-size:10px;margin-bottom:2px;">Data inicial</label>
      <input type="date" class="fi" id="rel-date-1" value="${dt1Str}" style="width:auto;min-width:150px;"/>
    </div>
    <div class="fg" style="margin:0;">
      <label class="fl" style="font-size:10px;margin-bottom:2px;">Data final</label>
      <input type="date" class="fi" id="rel-date-2" value="${dt2Str}" style="width:auto;min-width:150px;"/>
    </div>
    ${(dt1Str||dt2Str) ? `<button class="btn btn-ghost btn-sm" id="rel-date-clear" style="color:var(--red);">🗑️ Limpar</button>` : ''}
    <span style="font-size:11px;color:var(--muted);font-style:italic;">Aplica a todas as abas de relatório (vendas, produtos, entregadores, etc.)</span>
  </div>` : ''}
</div>

<!-- KPIs -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Pedidos</div><div class="mc-val">${filtered.length}</div><div class="mc-sub">${validos.length} válidos</div></div>
  <div class="mc leaf"><div class="mc-label">Faturamento</div><div class="mc-val">${$c(fat)}</div><div class="mc-sub">${periodLabel}</div></div>
  <div class="mc gold"><div class="mc-label">Ticket Médio</div><div class="mc-val">${$c(ticket)}</div></div>
  <div class="mc purple"><div class="mc-label">Entregues</div><div class="mc-val">${entregues.length}</div></div>
</div>

<!-- Tabs de relatorio -->
<div class="tabs" style="margin-bottom:14px;">
  ${tabBtn('geral','📊 Geral')}
  ${tabBtn('usuarios','👩‍💼 Por Usuário')}
  ${tabBtn('entregadores','🚚 Entregadores')}
  ${tabBtn('produtos','🌹 Produtos')}
  ${tabBtn('vendas','💰 Vendas Detail')}
  ${tabBtn('vendasUnidade','🏪 Vendas por Unidade')}
  ${tabBtn('caixa','💵 Caixa Completo')}
  ${tabBtn('montagens','🌿 Montagens')}
  ${tabBtn('clientes','👥 Clientes')}
  ${(S.user?.cargo==='admin'||S.user?.role==='Administrador'||(S.user?.modulos&&S.user.modulos.reportsOperacao===true))?tabBtn('operacao','⏰ Operação'):''}
  ${tabBtn('altademanda','💐 Alta Demanda')}
  ${tabBtn('porColaborador','👤 Por Colaborador')}
  ${tabBtn('chaoDatas','🌹 Chão de Datas Comemorativas')}
  ${(S.user?.cargo==='admin'||S.user?.role==='Administrador'||S.user?.role==='Gerente'||S.user?.cargo==='gerente') ? tabBtn('acessosOffHours','🌙 Acessos Fora do Horário') : ''}
  ${tabBtn('custom','📋 Meus Relatórios')}
</div>

<!-- TAB: GERAL -->
${tab==='geral'?`
${compareBlockHtml}
<div class="g2">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">🏆 Mais Vendidos</div>
      ${prodList.length===0?`<div class="empty"><p>Sem dados</p></div>`:
      prodList.slice(0,10).map(([n,{qty,rev}],i)=>`
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span><strong style="color:var(--rose)">#${i+1}</strong> ${n}</span>
          <span style="color:var(--muted)">${qty}un · <strong>${$c(rev)}</strong></span>
        </div>
        <div class="pb"><div class="pf" style="width:${Math.round((rev/maxRev)*100)}%;background:${i<3?'var(--rose)':'var(--rose-l)'}"></div></div>
      </div>`).join('')}
    </div>
    <div class="card">
      <div class="card-title">📉 Menos Vendidos</div>
      ${prodList.length===0?`<div class="empty"><p>Sem dados</p></div>`:
      [...prodList].reverse().slice(0,5).map(([n,{qty,rev}])=>`
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span>${n}</span><span style="color:var(--muted)">${qty}un · ${$c(rev)}</span>
      </div>`).join('')}
    </div>
  </div>
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">💳 Por Forma de Pagamento</div>
      ${Object.entries(byPay).map(([p,{qty,total}])=>`
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span>${p} <span style="color:var(--muted)">(${qty})</span></span>
        <span style="font-weight:600">${$c(total)}</span>
      </div>`).join('')||`<div class="empty" style="padding:12px"><p>Sem dados</p></div>`}
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📡 Por Canal de Venda</div>
      ${Object.entries(byCanalView).sort((a,b)=>b[1].total-a[1].total).map(([k,{qty,total}])=>`
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span>${k} <span style="color:var(--muted)">(${qty})</span></span>
        <span style="font-weight:600">${$c(total)}</span>
      </div>`).join('')||`<div class="empty" style="padding:12px"><p>Sem dados</p></div>`}
    </div>
    ${(( S.user?.role==='Administrador'||S.user?.cargo==='admin')||S.user.role==='Gerente')?`
    <div class="card">
      <div class="card-title">🏪 Por Unidade</div>
      ${Object.entries(byUnit).map(([u,{qty,total}])=>`
      <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span style="font-weight:500">${u}</span><span>${qty} pedidos · ${$c(total)}</span>
        </div>
        <div class="pb"><div class="pf" style="width:${Math.round((total/Math.max(...Object.values(byUnit).map(b=>b.total),1))*100)}%;background:var(--leaf)"></div></div>
      </div>`).join('')||`<div class="empty" style="padding:12px"><p>Sem dados</p></div>`}
    </div>`:''}
  </div>
</div>`:''}

<!-- TAB: POR USUARIO / COLABORADORES -->
${tab==='usuarios'?(()=>{
  const subTab = S._relUsuariosSub || 'resumo'; // resumo | detalhe
  const subBtn = (k, label) => `<button type="button" class="tab ${subTab===k?'active':''}" data-rel-usuarios-sub="${k}" style="font-size:12px;">${label}</button>`;

  return `
<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="rel-colab-filter" style="width:auto;min-width:220px;">
    <option value="">Todos os colaboradores</option>
    ${colabsAll.filter(c=>c.cargo!=='Entregador').map(c=>`<option value="${c.id||c.backendId||c.email}" ${selColab===(c.id||c.backendId||c.email)?'selected':''}>${c.name} — ${c.cargo||'—'}</option>`).join('')}
  </select>
  <div style="font-size:12px;color:var(--muted)">${periodLabel} · ${byUser.length} colaborador(es)</div>
</div>

<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('resumo',  '📊 Resumo (todos)')}
  ${subBtn('detalhe', '📋 Detalhe Individual (dia a dia)')}
</div>

${subTab === 'resumo' ? `
<div class="card">
  <div class="card-title">👩‍💼 Comissões & Desempenho — ${periodLabel}</div>
  ${byUser.length===0?`<div class="empty"><div class="empty-icon">👩‍💼</div><p>Sem colaboradores ou atividades no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr>
      <th>Colaborador</th><th>Cargo</th>
      <th>Vendas</th><th>Fat. Vendas</th><th>Comissão Vendas</th>
      <th>Montagens</th><th>Comissão Mont.</th>
      <th>Expedições</th><th>Comissão Exp.</th>
      <th>Total Comissão</th>
    </tr></thead>
    <tbody>
    ${[...byUser].sort((a,b)=>(b.comissaoTotal||0)-(a.comissaoTotal||0)).map(u=>{
      const mt=u.colab?.metas||{};
      const pctV=Number(mt.comissaoVenda??mt.vendaPct??0)||0;
      const vM=Number(mt.comissaoMontagem??0)||0;
      const vE=Number(mt.comissaoExpedicao??0)||0;
      return`<tr>
        <td style="font-weight:600">${u.name}${u.email?`<div style="font-size:10px;color:var(--muted)">${u.email}</div>`:''}</td>
        <td><span class="tag ${rolec(u.role)}">${u.role}</span></td>
        <td style="font-weight:600;color:var(--rose)">${u.vendas}</td>
        <td style="color:var(--leaf)">${$c(u.fatVendas)}</td>
        <td style="font-weight:700;color:var(--leaf)">${$c(u.comissaoVenda)}<div style="font-size:10px;color:var(--muted)">${pctV?pctV+'%':'—'}</div></td>
        <td style="color:var(--gold)">${u.montagens}</td>
        <td style="font-weight:700;color:var(--gold)">${$c(u.comissaoMontagem)}<div style="font-size:10px;color:var(--muted)">${vM?'R$ '+vM.toFixed(2)+'/un':'—'}</div></td>
        <td style="color:var(--purple)">${u.expedicoes}</td>
        <td style="font-weight:700;color:var(--purple)">${$c(u.comissaoExpedicao)}<div style="font-size:10px;color:var(--muted)">${vE?'R$ '+vE.toFixed(2)+'/un':'—'}</div></td>
        <td style="font-weight:800;color:var(--primary);font-size:14px">${$c(u.comissaoTotal)}</td>
      </tr>`;}).join('')}
    </tbody>
    <tfoot>
      <tr style="background:var(--cream);font-weight:700;">
        <td colspan="2">TOTAL</td>
        <td>${byUser.reduce((s,u)=>s+u.vendas,0)}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.fatVendas,0))}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.comissaoVenda,0))}</td>
        <td>${byUser.reduce((s,u)=>s+u.montagens,0)}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.comissaoMontagem,0))}</td>
        <td>${byUser.reduce((s,u)=>s+u.expedicoes,0)}</td>
        <td>${$c(byUser.reduce((s,u)=>s+u.comissaoExpedicao,0))}</td>
        <td style="color:var(--primary)">${$c(byUser.reduce((s,u)=>s+u.comissaoTotal,0))}</td>
      </tr>
    </tfoot>
  </table></div>`}
</div>
` : renderUsuarioDetalhe(byUser, selColab, colabsAll, inPeriod, periodLabel)}
`;
})():''}

<!-- TAB: ENTREGADORES -->
${tab==='entregadores'?(()=>{
  // ── Filtro EXCLUSIVO da aba Entregadores (independente do filtro global) ──
  // Marcia pediu (23/mai/2026): hoje / semana / mes / data customizada
  const entregPer = S._relEntregPeriodo || 'global'; // 'global' usa filtro do topo
  const eD1 = S._relEntregD1 || '';
  const eD2 = S._relEntregD2 || '';
  const _nowM = new Date();
  const _hoje0 = new Date(_nowM); _hoje0.setHours(0,0,0,0);
  const _hojeF = new Date(_nowM); _hojeF.setHours(23,59,59,999);
  let entregIni = null, entregFim = null;
  if (entregPer === 'hoje')      { entregIni = _hoje0; entregFim = _hojeF; }
  else if (entregPer === 'semana'){ entregIni = new Date(_hoje0); entregIni.setDate(_hoje0.getDate()-7); entregFim = _hojeF; }
  else if (entregPer === 'mes')   { entregIni = new Date(_nowM.getFullYear(), _nowM.getMonth(), 1); entregFim = new Date(_nowM.getFullYear(), _nowM.getMonth()+1, 0, 23,59,59,999); }
  else if (entregPer === 'custom'){
    if (eD1) entregIni = new Date(eD1+'T00:00:00');
    if (eD2) entregFim = new Date(eD2+'T23:59:59');
  }
  // Se entregPer === 'global', usa byDriver original (sem refiltro)
  // Senao, recalcula tudo a partir de `base` (pedidos da loja) com novo periodo
  const usaFiltroProprio = entregPer !== 'global';
  let byDriverFiltrado = byDriver;
  if (usaFiltroProprio) {
    const _entreguesLocal = base.filter(o => {
      if (o.status !== 'Entregue') return false;
      const ts = o.deliveredAt || o.updatedAt || o.createdAt;
      if (!ts) return false;
      const dt = new Date(ts);
      if (isNaN(dt.getTime())) return false;
      if (entregIni && dt < entregIni) return false;
      if (entregFim && dt > entregFim) return false;
      return true;
    });
    byDriverFiltrado = {};
    // Recria estrutura com mesmo formato do byDriver original
    entregadoresAtivos.forEach(c => {
      const key = (c.name||'').trim();
      if (key) byDriverFiltrado[key] = {
        entregas:0, total:0, ganho:0,
        valorPorEntrega: c.metas?.valorEntrega || 0,
        colabId: c._id || c.id,
        _idsAceitos: new Set([c._id, c.id, c.backendId, (c.email||'').toLowerCase(), (c.name||'').toLowerCase()].filter(Boolean).map(String)),
        _kind: 'delivery',
      };
    });
    _entreguesLocal.forEach(o => {
      const appliedFee = (typeof o.assignedDeliveryFee === 'number') ? o.assignedDeliveryFee
                       : (typeof o.deliveryFee === 'number' ? o.deliveryFee : 0);
      const tipo = String(o.type || o.tipo || '').toLowerCase();
      const ehRetiradaOuBalcao = tipo === 'retirada' || tipo === 'balcao' || tipo === 'balcão' || tipo.includes('retir') || tipo.includes('balc');
      if (ehRetiradaOuBalcao) {
        const pu = String(o.pickupUnit || o.saleUnit || o.unit || o.unidade || '').toLowerCase();
        let loja = 'Loja não identificada';
        if (pu.includes('cdle') || pu.includes('distribui')) loja = 'CDLE';
        else if (pu.includes('aleixo')) loja = 'Novo Aleixo';
        else if (pu.includes('allegro')) loja = 'Allegro Mall';
        else if (pu.includes('ecomm')) loja = 'E-commerce';
        else if (pu) loja = pu.toUpperCase();
        const ehBalcao = tipo.includes('balc');
        const emoji = ehBalcao ? '🏪' : '📦';
        const kind  = ehBalcao ? 'Balcão' : 'Retirada na loja';
        const label = `${emoji} ${kind} — ${loja}`;
        if (!byDriverFiltrado[label]) byDriverFiltrado[label] = {
          entregas:0, total:0, ganho:0, valorPorEntrega:0,
          colabId:null, _idsAceitos:new Set(),
          _kind: 'pickup',
        };
        byDriverFiltrado[label].entregas++;
        byDriverFiltrado[label].total += (o.total||0);
        return;
      }
      // Delivery normal — acha o entregador
      const candidatos = [
        o.driverId, o.driverColabId, o.driverBackendId,
        o.driverEmail && String(o.driverEmail).toLowerCase(),
        o.expedidorId, o.expedidorEmail && String(o.expedidorEmail).toLowerCase(),
        (o.driverName||'').toLowerCase(),
      ].filter(Boolean).map(String);
      for (const nome of Object.keys(byDriverFiltrado)) {
        const entry = byDriverFiltrado[nome];
        if (entry._kind !== 'delivery') continue;
        if (candidatos.some(c => entry._idsAceitos.has(c))) {
          entry.entregas++;
          entry.total += (o.total||0);
          entry.ganho += appliedFee;
          return;
        }
      }
      // Nao encontrado — driverName livre
      const nomeFallback = o.driverName || 'Sem entregador';
      if (!byDriverFiltrado[nomeFallback]) byDriverFiltrado[nomeFallback] = {
        entregas:0, total:0, ganho:0, valorPorEntrega:0,
        colabId:null, _idsAceitos:new Set([nomeFallback.toLowerCase()]),
        _kind: 'delivery',
      };
      byDriverFiltrado[nomeFallback].entregas++;
      byDriverFiltrado[nomeFallback].total += (o.total||0);
      byDriverFiltrado[nomeFallback].ganho += appliedFee;
    });
  }
  const labelPeriodoLocal = entregPer === 'hoje' ? 'Hoje'
                          : entregPer === 'semana' ? 'Últimos 7 dias'
                          : entregPer === 'mes' ? 'Este mês'
                          : entregPer === 'custom' ? (eD1 && eD2 ? `${eD1} a ${eD2}` : (eD1 ? `Desde ${eD1}` : `Até ${eD2}`))
                          : periodLabel;
  const perBtn = (k, l) => `<button type="button" class="btn btn-xs ${entregPer===k?'btn-primary':'btn-ghost'}" data-entreg-per="${k}">${l}</button>`;

  // ── Sub-abas: separa Delivery (entregadores reais) de Retirada/Balcao
  // (pedidos pegos na loja, sem entregador).
  const subEntreg = S._relEntregSub || 'delivery';
  const isDelivery = (entry) => (entry[1]?._kind || 'delivery') === 'delivery';
  const isPickup   = (entry) => entry[1]?._kind === 'pickup';
  const entradasDel = Object.entries(byDriverFiltrado).filter(isDelivery);
  const entradasPic = Object.entries(byDriverFiltrado).filter(isPickup);
  const totEntregasDel = entradasDel.reduce((s,[,v])=>s+(v.entregas||0),0);
  const totEntregasPic = entradasPic.reduce((s,[,v])=>s+(v.entregas||0),0);
  const subBtn = (k, label, count) => `<button type="button" class="tab ${subEntreg===k?'active':''}" data-rel-entreg-sub="${k}" style="font-size:12px;">${label} <span style="background:rgba(0,0,0,.08);border-radius:10px;padding:1px 8px;margin-left:4px;font-size:10px;">${count}</span></button>`;
  // Filtra qual conjunto exibir
  const entradasView = subEntreg === 'pickup' ? entradasPic : entradasDel;

  return `
<!-- Filtro EXCLUSIVO da aba Entregadores -->
<div class="card" style="margin-bottom:12px;padding:10px 12px;background:linear-gradient(135deg,#EFF6FF,#fff);border:1px solid #BFDBFE;">
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <span style="font-size:12px;font-weight:700;color:#1E3A8A;">📅 Filtrar entregas:</span>
    ${perBtn('global', 'Período global')}
    ${perBtn('hoje',   '📅 Hoje')}
    ${perBtn('semana', '📆 Últimos 7 dias')}
    ${perBtn('mes',    '🗓️ Este mês')}
    ${perBtn('custom', '🎯 Data específica')}
    ${entregPer === 'custom' ? `
      <div style="display:flex;gap:6px;align-items:center;margin-left:6px;">
        <label style="font-size:11px;color:#1E3A8A;">De:</label>
        <input type="date" class="fi" id="rel-entreg-d1" value="${eD1}" style="width:auto;font-size:12px;padding:4px 8px;"/>
        <label style="font-size:11px;color:#1E3A8A;">Até:</label>
        <input type="date" class="fi" id="rel-entreg-d2" value="${eD2}" style="width:auto;font-size:12px;padding:4px 8px;"/>
      </div>
    ` : ''}
    <div style="margin-left:auto;font-size:11px;color:#1E40AF;font-weight:600;background:#DBEAFE;padding:4px 10px;border-radius:12px;">
      ${labelPeriodoLocal} · <strong>${totEntregasDel + totEntregasPic}</strong> ${(totEntregasDel + totEntregasPic) === 1 ? 'entrega' : 'entregas'}
    </div>
  </div>
</div>

<!-- Sub-abas Delivery / Retirada-Balcao -->
<div class="tabs" style="margin-bottom:14px;gap:5px;">
  ${subBtn('delivery', '🚚 Delivery (com entregador)', totEntregasDel)}
  ${subBtn('pickup',   '🏪 Retirada e Balcão (sem entregador)', totEntregasPic)}
</div>

${subEntreg === 'pickup' ? `
<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#78350F;line-height:1.5;">
  💡 <strong>Sobre esta aba:</strong> aqui ficam os pedidos pegos diretamente na loja pelo cliente —
  <strong>Retiradas</strong> (cliente buscou o pedido pronto) e <strong>Balcão</strong> (venda direta no caixa).
  Esses pedidos NÃO têm entregador associado e estão separados por loja.
</div>
` : `
<div style="background:#DBEAFE;border:1px solid #3B82F6;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#1E3A8A;line-height:1.5;">
  💡 <strong>Sobre esta aba:</strong> aqui ficam apenas as entregas <strong>Delivery</strong> — pedidos que saíram com endereço, bairro, taxa de entrega e entregador associado.
</div>
`}

<!-- Filtro por entregador (so na aba delivery faz sentido) -->
${subEntreg === 'delivery' ? `
<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="rel-driver-filter" style="width:auto;min-width:180px;">
    <option value="">Todos os entregadores</option>
    ${entradasDel.map(([n])=>`<option value="${n}" ${S._relDriver===n?'selected':''}>${n}</option>`).join('')}
  </select>
  <div style="font-size:12px;color:var(--muted)">
    ${periodLabel} · ${totEntregasDel} entrega(s) confirmada(s)
  </div>
</div>
` : `
<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
  <div style="font-size:12px;color:var(--muted)">
    ${periodLabel} · ${totEntregasPic} pedido(s) retirado(s) na loja
  </div>
</div>
`}

<!-- Cards do conjunto escolhido -->
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:14px;">
  ${entradasView
    .filter(([nome])=>subEntreg === 'pickup' ? true : (!S._relDriver || nome===S._relDriver))
    .sort((a,b)=>b[1].entregas-a[1].entregas).map(([nome,{entregas,total,valorPorEntrega,ganho:ganhoReal}])=>{
    // Usa ganho REAL acumulado das taxas aplicadas em cada pedido (auditoria)
    // Fallback: entregas × taxa atual configurada
    const ganho = (typeof ganhoReal === 'number' && ganhoReal > 0) ? ganhoReal : ((valorPorEntrega||0)*entregas);
    return`
  <div style="background:#fff;border-radius:var(--rl);border:1px solid var(--border);padding:16px;box-shadow:var(--shadow);${entregas===0?'opacity:.7':''}">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <div class="av" style="width:38px;height:38px;font-size:14px;background:var(--rose);flex-shrink:0;">${ini(nome)}</div>
      <div>
        <div style="font-weight:700;font-size:13px">${nome}</div>
        <div style="font-size:10px;color:var(--muted)">Entregador${valorPorEntrega?` · R$ ${valorPorEntrega.toFixed(2)}/entrega`:''}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
      <div style="background:var(--leaf-l);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:20px;font-weight:800;color:var(--leaf)">${entregas}</div>
        <div style="color:var(--leaf);font-weight:600">Entregas</div>
      </div>
      <div style="background:var(--rose-l);border-radius:8px;padding:8px;text-align:center;">
        <div style="font-size:14px;font-weight:800;color:var(--rose)">${ganho?$c(ganho):$c(total)}</div>
        <div style="color:var(--rose);font-weight:600">${ganho?'Ganho':'Valor total'}</div>
      </div>
    </div>
    ${entregas>0?`<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;display:flex;justify-content:space-between;">
      <span style="color:var(--muted)">Média por entrega</span>
      <span style="font-weight:700">${$c(total/entregas)}</span>
    </div>`:'<div style="margin-top:8px;font-size:10px;color:var(--muted);text-align:center;">Sem entregas no período</div>'}
    <!-- Mini breakdown diario — usa mesma fonte do byDriver (entreguesPorData) -->
    ${(()=>{
      // Pega entry no byDriver pra usar o mesmo set de IDs aceitos.
      // ANTES: filtrava so por driverName exato — pedidos com so driverId
      // somiam, fazendo o mini-breakdown mostrar menos que o resumo.
      const entry = byDriver[nome];
      const aceitos = entry?._idsAceitos || new Set();
      const ords = entreguesPorData.filter(o => {
        const tipo = String(o.type || o.tipo || '').toLowerCase();
        if (tipo === 'retirada' || tipo === 'balcao' || tipo === 'balcão' || tipo.includes('retir') || tipo.includes('balc')) return false;
        const candidates = [
          o.driverId, o.driverColabId, o.driverBackendId,
          o.driverEmail && o.driverEmail.toLowerCase(),
          o.expedidorId, o.expedidorEmail && o.expedidorEmail.toLowerCase(),
          (o.driverName||'').toLowerCase(), (o.assignedDriverName||'').toLowerCase(),
        ].filter(Boolean).map(String);
        return candidates.some(c => aceitos.has(c));
      });
      const byDay={};
      ords.forEach(o => {
        // Mesma cascata do byDriver: deliveredAt → updatedAt → createdAt
        const d=$d(o.deliveredAt||o.updatedAt||o.createdAt);
        if(!byDay[d])byDay[d]=0; byDay[d]++;
      });
      const days=Object.entries(byDay).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,5);
      if(!days.length) return '';
      return `<div style="margin-top:8px;font-size:10px;">
        <div style="color:var(--muted);margin-bottom:4px;font-weight:600">Últimas entregas por dia:</div>
        ${days.map(([d,n])=>`<div style="display:flex;justify-content:space-between;padding:2px 0;">
          <span style="color:var(--muted)">${d}</span>
          <span style="font-weight:700;color:var(--leaf)">${n} entrega${n>1?'s':''}</span>
        </div>`).join('')}
      </div>`;
    })()}
  </div>`}).join('')}
</div>

${entradasView.length===0?`<div class="empty card"><div class="empty-icon">${subEntreg==='pickup'?'🏪':'🚚'}</div><p>${subEntreg==='pickup'?'Nenhum pedido de Retirada/Balcão no período.':'Nenhum entregador cadastrado. Adicione colaboradores com cargo Entregador no módulo Colaboradores.'}</p></div>`:''}

<!-- Detalhe completo: só faz sentido na aba Delivery (pickup nao tem entregador/endereco util) -->
${subEntreg === 'delivery' ? `
<div class="card">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span>📋 Histórico Detalhado de Deliveries — ${periodLabel} <span style="font-size:11px;color:var(--muted)">${totEntregasDel} entrega(s)</span></span>
    ${renderOrderSearchBar('Buscar por nº pedido, cliente ou telefone...')}
  </div>
  ${(()=>{
    // FIX (20/05): usa entreguesPorData (mesma fonte do byDriver) em vez
    // de entregues — esse ultimo filtrava por createdAt e perdia entregas
    // confirmadas hoje de pedidos lançados em dias anteriores. Filtro por
    // driver agora usa _idsAceitos (igual byDriver) — match por id+name+email.
    const driverFiltro = S._relDriver;
    const aceitosFiltro = driverFiltro ? (byDriver[driverFiltro]?._idsAceitos || new Set()) : null;
    const listaEntregas = searchOrders(
      [...entreguesPorData]
        .filter(o => {
          const t = String(o.type||o.tipo||'').toLowerCase();
          if (t === 'retirada' || t === 'balcao' || t === 'balcão' || t.includes('retir') || t.includes('balc')) return false;
          return true;
        })
        .filter(o => {
          if (!driverFiltro) return true;
          const candidates = [
            o.driverId, o.driverColabId, o.driverBackendId,
            o.driverEmail && o.driverEmail.toLowerCase(),
            o.expedidorId, o.expedidorEmail && o.expedidorEmail.toLowerCase(),
            (o.driverName||'').toLowerCase(), (o.assignedDriverName||'').toLowerCase(),
          ].filter(Boolean).map(String);
          return candidates.some(c => aceitosFiltro.has(c));
        })
        .sort((a,b)=>new Date(b.deliveredAt||b.updatedAt||b.createdAt)-new Date(a.deliveredAt||a.updatedAt||a.createdAt)),
      S._orderSearch
    );
    if(!listaEntregas.length) return `<div class="empty"><p>${S._orderSearch?'Nenhum resultado para "'+S._orderSearch+'"':'Sem entregas Delivery confirmadas no período'}</p></div>`;
    return`<div class="tw"><table>
    <thead><tr>
      <th>#</th><th>Entregador</th><th>Cliente / Destinatário</th>
      <th>Endereço</th><th>Bairro</th><th>Taxa</th><th>Valor</th><th>Data Entrega</th>
    </tr></thead>
    <tbody>
    ${listaEntregas.map(o=>`<tr>
      <td style="color:var(--rose);font-weight:700">${fmtOrderNum(o)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:14px">🚚</span>
          <span style="font-weight:600">${o.driverName||'—'}</span>
        </div>
      </td>
      <td>
        <div style="font-weight:500">${o.recipient||o.client?.name||o.clientName||'—'}</div>
        <div style="font-size:10px;color:var(--muted)">${o.client?.name||o.clientName||''}</div>
      </td>
      <td style="font-size:11px;color:var(--muted);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${o.deliveryAddress||o.deliveryStreet||'—'}</td>
      <td style="font-size:11px;color:var(--muted)">${o.deliveryNeighborhood||o.bairro||'—'}</td>
      <td style="font-size:11px;color:var(--leaf);font-weight:700">${$c((typeof o.assignedDeliveryFee==='number'?o.assignedDeliveryFee:(o.deliveryFee||0)))}</td>
      <td style="font-weight:700;color:var(--rose)">${$c(o.total)}</td>
      <td style="font-size:11px">${$d(o.deliveredAt||o.updatedAt||o.createdAt)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`;
  })()}
</div>
` : `
<!-- Aba Pickup: detalhe de retiradas/balcao -->
<div class="card">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <span>📋 Histórico Detalhado — Retiradas e Balcão — ${periodLabel} <span style="font-size:11px;color:var(--muted)">${totEntregasPic} pedido(s)</span></span>
    ${renderOrderSearchBar('Buscar por nº pedido, cliente ou telefone...')}
  </div>
  ${(()=>{
    const listaPickup = searchOrders(
      [...entregues]
        .filter(o => {
          const t = String(o.type||o.tipo||'').toLowerCase();
          return t === 'retirada' || t === 'balcao' || t === 'balcão' || t.includes('retir') || t.includes('balc');
        })
        .sort((a,b)=>new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)),
      S._orderSearch
    );
    if(!listaPickup.length) return `<div class="empty"><p>${S._orderSearch?'Nenhum resultado para "'+S._orderSearch+'"':'Sem retiradas/balcão confirmados no período'}</p></div>`;
    return`<div class="tw"><table>
    <thead><tr>
      <th>#</th><th>Tipo</th><th>Loja</th><th>Cliente</th><th>Itens</th><th>Valor</th><th>Data</th>
    </tr></thead>
    <tbody>
    ${listaPickup.map(o=>{
      const t = String(o.type||o.tipo||'').toLowerCase();
      const ehBalcao = t.includes('balc');
      const tipoLbl = ehBalcao ? '🏪 Balcão' : '📦 Retirada';
      const pu = String(o.pickupUnit || o.saleUnit || o.unit || o.unidade || '').toLowerCase();
      let loja = '—';
      if (pu.includes('cdle') || pu.includes('distribui')) loja = 'CDLE';
      else if (pu.includes('aleixo')) loja = 'Novo Aleixo';
      else if (pu.includes('allegro')) loja = 'Allegro Mall';
      else if (pu.includes('ecomm')) loja = 'E-commerce';
      else if (pu) loja = pu;
      return `<tr>
      <td style="color:var(--rose);font-weight:700">${fmtOrderNum(o)}</td>
      <td><span class="tag ${ehBalcao?'t-yellow':'t-blue'}" style="font-size:10px;">${tipoLbl}</span></td>
      <td style="font-weight:600">${loja}</td>
      <td>
        <div style="font-weight:500">${o.recipient||o.client?.name||o.clientName||'—'}</div>
      </td>
      <td style="font-size:11px;color:var(--muted)">${(o.items||[]).map(i=>`${i.qty||1}x ${i.name||''}`).join(', ').substring(0,40)||'—'}</td>
      <td style="font-weight:700;color:var(--rose)">${$c(o.total)}</td>
      <td style="font-size:11px">${$d(o.updatedAt||o.createdAt)}</td>
    </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;
  })()}
</div>
`}
`;
})():''}

<!-- TAB: PRODUTOS -->
${tab==='produtos'?`
<div class="card">
  <div class="card-title">🌹 Relatório Completo de Produtos — ${periodLabel}</div>
  ${prodList.length===0?`<div class="empty"><div class="empty-icon">🌹</div><p>Sem vendas no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr><th>Ranking</th><th>Produto</th><th>Qtd Vendida</th><th>Receita Total</th><th>% do Total</th></tr></thead>
    <tbody>
    ${prodList.map(([n,{qty,rev}],i)=>`<tr style="${i<3?'background:var(--petal)':''}">
      <td style="font-weight:700;color:${i===0?'var(--gold)':i===1?'var(--muted)':i===2?'#CD7F32':'var(--ink)'}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</td>
      <td style="font-weight:600">${n}</td>
      <td><span class="tag t-blue">${qty} un</span></td>
      <td style="font-weight:700;color:var(--leaf)">${$c(rev)}</td>
      <td style="font-size:11px;color:var(--muted)">${fat>0?Math.round((rev/fat)*100):'0'}%</td>
    </tr>`).join('')}
    <tr style="background:var(--cream);font-weight:700;">
      <td colspan="2">TOTAL</td>
      <td>${prodList.reduce((s,[,{qty}])=>s+qty,0)} un</td>
      <td>${$c(fat)}</td>
      <td>100%</td>
    </tr>
    </tbody>
  </table></div>`}
</div>`:''}

<!-- TAB: VENDAS DETALHADO -->
${tab==='vendas'?`
<div class="card">
  <div class="card-title">💰 Vendas Detalhadas — ${periodLabel}
    <span style="font-size:11px;color:var(--muted);">${validos.length} pedidos · ${$c(fat)}</span>
  </div>
  ${validos.length===0?`<div class="empty"><div class="empty-icon">💰</div><p>Sem vendas no período</p></div>`:`
  <div class="tw"><table>
    <thead><tr><th>#</th><th>Cliente</th><th>Unidade</th><th>Itens</th><th>Pgto</th><th>Total</th><th>Status</th><th>Data</th></tr></thead>
    <tbody>
    ${validos.map(o=>`<tr>
      <td style="color:var(--rose);font-weight:600">${fmtOrderNum(o)}</td>
      <td style="font-weight:500">${o.client?.name||o.clientName||'—'}</td>
      <td style="font-size:10px"><span class="tag t-gray">${o.unit||'—'}</span></td>
      <td style="font-size:11px;color:var(--muted)">${(o.items||[]).map(i=>`${i.qty}x ${i.name}`).join(', ').substring(0,30)||'—'}</td>
      <td><span class="tag t-gray" style="font-size:9px">${o.payment||'—'}</span></td>
      <td style="font-weight:600">${$c(o.total)}</td>
      <td><span class="tag ${sc(o.status)}">${o.status}</span></td>
      <td style="font-size:11px">${$d(o.createdAt)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>`:''}

<!-- TAB: VENDAS POR UNIDADE -->
${tab==='vendasUnidade'?(()=>{
  // Agrega vendas por unidade no periodo (ja filtrado em `validos`).
  // 'validos' EXCLUI 'Cancelado' — pedidos cancelados nao entram aqui.
  const fProdRel = (S._relProdFilter||'').toLowerCase().trim();
  const fValMin  = parseFloat(S._relValMin)||0;
  const fValMax  = parseFloat(S._relValMax)||0;
  const fPagRel  = (S._relPagFilter||'').trim();
  const fDateRel1 = S._relTabDate1||'';
  const fDateRel2 = S._relTabDate2||'';

  const matchesProd = (o) => {
    if (!fProdRel) return true;
    return (o.items||[]).some(i => String(i.name||i.nome||'').toLowerCase().includes(fProdRel));
  };
  const matchesValor = (o) => {
    const t = o.total||0;
    if (fValMin && t < fValMin) return false;
    if (fValMax && t > fValMax) return false;
    return true;
  };
  const matchesPag = (o) => {
    if (!fPagRel) return true;
    const pg = (o.payment || o.paymentMethod || '').toLowerCase();
    return pg.includes(fPagRel.toLowerCase());
  };
  // REMOVIDO o filtro de data interno da aba. ANTES tinha 2 filtros de data
  // (o global "Hoje/Semana/Mes/Custom" + os 2 inputs Data Inicial/Final
  // desta aba) e davam resultados diferentes. AGORA usa SO o filtro global
  // do relatorio (S._relPeriod + dt1Str/dt2Str via inPeriod). Conflitos resolvidos.

  // Lista APENAS pedidos validos (sem Cancelados) que passem nos filtros.
  // REGRA: relatorio "Vendas por Unidade" mostra SO o que foi VENDIDO/LANCADO
  // no periodo (createdAt). Pedidos de outros dias com entrega agendada
  // pra hoje aparecem na aba "Operacao" do modulo Pedidos, NAO aqui.
  const lista = validos.filter(o =>
    matchesProd(o) && matchesValor(o) && matchesPag(o)
  );

  // ── PEDIDOS CANCELADOS no periodo (NAO entram no total) ────
  const cancelados = filtered.filter(o =>
    o.status === 'Cancelado' && matchesProd(o) && matchesValor(o) && matchesPag(o)
  );
  // ── PEDIDOS AGUARDANDO PAGAMENTO no periodo ────────────────
  // REGRA ROBUSTA: aguardando = pedido nao-cancelado E que NAO entrou
  // em "validos" (i.e. pagamento nao confirmado, qualquer que seja o
  // paymentStatus). Antes enumeravamos status especificos e perdiamos
  // casos limites (ex: "Ag. Pagamento na Entrega" sem status Entregue).
  const _validosSet = new Set(validos.map(o => String(o._id)));
  const aguardando = filtered.filter(o => {
    if (o.status === 'Cancelado') return false;
    if (_validosSet.has(String(o._id))) return false; // ja entrou no total
    return matchesProd(o) && matchesValor(o) && matchesPag(o);
  });

  const porUnidade = {};
  lista.forEach(o => {
    const uni = o.saleUnit || o.unit || '—';
    if (!porUnidade[uni]) porUnidade[uni] = { qty:0, total:0, itens:0 };
    porUnidade[uni].qty++;
    porUnidade[uni].total += (o.total||0);
    porUnidade[uni].itens += (o.items||[]).reduce((s,i)=>s+(i.qty||1),0);
  });
  const linhas = Object.entries(porUnidade).sort((a,b)=>b[1].total-a[1].total);
  const totalGeral = linhas.reduce((s,[,d])=>s+d.total, 0);

  // ── COMPARATIVO ENTRE UNIDADES: atual vs período anterior ───
  const porUnidadeAnt = {};
  prevValidos.forEach(o => {
    const uni = o.saleUnit || o.unit || '—';
    if (!porUnidadeAnt[uni]) porUnidadeAnt[uni] = { qty:0, total:0 };
    porUnidadeAnt[uni].qty++;
    porUnidadeAnt[uni].total += (o.total||0);
  });
  // Renderiza gráfico SVG de barras agrupadas por unidade (atual vs anterior)
  const _renderUnidadeCompareChart = () => {
    if (!prevRange) return '';
    const unidadesSet = new Set([...Object.keys(porUnidade), ...Object.keys(porUnidadeAnt)]);
    if (unidadesSet.size === 0) return '';
    const dataUni = [...unidadesSet].map(u => ({
      uni: u,
      atual: porUnidade[u]?.total || 0,
      ant:   porUnidadeAnt[u]?.total || 0,
    })).sort((a,b) => (b.atual + b.ant) - (a.atual + a.ant));
    const maxVal = Math.max(...dataUni.map(d => Math.max(d.atual, d.ant)), 1);
    const w = 740, h = 240, padL = 60, padR = 20, padT = 20, padB = 56;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const groupW = innerW / dataUni.length;
    const barW = Math.min(groupW * 0.32, 30);
    const fmtBrl = (v) => v >= 1000 ? `R$${(v/1000).toFixed(1)}k` : `R$${Math.round(v)}`;
    const bars = dataUni.map((d, i) => {
      const cx = padL + i * groupW + groupW/2;
      const hAtual = (d.atual / maxVal) * innerH;
      const hAnt   = (d.ant   / maxVal) * innerH;
      const yAtual = padT + innerH - hAtual;
      const yAnt   = padT + innerH - hAnt;
      const xAnt   = cx - barW - 2;
      const xAtual = cx + 2;
      const variUni = d.ant > 0 ? ((d.atual - d.ant) / d.ant) * 100 : (d.atual > 0 ? 100 : 0);
      const corVar = variUni >= 0 ? '#15803D' : '#991B1B';
      const uniShort = d.uni.replace('Loja ', '').slice(0, 14);
      return `
        <rect x="${xAnt}" y="${yAnt}" width="${barW}" height="${hAnt}" fill="#CBD5E1" rx="3">
          <title>${d.uni}: ${fmtBrl(d.ant)} (anterior)</title>
        </rect>
        <rect x="${xAtual}" y="${yAtual}" width="${barW}" height="${hAtual}" fill="#9F1239" rx="3">
          <title>${d.uni}: ${fmtBrl(d.atual)} (atual)</title>
        </rect>
        <text x="${cx}" y="${yAtual - 4}" text-anchor="middle" font-size="10" fill="#9F1239" font-weight="700">${fmtBrl(d.atual)}</text>
        <text x="${cx}" y="${h - padB + 14}" text-anchor="middle" font-size="11" fill="#1E293B" font-weight="600">${uniShort}</text>
        <text x="${cx}" y="${h - padB + 28}" text-anchor="middle" font-size="9" fill="${corVar}" font-weight="700">${variUni >= 0 ? '▲' : '▼'} ${Math.abs(variUni).toFixed(0)}%</text>
      `;
    }).join('');
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const y = padT + innerH - innerH * f;
      const v = maxVal * f;
      return `
        <line x1="${padL}" y1="${y}" x2="${w-padR}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="2 3"/>
        <text x="${padL-5}" y="${y+3}" text-anchor="end" font-size="9" fill="#94A3B8">${fmtBrl(v)}</text>
      `;
    }).join('');

    return `
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <span>🏪 Comparativo entre Unidades — ${periodLabel} vs ${prevRange.label}</span>
          <span style="display:flex;gap:14px;font-size:11px;font-weight:500;">
            <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#9F1239;border-radius:2px;display:inline-block;"></span>Atual</span>
            <span style="display:flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;background:#CBD5E1;border-radius:2px;display:inline-block;"></span>${prevRange.label}</span>
          </span>
        </div>
        <svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;">
          ${grid}
          ${bars}
        </svg>
      </div>
    `;
  };
  const unidadeCompareChartHtml = _renderUnidadeCompareChart();

  // Agregacao por forma de pagamento (cruzado com unidade)
  const porPag = {};
  const pagPorUnidade = {}; // { 'Pix': { 'CDLE': { qty, total }, 'Allegro': {...} } }
  lista.forEach(o => {
    const pg = o.payment || o.paymentMethod || '—';
    const uni = o.saleUnit || o.unit || '—';
    if (!porPag[pg]) porPag[pg] = { qty:0, total:0 };
    porPag[pg].qty++;
    porPag[pg].total += (o.total||0);
    if (!pagPorUnidade[pg]) pagPorUnidade[pg] = {};
    if (!pagPorUnidade[pg][uni]) pagPorUnidade[pg][uni] = { qty:0, total:0 };
    pagPorUnidade[pg][uni].qty++;
    pagPorUnidade[pg][uni].total += (o.total||0);
  });

  const allPagamentos = ['Pix','Cartão','Cartão Crédito','Cartão Débito','Dinheiro','Pagar na Entrega','Boleto'];

  return `
${unidadeCompareChartHtml}
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🏪 Vendas por Unidade — ${periodLabel}
    <span class="tag" style="background:#D1FAE5;color:#047857;font-size:10px;margin-left:6px;" title="Apenas pedidos com pagamento Aprovado/Pago aparecem nos totais">✅ Pagamento confirmado</span>
    <span class="tag" style="background:#FEE2E2;color:#991B1B;font-size:10px;margin-left:4px;">⛔ Cancelados não contam</span>
    <span class="tag" style="background:#DBEAFE;color:#1E40AF;font-size:10px;margin-left:4px;" title="Conta apenas o que foi VENDIDO/LANÇADO no período. Pedidos com entrega agendada (vendidos em outros dias) NÃO entram aqui — veja aba Operação no módulo Pedidos">📅 Vendidos no período</span>
  </div>
  <div style="font-size:11px;color:var(--muted);padding:6px 10px;background:#FEF3C7;border:1px dashed #F59E0B;border-radius:6px;margin-bottom:8px;line-height:1.5;">
    💡 <strong>Datas:</strong> use o filtro de período no topo (Hoje / Semana / Mês / Personalizado). O critério é a <strong>data de lançamento do pedido</strong> (mesmo do módulo Pedidos > Vendas de Hoje).
  </div>
  <div class="fr3" style="align-items:end;">
    <div class="fg"><label class="fl">💳 Forma de pagamento</label>
      <select class="fi" id="rep-pag-filter">
        <option value="">Todas</option>
        ${allPagamentos.map(p => `<option value="${p}" ${fPagRel===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">🌹 Filtrar por produto</label>
      <input type="text" class="fi" id="rep-prod-filter" placeholder="Ex: Rosa, Buque..." value="${S._relProdFilter||''}"/>
    </div>
    <div class="fg" style="display:flex;gap:6px;">
      <div style="flex:1;"><label class="fl">Valor min (R$)</label>
        <input type="number" class="fi" id="rep-val-min" placeholder="0" value="${S._relValMin||''}"/>
      </div>
      <div style="flex:1;"><label class="fl">Valor max (R$)</label>
        <input type="number" class="fi" id="rep-val-max" placeholder="9999" value="${S._relValMax||''}"/>
      </div>
    </div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:10px 14px;background:linear-gradient(135deg,#FDF4F7,#fff);border-radius:8px;">
    <div>
      <div style="font-size:11px;color:var(--muted);">Total no período</div>
      <div style="font-size:20px;font-weight:900;color:var(--leaf);">${$c(totalGeral)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:11px;color:var(--muted);">Pedidos válidos (sem Cancelados)</div>
      <div style="font-size:20px;font-weight:900;color:var(--ink);">${lista.length}</div>
    </div>
    ${(fProdRel||fValMin||fValMax||fPagRel) ? `<button class="btn btn-ghost btn-sm" id="btn-rep-vu-clear" style="color:var(--red);">🗑️ Limpar filtros</button>` : ''}
  </div>
</div>

<div class="g2">
  <div class="card">
    <div class="card-title">📊 Resumo por Unidade</div>
    ${linhas.length===0 ? `<div class="empty"><p>Nenhuma venda no período.</p></div>` : `
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>Unidade</th><th>Pedidos</th><th>Itens</th><th>Faturamento</th><th>%</th></tr></thead>
      <tbody>
        ${linhas.map(([uni, d]) => `<tr>
          <td><strong>${uni}</strong></td>
          <td>${d.qty}</td>
          <td>${d.itens}</td>
          <td style="color:var(--leaf);font-weight:700;">${$c(d.total)}</td>
          <td>${totalGeral ? Math.round((d.total/totalGeral)*100) : 0}%</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--leaf-l);font-weight:800;">
          <td>🏆 TOTAL GERAL</td>
          <td>${linhas.reduce((s,[,d])=>s+d.qty,0)}</td>
          <td>${linhas.reduce((s,[,d])=>s+d.itens,0)}</td>
          <td style="color:var(--leaf);">${$c(totalGeral)}</td>
          <td>100%</td>
        </tr>
      </tfoot>
    </table></div>`}
  </div>
  <div class="card">
    <div class="card-title">💳 Por Forma de Pagamento</div>
    ${Object.keys(porPag).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
    <div style="overflow-x:auto;"><table>
      <thead><tr><th>Forma</th><th>Pedidos</th><th>Total</th><th>%</th></tr></thead>
      <tbody>
        ${Object.entries(porPag).sort((a,b)=>b[1].total-a[1].total).map(([pg, d]) => `<tr>
          <td><strong>${pg}</strong></td>
          <td>${d.qty}</td>
          <td style="color:var(--leaf);font-weight:700;">${$c(d.total)}</td>
          <td>${totalGeral ? Math.round((d.total/totalGeral)*100) : 0}%</td>
        </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:#FCE7F0;font-weight:800;">
          <td>💰 TOTAL</td>
          <td>${Object.values(porPag).reduce((s,d)=>s+d.qty,0)}</td>
          <td style="color:var(--leaf);">${$c(totalGeral)}</td>
          <td>100%</td>
        </tr>
      </tfoot>
    </table></div>`}
  </div>
</div>

<div class="card" style="margin-top:14px;">
  <div class="card-title">🔀 Cruzamento: Forma de Pagamento × Unidade</div>
  ${Object.keys(pagPorUnidade).length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
  <div style="overflow-x:auto;"><table>
    <thead><tr>
      <th>Forma Pagto.</th>
      ${linhas.map(([uni]) => `<th style="text-align:right;">${uni}</th>`).join('')}
      <th style="text-align:right;background:var(--leaf-l);">Total</th>
    </tr></thead>
    <tbody>
      ${Object.entries(pagPorUnidade).sort((a,b)=>{
        const ta = Object.values(a[1]).reduce((s,d)=>s+d.total,0);
        const tb = Object.values(b[1]).reduce((s,d)=>s+d.total,0);
        return tb - ta;
      }).map(([pg, perUni]) => {
        const linha = linhas.map(([uni]) => {
          const v = perUni[uni];
          return `<td style="text-align:right;font-weight:600;color:var(--leaf);">${v ? $c(v.total) : '—'}</td>`;
        }).join('');
        const totalPg = Object.values(perUni).reduce((s,d)=>s+d.total,0);
        return `<tr>
          <td><strong>${pg}</strong></td>
          ${linha}
          <td style="text-align:right;background:var(--leaf-l);font-weight:800;color:var(--leaf);">${$c(totalPg)}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      <tr style="background:#FCE7F0;font-weight:800;">
        <td>💰 TOTAL</td>
        ${linhas.map(([,d]) => `<td style="text-align:right;color:var(--leaf);">${$c(d.total)}</td>`).join('')}
        <td style="text-align:right;background:var(--leaf);color:#fff;">${$c(totalGeral)}</td>
      </tr>
    </tfoot>
  </table></div>`}
</div>

<div class="card" style="margin-top:14px;">
  <div class="card-title">📋 Pedidos do período (${lista.length})</div>
  ${lista.length===0 ? `<div class="empty"><p>Nenhum pedido.</p></div>` : `
  <div style="max-height:400px;overflow-y:auto;"><table>
    <thead><tr><th>Pedido</th><th>Unidade</th><th>Cliente</th><th>Pagamento</th><th>Total</th></tr></thead>
    <tbody>
      ${lista.slice(0,200).map(o => `<tr>
        <td><strong>${fmtOrderNum(o)}</strong></td>
        <td><span class="tag t-rose" style="font-size:10px;">${o.saleUnit||o.unit||'—'}</span></td>
        <td style="font-size:11px;">${o.client?.name||o.clientName||'—'}</td>
        <td style="font-size:11px;">${o.payment||'—'}</td>
        <td style="font-weight:600;">${$c(o.total)}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>

<!-- ── PEDIDOS CANCELADOS (NÃO entram no total) ── -->
<div class="card" style="margin-top:14px;background:#FEF2F2;border:1px solid #FECACA;">
  <div class="card-title" style="color:#991B1B;">
    🚫 Pedidos Cancelados no período (${cancelados.length})
    ${cancelados.length > 0 ? `<span style="font-size:11px;font-weight:600;color:#991B1B;opacity:.8;">— soma: ${$c(cancelados.reduce((s,o)=>s+(Number(o.total)||0),0))} (NÃO conta no faturamento)</span>` : ''}
  </div>
  ${cancelados.length===0 ? `<div class="empty" style="padding:14px;"><p style="font-size:12px;color:#991B1B;">Nenhum pedido cancelado no período. 🎉</p></div>` : `
  <div style="overflow-x:auto;max-height:420px;overflow-y:auto;"><table style="font-size:12px;">
    <thead><tr style="background:#FEE2E2;color:#991B1B;">
      <th>Nº Pedido</th>
      <th>Data da Venda</th>
      <th>Cliente</th>
      <th>Produto(s)</th>
      <th>Valor</th>
      <th>Motivo do Cancelamento</th>
    </tr></thead>
    <tbody>
      ${cancelados.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,500).map(o => {
        const produtos = (o.items||[]).map(i => `${i.qty||1}× ${i.name||i.nome||''}`).join(', ') || '—';
        const motivo = o.motivoCancelamento || o.cancelMotivo || o.cancellationReason || o.cancelReason || '';
        const cancEm = o.canceladoEm ? new Date(o.canceladoEm).toLocaleDateString('pt-BR') : '';
        return `<tr>
          <td><strong style="color:#991B1B;">${fmtOrderNum(o)}</strong></td>
          <td style="font-size:11px;white-space:nowrap;">${$d(o.createdAt)}</td>
          <td style="font-size:11px;">${esc(o.client?.name||o.clientName||'—')}</td>
          <td style="font-size:11px;max-width:260px;">${esc(produtos.substring(0, 80))}${produtos.length > 80 ? '…' : ''}</td>
          <td style="font-weight:700;color:#991B1B;white-space:nowrap;">${$c(o.total)}</td>
          <td style="font-size:11px;color:#7F1D1D;font-style:${motivo?'normal':'italic'};">
            ${motivo ? esc(motivo) : '<span style="color:#9CA3AF;">— sem motivo registrado</span>'}
            ${cancEm ? `<div style="font-size:9px;color:#9CA3AF;margin-top:2px;">Cancelado em ${cancEm}</div>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot><tr style="background:#FECACA;font-weight:800;">
      <td colspan="4">TOTAL CANCELADO (informativo, NÃO entra no faturamento)</td>
      <td style="color:#991B1B;">${$c(cancelados.reduce((s,o)=>s+(Number(o.total)||0),0))}</td>
      <td></td>
    </tr></tfoot>
  </table></div>`}
</div>

<!-- ── PEDIDOS AGUARDANDO PAGAMENTO (NÃO entram no total) ── -->
<div class="card" style="margin-top:14px;background:#FFFBEB;border:1px solid #FDE68A;">
  <div class="card-title" style="color:#92400E;">
    ⏳ Pedidos Aguardando Pagamento no período (${aguardando.length})
    ${aguardando.length > 0 ? `<span style="font-size:11px;font-weight:600;color:#92400E;opacity:.8;">— soma: ${$c(aguardando.reduce((s,o)=>s+(Number(o.total)||0),0))} (a receber, NÃO conta no faturamento ainda)</span>` : ''}
  </div>
  ${aguardando.length===0 ? `<div class="empty" style="padding:14px;"><p style="font-size:12px;color:#92400E;">Nenhum pedido aguardando pagamento. 👌</p></div>` : `
  <div style="max-height:340px;overflow-y:auto;"><table style="font-size:12px;">
    <thead><tr style="background:#FEF3C7;color:#92400E;">
      <th>Pedido</th><th>Unidade</th><th>Cliente</th><th>Pagamento</th><th>Status pgto</th><th>Valor</th><th>Data</th>
    </tr></thead>
    <tbody>
      ${aguardando.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0,500).map(o => `<tr>
        <td><strong style="color:#92400E;">${fmtOrderNum(o)}</strong></td>
        <td>${esc(o.saleUnit||o.unit||'—')}</td>
        <td>${esc(o.client?.name||o.clientName||'—')}</td>
        <td>${esc(o.payment||'—')}</td>
        <td><span class="tag" style="background:#FEF3C7;color:#92400E;font-size:10px;">${esc(o.paymentStatus||'—')}</span></td>
        <td style="font-weight:700;color:#92400E;">${$c(o.total)}</td>
        <td style="font-size:10px;">${$d(o.createdAt)}</td>
      </tr>`).join('')}
    </tbody>
    ${aguardando.length > 0 ? `<tfoot><tr style="background:#FDE68A;font-weight:800;">
      <td colspan="5">TOTAL AGUARDANDO (informativo, a receber — NÃO conta no faturamento ainda)</td>
      <td style="color:#92400E;">${$c(aguardando.reduce((s,o)=>s+(Number(o.total)||0),0))}</td>
      <td></td>
    </tr></tfoot>` : ''}
  </table></div>`}
</div>`;
})():''}

<!-- TAB: CAIXA COMPLETO -->
${tab==='caixa'?(()=>{
  // ═══════════════════════════════════════════════════════════
  // RELATORIO ADMINISTRATIVO DE FECHAMENTOS DE CAIXA
  // Centraliza acompanhamento financeiro diario por loja:
  //   - Listagem dos fechamentos por dia/unidade
  //   - Abriu/fechou, horarios, sangrias/suprimentos, observacoes
  //   - Detalhamento de pagamentos cruzado com /orders
  //   - Botao "Gerar Recibo" pra cada caixa
  //   - Filtros: unidade, operadora, periodo (usa dt1/dt2 globais)
  // ═══════════════════════════════════════════════════════════

  // Carrega registros (cache em S._relCaixaRegs)
  if (!Array.isArray(S._relCaixaRegs)) {
    S._relCaixaRegs = []; // evita loop
    GET('/caixa').then(r => {
      S._relCaixaRegs = Array.isArray(r) ? r : [];
      import('../main.js').then(m => m.render()).catch(()=>{});
    }).catch(()=>{ S._relCaixaRegs = []; });
  }

  const fUni = (S._relCaixaUnit || '').trim();
  const fOp  = (S._relCaixaOp  || '').trim().toLowerCase();
  const allRegs = (S._relCaixaRegs || []).filter(r => r && r.date);

  // Filtra pela faixa de datas usando inPeriod (helper global) — funciona com
  // o filtro de periodo (hoje/semana/mes/custom) que ja existe no relatorio.
  const inDateRange = (dateStr) => {
    if (!dateStr) return false;
    const [y,m,d] = String(dateStr).split('-').map(Number);
    if (!y) return false;
    const dt = new Date(Date.UTC(y, m-1, d, 12, 0, 0)); // meio-dia UTC pra evitar TZ
    return inPeriod(dt);
  };

  const regs = allRegs.filter(r =>
    inDateRange(r.date) &&
    (!fUni || (r.unit||'') === fUni) &&
    (!fOp || (
      String(r.abertura?.usuario||'').toLowerCase().includes(fOp) ||
      String(r.fechamento?.usuario||'').toLowerCase().includes(fOp)
    ))
  ).sort((a,b) => (b.date||'').localeCompare(a.date||'') || (a.unit||'').localeCompare(b.unit||''));

  // Unidades disponiveis (das opcoes + das presentes nos registros)
  const unidadesPad = ['Loja Novo Aleixo', 'Loja Allegro Mall', 'CDLE'];
  const unidadesPresentes = [...new Set(allRegs.map(r => r.unit).filter(Boolean))];
  const allUnits = [...new Set([...unidadesPad, ...unidadesPresentes])];

  // Operadoras unicas (abriu OU fechou)
  const operadoras = [...new Set(allRegs.flatMap(r => [
    r.abertura?.usuario, r.fechamento?.usuario,
    ...(r.movimentos||[]).map(m => m.usuario),
  ]).filter(Boolean))].sort();

  // KPIs agregados
  const totalCaixas = regs.length;
  const fechados = regs.filter(r => r.fechamento).length;
  const abertos  = totalCaixas - fechados;
  const totalSangrias    = regs.reduce((s,r) => s + (r.movimentos||[]).filter(m=>m.tipo==='Sangria').reduce((a,b)=>a+(b.valor||0),0), 0);
  const totalSuprimentos = regs.reduce((s,r) => s + (r.movimentos||[]).filter(m=>m.tipo==='Suprimento').reduce((a,b)=>a+(b.valor||0),0), 0);
  const totalDiferencas  = regs.reduce((s,r) => s + (r.fechamento?.diferenca || 0), 0);
  const totalSaldoFinal  = regs.reduce((s,r) => s + (r.fechamento?.saldoFinal || 0), 0);

  // Helper: cruza orders do dia+unidade pra extrair detalhamento de pagamento
  const PAGOS = ['Pago','Aprovado','Pago na Entrega'];
  const ordersDoCaixa = (reg) => {
    return (S.orders||[]).filter(o => {
      if (o.status === 'Cancelado') return false;
      if (!PAGOS.includes(o.paymentStatus)) return false;
      const d = String(o.createdAt||'').slice(0,10);
      const u = o.unit || o.saleUnit || '';
      return d === reg.date && u === reg.unit;
    });
  };

  // Helper: detalhamento por forma de pagamento dum registro
  const breakdownPagto = (reg) => {
    const out = {};
    let total = 0, qty = 0;
    ordersDoCaixa(reg).forEach(o => {
      const pg = o.payment || o.paymentMethod || '—';
      if (!out[pg]) out[pg] = { qty: 0, total: 0 };
      out[pg].qty++;
      out[pg].total += (o.total||0);
      total += (o.total||0); qty++;
    });
    return { porPagto: out, totalVendas: total, qtyPedidos: qty };
  };

  // Helper: data formatada
  const fmtDateBr = (dateStr) => {
    if (!dateStr) return '—';
    const [y,m,d] = String(dateStr).split('-');
    return `${d}/${m}/${y}`;
  };

  // Helper: cor da diferenca
  const corDif = (v) => Math.abs(v||0) < 0.01 ? 'var(--leaf)' : (v < 0 ? 'var(--red)' : 'var(--gold)');

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">💵 Relatório Administrativo de Caixa — ${periodLabel}</div>
  <div class="fr3" style="align-items:end;gap:10px;">
    <div class="fg"><label class="fl">Loja / Unidade</label>
      <select class="fi" id="rep-caixa-unit">
        <option value="">Todas as lojas</option>
        ${allUnits.map(u => `<option value="${u}" ${fUni===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Funcionária (abriu ou fechou)</label>
      <select class="fi" id="rep-caixa-op">
        <option value="">Todas</option>
        ${operadoras.map(n => `<option value="${n}" ${fOp===n.toLowerCase()?'selected':''}>${n}</option>`).join('')}
      </select>
    </div>
    <div class="fg" style="display:flex;align-items:flex-end;gap:6px;">
      <button class="btn btn-ghost btn-sm" id="btn-caixa-reload" style="height:38px;">🔄 Recarregar</button>
    </div>
  </div>
  <div style="margin-top:6px;font-size:11px;color:var(--muted);font-style:italic;">
    💡 O filtro de datas global (acima dos cards) aplica automaticamente. Use "Período personalizado" para faixas específicas.
  </div>
</div>

<!-- KPIs -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Caixas no período</div><div class="mc-val">${totalCaixas}</div><div class="mc-sub">${fechados} fechado(s) · ${abertos} aberto(s)</div></div>
  <div class="mc leaf"><div class="mc-label">Saldo Final Total</div><div class="mc-val">${$c(totalSaldoFinal)}</div><div class="mc-sub">soma de fechamentos</div></div>
  <div class="mc gold"><div class="mc-label">Sangrias / Suprimentos</div><div class="mc-val" style="font-size:16px;">${$c(totalSangrias)} / ${$c(totalSuprimentos)}</div></div>
  <div class="mc purple"><div class="mc-label">Diferenças acumuladas</div><div class="mc-val" style="color:${corDif(totalDiferencas)};">${totalDiferencas>=0?'+':''}${$c(totalDiferencas)}</div></div>
</div>

${regs.length === 0 ? `
  <div class="empty card">
    <div class="empty-icon">💵</div>
    <p>Nenhum fechamento de caixa encontrado no período selecionado.</p>
    <p style="font-size:11px;color:var(--muted);margin-top:6px;">
      ${S._relCaixaRegs===undefined ? 'Carregando registros...' : 'Ajuste o filtro de datas ou de loja.'}
    </p>
  </div>
` : `
<div style="display:grid;gap:14px;">
  ${regs.map(reg => {
    const bd = breakdownPagto(reg);
    const sangrias = (reg.movimentos||[]).filter(m => m.tipo === 'Sangria');
    const suprimentos = (reg.movimentos||[]).filter(m => m.tipo === 'Suprimento');
    const totSang = sangrias.reduce((a,b)=>a+(b.valor||0),0);
    const totSupr = suprimentos.reduce((a,b)=>a+(b.valor||0),0);
    const saldoFundo = reg.abertura?.saldo || 0;
    const fechado = !!reg.fechamento;
    const dif = reg.fechamento?.diferenca || 0;

    return `<div class="card" style="border-left:5px solid ${fechado?'var(--leaf)':'var(--gold)'};">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:18px;font-weight:800;color:var(--ink);">🏪 ${esc(reg.unit||'—')} · 📅 ${fmtDateBr(reg.date)}</div>
          <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;font-size:12px;">
            <span style="background:${fechado?'#DCFCE7':'#FEF3C7'};color:${fechado?'#15803D':'#92400E'};padding:2px 10px;border-radius:10px;font-weight:700;">
              ${fechado ? '🔒 Encerrado' : '🟢 Aberto'}
            </span>
            <span style="color:var(--muted);">${bd.qtyPedidos} pedido(s) · ${$c(bd.totalVendas)} em vendas</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-caixa-recibo="${esc(reg._id||reg.id||'')}" data-caixa-date="${esc(reg.date)}" data-caixa-unit="${esc(reg.unit||'')}">🖨️ Gerar Recibo</button>
        </div>
      </div>

      <!-- Operadoras -->
      <div class="g2" style="margin-bottom:12px;">
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:10px 14px;">
          <div style="font-size:10px;color:#15803D;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">🟢 Abertura</div>
          <div style="font-weight:700;font-size:14px;margin-top:4px;">${esc(reg.abertura?.usuario||'—')}</div>
          <div style="font-size:12px;color:var(--muted);">às ${esc(reg.abertura?.hora||'—')} · Fundo: ${$c(saldoFundo)}</div>
        </div>
        <div style="background:${fechado?'#FEE2E2':'#F3F4F6'};border:1px solid ${fechado?'#FCA5A5':'#D1D5DB'};border-radius:8px;padding:10px 14px;">
          <div style="font-size:10px;color:${fechado?'#991B1B':'#6B7280'};font-weight:700;text-transform:uppercase;letter-spacing:.5px;">🔒 Fechamento</div>
          <div style="font-weight:700;font-size:14px;margin-top:4px;">${fechado ? esc(reg.fechamento.usuario||'—') : 'Caixa ainda aberto'}</div>
          <div style="font-size:12px;color:var(--muted);">${fechado ? `às ${esc(reg.fechamento.hora||'—')} · Saldo final: ${$c(reg.fechamento.saldoFinal||0)}` : '—'}</div>
        </div>
      </div>

      <!-- Detalhamento por forma de pagamento -->
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:6px;">💳 Detalhamento por Forma de Pagamento</div>
        ${Object.keys(bd.porPagto).length === 0 ? `
          <div style="font-size:12px;color:var(--muted);font-style:italic;padding:8px;background:#FAFAFA;border-radius:6px;">Nenhum pedido pago neste dia/unidade.</div>
        ` : `
          <div class="tw" style="max-width:100%;"><table style="font-size:12px;">
            <thead><tr><th>Forma</th><th>Qtd</th><th>Total</th><th>% do dia</th></tr></thead>
            <tbody>
              ${Object.entries(bd.porPagto).sort((a,b)=>b[1].total-a[1].total).map(([k,v]) => `
                <tr>
                  <td><strong>${esc(k)}</strong></td>
                  <td>${v.qty}</td>
                  <td style="color:var(--leaf);font-weight:700;">${$c(v.total)}</td>
                  <td style="color:var(--muted);">${bd.totalVendas>0?Math.round(v.total/bd.totalVendas*100):0}%</td>
                </tr>
              `).join('')}
              <tr style="background:var(--cream);font-weight:800;">
                <td>TOTAL</td><td>${bd.qtyPedidos}</td><td style="color:var(--leaf);">${$c(bd.totalVendas)}</td><td>100%</td>
              </tr>
            </tbody>
          </table></div>
        `}
      </div>

      <!-- Sangrias e Suprimentos -->
      ${(sangrias.length || suprimentos.length) ? `
        <div class="g2" style="margin-bottom:12px;gap:10px;">
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#991B1B;text-transform:uppercase;">📤 Sangrias</span>
              <strong style="color:#991B1B;">${$c(totSang)}</strong>
            </div>
            ${sangrias.length === 0 ? `<div style="font-size:11px;color:var(--muted);font-style:italic;">Nenhuma</div>` : sangrias.map(m => `
              <div style="font-size:11px;display:flex;justify-content:space-between;padding:3px 0;border-top:1px dashed #FCA5A5;">
                <span>${esc(m.hora||'—')} · ${esc(m.usuario||'—')} ${m.motivo?`<span style="color:var(--muted);">(${esc(m.motivo)})</span>`:''}</span>
                <strong>${$c(m.valor||0)}</strong>
              </div>
            `).join('')}
          </div>
          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:11px;font-weight:700;color:#1E40AF;text-transform:uppercase;">📥 Suprimentos</span>
              <strong style="color:#1E40AF;">${$c(totSupr)}</strong>
            </div>
            ${suprimentos.length === 0 ? `<div style="font-size:11px;color:var(--muted);font-style:italic;">Nenhum</div>` : suprimentos.map(m => `
              <div style="font-size:11px;display:flex;justify-content:space-between;padding:3px 0;border-top:1px dashed #BFDBFE;">
                <span>${esc(m.hora||'—')} · ${esc(m.usuario||'—')} ${m.motivo?`<span style="color:var(--muted);">(${esc(m.motivo)})</span>`:''}</span>
                <strong>${$c(m.valor||0)}</strong>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Resumo financeiro -->
      ${fechado ? `
        <div style="background:linear-gradient(135deg,#FDF2F8,#fff);border-radius:8px;padding:12px 14px;margin-bottom:8px;">
          <div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:6px;">📊 Resumo Financeiro do Caixa</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Fundo abertura</span><strong>${$c(saldoFundo)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Vendas (total)</span><strong style="color:var(--leaf);">${$c(bd.totalVendas)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Sangrias</span><strong style="color:#991B1B;">− ${$c(totSang)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Suprimentos</span><strong style="color:#1E40AF;">+ ${$c(totSupr)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Saldo esperado</span><strong>${$c(reg.fechamento.saldoEsperado||0)}</strong></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:var(--muted);">Saldo contado</span><strong>${$c(reg.fechamento.saldoFinal||0)}</strong></div>
            <div style="grid-column:span 2;display:flex;justify-content:space-between;padding-top:6px;border-top:2px solid var(--border);">
              <span style="font-weight:700;">Diferença</span>
              <strong style="color:${corDif(dif)};font-size:14px;">${dif>=0?'+':''}${$c(dif)}</strong>
            </div>
          </div>
        </div>
      ` : ''}

      ${reg.observacoes || reg.notes ? `
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 12px;font-size:12px;">
          <strong>📝 Observações:</strong> ${esc(reg.observacoes || reg.notes || '')}
        </div>
      ` : ''}
    </div>`;
  }).join('')}
</div>
`}
`;
})():''}

<!-- TAB: CLIENTES -->
${tab==='clientes'?`
<div class="g2">
  <div class="card">
    <div class="card-title">👥 Top Clientes por Faturamento — ${periodLabel}</div>
    ${(()=>{
      const byClient={};
      validos.forEach(o=>{
        const id=o.client?._id||o.clientId||o.clientName||'—';
        const name=o.client?.name||o.clientName||'—';
        if(!byClient[id])byClient[id]={name,pedidos:0,total:0};
        byClient[id].pedidos++; byClient[id].total+=(o.total||0);
      });
      const sorted=Object.values(byClient).sort((a,b)=>b.total-a.total).slice(0,10);
      const max=sorted[0]?.total||1;
      return sorted.length===0?'<div class="empty"><p>Sem dados no período</p></div>':
      sorted.map((c,i)=>`
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
          <span><strong style="color:var(--rose)">#${i+1}</strong> ${c.name}</span>
          <span>${c.pedidos} pedido(s) · <strong>${$c(c.total)}</strong></span>
        </div>
        <div class="pb"><div class="pf" style="width:${Math.round(c.total/max*100)}%;background:var(--rose)"></div></div>
      </div>`).join('');
    })()}
  </div>
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">📊 Resumo de Clientes</div>
      ${(()=>{
        const total=S.clients.length;
        const novos=S.clients.filter(c=>c.segment==='Novo'||!c.segment).length;
        const recorrentes=S.clients.filter(c=>c.segment==='Recorrente').length;
        const vips=S.clients.filter(c=>c.segment==='VIP').length;
        return `
        ${[['Total de Clientes',total,'var(--rose)'],['Novos',novos,'var(--blue)'],
           ['Recorrentes',recorrentes,'var(--leaf)'],['VIP',vips,'var(--gold)']].map(([l,v,c])=>`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
          <span style="font-size:13px">${l}</span>
          <span style="font-size:14px;font-weight:700;color:${c}">${v}</span>
        </div>`).join('')}`;
      })()}
    </div>
    <div class="card">
      <div class="card-title">🔄 Clientes que Mais Compraram</div>
      ${(()=>{
        const clientes = S.clients.map(c=>({
          ...c,
          pedidos: validos.filter(o=>o.client?._id===c._id||o.clientName===c.name).length
        })).filter(c=>c.pedidos>0).sort((a,b)=>b.pedidos-a.pedidos).slice(0,5);
        return clientes.length===0?'<div class="empty"><p>Sem dados</p></div>':
        clientes.map(c=>`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;">
          <div>
            <div style="font-weight:600">${c.name}</div>
            <div style="color:var(--muted)">${c.phone||'—'}</div>
          </div>
          <span class="tag ${segc(c.segment||'Novo')}">${c.pedidos} pedidos</span>
        </div>`).join('');
      })()}
    </div>
  </div>
</div>`:''}

<!-- TAB: MONTAGENS -->
${tab==='montagens'?(()=>{
  // Lista pedidos cujo status esteja >= 'Pronto' (inclui Saiu p/ entrega e Entregue)
  // Identifica o montador via montadorId/montadorEmail; fallback para o atendente.
  const montados = filtered.filter(o => {
    const st = String(o.status||'').toLowerCase();
    return ['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x));
  });
  // Agrupa por montador (apenas quem efetivamente monta: Atendimento + Producao)
  const colabs = getEquipePorSetor('montagem');
  const byMont = {};
  colabs.forEach(c => {
    const k = (c.name||'').trim();
    if (k) byMont[k] = { qtd:0, produtos:0, comissao:0,
      por: Number(c.metas?.comissaoMontagem)||0,
      _idsAceitos: new Set([c._id, c.id, c.backendId, (c.email||'').toLowerCase(), k.toLowerCase()].filter(Boolean).map(String))
    };
  });
  let semMontador = 0, totalProds = 0;
  montados.forEach(o => {
    const itQty = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1), 0) || 1;
    totalProds += itQty;
    const candidates = [o.montadorId, o.montadorEmail, (o.montadorNome||'').toLowerCase()].filter(Boolean).map(String);
    let key = null;
    for (const k of Object.keys(byMont)) {
      if (candidates.some(c => byMont[k]._idsAceitos.has(c))) { key = k; break; }
    }
    if (!key) { semMontador++; return; }
    byMont[key].qtd++;
    byMont[key].produtos += itQty;
    byMont[key].comissao += byMont[key].por * itQty;
  });
  const linhas = Object.entries(byMont).filter(([,v]) => v.qtd>0).sort((a,b)=>b[1].produtos-a[1].produtos);

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🌿 Montagens — ${periodLabel}</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px;">
    <div class="mc rose"><div class="mc-label">Pedidos montados</div><div class="mc-val">${montados.length}</div></div>
    <div class="mc leaf"><div class="mc-label">Produtos montados</div><div class="mc-val">${totalProds}</div></div>
    <div class="mc gold"><div class="mc-label">Sem montador</div><div class="mc-val">${semMontador}</div></div>
    <div class="mc purple"><div class="mc-label">Total comissões</div><div class="mc-val">${$c(linhas.reduce((s,[,v])=>s+v.comissao,0))}</div></div>
  </div>
  ${linhas.length===0 ? `<div class="empty"><p>Nenhuma montagem com colaborador identificado.</p></div>` : `
  <div class="tw"><table>
    <thead><tr>
      <th>Montador</th>
      <th style="text-align:right;">Pedidos</th>
      <th style="text-align:right;">Produtos</th>
      <th style="text-align:right;">R$/produto</th>
      <th style="text-align:right;">Comissão Total</th>
    </tr></thead>
    <tbody>
      ${linhas.map(([nome, v]) => `<tr>
        <td style="font-weight:600;">${nome}</td>
        <td style="text-align:right;">${v.qtd}</td>
        <td style="text-align:right;color:var(--leaf);font-weight:700;">${v.produtos}</td>
        <td style="text-align:right;color:var(--muted);">${v.por?$c(v.por):'—'}</td>
        <td style="text-align:right;font-weight:800;color:var(--leaf);">${$c(v.comissao)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr style="background:var(--cream);font-weight:700;">
      <td>TOTAL</td>
      <td style="text-align:right;">${linhas.reduce((s,[,v])=>s+v.qtd,0)}</td>
      <td style="text-align:right;">${linhas.reduce((s,[,v])=>s+v.produtos,0)}</td>
      <td></td>
      <td style="text-align:right;color:var(--leaf);">${$c(linhas.reduce((s,[,v])=>s+v.comissao,0))}</td>
    </tr></tfoot>
  </table></div>
  `}
  <div style="font-size:11px;color:var(--muted);margin-top:10px;font-style:italic;">
    ℹ️ Conta pedidos com status ≥ Pronto. Comissão = R$ por produto (configurado no cadastro do colaborador) × quantidade.
  </div>
</div>
`;
})():''}


${tab==='operacao'?renderTabOperacao(period, periodLabel):''}

${tab==='altademanda'?renderTabAltaDemanda():''}

${tab==='porColaborador'?renderPorColaborador(base, period, periodLabel):''}

${tab==='chaoDatas'?renderChaoDatas(base):''}

${tab==='acessosOffHours'?renderAcessosOffHours():''}

${tab==='custom'?renderCustomReports():''}

`;
}

// ── RELATORIO: ACESSOS FORA DO HORARIO ──────────────────────
// Lista acessos registrados pelo offHoursCheck.js (colab nao-admin/
// gerente/entregador que acessou entre 20:30 e 06:30 Manaus).
// Fonte: AuditLog com module='off_hours'. Carrega sob demanda.
function renderAcessosOffHours() {
  // Carga sob demanda — cache em S._offHoursLogs
  if (!Array.isArray(S._offHoursLogs)) {
    S._offHoursLogs = [];
    GET('/audit-logs?module=off_hours&limit=500').then(r => {
      const logs = Array.isArray(r) ? r : (r?.logs || r?.data || []);
      S._offHoursLogs = Array.isArray(logs) ? logs : [];
      import('../main.js').then(m => m.render()).catch(()=>{});
    }).catch(()=>{ S._offHoursLogs = []; });
  }
  const logs = S._offHoursLogs || [];
  // Filtros: data, colab, dispositivo
  const fColab  = (S._offHoursColab||'').trim().toLowerCase();
  const fDevice = (S._offHoursDevice||'').trim();
  const fDate1  = S._offHoursDate1||'';
  const fDate2  = S._offHoursDate2||'';
  const inRange = (iso) => {
    if (!fDate1 && !fDate2) return true;
    const d = String(iso||'').slice(0,10);
    if (!d) return false;
    if (fDate1 && d < fDate1) return false;
    if (fDate2 && d > fDate2) return false;
    return true;
  };
  const filtered = logs.filter(l => {
    if (fColab) {
      const hay = (String(l.userName||'') + ' ' + String(l.userEmail||'')).toLowerCase();
      if (!hay.includes(fColab)) return false;
    }
    if (fDevice && l.device !== fDevice) return false;
    if (!inRange(l.createdAt)) return false;
    return true;
  });
  const ordenado = [...filtered].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

  // KPIs
  const totalAcessos = filtered.length;
  const colabsUnicos = new Set(filtered.map(l => l.userId || l.userEmail || l.userName)).size;
  const ultimaSemana = filtered.filter(l => {
    const d = new Date(l.createdAt);
    const semana = Date.now() - 7*24*60*60*1000;
    return d.getTime() >= semana;
  }).length;

  return `
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#1F2937,#374151);color:#fff;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
    <span style="font-size:30px;">🌙</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:800;">Acessos Fora do Horário</div>
      <div style="font-size:12px;opacity:.8;">Colaboradoras (exceto Admin/Gerente/Entregador) que acessaram entre 20:30 e 06:30 Manaus</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px;">
    <div style="background:rgba(255,255,255,.12);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.5px;">Total de acessos</div>
      <div style="font-size:26px;font-weight:900;color:#FCD34D;">${totalAcessos}</div>
    </div>
    <div style="background:rgba(255,255,255,.12);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.5px;">Colaboradoras únicas</div>
      <div style="font-size:26px;font-weight:900;color:#A7F3D0;">${colabsUnicos}</div>
    </div>
    <div style="background:rgba(255,255,255,.12);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:10px;opacity:.7;text-transform:uppercase;letter-spacing:.5px;">Últimos 7 dias</div>
      <div style="font-size:26px;font-weight:900;color:#FCA5A5;">${ultimaSemana}</div>
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
    <div class="fg" style="margin:0;flex:1;min-width:160px;">
      <label class="fl">🔍 Buscar colaboradora</label>
      <input type="text" class="fi" id="oh-colab" placeholder="Nome ou email..." value="${esc(S._offHoursColab||'')}"/>
    </div>
    <div class="fg" style="margin:0;min-width:140px;">
      <label class="fl">📱 Dispositivo</label>
      <select class="fi" id="oh-device">
        <option value="">Todos</option>
        ${['PC','Celular','Tablet','TV','Outro'].map(d => `<option value="${d}" ${fDevice===d?'selected':''}>${d}</option>`).join('')}
      </select>
    </div>
    <div class="fg" style="margin:0;">
      <label class="fl">📅 Data inicial</label>
      <input type="date" class="fi" id="oh-date1" value="${fDate1}"/>
    </div>
    <div class="fg" style="margin:0;">
      <label class="fl">📅 Data final</label>
      <input type="date" class="fi" id="oh-date2" value="${fDate2}"/>
    </div>
    <button class="btn btn-ghost btn-sm" id="oh-reload" style="height:38px;">🔄 Recarregar</button>
    ${(fColab||fDevice||fDate1||fDate2) ? `<button class="btn btn-ghost btn-sm" id="oh-clear" style="height:38px;color:var(--red);">✕ Limpar</button>` : ''}
  </div>
</div>

${ordenado.length === 0 ? `
  <div class="empty card">
    <div class="empty-icon">🌙</div>
    <p><strong>Nenhum acesso fora do horário no período.</strong></p>
    <p style="font-size:11px;color:var(--muted);margin-top:6px;">
      ${S._offHoursLogs === undefined ? 'Carregando…' : 'A regra dispara entre 20:30 e 06:30 Manaus pra colabs não-admin/gerente/entregador.'}
    </p>
  </div>
` : `
<div class="card">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;">
    <span>📋 Histórico de Acessos (${ordenado.length})</span>
    <span style="font-size:11px;color:var(--muted);font-weight:600;">Mais recente primeiro</span>
  </div>
  <div style="overflow-x:auto;max-height:520px;overflow-y:auto;"><table style="font-size:12px;">
    <thead><tr style="background:#1F2937;color:#fff;">
      <th>Data</th>
      <th>Hora Manaus</th>
      <th>Colaboradora</th>
      <th>Cargo</th>
      <th>Unidade</th>
      <th>Dispositivo</th>
      <th>IP</th>
      <th>Justificativa</th>
    </tr></thead>
    <tbody>
      ${ordenado.map(l => {
        const dt = new Date(l.createdAt);
        const dataBr = isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR', { timeZone:'America/Manaus' });
        const horaMan = l.meta?.horaManaus || (isNaN(dt.getTime()) ? '—' : dt.toLocaleTimeString('pt-BR', { timeZone:'America/Manaus', hour:'2-digit', minute:'2-digit' }));
        const just = l.meta?.justificativa || '—';
        const dev = l.device || '—';
        const devIcon = dev === 'Celular' ? '📱' : dev === 'Tablet' ? '📱' : dev === 'PC' ? '💻' : dev === 'TV' ? '📺' : '❓';
        return `<tr>
          <td style="white-space:nowrap;">${dataBr}</td>
          <td style="font-weight:700;color:#92400E;">${horaMan}</td>
          <td style="font-weight:600;">${esc(l.userName||'—')}<div style="font-size:10px;color:var(--muted);">${esc(l.userEmail||'')}</div></td>
          <td>${esc(l.userCargo||l.userRole||'—')}</td>
          <td>${esc(l.meta?.unidade||'—')}</td>
          <td>${devIcon} ${esc(dev)}</td>
          <td style="font-family:monospace;font-size:10px;">${esc(l.ip||'—')}</td>
          <td style="max-width:280px;font-size:11px;color:#374151;">${esc(just)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>
</div>
`}
`;
}

// ── RELATORIO POR COLABORADOR ────────────────────────────────
// Helper: chave estavel para identificar 1 colab (usa o primeiro ID
// disponivel em ordem fixa). Garante que value do <option> bate com
// o lookup posterior.
function _colabKey(c) {
  return String(c?._id || c?.id || c?.backendId || c?.email || c?.name || '');
}

// ── DETALHE DIA A DIA do Por Usuario ────────────────────────
// Para a colab selecionada (ou para CADA colab quando 'todos'),
// agrupa atividades por DIA mostrando:
//   - Vendas: data + nº pedido + cliente + valor + comissão
//   - Montagens: data + nº pedido + qtd produtos + comissão
//   - Expedições: data + nº pedido + comissão
// + Totais por dia + total geral.
function renderUsuarioDetalhe(byUser, selColab, colabsAll, inPeriod, periodLabel) {
  // Quando "todos": pede para selecionar uma colab (detalhe vira pesado e
  // confuso com 8+ pessoas). Quando selecionado: mostra so essa.
  if (!selColab) {
    return `<div class="card" style="text-align:center;padding:40px;background:linear-gradient(135deg,#FAE8E6,#FFF7F5);border:1px solid #FECDD3;">
      <div style="font-size:40px;margin-bottom:10px;">👤</div>
      <p style="color:#9F1239;font-weight:700;margin-bottom:4px;">Selecione uma colaboradora</p>
      <p style="color:var(--muted);font-size:12px;">Escolha um nome no filtro acima para ver o detalhe dia a dia (vendas, montagens e expedições com totais).</p>
    </div>`;
  }

  // Encontra a colab e seu byUser correspondente
  const colab = colabsAll.find(c => (c.id||c.backendId||c.email) === selColab);
  if (!colab) return `<div class="card" style="text-align:center;padding:30px;color:var(--muted);">Colaborador não encontrado.</div>`;
  const u = byUser.find(x => x.colab && (x.colab.id||x.colab.backendId||x.colab.email) === selColab);

  // Comissoes do cadastro
  const mt = colab.metas || {};
  const pctV = Number(mt.comissaoVenda ?? mt.vendaPct ?? 0) || 0;
  const valM = Number(mt.comissaoMontagem ?? 0) || 0;
  const valE = Number(mt.comissaoExpedicao ?? 0) || 0;

  // Helper: este pedido eh DELA (vendas/montagem/expedicao)?
  const orders = Array.isArray(S.orders) ? S.orders : [];
  const APROVADOS = new Set(['Aprovado','Pago','aprovado','pago','Pago na Entrega','Recebido']);
  const me = (vals) => _isMine(colab, ...vals);

  // Coleta atividades por dia
  const dias = {}; // 'YYYY-MM-DD' -> { vendas:[], montagens:[], expedicoes:[] }
  const ensure = d => { if (!dias[d]) dias[d] = { vendas:[], montagens:[], expedicoes:[] }; return dias[d]; };

  for (const o of orders) {
    const dataRef = (o.createdAt || o.scheduledDate || '').slice(0,10);
    if (!dataRef || !inPeriod(o.createdAt || o.scheduledDate)) continue;
    const itQty = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1), 0) || 1;
    const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
    const cli = o.client?.name || o.clientName || '—';
    const total = Number(o.total) || 0;

    // VENDAS — pedidos APROVADOS dela
    if (APROVADOS.has(String(o.paymentStatus||''))) {
      const ehMinha = me([o.vendedorId, o.vendedorEmail]) ||
        (!o.vendedorId && me([o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName]));
      if (ehMinha) ensure(dataRef).vendas.push({ num, cli, total, comissao: total*(pctV/100) });
    }

    // MONTAGENS — status >= Pronto + ela e a montadora
    const st = String(o.status||'').toLowerCase();
    if (['pronto','saiu p/ entrega','entregue'].some(x => st.includes(x))) {
      if (me([o.montadorId, o.montadorEmail, o.montadorNome])) {
        const dDay = (o.montadoEm || o.createdAt || dataRef).slice(0,10);
        ensure(dDay).montagens.push({ num, cli, qtd: itQty, comissao: valM * itQty });
      }
    }

    // EXPEDICOES — status Entregue + ela eh expedidora (nao driver!)
    // FIX: removido driverColabId/driverName que duplicava com "Por entregador".
    if (st.includes('entregue')) {
      if (me([o.expedidorId, o.expedidorEmail])) {
        const dDay = (o.expedidoEm || o.updatedAt || dataRef).slice(0,10);
        ensure(dDay).expedicoes.push({ num, cli, comissao: valE });
      }
    }
  }

  const diasOrd = Object.keys(dias).sort((a,b) => b.localeCompare(a)); // mais recentes primeiro
  if (!diasOrd.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:40px;margin-bottom:10px;">📭</div>
      <p style="font-weight:700;">${esc(colab.name||'')}</p>
      <p style="font-size:12px;">Nenhuma atividade no período <strong>${esc(periodLabel)}</strong>.</p>
    </div>`;
  }

  // Totais gerais
  const totVendas    = diasOrd.reduce((s,d) => s + dias[d].vendas.length, 0);
  const totFatVendas = diasOrd.reduce((s,d) => s + dias[d].vendas.reduce((x,v) => x+v.total, 0), 0);
  const totComV      = diasOrd.reduce((s,d) => s + dias[d].vendas.reduce((x,v) => x+v.comissao, 0), 0);
  const totMontQtd   = diasOrd.reduce((s,d) => s + dias[d].montagens.reduce((x,m) => x+m.qtd, 0), 0);
  const totComM      = diasOrd.reduce((s,d) => s + dias[d].montagens.reduce((x,m) => x+m.comissao, 0), 0);
  const totExpQtd    = diasOrd.reduce((s,d) => s + dias[d].expedicoes.length, 0);
  const totComE      = diasOrd.reduce((s,d) => s + dias[d].expedicoes.reduce((x,e) => x+e.comissao, 0), 0);
  const totComissao  = totComV + totComM + totComE;

  const fmtData = (yyyymmdd) => { const [y,m,d] = yyyymmdd.split('-'); return `${d}/${m}/${y}`; };

  return `
<!-- Header com totais -->
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FAE8E6,#FFF7F5);border:1px solid #FECDD3;">
  <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
    <div style="width:54px;height:54px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;">${(colab.name||'?').charAt(0).toUpperCase()}</div>
    <div style="flex:1;min-width:150px;">
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:#9F1239;">${esc(colab.name||'')}</div>
      <div style="font-size:11px;color:var(--muted);">${esc(colab.cargo||'—')} · ${esc(periodLabel)} · ${diasOrd.length} dia(s) com atividade</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:14px;">
    <div style="background:#fff;border-radius:8px;padding:10px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">💰 Vendas</div>
      <div style="font-size:18px;font-weight:900;color:var(--rose);">${totVendas}</div>
      <div style="font-size:10px;color:#15803D;font-weight:700;">${$c(totFatVendas)} faturado</div>
      <div style="font-size:10px;color:var(--muted);">→ Comissão: <strong style="color:#15803D;">${$c(totComV)}</strong></div>
    </div>
    <div style="background:#fff;border-radius:8px;padding:10px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">🌹 Montagens</div>
      <div style="font-size:18px;font-weight:900;color:#92400E;">${totMontQtd} <span style="font-size:11px;font-weight:500;">produtos</span></div>
      <div style="font-size:10px;color:var(--muted);">${valM?'R$ '+valM.toFixed(2)+'/produto':'sem valor cadastrado'}</div>
      <div style="font-size:10px;color:var(--muted);">→ Comissão: <strong style="color:#92400E;">${$c(totComM)}</strong></div>
    </div>
    <div style="background:#fff;border-radius:8px;padding:10px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">🚚 Expedições</div>
      <div style="font-size:18px;font-weight:900;color:#1E40AF;">${totExpQtd} <span style="font-size:11px;font-weight:500;">entregas</span></div>
      <div style="font-size:10px;color:var(--muted);">${valE?'R$ '+valE.toFixed(2)+'/entrega':'sem valor cadastrado'}</div>
      <div style="font-size:10px;color:var(--muted);">→ Comissão: <strong style="color:#1E40AF;">${$c(totComE)}</strong></div>
    </div>
    <div style="background:linear-gradient(135deg,#15803D,#22C55E);border-radius:8px;padding:10px;color:#fff;">
      <div style="font-size:10px;text-transform:uppercase;font-weight:700;opacity:.9;">💚 TOTAL Comissão</div>
      <div style="font-size:24px;font-weight:900;">${$c(totComissao)}</div>
      <div style="font-size:10px;opacity:.85;">no período</div>
    </div>
  </div>
</div>

<!-- Detalhe por DIA -->
<div style="display:grid;gap:10px;">
${diasOrd.map(d => {
  const day = dias[d];
  const dayVendasTot = day.vendas.reduce((s,v)=>s+v.total,0);
  const dayComV = day.vendas.reduce((s,v)=>s+v.comissao,0);
  const dayMontQtd = day.montagens.reduce((s,m)=>s+m.qtd,0);
  const dayComM = day.montagens.reduce((s,m)=>s+m.comissao,0);
  const dayComE = day.expedicoes.reduce((s,e)=>s+e.comissao,0);
  const dayTotal = dayComV + dayComM + dayComE;
  return `<div class="card" style="padding:0;overflow:hidden;">
    <div style="background:linear-gradient(90deg,#FAE8E6,transparent);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
      <div>
        <div style="font-weight:800;font-size:14px;color:#9F1239;">📅 ${fmtData(d)}</div>
        <div style="font-size:11px;color:var(--muted);">${day.vendas.length} venda(s) · ${day.montagens.length} montagem(ns) · ${day.expedicoes.length} expedição(ões)</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:700;">Comissão do dia</div>
        <div style="font-size:18px;font-weight:900;color:#15803D;">${$c(dayTotal)}</div>
      </div>
    </div>
    <div style="padding:10px 14px;display:grid;gap:10px;">
      ${day.vendas.length ? `
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--rose);margin-bottom:4px;">💰 Vendas (${day.vendas.length}) — Faturado: ${$c(dayVendasTot)} · Comissão: ${$c(dayComV)}</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse;">
          ${day.vendas.map(v => `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:4px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;width:70px;">#${v.num}</td>
            <td style="padding:4px 8px;">${esc(v.cli)}</td>
            <td style="padding:4px 8px;text-align:right;color:#1E293B;font-weight:600;">${$c(v.total)}</td>
            <td style="padding:4px 8px;text-align:right;color:#15803D;font-weight:700;width:90px;">${$c(v.comissao)}</td>
          </tr>`).join('')}
        </table>
      </div>` : ''}
      ${day.montagens.length ? `
      <div>
        <div style="font-size:11px;font-weight:700;color:#92400E;margin-bottom:4px;">🌹 Montagens (${day.montagens.length}) — ${dayMontQtd} produtos · Comissão: ${$c(dayComM)}</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse;">
          ${day.montagens.map(m => `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:4px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;width:70px;">#${m.num}</td>
            <td style="padding:4px 8px;">${esc(m.cli)}</td>
            <td style="padding:4px 8px;text-align:right;color:#92400E;font-weight:600;">${m.qtd} produto(s)</td>
            <td style="padding:4px 8px;text-align:right;color:#92400E;font-weight:700;width:90px;">${$c(m.comissao)}</td>
          </tr>`).join('')}
        </table>
      </div>` : ''}
      ${day.expedicoes.length ? `
      <div>
        <div style="font-size:11px;font-weight:700;color:#1E40AF;margin-bottom:4px;">🚚 Expedições (${day.expedicoes.length}) — Comissão: ${$c(dayComE)}</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse;">
          ${day.expedicoes.map(e => `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:4px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;width:70px;">#${e.num}</td>
            <td style="padding:4px 8px;">${esc(e.cli)}</td>
            <td style="padding:4px 8px;text-align:right;color:#1E40AF;font-weight:700;" colspan="2">${$c(e.comissao)}</td>
          </tr>`).join('')}
        </table>
      </div>` : ''}
    </div>
  </div>`;
}).join('')}
</div>
`;
}

function renderPorColaborador(orders, period, periodLabel) {
  const colabId  = S._relColabId  || '';
  const setor    = S._relSetor    || 'todos';
  const ordenar  = S._relOrdenar  || 'data';

  // v4: lista TODOS os colabs operacionais (Atendimento, Producao,
  // Expedicao, Entregador). Atendentes fazem rodizio semanal entre
  // os 3 setores — entao TODOS aparecem no select (o admin filtra
  // setor depois). Gerente/Financeiro/Admin ficam de fora.
  const colabsRaw = getColabs().filter(c => c.active !== false);
  const norm = (s) => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
  const operacionais = colabsRaw.filter(c => {
    const car = norm(c.cargo);
    return car.includes('atend')   ||
           car.includes('producao')||
           car.includes('montad')  ||
           car.includes('expedicao')||
           car.includes('entregador');
  });
  // Dedup por chave estavel
  const colabMap = new Map();
  operacionais.forEach(c => { const k = _colabKey(c); if (k && !colabMap.has(k)) colabMap.set(k, c); });
  const colabs = [...colabMap.values()];
  const colab  = colabId ? colabMap.get(String(colabId)) : null;

  // Filtra pedidos atribuidos ao colab por setor — aceita _id, id, backendId,
  // email e nome (tolerante a pedidos antigos com formatos diferentes).
  let pedidos = [];
  if (colabId && colab) {
    const matchVendedor   = (o) => _isMine(colab, o.vendedorId, o.vendedorEmail, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName);
    const matchMontador   = (o) => _isMine(colab, o.montadorId, o.montadorEmail, o.montadorNome);
    const matchExpedidor  = (o) => _isMine(colab, o.expedidorId, o.expedidorEmail);
    pedidos = orders.filter(o => {
      if (setor === 'vendas')    return matchVendedor(o);
      if (setor === 'montagem')  return matchMontador(o);
      if (setor === 'expedicao') return matchExpedidor(o);
      return matchVendedor(o) || matchMontador(o) || matchExpedidor(o);
    });
  }

  // Ordenacao
  const sortFn = {
    data:  (a,b) => new Date(b.createdAt) - new Date(a.createdAt),
    valor: (a,b) => (Number(b.total)||0) - (Number(a.total)||0),
    qtd:   (a,b) => (b.items||[]).reduce((s,i)=>s+i.qty,0) - (a.items||[]).reduce((s,i)=>s+i.qty,0),
  }[ordenar] || ((a,b) => 0);
  pedidos = [...pedidos].sort(sortFn);

  // Totais
  const totalVendas    = pedidos.reduce((s,o) => s + (Number(o.total)||0), 0);
  const totalProdutos  = pedidos.reduce((s,o) => s + (o.items||[]).reduce((x,i)=>x+(Number(i.qty)||0), 0), 0);

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">👤 Relatório por Colaborador <span style="font-size:11px;color:var(--muted);font-weight:400;">· ${periodLabel}</span></div>
  <div class="g3" style="gap:10px;align-items:end;">
    <div class="fg"><label class="fl">Colaborador</label>
      <select class="fi" id="rel-colab-id">
        <option value="">— Selecione —</option>
        ${colabs.sort((a,b) => (a.name||'').localeCompare(b.name||'')).map(c => { const cid = _colabKey(c); return `<option value="${cid}" ${String(colabId)===cid?'selected':''}>${c.name} (${c.cargo||'—'})</option>`; }).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Setor</label>
      <select class="fi" id="rel-setor">
        <option value="todos" ${setor==='todos'?'selected':''}>Todos</option>
        <option value="vendas" ${setor==='vendas'?'selected':''}>💰 Vendas</option>
        <option value="montagem" ${setor==='montagem'?'selected':''}>🌸 Montagem</option>
        <option value="expedicao" ${setor==='expedicao'?'selected':''}>📦 Expedição</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Ordenar por</label>
      <select class="fi" id="rel-ordenar">
        <option value="data" ${ordenar==='data'?'selected':''}>Data (mais recente)</option>
        <option value="valor" ${ordenar==='valor'?'selected':''}>Valor (maior)</option>
        <option value="qtd" ${ordenar==='qtd'?'selected':''}>Quantidade (maior)</option>
      </select>
    </div>
    <button class="btn btn-primary" id="btn-export-por-colab" ${!colabId?'disabled':''}>📤 Exportar CSV</button>
  </div>
</div>

${!colabId ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">👤</div>
  <h3>Selecione um colaborador</h3>
  <p style="font-size:13px;margin-top:6px;">Escolha quem você quer analisar acima.</p>
</div>
` : pedidos.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">📭</div>
  <p>${colab?.name || 'Colaborador'} não tem registros em ${setor==='todos'?'nenhum setor':setor} no período.</p>
</div>
` : `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Colaborador</div>
      <div style="font-size:18px;font-weight:700;color:#9F1239;">${colab?.name || '—'}</div>
      <div style="font-size:11px;color:var(--muted);">${colab?.cargo || ''}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Pedidos</div>
      <div style="font-size:24px;font-weight:900;">${pedidos.length}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Total Vendas</div>
      <div style="font-size:20px;font-weight:900;color:#15803D;">${$c(totalVendas)}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Produtos</div>
      <div style="font-size:24px;font-weight:900;">${totalProdutos}</div>
    </div>
  </div>
</div>

<div class="card" style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Pedido</th>
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Cliente</th>
      <th style="padding:10px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Produtos</th>
      <th style="padding:10px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;">Valor</th>
      <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data Venda</th>
      <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Data Expedição</th>
      <th style="padding:10px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;">Setor</th>
    </tr></thead>
    <tbody>
      ${pedidos.map(o => {
        const setores = [];
        if (_isMine(colab, o.vendedorId, o.vendedorEmail, o.createdByColabId, o.createdByEmail, o.criadoPor, o.createdBy, o.createdByName)) setores.push('💰');
        if (_isMine(colab, o.montadorId, o.montadorEmail, o.montadorNome)) setores.push('🌸');
        if (_isMine(colab, o.expedidorId, o.expedidorEmail)) setores.push('📦');
        const dataVenda = o.createdAt ? new Date(o.createdAt).toLocaleDateString('pt-BR') : '—';
        const dataExp   = o.expedidoEm ? new Date(o.expedidoEm).toLocaleDateString('pt-BR') : '—';
        return `<tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:8px 10px;font-weight:700;color:#7C3AED;">${fmtOrderNum(o)}</td>
          <td style="padding:8px 10px;">${o.clientName||o.client?.name||'—'}</td>
          <td style="padding:8px 10px;font-size:11px;">${(o.items||[]).map(i => `<div>${i.qty}× ${i.name||'?'} <span style="color:var(--muted);">(${i.code||i.product||'—'})</span> · ${$c(i.unitPrice)} = ${$c(i.totalPrice||i.unitPrice*i.qty)}</div>`).join('')}</td>
          <td style="padding:8px 10px;text-align:right;font-weight:700;">${$c(o.total)}</td>
          <td style="padding:8px 10px;text-align:center;font-size:11px;">${dataVenda}</td>
          <td style="padding:8px 10px;text-align:center;font-size:11px;">${dataExp}</td>
          <td style="padding:8px 10px;text-align:center;font-size:14px;">${setores.join(' ')}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>
`}
`;
}

// ── RELATORIO CHAO DE DATAS COMEMORATIVAS ────────────────────
// 3 sub-abas independentes:
//  A. 🌸 Produtos a Montar  — date range + lista alfabética c/ qtd
//  B. 📍 Bairro/Zona        — date range + agrupa por TURNO → ZONA → BAIRRO
//  C. 🖨️ Comandas p/ Imprimir — date range + organização (zona/bairro/turno) + batch print
function renderChaoDatas(orders) {
  const sub = S._chaoSub || 'produtos'; // produtos | zonas | comandas
  const d1  = S._chaoD1 || '';
  const d2  = S._chaoD2 || '';

  // Filtro comum: range de data de entrega (aceita d1==d2 para 1 dia)
  let pedidos = orders;
  if (d1 || d2) {
    pedidos = pedidos.filter(o => {
      const d = String(o.scheduledDate||'').slice(0,10);
      if (!d) return false;
      if (d1 && d < d1) return false;
      if (d2 && d > d2) return false;
      return true;
    });
  }

  const subBtn = (k, label) => `<button type="button" class="tab ${sub===k?'active':''}" data-chao-sub="${k}" style="font-size:12px;">${label}</button>`;

  // Header comum (filtros de data + abas)
  const header = `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🌹 Chão de Datas Comemorativas <span style="font-size:11px;color:var(--muted);font-weight:400;">· Produção e logística</span></div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-bottom:10px;">
    <div class="fg"><label class="fl">Data de entrega — inicial</label>
      <input type="date" class="fi" id="chao-d1" value="${d1}"/></div>
    <div class="fg"><label class="fl">Data de entrega — final</label>
      <input type="date" class="fi" id="chao-d2" value="${d2}"/></div>
    <button class="btn btn-ghost btn-sm" id="chao-clear-dates">✕ Limpar datas</button>
    <div style="margin-left:auto;font-size:11px;color:var(--muted);">${pedidos.length} pedido(s) no período</div>
  </div>
  <div class="tabs" style="gap:4px;border-top:1px solid var(--border);padding-top:10px;">
    ${subBtn('produtos', '🌸 Produtos a Montar')}
    ${subBtn('zonas',    '📍 Bairro / Zona de Entrega')}
    ${subBtn('comandas', '🖨️ Comandas para Imprimir')}
  </div>
</div>`;

  if (sub === 'produtos') return header + renderChaoProdutos(pedidos);
  if (sub === 'zonas')    return header + renderChaoZonas(pedidos);
  if (sub === 'comandas') return header + renderChaoComandas(pedidos);
  return header;
}

// ─── A) PRODUTOS A MONTAR ───────────────────────────────────
function renderChaoProdutos(pedidos) {
  const ordem = S._chaoProdOrdem || 'alfa'; // alfa | qtd
  // Agrega produtos + lista de pedidos onde aparecem
  const map = {};
  for (const o of pedidos) {
    const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
    for (const it of (o.items || [])) {
      const key = String(it.code || it.product || it.name || '?');
      if (!map[key]) map[key] = { code: it.code || it.product || '—', name: it.name || '?', qty: 0, pedidos: [] };
      const q = Number(it.qty) || 0;
      map[key].qty += q;
      if (num) map[key].pedidos.push({ num, qty: q });
    }
  }
  let produtos = Object.values(map);
  if (ordem === 'qtd') produtos.sort((a,b) => b.qty - a.qty || a.name.localeCompare(b.name));
  else                 produtos.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));

  const totalQtd  = produtos.reduce((s,p) => s+p.qty, 0);
  const totalProd = produtos.length;

  return `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-around;flex-wrap:wrap;gap:10px;align-items:center;">
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Produtos diferentes</div>
      <div style="font-size:24px;font-weight:900;color:#9F1239;">${totalProd}</div>
    </div>
    <div style="text-align:center;">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Total de unidades a montar</div>
      <div style="font-size:24px;font-weight:900;color:#15803D;">${totalQtd}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <span style="font-size:11px;color:var(--muted);">Ordenar:</span>
      <select class="fi" id="chao-prod-ordem" style="width:auto;font-size:12px;">
        <option value="alfa" ${ordem==='alfa'?'selected':''}>A → Z (alfabética)</option>
        <option value="qtd"  ${ordem==='qtd' ?'selected':''}>Quantidade (maior)</option>
      </select>
      <button class="btn btn-primary btn-sm" id="btn-export-chao-prod">📤 CSV</button>
      <button class="btn btn-ghost btn-sm" id="btn-print-chao-prod">🖨️ Imprimir lista</button>
    </div>
  </div>
</div>

${produtos.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">📭</div>
  <p>Nenhum produto no período selecionado.</p>
</div>
` : `
<div class="card" style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;width:50px;">#</th>
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;width:110px;">Cód. Produto</th>
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Produto</th>
      <th style="padding:12px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;width:130px;">Qtd a Montar</th>
      <th style="padding:12px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;">Cód. Pedido(s)</th>
    </tr></thead>
    <tbody>
      ${produtos.map((p, i) => {
        // Agrupa pedidos repetidos somando quantidades
        const pedAgg = {};
        (p.pedidos||[]).forEach(pp => {
          if (!pedAgg[pp.num]) pedAgg[pp.num] = 0;
          pedAgg[pp.num] += pp.qty;
        });
        const pedHTML = Object.entries(pedAgg)
          .sort((a,b) => a[0].localeCompare(b[0]))
          .map(([num, q]) => `<span style="display:inline-block;background:#FAE8E6;color:#9F1239;border:1px solid #FECDD3;border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;font-family:Monaco,monospace;margin:1px 2px;">#${num}${q>1?`<span style="color:#15803D;margin-left:4px;">×${q}</span>`:''}</span>`)
          .join('');
        return `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:10px 12px;color:var(--muted);font-size:11px;vertical-align:top;">${i+1}</td>
          <td style="padding:10px 12px;font-family:Monaco,monospace;color:#7C3AED;font-weight:700;vertical-align:top;">${p.code}</td>
          <td style="padding:10px 12px;font-weight:600;vertical-align:top;">${p.name}</td>
          <td style="padding:10px 12px;text-align:center;vertical-align:top;"><span style="display:inline-block;background:#15803D;color:#fff;padding:6px 18px;border-radius:999px;font-weight:900;font-size:15px;min-width:60px;">${p.qty}</span></td>
          <td style="padding:10px 12px;vertical-align:top;">${pedHTML || '<span style="color:var(--muted);">—</span>'}</td>
        </tr>
      `;
      }).join('')}
    </tbody>
  </table>
</div>
<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px;margin-top:10px;font-size:12px;color:#1E40AF;">
  💡 Lista pronta para a equipe de montagem: cada linha indica quantos produtos preparar no período.
</div>
`}`;
}

// ─── B) BAIRRO / ZONA DE ENTREGA ────────────────────────────
function renderChaoZonas(pedidos) {
  // Agrupa: TURNO → ZONA → BAIRRO → pedidos
  const turnosOrdem = ['manha','tarde','noite','sem'];
  const buckets = {};
  for (const t of turnosOrdem) buckets[t] = {};

  for (const o of pedidos) {
    const t = getTurnoPedido(o);
    const z = resolveZona(o);
    const b = (o.deliveryNeighborhood || o.deliveryZone || 'Sem bairro').trim() || 'Sem bairro';
    if (!buckets[t][z]) buckets[t][z] = {};
    if (!buckets[t][z][b]) buckets[t][z][b] = [];
    buckets[t][z][b].push(o);
  }

  const totalP = pedidos.length;

  let html = `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Total de entregas</div>
      <div style="font-size:24px;font-weight:900;color:#9F1239;">${totalP}</div>
    </div>
    <div style="font-size:12px;color:var(--muted);max-width:380px;text-align:right;">
      Pedidos organizados por <strong>turno → zona → bairro</strong> para facilitar o roteiro do entregador.
    </div>
    <button class="btn btn-primary btn-sm" id="btn-export-chao-zonas">📤 CSV</button>
  </div>
</div>`;

  if (totalP === 0) {
    html += `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
      <div style="font-size:48px;margin-bottom:12px;">📭</div>
      <p>Nenhuma entrega no período selecionado.</p>
    </div>`;
    return html;
  }

  for (const t of turnosOrdem) {
    const zonas = buckets[t];
    const zonasKeys = Object.keys(zonas);
    if (!zonasKeys.length) continue;
    const meta = TURNOS[t];
    const totalTurno = zonasKeys.reduce((s,z) => s + Object.values(zonas[z]).reduce((x,arr)=>x+arr.length,0), 0);

    html += `<div class="card" style="margin-bottom:12px;border-left:6px solid ${meta.color};">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid ${meta.color}33;">
        <span style="font-size:18px;font-weight:900;color:${meta.color};">${meta.label}</span>
        <span style="background:${meta.color};color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:800;">${totalTurno} entrega${totalTurno>1?'s':''}</span>
      </div>`;

    // Ordena zonas: pelos keys de ZONAS_MANAUS, "Outros" no fim
    const zonasOrd = zonasKeys.sort((a,b) => {
      if (a === 'Outros') return 1;
      if (b === 'Outros') return -1;
      return a.localeCompare(b, 'pt-BR');
    });

    for (const zk of zonasOrd) {
      const zMeta = ZONAS_MANAUS[zk] || { label: zk, color:'#64748B' };
      const bairros = zonas[zk];
      const bairrosOrd = Object.keys(bairros).sort((a,b)=>a.localeCompare(b,'pt-BR'));
      const totalZona = Object.values(bairros).reduce((s,arr)=>s+arr.length,0);

      html += `<div style="margin-bottom:10px;background:${zMeta.color}08;border-radius:8px;padding:10px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="background:${zMeta.color};color:#fff;border-radius:6px;padding:2px 10px;font-size:11px;font-weight:800;">${zMeta.label}</span>
          <span style="font-size:11px;color:var(--muted);font-weight:700;">${totalZona} entrega(s)</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#fff;border-bottom:1px solid ${zMeta.color}33;">
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Bairro</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Pedido</th>
            <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Produto(s)</th>
            <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;">Hora</th>
          </tr></thead>
          <tbody>`;

      for (const bn of bairrosOrd) {
        const lista = bairros[bn].sort((a,b) => String(a.scheduledTime||'99').localeCompare(String(b.scheduledTime||'99')));
        const totalBairro = lista.length;
        lista.forEach((o, idx) => {
          const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
          const prods = (o.items||[]).map(i => `${i.qty}× ${i.name||'?'}`).join(' · ');
          const hora = (o.scheduledTime && o.scheduledTime!=='00:00') ? o.scheduledTime : (o.scheduledPeriod || '—');
          // Badge de contagem aparece SOMENTE na primeira linha do bairro
          const bairroCell = idx === 0
            ? `<span style="font-weight:700;color:#1E293B;">${bn}</span> <span style="display:inline-block;background:${zMeta.color};color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;margin-left:4px;">${totalBairro}</span>`
            : '';
          html += `<tr style="border-bottom:1px solid #F1F5F9;background:${idx%2?'rgba(255,255,255,.5)':'transparent'};">
            <td style="padding:6px 8px;">${bairroCell}</td>
            <td style="padding:6px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;">#${num||'—'}</td>
            <td style="padding:6px 8px;color:#475569;">${prods||'—'}</td>
            <td style="padding:6px 8px;text-align:center;font-weight:700;color:${meta.color};">${hora}</td>
          </tr>`;
        });
      }
      html += `</tbody></table></div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ─── C) COMANDAS PARA IMPRIMIR ──────────────────────────────
function renderChaoComandas(pedidos) {
  const org = S._chaoComandaOrg || 'turno'; // turno | zona | bairro | prioridade

  // Filtros pre-selecao
  const filTurnos    = new Set(S._chaoFilTurnos    || []); // ['manha','tarde','noite','sem']
  const filZonas     = new Set(S._chaoFilZonas     || []); // ['Centro-Sul','Leste',...]
  const filBairros   = new Set(S._chaoFilBairros   || []); // ['Centro','Aleixo',...]
  const filPrioridades = new Set(S._chaoFilPrioridades || []); // ['alta','media','baixa']
  const selecionados = new Set(S._chaoSelecionados || []); // _ids dos pedidos marcados

  // Helper: prioridade por antecedencia (criado vs entrega)
  const _prioridadeOrdem = { alta:0, media:1, baixa:2, normal:3 };
  const _prioridadePedido = (o) => {
    if (!o.createdAt || !o.scheduledDate) return { key:'normal', label:'Normal', cor:'#64748B' };
    const dd = Math.floor((new Date(o.scheduledDate) - new Date(o.createdAt))/86400000);
    if (dd >= 14) return { key:'alta',  label:'🎯 Alta',  cor:'#DC2626' };
    if (dd >= 7)  return { key:'media', label:'📅 Média', cor:'#F59E0B' };
    if (dd >= 3)  return { key:'baixa', label:'⏰ Baixa', cor:'#15803D' };
    return { key:'normal', label:'Normal', cor:'#64748B' };
  };

  // Aplica filtros
  let filtrados = pedidos.filter(o => {
    if (filTurnos.size && !filTurnos.has(getTurnoPedido(o))) return false;
    if (filZonas.size && !filZonas.has(resolveZona(o))) return false;
    if (filBairros.size) {
      const b = (o.deliveryNeighborhood || o.deliveryZone || '').trim();
      if (!filBairros.has(b)) return false;
    }
    if (filPrioridades.size && !filPrioridades.has(_prioridadePedido(o).key)) return false;
    return true;
  });

  // Ordena
  let ordenados = [...filtrados];
  if (org === 'turno') {
    const w = { manha:0, tarde:1, noite:2, sem:3 };
    ordenados.sort((a,b) => {
      const ta = w[getTurnoPedido(a)], tb = w[getTurnoPedido(b)];
      if (ta !== tb) return ta - tb;
      return String(a.scheduledTime||'99').localeCompare(String(b.scheduledTime||'99'));
    });
  } else if (org === 'zona') {
    ordenados.sort((a,b) => {
      const za = resolveZona(a), zb = resolveZona(b);
      if (za !== zb) return za.localeCompare(zb,'pt-BR');
      return (a.deliveryNeighborhood||'').localeCompare(b.deliveryNeighborhood||'','pt-BR');
    });
  } else if (org === 'prioridade') {
    ordenados.sort((a,b) => {
      const pa = _prioridadeOrdem[_prioridadePedido(a).key];
      const pb = _prioridadeOrdem[_prioridadePedido(b).key];
      if (pa !== pb) return pa - pb;
      return String(a.scheduledTime||'99').localeCompare(String(b.scheduledTime||'99'));
    });
  } else { // bairro
    ordenados.sort((a,b) => (a.deliveryNeighborhood||'zzz').localeCompare(b.deliveryNeighborhood||'zzz','pt-BR'));
  }

  // Agrupa para exibição
  const groupKey = (o) => {
    if (org === 'turno') return TURNOS[getTurnoPedido(o)]?.label || '—';
    if (org === 'zona')  return ZONAS_MANAUS[resolveZona(o)]?.label || '—';
    if (org === 'prioridade') return _prioridadePedido(o).label;
    return o.deliveryNeighborhood || o.deliveryZone || 'Sem bairro';
  };
  const grupos = {};
  for (const o of ordenados) {
    const k = groupKey(o);
    if (!grupos[k]) grupos[k] = [];
    grupos[k].push(o);
  }

  // Listas de opcoes para os filtros chips
  const turnosDisponiveis = [
    { k:'manha', l:'🌅 Manhã' },
    { k:'tarde', l:'☀️ Tarde' },
    { k:'noite', l:'🌙 Noite' },
    { k:'sem',   l:'❓ Sem turno' },
  ];
  const zonasDisponiveis = Object.entries(ZONAS_MANAUS).map(([k,v]) => ({ k, l:v.label }));
  const bairrosDisponiveis = [...new Set(pedidos.map(o => (o.deliveryNeighborhood||o.deliveryZone||'').trim()).filter(Boolean))].sort();
  const prioridadesDisponiveis = [
    { k:'alta',   l:'🎯 Alta',   cor:'#DC2626' },
    { k:'media',  l:'📅 Média',  cor:'#F59E0B' },
    { k:'baixa',  l:'⏰ Baixa',  cor:'#15803D' },
    { k:'normal', l:'Normal',    cor:'#64748B' },
  ];

  const chipFiltro = (kind, key, label, cor) => {
    const ativo = (
      (kind==='turno'      && filTurnos.has(key))    ||
      (kind==='zona'       && filZonas.has(key))     ||
      (kind==='bairro'     && filBairros.has(key))   ||
      (kind==='prioridade' && filPrioridades.has(key))
    );
    const c = cor || '#9F1239';
    return `<button type="button" data-chao-fil="${kind}" data-chao-fil-val="${esc(key)}"
      style="background:${ativo?c:'#fff'};color:${ativo?'#fff':c};border:1px solid ${c};
      border-radius:14px;padding:3px 10px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;">
      ${ativo?'✓ ':''}${label}
    </button>`;
  };

  // Quantos selecionados (apos filtro)
  const idsAposFiltro = new Set(ordenados.map(o => String(o._id)));
  const qtdSelecAposFiltro = [...selecionados].filter(id => idsAposFiltro.has(id)).length;
  // Quantos vao imprimir: se ha selecionados use, senao todos do filtro
  const idsParaImprimir = qtdSelecAposFiltro > 0
    ? ordenados.filter(o => selecionados.has(String(o._id)))
    : ordenados;

  return `
<div class="card" style="margin-bottom:10px;background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Comandas (após filtros)</div>
      <div style="font-size:24px;font-weight:900;color:#9F1239;">${ordenados.length} <span style="font-size:13px;color:var(--muted);font-weight:500;">de ${pedidos.length} no período</span></div>
      ${qtdSelecAposFiltro > 0 ? `<div style="font-size:11px;color:#15803D;font-weight:700;margin-top:2px;">✓ ${qtdSelecAposFiltro} selecionado(s) para imprimir</div>` : ''}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--muted);font-weight:700;">Organizar por:</span>
      <select class="fi" id="chao-comanda-org" style="width:auto;font-size:12px;">
        <option value="turno"      ${org==='turno'     ?'selected':''}>⏰ Turno</option>
        <option value="zona"       ${org==='zona'      ?'selected':''}>🗺️ Zona</option>
        <option value="bairro"     ${org==='bairro'    ?'selected':''}>📍 Bairro</option>
        <option value="prioridade" ${org==='prioridade'?'selected':''}>🎯 Prioridade</option>
      </select>
      <button class="btn btn-primary btn-sm" id="btn-print-chao-comandas" ${idsParaImprimir.length===0?'disabled':''}>
        🖨️ Imprimir ${qtdSelecAposFiltro>0 ? qtdSelecAposFiltro+' selecionada(s)' : 'TODAS '+ordenados.length}
      </button>
    </div>
  </div>

  <!-- Filtros Multi-select por chip -->
  <div style="display:grid;gap:8px;">
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">⏰ Turno (clique p/ filtrar)</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${turnosDisponiveis.map(t => chipFiltro('turno', t.k, t.l, '#3B82F6')).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">🗺️ Zona</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${zonasDisponiveis.map(z => chipFiltro('zona', z.k, z.l, '#7C3AED')).join('')}
      </div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">🎯 Prioridade</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">
        ${prioridadesDisponiveis.map(p => chipFiltro('prioridade', p.k, p.l, p.cor)).join('')}
      </div>
    </div>
    ${bairrosDisponiveis.length ? `
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">📍 Bairro (${bairrosDisponiveis.length} disponíveis)</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;max-height:80px;overflow-y:auto;padding:4px;background:#fff;border-radius:6px;">
        ${bairrosDisponiveis.map(b => chipFiltro('bairro', b, b, '#059669')).join('')}
      </div>
    </div>
    ` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px dashed #FECDD3;">
      <button class="btn btn-ghost btn-xs" id="btn-chao-fil-clear" style="font-size:11px;color:#DC2626;">✕ Limpar filtros</button>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-ghost btn-xs" id="btn-chao-sel-all" style="font-size:11px;">☑️ Selecionar todas mostradas</button>
        <button class="btn btn-ghost btn-xs" id="btn-chao-sel-none" style="font-size:11px;">☐ Limpar seleção</button>
      </div>
    </div>
  </div>
</div>

${ordenados.length === 0 ? `
<div class="card" style="text-align:center;padding:40px;color:var(--muted);">
  <div style="font-size:48px;margin-bottom:12px;">📭</div>
  <p>Nenhum pedido com esses filtros.</p>
</div>
` : `
<div class="card">
  ${Object.entries(grupos).map(([gk, lista]) => {
    const idsGrupo = lista.map(o => String(o._id));
    const selecGrupo = idsGrupo.filter(id => selecionados.has(id)).length;
    const todasSelecGrupo = selecGrupo === idsGrupo.length;
    return `
    <div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:#FAFAFA;border-radius:8px;margin-bottom:6px;border-left:4px solid var(--rose);">
        <input type="checkbox" data-chao-sel-grupo="${esc(idsGrupo.join(','))}" ${todasSelecGrupo?'checked':''}
          style="width:16px;height:16px;cursor:pointer;accent-color:var(--rose);" title="Selecionar/desmarcar grupo"/>
        <span style="font-weight:800;color:var(--ink);font-size:13px;">${gk}</span>
        <span style="background:var(--rose);color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">${lista.length} entrega(s)</span>
        ${selecGrupo>0 ? `<span style="background:#15803D;color:#fff;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700;">✓ ${selecGrupo} selec.</span>` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#fff;border-bottom:1px solid var(--border);">
          <th style="padding:6px 8px;text-align:center;width:36px;"></th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;width:90px;">Pedido</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Cliente / Destinatário</th>
          <th style="padding:6px 8px;text-align:left;font-size:10px;color:#64748B;text-transform:uppercase;">Bairro</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;width:90px;">Prior.</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;width:90px;">Hora</th>
          <th style="padding:6px 8px;text-align:center;font-size:10px;color:#64748B;text-transform:uppercase;width:60px;">Imp.</th>
        </tr></thead>
        <tbody>
          ${lista.map(o => {
            const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
            const cli = o.clientName || o.client?.name || '—';
            const dst = o.recipient && o.recipient !== cli ? ` → ${o.recipient}` : '';
            const bairro = o.deliveryNeighborhood || o.deliveryZone || '—';
            const hora = (o.scheduledTime && o.scheduledTime!=='00:00') ? o.scheduledTime : (o.scheduledPeriod || '—');
            const prio = _prioridadePedido(o);
            const selecionado = selecionados.has(String(o._id));
            return `<tr style="border-bottom:1px solid #F1F5F9;${selecionado?'background:#DCFCE7;':''}">
              <td style="padding:6px 8px;text-align:center;">
                <input type="checkbox" data-chao-sel="${o._id}" ${selecionado?'checked':''}
                  style="width:16px;height:16px;cursor:pointer;accent-color:#15803D;"/>
              </td>
              <td style="padding:6px 8px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;">#${num||'—'}</td>
              <td style="padding:6px 8px;font-weight:600;">${cli}<span style="color:#059669;font-weight:500;font-size:11px;">${dst}</span></td>
              <td style="padding:6px 8px;color:#475569;">${bairro}</td>
              <td style="padding:6px 8px;text-align:center;">
                <span style="background:${prio.cor}22;color:${prio.cor};border:1px solid ${prio.cor}44;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;">${prio.label}</span>
              </td>
              <td style="padding:6px 8px;text-align:center;font-weight:700;color:#1E40AF;">${hora}</td>
              <td style="padding:6px 8px;text-align:center;">
                <button class="btn btn-ghost btn-xs" data-chao-print="${o._id}" title="Imprimir esta">🖨️</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  }).join('')}
</div>

<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px;margin-top:10px;font-size:12px;color:#1E40AF;">
  💡 Use os <strong>chips</strong> acima para filtrar por turno/zona/prioridade/bairro e os <strong>checkboxes</strong> para selecionar comandas específicas.
  Sem seleção = imprime todas filtradas. Com seleção = imprime só as marcadas. <strong>1 grupo = 1 click</strong> seleciona/desmarca tudo.
</div>
`}`;
}

// ── TAB ALTA DEMANDA: Relatorio para datas especiais ──────────
// Dia das Maes, Namorados, Natal, Dia da Mulher — ou data custom.
// Agrega todos os dados do PDV com filtros por produto, bairro,
// horario e data de entrega.
function renderTabAltaDemanda(){
  // Datas especiais (ano corrente) — ajuste automaticamente para o proximo ano
  // quando a data atual ja passou. Usa fuso Manaus (UTC-4) para determinar "hoje".
  const now = new Date();
  const manausNow = new Date(now.getTime() - (4*60 + now.getTimezoneOffset())*60000);
  const thisYear = manausNow.getFullYear();

  // Dia das Maes BR = 2o domingo de maio
  const maesDate = (y) => {
    const d = new Date(y, 4, 1); // 1 de maio
    // avanca ate primeiro domingo
    while (d.getDay() !== 0) d.setDate(d.getDate()+1);
    d.setDate(d.getDate()+7); // segundo domingo
    return d.toISOString().slice(0,10);
  };
  const presets = [
    { key: 'maes',      label: '💐 Dia das Mães',     emoji: '💐', date: maesDate(thisYear) },
    { key: 'namorados', label: '💕 Dia dos Namorados', emoji: '💕', date: `${thisYear}-06-12` },
    { key: 'mulher',    label: '🌹 Dia da Mulher',    emoji: '🌹', date: `${thisYear}-03-08` },
    { key: 'pais',      label: '🎩 Dia dos Pais',     emoji: '🎩', date: (y=>{
        const d=new Date(y,7,1); while(d.getDay()!==0) d.setDate(d.getDate()+1); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10);
      })(thisYear) },
    { key: 'natal',     label: '🎄 Natal',            emoji: '🎄', date: `${thisYear}-12-24` },
    { key: 'valentines',label: '❤️ Valentines Day',   emoji: '❤️', date: `${thisYear}-02-14` },
    { key: 'finados',   label: '🕯️ Finados',          emoji: '🕯️', date: `${thisYear}-11-02` },
  ];

  const selPreset = S._relAltaPreset ?? 'maes';
  const customDate = S._relAltaDate || '';
  const rangeDays  = parseInt(S._relAltaRange, 10) || 3; // dias antes da data
  const fProd   = (S._relAltaProd  || '').toLowerCase().trim();
  const fBairro = (S._relAltaBairro|| '').toLowerCase().trim();
  const fHora1  = S._relAltaHora1 || '';
  const fHora2  = S._relAltaHora2 || '';
  const fTurno  = S._relAltaTurno  || '';     // manha | tarde | noite
  const fPrio   = S._relAltaPrio   || '';     // antecipado | urgente | ultima
  const fStatus = S._relAltaStatus || '';
  const fSecao  = S._relAltaSecao  || 'resumo'; // resumo | producao | entregas | priorizacao | rota | alertas

  // ── HELPERS de turno/priorizacao/rota ──
  // Turnos oficiais: Manha 07-12, Tarde 12:01-18, Noite 18:01-20
  const getTurno = (hm) => {
    if(!hm || hm==='00:00') return '—';
    const [hh, mm] = hm.split(':').map(Number);
    const mins = hh * 60 + (mm || 0);
    if(mins >= 7*60  && mins <= 12*60) return 'manha';
    if(mins >  12*60 && mins <= 18*60) return 'tarde';
    if(mins >  18*60 && mins <= 20*60) return 'noite';
    return '—';
  };
  const turnoLabel = { manha: '🌅 Manhã', tarde: '🌤️ Tarde', noite: '🌙 Noite', '—': 'Sem horário' };

  // Prioridade a partir do diff criado vs entregar
  const getPrioLevel = (o) => {
    if(!o.createdAt || !o.scheduledDate) return { key:'normal', label:'Normal', days:0 };
    const dd = Math.floor((new Date(o.scheduledDate) - new Date(o.createdAt))/86400000);
    if(dd >= 14) return { key:'antecipado', label:'🎯 Antecipado', days:dd };
    if(dd >= 3)  return { key:'antecipado', label:'📅 Antecipado', days:dd };
    if(dd === 0) return { key:'ultima', label:'⚡ Última hora', days:0 };
    return { key:'urgente', label:'🔥 Urgente', days:dd };
  };

  // Zona geografica (regioes de Manaus) — agrupa bairros para roteirizacao
  const getZona = (bairro) => {
    const b = (bairro||'').toLowerCase().trim();
    if(!b) return 'Sem bairro';
    // Centro-Sul
    if(/centro|cachoeirinha|nossa senhora|praca|praça|14 de janeiro|mauazinho|educand|rio negro|adrianopolis|adrianópolis|petropolis|petrópolis|sao geraldo|são geraldo|chapada|parque 10|aleixo/.test(b))
      return 'Centro-Sul';
    // Zona Leste
    if(/jorge teixeira|armando|aleixo|sao jose|são josé|tancredo|colonia|colônia|zumbi|mauazinho|flores|gilberto mestrinho|distrito/.test(b))
      return 'Leste';
    // Zona Norte
    if(/novo aleixo|santa etelvina|cidade nova|monte das|aeroporto|lirio|lírio|nova cidade/.test(b))
      return 'Norte';
    // Zona Oeste
    if(/compensa|santo antonio|santo antônio|sao jorge|são jorge|da paz|glória|gloria|alvorada|redencao|redenção|coroado|planalto|dom pedro/.test(b))
      return 'Oeste';
    return 'Outros';
  };

  // Determina data alvo
  let targetDate = customDate;
  if (!customDate && selPreset) {
    const p = presets.find(x => x.key === selPreset);
    if (p) targetDate = p.date;
  }

  // Janela: (targetDate - rangeDays) ate targetDate
  const targetD = targetDate ? new Date(targetDate + 'T12:00:00') : null;
  const startD  = targetD ? new Date(targetD.getTime() - rangeDays*86400000) : null;

  const inRange = (iso) => {
    if (!iso || !startD || !targetD) return false;
    const d = new Date(iso);
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
    const sDay = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate(), 0);
    const tDay = new Date(targetD.getFullYear(), targetD.getMonth(), targetD.getDate(), 23, 59);
    return dDay >= sDay && dDay <= tDay;
  };

  // Base: pedidos com scheduledDate dentro da janela
  let altos = S.orders.filter(o => o.scheduledDate && inRange(o.scheduledDate));

  // Filtros
  if (fProd) {
    altos = altos.filter(o =>
      (o.items||[]).some(i => (i.name||'').toLowerCase().includes(fProd))
    );
  }
  if (fBairro) {
    altos = altos.filter(o =>
      ((o.deliveryNeighborhood||o.deliveryZone||'').toLowerCase()).includes(fBairro)
    );
  }
  if (fHora1 || fHora2) {
    altos = altos.filter(o => {
      const h = o.scheduledTime;
      if (!h || h === '00:00') return false;
      if (fHora1 && h < fHora1) return false;
      if (fHora2 && h > fHora2) return false;
      return true;
    });
  }
  if (fTurno) {
    altos = altos.filter(o => getTurno(o.scheduledTime) === fTurno);
  }
  if (fPrio) {
    altos = altos.filter(o => getPrioLevel(o).key === fPrio);
  }
  if (fStatus) {
    altos = altos.filter(o => o.status === fStatus);
  }

  // KPIs
  const totalPedidos  = altos.length;
  const totalFat      = altos.filter(o => o.status !== 'Cancelado').reduce((s,o)=>s+(Number(o.total)||0),0);
  const ticket        = totalPedidos ? totalFat/totalPedidos : 0;
  const entregues     = altos.filter(o => o.status === 'Entregue').length;
  const cancelados    = altos.filter(o => o.status === 'Cancelado').length;
  const pendentes     = altos.filter(o => !['Entregue','Cancelado'].includes(o.status)).length;

  // Agregacoes
  const byProd = {};
  altos.forEach(o => (o.items||[]).forEach(i => {
    const n = i.name || '—';
    if (!byProd[n]) byProd[n] = { qty:0, rev:0 };
    byProd[n].qty += Number(i.qty)||1;
    byProd[n].rev += Number(i.totalPrice) || (Number(i.unitPrice)||0)*(Number(i.qty)||1);
  }));
  const prodList = Object.entries(byProd).sort((a,b)=>b[1].qty-a[1].qty);

  const byBairro = {};
  altos.forEach(o => {
    const b = o.deliveryNeighborhood || o.deliveryZone || '—';
    byBairro[b] = (byBairro[b]||0) + 1;
  });
  const bairroList = Object.entries(byBairro).sort((a,b)=>b[1]-a[1]);

  const byHora = {};
  altos.forEach(o => {
    const h = (o.scheduledTime || '').slice(0,2);
    if (!h || h === '00') return;
    byHora[h+'h'] = (byHora[h+'h']||0) + 1;
  });
  const horaList = Object.entries(byHora).sort((a,b)=>a[0].localeCompare(b[0]));

  const byDia = {};
  altos.forEach(o => {
    const d = (o.scheduledDate||'').slice(0,10);
    byDia[d] = (byDia[d]||0) + 1;
  });
  const diaList = Object.entries(byDia).sort((a,b)=>a[0].localeCompare(b[0]));

  // Lista de bairros disponiveis (para autocomplete)
  const bairros = [...new Set(S.orders.map(o=>(o.deliveryNeighborhood||'').trim()).filter(Boolean))].sort();

  const formatDia = iso => {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('pt-BR',{weekday:'short', day:'2-digit', month:'short'});
  };

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">💐 Relatório de Alta Demanda</div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">
    Datas especiais concentram volume enorme em poucos dias. Este relatório organiza todos os pedidos do PDV para planejamento e análise.
  </p>

  <!-- Presets -->
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
    ${presets.map(p => `
      <button class="btn btn-sm ${selPreset===p.key && !customDate ? 'btn-primary' : 'btn-ghost'}"
        data-rel-alta-preset="${p.key}" style="font-weight:600;">${p.label}</button>
    `).join('')}
  </div>

  <!-- Filtros -->
  <div class="g3" style="gap:10px;margin-bottom:8px;">
    <div class="fg">
      <label class="fl">🗓️ Data alvo (custom)</label>
      <input type="date" class="fi" id="rel-alta-date" value="${customDate || targetDate || ''}"/>
    </div>
    <div class="fg">
      <label class="fl">📅 Dias antes p/ análise</label>
      <select class="fi" id="rel-alta-range">
        ${[1,2,3,5,7,10,14].map(n=>`<option value="${n}" ${rangeDays===n?'selected':''}>${n} dia${n>1?'s':''} antes</option>`).join('')}
      </select>
    </div>
    <div class="fg">
      <label class="fl">🌹 Produto</label>
      <input type="text" class="fi" id="rel-alta-prod" placeholder="Buscar produto..." value="${fProd}"/>
    </div>
  </div>
  <div class="g3" style="gap:10px;margin-bottom:8px;">
    <div class="fg">
      <label class="fl">📍 Bairro</label>
      <input type="text" class="fi" id="rel-alta-bairro" placeholder="Buscar bairro..." value="${fBairro}" list="rel-alta-bairros"/>
      <datalist id="rel-alta-bairros">${bairros.map(b=>`<option value="${b}">`).join('')}</datalist>
    </div>
    <div class="fg">
      <label class="fl">🕐 Horário de</label>
      <input type="time" class="fi" id="rel-alta-hora1" value="${fHora1}"/>
    </div>
    <div class="fg">
      <label class="fl">🕐 Até</label>
      <input type="time" class="fi" id="rel-alta-hora2" value="${fHora2}"/>
    </div>
  </div>
  <div class="g3" style="gap:10px;margin-bottom:12px;">
    <div class="fg">
      <label class="fl">⏰ Turno</label>
      <select class="fi" id="rel-alta-turno">
        <option value="">Todos</option>
        <option value="manha" ${fTurno==='manha'?'selected':''}>🌅 Manhã (07h–12h)</option>
        <option value="tarde" ${fTurno==='tarde'?'selected':''}>🌤️ Tarde (12h–18h)</option>
        <option value="noite" ${fTurno==='noite'?'selected':''}>🌙 Noite (18h–20h)</option>
      </select>
    </div>
    <div class="fg">
      <label class="fl">🎯 Prioridade</label>
      <select class="fi" id="rel-alta-prio">
        <option value="">Todas</option>
        <option value="antecipado" ${fPrio==='antecipado'?'selected':''}>📅 Antecipado (3+ dias antes)</option>
        <option value="urgente"    ${fPrio==='urgente'?'selected':''}>🔥 Urgente (1–2 dias)</option>
        <option value="ultima"     ${fPrio==='ultima'?'selected':''}>⚡ Última hora (mesmo dia)</option>
      </select>
    </div>
    <div class="fg">
      <label class="fl">📊 Status</label>
      <select class="fi" id="rel-alta-status">
        <option value="">Todos</option>
        ${['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Cancelado'].map(s=>`<option value="${s}" ${fStatus===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
  </div>

  <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;">
    <div style="font-size:12px;color:var(--muted);">
      ${targetDate ? `📌 Janela: <strong>${formatDia(startD?.toISOString().slice(0,10))}</strong> até <strong>${formatDia(targetDate)}</strong>` : 'Escolha uma data'}
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-ghost btn-sm" id="btn-rel-alta-clear">✕ Limpar filtros</button>
      <button class="btn btn-green btn-sm" id="btn-rel-alta-export">📤 Exportar CSV</button>
      <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Imprimir</button>
    </div>
  </div>
</div>

${!targetDate ? `
<div class="empty card"><div class="empty-icon">💐</div><p>Selecione uma data especial ou escolha uma data custom.</p></div>
` : `

<!-- Stash para export -->
${(()=>{ S._lastAltaDemandaOrders = altos; return ''; })()}

<!-- KPIs -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Pedidos no período</div><div class="mc-val">${totalPedidos}</div></div>
  <div class="mc leaf"><div class="mc-label">Faturamento</div><div class="mc-val">${$c(totalFat)}</div></div>
  <div class="mc gold"><div class="mc-label">Ticket Médio</div><div class="mc-val">${$c(ticket)}</div></div>
  <div class="mc purple"><div class="mc-label">Entregues</div><div class="mc-val">${entregues}</div><div class="mc-sub">${pendentes} pendentes · ${cancelados} cancelados</div></div>
</div>

<!-- Abas de secao operacional -->
<div class="tabs" style="margin-bottom:14px;">
  ${['resumo','producao','entregas','priorizacao','rota','alertas'].map(k => {
    const labels = {resumo:'📊 Resumo', producao:'🏭 Produção', entregas:'🚚 Entregas', priorizacao:'🎯 Priorização', rota:'🗺️ Roteirização', alertas:'🚨 Alertas'};
    return `<button class="tab ${fSecao===k?'active':''}" data-rel-alta-secao="${k}">${labels[k]}</button>`;
  }).join('')}
</div>

${fSecao==='resumo' ? `
<!-- ── SECAO: RESUMO ── -->
<div class="g4" style="margin-bottom:14px;">
  <div class="mc leaf"><div class="mc-label">🌅 Manhã</div><div class="mc-val">${altos.filter(o=>getTurno(o.scheduledTime)==='manha').length}</div></div>
  <div class="mc gold"><div class="mc-label">🌤️ Tarde</div><div class="mc-val">${altos.filter(o=>getTurno(o.scheduledTime)==='tarde').length}</div></div>
  <div class="mc purple"><div class="mc-label">🌙 Noite</div><div class="mc-val">${altos.filter(o=>getTurno(o.scheduledTime)==='noite').length}</div></div>
  <div class="mc rose"><div class="mc-label">🌹 Itens a produzir</div><div class="mc-val">${(()=>{let t=0;altos.forEach(o=>(o.items||[]).forEach(i=>t+=Number(i.qty)||1));return t;})()}</div></div>
</div>

<div class="g2">
  <!-- Produtos -->
  <div class="card">
    <div class="card-title">🌹 Produtos Mais Vendidos <span class="notif">${prodList.length}</span></div>
    ${prodList.length===0 ? `<div class="empty"><p>Sem produtos no filtro.</p></div>` : `
    <div style="max-height:360px;overflow-y:auto;">
      <table style="width:100%;font-size:12px;">
        <thead><tr style="text-align:left;border-bottom:1px solid var(--border);">
          <th style="padding:6px 4px;">#</th><th>Produto</th><th style="text-align:right;">Qtde</th><th style="text-align:right;">Receita</th>
        </tr></thead>
        <tbody>
        ${prodList.map(([n, {qty, rev}], i) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:6px 4px;color:var(--rose);font-weight:700;">#${i+1}</td>
            <td>${n}</td>
            <td style="text-align:right;font-weight:600;">${qty}</td>
            <td style="text-align:right;color:var(--leaf);font-weight:700;">${$c(rev)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`}
  </div>

  <!-- Por horario -->
  <div class="card">
    <div class="card-title">🕐 Distribuição por Horário</div>
    ${horaList.length===0 ? `<div class="empty"><p>Sem horários específicos.</p></div>` : `
    <div style="padding:4px 0;">
      ${(()=>{
        const maxH = Math.max(...horaList.map(([,v])=>v), 1);
        return horaList.map(([h, v]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;">
            <div style="width:44px;font-weight:700;">${h}</div>
            <div class="pb" style="flex:1;"><div class="pf" style="width:${(v/maxH)*100}%;background:var(--rose);"></div></div>
            <div style="width:38px;text-align:right;font-weight:600;">${v}</div>
          </div>`).join('');
      })()}
    </div>`}
  </div>
</div>

<div class="g2" style="margin-top:14px;">
  <!-- Por bairro -->
  <div class="card">
    <div class="card-title">📍 Pedidos por Bairro <span class="notif">${bairroList.length}</span></div>
    ${bairroList.length===0 ? `<div class="empty"><p>Sem bairros.</p></div>` : `
    <div style="max-height:300px;overflow-y:auto;padding:4px 0;">
      ${(()=>{
        const maxB = bairroList[0]?.[1] || 1;
        return bairroList.slice(0,20).map(([b, v]) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px;">
            <div style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${b}</div>
            <div class="pb" style="width:100px;"><div class="pf" style="width:${(v/maxB)*100}%;background:var(--leaf);"></div></div>
            <div style="width:34px;text-align:right;font-weight:700;">${v}</div>
          </div>`).join('');
      })()}
    </div>`}
  </div>

  <!-- Por dia -->
  <div class="card">
    <div class="card-title">📅 Pedidos por Data de Entrega</div>
    ${diaList.length===0 ? `<div class="empty"><p>Sem dados.</p></div>` : `
    <div style="padding:4px 0;">
      ${(()=>{
        const maxD = Math.max(...diaList.map(([,v])=>v), 1);
        return diaList.map(([d, v]) => {
          const isTarget = d === targetDate;
          return `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;${isTarget?'font-weight:800;color:var(--rose);':''}">
            <div style="width:110px;">${formatDia(d)}${isTarget?' 🎯':''}</div>
            <div class="pb" style="flex:1;"><div class="pf" style="width:${(v/maxD)*100}%;background:${isTarget?'var(--rose)':'var(--gold)'};"></div></div>
            <div style="width:38px;text-align:right;font-weight:700;">${v}</div>
          </div>`;
        }).join('');
      })()}
    </div>`}
  </div>
</div>

<!-- TODOS OS PEDIDOS (lista completa) -->
<div class="card" style="margin-top:14px;">
  <div class="card-title">📋 Pedidos no período <span class="notif">${altos.length}</span></div>
  ${altos.length===0 ? `<div class="empty"><div class="empty-icon">📋</div><p>Nenhum pedido nos filtros aplicados.</p></div>` : `
  <div style="overflow-x:auto;">
    <table>
      <thead><tr>
        <th>#</th><th>Cliente</th><th>Destinatário</th><th>Produto</th>
        <th>Bairro</th><th>Entrega</th><th>Horário</th><th>Total</th>
        <th>Canal</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${altos.sort((a,b)=>(a.scheduledDate||'').localeCompare(b.scheduledDate||'') || (a.scheduledTime||'').localeCompare(b.scheduledTime||'')).map(o => {
          const prod = (o.items||[]).map(i=>i.name).filter(Boolean).slice(0,2).join(', ') || '—';
          const canal = o.source || 'PDV';
          return `<tr>
            <td style="color:var(--rose);font-weight:700;white-space:nowrap;">${fmtOrderNum(o)}</td>
            <td>${o.client?.name || o.clientName || '—'}</td>
            <td style="font-size:11px;">${o.recipient || '—'}</td>
            <td style="font-size:11px;max-width:200px;">${prod}</td>
            <td style="font-size:11px;">${o.deliveryNeighborhood||o.deliveryZone||'—'}</td>
            <td style="font-size:11px;">${formatDia(o.scheduledDate)}</td>
            <td style="font-size:11px;font-weight:700;">${o.scheduledTime||'—'}${o.scheduledTimeEnd?'–'+o.scheduledTimeEnd:''}</td>
            <td style="font-weight:700;color:var(--leaf);">${$c(o.total||0)}</td>
            <td style="font-size:10px;">${canal}</td>
            <td><span class="tag ${sc(o.status)}" style="font-size:10px;">${o.status}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`}
</div>
` : ''}

${fSecao==='producao' ? `
<!-- ── SECAO: PRODUCAO ── -->
${(()=>{
  // Agrupa por produto (ordem alfabetica) com qtd total e pedidos vinculados
  const prodMap = {};
  altos.filter(o => !['Cancelado'].includes(o.status)).forEach(o => {
    (o.items||[]).forEach(i => {
      const n = i.name || '—';
      if(!prodMap[n]) prodMap[n] = { qty:0, pedidos:new Set(), itens:[] };
      prodMap[n].qty += Number(i.qty)||1;
      prodMap[n].pedidos.add(o.orderNumber||o._id);
      prodMap[n].itens.push({ orderNumber:o.orderNumber, qty:Number(i.qty)||1, obs:i.observacao||i.obs||'' });
    });
  });
  const prodEntries = Object.entries(prodMap).sort((a,b) => a[0].localeCompare(b[0],'pt-BR'));
  const totalItens = prodEntries.reduce((s,[,v])=>s+v.qty, 0);
  const repetidos  = prodEntries.filter(([,v]) => v.qty >= 3).length;

  // Lotes sugeridos: agrupar pedidos por data+turno
  const lotes = {};
  altos.filter(o => !['Cancelado','Entregue'].includes(o.status)).forEach(o => {
    const d = (o.scheduledDate||'').slice(0,10);
    const t = getTurno(o.scheduledTime);
    const key = `${d}__${t}`;
    if(!lotes[key]) lotes[key] = { date:d, turno:t, pedidos:[], itens:0 };
    lotes[key].pedidos.push(o);
    lotes[key].itens += (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1),0);
  });
  const lotesList = Object.values(lotes).sort((a,b)=>
    (a.date||'').localeCompare(b.date||'') ||
    ['manha','tarde','noite','—'].indexOf(a.turno) - ['manha','tarde','noite','—'].indexOf(b.turno)
  );

  return `
  <div class="g4" style="margin-bottom:14px;">
    <div class="mc rose"><div class="mc-label">Produtos distintos</div><div class="mc-val">${prodEntries.length}</div></div>
    <div class="mc leaf"><div class="mc-label">Total de itens</div><div class="mc-val">${totalItens}</div></div>
    <div class="mc gold"><div class="mc-label">Itens repetidos (3+)</div><div class="mc-val">${repetidos}</div></div>
    <div class="mc purple"><div class="mc-label">Lotes sugeridos</div><div class="mc-val">${lotesList.length}</div></div>
  </div>

  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">🌹 Produtos a Produzir <span class="notif">${prodEntries.length}</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Ordem alfabética · Destaque para repetidos</span>
    </div>
    ${prodEntries.length===0 ? `<div class="empty"><p>Sem itens para produção.</p></div>` : `
    <table style="width:100%;font-size:12px;">
      <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
        <th style="padding:8px 6px;">Produto</th>
        <th style="text-align:center;">Qtde total</th>
        <th style="text-align:center;">Pedidos</th>
        <th>Quebra por pedido</th>
      </tr></thead>
      <tbody>
        ${prodEntries.map(([n, v]) => {
          const isRepeat = v.qty >= 3;
          const bg = isRepeat ? 'background:#FFFBEB;' : '';
          return `<tr style="border-bottom:1px solid var(--border);${bg}">
            <td style="padding:8px 6px;font-weight:600;">
              ${isRepeat ? '⚠️ ' : ''}${n}
              ${isRepeat ? '<span style="font-size:9px;font-weight:800;color:#92400E;margin-left:6px;background:#FCD34D;padding:2px 6px;border-radius:999px;">REPETIDO</span>' : ''}
            </td>
            <td style="text-align:center;font-size:16px;font-weight:800;color:var(--rose);">${v.qty}</td>
            <td style="text-align:center;color:var(--muted);">${v.pedidos.size}</td>
            <td style="font-size:11px;color:var(--muted);">
              ${v.itens.slice(0,6).map(it=>`#${it.orderNumber||'—'}×${it.qty}${it.obs?' <em title="'+it.obs.replace(/"/g,'&quot;')+'">📝</em>':''}`).join(' · ')}
              ${v.itens.length>6 ? ` <span>+${v.itens.length-6}</span>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`}
  </div>

  <div class="card">
    <div class="card-title">📦 Lotes Sugeridos de Produção <span class="notif">${lotesList.length}</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Pedidos agrupados por data + turno · Sugestão de ordem de execução</span>
    </div>
    ${lotesList.length===0 ? `<div class="empty"><p>Sem lotes.</p></div>` : `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${lotesList.map((l, idx) => {
        const tColor = l.turno==='manha' ? 'var(--gold)' : l.turno==='tarde' ? 'var(--rose)' : l.turno==='noite' ? 'var(--purple,#7C3AED)' : 'var(--muted)';
        return `
        <div style="border:1px solid var(--border);border-left:4px solid ${tColor};border-radius:10px;padding:12px 14px;background:var(--cream);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div>
              <span style="font-size:13px;font-weight:800;">LOTE ${idx+1}</span>
              <span style="font-size:12px;margin-left:8px;">${formatDia(l.date)} · ${turnoLabel[l.turno]||'—'}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);">
              <strong style="color:var(--ink);font-size:13px;">${l.pedidos.length}</strong> pedidos ·
              <strong style="color:var(--rose);font-size:13px;">${l.itens}</strong> itens
            </div>
          </div>
          <div style="font-size:11px;color:var(--muted);">
            ${l.pedidos.slice(0,12).map(o=>`<span style="background:#fff;padding:2px 6px;border-radius:6px;margin-right:3px;display:inline-block;margin-bottom:2px;">${fmtOrderNum(o)} ${o.scheduledTime||''}</span>`).join('')}
            ${l.pedidos.length>12 ? `<span>+${l.pedidos.length-12}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`}
  </div>
  `;
})()}
` : ''}

${fSecao==='entregas' ? `
<!-- ── SECAO: ENTREGAS ── -->
${(()=>{
  // Ordena por data → turno → horario
  const entregas = [...altos].filter(o => !['Cancelado'].includes(o.status)).sort((a,b)=>{
    const d = (a.scheduledDate||'').localeCompare(b.scheduledDate||'');
    if(d!==0) return d;
    const tA = ['manha','tarde','noite','—'].indexOf(getTurno(a.scheduledTime));
    const tB = ['manha','tarde','noite','—'].indexOf(getTurno(b.scheduledTime));
    if(tA!==tB) return tA-tB;
    return (a.scheduledTime||'99:99').localeCompare(b.scheduledTime||'99:99');
  });

  // Agrupa por data + turno
  const groups = {};
  entregas.forEach(o => {
    const key = (o.scheduledDate||'—')+'__'+getTurno(o.scheduledTime);
    if(!groups[key]) groups[key] = { date:o.scheduledDate, turno:getTurno(o.scheduledTime), pedidos:[] };
    groups[key].pedidos.push(o);
  });

  return Object.values(groups).map(g => `
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">
        📅 ${formatDia(g.date)} · ${turnoLabel[g.turno]||'—'}
        <span class="notif">${g.pedidos.length}</span>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;font-size:12px;">
          <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
            <th style="padding:6px;">Horário</th>
            <th>#</th>
            <th>Cliente / Destinatário</th>
            <th>Endereço</th>
            <th>Bairro</th>
            <th>Produto</th>
            <th>Obs</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            ${g.pedidos.map(o => {
              const prod = (o.items||[]).map(i=>`${i.name} ×${i.qty||1}`).join(' · ') || '—';
              const obs  = o.obsPedido || o.obs || o.observacao || '';
              const endereco = [o.deliveryStreet, o.deliveryNumber].filter(Boolean).join(', ')
                || o.deliveryAddress || o.address || '—';
              return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:6px;font-weight:800;color:var(--rose);white-space:nowrap;">${o.scheduledTime||'—'}${o.scheduledTimeEnd?'–'+o.scheduledTimeEnd:''}</td>
                <td style="font-weight:700;">${fmtOrderNum(o)}</td>
                <td>
                  <div style="font-weight:600;">${o.client?.name || o.clientName || '—'}</div>
                  ${o.recipient ? `<div style="font-size:10px;color:var(--muted);">→ ${o.recipient}</div>`:''}
                </td>
                <td style="font-size:11px;max-width:200px;">${endereco}</td>
                <td style="font-size:11px;">${o.deliveryNeighborhood||'—'}</td>
                <td style="font-size:11px;max-width:240px;">${prod}</td>
                <td style="font-size:11px;max-width:180px;color:#92400E;${obs?'background:#FFFBEB;padding:4px 6px;border-radius:6px;':''}">${obs||'—'}</td>
                <td><span class="tag ${sc(o.status)}" style="font-size:9px;">${o.status}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('') || `<div class="empty card"><div class="empty-icon">🚚</div><p>Sem entregas no período.</p></div>`;
})()}
` : ''}

${fSecao==='priorizacao' ? `
<!-- ── SECAO: PRIORIZACAO ── -->
${(()=>{
  // Classifica por prioridade
  const manausNow = new Date(Date.now() - 4*3600000);
  const hojeStr = manausNow.toISOString().slice(0,10);

  const proximoHorario = (o) => {
    if((o.scheduledDate||'').slice(0,10) !== hojeStr) return Infinity;
    if(!o.scheduledTime || o.scheduledTime==='00:00') return Infinity;
    const [h,m]=o.scheduledTime.split(':').map(Number);
    const curMins = manausNow.getUTCHours()*60 + manausNow.getUTCMinutes();
    return (h*60+m) - curMins;
  };

  const classificados = altos.filter(o=>!['Cancelado','Entregue'].includes(o.status)).map(o => ({
    order: o,
    prio:  getPrioLevel(o),
    proxMin: proximoHorario(o),
  }));

  // Ordem sugerida: primeiro os que vao "estourar" (proxMin <= 180), depois por prioridade
  classificados.sort((a,b) => {
    const ca = a.proxMin <= 180 ? 0 : 1;
    const cb = b.proxMin <= 180 ? 0 : 1;
    if(ca !== cb) return ca - cb;
    // Antecipado > Urgente > Ultima > Normal
    const order = { antecipado:0, urgente:1, ultima:2, normal:3 };
    const d = (order[a.prio.key]??99) - (order[b.prio.key]??99);
    if(d!==0) return d;
    return a.proxMin - b.proxMin;
  });

  const antecipados = classificados.filter(c=>c.prio.key==='antecipado');
  const urgentes    = classificados.filter(c=>c.prio.key==='urgente');
  const ultimas     = classificados.filter(c=>c.prio.key==='ultima');
  const risco       = classificados.filter(c=>c.proxMin>=0 && c.proxMin<=180);

  const renderRow = (c) => {
    const o = c.order;
    const prod = (o.items||[]).map(i=>`${i.name} ×${i.qty||1}`).join(' · ') || '—';
    const isRisk = c.proxMin>=0 && c.proxMin<=180;
    const bg = isRisk ? 'background:#FEF2F2;border-left:4px solid #DC2626;' :
               c.prio.key==='antecipado' ? 'background:#FFFBEB;border-left:4px solid #F59E0B;' :
               c.prio.key==='ultima' ? 'background:#FEE2E2;border-left:3px solid #EF4444;' : '';
    return `<tr style="border-bottom:1px solid var(--border);${bg}">
      <td style="padding:8px 6px;font-weight:800;color:var(--rose);">${fmtOrderNum(o)}</td>
      <td>
        <span style="font-weight:700;">${c.prio.label}</span>
        ${c.prio.days ? `<span style="font-size:10px;color:var(--muted);margin-left:4px;">(${c.prio.days}d antes)</span>`:''}
      </td>
      <td style="font-size:11px;">${o.client?.name || o.clientName || '—'}</td>
      <td style="font-size:11px;">${o.deliveryNeighborhood||'—'}</td>
      <td style="font-size:11px;font-weight:700;">${formatDia(o.scheduledDate)} ${o.scheduledTime||''}</td>
      <td style="${isRisk?'color:#DC2626;font-weight:800;':'color:var(--muted);'}font-size:11px;">
        ${isRisk ? (c.proxMin<0 ? '🚨 ATRASADO' : `⚠️ ${c.proxMin}min`) : (c.proxMin===Infinity?'—':`${c.proxMin}min`)}
      </td>
      <td style="font-size:11px;max-width:220px;">${prod}</td>
    </tr>`;
  };

  return `
  <div class="g4" style="margin-bottom:14px;">
    <div class="mc gold"><div class="mc-label">📅 Antecipados</div><div class="mc-val">${antecipados.length}</div></div>
    <div class="mc rose"><div class="mc-label">🔥 Urgentes</div><div class="mc-val">${urgentes.length}</div></div>
    <div class="mc purple"><div class="mc-label">⚡ Última hora</div><div class="mc-val">${ultimas.length}</div></div>
    <div class="mc" style="background:linear-gradient(135deg,#DC2626,#F59E0B);color:#fff;"><div class="mc-label" style="color:rgba(255,255,255,.85);">🚨 Risco de atraso</div><div class="mc-val" style="color:#fff;">${risco.length}</div></div>
  </div>

  <div class="card">
    <div class="card-title">🎯 Ordem Sugerida de Produção/Entrega <span class="notif">${classificados.length}</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Pedidos em risco no topo · siga de cima para baixo</span>
    </div>
    ${classificados.length===0 ? `<div class="empty"><p>Sem pedidos pendentes.</p></div>` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;">
        <thead><tr style="text-align:left;border-bottom:2px solid var(--border);">
          <th style="padding:6px;">#</th><th>Prioridade</th><th>Cliente</th>
          <th>Bairro</th><th>Entrega</th><th>Tempo</th><th>Produto</th>
        </tr></thead>
        <tbody>${classificados.map(renderRow).join('')}</tbody>
      </table>
    </div>`}
  </div>
  `;
})()}
` : ''}

${fSecao==='rota' ? `
<!-- ── SECAO: ROTEIRIZACAO ── -->
${(()=>{
  const emRota = altos.filter(o => !['Cancelado','Entregue'].includes(o.status));
  const porZona = {};
  emRota.forEach(o => {
    const z = getZona(o.deliveryNeighborhood);
    if(!porZona[z]) porZona[z] = {};
    const b = o.deliveryNeighborhood || '—';
    if(!porZona[z][b]) porZona[z][b] = [];
    porZona[z][b].push(o);
  });

  const zonaOrder = ['Centro-Sul','Leste','Norte','Oeste','Outros','Sem bairro'];
  const zonaColors = {'Centro-Sul':'#EC4899','Leste':'#F59E0B','Norte':'#10B981','Oeste':'#3B82F6','Outros':'#8B5CF6','Sem bairro':'#94A3B8'};

  const zonas = zonaOrder.filter(z=>porZona[z]);

  return `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">🗺️ Roteirização Sugerida <span class="notif">${emRota.length} entregas</span>
      <span style="font-size:11px;font-weight:400;color:var(--muted);margin-left:6px;">Agrupadas por zona · Sequência sugerida: Centro → Leste → Norte → Oeste</span>
    </div>
    <p style="font-size:11px;color:var(--muted);margin:6px 0 0;">
      💡 <strong>Dica:</strong> Organize um entregador por zona. Dentro de cada zona, ordene por horário mais cedo primeiro.
    </p>
  </div>

  ${zonas.map((z, idx) => {
    const bairrosZona = Object.entries(porZona[z]).sort((a,b)=>b[1].length - a[1].length);
    const totalPedZona = Object.values(porZona[z]).reduce((s,arr)=>s+arr.length,0);
    return `
    <div class="card" style="margin-bottom:14px;border-left:5px solid ${zonaColors[z]};">
      <div class="card-title" style="color:${zonaColors[z]};">
        Zona ${idx+1}: ${z}
        <span class="notif" style="background:${zonaColors[z]};color:#fff;">${totalPedZona} pedidos</span>
      </div>
      ${bairrosZona.map(([bairro, pedidos]) => {
        // Ordena pedidos do bairro por horario
        pedidos.sort((a,b) => (a.scheduledTime||'99').localeCompare(b.scheduledTime||'99'));
        return `
        <div style="margin-bottom:10px;background:var(--cream);padding:10px 12px;border-radius:10px;">
          <div style="font-weight:700;margin-bottom:6px;font-size:12px;">📍 ${bairro} <span style="color:var(--muted);font-weight:400;">(${pedidos.length})</span></div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;">
            ${pedidos.map((o,i) => `
              <div style="display:flex;gap:8px;align-items:center;padding:4px 8px;background:#fff;border-radius:6px;">
                <span style="background:${zonaColors[z]};color:#fff;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;font-weight:800;font-size:10px;">${i+1}</span>
                <span style="font-weight:700;">${o.scheduledTime||'—'}</span>
                <span style="color:var(--rose);font-weight:700;">${fmtOrderNum(o)}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${o.recipient || o.client?.name || o.clientName || '—'}
                  ${o.deliveryStreet ? `· <span style="color:var(--muted);">${o.deliveryStreet}${o.deliveryNumber?', '+o.deliveryNumber:''}</span>` : ''}
                </span>
              </div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('') || `<div class="empty card"><div class="empty-icon">🗺️</div><p>Sem entregas para rotear.</p></div>`}
  `;
})()}
` : ''}

${fSecao==='alertas' ? `
<!-- ── SECAO: ALERTAS ── -->
${(()=>{
  const manausNow = new Date(Date.now() - 4*3600000);
  const hojeStr = manausNow.toISOString().slice(0,10);
  const pendentesList = altos.filter(o=>!['Cancelado','Entregue'].includes(o.status));

  // 1) Pedidos antigos (7+ dias) ainda pendentes
  const antigos = pendentesList.filter(o => {
    const age = (Date.now() - new Date(o.createdAt).getTime()) / 86400000;
    return age >= 7 && (o.scheduledDate||'').slice(0,10) >= hojeStr;
  }).sort((a,b)=>new Date(a.createdAt) - new Date(b.createdAt));

  // 2) Picos de horario (mais de N pedidos no mesmo horario)
  const porHora = {};
  pendentesList.forEach(o => {
    if((o.scheduledDate||'').slice(0,10) !== hojeStr) return;
    const h = (o.scheduledTime||'').slice(0,2);
    if(!h || h==='00') return;
    porHora[h] = (porHora[h]||0) + 1;
  });
  const picos = Object.entries(porHora).filter(([,v]) => v >= 5).sort((a,b)=>b[1]-a[1]);

  // 3) Gargalos: status estagnados
  const emPreparo   = pendentesList.filter(o => o.status === 'Em preparo');
  const muitoPronto = pendentesList.filter(o => {
    if(o.status !== 'Pronto') return false;
    const age = (Date.now() - new Date(o.updatedAt||o.createdAt).getTime()) / 60000;
    return age > 90;
  });
  const semEntregador = pendentesList.filter(o =>
    o.status === 'Pronto' && !o.driverName && !o.driver
  );

  // 4) Pedidos do dia sem horario
  const semHora = pendentesList.filter(o =>
    (o.scheduledDate||'').slice(0,10) === hojeStr && (!o.scheduledTime || o.scheduledTime === '00:00')
  );

  // 5) Gargalos de bairro: bairro com muitos pedidos pro mesmo turno
  const porBairroTurno = {};
  pendentesList.forEach(o => {
    if((o.scheduledDate||'').slice(0,10) !== hojeStr) return;
    const k = (o.deliveryNeighborhood||'—')+'/'+getTurno(o.scheduledTime);
    porBairroTurno[k] = (porBairroTurno[k]||0) + 1;
  });
  const gargalosBairro = Object.entries(porBairroTurno).filter(([,v])=>v>=4).sort((a,b)=>b[1]-a[1]);

  return `
  <div class="g3" style="margin-bottom:14px;">
    <div class="mc" style="background:#FEF2F2;border-left:5px solid #DC2626;">
      <div class="mc-label" style="color:#7F1D1D;">📅 Pedidos antigos</div>
      <div class="mc-val" style="color:#7F1D1D;">${antigos.length}</div>
      <div class="mc-sub" style="color:#991B1B;">Feitos há 7+ dias</div>
    </div>
    <div class="mc" style="background:#FFFBEB;border-left:5px solid #F59E0B;">
      <div class="mc-label" style="color:#78350F;">⚡ Picos de horário</div>
      <div class="mc-val" style="color:#78350F;">${picos.length}</div>
      <div class="mc-sub" style="color:#92400E;">5+ pedidos na mesma hora</div>
    </div>
    <div class="mc" style="background:#FDF2F8;border-left:5px solid #EC4899;">
      <div class="mc-label" style="color:#831843;">🧱 Gargalos</div>
      <div class="mc-val" style="color:#831843;">${muitoPronto.length + semEntregador.length + gargalosBairro.length}</div>
      <div class="mc-sub" style="color:#9D174D;">Operacionais identificados</div>
    </div>
  </div>

  <!-- Pedidos antigos -->
  <div class="card" style="margin-bottom:14px;${antigos.length===0?'opacity:.6;':''}">
    <div class="card-title">📅 Pedidos Antigos (risco de esquecer)
      <span class="notif">${antigos.length}</span>
    </div>
    ${antigos.length===0 ? `<div class="empty"><p>✅ Nenhum pedido antigo pendente.</p></div>` : `
    <table style="width:100%;font-size:12px;">
      <thead><tr style="text-align:left;border-bottom:1px solid var(--border);">
        <th style="padding:6px;">#</th><th>Criado há</th><th>Cliente</th>
        <th>Entrega</th><th>Status</th>
      </tr></thead>
      <tbody>
        ${antigos.map(o => {
          const days = Math.floor((Date.now()-new Date(o.createdAt).getTime())/86400000);
          return `<tr style="border-bottom:1px solid var(--border);background:#FEF2F2;">
            <td style="padding:8px 6px;font-weight:800;color:var(--rose);">${fmtOrderNum(o)}</td>
            <td style="font-weight:700;color:#DC2626;">${days} dias</td>
            <td>${o.client?.name||o.clientName||'—'}</td>
            <td>${formatDia(o.scheduledDate)} ${o.scheduledTime||''}</td>
            <td><span class="tag ${sc(o.status)}" style="font-size:10px;">${o.status}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`}
  </div>

  <div class="g2">
    <!-- Picos -->
    <div class="card">
      <div class="card-title">⚡ Picos de Horário (hoje)
        <span class="notif">${picos.length}</span>
      </div>
      ${picos.length===0 ? `<div class="empty"><p>Distribuição tranquila.</p></div>` : `
      <div>
        ${picos.map(([h, v]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#FFFBEB;border-radius:8px;margin-bottom:6px;border:1px solid #FCD34D;">
            <div style="font-weight:800;font-size:16px;color:#78350F;">${h}:00 – ${h}:59</div>
            <div style="font-size:13px;color:#92400E;"><strong style="font-size:20px;">${v}</strong> pedidos</div>
          </div>`).join('')}
        <div style="margin-top:8px;padding:10px;background:var(--cream);border-radius:8px;font-size:11px;color:var(--muted);">
          💡 <strong>Dica:</strong> Escalone produção iniciando 1h30 antes desses horários. Considere pedir ao cliente para flexibilizar o horário em pedidos ainda não produzidos.
        </div>
      </div>`}
    </div>

    <!-- Gargalos -->
    <div class="card">
      <div class="card-title">🧱 Gargalos Operacionais</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${muitoPronto.length > 0 ? `
          <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#7F1D1D;">🚨 ${muitoPronto.length} pedidos "Prontos" há mais de 90 min sem sair</div>
            <div style="font-size:11px;color:#991B1B;margin-top:2px;">
              ${muitoPronto.slice(0,6).map(o=>`${fmtOrderNum(o)}`).join(' · ')}${muitoPronto.length>6?` +${muitoPronto.length-6}`:''}
            </div>
          </div>` : ''}
        ${semEntregador.length > 0 ? `
          <div style="background:#FFFBEB;border-left:4px solid #F59E0B;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#78350F;">🚚 ${semEntregador.length} prontos sem entregador atribuído</div>
            <div style="font-size:11px;color:#92400E;margin-top:2px;">
              ${semEntregador.slice(0,6).map(o=>`${fmtOrderNum(o)}`).join(' · ')}${semEntregador.length>6?` +${semEntregador.length-6}`:''}
            </div>
          </div>` : ''}
        ${semHora.length > 0 ? `
          <div style="background:#F3F4F6;border-left:4px solid #6B7280;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#1F2937;">⏱️ ${semHora.length} pedidos de hoje sem horário definido</div>
            <div style="font-size:11px;color:#374151;margin-top:2px;">
              ${semHora.slice(0,6).map(o=>`${fmtOrderNum(o)}`).join(' · ')}${semHora.length>6?` +${semHora.length-6}`:''}
            </div>
          </div>` : ''}
        ${gargalosBairro.length > 0 ? `
          <div style="background:#FDF2F8;border-left:4px solid #EC4899;padding:10px 12px;border-radius:8px;">
            <div style="font-weight:700;font-size:12px;color:#831843;">📍 Concentração de bairro/turno</div>
            <div style="font-size:11px;color:#9D174D;margin-top:4px;">
              ${gargalosBairro.slice(0,5).map(([k,v])=>{
                const [b,t] = k.split('/');
                return `<div>${b} <span style="color:var(--muted);">·</span> ${turnoLabel[t]||'—'} → <strong>${v} pedidos</strong></div>`;
              }).join('')}
            </div>
          </div>` : ''}
        ${muitoPronto.length + semEntregador.length + semHora.length + gargalosBairro.length === 0 ?
          `<div style="background:var(--leaf-l);border:1px solid var(--leaf);padding:14px;border-radius:8px;text-align:center;color:var(--leaf);font-weight:700;">
            ✅ Operação sem gargalos detectados
          </div>` : ''}
      </div>
    </div>
  </div>
  `;
})()}
` : ''}

`}
`;
}

// ── Exporta Alta Demanda para CSV ─────────────────────────────
export function exportAltaDemandaCSV(){
  const targetDate = S._relAltaDate || '';
  const data = S._lastAltaDemandaOrders || S.orders.filter(o => o.scheduledDate === targetDate);
  if (!data.length) { toast('Sem dados para exportar'); return; }
  const header = ['Numero','Cliente','Destinatario','Produto','Qtd','Bairro','Data Entrega','Horario','Total','Pagamento','Canal','Status','Criado em'];
  const rows = data.map(o => {
    const prod = (o.items||[]).map(i=>`${i.name} (${i.qty||1}x)`).join(' | ');
    const qty  = (o.items||[]).reduce((s,i)=>s+(Number(i.qty)||1),0);
    return [
      o.orderNumber||'',
      o.client?.name || o.clientName || '',
      o.recipient || '',
      prod,
      qty,
      o.deliveryNeighborhood || o.deliveryZone || '',
      (o.scheduledDate||'').slice(0,10),
      o.scheduledTime || '',
      Number(o.total||0).toFixed(2),
      o.payment || '',
      o.source || 'PDV',
      o.status || '',
      (o.createdAt||'').slice(0,19).replace('T',' '),
    ];
  });
  const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `alta-demanda-${targetDate||'custom'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('📤 CSV exportado');
}

// ── TAB OPERAÇÃO: Análise de Ponto/Horas/Pontualidade ─────────
function renderTabOperacao(period, periodLabel){
  // Permissão: só admin ou reportsOperacao
  const canSee = S.user?.cargo==='admin' || S.user?.role==='Administrador' ||
                 (S.user?.modulos && S.user.modulos.reportsOperacao===true);
  if(!canSee) return `<div class="card"><div class="empty">Sem permissão</div></div>`;

  const records = JSON.parse(localStorage.getItem('fv_ponto') || '[]');
  if(!records.length) return `<div class="card"><div class="empty"><p>Nenhum registro de ponto disponível</p></div></div>`;

  const now = new Date();
  const dt1Str = S._relDate1 || '';
  const dt2Str = S._relDate2 || '';
  const inPeriod = d => {
    if(!d) return false;
    const dt = new Date(d + (d.length===10 ? 'T12:00' : ''));
    if(period==='hoje') return dt.toDateString()===now.toDateString();
    if(period==='semana'){ const w=new Date(now); w.setDate(now.getDate()-7); return dt>=w; }
    if(period==='mes') return dt.getMonth()===now.getMonth() && dt.getFullYear()===now.getFullYear();
    if(period==='mes_ant'){
      const m = now.getMonth()===0?11:now.getMonth()-1;
      const y = now.getMonth()===0?now.getFullYear()-1:now.getFullYear();
      return dt.getMonth()===m && dt.getFullYear()===y;
    }
    if(period==='custom'){
      if (dt1Str && dt < new Date(dt1Str + 'T00:00:00')) return false;
      if (dt2Str && dt > new Date(dt2Str + 'T23:59:59.999')) return false;
      return true;
    }
    return true;
  };

  const filtered = records.filter(r => r.date && inPeriod(r.date));

  // Mescla registros duplicados do mesmo colab no mesmo dia
  const byUserDay = {};
  filtered.forEach(r => {
    const k = (r.userId || r.userName) + '|' + r.date;
    if(!byUserDay[k]) byUserDay[k] = [];
    byUserDay[k].push(r);
  });
  const mergedRecords = Object.values(byUserDay).map(group => {
    if(group.length === 1) return group[0];
    const sorted = [...group].sort((a,b) => new Date(a.updatedAt||a.createdAt||0) - new Date(b.updatedAt||b.createdAt||0));
    const merged = { ...sorted[0] };
    for(const r of sorted.slice(1)){
      ['chegada','saidaAlmoco','voltaAlmoco','saida'].forEach(k => { if(r[k]) merged[k] = r[k]; });
    }
    return merged;
  });

  // Importa helpers do ponto (carregado dinâmico via window.FV ou direto)
  const toMin = t => { if(!t) return 0; const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fmtHrs = (mins) => mins<=0 ? '0h00min' : `${Math.floor(mins/60)}h${String(mins%60).padStart(2,'0')}min`;
  const calcMin = r => {
    if(!r.chegada || !r.saida) return 0;
    const total = toMin(r.saida) - toMin(r.chegada);
    const almoco = (r.saidaAlmoco && r.voltaAlmoco) ? (toMin(r.voltaAlmoco)-toMin(r.saidaAlmoco)) : 0;
    const liq = total - almoco;
    return liq>0 ? liq : 0;
  };

  const schedules = JSON.parse(localStorage.getItem('fv_ponto_schedules')||'{}');

  // Agrega por colaborador
  const byUser = {};
  mergedRecords.forEach(r => {
    const k = r.userId || r.userName;
    if(!byUser[k]) byUser[k] = {
      userId: r.userId, name: r.userName||'—', role: r.userRole||'—',
      dias:0, diasCompletos:0, diasIncompletos:0, totalMin:0,
      atrasos:0, minAtrasoTotal:0, horasExtras:0,
      sched: schedules[r.userId] || null,
      registros: []
    };
    byUser[k].registros.push(r);
  });

  Object.values(byUser).forEach(u => {
    u.registros.forEach(r => {
      const m = calcMin(r);
      if(m>0){ u.totalMin += m; u.diasCompletos++; }
      else if(r.chegada){ u.diasIncompletos++; }
      u.dias++;
      // Atraso
      if(u.sched?.entrada && r.chegada){
        const esp = toMin(u.sched.entrada);
        const real = toMin(r.chegada);
        if(real > esp + 5){ u.atrasos++; u.minAtrasoTotal += (real-esp); }
      }
      // Horas extras (considera jornada de 8h = 480min)
      if(m > 480) u.horasExtras += (m - 480);
    });
  });

  const ranking = Object.values(byUser).sort((a,b) => b.totalMin - a.totalMin);
  const maxMin = ranking.length ? Math.max(...ranking.map(u => u.totalMin)) : 1;

  const totalColabs = ranking.length;
  const totalMinGeral = ranking.reduce((s,u) => s+u.totalMin, 0);
  const totalAtrasos  = ranking.reduce((s,u) => s+u.atrasos, 0);
  const totalDiasComp = ranking.reduce((s,u) => s+u.diasCompletos, 0);
  const totalExtras   = ranking.reduce((s,u) => s+u.horasExtras, 0);

  // Seleção de colab para drill-down
  const selColabId = S._relOpColab || '';
  const selColab = ranking.find(u => u.userId === selColabId);

  return `
<div class="g2" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Colaboradores</div><div class="mc-val">${totalColabs}</div></div>
  <div class="mc leaf"><div class="mc-label">Horas Totais</div><div class="mc-val">${fmtHrs(totalMinGeral)}</div></div>
  <div class="mc gold"><div class="mc-label">Atrasos</div><div class="mc-val">${totalAtrasos}</div></div>
  <div class="mc purple"><div class="mc-label">Horas Extras</div><div class="mc-val">${fmtHrs(totalExtras)}</div></div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div class="card-title">🏆 Ranking de Horas Trabalhadas — ${periodLabel}</div>
  ${ranking.length===0 ? '<div class="empty"><p>Sem dados no período</p></div>' :
    ranking.map(u => {
      const pct = Math.round((u.totalMin/maxMin)*100);
      const pontualidade = u.dias>0 ? Math.round(((u.dias-u.atrasos)/u.dias)*100) : 100;
      const pontColor = pontualidade>=90 ? 'var(--leaf)' : pontualidade>=75 ? '#D97706' : 'var(--red)';
      return `
      <div style="margin-bottom:12px;padding:10px;background:var(--cream);border-radius:8px;cursor:pointer;border:1.5px solid ${selColabId===u.userId?'var(--rose)':'transparent'};transition:all .15s;"
        onclick="S._relOpColab='${u.userId===selColabId?'':u.userId}';window.render&&window.render();">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;font-size:13px;">${u.name}</span>
            <span style="font-size:10px;color:var(--muted);">${u.role}</span>
          </div>
          <div style="display:flex;gap:10px;font-size:11px;flex-wrap:wrap;">
            <span style="color:var(--muted)">📅 ${u.diasCompletos}d</span>
            <span style="color:${pontColor};font-weight:700">🎯 ${pontualidade}%</span>
            ${u.atrasos>0?`<span style="color:#D97706">⏰ ${u.atrasos}</span>`:''}
            ${u.horasExtras>0?`<span style="color:var(--leaf)">⚡ +${fmtHrs(u.horasExtras)}</span>`:''}
            <span style="font-weight:800;color:var(--ink)">${fmtHrs(u.totalMin)}</span>
          </div>
        </div>
        <div style="height:6px;background:#fff;border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--rose),var(--rose-d));"></div>
        </div>
      </div>`;
    }).join('')
  }
  <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px;">Clique em um colaborador para ver detalhes</div>
</div>

${selColab ? `
<div class="card" style="margin-bottom:14px;border:2px solid var(--rose);">
  <div class="card-title">👤 Detalhes — ${selColab.name}
    <button style="margin-left:auto;background:transparent;border:1px solid var(--border);padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;" onclick="S._relOpColab='';window.render&&window.render();">✕ Fechar</button>
  </div>
  <div class="g2" style="margin-bottom:14px;">
    <div class="mc leaf"><div class="mc-label">Horas Trabalhadas</div><div class="mc-val">${fmtHrs(selColab.totalMin)}</div></div>
    <div class="mc gold"><div class="mc-label">Horas Extras</div><div class="mc-val">${fmtHrs(selColab.horasExtras)}</div></div>
    <div class="mc rose"><div class="mc-label">Dias Completos</div><div class="mc-val">${selColab.diasCompletos}</div></div>
    <div class="mc purple"><div class="mc-label">Atrasos</div><div class="mc-val">${selColab.atrasos}</div></div>
  </div>
  ${selColab.minAtrasoTotal>0?`<div style="background:#FFF8E1;border:1px solid #FCD34D;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400E;margin-bottom:10px;">
    ⏰ Total acumulado de atraso: <strong>${fmtHrs(selColab.minAtrasoTotal)}</strong>
  </div>`:''}
  <div class="tw"><table>
    <thead><tr><th>Data</th><th>Entrada</th><th>S. Almoço</th><th>V. Almoço</th><th>Saída</th><th>Total</th></tr></thead>
    <tbody>
      ${selColab.registros.sort((a,b)=>b.date.localeCompare(a.date)).map(r => {
        const m = calcMin(r);
        return `<tr>
          <td>${new Date(r.date+'T12:00').toLocaleDateString('pt-BR')}</td>
          <td>${r.chegada||'—'}</td>
          <td>${r.saidaAlmoco||'—'}</td>
          <td>${r.voltaAlmoco||'—'}</td>
          <td>${r.saida||'—'}</td>
          <td style="font-weight:700">${m>0?fmtHrs(m):'—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>
</div>`:''}

${totalAtrasos>0?`
<div style="background:#FFF8E1;border:1px solid #FCD34D;border-radius:10px;padding:12px 16px;font-size:13px;color:#92400E;">
  ⚠️ <strong>Alerta de pontualidade:</strong> ${totalAtrasos} atraso(s) detectado(s) no período. Considere conversar com quem teve mais ocorrências.
</div>`:''}
`;
}
