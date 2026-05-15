import { S, BAIRROS_MANAUS } from '../state.js';
import { $c, $d, sc, ini, esc, fmtOrderNum } from '../utils/formatters.js';
import { PUT, PATCH, DELETE } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { getTurnoPedido } from '../utils/zonasManaus.js';
import { isAdmin, normalizeUnidade, labelUnidade, filtrarPedidosParaListagem, siglaUnidade } from '../utils/unidadeRules.js';

// ── PRIORIDADE por antecedencia — DESATIVADO ─────────────────
// A usuaria pediu pra remover essas etiquetas (🎯 PRIORIDADE ALTA,
// 🎯 PRIORIDADE, 📅 ANTECIPADO). Mantemos as funcoes exportadas pra
// nao quebrar imports/refs no codigo, mas sempre retornam level 0
// (= sem etiqueta) e isOrderPriorityCritical=false (sem destaque).
export function getOrderPriority(o) {
  return { level: 0, days: 0 };
}
export function isOrderPriorityCritical(o) {
  return false;
}

// Pre-carrega notas fiscais ao abrir a tela Pedidos.
// IMPORTANTE: sempre busca no primeiro render da tela + a cada 10s.
// Isso garante que o botao rosa 🖨️ (nota ja emitida) esteja SEMPRE
// atualizado — critico para nao emitir nota duplicada em outro dispositivo.
// O polling global tambem sincroniza a cada 10s, mas aqui forcamos um
// fetch imediato ao ENTRAR na tela para nao precisar esperar o proximo
// ciclo de polling (que pode estar no meio de um ciclo longo).
let _notasLastLoad = 0;
function preloadNotas() {
  const REFRESH_MS = 10000; // recarrega a cada 10s ao navegar
  const now = Date.now();
  const isStale = (now - _notasLastLoad) > REFRESH_MS;
  if (!isStale && Array.isArray(window.S?._notasFiscais)) return;
  _notasLastLoad = now;
  import('./notas-fiscais.js').then(m => {
    if (m.loadNotas) m.loadNotas({ consultarPendentes: false }).catch(() => {});
  }).catch(() => {});
}

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: setPage via dynamic import ────────────────────────
async function setPage(pg){
  const { setPage:sp } = await import('../main.js');
  sp(pg);
}

// ── Helper: logActivity via dynamic import ────────────────────
async function logActivity(type, order){
  const mod = await import('../utils/helpers.js');
  if(typeof mod.logActivity === 'function') mod.logActivity(type, order);
}

// ── Helper: registrarReceitaVenda ─────────────────────────────
function registrarReceitaVenda(o){
  try{
    const entries = JSON.parse(localStorage.getItem('fv_financial')||'[]');
    // Evita duplicata: verifica se ja existe entrada para este pedido
    if(entries.find(e=>e.orderId===o._id && e.type==='receita')) return;
    const entry = {
      id: 'venda_'+o._id,
      orderId: o._id,
      orderNumber: o.orderNumber,
      type: 'receita',
      categoria: 'Venda',
      descricao: `Venda ${o.orderNumber} — ${o.client?.name||o.clientName||'Cliente'}`,
      valor: o.total||0,
      payment: o.payment||'—',
      unit: o.unit||'—',
      status: 'Recebido',
      date: new Date().toISOString(),
      createdBy: S.user?.name||'Sistema',
    };
    entries.unshift(entry);
    localStorage.setItem('fv_financial', JSON.stringify(entries));
    S.financialEntries = entries;
  }catch(e){ console.warn('registrarReceitaVenda:', e); }
}

// ── Helper: sendDeliveryNotification ──────────────────────────
async function sendDeliveryNotification(order){
  try{
    const mod = await import('../utils/helpers.js');
    if(typeof mod.sendWhatsAppDeliveryConfirm === 'function') mod.sendWhatsAppDeliveryConfirm(order);
  }catch(e){ /* silencioso */ }
}

// ── Helper: printComanda via dynamic import ───────────────────
async function printComanda(orderId){
  try{
    const mod = await import('./impressao.js');
    if(typeof mod.printComanda === 'function') mod.printComanda(orderId);
    else console.error('[pedidos] printComanda nao exportado em impressao.js');
  }catch(e){ console.error('[pedidos] erro ao carregar printComanda:', e); }
}

// ── Helper: printCard via dynamic import ──────────────────────
async function printCard(orderId){
  try{
    const mod = await import('./impressao.js');
    if(typeof mod.printCard === 'function') mod.printCard(orderId);
    else console.error('[pedidos] printCard nao exportado em impressao.js');
  }catch(e){ console.error('[pedidos] erro ao carregar printCard:', e); }
}

