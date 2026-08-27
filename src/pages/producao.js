import { S } from '../state.js';
import { $c, $d, sc, ini, esc, paymentStatusBadge, fmtOrderNum, productImgUrl } from '../utils/formatters.js';
import { PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';
import { emoji } from '../utils/formatters.js';
import { searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { filtrarPedidosParaProducao } from '../utils/unidadeRules.js';
import { calcColabStats, makeInPeriod } from '../utils/colabStats.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── INICIAR PRODUÇÃO: definir a florista que vai montar ───────
// Ao clicar "Iniciar Produção" abre um seletor: botão "Sou eu" (usuário
// logado) ou uma caixa de seleção pra escolher outra florista. A comissão
// de montagem é atribuída a quem for escolhido aqui. Marcia (05/ago/2026).
function abrirPickMontador(orderId){
  const o = S.orders.find(x => x._id === orderId);
  if(!o){ toast('Pedido não encontrado', true); return; }
  const eu = S.user || {};
  const euNome = eu.name || eu.nome || 'Eu';
  const colabs = (getColabs() || [])
    .filter(c => c && c.active !== false)
    // Entregadores NÃO montam — fora do seletor (Marcia 05/ago/2026).
    .filter(c => !String(c.cargo || '').toLowerCase().includes('entregador'))
    .filter(c => !/mp\.auto|webhook|painel tv|not@floricultura/i.test(`${c.email||''} ${c.name||c.nome||''}`))
    .sort((a,b) => String(a.name||a.nome||'').localeCompare(String(b.name||b.nome||'')));
  const opts = colabs.map(c => {
    const id = c._id || c.id || '';
    const nome = c.name || c.nome || '';
    return `<option value="${esc(String(id))}" data-nome="${esc(nome)}" data-email="${esc(c.email||'')}">${esc(nome)}${c.cargo?` · ${esc(c.cargo)}`:''}</option>`;
  }).join('');
  const num = fmtOrderNum ? fmtOrderNum(o) : (o.orderNumber || '');
  S._modal = `<div class="mo" id="mo" onclick="if(event.target.id==='mo')window._prodFecharModal()">
  <div class="mo-box" style="max-width:440px;" onclick="event.stopPropagation()">
    <div style="padding:18px;">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px;">🌸 Iniciar Produção — Pedido ${esc(String(num))}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">Quem vai montar este pedido? A comissão de montagem vai pra essa florista.</div>
      <button class="btn btn-primary" style="width:100%;padding:12px;font-size:15px;margin-bottom:14px;" onclick="window._prodIniciarEu('${orderId}')">✋ Sou eu (${esc(euNome)})</button>
      <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">…ou escolher outra florista:</div>
      <select class="fi" id="prod-mont-sel" style="width:100%;margin-bottom:14px;">
        <option value="">— Selecione a florista —</option>
        ${opts}
      </select>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" style="flex:1;" onclick="window._prodFecharModal()">Cancelar</button>
        <button class="btn btn-green" style="flex:2;" onclick="window._prodIniciarSel('${orderId}')">Iniciar com a florista</button>
      </div>
    </div>
  </div>
</div>`;
  render();
}

async function iniciarProducaoComMontador(orderId, mont){
  const o = S.orders.find(x => x._id === orderId);
  if(!o) return;
  if(!mont || !mont.montadorId){ toast('Escolha a florista que vai montar', true); return; }
  const statusAntigo = o.status;
  S._modal = '';
  // UI otimista: já muda status e grava a montadora
  S.orders = S.orders.map(x => x._id === orderId
    ? { ...x, status:'Em preparo', montadorId:mont.montadorId, montadorNome:mont.montadorNome, montadorEmail:mont.montadorEmail }
    : x);
  render();
  toast(`🌸 Produção iniciada — montagem: ${mont.montadorNome||'florista'}`);
  try{
    await PATCH('/orders/'+orderId+'/status', { status:'Em preparo', montadorId:mont.montadorId, montadorNome:mont.montadorNome, montadorEmail:mont.montadorEmail });
  }catch(e){
    console.error('[iniciarProducao] PATCH falhou, revertendo:', e);
    S.orders = S.orders.map(x => x._id === orderId ? { ...x, status:statusAntigo } : x);
    render();
    toast('❌ Servidor recusou — revertido para '+statusAntigo, true);
  }
}

if (typeof window !== 'undefined'){
  window._prodAbrirPick   = abrirPickMontador;
  window._prodFecharModal = () => { S._modal=''; render(); };
  window._prodIniciarEu   = (orderId) => {
    const eu = S.user || {};
    iniciarProducaoComMontador(orderId, {
      montadorId: String(eu._id || eu.id || ''),
      montadorNome: eu.name || eu.nome || '',
      montadorEmail: eu.email || '',
    });
  };
  window._prodIniciarSel = (orderId) => {
    const sel = document.getElementById('prod-mont-sel');
    if(!sel || !sel.value){ toast('Selecione a florista', true); return; }
    const opt = sel.options[sel.selectedIndex];
    iniciarProducaoComMontador(orderId, {
      montadorId: sel.value,
      montadorNome: (opt && opt.dataset.nome) || (opt && opt.textContent) || '',
      montadorEmail: (opt && opt.dataset.email) || '',
    });
  };
}

// ── Helpers locais (metas / atividades) — mesmos do dashboard ─
// Memoiza por sessao: parse de fv_activities pode ser caro com milhares
// de atividades. Invalida no storage event (outras abas) ou via _invalidate.
let _actsCache = null;
let _actsCacheTs = 0;
function getActivities(){
  const now = Date.now();
  if (_actsCache && (now - _actsCacheTs) < 3000) return _actsCache;
  try { _actsCache = JSON.parse(localStorage.getItem('fv_activities')||'[]'); }
  catch(_) { _actsCache = []; }
  _actsCacheTs = now;
  return _actsCache;
}
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === 'fv_activities') { _actsCache = null; }});
}

