// ── HELPERS ──────────────────────────────────────────────────
import { S } from '../state.js';
import { _isEntregador } from '../services/auth.js';

// ── TOAST ────────────────────────────────────────────────────
export function toast(msg, err = false){
  S.toast = { msg, err };
  // Se modal aberto: atualiza toast in-place sem re-render (preserva event listeners)
  if(S._modal){
    let t = document.getElementById('_fv_toast');
    if(!t){
      t = document.createElement('div');
      t.id = '_fv_toast';
      t.className = 'toast';
      document.getElementById('root')?.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = err ? 'var(--red)' : '';
    t.style.display = 'flex';
    clearTimeout(t._timer);
    t._timer = setTimeout(()=>{ t.style.display='none'; S.toast=null; }, 3500);
    return;
  }
  import('../main.js').then(m => m.render()).catch(()=>{});
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(()=>{ S.toast=null; import('../main.js').then(m => m.render()).catch(()=>{}); }, 3500);
}

// ── SET PAGE ─────────────────────────────────────────────────
export function setPage(p){
  // Entregador nao tem navegacao — fica sempre na sua tela exclusiva
  if(_isEntregador()){ toast('❌ Acesso restrito'); return; }
  // Ao navegar para producao, reseta para hoje para mostrar pedidos recentes
  if(p==='producao') S._prodDate = new Date().toISOString().split('T')[0];
  // Ao navegar para orcamento, garante que comeca na lista
  if(p==='orcamento'){ S._orcView='list'; S._orcDraft=null; S._orcDetail=null; }
  // Ao navegar para relatorios, garante que comeca na lista de relatorios personalizados
  if(p==='relatorios'){ S._repView='list'; S._repDraft=null; }
  // Ao navegar para categorias, recolhe expansoes abertas
  if(p==='categorias'){ S._catExpanded=null; }
  S.page=p; S.sidebarOpen=false;
  localStorage.setItem('fv_page', p);
  import('../main.js').then(m => m.render()).catch(()=>{});
}

// ── SEARCH ORDERS ────────────────────────────────────────────
// Filtra por numero do pedido, nome do cliente ou telefone (correspondencia exata)
export function searchOrders(orders, q){
  if(!q) return orders;
  const t = q.trim().toLowerCase();
  return orders.filter(o=>{
    // Numero do pedido (ex: #0012 ou 0012)
    const num = (o.orderNumber||'').toLowerCase().replace('#','');
    if(num === t.replace('#','')) return true;
    // Nome do cliente (exato, case-insensitive)
    const cname = (o.client?.name||o.clientName||'').toLowerCase();
    if(cname === t) return true;
    // Telefone do cliente (exato, so digitos)
    const phone = (o.clientPhone||o.client?.phone||'').replace(/\D/g,'');
    const tPhone = t.replace(/\D/g,'');
    if(tPhone.length >= 8 && phone === tPhone) return true;
    // Tambem aceita correspondencia parcial de nome (palavra inteira)
    if(cname.includes(t)) return true;
    return false;
  });
}

// ── BARRA DE BUSCA DE PEDIDOS (HTML reutilizavel) ────────────
export function renderOrderSearchBar(placeholder='Buscar por nº pedido, nome ou telefone...'){
  const q = S._orderSearch||'';
  return`<div style="position:relative;max-width:360px;">
    <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none;">🔍</span>
    <input class="fi" id="order-search-input" value="${q}"
      placeholder="${placeholder}"
      style="padding-left:30px;font-size:12px;"/>
    ${q?`<button id="order-search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;">✕</button>`:''}
  </div>`;
}