// Expor helpers no window para onclick inline
// IMPORTANTE: NAO sobrescreve window.printComanda/printCard — essas sao
// setadas no main.js com a referencia DIRETA de impressao.js (sincrona).
// Se sobrescrevessemos aqui com o wrapper async local, quebrava os
// onclick="printComanda('id')" dos botoes inline.
if(typeof window !== 'undefined'){
  window.showOrderViewModal = showOrderViewModal;
  window.showEditOrderModal = showEditOrderModal;
  window.setPage = window.setPage || function(pg){ setPage(pg); };

  // Senha de alteracao de pedido (fallback para outros cargos)
  const PWD_ALTERAR_PEDIDO = '2233';

  // Tenta editar um pedido. ADMIN, GERENTE e ATENDIMENTO editam DIRETO
  // (sem senha). Demais cargos (Producao/Expedicao/Financeiro/Entregador/
  // Contador) sao desafiados com senha 4 digitos.
  window._tryEditOrder = (orderId) => {
    const u = S.user || {};
    const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    const role = norm(u.role);
    const cargo = norm(u.cargo);
    const ehAdmin     = role === 'administrador' || cargo === 'admin' || cargo === 'administrador';
    const ehGerente   = role === 'gerente' || cargo === 'gerente';
    const ehAtendente = cargo.includes('atend') || role.includes('atend');
    if (ehAdmin || ehGerente || ehAtendente) {
      S._modal = '';
      showEditOrderModal(orderId);
      return;
    }
    const pwd = prompt('🔒 Edição de pedido protegida.\n\nDigite a senha de alteração para continuar:');
    if (pwd === null) return; // cancelou
    if (String(pwd).trim() !== PWD_ALTERAR_PEDIDO) {
      toast('❌ Senha incorreta. Edição bloqueada.', true);
      return;
    }
    S._modal = '';
    showEditOrderModal(orderId);
  };

  // ── EXCLUIR PEDIDO — Apenas Admin + dupla confirmacao com resumo ──
  window._tryDeleteOrder = async (orderId, orderNumber) => {
    const isAdm = S.user?.role === 'Administrador' || S.user?.cargo === 'admin';
    if (!isAdm) {
      toast('🚫 Apenas o Administrador pode excluir pedidos.', true);
      return;
    }
    const o = (S.orders || []).find(x => String(x._id) === String(orderId));
    if (!o) { toast('❌ Pedido nao encontrado', true); return; }

    // Resumo legivel do pedido
    const itensHtml = (o.items||[]).map(i => `
      <li style="font-size:11px;color:#374151;margin-bottom:2px;">
        <strong>${i.qty||1}x</strong> ${esc(i.name||i.productName||'?')}
        ${i.colorName ? `<span style="color:#9CA3AF;">(${esc(i.colorName)})</span>` : ''}
        ${i.price!=null ? `· R$ ${Number(i.price * (i.qty||1)).toFixed(2).replace('.',',')}` : ''}
      </li>`).join('');
    const total = $c(o.total || 0);
    const dataAg = o.scheduledDate ? o.scheduledDate.split('-').reverse().join('/') : '—';
    const num = orderNumber || o.orderNumber || String(o._id).slice(-5);

    // ── ETAPA 1: resumo + checkbox de confirmacao ──
    S._modal = `
<div class="mo" id="mo" style="z-index:10005;" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:520px;" onclick="event.stopPropagation()">
    <div style="background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;padding:14px 18px;margin:-20px -20px 16px;border-radius:14px 14px 0 0;">
      <div style="font-family:'Playfair Display',serif;font-size:18px;display:flex;align-items:center;gap:8px;">
        ⚠️ Excluir Pedido #${esc(num)}
      </div>
      <div style="font-size:11px;opacity:.9;margin-top:2px;">Etapa 1 de 2 — confirmacao com resumo</div>
    </div>

    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:12px;color:#991B1B;">
      🚨 <strong>Esta acao NAO PODE ser desfeita.</strong> O pedido sera removido permanentemente do sistema (banco de dados, relatorios, financeiro).
    </div>

    <!-- Resumo do pedido -->
    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:#6B7280;letter-spacing:1px;margin-bottom:8px;">RESUMO DO PEDIDO</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:#1F2937;">
        <div><strong>Cliente:</strong> ${esc(o.clientName||'—')}</div>
        <div><strong>Telefone:</strong> ${esc(o.clientPhone||'—')}</div>
        <div><strong>Tipo:</strong> ${esc(o.type||o.tipo||'—')}</div>
        <div><strong>Unidade:</strong> ${esc(o.unit||o.unidade||'—')}</div>
        <div><strong>Status:</strong> ${esc(o.status||'—')}</div>
        <div><strong>Pagamento:</strong> ${esc(o.paymentStatus||'—')}</div>
        <div><strong>Data agendada:</strong> ${dataAg}</div>
        <div><strong>Turno:</strong> ${esc(o.scheduledPeriod||'—')}</div>
        ${o.recipient && o.recipient !== o.clientName ? `<div style="grid-column:span 2;"><strong>Destinatario:</strong> ${esc(o.recipient)}</div>` : ''}
      </div>
      ${itensHtml ? `
        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #D1D5DB;">
          <div style="font-size:10px;font-weight:700;color:#6B7280;margin-bottom:4px;">ITENS:</div>
          <ul style="margin:0;padding-left:16px;">${itensHtml}</ul>
        </div>
      ` : ''}
      <div style="margin-top:10px;padding-top:8px;border-top:2px solid #C8736A;display:flex;justify-content:space-between;font-weight:700;font-size:14px;">
        <span>TOTAL</span><span style="color:#C8736A;">${total}</span>
      </div>
    </div>

    <label style="display:flex;align-items:flex-start;gap:8px;background:#FEF2F2;border:1.5px solid #FCA5A5;border-radius:8px;padding:10px 12px;cursor:pointer;margin-bottom:14px;">
      <input type="checkbox" id="del-ord-conferi" style="width:18px;height:18px;accent-color:#DC2626;margin-top:1px;"/>
      <span style="font-size:12px;color:#7F1D1D;">Confiro que <strong>verifiquei o resumo acima</strong> e que <strong>realmente quero excluir</strong> este pedido. Estou ciente de que esta acao sera registrada na Auditoria.</span>
    </label>

    <div class="mo-foot">
      <button class="btn btn-ghost" id="del-ord-cancel">Cancelar</button>
      <button class="btn" id="del-ord-step2" disabled style="background:#DC2626;color:#fff;opacity:.4;cursor:not-allowed;">Continuar →</button>
    </div>
  </div>
</div>`;
    const { render: r } = await import('../main.js');
    r();

    setTimeout(() => {
      const cb = document.getElementById('del-ord-conferi');
      const btn2 = document.getElementById('del-ord-step2');
      cb?.addEventListener('change', () => {
        if (cb.checked) { btn2.disabled = false; btn2.style.opacity = '1'; btn2.style.cursor = 'pointer'; }
        else            { btn2.disabled = true;  btn2.style.opacity = '.4'; btn2.style.cursor = 'not-allowed'; }
      });
      document.getElementById('del-ord-cancel')?.addEventListener('click', () => { S._modal=''; r(); });

      // ── ETAPA 2: digitar 'EXCLUIR #NUM' pra confirmar de verdade ──
      btn2?.addEventListener('click', () => {
        if (!cb.checked) return;
        const expected = `EXCLUIR #${num}`;
        S._modal = `
<div class="mo" id="mo" style="z-index:10006;" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:460px;" onclick="event.stopPropagation()">
    <div style="background:linear-gradient(135deg,#DC2626,#991B1B);color:#fff;padding:14px 18px;margin:-20px -20px 16px;border-radius:14px 14px 0 0;">
      <div style="font-family:'Playfair Display',serif;font-size:18px;">⚠️ Confirmacao Final</div>
      <div style="font-size:11px;opacity:.9;margin-top:2px;">Etapa 2 de 2 — digite pra confirmar</div>
    </div>
    <p style="font-size:13px;color:#1F2937;margin-bottom:12px;">
      Voce esta prestes a excluir <strong style="color:#DC2626;">o pedido #${esc(num)}</strong> de <strong>${esc(o.clientName||'—')}</strong> no valor de <strong>${total}</strong>.
    </p>
    <p style="font-size:12px;color:#6B7280;margin-bottom:10px;">
      Pra ter certeza absoluta, digite <strong style="color:#DC2626;font-family:monospace;">${expected}</strong> no campo abaixo:
    </p>
    <input type="text" id="del-ord-typed" placeholder="Digite aqui exatamente" autocomplete="off"
      style="width:100%;padding:10px 12px;border:2px solid #FCA5A5;border-radius:8px;font-family:monospace;font-size:14px;outline:none;"/>
    <div id="del-ord-feedback" style="font-size:10px;color:#9CA3AF;margin-top:4px;height:14px;"></div>
    <div class="mo-foot" style="margin-top:14px;">
      <button class="btn btn-ghost" id="del-ord-cancel2">Cancelar</button>
      <button class="btn" id="del-ord-final" disabled style="background:#DC2626;color:#fff;opacity:.4;cursor:not-allowed;">🗑️ Excluir definitivamente</button>
    </div>
  </div>
</div>`;
        r();
        setTimeout(() => {
          const inp = document.getElementById('del-ord-typed');
          const finalBtn = document.getElementById('del-ord-final');
          const fb = document.getElementById('del-ord-feedback');
          inp?.focus();
          inp?.addEventListener('input', () => {
            // Comparacao case-insensitive — o numero do pedido pode ter
            // letras minusculas (hex do ObjectId tipo '692f0'), entao a
            // pessoa digitando em maiusculas batia diferente.
            const v = (inp.value || '').trim();
            const match = v.toUpperCase() === expected.toUpperCase();
            finalBtn.disabled = !match;
            finalBtn.style.opacity = match ? '1' : '.4';
            finalBtn.style.cursor = match ? 'pointer' : 'not-allowed';
            fb.textContent = match ? '✓ Texto correto — pode excluir' : (v.length ? '✗ Texto nao confere' : '');
            fb.style.color = match ? '#15803D' : '#DC2626';
          });
          document.getElementById('del-ord-cancel2')?.addEventListener('click', () => { S._modal=''; r(); });
          finalBtn?.addEventListener('click', async () => {
            if (finalBtn.disabled) return;
            finalBtn.disabled = true;
            finalBtn.style.opacity = '.5';
            finalBtn.innerHTML = '⏳ Excluindo...';
            try {
              await DELETE('/orders/' + orderId);
              S.orders = S.orders.filter(x => x._id !== orderId);
              invalidateCache('orders');
              S._modal = '';
              toast(`🗑️ Pedido #${num} excluido. Acao registrada na Auditoria.`);
              r();
            } catch (e) {
              finalBtn.disabled = false;
              finalBtn.style.opacity = '1';
              finalBtn.innerHTML = '🗑️ Excluir definitivamente';
              const msg = e?.message || 'erro desconhecido';
              toast('❌ Erro ao excluir: ' + msg, true);
              console.error('[delete-order] erro:', e);
            }
          });
        }, 50);
      });
    }, 50);
  };
}