function getMetasPeriod(per){
  const now = new Date();
  const start = new Date();
  if(per==='dia'){
    start.setHours(0,0,0,0);
  } else if(per==='semana'){
    const day = now.getDay(); // 0=dom
    start.setDate(now.getDate() - day);
    start.setHours(0,0,0,0);
  } else { // mes
    start.setDate(1); start.setHours(0,0,0,0);
  }
  return start;
}

// FONTE ÚNICA (Marcia 05/ago/2026): delega pro calcColabStats — MESMA regra de
// RH/Relatórios/Meu Painel, que EXCLUI adicionais da montagem. Antes lia
// fv_activities (log local) e divergia (contava adicional/1-por-pedido).
function getColabStats(colab){
  if(!colab) return {vendas:0,comissao:0,montagens:0,expedicoes:0,fatVendas:0,entregas:0};
  const per = colab.metas?.statsPer || colab.metas?.montagemPer || 'mes';
  const s = calcColabStats(colab, makeInPeriod(per));
  return {
    vendas: s.vendas, fatVendas: s.fatVendas, montagens: s.montagens,
    expedicoes: s.expedicoes, entregas: s.entregas, comissao: s.comissaoTotal,
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

// ── Mostrar imagem em tela cheia ─────────────────────────────
function showFullImg(url){
  S._modal=`<div class="mo" id="mo" onclick="S._modal='';import('../main.js').then(m=>m.render())">
  <div style="background:#fff;border-radius:16px;padding:16px;max-width:500px;width:94%;text-align:center">
    <img src="${url}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;"/>
    <div style="margin-top:10px"><button class="btn btn-ghost" onclick="S._modal='';import('../main.js').then(m=>m.render())">Fechar</button></div>
  </div></div>`;
  render();
}

// Expor showFullImg globalmente para onclick inline no HTML
if(typeof window!=='undefined') window.showFullImg = showFullImg;

// ── PRODUÇÃO ─────────────────────────────────────────────────
export function renderProducao(){
  const today = new Date();
  today.setHours(0,0,0,0);
  const selectedDate = S._prodDate || today.toISOString().split('T')[0];
  const _todayStr = today.toISOString().split('T')[0];
  const _tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const isFuture = !!S._prodFuture; // Marcia (24/ago): filtro de datas futuras
  const isToday = !isFuture && selectedDate === _todayStr;
  const isTomorrow = !isFuture && selectedDate === _tomorrowStr;
  // "Futuras" = agendadas a partir de depois de amanhã (além de hoje e amanhã)
  const _depoisDeAmanha = today.getTime() + 2 * 86400000;

  // Painel de meta de montagem do colaborador logado
  const colabLogado = findColab(S.user?.email||S.user?._id||'');
  const mtMontagem = colabLogado?.metas?.montagemQtd||0;
  const statsMontagem = mtMontagem ? getColabStats(colabLogado) : null;
  const metaMontPanel = (mtMontagem && statsMontagem) ? `
<div style="background:linear-gradient(135deg,var(--petal),#fff);border:1px solid rgba(200,115,106,.2);border-radius:var(--rl);padding:12px 14px;margin-bottom:12px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
  <div style="font-size:28px">🌸</div>
  <div style="flex:1;min-width:160px;">
    <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Minha Meta de Montagem — ${colabLogado.metas.montagemPer||'dia'}</div>
    ${metaBar(statsMontagem.montagens, mtMontagem, '')}
    <div style="font-size:11px;color:var(--muted);margin-top:2px;">${statsMontagem.montagens} montados de ${mtMontagem} · ${Math.round(statsMontagem.montagens/mtMontagem*100)}%</div>
  </div>
  ${statsMontagem.montagens>=mtMontagem?`<span style="font-size:22px" title="Meta batida!">🏆</span>`:''}
</div>` : '';

  // Filter orders for selected date
  // Regra: vai para produção se pagamento aprovado/pago/pagar-na-entrega
  // Bloqueia: Cancelado, Negado, Extornado
  const BLOQUEADOS_PROD = ['Cancelado','Negado','Extornado'];
  // "Ag. Pagamento na Entrega" é liberado (cliente vai pagar ao receber)
  const LIBERADOS_PAG = ['Aprovado','Pago','Pago na Entrega','Ag. Pagamento na Entrega'];

  // Filtro STRICT por unidade: cada produção vê apenas pedidos que serão
  // produzidos/retirados na sua unidade. Delivery vai pra CDLE; retiradas
  // vão para a loja de destino; balcão fica na loja onde foi vendido.
  const ordersParaProducao = filtrarPedidosParaProducao(S.user, S.orders);

  const allQueue = ordersParaProducao.filter(o=>{
    if(!['Aguardando','Em preparo','Pronto'].includes(o.status)) return false;
    const payStatus = o.paymentStatus || 'Ag. Pagamento';
    const payMethod = o.payment || o.pagamento?.metodo || '';
    if(BLOQUEADOS_PROD.includes(payStatus)) return false;
    if(LIBERADOS_PAG.includes(payStatus)) return true;
    if(payMethod === 'Pagar na Entrega') return true;
    return false;
  });

  // Pedidos aguardando pagamento (em status de produção mas sem liberação)
  const aguardandoPgto = ordersParaProducao.filter(o=>{
    if(!['Aguardando','Em preparo','Pronto'].includes(o.status)) return false;
    const payStatus = o.paymentStatus || 'Ag. Pagamento';
    const payMethod = o.payment || o.pagamento?.metodo || '';
    if(LIBERADOS_PAG.includes(payStatus)) return false;
    if(BLOQUEADOS_PROD.includes(payStatus)) return false;
    if(payMethod === 'Pagar na Entrega') return false;
    return true;
  });

  const forDate = allQueue.filter(o=>{
    if(!o.scheduledDate) return !isFuture; // sem data = imediato (não é "futura")
    const d = new Date(o.scheduledDate);
    d.setHours(0,0,0,0);
    if(isFuture) return d.getTime() >= _depoisDeAmanha; // além de hoje e amanhã
    const sel = new Date(selectedDate);
    sel.setHours(0,0,0,0);
    return d.getTime()===sel.getTime();
  });
  // Nas futuras, ordena por data de entrega (mais próxima primeiro)
  if(isFuture) forDate.sort((a,b)=> new Date(a.scheduledDate) - new Date(b.scheduledDate));

  const aguardandoPgtoDate = aguardandoPgto.filter(o=>{
    if(!o.scheduledDate) return !isFuture;
    const d = new Date(o.scheduledDate);
    d.setHours(0,0,0,0);
    if(isFuture) return d.getTime() >= _depoisDeAmanha;
    const sel = new Date(selectedDate);
    sel.setHours(0,0,0,0);
    return d.getTime()===sel.getTime();
  });

  const byShift = {
    'Manhã': forDate.filter(o=>o.scheduledPeriod==='Manhã'||!o.scheduledPeriod),
    'Tarde': forDate.filter(o=>o.scheduledPeriod==='Tarde'),
    'Noite': forDate.filter(o=>o.scheduledPeriod==='Noite'),
    'Horário específico': forDate.filter(o=>o.scheduledPeriod==='Horário específico'),
  };

  const activeShift = S._prodShift||'Todos';
  const shiftFiltered0 = activeShift==='Todos' ? forDate : (byShift[activeShift]||[]);
  // Busca por numero, nome ou telefone
  const shiftFiltered = searchOrders(shiftFiltered0, S._orderSearch);

  // Conta status em UMA passada (era 3 .filter() separados na UI)
  let cEm=0, cPr=0, cAg=0;
  for (const o of forDate) {
    if (o.status === 'Em preparo') cEm++;
    else if (o.status === 'Pronto') cPr++;
    else if (o.status === 'Aguardando') cAg++;
  }

  // ── KANBAN por etapa (Marcia 27/ago/2026) ──────────────────────────
  // 3 colunas: A Montar / Em Produção / Prontos. Cada uma agrupada por
  // TURNO; a coluna "A Montar" ordenada por HORÁRIO. Observações do pedido
  // destacadas de forma chamativa dentro do card.
  const _horaMin = o => { const m=String(o.scheduledTime||'').match(/^(\d{1,2}):(\d{2})/); return m?(+m[1])*60+(+m[2]):9999; };
  // Turno do pedido. "Horário específico" (ou sem turno) cai no turno certo
  // PELO HORÁRIO (Manhã <12h · Tarde 12–18h · Noite ≥18h) — sem seção
  // separada. Marcia (27/ago/2026).
  const _turnoDe = o => {
    const p=o.scheduledPeriod;
    if(p==='Manhã'||p==='Tarde'||p==='Noite') return p;
    const min=_horaMin(o);
    if(min===9999 || min<12*60) return 'Manhã';
    if(min<18*60) return 'Tarde';
    return 'Noite';
  };
  const TURNOS_KB = [
    { key:'Manhã', icon:'☀️', range:'06:00 – 12:00' },
    { key:'Tarde', icon:'🌤️', range:'12:00 – 18:00' },
    { key:'Noite', icon:'🌙', range:'18:00 – 23:59' },
  ];
  function cardHtml(o){
    const isLate = o.scheduledPeriod==='Manhã' && new Date().getHours()>=12 && o.status!=='Pronto';
    const isUrgent = o.scheduledPeriod==='Tarde' && new Date().getHours()>=16 && o.status!=='Pronto';
    return `
  <div style="background:#fff;border-radius:var(--rl);border:1px solid ${isFuture?'var(--purple)':isLate?'var(--red)':isUrgent?'var(--gold)':'var(--border)'};padding:14px;box-shadow:var(--shadow);margin-bottom:10px;">
    ${isFuture&&o.scheduledDate?`<div class="tag t-purple" style="margin-bottom:8px;font-weight:800;">📅 Entrega: ${$d(o.scheduledDate)}${o.scheduledPeriod?' · '+o.scheduledPeriod:''}</div>`:''}
    ${isLate?`<div class="tag t-red" style="margin-bottom:8px">🔴 ATRASADO</div>`:isUrgent?`<div class="tag t-gold" style="margin-bottom:8px">⚡ URGENTE</div>`:''}
    ${o.payment==='Pagar na Entrega'?`<div class="tag t-gold" style="margin-bottom:6px;">💰 Cobrar na Entrega: ${$c(o.total)}</div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-weight:700;color:var(--rose);font-size:16px">${fmtOrderNum(o)}</span>
      <span class="tag ${sc(o.status)}">${o.status}</span>
    </div>
    <div style="display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap;">
      ${o.scheduledTime?`<span class="tag t-blue">🕐 ${o.scheduledTime}</span>`:''}
      ${o.type==='Delivery'?`<span class="tag t-purple">🚚 Delivery</span>`:`<span class="tag t-gray">🏪 ${o.type||'Balcão'}</span>`}
    </div>
    <div style="margin-bottom:8px;">
      ${(o.items||[]).map(item=>{
        const prod = S.products.find(p=>p._id===item.product||p.name===item.name);
        const img = productImgUrl(prod || item.product);
        const pid = prod?._id || prod?.id || '';
        return`<div style="display:flex;gap:10px;align-items:flex-start;padding:8px;background:var(--cream);border-radius:var(--r);margin-bottom:6px;">
          ${img
            ?`<img src="${img}" loading="lazy" decoding="async" style="width:88px;height:88px;border-radius:8px;object-fit:cover;background:#fff;border:1px solid var(--border);cursor:zoom-in;flex-shrink:0;" onclick="showFullImg('${img}')" title="Ampliar" onerror="this.replaceWith(Object.assign(document.createElement('div'),{style:this.style.cssText,innerHTML:'🌸'}))"/>`
            :`<div style="width:88px;height:88px;border-radius:8px;background:var(--rose-l);display:flex;align-items:center;justify-content:center;font-size:38px;flex-shrink:0;">${emoji(prod?.category||item.name)}</div>`}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${item.qty}x ${item.name}</div>
            ${prod?.productionNotes?`<div style="font-size:11px;color:#0369A1;background:#E0F2FE;padding:3px 7px;border-radius:4px;margin-top:4px;">🎨 <strong>Produção:</strong> ${esc(prod.productionNotes)}</div>`:''}
            ${item.notes?`<div style="font-size:11px;color:#92400E;background:#FEF3C7;padding:3px 7px;border-radius:4px;margin-top:4px;">📝 ${esc(item.notes)}</div>`:''}
            ${Array.isArray(item.userPhotos) && item.userPhotos.length ? `
            <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:6px;padding:6px;margin-top:6px;">
              <div style="font-size:10.5px;font-weight:800;color:#92400E;margin-bottom:5px;">📸 Fotos do cliente (${item.userPhotos.length}) · Polaroid</div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:5px;">
                ${item.userPhotos.map((p, idx) => `
                  <div style="position:relative;aspect-ratio:3/4;border-radius:5px;overflow:hidden;border:2px solid #D97706;background:#fff;">
                    <img src="${p}" loading="lazy" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in;" onclick="showFullImg('${p.replace(/'/g, "\\'")}')"/>
                    <a href="${p}" download="polaroid_${(o.orderNumber||o.numero||o._id||'pedido').toString().replace(/^PED-?/i,'')}_foto${idx+1}.jpg" style="position:absolute;bottom:0;left:0;right:0;background:rgba(217,119,6,.95);color:#fff;text-align:center;font-size:8.5px;font-weight:700;padding:1px 0;text-decoration:none;">⬇</a>
                  </div>
                `).join('')}
              </div>
            </div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
    ${o.recipient?`<div style="font-size:12px;margin-bottom:6px;">👤 <strong>Para:</strong> ${o.recipient}</div>`:''}
    ${o.cardMessage?`<div style="background:var(--petal);border-radius:var(--r);padding:8px 10px;font-size:12px;color:var(--ink2);margin-bottom:8px;font-style:italic;">"${o.cardMessage}"</div>`:''}
    ${o.notes || o.productionNotes ? `
    <div style="background:#FEF3C7;border:2px solid #F59E0B;border-left:6px solid #F59E0B;border-radius:8px;padding:10px 12px;margin-top:8px;margin-bottom:8px;box-shadow:0 1px 4px rgba(245,158,11,.25);">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">
        <span style="font-size:16px;">⚠️</span>
        <span style="font-size:12px;font-weight:800;color:#92400E;text-transform:uppercase;letter-spacing:.6px;">Observações</span>
      </div>
      <div style="font-size:13px;color:#78350F;line-height:1.4;white-space:pre-wrap;font-weight:600;">
        ${o.notes ? esc(o.notes) : ''}${o.notes && o.productionNotes ? '<br>' : ''}${o.productionNotes ? '<strong>Produção:</strong> ' + esc(o.productionNotes) : ''}
      </div>
    </div>` : ''}
    ${o.deliveryAddress?`<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">📍 ${o.deliveryAddress}</div>`:''}
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${o.status==='Aguardando'?`<button class="btn btn-primary btn-sm" data-prod-pick="${o._id}">▶ Iniciar Produção</button>`:''}
      ${o.status==='Em preparo'?`<button class="btn btn-green btn-sm" data-prod-done="${o._id}">✅ Pronto p/ Expedição</button>`:''}
      ${o.status==='Pronto'?`<div class="tag t-green" style="padding:6px 12px;">✅ Pronto para sair</div>`:''}
    </div>
  </div>`;
  }
  function colunaKB(titulo, cor, bg, pedidos, sortTime){
    const turnos = activeShift==='Todos' ? TURNOS_KB : TURNOS_KB.filter(t=>t.key===activeShift);
    const corpo = turnos.map(t=>{
      let arr = pedidos.filter(o=>_turnoDe(o)===t.key);
      if(sortTime) arr = arr.slice().sort((a,b)=>_horaMin(a)-_horaMin(b));
      return `
        <div style="margin-bottom:2px;">
          <div style="display:flex;align-items:center;gap:6px;padding:7px 4px;">
            <span>${t.icon}</span>
            <span style="font-weight:700;font-size:12px;color:#334155;">${t.key}</span>
            <span style="font-size:11px;color:#94A3B8;">${t.range}</span>
            <span style="margin-left:auto;background:${cor};color:#fff;border-radius:20px;padding:1px 8px;font-size:10px;font-weight:800;">${arr.length}</span>
          </div>
          ${arr.length ? arr.map(cardHtml).join('') : `<div style="border:1.5px dashed #E2E8F0;border-radius:10px;padding:14px;text-align:center;font-size:11.5px;color:#94A3B8;margin-bottom:8px;">Nenhum pedido neste turno</div>`}
        </div>`;
    }).join('');
    return `
      <div style="background:${bg};border-radius:14px;padding:12px;min-width:300px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding-bottom:8px;border-bottom:2px solid ${cor}44;">
          <span style="font-weight:800;font-size:14px;color:${cor};text-transform:uppercase;letter-spacing:.3px;">${titulo}</span>
          <span style="margin-left:auto;background:${cor};color:#fff;border-radius:20px;padding:2px 11px;font-size:12px;font-weight:800;">${pedidos.length}</span>
        </div>
        ${corpo}
      </div>`;
  }
  const _kbBase = searchOrders(forDate, S._orderSearch);
  const _kbMontar = _kbBase.filter(o=>o.status==='Aguardando');
  const _kbProducao = _kbBase.filter(o=>o.status==='Em preparo');
  const _kbProntos = _kbBase.filter(o=>o.status==='Pronto');

  return`
${metaMontPanel}
<div class="g4" style="margin-bottom:16px;">
  <div class="mc rose"><div class="mc-label">Para ${isFuture?'Futuras':isToday?'Hoje':isTomorrow?'Amanhã':'Esta Data'}</div><div class="mc-val">${forDate.length}</div></div>
  <div class="mc gold"><div class="mc-label">Em Produção</div><div class="mc-val">${cEm}</div></div>
  <div class="mc leaf"><div class="mc-label">Prontos</div><div class="mc-val">${cPr}</div></div>
  <div class="mc purple"><div class="mc-label">Aguardando</div><div class="mc-val">${cAg}</div></div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="btn btn-sm ${isToday?'btn-primary':'btn-ghost'}" id="btn-prod-today">Hoje</button>
      <button class="btn btn-sm ${isTomorrow?'btn-primary':'btn-ghost'}" id="btn-prod-tomorrow">Amanhã</button>
      <button class="btn btn-sm ${isFuture?'btn-primary':'btn-ghost'}" id="btn-prod-future">Futuras</button>
      <input type="date" class="fi" id="prod-date-picker" value="${selectedDate}" style="width:160px;"/>
    </div>
    <div style="display:flex;gap:4px;">
      ${['Todos','Manhã','Tarde','Noite'].map(s=>`
      <button class="btn btn-xs ${activeShift===s?'btn-primary':'btn-ghost'}" data-shift="${s}">
        ${s==='Manhã'?'☀️':s==='Tarde'?'🌤️':s==='Noite'?'🌙':'📋'} ${s}
        ${s!=='Todos'&&byShift[s]?.length?`(${byShift[s].length})`:''}
      </button>`).join('')}
    </div>
    ${renderOrderSearchBar('Buscar pedido, cliente ou telefone...')}
    <button class="btn btn-ghost btn-sm" id="btn-rel-orders">🔄</button>
  </div>
</div>

${_kbBase.length===0?`
<div class="empty card">
  <div class="empty-icon">🌿</div>
  <p>${S._orderSearch?'Nenhum resultado para "'+S._orderSearch+'"':'Nenhum pedido para '+(isFuture?'datas futuras':isToday?'hoje':isTomorrow?'amanhã':$d(selectedDate))+(activeShift!=='Todos'?' no turno '+activeShift:'')}</p>
</div>`:`
<div style="display:grid;grid-template-columns:repeat(3,minmax(300px,1fr));gap:14px;align-items:start;overflow-x:auto;padding-bottom:6px;">
  ${colunaKB('A Montar / Iniciar Produção','#E11D48','#FFF1F2',_kbMontar,true)}
  ${colunaKB('Em Produção','#D97706','#FFFBEB',_kbProducao,false)}
  ${colunaKB('Prontos','#059669','#F0FDF4',_kbProntos,false)}
</div>`}

${aguardandoPgtoDate.length>0 ? `
<div class="card" style="margin-top:16px;border-color:#FCD34D;background:#FFFBEB;">
  <div class="card-title" style="color:#92400E;">⏳ Aguardando Pagamento <span style="font-size:11px;color:#B45309;font-weight:600;">(${aguardandoPgtoDate.length} pedido${aguardandoPgtoDate.length===1?'':'s'} bloqueado${aguardandoPgtoDate.length===1?'':'s'} aguardando aprovação)</span></div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px;">
    ${aguardandoPgtoDate.map(o=>`
      <div style="background:#fff;border:1px solid #FCD34D;border-radius:var(--r);padding:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-weight:700;color:var(--rose);font-size:13px">${o.orderNumber||'—'}</span>
          ${paymentStatusBadge(o.paymentStatus)}
        </div>
        <div style="font-size:12px;color:var(--ink2);margin-bottom:4px;">${esc(o.clientName||o.cliente?.nome||'—')}</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">💳 ${esc(o.payment||'—')} · ${$c(o.total)}</div>
        ${o.scheduledPeriod?`<div style="font-size:11px;color:var(--muted);">🕐 ${esc(o.scheduledPeriod)}${o.scheduledTime?' · '+o.scheduledTime:''}</div>`:''}
      </div>
    `).join('')}
  </div>
</div>` : ''}
`;
}
