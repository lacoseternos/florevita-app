import { S } from '../state.js';
import { $c, $d, sc, fmtOrderNum } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { checkDatasEspeciaisAlertas } from './clientes.js';
import {
  getNotifications, markAsRead, markAllAsRead,
  dismissNotification, clearAllNotifications,
} from '../services/notifications.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// Mensagens humanizadas para WhatsApp (mesmas do paymentAlerts)
function primeiroNome(nomeCompleto){
  return String(nomeCompleto||'').trim().split(/\s+/)[0] || '';
}
function msgWppPay(cli, num, fromSite){
  const nome = primeiroNome(cli) || 'tudo bem';
  if (fromSite) {
    return `Oi ${nome}! 🌸\n\nAqui é da Floricultura Laços Eternos. Vimos que você fez o pedido ${num} no nosso site, mas o pagamento ainda não consta como confirmado. 💛\n\nGostaríamos de te ajudar a finalizar a compra! Posso te enviar o link do Pix ou tirar alguma dúvida que esteja te impedindo de concluir? 🌷\n\nEstamos por aqui pra te atender com todo carinho!`;
  }
  return `Olá ${nome}! 🌸\n\nAqui é da Floricultura Laços Eternos. Estamos com o pedido ${num} reservado no seu nome, mas o pagamento ainda não foi confirmado por aqui. 💛\n\nVocê já conseguiu efetuar o Pix/transferência? Se precisar do comprovante ou de qualquer ajuda, é só nos avisar — estamos aqui para te atender com carinho! 🌷`;
}

