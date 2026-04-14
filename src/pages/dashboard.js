import { S } from '../state.js';
import { $c, $d, sc, ini, esc } from '../utils/formatters.js';
import { toast, searchOrders } from '../utils/helpers.js';
import { PATCH } from '../services/api.js';
import { can, getColabs, findColab } from '../services/auth.js';
import { recarregarDados, invalidateCache } from '../services/cache.js';

async function render(){
  const { render:r } = await import('../main.js');
  r();
}

export function renderDashboard(){
  const now = new Date();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const today = new Date().toISOString().split('T')[0];
  const todayOrders = S.orders.filter(o => (o.scheduledDate||o.createdAt?.substring(0,10)) === today);

  const totalToday = todayOrders.length;
  const aguardando = todayOrders.filter(o=>o.status==='Aguardando').length;
  const emPreparo = todayOrders.filter(o=>o.status==='Em preparo').length;
  const saiuEntrega = todayOrders.filter(o=>o.status==='Saiu p/ entrega').length;
  const entregas = todayOrders.filter(o=>o.status==='Entregue').length;

  const statusColors = {
    'Aguardando': '#F1F5F9',
    'Em preparo': '#FEF3C7',
    'Pronto': '#DBEAFE',
    'Saiu p/ entrega': '#EDE9FE',
    'Entregue': '#D1FAE5',
    'Cancelado': '#FEE2E2'
  };
  const statusTextColors = {
    'Aguardando': '#475569',
    'Em preparo': '#92400E',
    'Pronto': '#1E40AF',
    'Saiu p/ entrega': '#5B21B6',
    'Entregue': '#065F46',
    'Cancelado': '#991B1B'
  };
  const unitColors = { 'CDLE':'#DC2626', 'Loja Novo Aleixo':'#1D4ED8', 'Loja Allegro Mall':'#059669' };

  const allStatuses = ['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Cancelado'];

  // Filters
  const search = (S._dashSearch||'').toLowerCase();
  const filterStatus = S._dashStatus||'';
  const filterPayment = S._dashPayment||'';
  const filterUnit = S._dashUnit||'';

  let filtered = todayOrders;
  if(search){
    filtered = filtered.filter(o=>{
      const name = (o.clientName||o.cliente?.nome||'').toLowerCase();
      const num = (o.orderNumber||o.numero||'').toLowerCase();
      const recip = (o.recipient||'').toLowerCase();
      return name.includes(search)||num.includes(search)||recip.includes(search);
    });
  }
  if(filterStatus) filtered = filtered.filter(o=>o.status===filterStatus);
  if(filterPayment) filtered = filtered.filter(o=>(o.paymentMethod||o.formaPagamento||'')=== filterPayment);
  if(filterUnit) filtered = filtered.filter(o=>o.unit===filterUnit);

  // Group by shift
  const shifts = [
    { key:'Manhã', icon:'☀️', color:'#F59E0B', orders:[] },
    { key:'Tarde', icon:'🌤️', color:'#3B82F6', orders:[] },
    { key:'Noite', icon:'🌙', color:'#7C3AED', orders:[] },
    { key:'Sem turno', icon:'📋', color:'#6B7280', orders:[] }
  ];
  filtered.forEach(o=>{
    const p = (o.scheduledPeriod||'').toLowerCase();
    if(p.includes('manh')) shifts[0].orders.push(o);
    else if(p.includes('tard')) shifts[1].orders.push(o);
    else if(p.includes('noit')) shifts[2].orders.push(o);
    else shifts[3].orders.push(o);
  });

  // Card helper
  function metricCard(title, value, subtitle, borderColor, progress, progressColor){
    const pct = progress!=null ? progress : 0;
    return `<div style="background:#fff;border-left:4px solid ${borderColor};border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <div style="font-size:10px;text-transform:uppercase;color:#94A3B8;font-weight:600;letter-spacing:.5px;margin-bottom:6px;">${title}</div>
      <div style="font-size:24px;font-weight:700;color:#1E293B;margin-bottom:2px;">${value}</div>
      <div style="font-size:10px;color:#94A3B8;margin-bottom:8px;">${subtitle}</div>
      <div style="height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${progressColor||borderColor};border-radius:3px;transition:width .4s;"></div>
      </div>
    </div>`;
  }

  // Render order row
  function orderRow(o){
    const buyer = o.clientName||o.cliente?.nome||'—';
    const phone = o.clientPhone||o.cliente?.telefone||'';
    const recip = o.recipient||'—';
    const recipStyle = recip!=='—' && recip.toLowerCase()!==buyer.toLowerCase() ? 'color:#059669;font-weight:600;' : '';
    const bairro = o.deliveryNeighborhood||o.endereco?.bairro||'';
    const unit = o.unit||'—';
    const payment = o.paymentMethod||o.formaPagamento||'—';
    const paymentApproved = payment==='Pix'||payment==='Aprovado'||(o.paymentStatus||'').toLowerCase()==='aprovado';
    const payBadgeColor = paymentApproved ? 'background:#D1FAE5;color:#065F46;' : 'background:#FEF3C7;color:#92400E;';

    const selBg = statusColors[o.status]||'#F1F5F9';
    const selColor = statusTextColors[o.status]||'#475569';

    const statusOpts = allStatuses.map(st=>`<option value="${st}" ${st===o.status?'selected':''}>${st}</option>`).join('');

    return `<tr>
      <td style="color:#E11D48;font-weight:700;">${o.orderNumber||o.numero||'—'}</td>
      <td>
        <div style="font-weight:600;font-size:12px;">${esc(buyer)}</div>
        ${phone?`<div style="font-size:10px;color:#94A3B8;">${esc(phone)}</div>`:''}
      </td>
      <td style="${recipStyle}font-size:12px;">${esc(recip)}</td>
      <td>
        <div style="font-size:12px;">Manaus</div>
        ${bairro?`<div style="font-size:10px;color:#94A3B8;">${esc(bairro)}</div>`:''}
      </td>
      <td style="font-weight:700;">${$c(o.total)}</td>
      <td style="font-size:12px;">${o.scheduledTime||o.scheduledPeriod||'—'}</td>
      <td><span style="${payBadgeColor}border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;">${esc(payment)}</span></td>
      <td>
        <select data-status-select="${o._id}" style="background:${selBg};color:${selColor};border:none;border-radius:20px;padding:4px 10px;font-size:10px;font-weight:700;cursor:pointer;">
          ${statusOpts}
        </select>
      </td>
      <td><span style="background:${unitColors[o.unit]||'#6B7280'};color:#fff;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:600;">${esc(unit)}</span></td>
      <td style="white-space:nowrap;">
        <button data-edit-order="${o._id}" title="Editar" class="btn btn-ghost btn-xs">✏️</button>
        <button data-print-comanda="${o._id}" title="Imprimir" class="btn btn-ghost btn-xs">🖨️</button>
        <button data-confirm="${o._id}" title="Confirmar Entrega" class="btn btn-ghost btn-xs">✅</button>
        <button data-print-card="${o._id}" title="Ver Cartão" class="btn btn-ghost btn-xs">💌</button>
      </td>
    </tr>`;
  }

  // Build shift sections
  let tableContent = '';
  shifts.forEach(sh=>{
    if(sh.orders.length===0) return;
    tableContent += `<tr>
      <td colspan="10" style="background:linear-gradient(90deg,${sh.color}11,${sh.color}05);padding:10px 14px;border-left:3px solid ${sh.color};">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">${sh.icon}</span>
          <span style="font-weight:700;font-size:13px;color:${sh.color};">${sh.key}</span>
          <span style="background:${sh.color};color:#fff;border-radius:20px;padding:1px 8px;font-size:10px;font-weight:700;">${sh.orders.length}</span>
        </div>
      </td>
    </tr>`;
    sh.orders.forEach(o=>{ tableContent += orderRow(o); });
  });

  const hasOrders = filtered.length > 0;

  // Progress helpers
  const pctAguardando = totalToday ? Math.round((aguardando/totalToday)*100) : 0;
  const pctPreparo = totalToday ? Math.round((emPreparo/totalToday)*100) : 0;
  const pctSaiu = totalToday ? Math.round((saiuEntrega/totalToday)*100) : 0;
  const pctEntregas = totalToday ? Math.round((entregas/totalToday)*100) : 0;

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:20px;">🎯</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;">Dashboard de Pedidos</div>
      <div style="font-size:11px;color:#94A3B8;">Atualizado às ${hh}:${mm}</div>
    </div>
  </div>
  <div style="display:flex;gap:6px;">
    <button class="btn btn-ghost btn-sm" title="Configurações">⚙️</button>
    <button class="btn btn-ghost btn-sm" id="btn-dash-refresh" title="Atualizar">🔄</button>
    <button class="btn btn-ghost btn-sm" title="Alertas">🔔</button>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:12px;">
  ${metricCard('Pedidos Recebidos Hoje', totalToday, totalToday===1?'1 pedido':totalToday+' pedidos', '#3B82F6', 100, '#3B82F6')}
  ${metricCard('Aguardando Produção', aguardando, aguardando+' na fila', '#F59E0B', pctAguardando, '#F59E0B')}
  ${metricCard('Em Produção', emPreparo, emPreparo+' em andamento', '#7C3AED', pctPreparo, '#7C3AED')}
  ${metricCard('Saiu para Entrega', saiuEntrega, saiuEntrega+' a caminho', '#E11D48', pctSaiu, '#E11D48')}
  ${metricCard('Entregas', entregas+'/'+totalToday, pctEntregas+'% concluído', '#059669', pctEntregas, '#059669')}
  ${metricCard('Total do Dia', totalToday, 'pedidos registrados', '#1E293B', 100, '#1E293B')}
</div>

<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">
    <div style="font-weight:700;font-size:15px;">🚚 Entregas Hoje</div>
    <div class="search-box" style="flex:1;min-width:200px;">
      <span class="si">🔍</span>
      <input class="fi" id="dash-search" placeholder="Buscar pedido ou cliente..." style="padding-left:30px;" value="${esc(S._dashSearch||'')}"/>
    </div>
    <select class="fi" id="dash-filter-status" style="width:auto;min-width:140px;">
      <option value="">Todos os Status</option>
      <option ${filterStatus==='Aguardando'?'selected':''}>Aguardando</option>
      <option ${filterStatus==='Em preparo'?'selected':''}>Em preparo</option>
      <option ${filterStatus==='Pronto'?'selected':''}>Pronto</option>
      <option ${filterStatus==='Saiu p/ entrega'?'selected':''}>Saiu p/ entrega</option>
      <option ${filterStatus==='Entregue'?'selected':''}>Entregue</option>
      <option ${filterStatus==='Cancelado'?'selected':''}>Cancelado</option>
    </select>
    <select class="fi" id="dash-filter-payment" style="width:auto;min-width:150px;">
      <option value="">Todos Pagamentos</option>
      <option ${filterPayment==='Pix'?'selected':''}>Pix</option>
      <option ${filterPayment==='Dinheiro'?'selected':''}>Dinheiro</option>
      <option ${filterPayment==='Cartão Crédito'?'selected':''}>Cartão Crédito</option>
      <option ${filterPayment==='Cartão Débito'?'selected':''}>Cartão Débito</option>
      <option ${filterPayment==='Pagar na Entrega'?'selected':''}>Pagar na Entrega</option>
    </select>
    <select class="fi" id="dash-filter-unit" style="width:auto;min-width:130px;">
      <option value="">Todas Unidades</option>
      <option ${filterUnit==='CDLE'?'selected':''}>CDLE</option>
      <option ${filterUnit==='Loja Novo Aleixo'?'selected':''}>Loja Novo Aleixo</option>
      <option ${filterUnit==='Loja Allegro Mall'?'selected':''}>Loja Allegro Mall</option>
    </select>
  </div>

  ${hasOrders ? `
  <div style="overflow-x:auto;">
    <table>
      <thead><tr>
        <th>Code</th><th>Comprador</th><th>Destinatário</th><th>Entrega</th>
        <th>Preço</th><th>Hora da Entrega</th><th>Pagamento</th><th>Status</th>
        <th>Unidade</th><th>Ações</th>
      </tr></thead>
      <tbody>${tableContent}</tbody>
    </table>
  </div>
  ` : `
  <div style="text-align:center;padding:40px 20px;">
    <div style="font-size:40px;margin-bottom:12px;">📋</div>
    <div style="color:#94A3B8;font-size:14px;">Nenhum pedido para hoje</div>
  </div>
  `}
</div>
`;
}
