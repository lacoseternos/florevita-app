// ── 🌸 PAINEL FLOWER FRIDAY — tempo real (Marcia 27/nov) ─────────────────
// Pedidos e faturamento, canais, ticket médio, brindes dados, produtos e
// adicionais vendidos, pessoas no site AGORA (e em que página), funil do
// site, vendas por hora e últimos pedidos com os horários de cada etapa.
// Atualiza sozinho a cada 15 s enquanto a tela está aberta.
import { S } from '../state.js';
import { GET } from '../services/api.js';
import { esc } from '../utils/formatters.js';

let _d = null, _erro = '', _carregando = false, _timer = null;
const brl = (n) => 'R$ ' + (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hm = (v) => v ? new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }) : '—';
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});

async function carregar() {
  if (_carregando) return;
  _carregando = true;
  try { _d = await GET('/flower-friday/painel'); _erro = ''; }
  catch (e) { _erro = e?.message || 'Não deu pra carregar'; }
  finally { _carregando = false; if (S.page === 'painelFF') _rerender(); }
}
function ligarTimer() {
  if (_timer) return;
  _timer = setInterval(() => {
    if (S.page !== 'painelFF') { clearInterval(_timer); _timer = null; return; }
    if (!document.hidden) carregar();
  }, 15000);
}

const card = (titulo, valor, sub = '', cor = '#9D174D') => `<div style="background:#fff;border:1px solid #FBCFE8;border-radius:14px;padding:12px 14px;">
  <div style="font-size:11px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:.5px;">${titulo}</div>
  <div style="font-size:24px;font-weight:900;color:${cor};margin-top:2px;">${valor}</div>
  ${sub ? `<div style="font-size:11.5px;color:#64748B;margin-top:2px;">${sub}</div>` : ''}</div>`;
const bloco = (titulo, corpo) => `<div class="card" style="padding:14px;"><div style="font-weight:900;font-size:14px;color:#1E293B;margin-bottom:10px;">${titulo}</div>${corpo}</div>`;
const barra = (v, max, cor = '#EC4899') => `<div style="height:8px;background:#F1F5F9;border-radius:999px;overflow:hidden;margin-top:3px;"><div style="height:100%;width:${max ? Math.max(3, v * 100 / max) : 0}%;background:${cor};border-radius:999px;"></div></div>`;

