import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast } from '../utils/helpers.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── LOAD / SAVE WhatsApp config com API + fallback localStorage ──
async function loadWhatsConfig(){
  try{
    const data = await GET('/settings/whatsapp');
    if(data && typeof data === 'object' && Object.keys(data).length){
      localStorage.setItem('fv_whats_config', JSON.stringify(data));
      return data;
    }
  }catch(e){/* fallback */}
  return JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
}

async function saveWhatsConfig(cfg){
  localStorage.setItem('fv_whats_config', JSON.stringify(cfg));
  try{ await PUT('/settings/whatsapp', cfg); }catch(e){/* silencioso */}
}

async function loadWhatsHist(){
  try{
    const data = await GET('/settings/whatsapp-hist');
    if(Array.isArray(data) && data.length){
      localStorage.setItem('fv_whats_hist', JSON.stringify(data));
      return data;
    }
  }catch(e){/* fallback */}
  return JSON.parse(localStorage.getItem('fv_whats_hist')||'[]');
}

async function saveWhatsHist(hist){
  localStorage.setItem('fv_whats_hist', JSON.stringify(hist));
  try{ await PUT('/settings/whatsapp-hist', hist); }catch(e){/* silencioso */}
}

// ── RENDER WHATSAPP ─────────────────────────────────────────────
export function renderWhatsApp(){
  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const whatsConfig = JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
  const notifHist = JSON.parse(localStorage.getItem('fv_whats_hist')||'[]');
  return`
<div class="g2">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">\u{1F4F1} Configura\u00e7\u00e3o WhatsApp Business
        <span class="tag ${whatsConfig.ativo?'t-green':'t-red'}">${whatsConfig.ativo?'Ativo':'Inativo'}</span>
      </div>
      <div class="alert al-info" style="margin-bottom:14px;">
        Configure a integra\u00e7\u00e3o WhatsApp para notificar clientes automaticamente quando um pedido for entregue, e notificar a loja sobre novos pedidos do site/iFood.
      </div>
      <div class="fg"><label class="fl">N\u00famero da Loja (WhatsApp Business) *</label>
        <input class="fi" id="wa-num" placeholder="5592993002433" value="${whatsConfig.numero||cfg.whats||''}"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Formato: 55 + DDD + n\u00famero (sem espa\u00e7os ou tra\u00e7os)</div>
      </div>
      <div class="fg"><label class="fl">N\u00famero para Notifica\u00e7\u00f5es iFood/Ecommerce</label>
        <input class="fi" id="wa-num-ifood" placeholder="5592993002433" value="${whatsConfig.numIfood||cfg.whats||''}"/>
        <div style="font-size:10px;color:var(--muted);margin-top:3px">N\u00famero que receber\u00e1 alertas de novos pedidos online</div>
      </div>

      <!-- Template de mensagem de entrega -->
      <div class="fg"><label class="fl">Mensagem \u2014 Entrega Confirmada</label>
        <textarea class="fi" id="wa-tmpl-entrega" rows="3">${whatsConfig.tmplEntrega||'Ol\u00e1 {nome}! \u{1F33A} Seu pedido {pedido} foi entregue com sucesso. Obrigada por escolher a La\u00e7os Eternos! \u{1F490}'}</textarea>
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Vari\u00e1veis: {nome} {pedido} {total} {data}</div>
      </div>

      <!-- Template de novo pedido -->
      <div class="fg"><label class="fl">Mensagem \u2014 Novo Pedido (loja)</label>
        <textarea class="fi" id="wa-tmpl-pedido" rows="3">${whatsConfig.tmplPedido||'\u{1F6CD}\uFE0F NOVO PEDIDO {pedido}!\nCliente: {cliente}\nTotal: {total}\nEntrega: {data}\n{itens}'}</textarea>
        <div style="font-size:10px;color:var(--muted);margin-top:3px">Enviado ao n\u00famero da loja a cada novo pedido</div>
      </div>

      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" id="btn-save-wa" style="flex:1;justify-content:center;">\u{1F4BE} Salvar Configura\u00e7\u00f5es</button>
        <button class="btn btn-green" id="btn-test-wa">\u{1F9EA} Testar WhatsApp</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">\u2699\uFE0F Como Funciona</div>
      <div style="font-size:12px;line-height:1.8;color:var(--ink2);">
        <p style="margin-bottom:8px;"><strong>1. Notifica\u00e7\u00e3o de entrega \u2192</strong> Quando o entregador confirmar uma entrega, o sistema envia automaticamente uma mensagem WhatsApp ao cliente.</p>
        <p style="margin-bottom:8px;"><strong>2. Alerta de novo pedido \u2192</strong> Sempre que um pedido for criado no PDV, site ou iFood, o n\u00famero configurado recebe uma notifica\u00e7\u00e3o.</p>
        <p style="margin-bottom:8px;"><strong>3. Via WhatsApp Web \u2192</strong> As mensagens abrem o WhatsApp no computador ou celular. Para envio 100% autom\u00e1tico, configure a API Evolution no backend.</p>
        <div style="background:var(--gold-l);border-radius:8px;padding:10px;border:1px solid rgba(122,92,0,.2);margin-top:8px;">
          <div style="font-weight:600;color:var(--gold);font-size:11px;margin-bottom:4px;">\u{1F4CC} Para automa\u00e7\u00e3o total:</div>
          <div style="font-size:11px;color:var(--ink2);">Configure o <strong>Evolution API</strong> ou <strong>Z-API</strong> no seu backend e informe a URL e token abaixo.</div>
        </div>
      </div>
      <div class="fg" style="margin-top:14px;"><label class="fl">URL da API WhatsApp (Evolution/Z-API)</label>
        <input class="fi" id="wa-api-url" placeholder="https://api.evolution.com/send" value="${whatsConfig.apiUrl||''}"/>
      </div>
      <div class="fg"><label class="fl">Token / API Key</label>
        <input class="fi" id="wa-api-token" type="password" placeholder="Bearer token..." value="${whatsConfig.apiToken||''}"/>
      </div>
      <button class="btn btn-outline btn-sm" id="btn-save-wa-api">\u{1F4BE} Salvar API</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">\u{1F4EC} Hist\u00f3rico de Notifica\u00e7\u00f5es
      <span class="tag t-gray">${notifHist.length}</span>
    </div>
    ${notifHist.length===0?`<div class="empty"><div class="empty-icon">\u{1F4AC}</div><p>Nenhuma notifica\u00e7\u00e3o enviada ainda</p></div>`:`
    <div style="max-height:500px;overflow-y:auto;">
    ${notifHist.slice(0,30).map(n=>`
    <div style="padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span class="tag ${n.tipo==='entrega'?'t-green':'t-blue'}" style="font-size:9px;">${n.tipo==='entrega'?'Entrega':'Novo Pedido'}</span>
        <span style="font-size:10px;color:var(--muted)">${new Date(n.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
      </div>
      <div style="font-size:12px;font-weight:500">${n.para}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${n.msg?.substring(0,60)}...</div>
      <span class="tag ${n.status==='enviado'?'t-green':'t-gold'}" style="font-size:9px;margin-top:4px;">${n.status}</span>
    </div>`).join('')}
    </div>`}
  </div>
</div>`;
}

