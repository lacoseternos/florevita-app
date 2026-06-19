// ── PDV (Ponto de Venda) ─────────────────────────────────────
import { S, PDV, DELIVERY_FEES, BAIRROS_MANAUS, resetPDV } from '../state.js';
import { $c, emoji, esc, ini, productImgUrl } from '../utils/formatters.js';
import { POST, PATCH, GET } from '../services/api.js';
import { toast, setPage, logActivity as _logActivity, getActivities as _getActivities } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { opcoesPermitidas, isAdmin, normalizeUnidade, labelUnidade, podeCriarPedido } from '../utils/unidadeRules.js';
import { tierBadgeHTML, getClientWithStats } from './clientes.js';
import { fmtOrderNum } from '../utils/formatters.js';

let _pdvLock = false;

// ── HORARIOS COMERCIAIS POR DATA ESPECIAL (06/jun/2026) ──────
// Cache em modulo do dateSpecialHours pra exibir turno 'Comercial'
// no dropdown de turno quando a data selecionada tiver esse turno
// ativo na config (Configuracoes > Datas Comemorativas).
// 06/jun v2: dispara re-render quando dados chegam (antes ficava
// preso no primeiro paint sem o turno Comercial).
let _pdvSpecialHours = {};
let _pdvSpecialHoursFetchedAt = 0;
let _pdvSpecialHoursFetching = false;
export function _pdvLoadSpecialHours() {
  if (_pdvSpecialHoursFetching) return;
  // Throttle 20s entre fetches bem-sucedidos
  if (_pdvSpecialHoursFetchedAt && (Date.now() - _pdvSpecialHoursFetchedAt) < 20000) return;
  _pdvSpecialHoursFetching = true;
  GET('/settings/ecommerce')
    .then(r => {
      _pdvSpecialHoursFetchedAt = Date.now();
      const novo = (r && r.value && r.value.dateSpecialHours && typeof r.value.dateSpecialHours === 'object')
        ? r.value.dateSpecialHours : {};
      const antes = JSON.stringify(_pdvSpecialHours||{});
      const depois = JSON.stringify(novo);
      _pdvSpecialHours = novo;
      // Se mudou (ou era a 1a carga), re-renderiza pra mostrar
      // o turno Comercial no dropdown sem precisar de outra interacao
      if (antes !== depois) {
        try { import('../main.js').then(m => m.render?.()).catch(()=>{}); } catch(_){}
      }
    })
    .catch(() => {
      _pdvSpecialHoursFetchedAt = Date.now() - 18000; // tenta de novo em 2s
    })
    .finally(() => { _pdvSpecialHoursFetching = false; });
}
// Dispara fetch logo na importacao do modulo — quando colab abrir o
// PDV, os dados ja estarao prontos (sem espera no primeiro paint)
try { _pdvLoadSpecialHours(); } catch(_){}

function _pdvComercialAtivo(dateISO) {
  if (!dateISO) return false;
  const cfg = _pdvSpecialHours[dateISO];
  return !!(cfg && cfg.comercial && cfg.comercial.ativo === true);
}
function _pdvComercialLabel(dateISO) {
  if (!dateISO) return '';
  return _pdvSpecialHours[dateISO]?.comercial?.label || '';
}

// ── FOTOS DO CLIENTE (polaroid / trilho) ─────────────────────
// Marcia (19/jun/2026): centraliza a deteccao de produtos que pedem
// foto e quantas fotos por unidade. Polaroid = 1; cone/LE0456 = 3;
// trilho de fotos = 3 (ou o numero no nome, ex "Trilho 4 fotos").
function _pdvFotoInfo(item){
  const nome = String(item?.name || '').toLowerCase();
  const baseId = String(item?.id || '').split(':')[0];
  const prod = (S.products||[]).find(p => p._id === baseId);
  const sku = String(item?.sku || item?.code || prod?.sku || prod?.code || '').toUpperCase();
  const isTrilho = /trilho/.test(nome);
  const precisa = /polar(oid|óide)/.test(nome) || isTrilho;
  let porUni = 1;
  if (sku === 'LE0456' || (/cone/.test(nome) && /polar(oid|óide)/.test(nome))) porUni = 3;
  else if (isTrilho) {
    const m = nome.match(/(\d+)\s*fotos?/) || nome.match(/trilho\D*(\d+)/);
    const n = m ? parseInt(m[1], 10) : 0;
    porUni = (n >= 2 && n <= 12) ? n : 3;
  }
  return { precisa, porUni, isTrilho };
}