export function renderPainelFF() {
  if (!_d && !_erro) carregar();
  ligarTimer();
  if (!_d) return `<div class="empty card"><div class="empty-icon">🌸</div><p>${_erro ? '❌ ' + esc(_erro) : 'Carregando o painel da Flower Friday…'}</p></div>`;
  const d = _d, r = d.resumo, s = d.site;
  const maxCanal = Math.max(1, ...d.canais.map(c => c.valor));
  const maxHora = Math.max(1, ...d.porHora.map(h => h.valor));
  const maxPag = Math.max(1, ...s.paginas.map(p => p.n));
  const fim = new Date(d.fim);
  const restam = Math.max(0, fim - Date.now());
  const rh = Math.floor(restam / 3600e3), rm = Math.floor((restam % 3600e3) / 60000);

  return `
  <div style="background:linear-gradient(135deg,#140b0e,#3b0d22);color:#fff;border-radius:18px;padding:16px 18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;">🌸 Painel Flower Friday</div>
      <div style="font-size:12px;opacity:.8;">Desde 26/11 20h · atualiza sozinho a cada 15 s · última às ${hm(d.atualizadoEm)}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;opacity:.8;">${d.noAr ? 'Termina às 17h30 — faltam' : 'Flower Friday encerrada'}</div>
      ${d.noAr ? `<div style="font-size:26px;font-weight:900;color:#F9A8C9;">${rh}h ${String(rm).padStart(2, '0')}min</div>` : ''}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px;">
    ${card('Faturamento (pago)', brl(r.faturamento), r.pedidos + ' pedidos · todos os canais', '#15803D')}
    ${card('Ticket médio', brl(r.ticket), 'todos os canais')}
    ${card('Pedidos Flower Friday', r.ffPedidos, brl(r.ffFaturamento) + ' · ticket ' + brl(r.ffTicket))}
    ${card('Brindes dados', d.brindes.pedidos, d.brindes.polaroids + ' polaroids · ' + d.brindes.baloes + ' balões')}
    ${card('No site agora', s.online, Object.entries(s.dispositivos).map(([k, v]) => (k === 'mobile' ? '📱 ' : '💻 ') + v).join(' · '), '#2563EB')}
    ${card('Aguardando pagamento (site)', r.aguardando, brl(r.aguardandoValor), '#B45309')}
  </div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;margin-bottom:12px;">
    ${bloco('👀 Pessoas no site agora — em que página', s.paginas.length ? s.paginas.map(p => `<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;"><span>${esc(p.pagina)}</span><b>${p.n}</b></div>${barra(p.n, maxPag, '#3B82F6')}</div>`).join('') : '<div style="color:#94A3B8;font-size:12.5px;">Ninguém navegando agora.</div>')}
    ${bloco('📊 Funil do site (desde a abertura)', [
      ['Visitantes', s.visitantes], ['Viram um produto', s.viuProduto], ['Chegaram ao checkout', s.checkout], ['Pedidos criados', s.pedidosCriados], ['Pedidos pagos', s.pedidosPagos],
    ].map(([l, v]) => `<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;"><span>${l}</span><b>${v}</b></div>${barra(v, s.visitantes || 1, '#EC4899')}</div>`).join('') + `<div style="font-size:12px;color:#64748B;margin-top:4px;">Conversão: <b>${s.conversao}%</b> dos visitantes compraram</div>`)}
    ${bloco('🛍️ Canais de venda', d.canais.length ? d.canais.map(c => `<div style="margin-bottom:7px;"><div style="display:flex;justify-content:space-between;font-size:12.5px;"><span>${esc(c.canal)} · ${c.pedidos} ped.</span><b>${brl(c.valor)}</b></div>${barra(c.valor, maxCanal, '#10B981')}</div>`).join('') : '<div style="color:#94A3B8;font-size:12.5px;">Sem vendas ainda.</div>')}
    ${bloco('⏰ Vendas por hora', d.porHora.length ? d.porHora.map(h => `<div style="display:grid;grid-template-columns:42px 1fr 110px;gap:8px;align-items:center;margin-bottom:5px;font-size:12px;"><b>${String(h.hora).padStart(2, '0')}h</b>${barra(h.valor, maxHora, '#F59E0B')}<span style="text-align:right;">${h.pedidos} · ${brl(h.valor)}</span></div>`).join('') : '<div style="color:#94A3B8;font-size:12.5px;">Sem vendas ainda.</div>')}
    ${bloco('🌹 Produtos da Flower Friday vendidos', d.produtos.length ? `<table style="width:100%;font-size:12.5px;"><tbody>${d.produtos.map(p => `<tr><td>${esc(p.nome)}</td><td style="text-align:center;font-weight:800;">${p.qtd}</td><td style="text-align:right;">${brl(p.valor)}</td></tr>`).join('')}</tbody></table>` : '<div style="color:#94A3B8;font-size:12.5px;">Nenhum ainda.</div>')}
    ${bloco('🍫 Adicionais mais vendidos', d.chocolates.length ? `<table style="width:100%;font-size:12.5px;"><tbody>${d.chocolates.map(p => `<tr><td>${esc(p.nome)}</td><td style="text-align:center;font-weight:800;">${p.qtd}</td><td style="text-align:right;">${brl(p.valor)}</td></tr>`).join('')}</tbody></table>` : '<div style="color:#94A3B8;font-size:12.5px;">Nenhum ainda.</div>')}
    ${bloco('🎁 Brindes', `<div style="font-size:13px;line-height:1.8;">Pedidos com brinde: <b>${d.brindes.pedidos}</b><br>Polaroids de brinde: <b>${d.brindes.polaroids}</b><br>Balões de brinde: <b>${d.brindes.baloes}</b>${Object.keys(d.brindes.frases).length ? '<br>Frases: ' + Object.entries(d.brindes.frases).map(([f, n]) => `“${esc(f)}” <b>${n}</b>`).join(' · ') : ''}</div>`)}
  </div>

  ${bloco('🧾 Últimos pedidos — lançamento, montagem, expedição e entrega', `<div style="overflow-x:auto;"><table style="width:100%;font-size:12.5px;">
    <thead><tr><th>Pedido</th><th>Cliente</th><th>Canal</th><th>Total</th><th>Lançado</th><th>Montagem</th><th>Expedido</th><th>Entregue</th><th>Status</th></tr></thead>
    <tbody>${d.ultimos.map(o => `<tr style="${o.ff ? 'background:#FDF2F8;' : ''}">
      <td style="font-weight:800;white-space:nowrap;">#${esc(String(o.numero))}${o.ff ? ' 🌸' : ''}</td>
      <td>${esc(o.cliente)}${o.brinde ? `<div style="font-size:10.5px;color:#9D174D;">🎁 ${esc(o.brinde)}</div>` : ''}</td>
      <td style="white-space:nowrap;">${esc(o.canal)}</td>
      <td style="white-space:nowrap;">${brl(o.total)}${o.pago ? '' : '<div style="font-size:10px;color:#B45309;font-weight:700;">aguardando pgto</div>'}</td>
      <td>${hm(o.lancado)}</td>
      <td>${o.montado ? hm(o.montado) : o.iniciado ? '<span style="color:#B45309;">montando desde ' + hm(o.iniciado) + '</span>' : '—'}</td>
      <td>${hm(o.expedido)}</td>
      <td>${hm(o.entregue)}</td>
      <td style="white-space:nowrap;">${esc(o.status)}</td></tr>`).join('')}</tbody></table></div>`)}
  `;
}