// ── SEND WHATSAPP NOTIFICATION (novo pedido — abre wa.me) ────
export function sendWhatsAppNotification(order){
  const whatsConfig = JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
  const num = whatsConfig.numero || '5592993002433';
  const items = (order.items||[]).map(i=>`\u2022 ${i.qty}x ${i.name}`).join('\n');
  const msg = [
    '\u{1F33A} *NOVO PEDIDO \u2014 La\u00e7os Eternos*',
    '',
    `*N\u00ba do Pedido:* ${order.orderNumber||'\u2014'}`,
    `*Produto:*\n${items}`,
    `*Destinat\u00e1rio:* ${order.recipient||'\u2014'}`,
    `*Endere\u00e7o:* ${order.deliveryAddress||'Retirada no balc\u00e3o'}`,
    order.isCondominium&&order.block?`*Cond.:* Bloco ${order.block}, Ap ${order.apt}`:'',
    `*Turno:* ${order.scheduledPeriod||'\u2014'} ${order.scheduledTime||''}`,
    order.scheduledDate?`*Data:* ${new Date(order.scheduledDate).toLocaleDateString('pt-BR')}`:'',
    order.cardMessage?`*Cart\u00e3o:* "${order.cardMessage}"`:'',
    '',
    `*Total:* ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(order.total||0)}`,
    `*Pagamento:* ${order.payment||'\u2014'}`,
  ].filter(Boolean).join('\n');

  const url = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// ── NOTIFY WHATSAPP (novo pedido — discreto com log) ─────────
export function notifyWhatsApp(order){
  const whatsConfig = JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
  const num = whatsConfig.numero || '5592993002433';
  const items = (order.items||[]).map(i=>`\u2022 ${i.qty}x ${i.name}`).join('\n');
  const msg = [
    '\u{1F33A} *NOVO PEDIDO \u2014 La\u00e7os Eternos*',
    `*N\u00ba:* ${order.orderNumber||'\u2014'}`,
    `*Cliente:* ${order.client?.name||order.clientName||'\u2014'} ${order.clientPhone?'('+order.clientPhone+')':''}`,
    `*Produto:*\n${items}`,
    order.recipient?`*Destinat\u00e1rio:* ${order.recipient}`:'',
    order.deliveryAddress?`*Endere\u00e7o:* ${order.deliveryAddress}`:'',
    order.scheduledPeriod?`*Turno:* ${order.scheduledPeriod} ${order.scheduledTime||''}`:'',
    order.cardMessage?`*Cart\u00e3o:* "${order.cardMessage}"`:'',
    `*Pgto:* ${order.payment||'\u2014'} \u00b7 *Total:* ${new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(order.total||0)}`,
    order.notes?`*Obs:* ${order.notes}`:'',
  ].filter(Boolean).join('\n');

  const link = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  // Salva para log de notificacoes
  const logs = JSON.parse(localStorage.getItem('fv_notif_logs')||'[]');
  logs.unshift({orderNum:order.orderNumber, msg, time:new Date().toISOString(), link});
  localStorage.setItem('fv_notif_logs', JSON.stringify(logs.slice(0,20)));
  // Abre em nova aba minimizada
  const w = window.open(link, '_blank', 'width=1,height=1,left=-100,top=-100');
  setTimeout(()=>{ try{ if(w&&!w.closed) w.close(); }catch(e){} }, 3000);
}

// ── SEND WHATSAPP DELIVERY CONFIRM ──────────────────────────────
export function sendWhatsAppDeliveryConfirm(order) {
  const waConfig = JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
  const tmpl = waConfig.tmplEntrega || localStorage.getItem('fv_delivery_msg') ||
    'Ol\u00e1, {nome}! \u{1F33A} Seu pedido {pedido} foi entregue com sucesso. Esperamos que tenha amado! \u{1F496} La\u00e7os Eternos';
  const clientName = order.client?.name || order.clientName || 'Cliente';
  const clientPhone = order.client?.phone || order.clientPhone || '';
  if (!clientPhone) return;
  const msg = tmpl
    .replace(/{nome}/gi, clientName)
    .replace(/{pedido}/gi, order.orderNumber || '')
    .replace(/{total}/gi, $c(order.total||0))
    .replace(/{data}/gi, new Date().toLocaleDateString('pt-BR'))
    .replace(/{floricultura}/gi, 'La\u00e7os Eternos');
  const phone = '55' + clientPhone.replace(/\D/g,'');
  // Log no historico de notificacoes
  const hist = JSON.parse(localStorage.getItem('fv_whats_hist')||'[]');
  hist.unshift({ts:new Date().toISOString(),tipo:'entrega',para:clientName+' ('+clientPhone+')',msg,status:'enviado',pedido:order.orderNumber});
  if(hist.length>50) hist.length=50;
  saveWhatsHist(hist);
  // Tenta API automatica se configurada
  if(waConfig.apiUrl && waConfig.apiToken){
    fetch(waConfig.apiUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+waConfig.apiToken},
      body:JSON.stringify({number:phone,text:msg})}).catch(()=>{});
  } else {
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  }
}