// ── POPUP PÓS-PEDIDO — imune a renders do sistema ─────────────
// Injeta overlay direto em document.body. Não usa S._modal nem render().
function showPostOrderPopup(o){
  // Remove qualquer popup anterior
  const old = document.getElementById('po-overlay');
  if(old) old.remove();

  // BUG FIX: 'YYYY-MM-DD' eh parseado como UTC midnight, que em Manaus
  // (UTC-4) vira 20h do dia anterior — exibia 12 em vez de 13.
  // Solucao: append T12:00:00 (meio-dia local) pra cair no dia certo
  // independentemente do fuso.
  const dataEntrega = o.scheduledDate
    ? (() => {
        const s = String(o.scheduledDate);
        // Se for so YYYY-MM-DD, adiciona horario local. Se ja tem 'T',
        // deixa o JS parsear normal.
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
        return dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});
      })()
    : '—';
  const turno = o.scheduledPeriod || '';
  const hora  = o.scheduledTime  || '';
  const horaLabel = [turno, hora].filter(Boolean).join(' · ');
  const isPagarNaEntrega = (o.payment === 'Pagar na Entrega');
  const totalFmt = 'R$ ' + (o.total||0).toFixed(2).replace('.',',');
  const trocoInfo = (isPagarNaEntrega && o.paymentOnDelivery==='Dinheiro' && o.trocoPara && parseFloat(o.trocoPara) > (o.total||0))
    ? ` · Troco p/ R$ ${parseFloat(o.trocoPara).toFixed(2).replace('.',',')}` : '';

  // Numero do pedido na sequencia historica do cliente.
  // ESTE pedido ja foi salvo, entao ele esta incluido no totalOrders atual.
  let pedidoNumeroCliente = 0;
  let nomeCliente = '';
  try {
    const cliId = o.client?._id || o.client;
    if (cliId) {
      const cli = getClientWithStats(cliId) || S.clients.find(c => c._id === cliId);
      if (cli) {
        pedidoNumeroCliente = parseInt(cli.totalOrders) || 1;
        nomeCliente = cli.name || o.clientName || '';
      }
    }
  } catch(_){}

  const overlay = document.createElement('div');
  overlay.id = 'po-overlay';
  overlay.setAttribute('style',
    'position:fixed;top:0;left:0;right:0;bottom:0;' +
    'background:rgba(0,0,0,.55);z-index:2147483647;' +
    'display:flex;align-items:center;justify-content:center;' +
    'padding:20px;box-sizing:border-box;' +
    'animation:po-fadein .2s ease-out;'
  );

  overlay.innerHTML = `
    <style>
      @keyframes po-fadein { from { opacity: 0; } to { opacity: 1; } }
      @keyframes po-slideup { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    </style>
    <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.3);animation:po-slideup .25s ease-out;">
      <div style="background:#1F5C2E;padding:22px 24px 18px;text-align:center;">
        <div style="font-size:11px;color:rgba(255,255,255,.8);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Laços Eternos 🌸</div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;color:#fff;font-weight:600;">✅ Pedido lançado!</div>
      </div>
      <div style="background:linear-gradient(135deg,#F0FDF4,#fff);padding:24px;">
        <div style="background:#fff;border:1.5px solid #E5E7EB;border-radius:12px;padding:14px 16px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;margin-bottom:10px;border-bottom:1px dashed #E5E7EB;">
            <span style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Código</span>
            <span style="font-size:22px;font-weight:900;color:#8B2252;font-family:'Playfair Display',serif;">${fmtOrderNum(o)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:10px;margin-bottom:10px;border-bottom:1px dashed #E5E7EB;">
            <span style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Entrega</span>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:700;color:#333;">${dataEntrega}</div>
              ${horaLabel?`<div style="font-size:11px;color:#6B7280;">${horaLabel}</div>`:''}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Pagamento</span>
            <div style="text-align:right;">
              <div style="font-size:13px;font-weight:700;color:#333;">${o.payment||'—'}${trocoInfo}</div>
              <div style="font-size:13px;color:#1F5C2E;font-weight:700;">${totalFmt}</div>
            </div>
          </div>
        </div>
        ${pedidoNumeroCliente > 0 ? `
        <div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:10px;padding:10px 14px;margin-bottom:14px;text-align:center;font-size:13px;font-weight:700;color:#78350F;">
          🎯 Esse é o <strong style="font-size:16px;">${pedidoNumeroCliente}º pedido</strong> ${nomeCliente?'de <strong>'+nomeCliente+'</strong>':'desse cliente'}
        </div>` : ''}
        <!-- Botoes em GRID 1 coluna pra GARANTIR que IMPRIMIR sempre aparece -->
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="po-btn-imprimir" style="width:100%;background:linear-gradient(135deg,#8B2252,#6B1A40);color:#fff;border:none;padding:15px 14px;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(139,34,82,.3);display:flex;align-items:center;justify-content:center;gap:8px;">
            🖨️ Imprimir Comanda
          </button>
          ${o.payment === 'Link'
            ? `<button id="po-btn-mp-link" style="width:100%;background:linear-gradient(135deg,#009EE3,#0077B5);color:#fff;border:none;padding:15px 14px;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(0,158,227,.3);display:flex;align-items:center;justify-content:center;gap:8px;">
                🔗 Gerar Link de Pagamento (Mercado Pago)
              </button>`
            : isPagarNaEntrega
              ? `<div style="width:100%;background:#FFF8E1;border:1px dashed #B7860F;border-radius:10px;padding:12px;font-size:12px;color:#8B6914;text-align:center;line-height:1.3;font-weight:600;">🚚 Pagamento será feito na entrega pelo entregador</div>`
              : `<button id="po-btn-aprovar" style="width:100%;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;padding:13px 14px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(5,150,105,.3);">✅ Aprovar Pagamento</button>`}
        </div>
        ${o.payment === 'Link' ? `
        <div style="background:#DBEAFE;border:1px dashed #1E40AF;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:11px;color:#1E3A8A;text-align:center;font-weight:600;line-height:1.4;">
          🔗 Clique acima para gerar o link e enviar pro cliente.<br/>O sistema <strong>aprova sozinho</strong> assim que o cliente pagar.
        </div>` : !isPagarNaEntrega ? `
        <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:8px 12px;margin-top:10px;font-size:11px;color:#78350F;text-align:center;font-weight:600;">
          ⚠️ Pagamento ainda <strong>aguardando confirmação</strong> — clique em "Aprovar Pagamento" após confirmar o recebimento.
        </div>` : ''}
      </div>
      <div style="padding:14px 24px 18px;background:#fff;text-align:center;border-top:1px solid #F3F4F6;">
        <button id="po-btn-fechar" style="background:transparent;color:#6B7280;border:1px solid #E5E7EB;padding:8px 24px;border-radius:8px;font-size:12px;cursor:pointer;">Fechar</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  console.log('[PDV popup] Overlay injetado no body. Elemento:', overlay);

  const closeOverlay = () => { overlay.remove(); };

  // Click fora do card fecha
  overlay.addEventListener('click', e => {
    if(e.target === overlay) closeOverlay();
  });

  // Botões
  overlay.querySelector('#po-btn-fechar')?.addEventListener('click', closeOverlay);
  overlay.querySelector('#po-btn-imprimir')?.addEventListener('click', () => {
    import('../pages/impressao.js').then(m => {
      if(m.printComanda) m.printComanda(o._id);
    }).catch(err => console.warn('[PDV popup] printComanda erro:', err));
  });
  overlay.querySelector('#po-btn-aprovar')?.addEventListener('click', async () => {
    // Rastreia cliques impacientes nesse botao critico.
    import('../services/colabAlerts.js').then(m => m.trackImpatientClick?.('Aprovar Pagamento')).catch(()=>{});

    // Aprovacao de fato (chamada direto ou apos confirmar o comprovante Pix).
    const doAprovar = async () => {
      try{
        const { PUT } = await import('../services/api.js');
        await PUT('/orders/'+o._id, { paymentStatus:'Aprovado' });
        const updated = { ...o, paymentStatus:'Aprovado' };
        S.orders = S.orders.map(x => x._id===o._id ? updated : x);
        invalidateCache('orders');
        // Registra receita SO agora (apos aprovacao)
        import('./financeiro.js').then(m => m.registrarReceitaVenda(updated)).catch(()=>{});
        toast('✅ Pagamento aprovado e receita registrada!');
        closeOverlay();
      }catch(e){
        console.error('[PDV popup] aprovar erro:', e);
        toast('❌ Erro ao aprovar: '+(e.message||''), true);
      }
    };

    // Marcia (19/jun/2026): pagamento via Pix em LANÇAMENTO MANUAL
    // (inclusive Multiplo com Pix) exige uma checagem de atencao antes de
    // aprovar — evita aprovar comprovante de Pix AGENDADO ou suspeito.
    // Pedidos do SITE (e-commerce) NAO entram aqui: a confirmacao vem do
    // Mercado Pago automaticamente. Outros metodos aprovam direto.
    const ehSite = /site|e-?commerce|loja\s*online/i.test(String(o.source||''));
    if (/pix/i.test(String(o.payment||'')) && !ehSite) {
      _confirmAprovarPix(o, doAprovar);
    } else {
      doAprovar();
    }
  });

  // ── Botão "Gerar Link de Pagamento" — Mercado Pago ───────────
  overlay.querySelector('#po-btn-mp-link')?.addEventListener('click', async () => {
    const btn = overlay.querySelector('#po-btn-mp-link');
    // Marcia (25/mai/2026): bloqueia se ja pago/aprovado/recebido
    const PAGOS = new Set(['Aprovado','Pago','Pago na Entrega','Recebido','aprovado','pago','recebido']);
    if (PAGOS.has(String(o.paymentStatus||''))) {
      toast('⚠️ Este pedido já está pago — não precisa gerar novo link.', true);
      return;
    }
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Gerando link...';
    try {
      const r = await POST('/public/mp/create-preference', { orderId: o._id });
      if (!r || !r.initPoint) throw new Error(r?.error || 'Resposta inválida');
      // Mostra sub-modal com o link gerado
      showMpLinkModal(o, r.initPoint);
    } catch (e) {
      console.error('[MP link] erro:', e);
      const msg = (e.message||'').includes('nao configurado')
        ? '❌ Mercado Pago não configurado em Configurações > Integrações'
        : '❌ Erro ao gerar link: ' + (e.message||'');
      toast(msg, true);
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });
}

// ── Sub-modal: CONFERÊNCIA do comprovante Pix antes de aprovar ─
// Marcia (19/jun/2026): ao aprovar um pagamento Pix, a colaboradora
// precisa parar e conferir o comprovante (Pix agendado? suspeito?).
// Mostra um alerta personalizado com o nome de quem lançou o pedido.
function _confirmAprovarPix(o, onConfirm) {
  const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const old = document.getElementById('po-pix-confirm');
  if (old) old.remove();

  // Quem lançou: prioriza o registrado no pedido; cai pro usuário logado.
  const lancou = String(o.createdByName || S.user?.name || S.user?.nome || '').trim();
  const primeiroNome = lancou ? lancou.split(/\s+/)[0] : '';
  const titulo = primeiroNome ? `${_esc(primeiroNome)}, um instante!` : 'Atenção, um instante!';

  const ov = document.createElement('div');
  ov.id = 'po-pix-confirm';
  ov.setAttribute('style',
    'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.72);'+
    'z-index:2147483647;display:flex;align-items:center;justify-content:center;'+
    'padding:20px;box-sizing:border-box;animation:po-fadein .2s ease-out;');
  ov.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.4);animation:po-slideup .25s ease-out;">
      <div style="background:linear-gradient(135deg,#B45309,#92400E);padding:22px 24px;text-align:center;">
        <div style="font-size:34px;line-height:1;margin-bottom:6px;">🔎</div>
        <div style="font-family:'Playfair Display',serif;font-size:21px;color:#fff;font-weight:700;">${titulo}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:4px;">Conferência do comprovante Pix</div>
      </div>
      <div style="padding:22px 24px;background:linear-gradient(135deg,#FFFBEB,#fff);">
        <p style="font-size:14px;color:#374151;font-weight:700;margin:0 0 12px;text-align:center;">Antes de aprovar este Pix, confirme:</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
          <div style="display:flex;gap:8px;align-items:flex-start;background:#fff;border:1px solid #FDE68A;border-radius:10px;padding:10px 12px;font-size:13px;color:#78350F;line-height:1.4;"><span>📄</span><span>Você <strong>conferiu o comprovante</strong>?</span></div>
          <div style="display:flex;gap:8px;align-items:flex-start;background:#fff;border:1px solid #FDE68A;border-radius:10px;padding:10px 12px;font-size:13px;color:#78350F;line-height:1.4;"><span>⏰</span><span>O Pix <strong>não está agendado</strong> pra outra data?</span></div>
          <div style="display:flex;gap:8px;align-items:flex-start;background:#fff;border:1px solid #FDE68A;border-radius:10px;padding:10px 12px;font-size:13px;color:#78350F;line-height:1.4;"><span>🚩</span><span>Tem <strong>algo suspeito</strong> no comprovante?</span></div>
        </div>
        <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:10px;padding:11px 12px;font-size:12.5px;color:#78350F;text-align:center;font-weight:600;margin-bottom:16px;line-height:1.5;">
          Se está tudo certo, clique abaixo e aprove o pagamento.<br/><strong>Sua atenção neste momento é importante.</strong> 💛
        </div>
        <button id="pix-confirm-ok" style="width:100%;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;padding:14px;border-radius:10px;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(5,150,105,.3);margin-bottom:8px;">✅ Conferi tudo — Aprovar pagamento</button>
        <button id="pix-confirm-cancel" style="width:100%;background:#fff;color:#6B7280;border:1px solid #E5E7EB;padding:11px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">Cancelar — vou conferir de novo</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => ov.remove();
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#pix-confirm-cancel')?.addEventListener('click', close);
  ov.querySelector('#pix-confirm-ok')?.addEventListener('click', () => { close(); onConfirm(); });
}

// ── Sub-modal: link de pagamento MP gerado ────────────────────
function showMpLinkModal(order, link) {
  const old = document.getElementById('po-mp-overlay');
  if (old) old.remove();
  const fone = String(order.clientPhone || '').replace(/\D/g, '');
  const foneFull = fone ? (fone.startsWith('55') ? fone : '55' + fone) : '';
  const totalFmt = 'R$ ' + (order.total||0).toFixed(2).replace('.', ',');
  const nomeCliente = order.clientName || 'cliente';
  const orderNum = order.orderNumber || (String(order._id||'').slice(-5).toUpperCase());
  const msgWpp = `Olá, ${nomeCliente}! 🌹\n\nSeguem os dados pra você concluir o pagamento do pedido *#${orderNum}* na Floricultura Laços Eternos:\n\n💎 Valor: *${totalFmt}*\n💳 Aceita Pix e Cartão (até 3x sem juros)\n\n🔗 Link de pagamento:\n${link}\n\nApós o pagamento, seu pedido vai automaticamente pra produção. Qualquer dúvida estou à disposição! 💐`;
  const wppLink = foneFull
    ? `https://wa.me/${foneFull}?text=${encodeURIComponent(msgWpp)}`
    : `https://wa.me/?text=${encodeURIComponent(msgWpp)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;

  const ov = document.createElement('div');
  ov.id = 'po-mp-overlay';
  ov.setAttribute('style',
    'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);'+
    'z-index:2147483647;display:flex;align-items:center;justify-content:center;'+
    'padding:20px;box-sizing:border-box;'
  );
  ov.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:480px;width:100%;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.4);">
      <div style="background:linear-gradient(135deg,#009EE3,#0077B5);padding:20px 24px;text-align:center;">
        <div style="font-size:11px;color:rgba(255,255,255,.85);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px;">Mercado Pago · Link Gerado</div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;color:#fff;font-weight:600;">🔗 Pedido #${orderNum}</div>
        <div style="font-size:18px;color:#fff;font-weight:800;margin-top:4px;">${totalFmt}</div>
      </div>
      <div style="padding:20px 24px;background:#F8FAFC;">
        <!-- STATUS BADGE -->
        <div id="mp-status-badge" style="background:#FEF3C7;border:1.5px dashed #F59E0B;border-radius:10px;padding:10px 14px;margin-bottom:14px;text-align:center;font-size:12px;color:#78350F;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px;">
          <span class="mp-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid #F59E0B;border-top-color:transparent;border-radius:50%;animation:mp-spin 1s linear infinite;"></span>
          <span id="mp-status-text">⏳ Aguardando pagamento do cliente…</span>
        </div>
        <style>@keyframes mp-spin { to { transform: rotate(360deg); } }</style>
        <!-- QR Code -->
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:14px;text-align:center;margin-bottom:14px;">
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:700;">📲 QR Code (cliente escaneia)</div>
          <img src="${qrUrl}" alt="QR Code" style="width:200px;height:200px;border-radius:8px;"/>
        </div>
        <!-- Link em texto -->
        <div style="background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px;margin-bottom:12px;">
          <div style="font-size:10px;color:#6B7280;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px;">Link</div>
          <div style="font-size:11px;color:#374151;word-break:break-all;font-family:Monaco,monospace;line-height:1.4;">${link}</div>
        </div>
        <!-- Botões de ação -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <button id="mp-copy" style="background:#1E40AF;color:#fff;border:none;padding:12px 10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">📋 Copiar Link</button>
          <button id="mp-wpp" style="background:#25D366;color:#fff;border:none;padding:12px 10px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">💬 Enviar WhatsApp</button>
        </div>
        <button id="mp-check-now" style="width:100%;background:#fff;border:1.5px solid #009EE3;color:#009EE3;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:8px;">🔄 Verificar pagamento agora</button>
        <div style="background:#DCFCE7;border:1px solid #86EFAC;border-radius:8px;padding:10px 12px;font-size:11px;color:#14532D;text-align:center;line-height:1.5;">
          ✅ O sistema verifica automaticamente a cada 5 segundos.<br/>Quando aprovar, o pedido vai pra Produção sozinho.
        </div>
      </div>
      <div style="padding:14px 24px 18px;background:#fff;text-align:center;border-top:1px solid #F3F4F6;">
        <button id="mp-close" style="background:transparent;color:#6B7280;border:1px solid #E5E7EB;padding:8px 24px;border-radius:8px;font-size:12px;cursor:pointer;">Fechar (continua verificando em background)</button>
      </div>
    </div>
  `;
  document.body.appendChild(ov);

  // ── POLLING: checa status do MP a cada 5s ────────────────────
  let pollAttempts = 0;
  let pollTimer = null;
  let checking = false;
  const updateStatus = (txt, bg, border, color, icon) => {
    const badge = document.getElementById('mp-status-badge');
    const txtEl = document.getElementById('mp-status-text');
    if (!badge || !txtEl) return;
    badge.style.background = bg;
    badge.style.borderColor = border;
    badge.style.color = color;
    const spinner = badge.querySelector('.mp-spinner');
    if (spinner) spinner.style.display = icon === 'spinner' ? 'inline-block' : 'none';
    txtEl.textContent = txt;
  };

  const stopPoll = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };

  const checkPayment = async (manual = false) => {
    if (checking) return;
    checking = true;
    pollAttempts++;
    try {
      const { GET } = await import('../services/api.js');
      const r = await GET('/public/mp/payment-status?orderId=' + encodeURIComponent(order._id));
      if (r?.approved || r?.paymentStatus === 'Aprovado') {
        // 🎉 APROVADO
        updateStatus('✅ Pagamento aprovado!', '#DCFCE7', '#15803D', '#14532D', 'check');
        stopPoll();
        // Atualiza estado local
        // Marcia (25/mai/2026): NAO muda status — atendente decide quando produzir
        const updated = { ...order, paymentStatus: 'Aprovado' };
        S.orders = S.orders.map(x => x._id === order._id ? updated : x);
        invalidateCache('orders');
        // Registra receita
        try {
          const m = await import('./financeiro.js');
          m.registrarReceitaVenda?.(updated);
        } catch (_) {}
        toast('🎉 Pagamento de ' + orderNum + ' aprovado pelo Mercado Pago!');
        // Anima e fecha em 3s
        setTimeout(() => {
          ov.style.transition = 'opacity .4s';
          ov.style.opacity = '0';
          setTimeout(() => ov.remove(), 400);
          // Atualiza painel admin
          try { import('../main.js').then(m => m.render?.()).catch(()=>{}); } catch (_) {}
        }, 3000);
      } else if (manual) {
        updateStatus('⏳ Ainda não recebemos o pagamento — verifique se o cliente concluiu', '#FEF3C7', '#F59E0B', '#78350F', 'spinner');
        // Volta pro modo "aguardando" depois de 3s
        setTimeout(() => {
          if (!checking && pollTimer) updateStatus('⏳ Aguardando pagamento do cliente…', '#FEF3C7', '#F59E0B', '#78350F', 'spinner');
        }, 3000);
      }
    } catch (e) {
      console.warn('[MP poll] erro:', e);
      if (manual) toast('❌ Erro ao verificar: ' + (e.message||''), true);
    } finally {
      checking = false;
    }
  };

  // Inicia polling a cada 5s (max 30 minutos = 360 tentativas)
  pollTimer = setInterval(() => {
    if (pollAttempts >= 360) { stopPoll(); return; }
    checkPayment(false);
  }, 5000);
  // Primeira verificação após 3s (dá tempo do cliente abrir o link)
  setTimeout(() => checkPayment(false), 3000);

  ov.addEventListener('click', e => {
    if (e.target === ov) {
      // Não para o polling — só esconde o modal
      ov.remove();
    }
  });
  ov.querySelector('#mp-close')?.addEventListener('click', () => {
    // Continua o polling em background pra atualizar quando pagar
    ov.remove();
    // Move o polling pra fora do modal (mantém ativo por mais 5min)
    let bgAttempts = 0;
    const bgPoll = setInterval(async () => {
      bgAttempts++;
      if (bgAttempts >= 60) { clearInterval(bgPoll); return; } // 5min
      try {
        const { GET } = await import('../services/api.js');
        const r = await GET('/public/mp/payment-status?orderId=' + encodeURIComponent(order._id));
        if (r?.approved) {
          clearInterval(bgPoll);
          // Marcia (25/mai/2026): NAO muda status — atendente decide quando produzir
        const updated = { ...order, paymentStatus: 'Aprovado' };
          S.orders = S.orders.map(x => x._id === order._id ? updated : x);
          invalidateCache('orders');
          try { const m = await import('./financeiro.js'); m.registrarReceitaVenda?.(updated); } catch (_) {}
          toast('🎉 Pedido ' + orderNum + ' aprovado pelo Mercado Pago!');
          try { import('../main.js').then(m => m.render?.()).catch(()=>{}); } catch (_) {}
        }
      } catch (_) {}
    }, 5000);
    stopPoll();
  });
  ov.querySelector('#mp-check-now')?.addEventListener('click', () => checkPayment(true));
  ov.querySelector('#mp-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('📋 Link copiado!');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = link; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('📋 Link copiado!'); } catch (_) { toast('❌ Não foi possível copiar', true); }
      ta.remove();
    }
  });
  ov.querySelector('#mp-wpp')?.addEventListener('click', () => {
    window.open(wppLink, '_blank');
  });
}