// Wire global das acoes da pagina (bind unico chamado pelo main.js)
export function bindAlertasActions(){
  document.querySelectorAll('[data-notif-mark]').forEach(b => {
    b.onclick = () => { markAsRead(b.dataset.notifMark); render(); };
  });
  document.querySelectorAll('[data-notif-dismiss]').forEach(b => {
    b.onclick = () => { dismissNotification(b.dataset.notifDismiss); render(); };
  });
  document.querySelectorAll('[data-notif-open-order]').forEach(b => {
    b.onclick = () => {
      const orderId = b.dataset.notifOpenOrder;
      const num = b.dataset.notifNum || '';
      S.page = 'pedidos';
      S._fStatus = 'Todos'; S._fBairro = ''; S._fTurno = '';
      S._fUnidade = ''; S._fCanal = ''; S._fPrioridade = '';
      S._fDate1 = ''; S._fDate2 = '';
      S._orderSearch = num.replace(/^#/,'').replace(/^0+/,'') || num.replace(/^#/,'');
      // Marca como lida ao abrir
      const notifId = b.dataset.notifId;
      if (notifId) markAsRead(notifId);
      render();
    };
  });
  const btnMarkAll = document.getElementById('btn-notif-mark-all');
  if (btnMarkAll) btnMarkAll.onclick = () => { markAllAsRead(); toast('✅ Todas marcadas como lidas'); render(); };
  const btnClearAll = document.getElementById('btn-notif-clear-all');
  if (btnClearAll) btnClearAll.onclick = () => {
    if (confirm('Limpar TODAS as notificações? Esta ação não pode ser desfeita.')) {
      clearAllNotifications();
      toast('🗑️ Notificações limpas');
      render();
    }
  };
}

// ── ALERTAS (dados reais) ─────────────────────────────────────
export function renderAlertas(){
  const now = Date.now();
  const alertas = [];

  // Pedidos atrasados
  S.orders.filter(o=>['Aguardando','Em preparo','Saiu p/ entrega'].includes(o.status)).forEach(o=>{
    if(!o.scheduledDate) return;
    const diff = new Date(o.scheduledDate).getTime() - now;
    if(diff<0){
      alertas.push({icon:'\u{1F6A8}',tipo:'Pedido Atrasado',msg:`${fmtOrderNum(o)} \u2014 ${o.client?.name||o.clientName||'\u2014'}`,cor:'var(--red)',lido:false,ts:new Date(o.scheduledDate)});
    } else if(diff < 2*60*60*1000){
      alertas.push({icon:'\u23F0',tipo:'Entrega em 2h',msg:`${fmtOrderNum(o)} \u2014 ${o.client?.name||o.clientName||'\u2014'}`,cor:'var(--gold)',lido:false,ts:new Date(o.scheduledDate)});
    }
  });

  // Estoque critico
  S.products.filter(p=>(p.stock||0)<=(p.minStock||5)&&(p.stock||0)>0).forEach(p=>{
    alertas.push({icon:'\u{1F4E6}',tipo:'Estoque Cr\u00edtico',msg:`${p.name} \u2014 ${p.stock} unidade(s)`,cor:'var(--gold)',lido:true,ts:new Date()});
  });
  S.products.filter(p=>(p.stock||0)===0).forEach(p=>{
    alertas.push({icon:'\u{1F6AB}',tipo:'Sem Estoque',msg:`${p.name} \u2014 esgotado`,cor:'var(--red)',lido:false,ts:new Date()});
  });

  // Pedidos recentes (ultimos 30 min)
  S.orders.filter(o=>{const d=new Date(o.createdAt);return now-d.getTime()<30*60*1000;}).slice(0,3).forEach(o=>{
    alertas.push({icon:'\u{1F6CD}\uFE0F',tipo:'Novo Pedido',msg:`${fmtOrderNum(o)} \u2014 ${o.client?.name||o.clientName||'\u2014'} \u00B7 ${$c(o.total)}`,cor:'var(--blue)',lido:false,ts:new Date(o.createdAt)});
  });

  // Pedidos entregues hoje
  const hoje=new Date().toDateString();
  S.orders.filter(o=>o.status==='Entregue'&&new Date(o.updatedAt||o.createdAt).toDateString()===hoje).slice(0,3).forEach(o=>{
    alertas.push({icon:'\u2705',tipo:'Entrega Confirmada',msg:`${fmtOrderNum(o)} \u2014 ${o.driverName?'por '+o.driverName:''}`,cor:'var(--leaf)',lido:true,ts:new Date(o.updatedAt||o.createdAt)});
  });

  // Datas Especiais — alertas 1 dia antes (ou no dia)
  checkDatasEspeciaisAlertas().forEach(a=>{
    const c = a.client;
    const wppLink = c.phone ? `https://wa.me/55${c.phone.replace(/\D/g,'')}?text=${encodeURIComponent(`Ol\u00e1 ${c.name}! \u{1F338} Amanh\u00e3 \u00e9 ${a.tipo} de ${a.pessoa}. Que tal enviarmos um presente especial?`)}` : null;
    alertas.push({
      icon: a.tipo==='Anivers\u00e1rio'?'\u{1F382}':a.tipo==='Namoro'?'\u{1F495}':a.tipo==='Casamento'?'\u{1F48D}':'\u{1F338}',
      tipo: `Data Especial \u2014 ${a.urgencia}`,
      msg: `${a.urgencia} \u00e9 ${a.tipo} de ${a.pessoa} \u00B7 Cliente: ${c.name} \u00B7 C\u00f3d: ${c.code||'\u2014'} \u00B7 ${c.phone||''}`,
      cor: a.diffDias===0?'var(--red)':'var(--rose)',
      lido: false,
      ts: a.dataEsteAno,
      wpp: wppLink,
      clientId: a.clientId,
      extra: {cliente:c.name, codigo:c.code||'\u2014', whatsapp:c.phone||'\u2014', pessoa:a.pessoa, tipo:a.tipo, data:a.data},
    });
  });

  alertas.sort((a,b)=>b.ts-a.ts);

  // ── Notificacoes do store (push do canto inferior, alertas pagamento) ──
  const notifs = getNotifications();
  const unreadCount = notifs.filter(n => !n.read).length;

  const notifCardHTML = `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <div>🔔 Notificações Recentes
      ${unreadCount > 0 ? `<span class="tag t-rose">${unreadCount} não lida${unreadCount===1?'':'s'}</span>` : '<span class="tag" style="background:#D1FAE5;color:#047857;">tudo em dia</span>'}
    </div>
    ${notifs.length > 0 ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${unreadCount > 0 ? `<button class="btn btn-ghost btn-sm" id="btn-notif-mark-all" style="font-size:11px;">✓ Marcar todas como lidas</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="btn-notif-clear-all" style="font-size:11px;color:var(--red);">🗑️ Limpar todas</button>
    </div>` : ''}
  </div>
  ${notifs.length === 0 ? `<div class="empty"><div class="empty-icon">✅</div><p>Nenhuma notificação</p></div>` : ''}
  ${notifs.map(n => {
    const phone = String(n.meta?.clientPhone||'').replace(/\D/g,'');
    const wppMsg = n.type === 'payment-pending'
      ? msgWppPay(n.meta?.clientName||'', n.meta?.orderNumber||'', !!n.meta?.fromSite)
      : '';
    const wppHref = phone && wppMsg ? `https://wa.me/55${phone}?text=${encodeURIComponent(wppMsg)}` : '';
    const corBorda = n.read ? '#E5E7EB' : (n.meta?.fromSite ? '#C4B5FD' : '#FCD34D');
    const corBg    = n.read ? '#FAFAFA' : (n.meta?.fromSite ? '#F5F3FF' : '#FFFBEB');
    const tempo = (() => {
      const mins = Math.round((Date.now() - (n.ts||0)) / 60000);
      if (mins < 1) return 'agora';
      if (mins < 60) return mins + ' min';
      const h = Math.floor(mins / 60);
      if (h < 24) return h + 'h';
      return Math.floor(h/24) + 'd';
    })();
    return `
    <div style="background:${corBg};border:1.5px solid ${corBorda};border-radius:10px;padding:12px 14px;margin-bottom:8px;${n.read?'opacity:.75;':''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <div style="font-weight:800;font-size:13px;color:var(--ink);">${n.title}</div>
        <div style="font-size:10px;color:var(--muted);white-space:nowrap;flex-shrink:0;">⏱️ ${tempo}</div>
      </div>
      <div style="font-size:12px;color:#1F2937;line-height:1.5;margin-bottom:8px;">${n.body}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${wppHref ? `<a href="${wppHref}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;background:#25D366;color:#fff;text-decoration:none;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;">📱 WhatsApp</a>` : ''}
        ${n.meta?.orderId ? `<button data-notif-open-order="${n.meta.orderId}" data-notif-num="${n.meta.orderNumber||''}" data-notif-id="${n.id}" style="background:#fff;color:#374151;border:1px solid #D1D5DB;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">📋 Ver pedido</button>` : ''}
        ${!n.read ? `<button data-notif-mark="${n.id}" style="background:#fff;color:#0891B2;border:1px solid #67E8F9;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;">✓ Marcar como lida</button>` : ''}
        <button data-notif-dismiss="${n.id}" style="background:#fff;color:#9CA3AF;border:1px solid #E5E7EB;padding:6px 10px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;margin-left:auto;" title="Descartar">🗑️</button>
      </div>
    </div>`;
  }).join('')}