// ── PEDIDOS ──────────────────────────────────────────────────
export function renderPedidos(){
  preloadNotas();
  const today   = new Date(); today.setHours(0,0,0,0);
  const todayStr= today.toISOString().split('T')[0];
  const tmrw    = new Date(today); tmrw.setDate(today.getDate()+1);
  const tmrwStr = tmrw.toISOString().split('T')[0];

  const fStatus  = S._fStatus||'Todos';
  const fBairro  = (S._fBairro||'').toLowerCase().trim();
  const fTurno   = S._fTurno||'';
  const fUnidade = S._fUnidade||'';
  const fCanal   = S._fCanal||'';
  const fPagamento = S._fPagamento||''; // forma de pagamento (Pix, Cartão, etc)
  const fPrior   = S._fPrioridade||'';
  const fDate1   = S._fDate1||'';
  const fDate2   = S._fDate2||'';

  // Normaliza scheduledDate para so data (YYYY-MM-DD) para comparacao correta
  const orderDate = o => o.scheduledDate ? o.scheduledDate.substring(0,10) : '';

  // Filtro de unidade para LISTAGEM (Pedidos): mostra pedidos onde
  // a unidade vendeu (saleUnit) OU vai produzir (unidade).
  // Centralizado em utils/unidadeRules.js#filtrarPedidosParaListagem.
  const filtrarUnidade = (lista) => filtrarPedidosParaListagem(S.user, lista);

  // ⚠️ QUANDO HA TERMO DE BUSCA: ignoramos os outros filtros (status,
  // data, bairro, turno, canal, etc) pra garantir que o pedido apareca
  // INDEPENDENTE do status atual. Restricao por unidade (filtrarUnidade)
  // continua sendo aplicada pra seguranca (gerente/colab so ve da sua
  // unidade; admin ve tudo).
  const buscaAtiva = !!(S._orderSearch && String(S._orderSearch).trim());

  let filtered = filtrarUnidade(S.orders).filter(o=>{
    if (buscaAtiva) return true; // search ignora demais filtros
    if(fStatus!=='Todos' && o.status!==fStatus) return false;
    if(fBairro && !(o.deliveryNeighborhood||o.deliveryZone||'').toLowerCase().includes(fBairro)) return false;
    if(fTurno) {
      // Filtro de turno considera scheduledTime (horario especifico cai
      // no turno correto conforme o relogio). 'Horario especifico' como
      // filtro: mostra so pedidos com scheduledTime preenchido.
      if (fTurno === 'Horário específico') {
        if (!o.scheduledTime || o.scheduledTime === '00:00') return false;
      } else {
        const tKey = fTurno.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const tMap = { 'manha':'manha', 'tarde':'tarde', 'noite':'noite' };
        const alvo = tMap[tKey];
        if (alvo && getTurnoPedido(o) !== alvo) return false;
      }
    }
    // Filtro de unidade: compara NORMALIZADO (slug) — bate em qualquer
    // formato salvo (label completo 'Loja Allegro Mall', slug 'allegro',
    // legado 'Allegro Mall', etc). Considera tambem saleUnit (a loja
    // que VENDEU): pedido vendido em Allegro mas para retirada em outro
    // lugar continua aparecendo se filtrar por Allegro.
    if(fUnidade){
      const fSlug = normalizeUnidade(fUnidade);
      const oUnitSlug = normalizeUnidade(o.unidade || o.unit);
      const oSaleSlug = normalizeUnidade(o.saleUnit);
      if (oUnitSlug !== fSlug && oSaleSlug !== fSlug) return false;
    }
    if(fCanal){
      const src=(o.source||'').toLowerCase();
      const tipo=String(o.type||'').toLowerCase();
      // Mapeamento dos canais (PDV foi unificado em WhatsApp/Online)
      if(fCanal==='Balcão' && !(tipo==='balcão' || tipo==='balcao')) return false;
      if(fCanal==='WhatsApp/Online' && !(src.includes('whatsapp') || src==='pdv' || src==='' || src==='online')) return false;
      if(fCanal==='E-commerce' && !(src.includes('ecomm')||src.includes('e-comm')||src==='site')) return false;
      if(fCanal==='iFood' && !src.includes('ifood')) return false;
    }
    if (fPagamento) {
      const p = String(o.payment||'').toLowerCase();
      const f = fPagamento.toLowerCase();
      if (!p.includes(f)) return false;
    }
    if(fPrior && (o.priority||'Normal')!==fPrior) return false;
    // Filtro de data: aceita pedido se SCHEDULED OU CREATED bate no range.
    // Pedido vendido HOJE com entrega para AMANHA aparece em 'Hoje' (vendido)
    // E em 'Amanha' (entrega). Pedido sem scheduledDate aparece pelo createdAt.
    if(fDate1 || fDate2){
      const sched = (o.scheduledDate || '').substring(0, 10);
      const created = (o.createdAt || '').substring(0, 10);
      const dentroDoRange = (d) => {
        if (!d) return false;
        if (fDate1 && d < fDate1) return false;
        if (fDate2 && d > fDate2) return false;
        return true;
      };
      if (!dentroDoRange(sched) && !dentroDoRange(created)) return false;
    }
    return true;
  });
  // Busca por numero, nome ou telefone
  filtered = searchOrders(filtered, S._orderSearch);

  // ── DEDUP DEFENSIVO por _id e por orderNumber ──
  // Cobre caso de POST + realtime event chegando dobrado, ou bug de cache.
  {
    const seen = new Set();
    const seenNum = new Set();
    filtered = filtered.filter(o => {
      const id = String(o._id || '');
      const num = String(o.orderNumber || o.numero || '');
      if (id && seen.has(id)) return false;
      if (num && seenNum.has(num)) return false;
      if (id) seen.add(id);
      if (num) seenNum.add(num);
      return true;
    });
  }

  // Ordena por prioridade: criticos → nivel de prioridade → cronologico
  filtered = [...filtered].sort((a, b) => {
    const ca = isOrderPriorityCritical(a), cb = isOrderPriorityCritical(b);
    if (ca !== cb) return ca ? -1 : 1;
    const d = getOrderPriority(b).level - getOrderPriority(a).level;
    if (d !== 0) return d;
    return new Date(b.createdAt) - new Date(a.createdAt); // mais recentes depois
  });

  // ── ABAS: Vendas Hoje | Operação ────────────────────────────
  // ABA 1 (Vendas Hoje): pedidos criados HOJE + pagos HOJE — visivel
  //   apenas quando filtro de data = hoje (ou sem data). Mostra totais
  //   de venda por unidade.
  // ABA 2 (Operação): pedidos em producao/expedicao/entrega/entregues
  //   de qualquer data (com filtro do periodo).
  // Quando data != HOJE (amanha, datas futuras/passadas), aba 1 some
  // e usuario veh so a aba 2.
  const dataEhHoje = (!fDate1 && !fDate2) || (fDate1 === todayStr && fDate2 === todayStr);
  // Aba salva no estado; busca ATIVA forca aba operacao pra nao esconder
  // resultado por filtro de data.
  let pedTab = S._pedTab || (dataEhHoje ? 'vendasHoje' : 'operacao');
  if (!dataEhHoje) pedTab = 'operacao';
  if (buscaAtiva) pedTab = 'operacao';
  S._pedTab = pedTab;

  // Status de PRODUCAO / EXPEDICAO / ENTREGA / ENTREGUES
  const STATUS_OPERACAO = new Set(['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Reentrega']);
  const PAGAMENTOS_APROVADOS = new Set(['aprovado','pago','pago na entrega','recebido']);

  // Snapshot dos filtrados ANTES de aplicar criterio de aba
  const allFiltered = filtered;

  if (pedTab === 'vendasHoje') {
    // Aba 1: criados HOJE + pagamento aprovado (pago no dia)
    filtered = allFiltered.filter(o => {
      const created = (o.createdAt || '').substring(0, 10);
      if (created !== todayStr) return false;
      const ps = String(o.paymentStatus||'').toLowerCase().trim();
      return PAGAMENTOS_APROVADOS.has(ps);
    });
  } else {
    // Aba 2: apenas status operacionais (exclui Cancelado tb)
    filtered = allFiltered.filter(o => STATUS_OPERACAO.has(o.status));
  }

  // Expor filtrados para export (admin)
  S._filteredOrders = filtered;

  // Totais para os badges das abas (sem reaplicar filtro pesado)
  const _countVendasHoje = allFiltered.filter(o => {
    const created = (o.createdAt || '').substring(0, 10);
    const ps = String(o.paymentStatus||'').toLowerCase().trim();
    return created === todayStr && PAGAMENTOS_APROVADOS.has(ps);
  }).length;
  const _countOperacao = allFiltered.filter(o => STATUS_OPERACAO.has(o.status)).length;

  const hasFilter = fStatus!=='Todos'||fBairro||fTurno||fUnidade||fCanal||fPagamento||fPrior||fDate1||fDate2||(S._orderSearch||'');

  // Helper: renderiza array de pedidos como linhas <tr>. Extraido para
  // permitir agrupamento (visualizacao 'Por Unidade' usa esta funcao).
  // Definido depois do filtered para acesso ao contexto local.
  const buildOrderRow = (o) => {
      const bairroCell=o.deliveryNeighborhood||o.deliveryZone||'—';
      const canal=o.source||'';
      // Detecta canal e escolhe icone (PNG real da pasta /icones)
      // ATENCAO: 'PDV' antigo agora e tratado como WhatsApp/Online
      const canalLow = String(canal).toLowerCase();
      let canalKey = '';
      let canalLabel = '';
      if (canalLow.includes('whatsapp') || canalLow === 'pdv' || canalLow === '') {
        canalKey = 'whatsapp'; canalLabel = 'WhatsApp/Online';
      } else if (canalLow.includes('ifood')) {
        canalKey = 'ifood'; canalLabel = 'iFood';
      } else if (canalLow.includes('ecomm') || canalLow.includes('e-comm') || canalLow === 'site') {
        canalKey = 'ecommerce'; canalLabel = 'Site';
      } else if (o.type === 'Balcão' || o.type === 'Balcao' || canalLow.includes('balc')) {
        canalKey = 'balcao'; canalLabel = 'Balcão';
      } else {
        canalKey = 'whatsapp'; canalLabel = 'WhatsApp/Online';
      }
      const canalIcon = `<img src="/icones/${canalKey}.png" alt="${canalLabel}" title="${canalLabel}" style="width:26px;height:26px;object-fit:contain;vertical-align:middle;"/>`;
      const isPrior=o.priority==='Alta';
      const rawNum=o.orderNumber||o.numero||'';
      const numDigits=String(rawNum).replace(/^PED-?/i,'').replace(/\D/g,'');
      const numDisplay=numDigits?('#'+numDigits.padStart(5,'0')):'—';
      const prio = getOrderPriority(o);
      const prioCritical = prio.level > 0 && isOrderPriorityCritical(o);
      const prioBg = prio.level === 3 ? 'background:#FFFBEB;border-left:4px solid #F59E0B;'
                   : prio.level === 2 ? 'background:#FEF3C7;border-left:3px solid #FB923C;'
                   : prio.level === 1 ? 'background:#FFFDF5;border-left:2px solid #FCD34D;' : '';
      const prioBadgeHtml = prio.level > 0
        ? `<div style="display:inline-flex;align-items:center;gap:3px;background:${prio.level===3?'linear-gradient(135deg,#DC2626,#F59E0B)':prio.level===2?'#FB923C':'#FCD34D'};color:${prio.level>=2?'#fff':'#78350F'};font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;letter-spacing:.5px;margin-top:3px;${prioCritical?'box-shadow:0 0 10px rgba(245,158,11,.7);animation:prio-pulse 1.2s ease-in-out infinite;':''}" title="Pedido feito ha ${prio.days} dias">${prio.label}${prioCritical?' ⚠️':''}</div>` : '';
      let createdByName=o.createdByName||o.createdBy||o.criadoPorName||o.atendente||o.user||'';
      if(!createdByName&&o.criadoPor&&Array.isArray(S.users)){
        const u=S.users.find(x=>x._id===o.criadoPor);
        if(u)createdByName=u.name||u.nome||'';
      }
      return`<tr style="${isPrior?'background:#FFF7F7;':''}${prioBg}">
        <td style="color:var(--rose);font-weight:600;white-space:nowrap">${isPrior?'🔴 ':''}${numDisplay}${prioBadgeHtml}</td>
        <td>
          <div style="font-weight:500">${o.client?.name||o.clientName||'—'}</div>
          ${o.recipient&&o.recipient!==(o.client?.name||o.clientName)?`<div style="font-size:10px;color:var(--muted)">→ ${o.recipient}</div>`:''}
        </td>
        <td style="font-size:11px;font-weight:600">${bairroCell}</td>
        <td>
          ${(() => {
            // Unidade operacional: para Delivery sempre 'CDLE', para Retirada
            // a loja escolhida (unit do pedido, ja calculado pelo backend).
            const tipo = String(o.type||o.tipo||'').toLowerCase();
            const unidadeOper = tipo === 'delivery' ? 'CDLE' : (o.unit || '—');
            const atendente = o.createdByName || '';
            const sale = o.saleUnit ? siglaUnidade(o.saleUnit) : null;
            const saleHTML = sale
              ? `<div style="margin-top:3px;"><span style="display:inline-block;background:${sale.bg};color:${sale.cor};border-radius:6px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.5px;" title="Unidade que VENDEU: ${o.saleUnit}">🛒 Vendido: ${sale.sigla}</span></div>`
              : '';
            return `
              <span class="tag t-gray" style="font-size:9px;font-weight:700;" title="Unidade que vai sair o pedido">${unidadeOper}</span>
              ${saleHTML}
              ${atendente ? `<div style="font-size:9px;color:#4F46E5;font-weight:600;margin-top:2px;" title="Atendente que lançou o pedido">👤 ${atendente}</div>` : ''}
            `;
          })()}
        </td>
        <td style="color:var(--muted);font-size:11px">${(o.items||[]).map(i=>i.name).join(', ').substring(0,22)||'—'}</td>
        <td style="font-weight:600">${$c(o.total)}</td>
        <td style="font-size:11px;color:#1F2937;">
          ${o.createdAt ? `<div style="font-weight:600">${$d(o.createdAt)}</div>` : '<span style="color:var(--muted)">—</span>'}
          ${o.createdAt ? `<div style="font-size:10px;color:var(--muted);">${new Date(o.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div>` : ''}
        </td>
        <td style="font-size:11px">
          ${o.scheduledDate?`<div style="font-weight:600">${$d(o.scheduledDate)}</div>`:'<span style="color:var(--muted)">—</span>'}
          ${o.scheduledPeriod?`<div style="color:var(--muted);font-size:10px;">${o.scheduledPeriod}${o.scheduledTime?' · '+o.scheduledTime:''}</div>`:''}
        </td>
        <td style="text-align:center;">${canalIcon}</td>
        <td>
          ${(() => {
            const ps = o.paymentStatus || 'Aguardando Pagamento';
            const opts = [
              'Aguardando Pagamento',
              'Aguardando Comprovante',
              'Ag. Pagamento na Entrega',
              'Aprovado',
              'Pago',
              'Cancelado',
              'Estornado',
            ];
            // Cor do badge conforme status
            const styleByStatus = {
              'Aprovado':       'background:#DCFCE7;color:#15803D;border:1px solid #86EFAC;',
              'Pago':           'background:#DCFCE7;color:#15803D;border:1px solid #86EFAC;',
              'Aguardando Pagamento': 'background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;',
              'Aguardando Comprovante':'background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;',
              'Ag. Pagamento na Entrega':'background:#E0E7FF;color:#3730A3;border:1px solid #A5B4FC;',
              'Cancelado':      'background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;',
              'Estornado':      'background:#F3F4F6;color:#4B5563;border:1px solid #D1D5DB;',
            };
            const st = styleByStatus[ps] || 'background:#F3F4F6;color:#4B5563;border:1px solid #D1D5DB;';
            return `<select data-pay-status="${o._id}" data-current="${ps}" style="${st}font-size:10px;font-weight:700;padding:4px 6px;border-radius:8px;cursor:pointer;max-width:140px;">
              ${opts.map(s => `<option value="${s}" ${s===ps?'selected':''}>${s}</option>`).join('')}
            </select>`;
          })()}
        </td>
        <td>
          ${o.status==='Saiu p/ entrega'
            ?`<div style="display:flex;flex-direction:column;gap:3px;"><span class="tag ${sc(o.status)}">${o.status}${o.reentregaCount > 0 ? `<span style="background:#F59E0B;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🔄 ${o.reentregaCount}x</span>` : ''}</span>${o.driverName?`<span style="background:#DBEAFE;color:#1D4ED8;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">🚚 ${o.driverName}</span>`:''}</div>`
            :o.status==='Entregue'
            ?`<div style="display:flex;flex-direction:column;gap:3px;"><span class="tag ${sc(o.status)}">${o.status}${o.reentregaCount > 0 ? `<span style="background:#F59E0B;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🔄 ${o.reentregaCount}x</span>` : ''}</span>${o.driverName?`<span style="background:#DCFCE7;color:#166534;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;white-space:nowrap;">✅ ${o.driverName}</span>`:''}</div>`
            :`<span class="tag ${sc(o.status)}">${o.status}${o.reentregaCount > 0 ? `<span style="background:#F59E0B;color:#fff;border-radius:10px;padding:1px 6px;font-size:9px;font-weight:700;margin-left:4px;">🔄 ${o.reentregaCount}x</span>` : ''}</span>`}
        </td>
        <td style="white-space:nowrap">
          <button type="button" class="btn btn-ghost btn-sm" onclick="showOrderViewModal('${o._id}')">👁️ Ver</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="printComanda('${o._id}')">🖨️</button>
          ${(() => {
            // Permissoes: admin OU colaborador com modulo financial/reports/orders
            const u = S.user || {};
            const isAdm = u.role === 'Administrador' || u.cargo === 'admin';
            const podeEmitir = isAdm || can('financial') || can('reports') || can('orders');
            if (!podeEmitir) return '';
            // Busca nota AUTORIZADA ou PROCESSANDO vinculada a este pedido
            // Compara usando String() porque orderId pode vir como ObjectId
            // ou string do backend (dependendo da consulta/populate).
            const notasDoPedido = (S._notasFiscais || []).filter(n => {
              const nOrderId = n.orderId?._id || n.orderId;
              return String(nOrderId) === String(o._id) ||
                     (n.orderNumber && o.orderNumber && String(n.orderNumber) === String(o.orderNumber));
            });
            const notaAut = notasDoPedido.find(n => n.status === 'Autorizada');
            const notaProc = notasDoPedido.find(n => n.status === 'Processando' || n.status === 'Pendente');
            // Nota autorizada: botao rosa (imprimir) + esconde botoes de emissao
            if (notaAut) {
              const url = notaAut.danfeUrl || notaAut.pdfUrl || '';
              const tipoLabel = notaAut.tipo === 'NFe' ? 'DANFE' : 'Cupom';
              return url
                ? `<a href="${url}" target="_blank" title="Imprimir ${tipoLabel} da nota ${notaAut.numero || ''} — já emitida" style="display:inline-flex;align-items:center;gap:3px;background:#EC4899;color:#fff;border:none;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;margin-left:2px;text-decoration:none;">🖨️ ${tipoLabel} ${notaAut.numero?'#'+notaAut.numero:''}</a>`
                : `<span title="Nota ${notaAut.tipo} ${notaAut.numero||''} já autorizada" style="display:inline-flex;align-items:center;gap:3px;background:#EC4899;color:#fff;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;margin-left:2px;">✅ ${tipoLabel} emitido</span>`;
            }
            // Nota processando: mostra aguardando + oculta emissao
            if (notaProc) {
              return `<span title="Aguardando SEFAZ autorizar" style="display:inline-flex;align-items:center;gap:3px;background:#F59E0B;color:#fff;border-radius:6px;padding:4px 9px;font-size:10px;font-weight:700;margin-left:2px;">⏳ Processando</span>`;
            }
            // Sem nota: mostra botoes de emissao
            return `
              <button type="button" onclick="emitirNotaFiscal('${o._id}','NFCe')" title="Emitir NFC-e (cupom fiscal — pessoa física)" style="background:#1a3d27;color:#fff;border:none;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;margin-left:2px;">📄 NFC-e</button>
              <button type="button" onclick="emitirNotaFiscal('${o._id}','NFe')" title="Emitir NF-e com DANFE — requer CNPJ do cliente" style="background:#5B21B6;color:#fff;border:none;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:10px;font-weight:700;margin-left:2px;">📑 NF-e</button>
            `;
          })()}
        </td>
      </tr>`;
};
  const renderRows = (lista) => lista.map(o => buildOrderRow(o)).join('');

  const cnt = s => S.orders.filter(o=>o.status===s).length;
  const statuses=['Todos','Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Reentrega','Cancelado'];
  const bairros=[...new Set(S.orders.map(o=>(o.deliveryNeighborhood||o.deliveryZone||'').trim()).filter(Boolean))].sort();

  return`
<!-- ABAS PRINCIPAIS: Vendas Hoje | Operação -->
<div style="display:flex;gap:6px;margin-bottom:12px;border-bottom:2px solid var(--border);">
  ${dataEhHoje && !buscaAtiva ? `
  <button class="ped-aba ${pedTab==='vendasHoje'?'active':''}" data-ped-aba="vendasHoje"
    style="background:${pedTab==='vendasHoje'?'#15803D':'transparent'};color:${pedTab==='vendasHoje'?'#fff':'#15803D'};border:none;padding:10px 18px;font-size:13px;font-weight:800;cursor:pointer;border-radius:10px 10px 0 0;border-bottom:3px solid ${pedTab==='vendasHoje'?'#15803D':'transparent'};">
    💰 Vendas de Hoje <span style="background:rgba(255,255,255,.25);padding:1px 7px;border-radius:10px;margin-left:6px;font-size:11px;">${_countVendasHoje}</span>
  </button>` : ''}
  <button class="ped-aba ${pedTab==='operacao'?'active':''}" data-ped-aba="operacao"
    style="background:${pedTab==='operacao'?'#1D4ED8':'transparent'};color:${pedTab==='operacao'?'#fff':'#1D4ED8'};border:none;padding:10px 18px;font-size:13px;font-weight:800;cursor:pointer;border-radius:10px 10px 0 0;border-bottom:3px solid ${pedTab==='operacao'?'#1D4ED8':'transparent'};">
    🏭 Operação <span style="background:rgba(255,255,255,.25);padding:1px 7px;border-radius:10px;margin-left:6px;font-size:11px;">${_countOperacao}</span>
  </button>
  <div style="flex:1;display:flex;align-items:center;justify-content:flex-end;padding:0 10px;font-size:11px;color:var(--muted);">
    ${pedTab==='vendasHoje'
      ? '📅 Pedidos vendidos E pagos hoje — visão financeira'
      : '📋 Pedidos em produção, expedição, entrega e entregues'}
  </div>
</div>

<div class="tabs" style="flex-wrap:wrap;gap:3px;margin-bottom:10px;${pedTab==='vendasHoje'?'display:none;':''}">
  ${statuses.map(s=>`<button class="tab ${fStatus===s?'active':''}" data-ped-status="${s}">
    ${s}${s!=='Todos'?`<span style="margin-left:4px;background:${fStatus===s?'rgba(255,255,255,.3)':'var(--border)'};border-radius:10px;padding:0 5px;font-size:10px">${cnt(s)}</span>`:''}</button>`).join('')}
</div>

<div class="card" style="margin-bottom:12px;padding:12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
    <div style="font-size:11px;font-weight:700;color:var(--ink);">🔍 Filtros${hasFilter?` <span style="background:var(--rose);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px">${filtered.length} resultado(s)</span>`:''}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      ${renderOrderSearchBar()}
      ${hasFilter?`<button id="btn-clear-ped-filters" class="btn btn-ghost btn-sm" style="font-size:10px;color:var(--red);">✕ Limpar</button>`:''}
    </div>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center;">
    <span style="font-size:10px;font-weight:700;color:var(--muted);">📅 DATA:</span>
    <button class="btn btn-sm ${fDate1===todayStr&&fDate2===todayStr?'btn-primary':'btn-ghost'}" id="btn-ped-hoje">Hoje</button>
    <button class="btn btn-sm ${fDate1===tmrwStr&&fDate2===tmrwStr?'btn-primary':'btn-ghost'}" id="btn-ped-amanha">Amanhã</button>
    <input type="date" class="fi" id="ped-date1" value="${fDate1}" style="width:140px;font-size:11px;"/>
    <span style="font-size:11px;color:var(--muted)">até</span>
    <input type="date" class="fi" id="ped-date2" value="${fDate2}" style="width:140px;font-size:11px;"/>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
    <span style="font-size:10px;font-weight:700;color:var(--muted);">⏰ TURNO:</span>
    ${['','Manhã','Tarde','Noite','Horário específico'].map(t=>`<button class="btn btn-sm ${fTurno===t&&t?'btn-primary':fTurno===''&&t===''?'btn-ghost':''}" data-ped-turno="${t}">${t||'Todos'}</button>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:6px;">
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">🏘️ BAIRRO</label>
      <input class="fi" id="ped-filter-bairro" value="${S._fBairro||''}" placeholder="Digitar bairro..." style="font-size:11px;" list="bairros-list"/>
      <datalist id="bairros-list">${bairros.map(b=>`<option value="${b}"/>`).join('')}</datalist>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">🏪 UNIDADE</label>
      <select class="fi" id="ped-filter-unidade" style="font-size:11px;">
        <option value="">Todas</option>
        ${[
          { value:'Loja Novo Aleixo', label:'N. Aleixo' },
          { value:'Loja Allegro Mall', label:'Allegro' },
          { value:'CDLE', label:'CDLE' },
          { value:'E-commerce', label:'Site' },
        ].map(u=>`<option value="${u.value}" ${fUnidade===u.value?'selected':''}>${u.label}</option>`).join('')}
      </select>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">📲 CANAL</label>
      <select class="fi" id="ped-filter-canal" style="font-size:11px;">
        <option value="">Todos</option>
        ${[
          { value:'WhatsApp/Online', label:'WhatsApp/Online' },
          { value:'E-commerce',      label:'Site' },
          { value:'iFood',           label:'iFood' },
          { value:'Balcão',          label:'Balcão' },
        ].map(c=>`<option value="${c.value}" ${fCanal===c.value?'selected':''}>${c.label}</option>`).join('')}
      </select>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">💳 PAGAMENTO</label>
      <select class="fi" id="ped-filter-pagamento" style="font-size:11px;">
        <option value="">Todos</option>
        ${['Pix','Dinheiro','Cartão','Crédito','Débito','Link','Pagar na Entrega','Boleto','Transferência'].map(p=>`<option value="${p}" ${fPagamento===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">⭐ PRIORIDADE</label>
      <select class="fi" id="ped-filter-prioridade" style="font-size:11px;">
        <option value="">Todas</option>
        <option value="Alta" ${fPrior==='Alta'?'selected':''}>🔴 Alta</option>
        <option value="Normal" ${fPrior==='Normal'?'selected':''}>Normal</option>
      </select>
    </div>
  </div>
</div>

${(() => {
  // Card de TOTAL DE VENDAS APROVADAS: SO admin e gerente
  const r = String(S.user?.role||'').toLowerCase();
  const c = String(S.user?.cargo||'').toLowerCase();
  const podeVer = r === 'administrador' || r === 'gerente' || c === 'admin' || c === 'gerente';
  if (!podeVer) return '';
  // Considera 'Aprovado' / 'Pago' como pagamento confirmado.
  const APROVADOS = new Set(['Aprovado', 'Pago', 'aprovado', 'pago']);
  const aprovados = filtered.filter(o => APROVADOS.has(String(o.paymentStatus||'')));
  const totalAprovado = aprovados.reduce((s,o) => s + (Number(o.total)||0), 0);
  // Breakdown por unidade
  const porUnidade = {};
  for (const o of aprovados) {
    const u = labelUnidade(normalizeUnidade(o.saleUnit || o.unidade || o.unit)) || 'Outras';
    if (!porUnidade[u]) porUnidade[u] = { count:0, total:0 };
    porUnidade[u].count++;
    porUnidade[u].total += Number(o.total)||0;
  }
  // Breakdown por forma de pagamento
  const porPag = {};
  for (const o of aprovados) {
    const p = o.payment || '—';
    if (!porPag[p]) porPag[p] = { count:0, total:0 };
    porPag[p].count++;
    porPag[p].total += Number(o.total)||0;
  }
  return `
<div class="card" style="background:linear-gradient(135deg,#F0FDF4,#ECFDF5);border:1px solid #BBF7D0;margin-bottom:14px;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
    <div>
      <div style="font-size:11px;color:#15803D;font-weight:700;letter-spacing:.5px;">✅ TOTAL DE VENDAS APROVADAS</div>
      <div style="font-size:26px;font-weight:900;color:#15803D;line-height:1.1;">${$c(totalAprovado)}</div>
      <div style="font-size:11px;color:#16A34A;">${aprovados.length} pedido${aprovados.length===1?'':'s'} confirmado${aprovados.length===1?'':'s'}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${Object.entries(porUnidade).sort((a,b) => b[1].total - a[1].total).map(([u, v]) => `
        <div style="background:#fff;border:1px solid #BBF7D0;border-radius:8px;padding:6px 10px;min-width:120px;">
          <div style="font-size:9px;color:#16A34A;font-weight:700;">🏬 ${u}</div>
          <div style="font-size:14px;font-weight:900;color:#15803D;">${$c(v.total)}</div>
          <div style="font-size:9px;color:#86EFAC;">${v.count} venda${v.count===1?'':'s'}</div>
        </div>`).join('')}
    </div>
  </div>
  ${Object.keys(porPag).length > 0 ? `
  <div style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px dashed #BBF7D0;padding-top:8px;">
    <span style="font-size:10px;color:#15803D;font-weight:700;align-self:center;">💳 POR PAGAMENTO:</span>
    ${Object.entries(porPag).sort((a,b) => b[1].total - a[1].total).map(([p, v]) => `
      <div style="background:#fff;border:1px solid #DCFCE7;border-radius:6px;padding:4px 8px;">
        <span style="font-size:10px;font-weight:700;color:#15803D;">${p}:</span>
        <span style="font-size:11px;font-weight:800;color:#15803D;">${$c(v.total)}</span>
        <span style="font-size:9px;color:#86EFAC;">(${v.count})</span>
      </div>`).join('')}
  </div>` : ''}
</div>`;
})()}

<div class="card">
  <div class="card-title">Pedidos <span class="notif">${filtered.length}</span>${(() => {
      if (isAdmin(S.user)) return '';
      const lbl = labelUnidade(normalizeUnidade(S.user?.unidade || S.user?.unit));
      if (!lbl || lbl === '—') return '';
      return ` <span style="display:inline-flex;align-items:center;gap:5px;background:#FAE8E6;color:#9F1239;border:1.5px solid #FECDD3;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;margin-left:8px;">🏬 ${lbl}</span>`;
    })()}
    <div style="display:flex;gap:6px">
      <button class="btn btn-ghost btn-sm" id="btn-rel-orders">🔄</button>
      ${S.user?.role === 'Administrador' ? `
        <button class="btn btn-blue btn-sm" id="btn-import-ped">📥 Importar</button>
        <button class="btn btn-green btn-sm" id="btn-export-ped">📤 Exportar</button>
        <input type="file" id="file-import-ped" accept=".csv,.json" style="display:none" />
      ` : ''}
      <button class="btn btn-primary btn-sm" onclick="setPage('pdv')">+ Novo</button>
    </div>
  </div>
  <!-- Toggle de agrupamento -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:8px 12px;background:var(--cream);border-radius:8px;">
    <span style="font-size:11px;font-weight:700;color:var(--muted);">VISUALIZAÇÃO:</span>
    <button class="btn btn-sm ${!S._pedAgrupar?'btn-primary':'btn-ghost'}" data-ped-agrupar="">Todos juntos</button>
    <button class="btn btn-sm ${S._pedAgrupar==='unidade'?'btn-primary':'btn-ghost'}" data-ped-agrupar="unidade">🏪 Por Unidade</button>
    <span style="margin-left:auto;font-size:11px;color:var(--muted);">${filtered.length} pedido${filtered.length===1?'':'s'}</span>
  </div>
  ${filtered.length===0?`<div class="empty"><div class="empty-icon">📋</div>
    <p>${hasFilter?'Nenhum pedido com esses filtros.':'Sem pedidos ainda.'}</p>
    ${hasFilter?`<button class="btn btn-ghost btn-sm" id="btn-clear-ped-filters2" style="margin-top:8px">✕ Limpar filtros</button>`:''}</div>`:`
  ${S._pedAgrupar==='unidade'?(()=>{
    // Agrupa por unidade operacional (onde produz/sai). Ordem fixa: CDLE,
    // Loja Novo Aleixo, Loja Allegro Mall, depois outras.
    const grupos = {};
    filtered.forEach(o => {
      const tipo = String(o.type||o.tipo||'').toLowerCase();
      const uni = tipo === 'delivery' ? 'CDLE' : (o.unit || 'Outras');
      if (!grupos[uni]) grupos[uni] = [];
      grupos[uni].push(o);
    });
    const ordem = ['CDLE','Loja Novo Aleixo','Loja Allegro Mall'];
    const todasKeys = ordem.filter(k => grupos[k]).concat(Object.keys(grupos).filter(k => !ordem.includes(k)));
    const corUni = (u) => {
      if (u==='CDLE') return '#DC2626';
      if (u==='Loja Novo Aleixo') return '#1D4ED8';
      if (u==='Loja Allegro Mall') return '#047857';
      return '#6B7280';
    };
    return todasKeys.map(uni => {
      const ped = grupos[uni];
      const totalU = ped.reduce((s,o)=>s+(o.total||0), 0);
      return `
      <div style="margin-bottom:18px;border-radius:10px;overflow:hidden;border:1px solid var(--border);">
        <div style="background:linear-gradient(135deg,${corUni(uni)}22,${corUni(uni)}11);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-left:4px solid ${corUni(uni)};">
          <div style="display:flex;align-items:center;gap:10px;">
            <strong style="color:${corUni(uni)};font-size:14px;">🏪 ${uni}</strong>
            <span style="background:${corUni(uni)};color:#fff;border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;">${ped.length} pedido${ped.length===1?'':'s'}</span>
          </div>
          <div style="font-weight:700;color:${corUni(uni)};">${$c(totalU)}</div>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr>
              <th>#</th><th>Cliente / Dest.</th><th>Bairro</th><th>Unidade</th>
              <th>Itens</th><th>Total</th><th>Data da Venda</th><th>Data da Entrega</th><th>Canal</th><th>Pagamento</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>${renderRows(ped)}</tbody>
          </table>
        </div>
      </div>`;
    }).join('');
  })():`
  <div style="overflow-x:auto;">
  <table>
    <thead><tr>
      <th>#</th><th>Cliente / Dest.</th><th>Bairro</th><th>Unidade</th>
      <th>Itens</th><th>Total</th><th>Data da Venda</th><th>Data da Entrega</th><th>Canal</th><th>Pagamento</th><th>Status</th><th></th>
    </tr></thead>
    <tbody>${(() => {
      // Paginação: 30 por padrão, navegacao
      const perPage = Math.max(1, Number(S._pedPerPage || 30));
      const totalP  = Math.max(1, Math.ceil(filtered.length / perPage));
      let pg = Math.max(1, Number(S._pedPage || 1));
      if (pg > totalP) { pg = totalP; S._pedPage = pg; }
      const startP = (pg - 1) * perPage;
      return renderRows(filtered.slice(startP, startP + perPage));
    })()}</tbody>
  </table>
  </div>
  ${(() => {
    if (filtered.length === 0) return '';
    const perPage = Math.max(1, Number(S._pedPerPage || 30));
    const totalP  = Math.max(1, Math.ceil(filtered.length / perPage));
    let pg = Math.max(1, Number(S._pedPage || 1));
    if (pg > totalP) pg = totalP;
    const startP = (pg - 1) * perPage;
    const pages = [];
    let from = Math.max(1, pg - 3), to = Math.min(totalP, from + 6);
    from = Math.max(1, to - 6);
    for (let i = from; i <= to; i++) pages.push(i);
    return `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:14px 4px 0;border-top:1px solid var(--border);margin-top:8px;">
      <div style="font-size:11px;color:var(--muted);">
        Mostrando <strong>${startP+1}–${Math.min(startP+perPage, filtered.length)}</strong> de <strong>${filtered.length}</strong>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--muted);">Por página:</span>
        <select id="ped-per-page" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;">
          ${[10,30,50,100].map(n=>`<option value="${n}" ${perPage===n?'selected':''}>${n}</option>`).join('')}
        </select>
        ${pg>1?`<button class="btn btn-ghost btn-sm" data-ped-page="${pg-1}">‹</button>`:''}
        ${pages.map(n=>`<button class="btn btn-sm ${n===pg?'btn-primary':'btn-ghost'}" data-ped-page="${n}">${n}</button>`).join('')}
        ${pg<totalP?`<button class="btn btn-ghost btn-sm" data-ped-page="${pg+1}">›</button>`:''}
      </div>
    </div>`;
  })()}
  `}
`}
</div>`;
}

// ── AVANÇAR STATUS DO PEDIDO ──────────────────────────────────
// OPTIMISTIC UPDATE: UI muda IMEDIATAMENTE, PATCH em background.
// Antes: await PATCH bloqueava a UI por 0.5-3s. Agora a tela mostra
// o novo status instantaneamente; se o servidor reclamar, reverte.
export async function advanceOrder(id){
  const o=S.orders.find(x=>x._id===id);if(!o)return;
  const nxt={'Aguardando':'Em preparo','Em preparo':'Pronto','Pronto':'Saiu p/ entrega','Saiu p/ entrega':'Entregue'};
  const ns=nxt[o.status];if(!ns)return toast('Pedido já finalizado');
  const statusAntigo = o.status;
  // 1) UI imediata
  S.orders=S.orders.map(x=>x._id===id?{...x,status:ns}:x);
  const updated=S.orders.find(x=>x._id===id);
  if(ns==='Pronto')          logActivity('montagem',  updated||o);
  if(ns==='Saiu p/ entrega') logActivity('expedicao', updated||o);
  if(ns==='Entregue'){
    if(updated) sendDeliveryNotification(updated);
    registrarReceitaVenda(updated||o);
  }
  render();
  toast('✅ Status: '+ns);
  // 2) Persiste em background — reverte se falhar
  try{
    await PATCH('/orders/'+id+'/status',{status:ns});
  }catch(e){
    console.error('[advanceOrder] PATCH falhou, revertendo:', e);
    S.orders=S.orders.map(x=>x._id===id?{...x,status:statusAntigo}:x);
    render();
    toast('❌ Servidor recusou — status revertido para '+statusAntigo, true);
  }
}

// ── VISUALIZAR PEDIDO (modal completo somente leitura) ────────
export function showOrderViewModal(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('❌ Pedido não encontrado');

  const statusColors = {
    'Aguardando':'#F1F5F9','Em preparo':'#FEF3C7','Pronto':'#DBEAFE',
    'Saiu p/ entrega':'#EDE9FE','Entregue':'#D1FAE5','Cancelado':'#FEE2E2'
  };
  const bgColor = statusColors[o.status]||'#F9FAFB';

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:580px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:var(--rose)">Pedido ${fmtOrderNum(o)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${$d(o.createdAt)} — ${o.unit||'—'}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="tag ${sc(o.status)}">${o.status}</span>
      <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
    </div>
  </div>

  <!-- Cliente e Destinatario -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
    <div style="background:var(--cream);border-radius:10px;padding:12px;">
      <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">👤 Cliente / Remetente</div>
      <div style="font-weight:600">${o.client?.name||o.clientName||'—'}</div>
      <div style="font-size:11px;color:var(--muted)">${o.clientPhone||o.client?.phone||'—'}</div>
      ${o.identifyClient===false?'<div style="font-size:10px;color:var(--rose);margin-top:3px;">🔒 Anônimo no cartão</div>':''}
    </div>
    <div style="background:var(--petal);border-radius:10px;padding:12px;">
      <div style="font-size:9px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">🎁 Destinatário</div>
      <div style="font-weight:600">${o.recipient||'—'}</div>
      <div style="font-size:11px;color:var(--muted)">${o.scheduledDate?$d(o.scheduledDate)+' · '+( o.scheduledPeriod||''):'Sem data'}</div>
      ${o.scheduledTime?`<div style="font-size:11px;color:var(--muted)">${o.scheduledTime}</div>`:''}
    </div>
  </div>

  <!-- Itens -->
  <div style="margin-bottom:14px;">
    <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🌸 Itens do Pedido</div>
    ${(o.items||[]).map(i=>{
      const p=S.products.find(pr=>pr.name===i.name||pr._id===i.product);
      return`<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--cream);border-radius:8px;margin-bottom:6px;">
        ${p?.images?.[0]?`<img src="${p.images[0]}" style="width:50px;height:50px;border-radius:8px;object-fit:contain;background:#fff;flex-shrink:0;">`:`<div style="width:50px;height:50px;border-radius:8px;background:var(--rose-l);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;">🌸</div>`}
        <div style="flex:1">
          <div style="font-weight:700">${i.qty}x ${i.name}</div>
          ${i.totalPrice?`<div style="font-size:11px;color:var(--muted)">${$c(i.totalPrice)}</div>`:''}
        </div>
      </div>`;
    }).join('')}
  </div>

  <!-- Endereco -->
  ${o.deliveryAddress?`
  <div style="background:#EEF2FF;border-radius:10px;padding:12px;margin-bottom:14px;border:1px solid #C7D2FE;">
    <div style="font-size:10px;font-weight:700;color:#4338CA;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">📍 Endereço de Entrega</div>
    <div style="font-weight:600;color:#1E1B4B">${o.deliveryAddress}</div>
    ${o.condName?`<div style="font-size:12px;color:#4338CA;margin-top:3px;">🏢 ${o.condName}${o.block?' — Bloco '+o.block:''} ${o.apt?'Ap '+o.apt:''}</div>`:''}
    ${o.reference?`<div style="font-size:11px;color:#6366F1;margin-top:2px;">Ref: ${o.reference}</div>`:''}
    <a href="https://www.google.com/maps/dir/?api=1&origin=-3.0379889,-59.9516336&destination=${encodeURIComponent(o.deliveryAddress)}" target="_blank"
      style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#4F46E5;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600;">
      🗺️ Ver no Maps
    </a>
  </div>`:''}

  <!-- Mensagem cartao -->
  ${o.cardMessage?`
  <div style="background:var(--petal);border-left:3px solid var(--rose);border-radius:8px;padding:12px;margin-bottom:14px;">
    <div style="font-size:10px;font-weight:700;color:var(--rose);text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">💌 Mensagem do Cartão</div>
    <div style="font-size:14px;font-style:italic;color:var(--ink2);line-height:1.7">"${o.cardMessage}"</div>
  </div>`:''}

  <!-- Financeiro -->
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;">
    <div style="background:var(--cream);border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Subtotal</div>
      <div style="font-weight:700;font-size:15px">${$c(o.subtotal||o.total)}</div>
    </div>
    ${o.discount?`<div style="background:#FEF3C7;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Desconto</div>
      <div style="font-weight:700;font-size:15px;color:var(--gold)">-${$c(o.discount)}</div>
    </div>`:''}
    <div style="background:var(--rose-l);border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">Total</div>
      <div style="font-weight:800;font-size:18px;color:var(--rose)">${$c(o.total)}</div>
    </div>
  </div>

  <!-- Pagamento e Entregador -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
    <div style="background:var(--cream);border-radius:8px;padding:10px;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">💳 Pagamento</div>
      <div style="font-weight:600;font-size:13px">${o.payment||'—'}</div>
      ${o.payment==='Pagar na Entrega'?`<div style="font-size:11px;color:var(--gold)">${o.paymentOnDelivery||''}</div>`:''}
    </div>
    ${o.driverName?`<div style="background:var(--cream);border-radius:8px;padding:10px;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">🚚 Entregador</div>
      <div style="font-weight:600;font-size:13px">${o.driverName}</div>
    </div>`:''}
  </div>

  ${o.notes?`<div style="background:var(--cream);border-radius:8px;padding:10px;margin-bottom:14px;">
    <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">📝 Observações</div>
    <div style="font-size:12px">${o.notes}</div>
  </div>`:''}

  ${o.reentregaCount > 0 ? `
  <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:8px;padding:12px;margin-top:12px;margin-bottom:14px;">
    <div style="font-weight:700;font-size:13px;color:#92400E;margin-bottom:6px;">
      🔄 Reentrega (${o.reentregaCount}x)
    </div>
    <div style="font-size:12px;color:#78350F;margin-bottom:4px;">
      <strong>Último motivo:</strong> ${esc(o.reentregaMotivo || '—')}
    </div>
    ${o.reentregas && o.reentregas.length > 0 ? `
      <details style="margin-top:6px;">
        <summary style="cursor:pointer;font-size:11px;color:#92400E;">Ver histórico (${o.reentregas.length})</summary>
        <div style="margin-top:6px;padding:6px 10px;background:#FEF9E7;border-radius:6px;font-size:11px;">
          ${o.reentregas.map(r => `<div style="margin-bottom:3px;">📅 ${new Date(r.date).toLocaleString('pt-BR')} — ${esc(r.motivo)} <em style="color:var(--muted);">(${r.user})</em></div>`).join('')}
        </div>
      </details>
    ` : ''}
  </div>` : ''}

  <div class="mo-foot">
    <button class="btn btn-primary" onclick="window._tryEditOrder('${o._id}')">✏️ Editar Pedido</button>
    <button class="btn btn-ghost" onclick="printComanda('${o._id}')">🖨️ Comanda</button>
    <button class="btn btn-ghost" onclick="printCard('${o._id}')">💌 Cartão</button>
    ${(S.user?.role==='Administrador' || S.user?.cargo==='admin') ? `<button class="btn btn-ghost" style="color:var(--red);border-color:var(--red);" onclick="window._tryDeleteOrder('${o._id}','${(o.orderNumber||'').replace(/'/g,'')}')">🗑️ Excluir</button>` : ''}
    <button class="btn btn-ghost" id="btn-mo-close-view">Fechar</button>
  </div>
  </div></div>`;

  render();
  setTimeout(()=>{
    document.getElementById('btn-mo-close-view')?.addEventListener('click',()=>{S._modal='';render();});
  },0);
}

// ── EDITAR PEDIDO (modal completo) ────────────────────────────
export function showEditOrderModal(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('❌ Pedido não encontrado');

  const statuses = ['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Reentrega','Cancelado'];
  const periods  = ['Manhã','Tarde','Noite','Urgente','Horário específico'];
  const payments = ['Pix','Link','Cartão','Dinheiro','Pagar na Entrega','Bemol','Giuliana','iFood'];

  // Monta linhas de itens editaveis
  const itemRows = (o.items||[]).map((it,i)=>`
  <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--cream);border-radius:8px;margin-bottom:6px;">
    <div class="av" style="width:36px;height:36px;font-size:14px;background:var(--rose-l);color:var(--rose);flex-shrink:0;">${it.qty}</div>
    <div style="flex:1;font-size:13px;font-weight:600">${it.name}</div>
    <div style="font-size:12px;color:var(--muted);white-space:nowrap">${$c(it.totalPrice||it.price*it.qty||0)}</div>
    <input type="number" class="fi eo-qty" data-idx="${i}" value="${it.qty}" min="1"
      style="width:60px;padding:5px 8px;font-size:12px;" title="Qtd"/>
    <button class="btn btn-red btn-xs eo-remove-item" data-idx="${i}" title="Remover">✕</button>
  </div>`).join('');

  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:620px;max-height:94vh;overflow-y:auto;" onclick="event.stopPropagation()">

  <!-- Titulo -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;">✏️ Editar Pedido — ${fmtOrderNum(o)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${o.client?.name||o.clientName||'—'}</div>
    </div>
    <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">×</button>
  </div>

  <!-- STATUS + DATA -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">📋 Status e Data</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg"><label class="fl">Status</label>
      <select class="fi" id="eo-status">
        ${statuses.map(s=>`<option value="${s}" ${o.status===s?'selected':''}>${s==='Reentrega'?'🔄 Reentrega':s}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Período de Entrega</label>
      <select class="fi" id="eo-period">
        ${periods.map(p=>`<option ${o.scheduledPeriod===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Data de Entrega</label>
      <input class="fi" type="date" id="eo-date" value="${o.scheduledDate?o.scheduledDate.split('T')[0]:''}"/>
    </div>
    <div class="fg"><label class="fl">Horário Específico</label>
      <input class="fi" id="eo-time" placeholder="Ex: 14:30" value="${o.scheduledTime||''}"/>
    </div>
  </div>

  <!-- DESTINATARIO + REMETENTE -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">👤 Destinatário e Remetente</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg"><label class="fl">Destinatário (Para quem vai)</label>
      <input class="fi" id="eo-recipient" value="${o.recipient||''}" placeholder="Nome de quem vai receber"/>
    </div>
    <div class="fg"><label class="fl">Identificar remetente no cartão?</label>
      <select class="fi" id="eo-identify">
        <option value="true"  ${o.identifyClient!==false?'selected':''}>✅ Sim — mostrar no cartão</option>
        <option value="false" ${o.identifyClient===false?'selected':''}>🚫 Não — anônimo</option>
      </select>
    </div>
  </div>

  <!-- ENDERECO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">📍 Endereço de Entrega</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg" style="grid-column:span 2"><label class="fl">Rua / Avenida</label>
      <input class="fi" id="eo-street" value="${(o.deliveryStreet||'').replace(/"/g,'&quot;')}" placeholder="Av. Constantino Nery"/>
    </div>
    <div class="fg"><label class="fl">Número</label>
      <input class="fi" id="eo-number" value="${(o.deliveryNumber||'').replace(/"/g,'&quot;')}" placeholder="123"/>
    </div>
    <div class="fg"><label class="fl">Bairro</label>
      <input class="fi" id="eo-neigh" value="${(o.deliveryNeighborhood||'').replace(/"/g,'&quot;')}" placeholder="Adrianópolis"/>
    </div>
    <div class="fg"><label class="fl">Cidade</label>
      <input class="fi" id="eo-city" value="${(o.deliveryCity||'Manaus').replace(/"/g,'&quot;')}"/>
    </div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Referência / Ponto de Apoio</label>
      <input class="fi" id="eo-ref" value="${(o.deliveryReference||o.reference||'').replace(/"/g,'&quot;')}" placeholder="Próximo a... / Casa azul"/>
    </div>
    <div class="fg">
      <label class="fl">Condomínio?</label>
      <select class="fi" id="eo-condo">
        <option value="false" ${!o.isCondominium?'selected':''}>Não</option>
        <option value="true"  ${o.isCondominium?'selected':''}>Sim</option>
      </select>
    </div>
    <div class="fg" id="eo-block-wrap" style="${o.isCondominium?'':'display:none'}">
      <label class="fl">Nome do Condomínio *</label>
      <input class="fi" id="eo-cond-name" value="${o.condName||''}" placeholder="Ex: Condomínio Mirante do Rio"/>
    </div>
    <div class="fg" id="eo-block-wrap2" style="${o.isCondominium?'':'display:none'}">
      <label class="fl">Bloco *</label>
      <input class="fi" id="eo-block" value="${o.block||''}" placeholder="Bloco"/>
    </div>
    <div class="fg" id="eo-apt-wrap" style="${o.isCondominium?'':'display:none'}">
      <label class="fl">Apartamento *</label>
      <input class="fi" id="eo-apt" value="${o.apt||''}" placeholder="Ap. 101"/>
    </div>
  </div>

  <!-- PAGAMENTO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">💳 Pagamento</div>
  <div class="fr2" style="margin-bottom:14px;">
    <div class="fg"><label class="fl">Forma de pagamento</label>
      <select class="fi" id="eo-payment">
        ${payments.map(p=>`<option ${o.payment===p?'selected':''}>${p}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Desconto (R$)</label>
      <input class="fi" type="number" id="eo-discount" value="${o.discount||0}" min="0" step="0.50"/>
    </div>
    <div class="fg"><label class="fl">Total do Pedido (R$)</label>
      <input class="fi" type="number" id="eo-total" value="${o.total||0}" step="0.10"/>
    </div>
  </div>

  <!-- ITENS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">🌸 Itens do Pedido</div>
  <div id="eo-items-list" style="margin-bottom:10px;">${itemRows}</div>

  <!-- BUSCA DE PRODUTO (igual ao PDV) -->
  <div class="fg" style="margin-bottom:14px;">
    <label class="fl">➕ Adicionar produto ao pedido</label>
    <div style="position:relative;">
      <input class="fi" id="eo-prod-search" autocomplete="off"
        placeholder="🔍 Buscar por nome, código ou categoria..."
        style="padding:11px 12px;font-size:13px;border:2px solid var(--rose-l);border-radius:10px;"/>
      <div id="eo-prod-suggestions" style="
        position:absolute;top:100%;left:0;right:0;background:#fff;
        border:1px solid var(--border);border-radius:10px;margin-top:4px;
        max-height:340px;overflow-y:auto;
        box-shadow:0 8px 24px rgba(0,0,0,.15);
        z-index:100;display:none;
      "></div>
    </div>
  </div>

  <!-- MENSAGEM CARTAO + OBS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">💌 Cartão e Observações</div>
  <div class="fr2" style="margin-bottom:8px;">
    <div class="fg" style="grid-column:span 2"><label class="fl">Mensagem do Cartão</label>
      <textarea class="fi" id="eo-card" rows="2" placeholder="Mensagem para o destinatário...">${o.cardMessage||''}</textarea>
    </div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Observações internas</label>
      <textarea class="fi" id="eo-notes" rows="2" placeholder="Instruções de montagem, cuidados especiais...">${o.notes||''}</textarea>
    </div>
  </div>

  <div class="mo-foot">
    <button class="btn btn-primary" id="btn-eo-save" style="flex:1;justify-content:center;padding:11px;">
      💾 Salvar Alterações
    </button>
    <button class="btn btn-ghost" id="btn-eo-cancel">Cancelar</button>
  </div>
  </div></div>`;

  render();

  setTimeout(()=>{
    // Fechar
    document.getElementById('btn-eo-cancel')?.addEventListener('click',()=>{S._modal='';render();});

    // Toggle condominio
    document.getElementById('eo-condo')?.addEventListener('change',e=>{
      const show = e.target.value==='true';
      ['eo-block-wrap','eo-block-wrap2','eo-apt-wrap'].forEach(id=>{
        const el=document.getElementById(id);
        if(el) el.style.display=show?'':'none';
      });
    });

    // Remover item
    document.querySelectorAll('.eo-remove-item').forEach(btn=>btn.addEventListener('click',()=>{
      const idx=parseInt(btn.dataset.idx);
      const items=[...(o.items||[])];
      items.splice(idx,1);
      o.items=items;
      showEditOrderModal(orderId); // re-abre com itens atualizados
    }));

    // ── BUSCA DE PRODUTO (estilo PDV: miniatura + nome + preco) ──
    (() => {
      const inp = document.getElementById('eo-prod-search');
      const box = document.getElementById('eo-prod-suggestions');
      if (!inp || !box) return;
      let _searchT = null;

      const addItem = (prod) => {
        if (!prod) return;
        const items = [...(o.items||[])];
        const pid = prod._id;
        const name = prod.name || prod.nome || '';
        const price = prod.salePrice || prod.preco || 0;
        const ex = items.find(i => i.product === pid || i.name === name);
        if (ex) ex.qty++;
        else items.push({
          product: pid,
          name,
          price,
          qty: 1,
          totalPrice: price,
          code: prod.code || prod.sku || '',
          category: prod.category || prod.categoria || '',
        });
        o.items = items;
        showEditOrderModal(orderId); // re-abre com novo item
      };

      const renderSugg = (filtered) => {
        if (!filtered.length) {
          box.innerHTML = '<div style="padding:14px;text-align:center;color:#94A3B8;font-size:12px;">Nenhum produto encontrado</div>';
          box.style.display = 'block';
          return;
        }
        box.innerHTML = filtered.map(p => {
          const img = (Array.isArray(p.images) && p.images[0]) || p.image || p.imagem || '';
          const cat = p.categoria || p.category || (Array.isArray(p.categories) ? p.categories[0] : '') || 'Sem categoria';
          const price = (p.salePrice || p.preco || 0).toFixed(2).replace('.', ',');
          const nm = p.name || p.nome || '';
          return `
<div class="eo-sugg" data-pid="${p._id}" style="
  display:flex;align-items:center;gap:10px;padding:8px 10px;cursor:pointer;
  border-bottom:1px solid #F1F5F9;transition:background .12s;
" onmouseover="this.style.background='#FAE8E6'" onmouseout="this.style.background='#fff'">
  ${img
    ? `<img src="${img}" style="width:42px;height:42px;border-radius:6px;object-fit:cover;flex-shrink:0;"/>`
    : `<div style="width:42px;height:42px;border-radius:6px;background:#FAE8E6;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">🌸</div>`}
  <div style="flex:1;min-width:0;">
    <div style="font-weight:600;font-size:12px;color:#1E293B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nm)}</div>
    <div style="font-size:9px;color:#94A3B8;margin-top:1px;">${esc(cat)}</div>
  </div>
  <div style="font-weight:700;font-size:13px;color:#C8736A;flex-shrink:0;">R$ ${price}</div>
</div>`;
        }).join('');
        box.style.display = 'block';
      };

      const norm = (s) => String(s||'').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

      const _showRecent = () => {
        const recent = (S.products||[]).filter(p => p.archived !== true).slice(0, 10);
        if (recent.length) renderSugg(recent);
      };

      inp.addEventListener('focus', () => {
        if (!inp.value.trim()) _showRecent();
      });
      inp.addEventListener('input', () => {
        clearTimeout(_searchT);
        const q = inp.value.trim();
        if (!q) { _showRecent(); return; }
        _searchT = setTimeout(() => {
          const qn = norm(q);
          const filtered = (S.products||[])
            .filter(p => {
              if (p.archived === true) return false;
              const hay = norm((p.name||p.nome||'') + ' ' + (p.sku||p.code||'') + ' ' + (p.categoria||p.category||''));
              return hay.includes(qn);
            })
            .slice(0, 20);
          // Fallback no backend se nao achar nada local
          if (!filtered.length) {
            box.innerHTML = '<div style="padding:14px;text-align:center;color:#94A3B8;font-size:12px;">Buscando no servidor...</div>';
            box.style.display = 'block';
            const tk = S.token || localStorage.getItem('fv2_token') || '';
            const API = (import.meta.env?.VITE_API_URL || 'https://florevita-backend-2-0.onrender.com').replace(/\/api$/, '') + '/api';
            fetch(API+'/products?search='+encodeURIComponent(q)+'&limit=20', {
              headers: { 'Authorization': 'Bearer ' + tk }
            }).then(r => r.ok ? r.json() : []).then(rem => {
              if (!Array.isArray(rem)) rem = [];
              for (const p of rem) {
                if (!S.products.find(x => String(x._id) === String(p._id))) S.products.push(p);
              }
              renderSugg(rem.filter(p => p.archived !== true).slice(0,20));
            }).catch(() => renderSugg([]));
          } else {
            renderSugg(filtered);
          }
        }, 120);
      });
      box.addEventListener('click', (e) => {
        const row = e.target.closest('.eo-sugg');
        if (!row) return;
        const pid = row.dataset.pid;
        const prod = S.products.find(p => String(p._id) === String(pid));
        addItem(prod);
      });
      // Click outside fecha sugestoes
      document.addEventListener('click', (e) => {
        if (!box.contains(e.target) && e.target !== inp) box.style.display = 'none';
      }, { once: false });
    })();

    // Salvar
    document.getElementById('btn-eo-save')?.addEventListener('click',async()=>{
      // Le qtds atualizadas dos itens
      const itemsEl=document.querySelectorAll('.eo-qty');
      const items=[...(o.items||[])].map((it,i)=>{
        const qEl=document.querySelector(`.eo-qty[data-idx="${i}"]`);
        const qty=qEl?parseInt(qEl.value)||1:it.qty;
        return{...it,qty,totalPrice:(it.price||0)*qty};
      });

      // ── ENDERECO: campos granulares + string combinada ──
      // A comanda le os campos separados (deliveryStreet/Number/Neighborhood/City).
      // Mantemos deliveryAddress como string combinada pra compat retroativa.
      const street  = document.getElementById('eo-street')?.value?.trim() || '';
      const number  = document.getElementById('eo-number')?.value?.trim() || '';
      const neigh   = document.getElementById('eo-neigh')?.value?.trim() || '';
      const city    = document.getElementById('eo-city')?.value?.trim() || 'Manaus';
      const refTxt  = document.getElementById('eo-ref')?.value?.trim() || '';
      const addrCombined = [street, number, neigh].filter(Boolean).join(', ');

      const payload={
        status:         document.getElementById('eo-status')?.value,
        scheduledDate:  document.getElementById('eo-date')?.value,
        scheduledPeriod:document.getElementById('eo-period')?.value,
        scheduledTime:  document.getElementById('eo-time')?.value,
        recipient:      document.getElementById('eo-recipient')?.value?.trim(),
        identifyClient: document.getElementById('eo-identify')?.value!=='false',
        // ── ENDERECO: TODOS os campos granulares (comanda usa esses) ──
        deliveryStreet:       street,
        deliveryNumber:       number,
        deliveryNeighborhood: neigh,
        deliveryCity:         city,
        deliveryReference:    refTxt,
        deliveryAddress:      addrCombined,
        reference:            refTxt, // compat
        isCondominium:  document.getElementById('eo-condo')?.value==='true',
        condName:       document.getElementById('eo-cond-name')?.value?.trim(),
        block:          document.getElementById('eo-block')?.value?.trim(),
        apt:            document.getElementById('eo-apt')?.value?.trim(),
        payment:        document.getElementById('eo-payment')?.value,
        discount:       parseFloat(document.getElementById('eo-discount')?.value)||0,
        total:          parseFloat(document.getElementById('eo-total')?.value)||o.total,
        cardMessage:    document.getElementById('eo-card')?.value?.trim(),
        notes:          document.getElementById('eo-notes')?.value?.trim(),
        items,
      };

      S._modal=''; S.loading=true; try{render();}catch(e){}
      try{
        const updated = await PUT('/orders/'+orderId, payload).catch(async()=>{
          return await PATCH('/orders/'+orderId, payload);
        });
        // Atualiza estado local com TODOS os campos novos + marca como editado
        const orderModified = { ...payload, ...(updated||{}), _lastEditedAt: new Date().toISOString() };
        S.orders=S.orders.map(x=>x._id===orderId?{...x,...orderModified}:x);
        // ── RESET do flag de impressao: pedido mudou → comanda precisa reimprimir ──
        // O icone na tabela volta a ficar VERMELHO (nao impresso), alertando
        // que a comanda atual nao reflete as alteracoes.
        if (S._printedComanda && S._printedComanda[orderId]) {
          delete S._printedComanda[orderId];
          try {
            localStorage.setItem('fv_printed_comanda', JSON.stringify(S._printedComanda));
          } catch(_) {}
        }
        // Mesmo pro cartao
        if (S._printedCard && S._printedCard[orderId]) {
          delete S._printedCard[orderId];
          try {
            localStorage.setItem('fv_printed_card', JSON.stringify(S._printedCard));
          } catch(_) {}
        }
        S.loading=false; render();
        toast('✅ Pedido '+o.orderNumber+' atualizado! 🖨️ Reimprima a comanda.');
      }catch(e){
        S.loading=false; render(); toast('❌ Erro ao salvar: '+(e.message||''));
      }
    });
  },0);
}