export function renderPDV(){
  if(!can('pdv')) return `<div class="empty card"><div class="empty-icon">&#x1F6AB;</div><p>Sem permiss\u00e3o</p></div>`;
  // ── Regras de unidade (multi-unit) ───────────────────────────
  const opcoes = opcoesPermitidas(S.user);
  const admin = isAdmin(S.user);
  const tiposPermitidos = opcoes.tipos || [];
  // Mapeia slug → rótulo interno do PDV (PDV.type usa strings em PT-BR)
  const tipoSlugToKey = { balcao: 'Balc\u00E3o', retirada: 'Retirada', delivery: 'Delivery' };
  const tipoKeyLabel  = { 'Balc\u00E3o': '\uD83C\uDFEA Balc\u00E3o', 'Retirada': '\uD83D\uDCE6 Retirada na Loja', 'Delivery': '\uD83D\uDE9A Delivery' };
  // Garante que PDV.type seja um tipo permitido
  if(tiposPermitidos.length > 0){
    const allowedKeys = tiposPermitidos.map(t => tipoSlugToKey[t]);
    if(!allowedKeys.includes(PDV.type)) PDV.type = allowedKeys[0];
  }
  // Destinos permitidos por tipo (para Retirada/Balcão)
  const destinosRetirada = (opcoes.combinacoes || []).filter(c => c.tipo === 'retirada').map(c => c.destino);
  const destinosBalcao   = (opcoes.combinacoes || []).filter(c => c.tipo === 'balcao').map(c => c.destino);

  const sub=PDV.cart.reduce((s,i)=>s+i.price*i.qty,0);
  const deliveryFee=PDV.type==='Delivery'?(PDV.deliveryFee||0):0;
  const total=sub-(PDV.discount||0)+(PDV.surcharge||0)+deliveryFee;

  // HTML do card de busca de produto — usado abaixo do cliente
  const addProductHTML = `
  <div class="fg" style="margin-top:10px;margin-bottom:6px;">
    <label class="fl">\uD83D\uDCE6 Adicionar Produto ao Carrinho</label>
    <div style="position:relative;">
      <input
        class="fi"
        id="pdv-prod-search"
        placeholder="\uD83D\uDD0D Buscar produto por nome..."
        autocomplete="off"
        style="padding:12px 14px;font-size:14px;border:2px solid var(--rose-l);border-radius:10px;"
      />
      <div id="pdv-prod-suggestions" style="position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid var(--border);border-radius:10px;margin-top:4px;max-height:400px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:100;display:none;"></div>
    </div>
  </div>`;

  // HTML do Cliente (incluindo busca + cadastro rápido)
  const clienteCardHTML = `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">\uD83D\uDC64 Cliente</div>

    ${(()=>{
      // Marcia (06/jun/2026): REVERTIDO \u2014 unidade de venda volta a ser
      // FIXA na unidade da colaboradora. Quem decide a atribuicao da
      // venda agora eh o CANAL DE VENDA, nao a unidade. Admin/Todas
      // ainda ve dropdown completo (precisa pra lancar venda multi-unit).
      // Allegro Mall: desativada \u2014 nao aparece nas opcoes.
      const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';
      const userUnit = S.user?.unit;
      const specificUnits = ['Loja Novo Aleixo','CDLE']; // Allegro desativada 06/jun/2026
      const ICONS = { 'Loja Novo Aleixo':'\uD83C\uDF3A', 'CDLE':'\uD83D\uDCE6' };

      // CASO 1: admin / unit='Todas' / unit nao reconhecido \u2192 dropdown completo
      if (isAdmin || userUnit === 'Todas' || !specificUnits.includes(userUnit)) {
        if (!specificUnits.includes(PDV.saleUnit)) PDV.saleUnit = 'Loja Novo Aleixo';
        return `<div class="fg"><label class="fl">Unidade de Venda *</label>
          <select class="fi" id="pdv-sale-unit">
            ${specificUnits.map(u => `<option value="${u}" ${PDV.saleUnit===u?'selected':''}>${ICONS[u]} ${u}</option>`).join('')}
          </select>
        </div>`;
      }
      // CASO 2: colab comum \u2014 unidade FIXA na unidade dela
      if (PDV.saleUnit !== userUnit) PDV.saleUnit = userUnit;
      const icon = ICONS[userUnit] || '\uD83C\uDF3A';
      return `<div class="fg"><label class="fl">Unidade de Venda</label>
        <div style="display:inline-flex;align-items:center;gap:8px;background:var(--petal,#fce7f0);border:1px solid var(--rose-l,#f5c2d4);color:var(--rose,#b83260);border-radius:999px;padding:6px 12px;font-size:12px;font-weight:600;">
          <span>${icon}</span><span>${userUnit}</span>
          <span style="font-size:10px;opacity:.7;font-weight:500;">(fixada)</span>
        </div>
      </div>`;
    })()}

    <!-- VENDEDOR (quem fez a venda \u2014 pode ser diferente do logado) -->
    ${(() => {
      // Todos os colaboradores ativos podem ser vendedores
      // (Atendente faz tudo: vende, monta e expede)
      let colabs = [];
      try { colabs = JSON.parse(localStorage.getItem('fv_colabs')||'[]'); } catch(_){}
      colabs = colabs.filter(c => c.active !== false && c.cargo !== 'Entregador' && c.cargo !== 'entregador');
      // Default: o proprio user logado se nao definido
      const myId = String(S.user?._id || S.user?.colabId || '');
      const myEmail = String(S.user?.email||'').toLowerCase();
      if (!PDV.vendedorId && S.user) {
        PDV.vendedorId    = myId;
        PDV.vendedorNome  = S.user.name || S.user.nome || '';
        PDV.vendedorEmail = S.user.email || '';
      }
      // Lista: o user logado primeiro com (voc\u00EA), depois todos os outros colabs
      const eu = S.user ? [{ _id: myId, apiId: myId, name: (S.user.name || S.user.nome || '?') + ' (voc\u00EA)', email: S.user.email }] : [];
      const outros = colabs.filter(c => {
        const cid = String(c.apiId || c._id || '');
        const cem = String(c.email||'').toLowerCase();
        return cid !== myId && cem !== myEmail;
      });
      const todos = eu.concat(outros);
      const optsHtml = todos.map(c => {
        const cid = String(c.apiId || c._id || '');
        const cn = (c.name||'?').replace(/"/g,'');
        const ce = (c.email||'').replace(/"/g,'');
        const sel = String(PDV.vendedorId) === cid ? 'selected' : '';
        return `<option value="${cid}|${cn}|${ce}" ${sel}>${c.name||'?'}</option>`;
      }).join('');
      const meuNomeCurto = (S.user?.name || S.user?.nome || '').split(' ')[0] || 'Eu';
      const souEuSelecionada = String(PDV.vendedorId) === myId;
      return `<div class="fg"><label class="fl">\uD83D\uDC64 Vendedor (quem fez a venda) *</label>
        <div style="display:flex;gap:6px;align-items:stretch;">
          <select class="fi" id="pdv-vendedor" style="flex:1;">${optsHtml}</select>
          ${S.user ? `<button type="button" id="pdv-vendedor-eu" title="Selecionar voc\u00EA mesma como vendedora"
            style="white-space:nowrap;padding:0 14px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:1px solid ${souEuSelecionada?'#15803D':'#FECDD3'};background:${souEuSelecionada?'#DCFCE7':'#FFF'};color:${souEuSelecionada?'#15803D':'#9F1239'};">
            ${souEuSelecionada?'\u2705 ':''}\uD83D\uDC4B Sou eu (${meuNomeCurto})
          </button>` : ''}
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:3px;">${todos.length} colaborador${todos.length===1?'':'es'} dispon\u00EDveis \u00B7 Comiss\u00E3o de venda vai para o selecionado</div>
      </div>`;
    })()}

    ${(() => {
      // ── CANAL DE VENDA ─────────────────────────────────────
      // Marcia (06/jun/2026): regras novas
      //  - CDLE: WhatsApp, iFood, Giuliana
      //  - Loja Novo Aleixo: WhatsApp, Balcao
      //  - Admin/Todas: todos (pra lancar venda manual de qualquer canal)
      //  - Instagram REMOVIDO (nao usar mais)
      //  - COMECA EM BRANCO e e OBRIGATORIO (sem default automatico)
      //  - Atribuicao da venda em relatorio segue o canal:
      //      Balcao -> Loja Novo Aleixo
      //      WhatsApp/iFood/Giuliana -> CDLE
      const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';
      const userUnit = S.user?.unit || '';
      const podeEcommerce = isAdmin || !!(S.user?.modulos && S.user.modulos.canalEcommerce);

      // Compat: legado vira novo nome ao carregar
      if (PDV.salesChannel === 'WhatsApp/Online') PDV.salesChannel = 'WhatsApp';
      if (PDV.salesChannel === 'E-commerce')      PDV.salesChannel = 'Site';
      if (PDV.salesChannel === 'Instagram')       PDV.salesChannel = '';  // canal removido

      const TODAS_OPCOES = [
        { v:'WhatsApp',  l:'WhatsApp',  icon:'/icones/whatsapp.png' },
        { v:'Balcão',    l:'Balcão',    icon:'/icones/balcao.png' },
        { v:'Giuliana',  l:'Giuliana',  icon:'/icones/giuliana.png' },
        { v:'iFood',     l:'iFood',     icon:'/icones/ifood.png' },
        { v:'Site',      l:'Site',      icon:'/icones/ecommerce.png' },
      ];

      // Filtra opcoes por unidade
      let opcoes;
      if (isAdmin || userUnit === 'Todas') {
        opcoes = TODAS_OPCOES.filter(op => op.v !== 'Site' || podeEcommerce);
      } else if (userUnit === 'Loja Novo Aleixo') {
        opcoes = TODAS_OPCOES.filter(op => ['WhatsApp','Balcão'].includes(op.v));
      } else if (userUnit === 'CDLE') {
        opcoes = TODAS_OPCOES.filter(op => ['WhatsApp','iFood','Giuliana'].includes(op.v));
      } else {
        // fallback (Loja Allegro Mall desativada, ou unit desconhecida)
        opcoes = TODAS_OPCOES.filter(op => op.v !== 'Site' || podeEcommerce);
      }

      // Se o canal selecionado nao for valido pra essa unidade, reseta
      const valoresValidos = new Set(opcoes.map(o => o.v));
      if (PDV.salesChannel && !valoresValidos.has(PDV.salesChannel)) {
        PDV.salesChannel = '';
      }

      const sel = PDV.salesChannel || '';
      const selOpt = opcoes.find(o => o.v === sel);

      return `<div class="fg"><label class="fl">Canal de Venda <span style="color:var(--red)">*</span></label>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <select class="fi" id="pdv-sales-channel" style="flex:1;min-width:180px;${sel ? '' : 'border-color:#EF4444;background:#FEF2F2;'}">
            <option value="">— Selecione o canal —</option>
            ${opcoes.map(op => `<option value="${op.v}" ${op.v===sel?'selected':''}>${op.l}</option>`).join('')}
          </select>
          ${selOpt ? `<img src="${selOpt.icon}" alt="${selOpt.l}" style="width:32px;height:32px;object-fit:contain;border:1px solid var(--border);border-radius:8px;padding:3px;background:#fff;" onerror="this.style.display='none';"/>` : ''}
        </div>
        ${!sel ? '<div style="font-size:10px;color:#DC2626;margin-top:3px;font-weight:600;">⚠️ Obrigatório selecionar o canal antes de finalizar a venda.</div>' : ''}
      </div>`;
    })()}

    <!-- BUSCA CLIENTE -->
    <div class="fg">
      <label class="fl">Cliente \u2014 6 \u00FAltimos d\u00EDgitos ou nome <span style="color:var(--red)">*</span></label>
      <div style="position:relative;">
        <input class="fi" id="pdv-phone-search"
          placeholder="Ex: 234567 ou 'Maria Silva'..."
          value="${PDV.clientSearch}"
          autocomplete="off"
          style="padding-right:36px;"/>
        ${PDV.clientSearch?`<button id="pdv-search-clear" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;">\u2715</button>`:''}
      </div>
      <div id="pdv-search-results"></div>

      ${PDV.clientId?(()=>{
        const _cs = getClientWithStats(PDV.clientId) || S.clients.find(c=>c._id===PDV.clientId) || {};
        const totalP = parseInt(_cs.totalOrders) || 0;
        const labelTier = totalP <= 1 ? 'Novo' : totalP >= 4 ? 'VIP' : 'Recorrente';
        const corTier  = totalP <= 1 ? '#059669' : totalP >= 4 ? '#D97706' : '#1D4ED8';
        // Endereco cadastrado do cliente (se houver). Marcia 02/jun/2026:
        // atendente escolhe usar o cadastrado OU digitar outro novo.
        const ad = _cs.address || _cs.endereco || {};
        const rua = ad.street || ad.rua || '';
        const num = ad.number || ad.numero || '';
        const bairro = ad.neighborhood || ad.bairro || '';
        const cidade = ad.city || ad.cidade || '';
        const cepCli = ad.cep || '';
        const enderecoLinha = rua ? `${rua}${num?', '+num:''}${bairro?' \u00b7 '+bairro:''}` : '';
        const enderecoIgualAtual = (PDV.street === rua && PDV.number === num && PDV.neighborhood === bairro);
        const temEnderecoCad = !!rua;
        return `
      <div style="background:var(--leaf-l);border-radius:8px;padding:10px 14px;margin-top:6px;display:flex;align-items:center;gap:10px;border:1px solid rgba(31,92,46,.2);">
        <div class="av" style="width:34px;height:34px;font-size:12px;background:var(--leaf)">${ini(_cs.name||PDV.clientName)}</div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span>${_cs.name||PDV.clientName} <span style="color:var(--muted);font-weight:600;">- ${totalP} pedido${totalP===1?'':'s'}</span></span>
            ${_cs.code?`<span style="font-size:10px;color:var(--rose);font-weight:700;background:#fff;padding:1px 7px;border-radius:10px;border:1px solid var(--rose-l);">#${_cs.code}</span>`:''}
            <span style="font-size:11px;color:#fff;font-weight:800;background:${corTier};padding:2px 9px;border-radius:10px;letter-spacing:.3px;">${labelTier}</span>
          </div>
          <div style="font-size:11px;color:var(--muted)">${_cs.phone||PDV.clientPhone}</div>
        </div>
        <button class="btn btn-ghost btn-xs" id="pdv-clear-cli">\u2715 Trocar</button>
      </div>
      ${temEnderecoCad && (PDV.type==='Delivery' || PDV.type==='Retirada') ? `
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 12px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:10px;font-weight:800;color:#1E40AF;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;">\ud83d\udccd Endere\u00e7o cadastrado</div>
          <div style="font-size:12px;color:#1E293B;">${enderecoLinha}</div>
        </div>
        ${enderecoIgualAtual
          ? `<span style="background:#DCFCE7;color:#166534;font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;">\u2713 Em uso</span>
             <button id="pdv-usar-outro-end" type="button" style="background:#fff;color:#1E40AF;border:1px solid #BFDBFE;padding:5px 11px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">Usar outro</button>`
          : `<button id="pdv-usar-end-cad" type="button" data-rua="${(rua||'').replace(/"/g,'&quot;')}" data-num="${(num||'').replace(/"/g,'&quot;')}" data-bairro="${(bairro||'').replace(/"/g,'&quot;')}" data-cidade="${(cidade||'Manaus').replace(/"/g,'&quot;')}" data-cep="${(cepCli||'').replace(/"/g,'&quot;')}" style="background:linear-gradient(135deg,#1E40AF,#3B82F6);color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;">\u2192 Usar este endere\u00e7o</button>`}
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:4px;font-style:italic;text-align:right;">Alterar endere\u00e7o aqui n\u00e3o muda o cadastro do cliente \u2014 s\u00f3 este pedido.</div>` : ''}
      `;})():(!PDV.clientId&&PDV.clientName?`
      <div style="background:var(--cream);border-radius:8px;padding:8px 12px;margin-top:6px;font-size:12px;display:flex;align-items:center;justify-content:space-between;">
        <span><strong>${PDV.clientName}</strong> ${PDV.clientPhone?'\u00B7 '+PDV.clientPhone:''} <span class="tag t-blue" style="margin-left:4px">Novo</span></span>
        <button class="btn btn-ghost btn-xs" id="pdv-clear-cli">\u2715</button>
      </div>`:'')}
    </div>

    <!-- CADASTRO R\u00C1PIDO -->
    ${PDV._showQuickReg?`
    <div style="background:var(--petal);border-radius:var(--r);padding:14px;border:1px solid var(--rose-l);margin-bottom:10px;">
      <div style="font-weight:600;font-size:13px;margin-bottom:10px;color:var(--rose)">\u2795 Cadastro R\u00E1pido</div>
      <div class="fr2">
        <div class="fg"><label class="fl">Nome *</label><input class="fi" id="qr-name" placeholder="Nome completo"/></div>
        <div class="fg"><label class="fl">WhatsApp *</label><input class="fi" id="qr-phone" placeholder="(92) 9xxxx-xxxx"/></div>
      </div>
      <div id="qr-phone-warn" style="display:none;background:var(--red-l);border-radius:8px;padding:8px 10px;font-size:11px;color:var(--red);margin-bottom:8px;"></div>
      <div class="fr2">
        <div class="fg"><label class="fl">CPF <span style="font-size:10px;color:var(--muted);font-weight:400;">(opcional)</span></label>
          <input class="fi" id="qr-cpf" placeholder="000.000.000-00" maxlength="14" inputmode="numeric"/>
        </div>
        <div class="fg"><label class="fl">Anivers\u00E1rio</label><input class="fi" id="qr-bday" type="date"/></div>
      </div>
      <div class="fr2">
        <div class="fg" style="grid-column:span 2"><label class="fl">Rua / Avenida</label><input class="fi" id="qr-street" placeholder="Rua das Flores"/></div>
        <div class="fg"><label class="fl">N\u00FAmero</label><input class="fi" id="qr-number" placeholder="123"/></div>
        <div class="fg"><label class="fl">Bairro</label>
          <input class="fi" id="qr-neigh" placeholder="Selecione ou digite..." list="bairros-manaus"/>
        </div>
        <div class="fg"><label class="fl">CEP</label><input class="fi" id="qr-cep" placeholder="69000-000"/></div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" id="btn-qr-save">\u2705 Salvar e usar</button>
        <button class="btn btn-ghost btn-sm" id="btn-qr-cancel">Cancelar</button>
      </div>
    </div>`:''}
    <datalist id="bairros-manaus">
      ${BAIRROS_MANAUS.map(b=>`<option value="${b}">`).join('')}
    </datalist>
  </div>`;

  // HTML do Carrinho
  const carrinhoHTML = `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">\uD83D\uDED2 Carrinho (${PDV.cart.length} ${PDV.cart.length===1?'item':'itens'})</div>

    <!-- BUSCA DE PRODUTO -->
    ${addProductHTML}

    ${PDV.cart.length===0 ? `
      <div style="text-align:center;padding:30px 16px;color:var(--muted);margin-top:10px;">
        <div style="font-size:36px;margin-bottom:8px;opacity:.5;">\uD83D\uDECD\uFE0F</div>
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">Carrinho vazio</div>
        <div style="font-size:11px;">Busque produtos acima para adicionar</div>
      </div>
    ` : `
      <div style="max-height:340px;overflow-y:auto;margin-top:8px;">
        ${PDV.cart.map(it=>{
          // FOTO do produto (carregamento rapido via endpoint cacheado)
          const baseId = String(it.id||'').split(':')[0];
          const prod = (S.products||[]).find(p => p._id===baseId);
          const imgUrl = productImgUrl(prod || baseId);
          // \u2500\u2500 POLAROID / TRILHO: detecta pelo nome e mostra slots de foto
          // por unidade. Cone/LE0456 = 3 polaroids; trilho de fotos = 3
          // (ou o numero no nome). Ver _pdvFotoInfo.
          const _fotoInfo = _pdvFotoInfo(it);
          const isPolaroid = _fotoInfo.precisa;
          const polPorUni = _fotoInfo.porUni;
          const _isTrilho = _fotoInfo.isTrilho;
          const totalFotos = it.qty * polPorUni;
          const fotosArr = Array.from({length: totalFotos}, (_, i) => (it.userPhotos||[])[i] || '');
          const allFilled = isPolaroid && fotosArr.every(f => !!f);
          const polaroidBlock = isPolaroid ? `
            <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:8px 10px;margin:0 4px 8px;">
              <div style="font-size:11px;font-weight:800;color:#92400E;margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
                <span>\uD83D\uDCF8 Anexar ${fotosArr.length===1?'foto':'fotos'} ${_isTrilho?'do trilho':'da polaroid'} <span style="font-weight:600;color:#B45309;">(${fotosArr.filter(f=>!!f).length}/${fotosArr.length})</span></span>
                ${allFilled ? `<span style="font-size:9.5px;color:#166534;background:#DCFCE7;padding:2px 8px;border-radius:5px;font-weight:700;">\u2713 Pronto</span>` : ''}
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:5px;">
                ${fotosArr.map((p, idx) => p ? `
                  <div style="position:relative;aspect-ratio:3/4;border-radius:5px;overflow:hidden;border:2px solid #D97706;">
                    <img src="${p}" style="width:100%;height:100%;object-fit:cover;cursor:pointer;" data-pdv-polaroid-pick="${it.id}" data-pdv-polaroid-idx="${idx}" title="Trocar foto ${idx+1}"/>
                    <button type="button" data-pdv-polaroid-rm="${it.id}" data-pdv-polaroid-idx="${idx}" style="position:absolute;top:-1px;right:-1px;width:16px;height:16px;border-radius:50%;background:#9F1239;color:#fff;border:none;font-size:9px;font-weight:700;cursor:pointer;line-height:1;">\u00D7</button>
                  </div>
                ` : `
                  <label style="cursor:pointer;display:block;">
                    <div style="aspect-ratio:3/4;border-radius:5px;border:2px dashed #D97706;background:#FFFBEB;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2px;">
                      <span style="font-size:14px;color:#D97706;font-weight:700;line-height:1;">\uFF0B</span>
                      <span style="font-size:8.5px;color:#92400E;font-weight:700;line-height:1.1;margin-top:1px;">Foto ${idx+1}</span>
                    </div>
                    <input type="file" accept="image/*" style="display:none;" data-pdv-polaroid-file="${it.id}" data-pdv-polaroid-idx="${idx}"/>
                  </label>
                `).join('')}
              </div>
            </div>` : '';
          return `
          <div style="border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:10px;padding:10px 4px;">
              ${imgUrl
                ? `<img src="${imgUrl}" loading="lazy" decoding="async" fetchpriority="low"
                    style="width:44px;height:44px;border-radius:6px;object-fit:cover;background:#F3F4F6;flex-shrink:0;"
                    onerror="this.style.display='none'"/>`
                : `<div style="width:44px;height:44px;border-radius:6px;background:var(--rose-l);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">\uD83C\uDF38</div>`}
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${it.name}${it.promoApplied?` <span style="font-size:9px;background:#DC2626;color:#fff;padding:1px 5px;border-radius:3px;font-weight:700;">PROMO</span>`:''}</div>
                <div style="font-size:10px;color:var(--muted);margin-top:2px;">
                  ${it.promoApplied && it.originalPrice ? `<span style="text-decoration:line-through;color:#94A3B8;">R$ ${(it.originalPrice).toFixed(2).replace('.',',')}</span> <span style="color:#DC2626;font-weight:700;">R$ ${(it.price||0).toFixed(2).replace('.',',')}</span>` : `R$ ${(it.price||0).toFixed(2).replace('.',',')}`} \u00B7 un${it.promoApplied && it.promoLabel ? ` \u00B7 \uD83C\uDFAF ${it.promoLabel}` : ''}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:2px;">
                <button class="btn btn-ghost btn-xs" data-dec="${it.id}" style="width:26px;height:26px;padding:0;font-size:13px;">\u2212</button>
                <span style="min-width:24px;text-align:center;font-weight:700;font-size:13px;">${it.qty}</span>
                <button class="btn btn-ghost btn-xs" data-inc="${it.id}" style="width:26px;height:26px;padding:0;font-size:13px;">+</button>
              </div>
              <div style="font-weight:700;color:var(--rose);font-size:13px;min-width:64px;text-align:right;">R$ ${((it.price||0)*(it.qty||0)).toFixed(2).replace('.',',')}</div>
            </div>
            ${polaroidBlock}
          </div>`;
        }).join('')}
      </div>
      <div style="padding:12px 14px;background:var(--cream);border-radius:8px;margin-top:10px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px;">
          <span>Subtotal:</span><span>R$ ${sub.toFixed(2).replace('.',',')}</span>
        </div>
        ${(PDV.discount||0)>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--leaf);margin-bottom:3px;">
          <span>🟢 Desconto:</span><span>- R$ ${(PDV.discount||0).toFixed(2).replace('.',',')}</span>
        </div>`:''}
        ${(PDV.surcharge||0)>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#B45309;margin-bottom:3px;">
          <span>🔴 Acréscimo:</span><span>+ R$ ${(PDV.surcharge||0).toFixed(2).replace('.',',')}</span>
        </div>`:''}
        ${deliveryFee>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:3px;">
          <span>Taxa:</span><span>R$ ${deliveryFee.toFixed(2).replace('.',',')}</span>
        </div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:var(--ink);margin-top:6px;padding-top:6px;border-top:1px solid var(--border);">
          <span>Total:</span><span style="color:var(--rose);">R$ ${total.toFixed(2).replace('.',',')}</span>
        </div>
      </div>
    `}
  </div>`;

  return `<div class="pdv-grid">
<!-- COLUNA ESQUERDA: Cliente + Carrinho -->
<div>
  ${clienteCardHTML}
  ${carrinhoHTML}
</div>

<!-- COLUNA DIREITA: Pedido (destinatário, entrega, pagamento) -->
<div>
<div class="card">
  <div class="card-title">\uD83D\uDCDD Detalhes do Pedido</div>

  <!-- DESTINAT\u00C1RIO E CART\u00C3O -->
  <div class="fg"><label class="fl">Destinat\u00E1rio <span style="color:var(--red,#DC2626)">*</span></label><input class="fi" id="pdv-recipient" placeholder="Nome de quem vai receber" value="${PDV.recipient}" required/></div>
  <div class="fg"><label class="fl">WhatsApp / Telefone do destinat\u00E1rio <span style="color:var(--red,#DC2626)">*</span></label><input class="fi" id="pdv-recip-phone" type="tel" placeholder="(92) 9xxxx-xxxx" value="${PDV.recipientPhone||''}" required/></div>
  <div class="fg"><label class="fl">Mensagem do cart\u00E3o <span style="color:var(--red,#DC2626)">*</span> <span style="font-size:10px;color:var(--muted);font-weight:400;">(se nao houver, deixe em branco que vira 'SEM MENSAGEM CARTAO')</span></label><textarea class="fi" id="pdv-cardmsg" rows="2" placeholder="Mensagem para o cart\u00E3o...">${PDV.cardMessage}</textarea>
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-top:3px;">
      <span id="pdv-cardmsg-warn" style="font-size:10px;color:#B45309;font-weight:700;line-height:1.3;display:${(!((PDV.cart||[]).some(it=>/pergaminho/i.test(String(it.name||'')))) && (PDV.cardMessage||'').length>200)?'block':'none'};">\u26A0\uFE0F A mensagem passou de 200 caracteres. Ofere\u00E7a o Pergaminho ao cliente (sobe pra ilimitado) ou pe\u00E7a pra encurtar.</span>
      <span id="pdv-cardmsg-count" style="font-size:10px;color:var(--muted);margin-left:auto;white-space:nowrap;">${(PDV.cardMessage||'').length}${(PDV.cart||[]).some(it=>/pergaminho/i.test(String(it.name||'')))?' (ilimitado)':'/200'}</span>
    </div>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Para <span style="font-size:10px;color:var(--muted);font-weight:400;">(no cart\u00E3o, opcional)</span></label><input class="fi" id="pdv-cardpara" placeholder="Ex: Maria" value="${PDV.cardPara||''}"/></div>
    <div class="fg"><label class="fl">De <span style="font-size:10px;color:var(--muted);font-weight:400;">(no cart\u00E3o, opcional)</span></label><input class="fi" id="pdv-cardde" placeholder="Ex: Jo\u00E3o" value="${PDV.cardDe||''}"/></div>
  </div>

  <hr/>
  <!-- DATA E TURNO -->
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCC5 Data e Entrega</div>
  <div class="fr2">
    <div class="fg">
      <label class="fl">Data de entrega <span style="color:var(--red)">*</span></label>
      <div style="display:flex;gap:4px;align-items:stretch;">
        <input class="fi" type="date" id="pdv-date" style="flex:1;min-width:0;border-color:${!PDV.deliveryDate&&(PDV.type==='Delivery'||PDV.type==='Retirada')?'var(--red)':''}" value="${PDV.deliveryDate}"/>
        <button type="button" class="btn btn-ghost btn-sm" id="pdv-date-hoje" style="padding:6px 10px;font-size:11px;white-space:nowrap;">Hoje</button>
        <button type="button" class="btn btn-ghost btn-sm" id="pdv-date-amanha" style="padding:6px 10px;font-size:11px;white-space:nowrap;">Amanhã</button>
      </div>
    </div>
    <div class="fg"><label class="fl">Turno <span style="color:var(--red)">*</span></label>
      ${(() => {
        // 06/jun/2026: garante que dateSpecialHours esta carregado pra
        // exibir 'Comercial' quando a data selecionada tem esse turno ativo.
        _pdvLoadSpecialHours();
        const dt = PDV.deliveryDate || '';
        const showComercial = _pdvComercialAtivo(dt);
        const labelCom = _pdvComercialLabel(dt);
        return `<select class="fi" id="pdv-period">
          <option ${PDV.deliveryPeriod==='Manh\u00E3'?'selected':''}>Manh\u00E3</option>
          <option ${PDV.deliveryPeriod==='Tarde'?'selected':''}>Tarde</option>
          <option ${PDV.deliveryPeriod==='Noite'?'selected':''}>Noite</option>
          ${showComercial ? `<option ${PDV.deliveryPeriod==='Comercial'?'selected':''}>Comercial${labelCom ? ' ('+labelCom+')' : ''}</option>` : ''}
          <option ${PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico'?'selected':''}>Hor\u00E1rio espec\u00EDfico</option>
        </select>
        ${showComercial ? `<div style="font-size:10px;color:#1E40AF;margin-top:3px;font-weight:600;">\uD83C\uDFE2 Turno Comercial dispon\u00EDvel nesta data (alta demanda)</div>` : ''}`;
      })()}
    </div>
  </div>
  <!-- BANNER de vagas (renderizado dinamicamente quando data com limite) -->
  <div id="pdv-vagas-banner" style="display:none;margin-top:8px;"></div>
  ${PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico'?(() => {
    // Gera opcoes de 30 em 30 min entre 07:00 e 20:00
    const opts = [];
    for (let h = 7; h <= 20; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === 20 && m > 0) break;
        opts.push(String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0'));
      }
    }
    const optHTML = (selected) => '<option value="">--:--</option>' +
      opts.map(t => `<option value="${t}" ${selected===t?'selected':''}>${t}</option>`).join('');
    return `
  <div class="fg">
    <label class="fl">Hor\u00E1rio Espec\u00EDfico * <span style="font-size:10px;color:var(--muted)">(ex: Entre 10:00 e 11:00)</span></label>
    <div class="fr2">
      <div><label class="fl" style="font-size:10px">Das</label>
        <select class="fi" id="pdv-time-from">${optHTML(PDV.deliveryTimeFrom||'')}</select></div>
      <div><label class="fl" style="font-size:10px">At\u00E9</label>
        <select class="fi" id="pdv-time-to">${optHTML(PDV.deliveryTimeTo||'')}</select></div>
    </div>
    <div style="font-size:11px;color:var(--blue);margin-top:4px;">\uD83D\uDD34 Marcado como PRIORIDADE na expedi\u00E7\u00E3o</div>
  </div>`;
  })():''}

  <!-- TIPO DE ENTREGA -->
  <div class="fg"><label class="fl">Tipo de Entrega</label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${tiposPermitidos.map(t => {
        const key = tipoSlugToKey[t];
        return `<button class="btn btn-sm ${PDV.type===key?'btn-primary':'btn-ghost'}" data-type="${key}">${tipoKeyLabel[key]}</button>`;
      }).join('')}
    </div>
  </div>

  ${PDV.type==='Retirada' && destinosRetirada.length > 0 ? `
  <div class="fg"><label class="fl">Retirada em <span style="color:var(--red)">*</span></label>
    <select class="fi" id="pdv-pickup-unit">
      ${destinosRetirada.length > 1 ? `<option value="">Selecionar loja...</option>` : ''}
      ${destinosRetirada.map(d => `<option value="${d}" ${normalizeUnidade(PDV.pickupUnit)===d?'selected':''}>\uD83C\uDF3A ${labelUnidade(d)}</option>`).join('')}
    </select>
  </div>`:''}

  ${PDV.type==='Balc\u00E3o' && destinosBalcao.length > 1 ? `
  <div class="fg"><label class="fl">Balc\u00E3o em <span style="color:var(--red)">*</span></label>
    <select class="fi" id="pdv-pickup-unit">
      <option value="">Selecionar loja...</option>
      ${destinosBalcao.map(d => `<option value="${d}" ${normalizeUnidade(PDV.pickupUnit)===d?'selected':''}>\uD83C\uDF3A ${labelUnidade(d)}</option>`).join('')}
    </select>
  </div>`:''}

  ${PDV.type==='Delivery'?`
  <hr/>
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCB0 Taxa de Entrega</div>
  <div class="fr2">
    <div class="fg"><label class="fl">Cidade <span style="color:var(--red)">*</span></label>
      <select class="fi" id="pdv-city-sel" style="border-color:${!PDV.city?'var(--red)':''};">
        <option value="">Selecionar cidade...</option>
        ${Object.keys(DELIVERY_FEES).map(c=>`<option value="${c}" ${PDV.city===c?'selected':''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Zona / Bairro <span style="color:var(--red)">*</span></label>
      <select class="fi" id="pdv-zone-sel" ${!PDV.city?'disabled':''} style="border-color:${!PDV.zone&&PDV.city?'var(--red)':''};">
        <option value="">Selecionar zona...</option>
        ${PDV.city&&DELIVERY_FEES[PDV.city]?Object.entries(DELIVERY_FEES[PDV.city]).map(([z,v])=>`<option value="${z}" ${PDV.zone===z?'selected':''}>${z} \u2014 ${$c(v)}</option>`).join(''):''}
      </select>
    </div>
  </div>
  ${PDV.deliveryFee>0?`<div style="background:var(--gold-l);border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:8px;">\uD83D\uDE9A Taxa: <strong>${$c(PDV.deliveryFee)}</strong></div>`:''}
  <hr/>
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\uD83D\uDCCD Endere\u00E7o de Entrega</div>
  <div class="fg"><label class="fl">Rua / Avenida <span style="color:var(--red)">*</span></label>
    <input class="fi" id="pdv-street" placeholder="Rua das Flores" value="${PDV.street}" required
      style="border-color:${!PDV.street?'var(--red)':''};"/></div>
  <div class="fr3">
    <div class="fg"><label class="fl">N\u00FAmero <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-number" placeholder="123" value="${PDV.number}"
        style="border-color:${!PDV.number?'var(--red)':''};"/></div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Bairro <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-neighborhood" style="border-color:${!PDV.neighborhood?'var(--red)':''}"
        placeholder="Selecione ou digite o bairro..." value="${PDV.neighborhood}" list="bairros-manaus-pdv" autocomplete="off"/>
      <datalist id="bairros-manaus-pdv">${BAIRROS_MANAUS.map(b=>`<option value="${b}">`).join('')}</datalist>
    </div>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Cidade <span style="color:var(--red)">*</span></label>
      <input class="fi" id="pdv-city" value="Manaus" readonly style="background:var(--cream);color:var(--muted);"/>
    </div>
    <div class="fg">
      <label class="fl">CEP <span style="font-size:10px;color:var(--muted);font-weight:400;">(preenche rua e bairro automaticamente)</span></label>
      <div style="position:relative;">
        <input class="fi" id="pdv-cep" placeholder="69000-000" value="${PDV.cep}" maxlength="9" inputmode="numeric" autocomplete="postal-code"/>
        <div id="pdv-cep-status" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:11px;pointer-events:none;"></div>
      </div>
      <div id="pdv-cep-msg" style="font-size:11px;margin-top:3px;display:none;"></div>
    </div>
  </div>
  <div class="fg"><label class="fl">Ponto de refer\u00EAncia</label><input class="fi" id="pdv-ref" placeholder="Pr\u00F3ximo ao mercado..." value="${PDV.reference}"/></div>
  <label class="cb" style="margin-bottom:10px;"><input type="checkbox" id="pdv-condo" ${PDV.isCondominium?'checked':''}/><span style="font-size:12px">\u00C9 condom\u00EDnio?</span></label>
  ${PDV.isCondominium?`
  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Nome do Condom\u00EDnio *</label>
      <input class="fi" id="pdv-cond-name" placeholder="Ex: Condom\u00EDnio Mirante do Rio" value="${PDV.condName}" required/>
    </div>
    <div class="fg"><label class="fl">Bloco *</label><input class="fi" id="pdv-block" placeholder="Bloco A" value="${PDV.block}" required/></div>
    <div class="fg"><label class="fl">Apartamento *</label><input class="fi" id="pdv-apt" placeholder="Ap 42" value="${PDV.apt}" required/></div>
  </div>`:''}
  `:''}

  <hr/>
  <!-- OP\u00C7\u00D5ES -->
  <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--ink)">\u2699\uFE0F Op\u00E7\u00F5es</div>
  <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
    <label class="cb"><input type="checkbox" id="pdv-notify" ${PDV.notifyClient?'checked':''}/><div><div style="font-size:12px;font-weight:500">\uD83D\uDCF1 Notificar cliente sobre entrega</div><div style="font-size:10px;color:var(--muted)">Enviar WhatsApp quando entregue</div></div></label>
    <label class="cb"><input type="checkbox" id="pdv-identify" ${PDV.identifyClient?'checked':''}/><div><div style="font-size:12px;font-weight:500">\uD83D\uDC64 Identificar remetente na entrega</div><div style="font-size:10px;color:var(--muted)">Revelar quem enviou ao destinat\u00E1rio</div></div></label>
  </div>

  <div class="fg"><label class="fl">Observa\u00E7\u00F5es</label><textarea class="fi" id="pdv-notes" rows="2" placeholder="Observa\u00E7\u00F5es...">${PDV.notes}</textarea></div>

  <hr/>
  <!-- PAGAMENTO -->
  <!-- Marcia (09/jun/2026): desconto em R$ OU %, alternavel. Quando
       em %, calcula sobre o subtotal+frete e atualiza PDV.discount em R$ -->
  <div class="fr2">
    <div class="fg">
      <label class="fl" style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
        <span>🟢 Desconto</span>
        <span style="display:inline-flex;background:#F1F5F9;border-radius:8px;padding:2px;font-size:10px;">
          <button type="button" data-pdv-disc-mode="rs" style="background:${(PDV.discountMode||'rs')==='rs'?'#15803D':'transparent'};color:${(PDV.discountMode||'rs')==='rs'?'#fff':'#475569'};border:none;border-radius:6px;padding:3px 9px;font-weight:700;font-size:10px;cursor:pointer;">R$</button>
          <button type="button" data-pdv-disc-mode="pct" style="background:${PDV.discountMode==='pct'?'#15803D':'transparent'};color:${PDV.discountMode==='pct'?'#fff':'#475569'};border:none;border-radius:6px;padding:3px 9px;font-weight:700;font-size:10px;cursor:pointer;">%</button>
        </span>
      </label>
      ${PDV.discountMode==='pct' ? `
        <div style="position:relative;">
          <input class="fi" type="number" step="0.5" min="0" max="100" id="pdv-disc-pct" placeholder="0" value="${PDV.discountPct||''}" style="padding-right:34px;"/>
          <span style="position:absolute;right:12px;top:50%;transform:translateY(-50%);font-weight:700;color:#15803D;pointer-events:none;">%</span>
        </div>
        ${(PDV.discount||0) > 0 ? `<div style="font-size:10px;color:var(--muted);margin-top:3px;">= R$ ${(PDV.discount).toFixed(2).replace('.',',')}</div>` : ''}
      ` : `
        <input class="fi" type="number" step="0.01" min="0" id="pdv-disc" placeholder="0,00" value="${PDV.discount||''}"/>
      `}
    </div>
    <div class="fg"><label class="fl">🔴 Acréscimo (R$)</label><input class="fi" type="number" step="0.01" min="0" id="pdv-surcharge" placeholder="0,00" value="${PDV.surcharge||''}"/></div>
  </div>
  <div class="fg">
    <label class="fl">Forma de Pgto</label>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
      ${[
        {v:'Pix',                 i:'\uD83D\uDCF1', l:'Pix'},
        {v:'Link',                i:'\uD83D\uDD17', l:'Link'},
        {v:'Cart\u00E3o',         i:'\uD83D\uDCB3', l:'Cart\u00E3o'},
        {v:'Dinheiro',            i:'\uD83D\uDCB5', l:'Dinheiro'},
        {v:'Pagar na Entrega',    i:'\uD83D\uDE9A', l:'Na Entrega'},
        {v:'Bemol',               i:'\uD83C\uDFE6', l:'Bemol'},
        {v:'Giuliana',            i:'\uD83D\uDCB0', l:'Giuliana'},
        {v:'iFood',               i:'\uD83C\uDF54', l:'iFood'},
        // 06/jun/2026: opcao pra dividir o valor em 2+ formas
        {v:'Multiplo',            i:'\uD83D\uDD00', l:'M\u00FAltiplas'}
      ].map(p=>{
        const sel = PDV.payment===p.v;
        return `<button type="button" data-pay="${p.v}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:70px;border:1.5px solid ${sel?'var(--rose)':'var(--line,#e5e7eb)'};background:${sel?'var(--petal,#fce7f0)':'#fff'};border-radius:10px;cursor:pointer;transition:all .15s;padding:8px 6px;" onmouseover="this.style.background='${sel?'var(--petal,#fce7f0)':'var(--cream,#faf7f2)'}'" onmouseout="this.style.background='${sel?'var(--petal,#fce7f0)':'#fff'}'"><span style="font-size:20px;line-height:1;">${p.i}</span><span style="font-size:11px;font-weight:${sel?'600':'500'};color:${sel?'var(--rose)':'var(--ink,#333)'};">${p.l}</span></button>`;
      }).join('')}
    </div>
  </div>

  ${PDV.payment==='Multiplo' ? (() => {
    // 06/jun/2026: painel de split de pagamento
    if (!Array.isArray(PDV.paymentSplits) || PDV.paymentSplits.length === 0) {
      PDV.paymentSplits = [
        { method:'Pix',      amount:(total/2).toFixed(2) },
        { method:'Dinheiro', amount:(total/2).toFixed(2) },
      ];
    }
    const METODOS = ['Pix','Link','Cart\u00E3o','Dinheiro','Bemol','Giuliana','iFood'];
    const somaSplits = PDV.paymentSplits.reduce((s, sp) => s + (parseFloat(sp.amount)||0), 0);
    const dif = total - somaSplits;
    const valido = Math.abs(dif) < 0.01 && PDV.paymentSplits.every(sp => sp.method && (parseFloat(sp.amount)||0) > 0);
    return `
    <div style="background:linear-gradient(135deg,#EFF6FF,#fff);border:1.5px solid #93C5FD;border-radius:10px;padding:14px;margin-bottom:8px;">
      <div style="font-size:12px;font-weight:700;color:#1E40AF;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <span>\uD83D\uDD00 M\u00FAltiplas formas de pagamento</span>
        <span style="font-size:11px;background:#fff;color:#1E40AF;padding:3px 9px;border-radius:8px;border:1px solid #BFDBFE;">Total: ${$c(total)}</span>
      </div>
      <div id="pdv-splits" style="display:flex;flex-direction:column;gap:6px;">
        ${PDV.paymentSplits.map((sp, i) => `
          <div style="display:grid;grid-template-columns:1fr 130px 30px;gap:6px;align-items:center;">
            <select class="fi" data-split-method="${i}" style="font-size:12px;padding:6px 8px;">
              <option value="">\u2014 m\u00E9todo \u2014</option>
              ${METODOS.map(m => `<option value="${m}" ${sp.method===m?'selected':''}>${m}</option>`).join('')}
            </select>
            <div style="display:flex;align-items:center;gap:4px;background:#fff;border:1.5px solid #BFDBFE;border-radius:6px;padding:0 8px;">
              <span style="font-size:11px;color:var(--muted);">R$</span>
              <input type="number" step="0.01" min="0" data-split-amount="${i}" value="${sp.amount||''}" placeholder="0,00"
                style="border:none;outline:none;padding:7px 0;font-size:13px;font-weight:600;width:100%;color:#1E40AF;"/>
            </div>
            <button type="button" data-split-remove="${i}" title="Remover" style="background:#FEE2E2;color:#991B1B;border:none;border-radius:5px;width:28px;height:28px;cursor:pointer;font-size:12px;font-weight:700;" ${PDV.paymentSplits.length<=2?'disabled':''}>\u2715</button>
          </div>
        `).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:8px;">
        <button type="button" id="pdv-split-add" ${PDV.paymentSplits.length>=4?'disabled':''} style="background:#fff;border:1.5px dashed #93C5FD;color:#1E40AF;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">+ Adicionar forma</button>
        <div style="font-size:12px;font-weight:700;color:${valido ? '#15803D' : '#92400E'};background:${valido ? '#DCFCE7' : '#FEF3C7'};padding:5px 11px;border-radius:6px;">
          ${valido
            ? `\u2705 Soma OK: ${$c(somaSplits)}`
            : `\u26A0\uFE0F Soma: ${$c(somaSplits)} \u00B7 Falta ${$c(Math.abs(dif))} ${dif<0?'(passou)':'(pra completar)'}`}
        </div>
      </div>
    </div>`;
  })() : ''}
  ${PDV.type==='Retirada'?`
  <div style="background:linear-gradient(135deg,#FAE8E6,#FEF3C7);border-radius:var(--r);padding:14px;border:1px solid #FCD34D;margin-bottom:8px;">
    <div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:10px;">\uD83D\uDCE6 Como o cliente quer pagar?</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px;">
      ${[
        {k:'pago', l:'\u2705 Pago', sub:'j\u00E1 pagou tudo agora'},
        {k:'total_retirada', l:'\uD83C\uDFEA Total na retirada', sub:'paga tudo ao retirar'},
        {k:'parcial', l:'\uD83D\uDCB3 50% agora + 50% depois', sub:'parte agora, parte na retirada'},
      ].map(o => {
        const sel = PDV.pickupPayMode === o.k;
        return `<button type="button" data-pickup-mode="${o.k}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:64px;border:1.5px solid ${sel?'#B45309':'#E5E7EB'};background:${sel?'#FEF3C7':'#fff'};border-radius:8px;cursor:pointer;padding:6px;text-align:center;">
          <span style="font-size:12px;font-weight:${sel?'700':'600'};color:${sel?'#7C2D12':'#374151'};">${o.l}</span>
          <span style="font-size:10px;color:#6B7280;">${o.sub}</span>
        </button>`;
      }).join('')}
    </div>
    ${PDV.pickupPayMode === 'pago' ? `
      <div style="margin-top:8px;background:#DCFCE7;border:1px solid #86EFAC;border-radius:8px;padding:8px 12px;font-size:12px;color:#065F46;font-weight:700;">
        \u2705 Pago Total \u2014 pedido ser\u00E1 dado baixa como <strong>Aprovado</strong>
      </div>
    ` : ''}
    ${PDV.pickupPayMode === 'total_retirada' ? `
      <div style="margin-top:8px;background:#fff;border-radius:8px;padding:10px 12px;font-size:11px;color:var(--ink2);">
        \uD83C\uDFEA Cliente vai pagar <strong>${$c(total)}</strong> ao retirar. Pedido fica como <strong>Ag. Pagamento na Retirada</strong>.
      </div>
    ` : ''}
    ${PDV.pickupPayMode === 'parcial' ? (() => {
      // Marcia (09/jun/2026): 2 ajustes:
      //  a) Auto-preenche o metodo parcial com a forma de pagamento
      //     ja escolhida em cima (se for Pix ou Link).
      //  b) Auto-preenche o valor pago em 50% se estiver vazio
      //     (antes ficava undefined no state e bloqueava finalizar).
      if (!PDV.pickupParcialMethod && (PDV.payment === 'Pix' || PDV.payment === 'Link')) {
        PDV.pickupParcialMethod = PDV.payment;
      }
      if ((PDV.pickupParcialPago === undefined || PDV.pickupParcialPago === null || PDV.pickupParcialPago === '') && total > 0) {
        PDV.pickupParcialPago = (total/2).toFixed(2);
      }
      return `
      <div style="margin-top:8px;background:#fff;border-radius:8px;padding:12px;">
        <div style="font-size:11px;font-weight:600;color:var(--ink);margin-bottom:8px;">\uD83D\uDCB3 Pagamento agora \u2014 escolher m\u00E9todo:</div>
        <div style="display:flex;gap:6px;margin-bottom:10px;">
          <button type="button" data-pickup-parcial-method="Pix" class="btn btn-sm ${PDV.pickupParcialMethod==='Pix'?'btn-green':'btn-ghost'}" style="flex:1;justify-content:center;padding:8px;">\uD83D\uDCF1 Pix</button>
          <button type="button" data-pickup-parcial-method="Link" class="btn btn-sm ${PDV.pickupParcialMethod==='Link'?'btn-green':'btn-ghost'}" style="flex:1;justify-content:center;padding:8px;">\uD83D\uDD17 Link</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <label style="font-size:11px;font-weight:600;color:var(--ink);">Valor pago agora:</label>
          <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:140px;">
            <span style="font-size:12px;color:var(--muted);">R$</span>
            <input type="number" step="0.01" min="0" max="${total}" id="pdv-pickup-parcial-amt" value="${PDV.pickupParcialPago||(total/2).toFixed(2)}" placeholder="${(total/2).toFixed(2)}"
              style="flex:1;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:600;color:var(--rose);"/>
          </div>
          <button type="button" id="pdv-pickup-parcial-50" class="btn btn-ghost btn-xs" style="padding:6px 10px;font-size:11px;" title="Define 50%">50%</button>
        </div>
        ${(() => {
          const pago = parseFloat(PDV.pickupParcialPago) || (total/2);
          const resta = Math.max(0, total - pago);
          const valido = pago > 0 && pago < total;
          return `
            <div style="background:${valido?'#F0FDF4':'#FEF3C7'};border-radius:6px;padding:8px 10px;font-size:11px;color:${valido?'#065F46':'#92400E'};font-weight:600;">
              ${valido
                ? `\uD83D\uDCB0 <strong>${$c(pago)}</strong> agora via ${PDV.pickupParcialMethod||'?'} \u00B7 \uD83C\uDFEA <strong>${$c(resta)}</strong> ao retirar`
                : `\u26A0\uFE0F Valor pago agora deve ser maior que 0 e menor que o total (${$c(total)})`}
            </div>
          `;
        })()}
        ${!PDV.pickupParcialMethod?`<div style="margin-top:6px;font-size:11px;color:#92400E;">\u26A0\uFE0F Selecione Pix ou Link para o pagamento agora</div>`:''}
      </div>
    `;
    })() : ''}
    ${!PDV.pickupPayMode?`<div style="margin-top:6px;font-size:11px;color:#92400E;font-weight:500;">\u26A0\uFE0F Escolha como o cliente vai pagar</div>`:''}
  </div>`:''}

  ${PDV.payment==='Pagar na Entrega'?`
  <div style="background:var(--gold-l);border-radius:var(--r);padding:14px;border:1px solid rgba(183,134,15,.2);margin-bottom:8px;">
    <div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px;">\uD83D\uDCB0 Como o cliente vai pagar na entrega?</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-sm ${PDV.paymentOnDelivery==='Dinheiro'?'btn-green':'btn-ghost'}" data-pod="Dinheiro" style="flex:1;justify-content:center;padding:10px;">
        \uD83D\uDCB5 Dinheiro
      </button>
      <button class="btn btn-sm ${PDV.paymentOnDelivery==='Levar Maquineta'?'btn-green':'btn-ghost'}" data-pod="Levar Maquineta" style="flex:1;justify-content:center;padding:10px;">
        \uD83D\uDCB3 Levar Maquineta
      </button>
    </div>
    ${PDV.paymentOnDelivery==='Dinheiro'?`
    <div style="margin-top:8px;background:#fff;border-radius:8px;padding:10px 12px;">
      <div style="font-size:11px;color:var(--ink2);margin-bottom:8px;">
        \uD83D\uDCB5 Entregador cobrar\u00E1 <strong>${$c(total)}</strong> em dinheiro.
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <label style="font-size:11px;font-weight:600;color:var(--ink);">Troco para:</label>
        <div style="display:flex;align-items:center;gap:4px;flex:1;min-width:140px;">
          <span style="font-size:12px;color:var(--muted);">R$</span>
          <input type="number" step="0.01" min="0" id="pdv-troco-para" value="${PDV.trocoPara||''}" placeholder="Ex: 100.00"
            style="flex:1;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;"/>
        </div>
        <button type="button" id="pdv-troco-sem" class="btn btn-ghost btn-xs" style="padding:6px 10px;font-size:11px;">Sem troco</button>
      </div>
      ${PDV.trocoPara && parseFloat(PDV.trocoPara) > total ? `
      <div style="margin-top:8px;background:var(--leaf-l);border-radius:6px;padding:6px 10px;font-size:11px;color:var(--leaf);font-weight:600;">
        💰 Levar <strong>${$c(parseFloat(PDV.trocoPara) - total)}</strong> de troco
      </div>` : (PDV.trocoPara && parseFloat(PDV.trocoPara) <= total ? `
      <div style="margin-top:8px;background:#FFF8E1;border-radius:6px;padding:6px 10px;font-size:11px;color:#92400E;">
        ⚠️ Valor do troco menor/igual ao total — verifique.
      </div>` : '')}
    </div>`:''}
    ${PDV.paymentOnDelivery==='Levar Maquineta'?`
    <div style="margin-top:8px;background:#fff;border-radius:8px;padding:8px 10px;font-size:11px;color:var(--ink2);">
      \uD83D\uDCB3 Entregador deve levar a maquineta \u2014 D\u00E9bito, Cr\u00E9dito ou Pix. Valor: <strong>${$c(total)}</strong>
    </div>`:''}
    ${!PDV.paymentOnDelivery?`<div style="margin-top:8px;font-size:11px;color:var(--gold);font-weight:500;">\u26A0\uFE0F Selecione como o entregador vai cobrar</div>`:''}
  </div>`:''}

  <hr/>
  <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px"><span>Subtotal</span><span>${$c(sub)}</span></div>
  ${PDV.discount>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--leaf);margin-bottom:4px"><span>\uD83D\uDFE2 Desconto</span><span>\u2212${$c(PDV.discount)}</span></div>`:''}
  ${PDV.surcharge>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:#B45309;margin-bottom:4px"><span>\uD83D\uDD34 Acr\u00E9scimo</span><span>+${$c(PDV.surcharge)}</span></div>`:''}
  ${deliveryFee>0?`<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--gold);margin-bottom:4px"><span>\uD83D\uDE9A Taxa entrega</span><span>+${$c(deliveryFee)}</span></div>`:''}
  <div style="display:flex;justify-content:space-between;font-size:16px;font-weight:700;color:var(--rose);margin-bottom:12px"><span>Total</span><span>${$c(total)}</span></div>
  <button type="button" class="btn btn-primary" id="btn-fin" onclick="finalizePDV()" style="width:100%;justify-content:center;padding:11px;font-size:13px">\u2705 Finalizar \u2014 ${$c(total)}</button>
</div>
</div>
</div>`;
}

// ── Finalizar PDV ────────────────────────────────────────────
export async function finalizePDV(){
  // Rastreia cliques impacientes (mais de 3x em 10s = alerta).
  import('../services/colabAlerts.js').then(m => m.trackImpatientClick?.('Finalizar Pedido (PDV)')).catch(()=>{});
  if(_pdvLock) return toast('\u23F3 Processando pedido, aguarde...');

  // LOCK CROSS-TAB via localStorage \u2014 bloqueia se OUTRA aba/maquina
  // tentou finalizar o mesmo cliente+total nos ultimos 30s.
  // Resolve duplicacao por:
  //  - Double-click ou double-tap em touchscreen
  //  - 2 vendedoras logadas na mesma conta
  //  - Sistema travou, vendedora abriu nova aba
  let _lockKey = '';
  try {
    const phone = String(PDV.clientPhone||'').replace(/\D/g,'');
    const sub = PDV.cart.reduce((s,i)=>s+i.price*i.qty,0);
    const total = sub + (PDV.type==='Delivery'?(PDV.deliveryFee||0):0) - (PDV.discount||0) + (PDV.surcharge||0);
    if (phone && total > 0) {
      // Marcia (02/jun/2026): chave inclui hash do carrinho \u2014 antes
      // 2 pedidos DIFERENTES com mesmo total pra mesma cliente colidiam.
      const cartSig = PDV.cart.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))
        .map(i => `${i.id}:${i.qty}:${i.colorName||''}`).join('|').slice(0, 80);
      _lockKey = 'fv_pdv_lock_' + phone + '_' + total.toFixed(2) + '_' + cartSig;
      const lockUntil = parseInt(localStorage.getItem(_lockKey) || '0', 10);
      if (lockUntil > Date.now()) {
        const secs = Math.ceil((lockUntil - Date.now()) / 1000);
        return toast('\u23F3 Esse mesmo pedido ja esta sendo finalizado. Aguarde '+secs+'s...', true);
      }
      try { localStorage.setItem(_lockKey, String(Date.now() + 30000)); }
      catch(_) { /* quota — segue sem lock cross-tab */ }
    }
  } catch(_) {}

  _pdvLock = true;
  const btn = document.getElementById('btn-fin');
  if(btn){ btn.disabled=true; btn.textContent='\u23F3 Finalizando...'; }

  // Marcia (02/jun/2026): LIMPEZA PREVENTIVA antes de finalizar.
  // Em pico de Namorados (350 ped/dia) caches enchiam o localStorage
  // ANTES do POST do pedido \u2014 entao a quota era atingida na escrita
  // do proprio orderId/notificacao, ANTES do request, e o usuario
  // via 'erro ao finalizar' SEM o pedido ter sido criado.
  // Agora: checa uso e limpa proativamente se >70% do limite estimado.
  try {
    let usedKB = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) || '';
      usedKB += (k.length + v.length) * 2 / 1024; // UTF-16
    }
    if (usedKB > 3500) { // > ~3.5MB de ~5MB tipico = perto do limite
      const { emergencyCleanup } = await import('../utils/safeStorage.js');
      const result = emergencyCleanup();
      console.warn('[PDV] limpeza preventiva (' + Math.round(usedKB) + 'KB usado)', result);
    }
  } catch(_) {}

  // Flag: o POST foi enviado (e portanto o pedido foi criado no servidor)?
  // Usado pelo handler de erro pra decidir entre 'erro real' vs 'falha pos-POST'
  let _postSent = false;
  try{
    await _finalizePDV({
      onPostSent: () => { _postSent = true; },
    });
  }catch(e){
    const msg = e?.message || '';
    const isQuotaErr = e?.name === 'QuotaExceededError'
                    || /exceeded.*quota|quota.*exceeded|setItem.*Storage/i.test(msg);
    if (isQuotaErr) {
      // Quota acontece tipicamente APOS POST suceder. Limpa lixo.
      console.warn('[PDV] Quota error \u2014 limpando cache');
      try {
        const { emergencyCleanup } = await import('../utils/safeStorage.js');
        emergencyCleanup();
      } catch(_){}
      if (_postSent) {
        toast('\u2705 Pedido criado! (cache local limpo automaticamente)');
      } else {
        // POST nao saiu ainda \u2014 pedido NAO foi criado, avisa pra tentar de novo
        toast('\u26A0\uFE0F Cache estava cheio \u2014 limpei agora. Clique em Finalizar novamente.', true);
      }
    } else if (_postSent) {
      // POST saiu mas algo deu errado depois (provavelmente local). Pedido criado.
      console.warn('[PDV] Erro pos-POST (pedido ja criado):', e);
      toast('\u2705 Pedido criado! (houve um erro pos-salvamento, mas o pedido esta no sistema)');
    } else {
      toast('\u274C Erro ao finalizar: '+(msg||'Tente novamente'), true);
      console.error('[PDV] Erro ao finalizar:', e);
    }
  }finally{
    _pdvLock = false;
    if(btn){ btn.disabled=false; btn.textContent='\u2705 Finalizar Pedido'; }
    // Limpa o lock cross-tab (o pedido ja foi processado pelo servidor)
    if (_lockKey) {
      try { localStorage.removeItem(_lockKey); } catch(_) {}
    }
  }
}

export async function _finalizePDV(opts = {}){
  if(!PDV.cart.length) return toast('\u274C Adicione produtos');
  // Polaroid / trilho: bloqueia se faltar foto (qty \u00D7 fotos por unidade)
  for (const it of PDV.cart) {
    const { precisa, porUni } = _pdvFotoInfo(it);
    if (precisa) {
      const need = it.qty * porUni;
      const fotos = (it.userPhotos || []).filter(p => typeof p === 'string' && p.startsWith('data:'));
      if (fotos.length < need) {
        return toast(`\u274C Faltam fotos pra "${it.name}" (${fotos.length}/${need}). Anexe antes de finalizar.`, true);
      }
    }
  }
  // ── Valida regras multi-unit (frontend) ─────────────────────
  const tipoSlug = PDV.type === 'Balc\u00E3o' ? 'balcao'
                 : PDV.type === 'Retirada' ? 'retirada'
                 : 'delivery';
  // Delivery SEMPRE sai do CDLE (nao depende de pickupUnit nem da unidade
  // do usuario). Retirada usa pickupUnit escolhida pelo atendente. Balcao
  // usa a unidade do proprio usuario.
  let destinoSlug;
  if (tipoSlug === 'delivery') destinoSlug = 'cdle';
  else if (tipoSlug === 'retirada') destinoSlug = normalizeUnidade(PDV.pickupUnit || S.user?.unidade || S.user?.unit);
  else destinoSlug = normalizeUnidade(S.user?.unidade || S.user?.unit);
  const checkUnidade = podeCriarPedido(S.user, tipoSlug, destinoSlug);
  if(!checkUnidade.ok){
    toast('\u274C ' + checkUnidade.reason, true);
    return;
  }
  const validUnitsCheck = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
  if(!validUnitsCheck.includes(S.user.unit)&&!PDV.saleUnit) return toast('\u274C Selecione a unidade de venda');
  // Valida unidade para Admin
  if((S.user.unit==='Todas'||( S.user?.role==='Administrador'||S.user?.cargo==='admin'))&&!PDV.saleUnit) return toast('\u274C Selecione a unidade de venda');
  // Marcia (06/jun/2026): canal de venda OBRIGATORIO
  if(!PDV.salesChannel || !String(PDV.salesChannel).trim()){
    toast('\u274C Selecione o CANAL DE VENDA (WhatsApp / Balc\u00E3o / iFood / Giuliana) antes de finalizar', true);
    document.getElementById('pdv-sales-channel')?.focus();
    return;
  }
  // Marcia (06/jun/2026): se for Multiplo, valida que a soma bate com o total
  if (PDV.payment === 'Multiplo') {
    const splits = Array.isArray(PDV.paymentSplits) ? PDV.paymentSplits : [];
    if (splits.length < 2) return toast('\u274C Multiplas formas: adicione pelo menos 2 formas de pagamento', true);
    if (splits.some(sp => !sp.method || !(parseFloat(sp.amount)||0))) {
      return toast('\u274C Multiplas formas: preencha m\u00E9todo e valor em todas as linhas', true);
    }
    const soma = splits.reduce((s, sp) => s + (parseFloat(sp.amount)||0), 0);
    if (Math.abs(soma - total) > 0.01) {
      return toast(`\u274C Soma das formas (R$${soma.toFixed(2)}) deve ser igual ao total (R$${total.toFixed(2)})`, true);
    }
  }
  // Marcia (09/jun/2026 v2): TIPO DE ENTREGA = Balc\u00E3o dispensa
  // destinatario/telefone do CLIENTE. Antes era pelo canal de venda,
  // mas Marcia esclareceu: as vezes vendem no balcao pra retirada
  // (canal balcao com tipo retirada), e a falta de nome/telefone so
  // faz sentido quando o cliente esta LEVANDO o produto na hora
  // (tipo entrega = Balcao).
  const _isBalcao = PDV.type === 'Balc\u00E3o';
  if (!_isBalcao && !PDV.clientId && !PDV.clientName) return toast('\u274C Informe o nome do cliente');
  if (!_isBalcao && !PDV.clientId && !PDV.clientPhone) return toast('\u274C WhatsApp do cliente \u00E9 obrigat\u00F3rio');
  // ── VALIDA\u00C7\u00D5ES OBRIGAT\u00D3RIAS ──────────────────────────────
  if (!_isBalcao && !PDV.clientId && !PDV.clientName?.trim()){
    toast('\u274C Nome do cliente \u00E9 obrigat\u00F3rio');
    document.getElementById('pdv-phone-search')?.focus();
    return;
  }
  if (!_isBalcao && !PDV.clientId && !PDV.clientPhone?.trim()){
    toast('\u274C WhatsApp do cliente \u00E9 obrigat\u00F3rio');
    return;
  }
  // Balcao: gera nome padrao se vazio
  if (_isBalcao && !PDV.clientId && !PDV.clientName?.trim()) {
    PDV.clientName = 'Cliente Balc\u00E3o';
  }
  if(PDV.type==='Delivery'||PDV.type==='Retirada'){
    if(!PDV.deliveryDate){
      toast('\u274C Data de entrega \u00E9 obrigat\u00F3ria');
      document.getElementById('pdv-date')?.focus();
      return;
    }
    if(!PDV.deliveryPeriod){
      toast('\u274C Turno de entrega \u00E9 obrigat\u00F3rio');
      return;
    }
  }
  if(PDV.type==='Retirada'&&!PDV.pickupUnit){
    toast('\u274C Selecione a loja de retirada');
    return;
  }
  // Retirada: como o cliente quer pagar
  if (PDV.type === 'Retirada') {
    if (!PDV.pickupPayMode) {
      toast('\u274C Selecione como o cliente quer pagar (Pago / Total na retirada / Parcial)');
      return;
    }
    if (PDV.pickupPayMode === 'parcial') {
      if (!PDV.pickupParcialMethod) {
        toast('\u274C Escolha Pix ou Link para o pagamento agora');
        return;
      }
      // Calcula total atual
      let totAtual = 0;
      try {
        totAtual = (PDV.cart||[]).reduce((s,i) => s + (Number(i.price)||0)*(Number(i.qty)||0), 0)
                 - (Number(PDV.discount)||0)
                 + (Number(PDV.surcharge)||0)
                 + (Number(PDV.deliveryFee)||0);
      } catch(_){}
      // Marcia (09/jun/2026): fallback pra 50% do total se nao definido
      // (input mostra esse valor mas pode nao ter sido editado).
      let pago = parseFloat(PDV.pickupParcialPago);
      if (!pago || isNaN(pago)) {
        pago = totAtual / 2;
        PDV.pickupParcialPago = pago.toFixed(2);
      }
      // Valida: > 0 e < total (pendente real, nao zero)
      if (pago <= 0 || pago >= totAtual) {
        toast('\u274C Valor pago agora inv\u00E1lido \u2014 deve ser maior que 0 e menor que o total (' + (window.$c ? window.$c(totAtual) : 'R$ ' + totAtual.toFixed(2)) + ')');
        return;
      }
    }
  }
  if(PDV.type==='Delivery'){
    // Cidade (taxa de entrega)
    if(!PDV.city?.trim()){
      toast('\u274C Selecione a cidade de entrega');
      document.getElementById('pdv-city-sel')?.focus();
      return;
    }
    // Zona (taxa de entrega)
    if(!PDV.zone?.trim()){
      toast('\u274C Selecione a zona / bairro da taxa de entrega');
      document.getElementById('pdv-zone-sel')?.focus();
      return;
    }
    // Rua
    if(!PDV.street?.trim()){
      toast('\u274C Rua / Avenida do endere\u00E7o \u00E9 obrigat\u00F3ria');
      document.getElementById('pdv-street')?.focus();
      return;
    }
    // Numero
    if(!PDV.number?.trim()){
      toast('\u274C N\u00FAmero do endere\u00E7o \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-number')?.focus();
      return;
    }
    // Bairro
    if(!PDV.neighborhood?.trim()){
      toast('\u274C Bairro de entrega \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-neighborhood')?.focus();
      return;
    }
    // Condominio (se marcado)
    if(PDV.isCondominium&&!PDV.condName?.trim()){
      toast('\u274C Nome do condom\u00EDnio \u00E9 obrigat\u00F3rio');
      document.getElementById('pdv-cond-name')?.focus();
      return;
    }
    if(PDV.isCondominium&&(!PDV.block||!PDV.apt)){
      toast('\u274C Bloco e apartamento s\u00E3o obrigat\u00F3rios para condom\u00EDnio');
      return;
    }
  }

  // \u2500\u2500 DESTINATARIO / TELEFONE / MENSAGEM CARTAO \u2500\u2500
  // Regra: pedido precisa de destinatario, telefone do destinatario
  // e mensagem do cartao. Mensagem vazia vira 'SEM MENSAGEM CARTAO'
  // automaticamente (entregador identifica facil que e sem cartao).
  // Marcia (09/jun/2026): TIPO=Balcao dispensa destinatario/telefone
  // do destinatario (cliente leva na hora \u2014 nao precisa de quem recebe).
  if (!_isBalcao) {
    if (!PDV.recipient || !String(PDV.recipient).trim()) {
      toast('\u274C Destinat\u00E1rio \u00E9 obrigat\u00F3rio', true);
      document.getElementById('pdv-recipient')?.focus();
      return;
    }
    if (!PDV.recipientPhone || !String(PDV.recipientPhone).trim()) {
      toast('\u274C WhatsApp/telefone do destinat\u00E1rio \u00E9 obrigat\u00F3rio', true);
      document.getElementById('pdv-recip-phone')?.focus();
      return;
    }
  }
  if (!PDV.cardMessage || !String(PDV.cardMessage).trim()) {
    PDV.cardMessage = 'SEM MENSAGEM CARTAO';
    const cmEl = document.getElementById('pdv-cardmsg');
    if (cmEl) cmEl.value = PDV.cardMessage;
  }
  // ─────────────────────────────────────────────────────────
  const sub=PDV.cart.reduce((s,i)=>s+i.price*i.qty,0);
  const deliveryFee=PDV.type==='Delivery'?(PDV.deliveryFee||0):0;
  const total=sub-(PDV.discount||0)+(PDV.surcharge||0)+deliveryFee;
  const addr=[PDV.street,PDV.number,PDV.neighborhood,PDV.city,
    PDV.isCondominium?`${PDV.condName?PDV.condName+', ':''}Bloco ${PDV.block} Ap ${PDV.apt}`:'',
    PDV.reference].filter(Boolean).join(', ');
  // Determina unidade correta — regras de negocio:
  //  - Delivery sempre sai do CDLE
  //  - Retirada: unidade escolhida no select (PDV.pickupUnit)
  //  - Balcao: unidade de venda (atendente/usuario)
  const validUnits = ['Loja Novo Aleixo','Loja Allegro Mall','CDLE'];
  // Marcia (04/jun/2026): respeita a unidade ESCOLHIDA no dropdown
  // (PDV.saleUnit) — antes ignorava se S.user.unit era valida, fazendo
  // colaboradoras nao conseguirem mudar a unidade do pedido. Agora
  // PDV.saleUnit tem prioridade (default ja vem da unidade do user).
  const userBaseUnit = validUnits.includes(PDV.saleUnit)
    ? PDV.saleUnit
    : (validUnits.includes(S.user.unit) ? S.user.unit : 'Loja Novo Aleixo');
  let orderUnit;
  if (PDV.type === 'Delivery') {
    orderUnit = 'CDLE';
  } else if (PDV.type === 'Retirada' && PDV.pickupUnit) {
    // pickupUnit ja vem como slug (novo_aleixo/allegro) — converte p/ label
    const pu = String(PDV.pickupUnit).toLowerCase();
    orderUnit = pu.includes('allegro') ? 'Loja Allegro Mall'
              : pu.includes('aleixo')  ? 'Loja Novo Aleixo'
              : userBaseUnit;
  } else {
    orderUnit = userBaseUnit;
  }
  const data={
    ...(PDV.clientId ? {client:PDV.clientId} : {}),
    clientName: PDV.clientName||undefined,
    clientPhone: PDV.clientPhone||undefined,
    // CPF/CNPJ + tipo do cliente: copia do cadastro (importante para emissão fiscal)
    ...(() => {
      if(!PDV.clientId) return {};
      const cli = S.clients.find(c => c._id === PDV.clientId);
      if(!cli) return {};
      const tipo = cli.tipoPessoa || 'PF';
      const doc = tipo === 'PJ' ? (cli.cnpj||'').replace(/\D/g,'') : (cli.cpf||'').replace(/\D/g,'');
      const out = { clientTipoPessoa: tipo };
      if(doc) { out.cpfCnpj = doc; out.clientCpf = doc; }
      if(tipo === 'PJ' && cli.inscEstadual) out.clientInscEstadual = cli.inscEstadual;
      return out;
    })(),
    // Items: usa o ID BASE do produto (sem ':color' do carrinho) para o
    // backend conseguir achar e decrementar estoque. Salva colorName/Hex
    // como campos separados para identificar a variacao.
    items:PDV.cart.map(i=>{
      const baseId = String(i.id||'').split(':')[0];
      // Fotos do cliente (polaroid etc): so envia se for produto com
      // upload (nome 'polaroid') e tiver as fotos preenchidas
      let userPhotos;
      if (Array.isArray(i.userPhotos)) {
        const ok = i.userPhotos.filter(p => typeof p === 'string' && p.startsWith('data:'));
        // Corta em qty × fotos por unidade (trilho/cone tem mais de 1).
        const { porUni } = _pdvFotoInfo(i);
        if (ok.length) userPhotos = ok.slice(0, i.qty * porUni);
      }
      return {
        product: baseId,
        name: i.name,
        qty: i.qty,
        unitPrice: i.price,
        totalPrice: i.price*i.qty,
        colorName: i.colorName || undefined,
        colorHex:  i.colorHex  || undefined,
        userPhotos,
      };
    }),
    subtotal:sub,discount:PDV.discount||0,surcharge:PDV.surcharge||0,total,
    payment: PDV.payment === 'Multiplo'
      ? `Múltiplo: ${(PDV.paymentSplits||[]).map(sp => `${sp.method} R$${(parseFloat(sp.amount)||0).toFixed(2)}`).join(' + ')}`
      : PDV.payment,
    paymentSplits: PDV.payment === 'Multiplo'
      ? (PDV.paymentSplits||[]).map(sp => ({ method: sp.method, amount: parseFloat(sp.amount)||0 }))
      : undefined,
    type:PDV.type,
    // Marcia (09/jun/2026): pickupPayMode='pago' (Retirada — 'ja pagou
    // tudo agora') NAO marca mais automaticamente Aprovado.
    // Motivos:
    //  - Se forma=Link: precisa gerar link MP, conflitava com 'ja pago'
    //  - Demais formas: atendente confirma comprovante manualmente
    //    no pop-up "Confirmar pagamento" no Dashboard
    // Regra antiga: pickupPayMode=pago → Aprovado direto
    // Regra nova: pickupPayMode=pago → Aguardando Pagamento (igual outras)
    paymentStatus: PDV.payment==='Pagar na Entrega'
      ? 'Ag. Pagamento na Entrega'
      : (PDV.type==='Retirada' && PDV.pickupPayMode==='total_retirada'
          ? 'Ag. Pagamento na Retirada'
          : (PDV.type==='Retirada' && PDV.pickupPayMode==='parcial'
              ? 'Parcial — Falta na Retirada'
              : 'Aguardando Pagamento')),
    scheduledDate:PDV.deliveryDate||undefined,
    scheduledPeriod:PDV.deliveryPeriod,
    scheduledTime:(PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico' ? (PDV.deliveryTimeFrom||'') : (PDV.deliveryTime||''))||undefined,
    scheduledTimeEnd:(PDV.deliveryPeriod==='Hor\u00E1rio espec\u00EDfico' ? (PDV.deliveryTimeTo||'') : '')||undefined,
    recipient:PDV.recipient,
    recipientPhone:PDV.recipientPhone||'',
    cardMessage:PDV.cardMessage,
    cardPara: PDV.cardPara || '',
    cardDe: PDV.cardDe || '',
    notes:PDV.notes,
    deliveryAddress:addr,
    deliveryStreet:PDV.street,
    deliveryNumber:PDV.number,
    deliveryNeighborhood:PDV.neighborhood,
    deliveryReference:PDV.reference,
    isCondominium:PDV.isCondominium,
    condName:PDV.condName||undefined,
    block:PDV.block,apt:PDV.apt,
    // Canal escolhido no PDV (WhatsApp/Online, Balcao, iFood, E-commerce).
    // Mapeado para o formato esperado pelo filtro: 'WhatsApp/Online' vira
    // 'WhatsApp' canonico para os pedidos antigos. Mantemos o original.
    source: PDV.salesChannel || 'WhatsApp/Online',
    unit:orderUnit,           // onde o pedido sera MONTADO/RETIRADO
    saleUnit: userBaseUnit,   // onde a venda FOI REALIZADA (atendente)
    unidade: destinoSlug,
    tipo: tipoSlug,
    destino: destinoSlug,
    // Colaborador que LANÇOU o pedido (logado no sistema)
    createdByName: S.user?.name || S.user?.nome || '',
    createdByEmail: S.user?.email || '',
    createdByColabId: S.user?.colabId || S.user?._id || '',
    // Colaborador que VENDEU (escolhido no select PDV — pode ser diferente)
    // Se nao escolheu, usa o logado.
    vendedorId:    PDV.vendedorId    || S.user?._id || S.user?.colabId || '',
    vendedorNome:  PDV.vendedorNome  || S.user?.name || S.user?.nome || '',
    vendedorEmail: PDV.vendedorEmail || S.user?.email || '',
    paymentOnDelivery: PDV.payment==='Pagar na Entrega' ? PDV.paymentOnDelivery : undefined,
    trocoPara: (PDV.payment==='Pagar na Entrega' && PDV.paymentOnDelivery==='Dinheiro' && PDV.trocoPara)
      ? parseFloat(PDV.trocoPara) || 0 : undefined,
    // Retirada: como o cliente quer pagar (so quando type === 'Retirada')
    pickupPayMode: PDV.type === 'Retirada' ? (PDV.pickupPayMode || undefined) : undefined,
    pickupParcialMethod: (PDV.type === 'Retirada' && PDV.pickupPayMode === 'parcial') ? (PDV.pickupParcialMethod || undefined) : undefined,
    pickupParcialPago: (PDV.type === 'Retirada' && PDV.pickupPayMode === 'parcial' && PDV.pickupParcialPago)
      ? parseFloat(PDV.pickupParcialPago) || 0 : undefined,
    pickupParcialPendente: (PDV.type === 'Retirada' && PDV.pickupPayMode === 'parcial' && PDV.pickupParcialPago)
      ? Math.max(0, total - (parseFloat(PDV.pickupParcialPago) || 0)) : undefined,
    deliveryFee:PDV.deliveryFee||0,
    deliveryZone:PDV.zone,
    deliveryCity:PDV.city,
    pickupUnit:PDV.pickupUnit||undefined,
    notifyClient:PDV.notifyClient,
    identifyClient:PDV.identifyClient,
  };
  try{
    S.loading=true;
    import('../main.js').then(m=>m.render()).catch(()=>{});
    const o=await POST('/orders',data);
    // Marca POST enviado — handler de erro externo usa pra diferenciar
    // 'erro real (pedido nao criado)' vs 'erro pos-criacao (pedido salvo)'
    try { opts.onPostSent?.(o); } catch(_){}
    // DEDUP: se o backend detectou duplicata (idempotency) OU se o
    // evento realtime (SSE/WebSocket) ja chegou antes, NAO adiciona 2x.
    // O bug aparecia visualmente: 2 cards do mesmo pedido por uns segundos
    // ate o proximo refresh limpar.
    if (o?._duplicateDetected) {
      console.log('[PDV] backend detectou duplicata, devolveu pedido existente:', o._id);
    }
    if (!o || !o._id) {
      // Resposta inesperada do servidor — segue sem adicionar
    } else if (!S.orders.some(x => String(x._id) === String(o._id))) {
      S.orders.unshift(o);
    } else {
      // Ja existe (veio do realtime antes) — atualiza com a versao do POST
      S.orders = S.orders.map(x => String(x._id) === String(o._id) ? { ...x, ...o } : x);
    }
    invalidateCache('orders'); // novo pedido — invalida cache de pedidos
    // Log atividade de venda
    logActivity('venda', o);
    // Receita so e registrada quando o pagamento e APROVADO manualmente.
    // (Acontece via clique no botao "Aprovar Pagamento" em Pedidos/Caixa.)
    // Aqui ja nao chamamos mais registrarReceitaVenda automaticamente.
    // Notifica loja sobre novo pedido via WhatsApp
    import('./whatsapp.js').then(m=>{
      if(m.notifyNewOrderWhatsApp) m.notifyNewOrderWhatsApp(o);
    }).catch(e=>console.warn('[PDV] notifyNewOrderWhatsApp:', e));
    notifyWhatsApp(o);
    // Pergunta se quer imprimir comanda
    S._newOrderId = o._id;
    PDV.cart=[];PDV.discount=0;PDV.surcharge=0;PDV.payment='Pix';PDV.clientId='';PDV.clientName='';PDV.clientPhone='';PDV.clientEmail='';PDV.recipient='';PDV.recipientPhone='';PDV.cardMessage='';PDV.notes='';PDV.deliveryDate='';PDV.deliveryPeriod='Manh\u00E3';PDV.deliveryTime='';PDV.street='';PDV.neighborhood='';PDV.number='';PDV.city='';PDV.cep='';PDV.reference='';PDV.isCondominium=false;PDV.condName='';PDV.block='';PDV.apt='';PDV.type='Delivery';PDV.deliveryFee=0;PDV.zone='';PDV.clientSearch='';PDV.pickupUnit='';PDV.saleUnit='';PDV.notifyClient=true;PDV.identifyClient=true;PDV.paymentOnDelivery='';PDV.trocoPara='';PDV._showQuickReg=false;PDV.vendedorId='';PDV.vendedorNome='';PDV.vendedorEmail='';
    S.loading=false;
    // Resolve número do pedido (campos possíveis que o backend pode retornar)
    const orderNum = o?.orderNumber || o?.numero || (o?._id ? String(o._id).slice(-5).toUpperCase() : 'NOVO');
    // Garante que o objeto exibido no popup tem orderNumber
    o.orderNumber = orderNum;
    console.log('[PDV popup] Pedido criado:', orderNum, '| objeto:', o);
    toast('\u2705 Pedido '+fmtOrderNum(o)+' criado!');

    // Render do PDV (limpo, já resetado) — popup é criado fora do render
    if(typeof window.render === 'function') window.render();

    // Popup injetado DIRETO no document.body, sem depender do S._modal.
    // Sempre exibe (mesmo que orderNumber seja fallback do _id).
    if(o){
      setTimeout(()=>{
        console.log('[PDV popup] Injetando overlay no body');
        showPostOrderPopup(o);
      }, 100);
    }
  }catch(e){
    S.loading=false;
    import('../main.js').then(m=>m.render()).catch(()=>{});
    throw e; // relan\u00E7a para finalizePDV() mostrar toast
  }
}

// ── Helpers locais ───────────────────────────────────────────

// Delega para helpers.js (fonte única de verdade — sincroniza com backend
// e cacheia em localStorage). Mantido aqui como wrapper para uso interno.
function getActivities(){ return _getActivities(); }
function logActivity(type, order){ return _logActivity(type, order); }

async function notifyWhatsApp(order){
  const num = '5592993002433';
  const items = (order.items||[]).map(i=>`\u2022 ${i.qty}x ${i.name}`).join('\n');
  const msg = [
    '\uD83C\uDF3A *NOVO PEDIDO \u2014 La\u00E7os Eternos*',
    `*N\u00BA:* ${order.orderNumber||'\u2014'}`,
    `*Cliente:* ${order.client?.name||order.clientName||'\u2014'} ${order.clientPhone?'('+order.clientPhone+')':''}`,
    `*Produto:*\n${items}`,
    order.recipient?`*Destinat\u00E1rio:* ${order.recipient}`:'',
    order.deliveryAddress?`*Endere\u00E7o:* ${order.deliveryAddress}`:'',
    order.scheduledPeriod?`*Turno:* ${order.scheduledPeriod}${order.scheduledTime?' '+order.scheduledTime:''}${order.scheduledTimeEnd?' - '+order.scheduledTimeEnd:''}`:'',
    order.cardMessage?`*Cart\u00E3o:* "${order.cardMessage}"`:'',
    `*Pgto:* ${order.payment||'\u2014'} \u00B7 *Total:* ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(order.total||0)}`,
    order.notes?`*Obs:* ${order.notes}`:'',
  ].filter(Boolean).join('\n');

  // Tenta enviar sem abrir nova janela usando fetch
  // Como nao temos API WhatsApp Business, abre discretamente em background
  const link = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  // Salva para log de notificacoes (com fallback contra quota cheia)
  try {
    const logs = JSON.parse(localStorage.getItem('fv_notif_logs')||'[]');
    logs.unshift({orderNum:order.orderNumber, msg: msg.slice(0, 500), time:new Date().toISOString(), link: link.slice(0, 200)});
    const { safeSetItem } = await import('../utils/safeStorage.js');
    safeSetItem('fv_notif_logs', JSON.stringify(logs.slice(0,20)));
  } catch (e) {
    // QuotaExceeded ou outro erro: nao bloqueia a finalizacao do pedido
    console.warn('[PDV] notifyWhatsApp log skip:', e.message);
  }
  // Abre em nova aba minimizada
  const w = window.open(link, '_blank', 'width=1,height=1,left=-100,top=-100');
  setTimeout(()=>{ try{ if(w&&!w.closed) w.close(); }catch(e){ console.warn('[PDV] notifyWhatsApp close error:', e); } }, 3000);
}