</div>`;

  return notifCardHTML + `
<div class="card">
  <div class="card-title">\u{1F514} Central de Alertas
    <span class="tag t-rose">${alertas.filter(a=>!a.lido).length} novos</span>
  </div>
  ${alertas.length===0?`<div class="empty"><div class="empty-icon">\u2705</div><p>Nenhum alerta no momento</p></div>`:''}
  ${alertas.map(a=>`
  <div style="display:flex;align-items:flex-start;gap:12px;padding:12px;border-radius:var(--r);margin-bottom:8px;border:1px solid ${a.lido?'var(--border)':'var(--rose-l)'};background:${a.lido?'#fff':'var(--petal)'};">
    <div style="font-size:22px;flex-shrink:0">${a.icon}</div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;color:${a.cor};font-weight:600;text-transform:uppercase;letter-spacing:1px">${a.tipo}</div>
      <div style="font-size:13px;font-weight:500;margin-top:2px">${a.msg}</div>
      ${a.extra?`<div style="margin-top:6px;background:#fff;border-radius:6px;padding:8px;font-size:11px;display:grid;grid-template-columns:1fr 1fr;gap:4px;">
        <div>\u{1F464} <strong>${a.extra.cliente}</strong></div>
        <div>\u{1F3F7}\uFE0F C\u00f3d: <strong>${a.extra.codigo}</strong></div>
        <div>\u{1F4F1} <strong>${a.extra.whatsapp}</strong></div>
        <div>\u{1F389} ${a.extra.tipo} de <strong>${a.extra.pessoa}</strong></div>
      </div>`:''}
      ${a.wpp?`<a href="${a.wpp}" target="_blank" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#25D366;color:#fff;border:none;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:700;text-decoration:none;">\u{1F4AC} Contatar via WhatsApp</a>`:''}
    </div>
    <div style="font-size:11px;color:var(--muted);flex-shrink:0;white-space:nowrap;">${a.ts?.toLocaleTimeString?a.ts.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):''}</div>
    ${!a.lido?`<div style="width:8px;height:8px;border-radius:50%;background:var(--rose);flex-shrink:0;margin-top:4px;"></div>`:''}
  </div>`).join('')}
</div>`;
}