// ── NOTIFY NEW ORDER WHATSAPP ───────────────────────────────────
export function notifyNewOrderWhatsApp(order){
  const waConfig = JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
  if(!waConfig.numIfood && !waConfig.numero) return;
  const tmpl = waConfig.tmplPedido || '\u{1F6CD}\uFE0F NOVO PEDIDO {pedido}!\nCliente: {cliente}\nTotal: {total}\nEntrega: {data}\n{itens}';
  const msg = tmpl
    .replace(/{pedido}/gi, order.orderNumber||'')
    .replace(/{cliente}/gi, order.client?.name||order.clientName||'\u2014')
    .replace(/{total}/gi, $c(order.total||0))
    .replace(/{data}/gi, order.scheduledDate?new Date(order.scheduledDate).toLocaleDateString('pt-BR'):'A definir')
    .replace(/{itens}/gi, (order.items||[]).map(i=>`\u2022 ${i.qty}x ${i.name}`).join('\n'));
  const destNum = (waConfig.numIfood||waConfig.numero||'').replace(/\D/g,'');
  if(!destNum) return;
  const hist = JSON.parse(localStorage.getItem('fv_whats_hist')||'[]');
  hist.unshift({ts:new Date().toISOString(),tipo:'pedido',para:'Loja ('+destNum+')',msg,status:'enviado',pedido:order.orderNumber});
  if(hist.length>50) hist.length=50;
  saveWhatsHist(hist);
  if(waConfig.apiUrl && waConfig.apiToken){
    fetch(waConfig.apiUrl,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+waConfig.apiToken},
      body:JSON.stringify({number:'55'+destNum,text:msg})}).catch(()=>{});
  }
}

