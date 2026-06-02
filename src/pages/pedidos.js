import { S, BAIRROS_MANAUS } from '../state.js';
import { $c, $d, sc, ini, esc, fmtOrderNum } from '../utils/formatters.js';
import { PUT, PATCH, DELETE } from '../services/api.js';
import { toast, searchOrders, renderOrderSearchBar } from '../utils/helpers.js';
import { can, findColab, getColabs } from '../services/auth.js';
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
  // Helper: data em Manaus (UTC-4) no formato YYYY-MM-DD. TZ-safe.
  // FIX critico: scheduledDate muitas vezes vem como "2026-05-16" (date-only,
  // sem hora). new Date("2026-05-16") interpreta como UTC midnight = Manaus
  // 2026-05-15 20:00 -> retornava o DIA ANTERIOR. Causa o sintoma "Hoje"
  // mostrar pedidos de amanha. Agora, date-only YYYY-MM-DD retorna direto.
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
  // todayStr/tmrwStr computados a partir da data Manaus (TZ-safe).
  // Antes calculava tmrw via setDate(+1) no Date local, mas se o browser
  // estivesse em TZ diferente de Manaus, tmrwStr podia ficar igual a
  // todayStr — bug "ambos botoes Hoje e Amanha selecionados".
  const todayStr = _dManaus(new Date());
  const _addDays = (base, n) => {
    const [y, m, d] = base.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
  };
  const tmrwStr = _addDays(todayStr, 1);
  const yesterdayStr = _addDays(todayStr, -1);

  const fStatus  = S._fStatus||'Todos';
  const fBairro  = (S._fBairro||'').toLowerCase().trim();
  const fTurno   = S._fTurno||'';
  const fUnidade = S._fUnidade||'';
  const fCanal   = S._fCanal||'';
  const fPagamento = S._fPagamento||''; // forma de pagamento (Pix, Cartão, etc)
  const fPrior   = S._fPrioridade||'';
  const fTipo    = S._fTipo||''; // 'Delivery' | 'Retirada' | 'Balcao' | ''
  const fDate1   = S._fDate1||'';
  const fDate2   = S._fDate2||'';

  // Normaliza scheduledDate para so data (YYYY-MM-DD) para comparacao correta
  const orderDate = o => o.scheduledDate ? o.scheduledDate.substring(0,10) : '';

  // Marcia (30/mai/2026): modulo Pedidos mostra TODOS os pedidos pra
  // todas as colaboradoras, independente da unidade. Antes filtrava por
  // saleUnit/unidade — escondia pedidos lancados em outras lojas. Filtro
  // por unidade fica APENAS no Dashboard.
  const filtrarUnidade = (lista) => lista;

  // ⚠️ QUANDO HA TERMO DE BUSCA: ignoramos os outros filtros (status,
  // data, bairro, turno, canal, etc) pra garantir que o pedido apareca
  // INDEPENDENTE do status atual. Restricao por unidade (filtrarUnidade)
  // continua sendo aplicada pra seguranca (gerente/colab so ve da sua
  // unidade; admin ve tudo).
  const buscaAtiva = !!(S._orderSearch && String(S._orderSearch).trim());

  // Predicado: aplica TODOS os filtros operacionais (status, bairro,
  // turno, unidade, canal, pagamento, prioridade) — exceto data.
  // Reusado pelas abas Vendas de Hoje e Operacao de Hoje, que ignoram
  // o filtro de data global (sempre HOJE) mas respeitam os demais.
  const _aplicaFiltrosNaoData = (o) => {
    if (buscaAtiva) return true;
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
    if (fTipo) {
      const tipo = String(o.type || o.tipo || '').toLowerCase();
      const ehRetir = tipo.includes('retir') || tipo === 'pickup';
      const ehBalc  = tipo.includes('balc');
      const ehDeliv = !ehRetir && !ehBalc; // delivery = default
      if (fTipo === 'Delivery' && !ehDeliv) return false;
      if (fTipo === 'Retirada' && !ehRetir) return false;
      if (fTipo === 'Balcao'   && !ehBalc)  return false;
    }
    return true;
  };

  let filtered = filtrarUnidade(S.orders).filter(o => {
    if (!_aplicaFiltrosNaoData(o)) return false;
    // Filtro de data: SO createdAt em Manaus. Filtrar dia 15 mostra tudo
    // que foi LANCADO no dia 15, independente da data de entrega agendada.
    if(fDate1 || fDate2){
      const created = _dManaus(o.createdAt);
      if (!created) return false;
      if (fDate1 && created < fDate1) return false;
      if (fDate2 && created > fDate2) return false;
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

  // ── PEDIDOS (SEM ABAS) ─────────────────────────────────────
  // Conforme pedido da usuaria: modulo Pedidos tem UMA UNICA lista
  // de todos os pedidos lançados, ordenados por createdAt desc.
  // Filtros (data/unidade/canal/etc) sao normais e aplicam aqui.
  // Cancelados OCULTOS por padrao.
  // Resumo de "Movimentacao de Vendas de Hoje" (com filtro de dia
  // proprio) aparece SO pra admin/gerente acima da lista.
  const PAGAMENTOS_APROVADOS = new Set(['aprovado','pago','pago na entrega','recebido']);
  filtered = filtered.filter(o => o.status !== 'Cancelado');

  // Expor filtrados para export (admin)
  S._filteredOrders = filtered;

  const hasFilter = fStatus!=='Todos'||fBairro||fTurno||fUnidade||fCanal||fPagamento||fPrior||fTipo||fDate1||fDate2||(S._orderSearch||'');

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
      // ── DESTAQUE PEDIDO DO E-COMMERCE/SITE ──
      // Marcia pediu (19/05): pedidos do site ficam em verde pra
      // identificar rapido + verificar pagamento.
      const srcLow = String(o.source || '').toLowerCase();
      const ehEcommerce = srcLow === 'e-commerce' || srcLow === 'ecommerce' || srcLow === 'site' || srcLow.includes('ecomm') || srcLow.includes('e-comm');
      // Background: prioridade critica > E-commerce > prior normal > nenhum
      let rowBg = '';
      if (prioCritical) {
        rowBg = prioBg; // herda do prioBg (vermelho pulsante)
      } else if (ehEcommerce) {
        rowBg = 'background:linear-gradient(90deg,#D1FAE5,#ECFDF5);border-left:4px solid #10B981;';
      } else if (isPrior) {
        rowBg = 'background:#FFF7F7;' + prioBg;
      } else {
        rowBg = prioBg;
      }
      return`<tr style="${rowBg}">
        <td style="color:var(--rose);font-weight:600;white-space:nowrap">${isPrior?'🔴 ':''}${ehEcommerce?'<span title="Pedido do Site/E-commerce" style="display:inline-flex;align-items:center;gap:3px;background:#10B981;color:#fff;font-size:9px;font-weight:800;padding:2px 6px;border-radius:6px;letter-spacing:.5px;margin-right:4px;vertical-align:middle;">🛒 SITE</span>':''}${numDisplay}${prioBadgeHtml}</td>
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
        <td style="color:var(--muted);font-size:11px">
          ${(o.items||[]).map(i=>i.name).join(', ').substring(0,22)||'—'}
          ${(() => {
            const totalFotos = (o.items||[]).reduce((s,it) => s + (Array.isArray(it.userPhotos) ? it.userPhotos.filter(p => typeof p === 'string' && p.startsWith('data:')).length : 0), 0);
            return totalFotos > 0 ? `<div style="margin-top:3px;display:inline-flex;align-items:center;gap:3px;background:#FEF3C7;color:#92400E;border:1px solid #F59E0B;font-size:10px;font-weight:800;padding:1px 6px;border-radius:5px;" title="Cliente enviou ${totalFotos} foto(s) — abrir o pedido pra baixar">📸 ${totalFotos} foto${totalFotos===1?'':'s'}</div>` : '';
          })()}
        </td>
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
            // Normaliza qualquer variacao do paymentStatus pra um valor canonico
            // (evita bug: paymentStatus='Aprovado' MP mas dropdown mostra Aguardando)
            const rawPs = String(o.paymentStatus || '').toLowerCase().trim();
            let ps = o.paymentStatus || 'Aguardando Pagamento';
            if (rawPs === 'aprovado' || rawPs === 'approved' || rawPs === 'pago' || rawPs === 'paid') ps = 'Aprovado';
            else if (rawPs === 'pago na entrega') ps = 'Pago';
            else if (rawPs === 'aguardando pagamento' || rawPs === 'ag. pagamento' || rawPs === 'pendente' || rawPs === 'pending') ps = 'Aguardando Pagamento';
            else if (rawPs === 'aguardando comprovante' || rawPs === 'ag. comprovante' || rawPs === 'comprov. enviado' || rawPs === 'comprovante enviado') ps = 'Aguardando Comprovante';
            else if (rawPs.includes('pagamento na entrega')) ps = 'Ag. Pagamento na Entrega';
            else if (rawPs === 'cancelado' || rawPs === 'cancelled') ps = 'Cancelado';
            else if (rawPs === 'estornado' || rawPs === 'extornado' || rawPs === 'refunded') ps = 'Estornado';
            else if (rawPs === 'negado' || rawPs === 'rejected') ps = 'Cancelado';

            const opts = [
              'Aguardando Pagamento',
              'Aguardando Comprovante',
              'Ag. Pagamento na Entrega',
              'Aprovado',
              'Pago',
              'Cancelado',
              'Estornado',
            ];
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
            // Botao "Verificar MP" para pedidos com Link MP pendentes
            const payLow = String(o.payment||'').toLowerCase();
            const isLinkPending = (payLow.includes('link') || payLow.includes('mercado') || payLow === 'pix' || payLow.includes('cartão') || payLow.includes('cartao'))
              && ps !== 'Aprovado' && ps !== 'Pago' && ps !== 'Cancelado' && ps !== 'Estornado';
            const verifyBtn = isLinkPending
              ? `<button type="button" data-verify-mp="${o._id}" title="Consultar Mercado Pago e atualizar status agora" style="background:#009EE3;color:#fff;border:none;padding:3px 6px;border-radius:6px;cursor:pointer;font-size:10px;font-weight:700;margin-top:3px;display:block;width:100%;">🔄 Verificar MP</button>`
              : '';
            return `<select data-pay-status="${o._id}" data-current="${ps}" style="${st}font-size:10px;font-weight:700;padding:4px 6px;border-radius:8px;cursor:pointer;max-width:140px;">
              ${opts.map(s => `<option value="${s}" ${s===ps?'selected':''}>${s}</option>`).join('')}
            </select>${verifyBtn}`;
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
  // 'Cancelado' removido dos tabs — pedidos cancelados nao listam mais
  // no modulo Pedidos nem no Dashboard. Veja em Relatorios pra historico.
  const statuses=['Todos','Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Reentrega'];
  const bairros=[...new Set(S.orders.map(o=>(o.deliveryNeighborhood||o.deliveryZone||'').trim()).filter(Boolean))].sort();

  return`
<!-- Filtro rapido por status (cancelados ocultos por padrao) -->
<div class="tabs" style="flex-wrap:wrap;gap:3px;margin-bottom:10px;">
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
    <span style="font-size:10px;font-weight:700;color:var(--muted);">📅 DATA (lançamento):</span>
    <button class="btn btn-sm ${fDate1===todayStr&&fDate2===todayStr?'btn-primary':'btn-ghost'}" id="btn-ped-hoje">Hoje</button>
    <button class="btn btn-sm ${fDate1===yesterdayStr&&fDate2===yesterdayStr?'btn-primary':'btn-ghost'}" id="btn-ped-ontem">Ontem</button>
    <input type="date" class="fi" id="ped-date1" value="${fDate1}" max="${todayStr}" style="width:140px;font-size:11px;"/>
    <span style="font-size:11px;color:var(--muted)">até</span>
    <input type="date" class="fi" id="ped-date2" value="${fDate2}" max="${todayStr}" style="width:140px;font-size:11px;"/>
    <span style="font-size:10px;color:var(--muted);font-style:italic;">(só datas passadas — pedidos lançados)</span>
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
    <div>
      <label style="font-size:10px;font-weight:700;color:var(--muted);display:block;margin-bottom:3px;">📦 TIPO</label>
      <select class="fi" id="ped-filter-tipo" style="font-size:11px;">
        <option value="">Todos</option>
        <option value="Delivery" ${fTipo==='Delivery'?'selected':''}>🚚 Entrega (Delivery)</option>
        <option value="Retirada" ${fTipo==='Retirada'?'selected':''}>📦 Retirada na loja</option>
        <option value="Balcao"   ${fTipo==='Balcao'  ?'selected':''}>🏪 Balcão</option>
      </select>
    </div>
  </div>
</div>

${(() => {
  // ── MOVIMENTACAO DE VENDAS DO DIA — SO admin e gerente ──
  // Tem filtro de dia proprio (default = hoje), independente dos
  // filtros da listagem principal.
  const r = String(S.user?.role||'').toLowerCase();
  const c = String(S.user?.cargo||'').toLowerCase();
  const podeVer = r === 'administrador' || r === 'gerente' || c === 'admin' || c === 'gerente';
  if (!podeVer) return '';
  const APROVADOS = new Set(['aprovado','pago','pago na entrega','recebido']);
  // Dia escolhido pelo admin (S._movDia). Default = hoje em Manaus.
  const movDia = S._movDia || todayStr;
  // Filtra pedidos lançados NO DIA escolhido + pagamento aprovado.
  const aprovados = filtrarUnidade(S.orders).filter(o =>
    o.status !== 'Cancelado' &&
    _dManaus(o.createdAt) === movDia &&
    APROVADOS.has(String(o.paymentStatus||'').toLowerCase().trim())
  );
  const totalAprovado = aprovados.reduce((s,o) => s + (Number(o.total)||0), 0);
  const ehHoje = movDia === todayStr;
  // Formata dia BR (DD/MM/YYYY)
  const [yy,mm,dd] = movDia.split('-');
  const movDiaBr = (yy && mm && dd) ? `${dd}/${mm}/${yy}` : movDia;
  // Breakdown por unidade — SEMPRE mostra as 3 lojas (CDLE / N. Aleixo /
  // Allegro), mesmo com 0 vendas. Outras unidades (ex: E-commerce) sao
  // adicionadas se aparecerem.
  const UNIDADES_FIXAS = [
    { slug: 'cdle',         label: 'CDLE',      cor: '#DC2626', bg: '#FEE2E2' },
    { slug: 'novo_aleixo',  label: 'N. Aleixo', cor: '#1D4ED8', bg: '#DBEAFE' },
    { slug: 'allegro',      label: 'Allegro',   cor: '#047857', bg: '#D1FAE5' },
  ];
  const porUnidade = {};
  // Inicializa as 3 fixas com 0
  UNIDADES_FIXAS.forEach(u => { porUnidade[u.slug] = { label: u.label, cor: u.cor, bg: u.bg, count: 0, total: 0 }; });
  for (const o of aprovados) {
    const slug = normalizeUnidade(o.saleUnit || o.unidade || o.unit) || 'outras';
    if (!porUnidade[slug]) {
      porUnidade[slug] = {
        label: labelUnidade(slug) || slug || 'Outras',
        cor: '#6B7280', bg: '#F3F4F6',
        count: 0, total: 0,
      };
    }
    porUnidade[slug].count++;
    porUnidade[slug].total += Number(o.total)||0;
  }
  // Ticket medio do dia
  const ticketMedio = aprovados.length ? totalAprovado / aprovados.length : 0;
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
      <div style="font-size:11px;color:#15803D;font-weight:700;letter-spacing:.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ✅ MOVIMENTAÇÃO DE VENDAS — ${ehHoje ? 'HOJE' : movDiaBr}
        <input type="date" id="mov-dia-filter" value="${movDia}" style="font-size:11px;padding:2px 6px;border:1px solid #BBF7D0;border-radius:5px;background:#fff;color:#15803D;font-weight:700;cursor:pointer;"/>
        ${!ehHoje ? `<button id="mov-dia-hoje" style="font-size:10px;padding:2px 8px;background:#15803D;color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;">⟲ Voltar pra Hoje</button>` : ''}
      </div>
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-size:26px;font-weight:900;color:#15803D;line-height:1.1;">${$c(totalAprovado)}</div>
          <div style="font-size:11px;color:#16A34A;">${aprovados.length} pedido${aprovados.length===1?'':'s'} confirmado${aprovados.length===1?'':'s'} em ${ehHoje ? 'hoje' : movDiaBr}</div>
        </div>
        <div style="border-left:2px dashed #BBF7D0;padding-left:12px;">
          <div style="font-size:9px;color:#16A34A;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">🎟️ Ticket Médio</div>
          <div style="font-size:18px;font-weight:900;color:#15803D;line-height:1.1;">${$c(ticketMedio)}</div>
          <div style="font-size:9px;color:#86EFAC;">por pedido confirmado</div>
        </div>
      </div>
    </div>
    <!-- Breakdown por unidade — sempre as 3 lojas + extras se houver -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${Object.values(porUnidade).sort((a,b) => b.total - a.total).map(v => {
        const eh0 = v.total === 0;
        return `
        <div style="background:${eh0?'#fff':v.bg};border:1px solid ${eh0?'#E5E7EB':v.cor+'66'};border-radius:8px;padding:8px 12px;min-width:130px;opacity:${eh0?0.6:1};">
          <div style="font-size:10px;color:${v.cor};font-weight:700;letter-spacing:.3px;">🏬 ${v.label}</div>
          <div style="font-size:16px;font-weight:900;color:${v.cor};line-height:1.1;">${$c(v.total)}</div>
          <div style="font-size:9px;color:${v.cor};opacity:.75;margin-top:2px;">${v.count} venda${v.count===1?'':'s'}${v.count>0?` · TM ${$c(v.total/v.count)}`:''}</div>
        </div>`;
      }).join('')}
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

// Expoe global pra inline onclick conseguir trocar de tab dentro do modal
// (event delegation no document nao alcanca porque o modal usa
// stopPropagation no .mo-box).
if (typeof window !== 'undefined') {
  window._switchOrderTab = function(tab, orderId) {
    try {
      const S = (window.__florevita_S) || null;
      // Pega S via import dinamico se nao tiver acesso global
      import('../state.js').then(m => {
        m.S._viewOrderTab = tab;
        // Re-chama showOrderViewModal pra recompor HTML + setTimeout/bindings
        showOrderViewModal(orderId);
      });
    } catch (e) { console.warn('[_switchOrderTab]', e); }
  };
}

// ── TAB DE LOGS: histórico de atividades do pedido ───────────
// Busca AuditLog filtrado por entityType='Order' + entityId=orderId.
// Mostra timeline: criação, mudanças de status, aprovação pagamento,
// expedição, entrega, edições, etc — quem fez e quando.
function renderOrderLogsTab(o) {
  // Carga sob demanda com TTL de 10s (atualizacao rapida — eventos MP
  // recem-chegados aparecem assim que o modal eh reaberto/abre tab Logs).
  const oid = String(o._id);
  if (!S._orderLogs) S._orderLogs = {};
  if (!S._orderLogsAt) S._orderLogsAt = {};
  const last = S._orderLogsAt[oid] || 0;
  const isStale = (Date.now() - last) > 10000;
  if (!Array.isArray(S._orderLogs[oid]) || isStale) {
    if (!Array.isArray(S._orderLogs[oid])) S._orderLogs[oid] = [];
    S._orderLogsAt[oid] = Date.now();
    GET(`/audit-logs?entityId=${oid}&limit=200`).then(r => {
      const logs = Array.isArray(r) ? r : (r?.logs || r?.data || []);
      S._orderLogs[oid] = Array.isArray(logs) ? logs : [];
      import('../main.js').then(m => m.render()).catch(()=>{});
    }).catch(()=>{ if (!Array.isArray(S._orderLogs[oid])) S._orderLogs[oid] = []; });
  }
  const logs = S._orderLogs[oid] || [];

  // Eventos "implicitos" (extraidos do proprio order, mesmo sem AuditLog).
  // Marcia (20/05): timeline deve mostrar QUEM lançou a venda, QUEM aprovou
  // o pagamento, alteracoes etc.
  const implicitos = [];

  // ✨ CRIAÇÃO — usa criadoPorNome (campo novo, salvo no backend)
  if (o.createdAt) {
    const quemCriou = o.criadoPorNome || o.createdByName || o.vendedorNome || o.criadoPor || o.createdBy || '—';
    implicitos.push({
      tipo: 'criacao', icon: '✨', cor: '#9F1239',
      titulo: 'Pedido criado',
      quem: quemCriou,
      quando: o.createdAt,
      detalhe: `Origem: ${o.source || 'WhatsApp'} · Canal: ${o.salesChannel || o.source || '—'} · Valor inicial: ${(o.total||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}${o.criadoPorEmail?` · ${o.criadoPorEmail}`:''}`,
    });
  }

  // 💳 APROVAÇÃO DE PAGAMENTO
  if (o.paymentApprovedAt && o.paymentApprovedByName) {
    implicitos.push({
      tipo: 'pagamento', icon: '💳', cor: '#15803D',
      titulo: 'Pagamento aprovado',
      quem: o.paymentApprovedByName,
      quando: o.paymentApprovedAt,
      detalhe: `Status: ${o.paymentStatus || 'Aprovado'} · Forma: ${o.payment || '—'}${o.paymentApprovedByEmail?` · ${o.paymentApprovedByEmail}`:''}`,
    });
  } else if (o.paymentApprovedAt) {
    // Fallback: tem timestamp mas sem nome (pedidos legados)
    implicitos.push({
      tipo: 'pagamento', icon: '💳', cor: '#15803D',
      titulo: 'Pagamento aprovado',
      quem: '— (legado, sem registro)',
      quando: o.paymentApprovedAt,
      detalhe: `Status: ${o.paymentStatus || 'Aprovado'}`,
    });
  }

  if (o.montadorNome && o.montadoEm) {
    implicitos.push({
      tipo: 'producao', icon: '🌸', cor: '#92400E',
      titulo: 'Marcado como Pronto (montagem concluída)',
      quem: o.montadorNome, quando: o.montadoEm,
      detalhe: o.montadorEmail ? `Email: ${o.montadorEmail}` : 'Montagem finalizada na produção.',
    });
  }
  if (o.expedidorNome && o.expedidoEm) {
    implicitos.push({
      tipo: 'expedicao', icon: '📦', cor: '#1E40AF',
      titulo: 'Expedido (Saiu p/ entrega)',
      quem: o.expedidorNome, quando: o.expedidoEm,
      detalhe: o.driverName ? `Entregador atribuído: ${o.driverName}${o.assignedDeliveryFee?` · Taxa: R$ ${Number(o.assignedDeliveryFee).toFixed(2)}`:''}` : 'Pedido expedido.',
    });
  }
  if (o.status === 'Entregue' && (o.deliveredAt || o.updatedAt)) {
    implicitos.push({
      tipo: 'entrega', icon: '✅', cor: '#15803D',
      titulo: 'Entregue ao destinatário',
      quem: o.driverName || '—', quando: o.deliveredAt || o.updatedAt,
      detalhe: 'Entrega confirmada.',
    });
  }
  if (o.expedicaoCanceladaEm) {
    implicitos.push({
      tipo: 'expedCancelada', icon: '↩️', cor: '#D97706',
      titulo: 'Expedição cancelada',
      quem: o.expedicaoCanceladaPor || '—',
      quando: o.expedicaoCanceladaEm,
      detalhe: o.expedicaoCanceladaMotivo || 'Sem motivo informado.',
    });
  }
  if (o.status === 'Cancelado') {
    implicitos.push({
      tipo: 'cancelamento', icon: '🚫', cor: '#991B1B',
      titulo: 'Pedido cancelado',
      quem: o.canceladoPor || '—', quando: o.canceladoEm || o.updatedAt,
      detalhe: o.motivoCancelamento || 'Motivo não registrado.',
    });
  }

  // ── AUDIT LOGS DO BACKEND ─────────────────────────────────────
  // Helper pra formatar valores no diff (status/paymentStatus/etc)
  const _fmtVal = (v) => {
    if (v === null || v === undefined || v === '') return '∅';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
    return String(v).slice(0, 80);
  };
  // Labels pra campos do pedido
  const _campoLabel = {
    status:'Status', paymentStatus:'Status do Pagamento', payment:'Forma de Pagamento',
    paymentOnDelivery:'Pgto na entrega', trocoPara:'Troco para',
    total:'Total (R$)', subtotal:'Subtotal (R$)', discount:'Desconto (R$)', deliveryFee:'Taxa de entrega',
    scheduledDate:'Data de entrega', scheduledPeriod:'Período', scheduledTime:'Horário',
    recipient:'Destinatário', recipientPhone:'Tel. destinatário',
    cardMessage:'Mensagem do cartão', notes:'Observações',
    deliveryAddress:'Endereço', deliveryStreet:'Rua', deliveryNumber:'Número',
    deliveryNeighborhood:'Bairro', deliveryCity:'Cidade',
    clientName:'Cliente', clientPhone:'Tel. cliente',
    driverName:'Entregador', driverEmail:'Email do entregador',
    type:'Tipo', pickupUnit:'Loja de retirada', saleUnit:'Unidade de venda',
    items:'Itens',
  };

  const auditEntries = logs.map(l => {
    const act = String(l.action||'').toLowerCase();
    let icon = '📝', cor = '#6B7280', titulo = `${l.action||'Ação'}`;
    if (act === 'create') { icon = '✨'; cor = '#9F1239'; titulo = 'Pedido criado'; }
    else if (act === 'update' || act === 'edit_order') { icon = '✏️'; cor = '#1E40AF'; titulo = 'Pedido editado'; }
    else if (act === 'delete') { icon = '🗑️'; cor = '#991B1B'; titulo = 'Pedido excluído'; }
    else if (act === 'view') { icon = '👁️'; cor = '#6B7280'; titulo = 'Pedido visualizado'; }
    // ── EVENTOS DO MERCADO PAGO ──────────────────────────────
    else if (act === 'mp_link_generated') {
      icon = '🔗'; cor = '#009EE3';
      titulo = 'Link de pagamento gerado (Mercado Pago)';
    }
    else if (act === 'mp_payment_approved') {
      icon = '✅'; cor = '#15803D';
      titulo = l.meta?.source === 'webhook'
        ? 'Pagamento aprovado (via webhook MP)'
        : 'Pagamento aprovado (Mercado Pago)';
    }
    else if (act === 'mp_payment_rejected') {
      icon = '❌'; cor = '#991B1B';
      titulo = 'Pagamento recusado (Mercado Pago)';
    }

    // Detecta diffs (formato novo: meta.diff=[{campo,de,para}])
    let detalheHtml = '';
    const diffs = Array.isArray(l.meta?.diff) ? l.meta.diff : [];
    if (diffs.length) {
      const linhas = diffs.map(d => {
        const lbl = _campoLabel[d.campo] || d.campo;
        return `<div style="font-size:11px;margin:2px 0;"><strong>${lbl}:</strong> <span style="text-decoration:line-through;color:#9CA3AF;">${_fmtVal(d.de)}</span> <span style="color:#6B7280;">→</span> <strong style="color:#15803D;">${_fmtVal(d.para)}</strong></div>`;
      }).join('');
      detalheHtml = linhas;
    }
    // Formato legado: meta.changes ou changes.before/after
    if (!detalheHtml) {
      const ch = l.meta?.changes || l.changes;
      if (ch && typeof ch === 'object' && ch.before && ch.after) {
        const linhas = [];
        for (const k of Object.keys(ch.after)) {
          const v1 = ch.before[k], v2 = ch.after[k];
          if (JSON.stringify(v1) === JSON.stringify(v2)) continue;
          const lbl = _campoLabel[k] || k;
          linhas.push(`<div style="font-size:11px;margin:2px 0;"><strong>${lbl}:</strong> <span style="text-decoration:line-through;color:#9CA3AF;">${_fmtVal(v1)}</span> → <strong style="color:#15803D;">${_fmtVal(v2)}</strong></div>`);
        }
        if (linhas.length) detalheHtml = linhas.join('');
      }
    }
    // Sem diff útil, mostra meta.motivo/note se existir
    if (!detalheHtml) {
      if (l.meta?.motivo) detalheHtml = `<div style="font-size:11px;">Motivo: ${esc(String(l.meta.motivo))}</div>`;
      else if (l.meta?.note) detalheHtml = `<div style="font-size:11px;">${esc(String(l.meta.note))}</div>`;
    }
    // Detalhes especiais para eventos MP — mostra ID da transação destacado
    if (act.startsWith('mp_') && l.meta) {
      const m = l.meta;
      const linhas = [];
      if (m.preferenceId) linhas.push(`<div style="font-size:11px;"><strong>ID Preferência MP:</strong> <code style="background:#EFF6FF;color:#1E40AF;padding:1px 6px;border-radius:4px;font-family:Monaco,monospace;font-size:10px;">${esc(String(m.preferenceId))}</code></div>`);
      if (m.mpPaymentId) linhas.push(`<div style="font-size:11px;"><strong>ID Transação MP:</strong> <code style="background:#DCFCE7;color:#15803D;padding:1px 6px;border-radius:4px;font-family:Monaco,monospace;font-size:10px;font-weight:700;">${esc(String(m.mpPaymentId))}</code></div>`);
      if (m.paymentMethod) linhas.push(`<div style="font-size:11px;"><strong>Método:</strong> ${esc(String(m.paymentMethod))}</div>`);
      if (m.total != null) linhas.push(`<div style="font-size:11px;"><strong>Valor:</strong> R$ ${Number(m.total).toFixed(2).replace('.',',')}</div>`);
      if (m.source) linhas.push(`<div style="font-size:10px;color:var(--muted);font-style:italic;">Fonte: ${esc(String(m.source))}</div>`);
      if (linhas.length) detalheHtml = linhas.join('');
    }
    return {
      tipo: act, icon, cor, titulo,
      quem: l.userName || '—', quando: l.createdAt,
      detalheHtml,
      ip: l.ip, device: l.device,
    };
  });

  // Mescla + ordena por data desc
  const todos = [...implicitos, ...auditEntries].filter(e => e.quando)
    .sort((a,b) => new Date(b.quando) - new Date(a.quando));

  if (todos.length === 0) {
    return `<div class="empty card" style="padding:40px;text-align:center;">
      <div style="font-size:48px;margin-bottom:10px;">📜</div>
      <p style="font-weight:600;">Sem logs registrados ainda</p>
      <p style="font-size:11px;color:var(--muted);margin-top:6px;">
        ${S._orderLogs[oid] === undefined ? 'Carregando histórico...' : 'A partir de agora, todas as alterações deste pedido serão registradas aqui.'}
      </p>
    </div>`;
  }

  const fmtDT = (ts) => {
    try { return new Date(ts).toLocaleString('pt-BR',{timeZone:'America/Manaus',dateStyle:'short',timeStyle:'short'}); }
    catch { return '—'; }
  };

  return `<div class="card" style="padding:0;">
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);background:linear-gradient(135deg,#EFF6FF,#fff);">
      <strong style="color:#1E3A8A;">📜 Histórico de Atividades</strong>
      <span style="font-size:11px;color:var(--muted);margin-left:8px;">${todos.length} evento(s)</span>
    </div>
    <div style="position:relative;padding:20px;">
      ${todos.map((e, i) => `
        <div style="display:flex;gap:14px;padding-bottom:18px;position:relative;">
          <!-- Bolinha + linha vertical -->
          <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:center;">
            <div style="width:36px;height:36px;border-radius:50%;background:${e.cor};color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;box-shadow:0 2px 6px ${e.cor}55;">${e.icon}</div>
            ${i < todos.length - 1 ? `<div style="width:2px;flex:1;background:${e.cor}33;margin-top:4px;min-height:24px;"></div>` : ''}
          </div>
          <!-- Conteudo -->
          <div style="flex:1;background:#fff;border:1px solid ${e.cor}33;border-left:4px solid ${e.cor};border-radius:10px;padding:10px 14px;margin-bottom:4px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
              <div style="font-weight:700;color:${e.cor};font-size:13px;">${e.titulo}</div>
              <div style="font-size:10px;color:var(--muted);white-space:nowrap;">${fmtDT(e.quando)}</div>
            </div>
            <div style="font-size:11px;color:var(--ink2);margin-top:4px;">
              <span style="color:var(--muted);">por</span> <strong>${esc(e.quem)}</strong>
              ${e.ip ? ` <span style="color:var(--muted);">· IP ${esc(e.ip)}</span>` : ''}
              ${e.device ? ` <span style="color:var(--muted);">· ${esc(e.device)}</span>` : ''}
            </div>
            ${e.detalheHtml ? `<div style="font-size:12px;color:#374151;margin-top:6px;background:#FAFAFA;padding:8px 10px;border-radius:6px;border:1px dashed #E5E7EB;">${e.detalheHtml}</div>` : (e.detalhe ? `<div style="font-size:12px;color:#374151;margin-top:6px;background:#FAFAFA;padding:6px 10px;border-radius:6px;border:1px dashed #E5E7EB;">${esc(e.detalhe)}</div>` : '')}
          </div>
        </div>
      `).join('')}
    </div>
  </div>`;
}

// ── VISUALIZAR PEDIDO (FULLSCREEN com 2 tabs: Detalhes + Logs) ────
// Marcia (20/05): visualizar pedido em tela inteira com aba de logs
// mostrando criação, mudanças de status, aprovação de pagamento,
// expedição, entrega — quem fez e quando.
export function showOrderViewModal(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('❌ Pedido não encontrado');

  const statusColors = {
    'Aguardando':'#F1F5F9','Em preparo':'#FEF3C7','Pronto':'#DBEAFE',
    'Saiu p/ entrega':'#EDE9FE','Entregue':'#D1FAE5','Cancelado':'#FEE2E2'
  };
  const bgColor = statusColors[o.status]||'#F9FAFB';

  // Tab ativa: 'detalhes' (default) ou 'logs'
  const aba = S._viewOrderTab || 'detalhes';

  // CSS fullscreen — sobrescreve .mo/.mo-box default (popup pequeno)
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';S._viewOrderTab='';S._orderLogs=null;render();}" style="background:rgba(0,0,0,.7);">
  <div class="mo-box" style="max-width:1100px;width:96%;height:94vh;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;padding:0;" onclick="event.stopPropagation()">

  <!-- HEADER FIXO -->
  <div style="padding:16px 22px 0;background:linear-gradient(135deg,#FAE8E6,#fff);border-bottom:1px solid var(--border);">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:22px;color:var(--rose);">Pedido ${fmtOrderNum(o)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px;">${$d(o.createdAt)} · ${o.unit||'—'} · ${o.client?.name||o.clientName||'—'} → ${o.recipient||'—'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="tag ${sc(o.status)}" style="font-size:12px;">${o.status}</span>
        <button onclick="S._modal='';S._viewOrderTab='';S._orderLogs=null;render();" style="background:#fff;border:1px solid #D1D5DB;font-size:18px;cursor:pointer;color:#374151;width:32px;height:32px;border-radius:50%;">×</button>
      </div>
    </div>
    <!-- Tabs -->
    <div style="display:flex;gap:4px;">
      <button onclick="window._switchOrderTab('detalhes','${o._id}')" style="background:${aba==='detalhes'?'#9F1239':'transparent'};color:${aba==='detalhes'?'#fff':'#9F1239'};border:none;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;border-radius:8px 8px 0 0;">📋 Detalhes do Pedido</button>
      <button onclick="window._switchOrderTab('logs','${o._id}')" style="background:${aba==='logs'?'#1E40AF':'transparent'};color:${aba==='logs'?'#fff':'#1E40AF'};border:none;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;border-radius:8px 8px 0 0;">📜 Histórico / Logs</button>
    </div>
  </div>

  <!-- CONTEUDO ROLAVEL -->
  <div id="vo-body" style="flex:1;overflow-y:auto;padding:22px;background:#FAFAFA;">

  ${aba === 'logs' ? renderOrderLogsTab(o) : `

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
    ${o.discount?`<div style="background:#DCFCE7;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">🟢 Desconto</div>
      <div style="font-weight:700;font-size:15px;color:#15803D">-${$c(o.discount)}</div>
    </div>`:''}
    ${o.surcharge?`<div style="background:#FEF3C7;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;margin-bottom:4px;">🔴 Acréscimo</div>
      <div style="font-weight:700;font-size:15px;color:#B45309">+${$c(o.surcharge)}</div>
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

  `}

  </div>
  <!-- FOOTER FIXO -->
  <div class="mo-foot" style="padding:14px 22px;border-top:1px solid var(--border);background:#fff;flex-shrink:0;flex-wrap:wrap;">
    <button class="btn btn-primary" onclick="window._tryEditOrder('${o._id}')">✏️ Editar Pedido</button>
    <button class="btn btn-ghost" onclick="printComanda('${o._id}')">🖨️ Comanda</button>
    <button class="btn btn-ghost" onclick="printCard('${o._id}')">💌 Cartão</button>
    ${(() => {
      // Botao "Cancelar Expedicao" — admin/gerente, pedido nao-finalizado.
      // Cobre tres cenarios:
      //  1) driver designado (driverId/Name/BackendId/assignedDriverName)
      //  2) status 'Saiu p/ entrega' (ja em rota)
      //  3) status 'Pronto' (expedicao em fase de atribuir entregador)
      // Bloqueado em: Entregue ou Cancelado.
      const r = String(S.user?.role||'').toLowerCase();
      const c = String(S.user?.cargo||'').toLowerCase();
      const podeVer = r === 'administrador' || r === 'gerente' || c === 'admin' || c === 'gerente';
      if (!podeVer) return '';
      if (o.status === 'Entregue' || o.status === 'Cancelado') return '';
      const temAlgumaCoisaDeExpedicao = !!(o.driverId || o.driverName || o.driverBackendId || o.assignedDriverName || o.expedidorId);
      const ehStatusExpedivel = ['Pronto','Saiu p/ entrega'].includes(o.status);
      if (!temAlgumaCoisaDeExpedicao && !ehStatusExpedivel) return '';
      return `<button class="btn btn-ghost" style="color:#92400E;border-color:#F59E0B;background:#FEF3C7;" onclick="window.confirmCancelExpedicao('${o._id}')">🚫 Cancelar Expedição</button>`;
    })()}
    ${(S.user?.role==='Administrador' || S.user?.cargo==='admin') ? `<button class="btn btn-ghost" style="color:var(--red);border-color:var(--red);" onclick="window._tryDeleteOrder('${o._id}','${(o.orderNumber||'').replace(/'/g,'')}')">🗑️ Excluir</button>` : ''}
    <button class="btn btn-ghost" id="btn-mo-close-view">Fechar</button>
  </div>
  </div></div>`;

  render();
  setTimeout(()=>{
    document.getElementById('btn-mo-close-view')?.addEventListener('click',()=>{S._modal='';S._viewOrderTab='';S._orderLogs=null;render();});
    // Tabs Detalhes / Logs
    document.querySelectorAll('[data-vo-tab]').forEach(b => {
      b.onclick = () => { S._viewOrderTab = b.dataset.voTab; render(); };
    });
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
  const itemRows = (o.items||[]).map((it,i)=>{
    // Polaroid / produtos com foto do cliente — destaca abaixo do item
    const fotos = Array.isArray(it.userPhotos) ? it.userPhotos.filter(p => typeof p === 'string' && p.startsWith('data:')) : [];
    const numStr = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
    const fotosHtml = fotos.length ? `
    <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:10px;margin-top:-2px;margin-bottom:8px;margin-left:44px;">
      <div style="font-size:11px;font-weight:800;color:#92400E;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
        📸 Fotos enviadas pelo cliente (${fotos.length})
        <span style="font-size:9.5px;font-weight:600;color:#B45309;background:#FEF9C3;padding:1px 6px;border-radius:4px;">imprimir polaroid</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;">
        ${fotos.map((p, idx) => `
          <div style="position:relative;aspect-ratio:3/4;border-radius:6px;overflow:hidden;border:2px solid #D97706;background:#fff;">
            <img src="${p}" loading="lazy" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in;" onclick="showFullImg && showFullImg('${p.replace(/'/g, "\\'")}')"/>
            <a href="${p}" download="polaroid_${numStr}_foto${idx+1}.jpg" style="position:absolute;bottom:0;left:0;right:0;background:rgba(217,119,6,.95);color:#fff;text-align:center;font-size:9.5px;font-weight:700;padding:3px 0;text-decoration:none;">⬇ baixar</a>
          </div>
        `).join('')}
      </div>
      <div style="font-size:10px;color:#92400E;margin-top:6px;font-style:italic;text-align:center;">Clique pra ampliar · "⬇ baixar" salva no computador</div>
    </div>` : '';
    return `
  <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--cream);border-radius:8px;margin-bottom:6px;">
    <div class="av" style="width:36px;height:36px;font-size:14px;background:var(--rose-l);color:var(--rose);flex-shrink:0;">${it.qty}</div>
    <div style="flex:1;font-size:13px;font-weight:600">${it.name}${fotos.length?` <span style="font-size:10px;color:#D97706;font-weight:700;">📸 ${fotos.length}</span>`:''}</div>
    <div style="font-size:12px;color:var(--muted);white-space:nowrap">${$c(it.totalPrice||it.price*it.qty||0)}</div>
    <input type="number" class="fi eo-qty" data-idx="${i}" value="${it.qty}" min="1"
      style="width:60px;padding:5px 8px;font-size:12px;" title="Qtd"/>
    <button class="btn btn-red btn-xs eo-remove-item" data-idx="${i}" title="Remover">✕</button>
  </div>
  ${fotosHtml}`;
  }).join('');

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
    <div class="fg"><label class="fl">Tipo de Pedido <span style="color:var(--rose);font-size:10px;">(troca Delivery ↔ Retirada)</span></label>
      <select class="fi" id="eo-type">
        ${['Delivery','Retirada','Balcão'].map(t=>`<option value="${t}" ${(o.type||'Delivery')===t?'selected':''}>${t==='Delivery'?'🚚':t==='Retirada'?'📦':'🏪'} ${t}</option>`).join('')}
      </select>
    </div>
    <div class="fg" id="eo-pickup-wrap" style="${(o.type||'Delivery')==='Retirada'?'':'display:none;'}">
      <label class="fl">Loja de Retirada</label>
      <select class="fi" id="eo-pickup-unit">
        ${[
          {v:'',label:'— selecione —'},
          {v:'novo_aleixo',label:'🌸 Loja Novo Aleixo'},
          {v:'allegro',    label:'🌸 Loja Allegro Mall'},
          {v:'cdle',       label:'🏭 CDLE'},
        ].map(p=>`<option value="${p.v}" ${(o.pickupUnit||'')===p.v?'selected':''}>${p.label}</option>`).join('')}
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
    ${o.scheduledPeriod === 'Horário específico' ? `
    <div class="fg" style="grid-column:span 2;">
      <label class="fl">Horário Específico (intervalo) <span style="font-size:10px;color:var(--muted);">(ex: Entre 10:00 e 11:00)</span></label>
      <div class="fr2">
        <div>
          <label class="fl" style="font-size:10px;">Das</label>
          <input class="fi" type="time" id="eo-time-from" value="${o.scheduledTime||''}" placeholder="--:--"/>
        </div>
        <div>
          <label class="fl" style="font-size:10px;">Até</label>
          <input class="fi" type="time" id="eo-time-to" value="${o.scheduledTimeEnd||''}" placeholder="--:--"/>
        </div>
      </div>
    </div>
    ` : `
    <div class="fg"><label class="fl">Horário (opcional)</label>
      <input class="fi" type="time" id="eo-time-from" value="${o.scheduledTime||''}" placeholder="--:--"/>
    </div>
    `}
    <div class="fg" style="grid-column:span 2;">
      <label class="fl">🛒 Unidade de Venda <span style="color:var(--muted);font-size:10px;">(loja que VENDEU o pedido — afeta relatórios)</span></label>
      <select class="fi" id="eo-sale-unit">
        ${(() => {
          const cur = String(o.saleUnit || '').trim();
          const opts = [
            { v: '',                   l: '— manter (' + (cur || 'não definido') + ')' },
            { v: 'CDLE',               l: '🏭 CDLE' },
            { v: 'Loja Novo Aleixo',   l: '🌸 Loja Novo Aleixo' },
            { v: 'Loja Allegro Mall',  l: '🌸 Loja Allegro Mall' },
            { v: 'E-commerce',         l: '🌐 E-commerce / Site' },
          ];
          return opts.map(op => `<option value="${op.v}" ${cur === op.v ? 'selected' : ''}>${op.l}</option>`).join('');
        })()}
      </select>
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
    <div class="fg"><label class="fl">🟢 Desconto (R$)</label>
      <input class="fi" type="number" id="eo-discount" value="${o.discount||0}" min="0" step="0.50"/>
    </div>
    <div class="fg"><label class="fl">🔴 Acréscimo (R$)</label>
      <input class="fi" type="number" id="eo-surcharge" value="${o.surcharge||0}" min="0" step="0.50"/>
    </div>
    <div class="fg"><label class="fl">Total do Pedido (R$) <span style="color:var(--muted);font-size:10px;">(auto-recalc)</span></label>
      <input class="fi" type="number" id="eo-total" value="${o.total||0}" step="0.10"/>
    </div>
  </div>

  ${(() => {
    // ── Trocar VENDEDOR (admin/gerente) ──
    // Marcia (02/jun/2026): pos-venda, admin pode corrigir quem
    // foi o vendedor do pedido (afeta relatorio de comissao/atendente).
    const r0 = String(S.user?.role||'').toLowerCase();
    const c0 = String(S.user?.cargo||'').toLowerCase();
    const podeEditarVend = r0 === 'administrador' || r0 === 'gerente' || c0 === 'admin' || c0 === 'gerente';
    if (!podeEditarVend) return '';
    const vendedores = getColabs().filter(x => x.active !== false && x.cargo !== 'Entregador')
      .sort((a,b) => String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
    const vendAtualNome = String(o.createdByName || o.criadoPorNome || o.vendedorNome || '');
    const vendAtualId   = String(o.createdById   || o.criadoPorId   || o.vendedorId   || '');
    return `
    <div style="background:linear-gradient(135deg,#FAF5FF,#fff);border:1px solid #DDD6FE;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;color:#5B21B6;margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        👤 Vendedor / Atendente <span style="font-size:10px;font-weight:600;color:#7C3AED;background:#EDE9FE;padding:2px 8px;border-radius:8px;">só admin/gerente</span>
      </div>
      <select class="fi" id="eo-vendedor" style="font-size:13px;">
        <option value="">— Sem vendedor atribuído —</option>
        ${vendedores.map(v => {
          const vid = String(v.backendId || v._id || v.id || '');
          const selected = (vid && vid === vendAtualId) || (String(v.name||'') === vendAtualNome);
          return `<option value="${vid}" data-name="${esc(v.name||'')}" data-email="${esc(v.email||'')}" data-cargo="${esc(v.cargo||'')}" ${selected?'selected':''}>${esc(v.name)} — ${esc(v.cargo||'—')}</option>`;
        }).join('')}
      </select>
      <div style="font-size:10px;color:#5B21B6;margin-top:6px;font-style:italic;">
        Corrige quem foi o atendente do pedido (afeta relatórios de vendas/comissão).
      </div>
    </div>`;
  })()}

  ${(() => {
    // ── Trocar ENTREGADOR (admin/gerente, qualquer status) ──
    // Marcia (20/05): so admin/gerente pode trocar entregador via modal.
    // Pode trocar MESMO depois de "Entregue" — pra correcao de relatorio.
    const r = String(S.user?.role||'').toLowerCase();
    const c = String(S.user?.cargo||'').toLowerCase();
    const podeEditar = r === 'administrador' || r === 'gerente' || c === 'admin' || c === 'gerente';
    if (!podeEditar) return '';
    // Lista entregadores ativos
    const entregadores = getColabs().filter(c => c.cargo === 'Entregador' && c.active !== false)
      .sort((a,b) => String(a.name||'').localeCompare(String(b.name||''),'pt-BR'));
    const driverAtualId = String(o.driverBackendId || o.driverId || o.driverColabId || '');
    const driverAtualNome = String(o.driverName || '');
    return `
    <div style="background:linear-gradient(135deg,#EFF6FF,#fff);border:1px solid #BFDBFE;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;color:#1E3A8A;margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        🚚 Entregador Responsável <span style="font-size:10px;font-weight:600;color:#3B82F6;background:#DBEAFE;padding:2px 8px;border-radius:8px;">só admin/gerente</span>
      </div>
      <select class="fi" id="eo-driver" style="font-size:13px;">
        <option value="">— Sem entregador atribuído —</option>
        ${entregadores.map(e => {
          const eid = String(e.backendId || e._id || e.id || '');
          const selected = eid === driverAtualId || String(e.name||'') === driverAtualNome;
          return `<option value="${eid}" data-name="${esc(e.name||'')}" data-email="${esc(e.email||'')}" data-fee="${e.metas?.valorEntrega || 0}" ${selected?'selected':''}>${esc(e.name)}${e.metas?.valorEntrega?` — R$ ${Number(e.metas.valorEntrega).toFixed(2)}/entrega`:''}</option>`;
        }).join('')}
      </select>
      <div style="font-size:10px;color:#1E40AF;margin-top:6px;font-style:italic;">
        ${o.status === 'Entregue' ? '⚠️ Pedido já entregue — alterar entregador só corrige histórico/relatórios (não dispara nova entrega).' : 'Ao salvar, atualiza driver/taxa de entrega e recalcula total se a taxa mudar.'}
      </div>
    </div>`;
  })()}

  ${(() => {
    // ── Modo de pagamento da RETIRADA (admin/gerente edita pos-venda) ──
    // Aparece SO se tipo=Retirada. Permite trocar entre: Pago, Total na
    // retirada, 50% agora+depois. Bug reportado: cliente mudou apos lançar
    // e nao era possivel editar pelo modal.
    if ((o.type||'Delivery') !== 'Retirada') return '<div id="eo-pickup-pay-wrap" style="display:none;"></div>';
    // Detecta modo atual via paymentStatus
    const ps = String(o.paymentStatus||'').trim();
    let modoAtual = o.pickupPayMode || '';
    if (!modoAtual) {
      if (ps === 'Aprovado' || ps === 'Pago' || ps === 'Recebido') modoAtual = 'pago';
      else if (ps.toLowerCase().includes('retirada')) modoAtual = 'total_retirada';
      else if (ps.toLowerCase().includes('parcial')) modoAtual = 'parcial';
    }
    const opts = [
      { k:'pago',            l:'✅ Pago (cliente ja pagou tudo)' },
      { k:'total_retirada',  l:'🏪 Total na retirada (paga ao retirar)' },
      { k:'parcial',         l:'💳 50% agora + 50% depois' },
    ];
    return `
    <div id="eo-pickup-pay-wrap" style="background:linear-gradient(135deg,#FAE8E6,#FEF3C7);border-radius:10px;padding:12px 14px;border:1px solid #FCD34D;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;color:#92400E;margin-bottom:8px;">📦 Modo de pagamento da Retirada</div>
      <select class="fi" id="eo-pickup-paymode" style="font-size:13px;">
        ${opts.map(op => `<option value="${op.k}" ${modoAtual===op.k?'selected':''}>${op.l}</option>`).join('')}
      </select>
      <div style="font-size:10px;color:#78350F;margin-top:6px;font-style:italic;">Ao salvar, atualiza tambem o status de pagamento e a comanda do cliente.</div>
    </div>`;
  })()}

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

    // Helper: recalcula o total do pedido a partir dos itens.
    // Mantem desconto e taxa de entrega (deliveryFee) atuais.
    // BUG REPORTADO: adicionar/remover itens nao atualizava total.
    const _recalcTotal = () => {
      const subtotal = (o.items||[]).reduce((s, it) => {
        const price = Number(it.price || it.unitPrice || 0);
        const qty = Number(it.qty || 1);
        // Se item ja tem totalPrice gravado e bate com qty*price, usa ele
        // (preserva customizacoes manuais que possam existir).
        const tp = Number(it.totalPrice || 0);
        if (tp && Math.abs(tp - price*qty) < 0.01) return s + tp;
        return s + (price * qty);
      }, 0);
      const desconto = Number(document.getElementById('eo-discount')?.value) || Number(o.discount) || 0;
      const acrescimo = Number(document.getElementById('eo-surcharge')?.value) || Number(o.surcharge) || 0;
      const taxa = Number(o.deliveryFee || o.taxaEntrega || 0);
      o.total = Math.max(0, subtotal - desconto + acrescimo + taxa);
    };

    // Atualiza qty dos itens em tempo real -> recalcula total no input
    document.querySelectorAll('.eo-qty').forEach(inp => inp.addEventListener('input', () => {
      const idx = parseInt(inp.dataset.idx);
      const newQty = Math.max(1, parseInt(inp.value) || 1);
      const items = [...(o.items||[])];
      if (items[idx]) {
        items[idx].qty = newQty;
        items[idx].totalPrice = (items[idx].price || 0) * newQty;
        o.items = items;
        _recalcTotal();
        const tot = document.getElementById('eo-total');
        if (tot) tot.value = o.total.toFixed(2);
      }
    }));

    // Remover item — recalcula total
    document.querySelectorAll('.eo-remove-item').forEach(btn=>btn.addEventListener('click',()=>{
      const idx=parseInt(btn.dataset.idx);
      const items=[...(o.items||[])];
      items.splice(idx,1);
      o.items=items;
      _recalcTotal();
      showEditOrderModal(orderId); // re-abre com itens atualizados (mostra novo total)
    }));

    // Desconto altera -> recalcula total
    document.getElementById('eo-discount')?.addEventListener('input', () => {
      _recalcTotal();
      const tot = document.getElementById('eo-total');
      if (tot) tot.value = o.total.toFixed(2);
    });
    // Acréscimo altera -> recalcula total
    document.getElementById('eo-surcharge')?.addEventListener('input', () => {
      _recalcTotal();
      const tot = document.getElementById('eo-total');
      if (tot) tot.value = o.total.toFixed(2);
    });

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
        if (ex) {
          ex.qty++;
          ex.totalPrice = (ex.price || price) * ex.qty;
        } else {
          items.push({
            product: pid,
            name,
            price,
            qty: 1,
            totalPrice: price,
            code: prod.code || prod.sku || '',
            category: prod.category || prod.categoria || '',
          });
        }
        o.items = items;
        _recalcTotal(); // atualiza o.total apos addItem
        showEditOrderModal(orderId); // re-abre com novo item (e novo total)
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

    // Toggle pickup-unit conforme tipo selecionado
    document.getElementById('eo-type')?.addEventListener('change', (e) => {
      const isRetirada = e.target.value === 'Retirada';
      const wrap = document.getElementById('eo-pickup-wrap');
      if (wrap) wrap.style.display = isRetirada ? '' : 'none';
    });

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

      // ── TIPO DE PEDIDO: Delivery / Retirada / Balcão ──
      // Trocar o tipo afeta tambem a unidade operacional:
      //   - Delivery -> unidade=cdle (CDLE produz e entrega)
      //   - Retirada -> unidade = pickupUnit selecionada
      //   - Balcão   -> mantem saleUnit
      const tipoNovo = document.getElementById('eo-type')?.value || o.type || 'Delivery';
      const pickupUnitNovo = document.getElementById('eo-pickup-unit')?.value || '';
      let unidadeNova = o.unidade || o.unit || '';
      let unitLabelNovo = o.unit || '';
      if (tipoNovo === 'Delivery') {
        unidadeNova = 'cdle';
        unitLabelNovo = 'CDLE';
      } else if (tipoNovo === 'Retirada' && pickupUnitNovo) {
        unidadeNova = pickupUnitNovo;
        unitLabelNovo = ({novo_aleixo:'Loja Novo Aleixo', allegro:'Loja Allegro Mall', cdle:'CDLE'})[pickupUnitNovo] || pickupUnitNovo;
      }

      // ── MODO DE PAGAMENTO DA RETIRADA (se Retirada) ──
      // Atualiza paymentStatus de acordo. Bug reportado: cliente mudou
      // forma de pagamento depois de lancado e nao era possivel editar.
      const pickupPayModeNovo = document.getElementById('eo-pickup-paymode')?.value || o.pickupPayMode || '';
      let paymentStatusNovo = o.paymentStatus;
      if (tipoNovo === 'Retirada' && pickupPayModeNovo) {
        if (pickupPayModeNovo === 'pago') paymentStatusNovo = 'Aprovado';
        else if (pickupPayModeNovo === 'total_retirada') paymentStatusNovo = 'Ag. Pagamento na Retirada';
        else if (pickupPayModeNovo === 'parcial') paymentStatusNovo = 'Parcial — Falta na Retirada';
      }

      // saleUnit (unidade que VENDEU) — editavel pelo admin/gerente.
      // Se select estiver vazio (— manter), preserva o atual; caso contrario substitui.
      const saleUnitEditValue = document.getElementById('eo-sale-unit')?.value;
      const saleUnitNovo = saleUnitEditValue ? saleUnitEditValue : (o.saleUnit || '');

      // ── VENDEDOR (admin/gerente corrige atendente do pedido) ──
      // Pega o select; se mudou, monta um patch que vai junto do payload.
      const vendSelEl = document.getElementById('eo-vendedor');
      let vendedorPayload = null;
      if (vendSelEl) {
        const newVendId = vendSelEl.value || '';
        const opt = vendSelEl.selectedOptions?.[0];
        const newName = opt?.dataset?.name || '';
        const newEmail = opt?.dataset?.email || '';
        const vendAtualNome = String(o.createdByName || o.criadoPorNome || o.vendedorNome || '');
        if (newName !== vendAtualNome) {
          vendedorPayload = {
            createdById:    newVendId || '',
            createdByName:  newName   || '',
            createdByEmail: newEmail  || '',
            criadoPorId:    newVendId || '',
            criadoPorNome:  newName   || '',
            vendedorId:     newVendId || '',
            vendedorNome:   newName   || '',
          };
        }
      }

      // ── ENTREGADOR (admin/gerente edita mesmo pos-entrega) ──
      // Quando troca driver, atualiza driverId/Name/Email/BackendId e
      // recalcula deliveryFee + total se taxa do entregador for diferente.
      const driverSelEl = document.getElementById('eo-driver');
      let driverPayload = null;
      if (driverSelEl) {
        const newDriverId = driverSelEl.value || '';
        const opt = driverSelEl.selectedOptions?.[0];
        if (newDriverId) {
          const newName = opt?.dataset?.name || '';
          const newEmail = opt?.dataset?.email || '';
          const newFee = Number(opt?.dataset?.fee || 0);
          const taxaAntiga = Number(o.deliveryFee || o.assignedDeliveryFee || 0);
          // So mexe se driver mudou (ou estava vazio)
          if (newName !== (o.driverName || '')) {
            driverPayload = {
              driverId: newDriverId,
              driverBackendId: newDriverId,
              driverName: newName,
              driverEmail: newEmail,
              deliveryFee: newFee,
              assignedDeliveryFee: newFee,
              assignedDriverName: newName,
              assignedAt: new Date().toISOString(),
            };
            // Recalcula total considerando diferenca de taxa
            const totalAtual = Number(o.total || 0);
            const novoTotal = totalAtual - taxaAntiga + newFee;
            if (Math.abs(novoTotal - totalAtual) > 0.01) {
              driverPayload.total = Math.max(0, novoTotal);
            }
          }
        } else {
          // Admin selecionou "Sem entregador" — limpa todos os campos
          if (o.driverName || o.driverId) {
            const taxaAntiga = Number(o.deliveryFee || 0);
            driverPayload = {
              driverId: '', driverBackendId: '', driverName: '', driverEmail: '',
              deliveryFee: 0, assignedDeliveryFee: 0, assignedDriverName: '',
              total: Math.max(0, Number(o.total || 0) - taxaAntiga),
            };
          }
        }
      }

      // ── MOTIVO DO CANCELAMENTO ──
      // Quando status muda PRA Cancelado (e antes nao era), pergunta motivo.
      // O motivo aparece no relatorio de cancelados pra auditoria.
      const statusNovo = document.getElementById('eo-status')?.value;
      let motivoCancelamentoNovo = o.motivoCancelamento || '';
      let canceladoEmNovo = o.canceladoEm || null;
      if (statusNovo === 'Cancelado' && o.status !== 'Cancelado') {
        const m = prompt('🚫 Motivo do cancelamento (aparece no relatório):', '');
        if (m === null) {
          // Usuario cancelou o prompt — aborta o save
          btn.disabled = false;
          return;
        }
        motivoCancelamentoNovo = String(m).trim() || 'Sem motivo informado';
        canceladoEmNovo = new Date().toISOString();
      }

      const payload={
        status:         statusNovo,
        motivoCancelamento: motivoCancelamentoNovo,
        canceladoEm:    canceladoEmNovo,
        canceladoPor:   statusNovo === 'Cancelado' ? (S.user?.name || S.user?.nome || 'admin') : (o.canceladoPor || ''),
        type:           tipoNovo,
        tipo:           tipoNovo.toLowerCase().replace('ã','a'), // 'delivery'|'retirada'|'balcao'
        pickupUnit:     tipoNovo === 'Retirada' ? pickupUnitNovo : '',
        pickupPayMode:  tipoNovo === 'Retirada' ? pickupPayModeNovo : '',
        paymentStatus:  paymentStatusNovo,
        saleUnit:       saleUnitNovo,
        unidade:        unidadeNova,
        unit:           unitLabelNovo,
        destino:        unidadeNova,
        scheduledDate:  document.getElementById('eo-date')?.value,
        scheduledPeriod:document.getElementById('eo-period')?.value,
        // Marcia (25/mai/2026): horario especifico agora tem 2 campos (de/ate)
        scheduledTime:    document.getElementById('eo-time-from')?.value || document.getElementById('eo-time')?.value || '',
        scheduledTimeEnd: document.getElementById('eo-time-to')?.value || '',
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
        surcharge:      parseFloat(document.getElementById('eo-surcharge')?.value)||0,
        total:          parseFloat(document.getElementById('eo-total')?.value)||o.total,
        cardMessage:    document.getElementById('eo-card')?.value?.trim(),
        notes:          document.getElementById('eo-notes')?.value?.trim(),
        items,
        // Driver (se admin/gerente mexeu no select)
        ...(driverPayload || {}),
        // Vendedor (se admin/gerente mexeu no select)
        ...(vendedorPayload || {}),
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