// ── BINDINGS (chamado pelo app principal ao renderizar a pagina whatsapp) ──
export function bindWhatsAppEvents(){
  const saveWaConfig = async ()=>{
    const cfg={
      numero:document.getElementById('wa-num')?.value?.trim()||'',
      numIfood:document.getElementById('wa-num-ifood')?.value?.trim()||'',
      tmplEntrega:document.getElementById('wa-tmpl-entrega')?.value||'',
      tmplPedido:document.getElementById('wa-tmpl-pedido')?.value||'',
      ativo:!!(document.getElementById('wa-num')?.value?.trim()),
    };
    await saveWhatsConfig(cfg);
    return cfg;
  };
  {const _el=document.getElementById('btn-save-wa');if(_el)_el.onclick=async()=>{ await saveWaConfig(); toast('\u2705 Configura\u00e7\u00f5es salvas!'); render(); };}
  {const _el=document.getElementById('btn-test-wa');if(_el)_el.onclick=async()=>{
    const cfg=await saveWaConfig();
    if(!cfg.numero) return toast('\u274C Configure o n\u00famero primeiro');
    const msg='\u{1F9EA} Teste La\u00e7os Eternos \u2014 Sistema funcionando! '+new Date().toLocaleString('pt-BR');
    window.open('https://wa.me/'+cfg.numero.replace(/\D/g,'')+'?text='+encodeURIComponent(msg),'_blank');
    toast('\u{1F4F1} WhatsApp aberto para teste');
  };}
  {const _el=document.getElementById('btn-save-wa-api');if(_el)_el.onclick=async()=>{
    const cfg=JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
    cfg.apiUrl=document.getElementById('wa-api-url')?.value||'';
    cfg.apiToken=document.getElementById('wa-api-token')?.value||'';
    await saveWhatsConfig(cfg);
    toast('\u2705 API WhatsApp salva!');
  };}
}
