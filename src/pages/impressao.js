import { S, API } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET, PUT } from '../services/api.js';
import { toast, parseLocalDate, formatOrderDate } from '../utils/helpers.js';
import { getClientWithStats, getClientTier } from './clientes.js';
import { isExpress, horaExpress, EXPRESS_HORAS } from '../utils/express.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}


// Substitui variaveis {xxx} no texto da etiqueta pelos dados do pedido
function applyLabelVars(texto, o, empresa, whats){
  const dt = o.scheduledDate ? formatOrderDate(o.scheduledDate, 'curta') : '—';
  return String(texto||'')
    .replace(/\{empresa\}/g,      empresa||'')
    .replace(/\{recipient\}/g,    o.recipient||'—')
    .replace(/\{clientName\}/g,   o.client?.name||o.clientName||'—')
    .replace(/\{bairro\}/g,       o.deliveryNeighborhood||'—')
    .replace(/\{cidade\}/g,       o.deliveryCity||'Manaus')
    .replace(/\{orderNumber\}/g,  o.orderNumber||'—')
    .replace(/\{scheduledDate\}/g, dt)
    .replace(/\{scheduledTime\}/g, o.scheduledTime||'—')
    .replace(/\{produto\}/g,       (o.items||[]).map(i=>i.name).join(', ')||'—')
    .replace(/\{whats\}/g,         whats||'');
}

// ── PRINT CARD ──────────────────────────────────────────────────
export function printCard(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) return toast('\u274C Pedido n\u00e3o encontrado');
  const cfg = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const cor = layout.cardCor||'#C8436A';
  const fonte = layout.cardFonte||'Georgia';
  const tam = layout.cardTamanho||'16';
  const empresa = layout.nomeEmpresa||cfg.razao||'La\u00e7os Eternos Floricultura';

  const cardHtml = `
    <div style="border:${layout.cardBordaPx||2}px ${layout.cardBorda||'solid'} ${cor};border-radius:16px;padding:28px 32px;max-width:360px;margin:0 auto;text-align:center;font-family:${fonte},serif;background:${layout.cardBg||'#FDF4F7'};">
      ${layout.mostrarLogo!==false?(layout.logoBase64?
        `<img src="${layout.logoBase64}" style="max-height:${layout.logoSize||60}px;max-width:200px;object-fit:contain;margin-bottom:10px;"/>`
        :`<div style="font-size:13px;color:${cor};font-weight:bold;margin-bottom:10px;letter-spacing:1px;">${empresa.toUpperCase()}</div>`
      ):''}
      <div style="font-size:26px;margin-bottom:10px;">\u{1F33A}</div>
      ${layout.mostrarDestinatario!==false?`<div style="font-size:11px;color:#888;margin-bottom:3px;letter-spacing:1px;">PARA:</div><div style="font-size:20px;font-weight:bold;margin-bottom:16px;color:#1A0A10;">${(o.cardPara||o.recipient||'\u2014').toUpperCase()}</div>`:''}
      ${layout.mostrarMensagem!==false?`<div style="font-size:${tam}px;font-style:italic;color:#2D1A20;line-height:1.8;padding:14px 16px;background:rgba(255,255,255,.6);border-radius:8px;margin-bottom:14px;">"${o.cardMessage||'Com muito carinho! \u{1F338}'}"</div>`:''}
      ${layout.mostrarData!==false&&o.scheduledDate?`<div style="font-size:11px;color:#9E8090;margin-bottom:8px;">\u{1F4C5} ${formatOrderDate(o.scheduledDate, 'curta')} ${o.scheduledPeriod?'\u00b7 '+o.scheduledPeriod:''}</div>`:''}
      ${layout.mostrarProduto!==false&&(o.items||[]).length?`<div style="font-size:11px;color:#9E8090;margin-bottom:8px;">\u{1F338} ${(o.items||[]).map(i=>i.name).join(', ')}</div>`:''}
      ${layout.mostrarRemetente!==false&&o.identifyClient!==false?`<div style="font-size:12px;color:#9E8090;">\u{1F48C} COM CARINHO DE: <strong>${(o.cardDe||o.client?.name||o.clientName||'\u2014').toUpperCase()}</strong></div>`:'<div style="font-size:20px;">\u{1F49D}</div>'}
    </div>`;

  // Show in print modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
      <div style="padding:16px 20px;background:${cor};display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:bold;font-size:15px;">\u{1F48C} Cart\u00e3o \u2014 ${o.orderNumber}</span>
        <div style="display:flex;gap:8px;">
          <button onclick="window.print()" style="background:#fff;color:${cor};border:none;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">\u{1F5A8}\uFE0F IMPRIMIR</button>
          <button onclick="this.closest('[data-overlay]').remove()" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">\u2715</button>
        </div>
      </div>
      <div style="padding:24px;" id="card-preview-content">
        ${cardHtml}
      </div>
    </div>`;
  overlay.setAttribute('data-overlay','true');
  overlay.addEventListener('click', e=>{ if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  // Add print styles
  const style = document.createElement('style');
  style.id = 'print-style-card';
  style.textContent = `@media print {
    body > *:not([data-overlay]) { display:none!important; }
    [data-overlay] { position:fixed!important;inset:0!important;background:#fff!important;display:flex!important;align-items:center!important;justify-content:center!important; }
    [data-overlay] > div > div:first-child { display:none!important; }
    #card-preview-content { padding:20px!important; }
  }`;
  document.head.appendChild(style);

  overlay.querySelector('[onclick="window.print()"]').addEventListener('click', ()=>{
    window.print();
    setTimeout(()=>{ document.getElementById('print-style-card')?.remove(); }, 1000);
  });
  overlay.querySelector('[onclick*="remove"]').addEventListener('click', ()=>{
    overlay.remove();
    document.getElementById('print-style-card')?.remove();
  });

  S._printedCard = {...(S._printedCard||{}), [orderId]:true};
  localStorage.setItem('fv_printed_card', JSON.stringify(S._printedCard));
  render();
}

// ── PRINT COMANDA ───────────────────────────────────────────────
// Antes de imprimir, garante que os produtos do pedido tem imagem
// carregada em S.products (caso a listagem inicial tenha vindo lite).
async function ensureProductImagesForOrder(orderId){
  try {
    const o = S.orders.find(x => x._id === orderId);
    if (!o || !Array.isArray(o.items)) return;
    const need = [];
    for (const it of o.items) {
      const pid = it.product;
      if (!pid || !/^[a-f0-9]{24}$/i.test(String(pid))) continue;
      const p = S.products.find(x => String(x._id) === String(pid));
      if (p && !(p.imagem || p.images?.[0] || p.image)) {
        need.push(pid);
      }
    }
    if (!need.length) return;
    const tk = S.token || localStorage.getItem('fv2_token') || '';
    const res = await fetch(API + '/products/images?ids=' + encodeURIComponent(need.join(',')), {
      headers: { 'Authorization':'Bearer '+tk }
    });
    if (!res.ok) return;
    const map = await res.json();
    for (const id of Object.keys(map||{})) {
      const p = S.products.find(x => String(x._id) === String(id));
      if (p && map[id]) p.imagem = map[id];
    }
  } catch(_){}
}

export async function printComanda(orderId){
  console.log('[printComanda] chamado com orderId=', orderId);
  try {
    await ensureProductImagesForOrder(orderId);
    return _printComandaInternal(orderId);
  } catch (err) {
    console.error('[printComanda] ERRO:', err);
    try {
      const msg = (err?.message || err || 'erro desconhecido');
      if (typeof toast === 'function') toast('❌ Erro ao imprimir: ' + msg, true);
      else alert('Erro ao imprimir: ' + msg);
    } catch(_){}
  }
}

// ── IMPRESSAO SILENCIOSA (auto-print da expedicao) ─────────────
// Imprime a comanda de UM pedido SEM overlay e SEM clique: monta um iframe
// oculto com o HTML da comanda e chama window.print(). Com o Chrome rodando
// em --kiosk-printing, sai DIRETO na impressora padrao (sem caixa de dialogo).
// Sem kiosk, abre a caixa de imprimir normal (1 clique). Usado pelo
// autoPrintComanda quando um pedido de entrega do dia e aprovado.
export async function printComandaSilent(orderId, opts){
  try {
    await ensureProductImagesForOrder(orderId);
    const res = _printComandaInternal(orderId, { returnHtml: true });
    if (!res || !res.htmlDoc) return false;

    // Margem de seguranca (mm) + proporcao (%) configuraveis por PC no pop-up
    // da impressao automatica. Se nao vierem por opts, le a config salva.
    let marginMm = opts?.marginMm;
    let scale    = opts?.scale;
    if (marginMm == null || scale == null) {
      try {
        const ap = await import('../services/autoPrintComanda.js');
        const c = ap.getAutoPrintCfg();
        if (marginMm == null) marginMm = c.marginMm;
        if (scale == null) scale = c.scale;
      } catch(_){}
    }
    marginMm = Math.min(Math.max(parseFloat(marginMm) || 0, 0), 15);
    scale    = Math.min(Math.max(parseInt(scale) || 100, 70), 110);

    // "Fixa" o formato pra impressao SILENCIOSA (kiosk nao abre dialogo pra
    // escolher): A4 retrato + margem de seguranca (evita a impressora cortar
    // nas bordas) e cores garantidas (cabecalho colorido sai mesmo sem o
    // "graficos de fundo" marcado). A proporcao (<100%) encolhe o conteudo
    // pra caber. As 2 vias usam 50vh cada -> continuam alinhadas com margem.
    const _zoomCss = scale !== 100 ? `html{zoom:${(scale/100).toFixed(3)};}` : '';
    const _hardCss = `<style>@page{size:A4 portrait;margin:${marginMm}mm;}html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}${_zoomCss}</style>`;
    const htmlDoc = res.htmlDoc.includes('</head>')
      ? res.htmlDoc.replace('</head>', _hardCss + '</head>')
      : _hardCss + res.htmlDoc;

    // iframe oculto (remove antigos pra nao acumular)
    document.querySelectorAll('iframe[data-autoprint-comanda]').forEach(el => el.remove());
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-autoprint-comanda', '1');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
    const cleanup = () => { try { iframe.remove(); } catch(_){} };
    iframe.onload = () => {
      try {
        const w = iframe.contentWindow;
        // folga pra layout/imagens (data URIs) assentarem antes de imprimir
        setTimeout(() => {
          try { w.focus(); w.print(); } catch(_){}
          try { w.onafterprint = cleanup; } catch(_){}
          setTimeout(cleanup, 60000); // fallback: remove o iframe depois
        }, 400);
      } catch(_) { cleanup(); }
    };
    document.body.appendChild(iframe);
    iframe.srcdoc = htmlDoc;

    // marca como impressa (mesmo flag verde/vermelho do botao manual)
    try {
      const printed = JSON.parse(localStorage.getItem('fv_printed_comanda')||'{}');
      printed[orderId] = true;
      localStorage.setItem('fv_printed_comanda', JSON.stringify(printed));
      S._printedComanda = printed;
    } catch(_){}
    return true;
  } catch (err) {
    console.error('[printComandaSilent] erro:', err);
    return false;
  }
}

// ── VISUALIZAR COMANDA (sem marcar como impressa) ──────────────
// Marcia (20/05): clicar no nome do destinatario no dashboard abre a
// comanda do pedido pra conferencia, MAS sem alterar o flag de
// "ja impressa" (botao verde/vermelho continua igual).
// Diferenca pra printComanda: salva o flag atual, abre o overlay,
// e restaura o flag depois — neutralizando os 2 pontos onde printComanda
// marca como impresso (linhas 1170 e 1181 de impressao.js).
export async function viewComanda(orderId) {
  const flagAtual = !!(S._printedComanda && S._printedComanda[orderId]);
  try {
    await ensureProductImagesForOrder(orderId);
    await _printComandaInternal(orderId);
  } catch (err) {
    console.error('[viewComanda] erro:', err);
    try {
      const msg = (err?.message || err || 'erro desconhecido');
      if (typeof toast === 'function') toast('❌ Erro ao visualizar: ' + msg, true);
    } catch(_){}
  } finally {
    // Restaura o flag de impressao pro estado anterior (visualizacao nao
    // conta como impressao real — a colab so esta conferindo).
    setTimeout(() => {
      if (!S._printedComanda) S._printedComanda = {};
      if (flagAtual) S._printedComanda[orderId] = true;
      else delete S._printedComanda[orderId];
      try { localStorage.setItem('fv_printed_comanda', JSON.stringify(S._printedComanda)); } catch(_){}
      // Re-render pra atualizar o icone do botao na tabela
      try { import('../main.js').then(m => m.render && m.render()).catch(()=>{}); } catch(_){}
    }, 100);
  }
}

// ── PRINT BATCH (CHAO DE DATAS) ────────────────────────────────
// Imprime VARIAS comandas em UM UNICO job de impressao.
// Antes: chamada antiga abria N overlays empilhadas (uma por pedido) e
// travava o navegador. Agora: combina tudo em 1 documento HTML, abre 1
// iframe so, 1 click de imprimir manda tudo pra impressora de uma vez.
export async function printComandasBatch(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    try { toast('Nenhuma comanda para imprimir', true); } catch(_){}
    return;
  }

  // Marcia (06/jun/2026 — pre Namorados): warning ANTES de processar
  // lotes grandes. No D-day, clicar 'imprimir 300 comandas' sem aviso
  // congela o browser por minutos sem feedback visual.
  if (orderIds.length > 100) {
    const ok = confirm(`Vai imprimir ${orderIds.length} comandas. Pode demorar 30-90 segundos pra carregar imagens e gerar a folha.\n\nDeseja continuar?`);
    if (!ok) return;
  }

  // Loading overlay (anti-congelamento visual)
  let _overlay = null;
  try {
    _overlay = document.createElement('div');
    _overlay.id = 'fv-batch-print-loading';
    _overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;color:#fff;font-family:Arial,sans-serif;';
    _overlay.innerHTML = `<div style="background:#9F1239;padding:24px 36px;border-radius:14px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4);">
      <div style="font-size:48px;animation:spin 1.4s linear infinite;display:inline-block;">🌹</div>
      <div id="fv-batch-print-status" style="font-size:16px;font-weight:800;margin-top:10px;">Carregando ${orderIds.length} comandas…</div>
      <div style="font-size:11px;opacity:.85;margin-top:6px;">Aguarde — não feche a aba.</div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    </div>`;
    document.body.appendChild(_overlay);
  } catch(_){}
  const _updStatus = (msg) => { try { const el = document.getElementById('fv-batch-print-status'); if (el) el.textContent = msg; } catch(_){} };

  try {
    // Carrega imagens dos produtos de TODOS os pedidos em PARALELO,
    // em batches de 10 pra nao saturar a banda. Antes era serial
    // (await por pedido) — 300 pedidos = minutos de espera.
    _updStatus(`Carregando imagens: 0 / ${orderIds.length}`);
    const BATCH = 10;
    for (let i = 0; i < orderIds.length; i += BATCH) {
      const chunk = orderIds.slice(i, i + BATCH);
      await Promise.all(chunk.map(id => ensureProductImagesForOrder(id).catch(()=>{})));
      _updStatus(`Carregando imagens: ${Math.min(i + BATCH, orderIds.length)} / ${orderIds.length}`);
    }

    // Coleta o HTML de cada comanda (em modo batch — so o pageHtml)
    const partes = [];
    let cmdFonte = 'Arial', cmdTam = '14', cmdBg = '#FFFFFF';
    for (const id of orderIds) {
      const r = _printComandaInternal(id, { returnHtml: true });
      if (r && r.pageHtml) {
        partes.push(r.pageHtml);
        cmdFonte = r.cmdFonte; cmdTam = r.cmdTam; cmdBg = r.cmdBg;
      }
    }
    _updStatus(`Montando ${partes.length} comandas…`);
    if (partes.length === 0) {
      if (_overlay) _overlay.remove();
      try { toast('Nenhuma comanda valida pra imprimir', true); } catch(_){}
      return;
    }

    // Doc HTML consolidado: 1 estilo + N paginas separadas por page-break
    const htmlDoc = `<!DOCTYPE html>
<html><head><title>Comandas em massa (${partes.length})</title>
<meta charset="utf-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;font-family:${cmdFonte},Arial,sans-serif;font-size:${cmdTam}px;text-transform:uppercase;}
  .page{
    width:210mm;
    min-height:297mm;
    margin:0 auto 8mm auto;
    background:${cmdBg};
    page-break-after:always;
    break-after:page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; margin-bottom:0; }
  /* Marcia (09/jun/2026): min-height (nao height fixa) + SEM overflow:hidden
     + SEM page-break-inside:avoid. Comanda padrao (cabe em 148mm) imprime
     2-em-1-A4 como sempre. Comanda gigante (mensagem longa, muitos itens)
     cresce naturalmente — impressora divide em 2 folhas, NAO corta info. */
  .comanda{
    width:210mm;
    min-height:148mm;
    background:${cmdBg};
    box-sizing:border-box;
    position:relative;
  }
  .comanda.tipo-arquivo{ border-bottom:2px dashed #888; }
  .cut-label{
    position:absolute; bottom:-9px; left:50%;
    transform:translateX(-50%);
    background:#fff; padding:0 14px; font-size:9px; color:#888;
    white-space:nowrap; font-family:Arial; letter-spacing:2px; z-index:5;
  }
  @media print{
    body{background:#fff;margin:0;}
    .page{width:100%;height:auto;margin:0;page-break-after:always;}
    .page:last-child{page-break-after:auto;}
    .comanda{width:100%;min-height:50vh;box-shadow:none;}
    @page{size:A4 portrait;margin:0;}
  }
</style></head>
<body>
${partes.join('\n')}
</body></html>`;

    // Overlay UNICO com iframe + botao Imprimir
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.setAttribute('data-overlay','true');
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;width:100%;max-width:960px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);margin:auto;';
    box.innerHTML = `
      <div style="padding:14px 20px;background:#8B2252;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10;">
        <span style="color:#fff;font-weight:bold;font-size:15px;">🧾 Comandas em massa — ${partes.length} pedido(s)</span>
        <div style="display:flex;gap:8px;">
          <button id="btn-do-print-batch" style="background:#fff;color:#8B2252;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ IMPRIMIR TODAS (A4)</button>
          <button id="btn-close-overlay-batch" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
        </div>
      </div>
      <div style="padding:8px 14px;background:#FEF3C7;border-bottom:1px solid #FCD34D;font-size:12px;color:#92400E;">
        💡 Dica: clique em <b>IMPRIMIR TODAS</b> uma única vez — o navegador vai imprimir as ${partes.length} comandas em sequência.
      </div>
      <div style="padding:16px;background:#f5f5f5;">
        <iframe id="comanda-iframe-batch" style="width:100%;height:700px;border:none;border-radius:8px;background:#fff;"></iframe>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Remove o overlay de loading agora que o overlay de visualizacao apareceu
    if (_overlay) { _overlay.remove(); _overlay = null; }
    // Marcia (06/jun/2026 pre Namorados): srcdoc em vez de setTimeout
    // setTimeout(50)+contentDocument.write era fragil — em browsers
    // lentos com 300 comandas, o iframe podia nao estar pronto e o
    // write falhava silencioso. srcdoc garante render sincronizado.
    const iframe = document.getElementById('comanda-iframe-batch');
    if (iframe) {
      try {
        iframe.srcdoc = htmlDoc;
      } catch (_) {
        // Fallback pro caminho antigo se srcdoc nao suportado
        setTimeout(() => {
          try {
            iframe.contentDocument.open();
            iframe.contentDocument.write(htmlDoc);
            iframe.contentDocument.close();
          } catch(_){}
        }, 50);
      }
    }

    document.getElementById('btn-do-print-batch')?.addEventListener('click', () => {
      const iframe = document.getElementById('comanda-iframe-batch');
      if (iframe) iframe.contentWindow.print();
      // Marca todos como impressos
      const printed = JSON.parse(localStorage.getItem('fv_printed_comanda')||'{}');
      orderIds.forEach(id => { printed[id] = true; });
      localStorage.setItem('fv_printed_comanda', JSON.stringify(printed));
      S._printedComanda = printed;
    });
    const close = () => overlay.remove();
    document.getElementById('btn-close-overlay-batch')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  } catch (err) {
    console.error('[printComandasBatch] ERRO:', err);
    if (_overlay) { _overlay.remove(); _overlay = null; }
    try {
      if (typeof toast === 'function') toast('❌ Erro ao imprimir lote: ' + (err?.message || err), true);
      else alert('Erro ao imprimir lote: ' + (err?.message || err));
    } catch(_){}
  }
}

function _printComandaInternal(orderId, opts){
  // Modo BATCH: opts.returnHtml=true -> retorna { htmlDoc, pageHtml, styleHtml }
  // ao inves de criar overlay. Usado por printComandasBatch para combinar
  // varias comandas em um unico job de impressao (sem abrir N overlays).
  opts = opts || {};
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) {
    console.warn('[printComanda] pedido nao encontrado:', orderId, 'total em S.orders=', S.orders?.length);
    if (opts.returnHtml) return null;
    try { if (typeof toast === 'function') toast('❌ Pedido não encontrado', true); } catch(_){}
    return;
  }
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');
  const cor    = layout.comandaCor||'#8B2252';
  const cmdBg  = layout.comandaBg||'#FFFFFF';
  const cmdFonte = layout.comandaFonte||'Arial';
  const cmdTam   = layout.comandaTamanho||'14';
  const empresa= (layout.nomeEmpresa||cfg.razao||'LA\u00c7OS ETERNOS FLORICULTURA').toUpperCase();
  const whats  = layout.whatsapp||cfg.whats||'(92) 99300-2433';
  const UC     = s => s ? String(s).toUpperCase().trim() : '';

  // ── NUMERO DO PEDIDO formatado como #00001 ─────────────────
  const rawNum = o.orderNumber || o.numero || '';
  const numStr = String(rawNum).replace(/^PED-?/i,'').replace(/^#/,'');
  const numMatch = numStr.match(/\d+/);
  const orderNumFmt = numMatch
    ? '#' + numMatch[0].padStart(5,'0')
    : (numStr ? '#'+numStr : '#00000');

  // ── DATA / TURNO / HORARIO ──────────────────────────────────
  const dataEntrega = o.scheduledDate
    ? formatOrderDate(o.scheduledDate, 'comanda').toUpperCase()
    : '\u2014';
  const turno   = UC(o.scheduledPeriod||'');
  // Monta exibicao do horario considerando janela (Horario Especifico)
  // Retorna so os horarios (sem emoji) — o template ja coloca o ⏰
  let horario = '';
  if (o.scheduledTime && o.scheduledTime !== '00:00') {
    horario = UC(o.scheduledTime);
    if (o.scheduledTimeEnd && o.scheduledTimeEnd !== '00:00' && o.scheduledTimeEnd !== o.scheduledTime) {
      horario = `${UC(o.scheduledTime)} \u00E0S ${UC(o.scheduledTimeEnd)}`;
    }
  }
  // Label combinado (compatibilidade com templates antigos)
  // ⚡ Express: prazo = 2h após a aprovação do pagamento (Marcia 29/out/2026).
  const _hExp = isExpress(o) ? horaExpress(o) : '';
  const dtLabel = [dataEntrega, isExpress(o) ? '\u26A1 EXPRESS' + (_hExp ? ' AT\u00C9 ' + _hExp : '') : turno, horario].filter(Boolean).join(' \u00B7 ');

  // Detecta se e "Horario Especifico" (janela de horario) — sem regex
  // para evitar possiveis problemas de transpile com caracteres unicode
  const periodoLow = String(o.scheduledPeriod || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos
  const isHorarioEspecifico = periodoLow.includes('horario especifico')
    || (o.scheduledTimeEnd && o.scheduledTimeEnd !== '00:00' && o.scheduledTimeEnd !== o.scheduledTime);
  // Badge GRANDE para destacar na comanda (fundo amarelo alerta)
  const expressBadge = isExpress(o)
    ? `<div style="background:#EDE9FE;border:3px solid #7C3AED;border-radius:10px;padding:10px 16px;text-align:center;font-size:18px;font-weight:900;color:#5B21B6;margin:6px 0;letter-spacing:.5px;">
        \u26A1 EXPRESS: ${_hExp ? 'ENTREGAR AT\u00C9 ' + _hExp : EXPRESS_HORAS + 'H AP\u00D3S A APROVA\u00C7\u00C3O DO PAGAMENTO'}
       </div>` : '';
  const horarioEspecificoBadge = isHorarioEspecifico && horario
    ? `<div style="background:#FEF3C7;border:3px solid #F59E0B;border-radius:10px;padding:10px 16px;text-align:center;font-size:18px;font-weight:900;color:#92400E;margin:6px 0;letter-spacing:.5px;box-shadow:0 2px 6px rgba(245,158,11,.3);">
        \u23F0 HOR\u00C1RIO ESPEC\u00CDFICO: ${horario}
       </div>` : '';

  // \u2500\u2500 PEDIDO DO SITE (e-commerce): barra verde + hora da compra + entrega
  //    estimada. Regra (Marcia out/2026): entrega no MESMO dia = at\u00E9 3h ap\u00F3s a
  //    compra, salvo turno escolhido mais tarde; outros dias = janela do turno.
  //    Janelas: Manh\u00E3 08:00\u201312:30 \u00B7 Tarde 12:30\u201318:00 \u00B7 Noite 18:00\u201319:00.
  // \u2500\u2500 PEDIDO DO SITE: pe\u00E7as montadas (Marcia out/2026) \u2500\u2500
  //  \u2022 siteTopBar: barra verde fina no TOPO (com data/hora da compra, discreta).
  //  \u2022 siteEstimativaTxt: entregue no bloco "ENTREGA \u00B7 TURNO \u00B7 HOR\u00C1RIO".
  const _ehSite = /(e-?comm|site)/i.test(String(o.source || ''));
  let siteTopBar = '', siteEstimativaTxt = '';
  if (_ehSite) {
    const TW = { manha:[480,750,'08:00','12:30','Manh\u00E3'], tarde:[750,1080,'12:30','18:00','Tarde'], noite:[1080,1140,'18:00','19:00','Noite'] };
    const _tk = (() => { const s=String(o.scheduledPeriod||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036F]/g,''); if(s.includes('manh'))return'manha'; if(s.includes('tard'))return'tarde'; if(s.includes('noit'))return'noite'; return ''; })();
    let horaCompra = '\u2014', compraMin = null;
    try {
      const hc = new Date(o.createdAt).toLocaleTimeString('pt-BR', { timeZone:'America/Manaus', hour:'2-digit', minute:'2-digit' });
      if (/^\d{2}:\d{2}/.test(hc)) { horaCompra = hc; const [h,m] = hc.split(':').map(Number); compraMin = h*60+m; }
    } catch(_){}
    const diaCompra = (() => { try { return new Date(o.createdAt).toLocaleDateString('en-CA', { timeZone:'America/Manaus' }); } catch(_){ return ''; } })();
    const diaEntrega = String(o.scheduledDate || '').slice(0,10);
    const mesmoDia = diaCompra && diaEntrega && diaCompra === diaEntrega;
    const _hm = (min) => String(Math.floor(min/60)).padStart(2,'0')+':'+String(min%60).padStart(2,'0');
    if (o.scheduledTime && o.scheduledTime !== '00:00') {
      siteEstimativaTxt = 'hor\u00E1rio espec\u00EDfico ' + UC(horario);
    } else if (_tk && TW[_tk]) {
      const [ini, fim, iLbl, fLbl, nome] = TW[_tk];
      if (mesmoDia && compraMin != null) {
        const by = compraMin + 180; // promessa 3h
        siteEstimativaTxt = (by <= ini) ? `${iLbl}\u2013${fLbl} (turno ${nome})` : `at\u00E9 ${_hm(Math.min(by, fim))} (prazo 3h)`;
      } else {
        siteEstimativaTxt = `turno ${nome} (${iLbl}\u2013${fLbl})`;
      }
    } else if (mesmoDia && compraMin != null) {
      siteEstimativaTxt = `at\u00E9 ${_hm(compraMin + 180)} (prazo 3h)`;
    } else {
      siteEstimativaTxt = UC(o.scheduledPeriod || turno || '\u2014');
    }
    const compraData = diaCompra ? diaCompra.split('-').reverse().slice(0,2).join('/') : '';
    siteTopBar = `<div style="background:#10B981;color:#fff;border-radius:6px;padding:4px 10px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-size:12px;font-weight:900;letter-spacing:.5px;">\uD83C\uDF10 PEDIDO DO SITE</span>
      <span style="font-size:10.5px;font-weight:600;opacity:.95;text-transform:none;">\uD83D\uDED2 Compra: ${compraData ? compraData + ' ' : ''}${horaCompra}</span>
    </div>`;
  }
  // iFood: barra VERMELHA fina no TOPO (analoga a do site). Marcia (out/2026).
  const _ehIfood = /ifood/i.test(String(o.source || '') + ' ' + String(o.canal || o.channel || '') + ' ' + String(o.paymentMethod || o.formaPagamento || ''));
  const ifoodTopBar = _ehIfood
    ? `<div style="background:#EA1D2C;color:#fff;border-radius:6px;padding:4px 10px;margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <span style="font-size:12px;font-weight:900;letter-spacing:.5px;">\uD83C\uDF74 PEDIDO IFOOD</span>
      <span style="font-size:10.5px;font-weight:600;opacity:.95;text-transform:none;">canal iFood</span>
    </div>` : '';

  // Linha de entrega estimada p/ injetar no bloco ENTREGA\u00B7TURNO\u00B7HOR\u00C1RIO.
  const siteEstimativaLinha = (_ehSite && siteEstimativaTxt)
    ? `<div style="font-size:13px;font-weight:900;color:#065F46;margin-top:3px;">\u23F1\uFE0F ENTREGA ESTIMADA: ${siteEstimativaTxt}</div>` : '';

  // ── ENTREGADOR ─────────────────────────────────────────────
  const entregador = UC(o.driverName||'A DEFINIR');

  // ── TIER / N\u00CDVEL DO CLIENTE (CRM) ──────────────────────
  const clientStats = getClientWithStats({
    _id: o.client?._id || o.client,
    phone: o.clientPhone,
    clientPhone: o.clientPhone,
  });
  const tier = clientStats ? getClientTier(clientStats) : null;
  const tierBadgePrint = tier ? `<span style="display:inline-flex;align-items:center;gap:4px;background:${tier.bg};color:${tier.color};border:1.5px solid ${tier.border};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:800;margin-left:6px;text-transform:uppercase;letter-spacing:.5px;vertical-align:middle;"><span style="font-size:14px;line-height:1;">${tier.icon}</span><span>${tier.label}</span></span>` : '';

  // Numero do pedido na sequencia historica do cliente (ex: 4o pedido)
  const numPedidoCliente = clientStats ? (parseInt(clientStats.totalOrders)||0) : 0;
  const numPedidoBadge = numPedidoCliente > 0
    ? `<div style="background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:800;color:#78350F;margin:4px 0;text-align:center;">${numPedidoCliente}\u00BA PEDIDO DESTE CLIENTE</div>`
    : '';

  // ── ENDERECO COMPLETO ─────────────────────────────────────
  const rua   = [UC(o.deliveryStreet||''), o.deliveryNumber?'N\u00ba '+UC(o.deliveryNumber):'', UC(o.deliveryComplement||'')].filter(Boolean).join(', ');
  const bairro= UC(o.deliveryNeighborhood||o.deliveryZone||'');
  const cidade= UC(o.deliveryCity||'MANAUS');
  const cond  = o.isCondominium ? [o.condName?UC(o.condName):'', o.block?'BLOCO '+UC(o.block):'', o.apt?'AP '+UC(o.apt):''].filter(Boolean).join(' \u2014 ') : '';
  // REF = referencia do endereco (ex: "casa azul, ao lado da padaria")
  const ref   = UC(o.deliveryReference||'');
  // OBS = observacoes do PDV (anotadas pelo atendimento — ex: "tocar interfone 2x")
  // Mantido SEPARADO do ref pra ficar claro o que e uma coisa e outra.
  const obsTxt = String(o.notes || o.observacoes || '').trim();
  // Telefone na comanda: contato do CLIENTE (quem comprou), nao do destinatario.
  // Fallback: se cliente nao tiver telefone, usa o do destinatario.
  const phone = o.clientPhone || o.client?.phone || o.recipientPhone || '';

  // ── BLOCO OBSERVACOES (PDV) ────────────────────────────────
  // Aparece destacado em amarelo nas duas vias (CD e Entregador).
  // Respeita a config layout.comandaMostrarObs (default true).
  const mostrarObs = (layout.comandaMostrarObs !== false) && obsTxt.length > 0;
  const obsBlock = mostrarObs
    ? `<div style="background:#FEF9C3;border:2px solid #CA8A04;border-radius:8px;padding:8px 12px;margin-bottom:6px;">
        <div style="font-size:10px;font-weight:800;color:#713F12;letter-spacing:1px;margin-bottom:3px;">📝 OBSERVAÇÕES DO PEDIDO</div>
        <div style="font-size:14px;font-weight:700;color:#422006;line-height:1.3;text-transform:none;">${obsTxt}</div>
       </div>`
    : '';

  // ── ITENS COM FOTO ─────────────────────────────────────────
  // Truncate helper: corta nomes/descricoes longas para evitar
  // estourar a A4 com texto enorme.
  const truncate = (s, max) => {
    const t = String(s||'').trim();
    return t.length > max ? t.slice(0, max-1) + '\u2026' : t;
  };
  const itemsHtml = (o.items||[]).map(i=>{
    const prod = S.products.find(p=>p._id===i.product||p.name===i.name);
    const img  = prod?.imagem || prod?.images?.[0] || prod?.image || '';
    const foto = img
      ? `<img src="${img}" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:2px solid ${cor};flex-shrink:0;"/>`
      : `<div style="width:72px;height:72px;border-radius:6px;background:#F5D6E0;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0;">\u{1F338}</div>`;
    const complements = [prod?.productionNotes, i.complement, i.notes].filter(Boolean).map(c => truncate(c, 90));
    // \u2500\u2500 VARIA\u00c7\u00c3O / PERSONALIZA\u00c7\u00c3O (Marcia out/2026): em DESTAQUE \u2500\u2500
    // Varia\u00e7\u00e3o de cor escolhida + personaliza\u00e7\u00f5es (cesta cor / bal\u00e3o frase /
    // caneca nome+frase). A produ\u00e7\u00e3o precisa ver na hora o que o cliente pediu.
    const _cz = i.customizacao || {};
    const _destaques = [];
    if (i.colorName) _destaques.push(`\u{1F3A8} ${UC(i.colorName)}`);
    if (_cz.cestaCor)   _destaques.push(`\u{1F3A8} COR DA CESTA: ${UC(_cz.cestaCor)}`);
    if (_cz.balaoFrase) _destaques.push(`\u{1F388} BAL\u00c3O: \u201c${UC(_cz.balaoFrase)}\u201d`);
    if (_cz.canecaNome) _destaques.push(`\u2615 CANECA: ${UC(_cz.canecaNome)}${_cz.canecaFrase ? ` \u2014 \u201c${UC(_cz.canecaFrase)}\u201d` : ''}`);
    const destaqueBlock = _destaques.length
      ? `<div style="margin-top:4px;background:#FEF3C7;border:1.5px solid #F59E0B;border-radius:5px;padding:4px 8px;font-size:13px;font-weight:900;color:#92400E;line-height:1.35;">${_destaques.join(' &nbsp;\u00b7&nbsp; ')}</div>`
      : '';
    return `<div style="display:flex;align-items:center;gap:12px;padding:5px 0;border-bottom:1px solid #e5e5e5;">
      ${foto}
      <div style="flex:1;min-width:0;">
        <div style="font-size:17px;font-weight:900;color:#111;line-height:1.2;">${UC(i.qty)}\u00d7 ${UC(truncate(i.name, 60))}</div>
        ${destaqueBlock}
        ${complements.map(c=>`<div style="font-size:11px;color:#555;margin-top:3px;line-height:1.25;">\u{1F4CB} ${UC(c)}</div>`).join('')}
      </div>
    </div>`;
  }).join('');

  // ── QR CODE: leva para a página pública do pedido (sem login) ──
  const appOrigin = window.location.origin; // ex: https://sistema.floriculturalacoseternos.com.br
  const qrUrl   = `${appOrigin}/entrega/${orderId}`;
  const qrSrc   = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}&margin=4&bgcolor=ffffff&color=1a1a1a`;

  // ── AVISO DE EDICAO (se pedido foi editado recentemente) ────
  // Aparece como tag discreto no canto pra equipe nao usar comanda velha.
  const editadoBadge = (() => {
    if (!o._lastEditedAt) return '';
    const editAge = (Date.now() - new Date(o._lastEditedAt).getTime()) / 60000;
    if (editAge >= 24*60) return ''; // mais de 24h, considera "definitivo"
    return `<div style="position:absolute;top:6px;left:6px;background:#FBBF24;color:#78350F;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:800;letter-spacing:.5px;z-index:5;">
      ⚠️ EDITADO ${editAge < 60 ? Math.round(editAge)+'min' : Math.round(editAge/60)+'h'}
    </div>`;
  })();

  // ── DADOS DA VENDA: VENDEDORA + UNIDADE (discreto — rodape) ──
  const vendedorNome = UC(o.vendedorNome || o.createdByName || '');
  const unidadeVenda = UC(o.saleUnit || o.unit || o.unidade || '—');
  const unidadeBlock = (vendedorNome || unidadeVenda !== '—')
    ? `<div style="font-size:8px;color:#9CA3AF;font-style:italic;text-align:right;margin-top:2px;letter-spacing:.3px;text-transform:none;">
        ${vendedorNome ? 'Vendido por ' + vendedorNome : ''}${vendedorNome && unidadeVenda !== '—' ? ' · ' : ''}${unidadeVenda !== '—' ? unidadeVenda : ''}
       </div>`
    : '';

  // ── RETIRADA NA LOJA: destaque grande se tipo = Retirada ─────
  const _tipoLow = String(o.type||o.tipo||'').toLowerCase();
  const isRetirada = _tipoLow.includes('retirada');
  const pickupUnitLabel = UC(o.pickupUnit || o.retiradaLoja || (isRetirada ? (o.unit||o.unidade||'') : ''));
  const retiradaBlock = isRetirada && pickupUnitLabel
    ? `<div style="background:linear-gradient(135deg,#FEF3C7,#FDE68A);border:3px solid #B45309;border-radius:10px;padding:10px 14px;margin-bottom:6px;text-align:center;">
        <div style="font-size:10px;color:#7C2D12;font-weight:700;letter-spacing:1.5px;">\u{1F3EA} RETIRADA NA LOJA</div>
        <div style="font-size:22px;font-weight:900;color:#7C2D12;line-height:1.1;margin-top:2px;">${pickupUnitLabel}</div>
       </div>`
    : '';

  // ── REENTREGA: destaque forte (Marcia jul/2026) ──────────────
  // A comanda de uma reentrega precisa ser reconhecida de longe, pra nao
  // ser confundida com a comanda da entrega original — e porque o endereco
  // pode ter sido trocado na hora de marcar a reentrega.
  const _reCount = Number(o.reentregaCount || 0) || 0;
  const reentregaBlock = _reCount > 0
    ? `<div style="background:repeating-linear-gradient(45deg,#EDE9FE,#EDE9FE 12px,#DDD6FE 12px,#DDD6FE 24px);border:3px dashed #6D28D9;border-radius:10px;padding:10px 14px;margin-bottom:6px;text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#4C1D95;line-height:1.1;letter-spacing:1px;">\u{1F504} REENTREGA — ${_reCount}ª TENTATIVA</div>
        ${o.reentregaMotivo ? `<div style="font-size:11px;color:#5B21B6;font-weight:700;margin-top:3px;">MOTIVO: ${UC(o.reentregaMotivo)}</div>` : ''}
        <div style="font-size:9px;color:#6D28D9;margin-top:3px;font-weight:800;letter-spacing:.5px;">⚠️ CONFIRA O ENDEREÇO — PODE TER MUDADO</div>
       </div>`
    : '';

  // ── BLOCO ENDERECO (reutilizado nas 2 vias) ────────────────
  const enderecoBlock = (accentColor) => `
    <div style="background:#f8f8f8;border-left:5px solid ${accentColor};border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:6px;">
      <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:1px;margin-bottom:4px;">\u{1F4CD} ENDERE\u00c7O</div>
      ${rua?`<div style="font-size:17px;font-weight:800;color:#111;text-transform:uppercase;">${rua}</div>`:''}
      ${bairro?`<div style="font-size:19px;font-weight:900;color:#111;margin-top:3px;text-transform:uppercase;">${bairro} \u2014 ${cidade}</div>`:''}
      ${cond?`<div style="font-size:14px;font-weight:700;color:#333;margin-top:3px;">\u{1F3E2} ${cond}</div>`:''}
      ${ref?`<div style="font-size:13px;color:#555;margin-top:3px;">\u{1F4CD} REF: ${ref}</div>`:''}
      ${phone?`<div style="font-size:13px;color:#333;margin-top:3px;text-transform:none;font-weight:700;">\u{1F4F1} ${phone}</div>`:''}
    </div>`;

  // ── COBRANCA ────────────────────────────────────────────────
  // Caso 1: DINHEIRO  → destaca valor + troco / sem troco
  // Caso 2: LEVAR MAQUINETA → destaca aceitar Debito/Credito/Pix
  // Caso 3: PIX → destaca receber via Pix
  // Caso 4: outro → alerta para verificar
  const _totalFmt = (o.total||0).toFixed(2).replace('.',',');
  let _detalheEntrega = '';
  if (o.payment === 'Pagar na Entrega') {
    const _pod = String(o.paymentOnDelivery||'').toLowerCase().trim();
    if (_pod === 'dinheiro') {
      const _trocoP = parseFloat(o.trocoPara||0);
      const _temTroco = _trocoP > (o.total||0);
      const _semTroco = !o.trocoPara || _trocoP === 0;
      _detalheEntrega = '<div style="background:#FEF3C7;border-left:5px solid #B45309;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#7C2D12;">💵 RECEBER EM DINHEIRO</div>'
        + (_temTroco
            ? '<div style="font-size:14px;font-weight:900;color:#065F46;margin-top:3px;">💰 TROCO P/ R$ ' + _trocoP.toFixed(2).replace('.',',') + ' — LEVAR R$ ' + (_trocoP - (o.total||0)).toFixed(2).replace('.',',') + '</div>'
            : (_semTroco
                ? '<div style="font-size:13px;font-weight:800;color:#7C2D12;margin-top:3px;">⚠️ NAO PRECISA DE TROCO (cliente paga valor exato)</div>'
                : '<div style="font-size:13px;font-weight:800;color:#7C2D12;margin-top:3px;">ℹ️ Cliente paga R$ ' + _trocoP.toFixed(2).replace('.',',') + ' (sem troco)</div>'
              )
          )
        + '</div>';
    } else if (_pod === 'levar maquineta' || _pod === 'maquineta' || _pod === 'maquina' || _pod === 'cartao' || _pod === 'cartão') {
      _detalheEntrega = '<div style="background:#DBEAFE;border-left:5px solid #1D4ED8;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#1E3A8A;">💳 LEVAR MAQUINETA</div>'
        + '<div style="font-size:11px;font-weight:700;color:#1E3A8A;margin-top:2px;text-transform:none;">Aceitar Débito / Crédito / Pix</div>'
        + '</div>';
    } else if (_pod === 'pix') {
      _detalheEntrega = '<div style="background:#DCFCE7;border-left:5px solid #15803D;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#14532D;">📲 RECEBER VIA PIX</div>'
        + '</div>';
    } else {
      _detalheEntrega = '<div style="background:#FEE2E2;border-left:5px solid #DC2626;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">'
        + '<div style="font-size:13px;font-weight:900;color:#7F1D1D;">⚠️ FORMA DE PAGAMENTO NÃO DEFINIDA — VERIFICAR COM CLIENTE</div>'
        + '</div>';
    }
  }
  // (variavel mantida pra compat — agora retorna vazio porque info ja esta em _detalheEntrega)
  const trocoLinha = (o.paymentOnDelivery === 'Dinheiro' && o.trocoPara && parseFloat(o.trocoPara) > (o.total||0))
    ? `<div style="background:#D1FAE5;border:2px solid #059669;border-radius:6px;padding:6px 10px;text-align:center;font-size:14px;font-weight:900;color:#065F46;margin-top:4px;">
        \uD83D\uDCB0 TROCO P/ R$ ${parseFloat(o.trocoPara).toFixed(2).replace('.',',')} \u2014 LEVAR R$ ${(parseFloat(o.trocoPara) - (o.total||0)).toFixed(2).replace('.',',')}
       </div>` : '';
  const cobrancaBlock = o.payment==='Pagar na Entrega'
    ? `<div style="margin-bottom:6px;">
         <div style="background:#FFF8E1;border:2px solid #B7860F;border-radius:6px;padding:8px 10px;text-align:center;font-size:16px;font-weight:900;color:#8B6914;">
           \u{1F4B0} COBRAR NA ENTREGA: R$ ${_totalFmt}
         </div>
         ${_detalheEntrega}
       </div>` : '';

  // ── COBRANCA NA RETIRADA ──────────────────────────────────
  // Pedidos do tipo Retirada: pickupPayMode pode ser
  //  - 'pago'             → ja pagou tudo agora (so confirma)
  //  - 'total_retirada'   → cobra TOTAL ao retirar
  //  - 'parcial'          → cobra a diferenca ao retirar
  let pickupBlock = '';
  // Marcia (02/jun/2026): se ja foi pago (paymentStatus aprovado),
  // nao imprime mais 'COBRAR NA RETIRADA' — evita atendente cobrar 2x.
  const _isPgPagoImp = new Set(['Aprovado','Pago','aprovado','pago','Recebido','Pago na Entrega']);
  const _jaPagouImp = _isPgPagoImp.has(String(o.paymentStatus||''));
  if (o.type === 'Retirada' && o.pickupPayMode && !_jaPagouImp) {
    if (o.pickupPayMode === 'total_retirada') {
      pickupBlock = `<div style="margin-bottom:6px;">
        <div style="background:#FEF3C7;border:2px solid #B45309;border-radius:6px;padding:8px 10px;text-align:center;font-size:16px;font-weight:900;color:#7C2D12;">
          🏪 COBRAR NA RETIRADA: R$ ${_totalFmt}
        </div>
      </div>`;
    } else if (o.pickupPayMode === 'parcial') {
      const pago = Number(o.pickupParcialPago||0);
      const pendente = Number(o.pickupParcialPendente||0);
      const metodo = String(o.pickupParcialMethod||'').toUpperCase();
      pickupBlock = `<div style="margin-bottom:6px;">
        <div style="background:#FEF3C7;border:2px solid #B45309;border-radius:6px;padding:8px 10px;text-align:center;">
          <div style="font-size:13px;font-weight:900;color:#7C2D12;">💳 PAGAMENTO PARCIAL</div>
          <div style="font-size:11px;color:#7C2D12;margin-top:3px;">Total: R$ ${_totalFmt}</div>
        </div>
        <div style="background:#DCFCE7;border-left:5px solid #15803D;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">
          <div style="font-size:12px;font-weight:900;color:#14532D;">✅ JÁ PAGO: R$ ${pago.toFixed(2).replace('.',',')}${metodo?' via '+metodo:''}</div>
        </div>
        <div style="background:#FEE2E2;border-left:5px solid #DC2626;padding:6px 10px;margin-top:5px;border-radius:0 6px 6px 0;">
          <div style="font-size:13px;font-weight:900;color:#7F1D1D;">🏪 COBRAR NA RETIRADA: R$ ${pendente.toFixed(2).replace('.',',')}</div>
        </div>
      </div>`;
    }
    // Caso 'pago': SILENCIO. Pedido ja deu baixa como Aprovado.
    // Nao precisa exibir nada extra na comanda — ninguem precisa cobrar.
  }

  // ═══════════════════════════════════════════════════════════
  // VIA CD -- Arquivo interno
  // ═══════════════════════════════════════════════════════════
  const viaCD = `
  <div style="padding:8px 14px;font-family:Arial,sans-serif;text-transform:uppercase;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:4px;position:relative;">
    ${editadoBadge}
    ${siteTopBar}
    ${ifoodTopBar}

    <!-- Header CD -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${cor};padding-bottom:4px;">
      <div>
        <div style="font-size:12px;font-weight:900;color:${cor};">${empresa}</div>
        <div style="font-size:9px;color:#555;text-transform:none;">${whats}</div>
        <div style="background:${cor};color:#fff;display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700;margin-top:2px;">\u{1F4C2} VIA CD \u2014 ARQUIVO</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:24px;font-weight:900;color:#111;line-height:1;">${orderNumFmt}</div>
        <div style="font-size:8px;color:#666;">PEDIDO</div>
        ${(() => { const d = String(phone||'').replace(/\D/g,''); return d.length>=4 ? `<div style="font-size:11px;font-weight:800;color:#1E5AA8;margin-top:3px;background:#E0F2FE;border-radius:4px;padding:1px 6px;display:inline-block;letter-spacing:.5px;">📱 …${d.slice(-4)}</div>` : ''; })()}
      </div>
    </div>

    <!-- Produto -->
    <div>${itemsHtml}</div>

    <!-- Grid dados -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
      <div style="background:#FDF4F7;border-radius:6px;padding:8px;border-left:4px solid ${cor};">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">DESTINAT\u00c1RIO</div>
        <div style="font-size:20px;font-weight:900;color:${cor};text-transform:uppercase;">${UC(o.recipient||o.client?.name||'\u2014')}</div>
        ${o.recipientPhone ? `<div style="font-size:14px;font-weight:800;color:#111;margin-top:3px;">\u{1F4F1} ${o.recipientPhone}</div>` : ''}
      </div>
      <div style="background:#f5f5f5;border-radius:6px;padding:8px;">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">REMETENTE${clientStats?.code?` · <span style="color:#8B2252;font-weight:700;">#${clientStats.code}</span>`:''}</div>
        <div style="font-size:13px;font-weight:700;">${UC(o.client?.name||o.clientName||'\u2014')}${tierBadgePrint}</div>
        ${numPedidoBadge}
      </div>
      <div style="background:#f5f5f5;border-radius:6px;padding:8px;grid-column:span 2;">
        <div style="font-size:9px;color:#888;margin-bottom:2px;">\u{1F4C5} ENTREGA \u00b7 TURNO \u00b7 HOR\u00c1RIO</div>
        <div style="font-size:16px;font-weight:900;">${dtLabel||'\u2014'}</div>
        ${siteEstimativaLinha}
      </div>
    </div>

    <!-- Retirada na loja (destaque) -->
    ${reentregaBlock}
    ${retiradaBlock}

    <!-- Endereco (so se NAO for retirada) -->
    ${!isRetirada ? enderecoBlock(cor) : ''}

    <!-- Vendedora + Unidade -->
    ${unidadeBlock}

    <!-- Cartao -->
    ${o.cardBlank
      ? `<div style="background:#FDF4F7;border-left:4px solid ${cor};padding:5px 10px;border-radius:0 6px 6px 0;font-size:10px;text-transform:none;line-height:1.3;">
      \u{1F48C} <strong>CART\u00c3O:</strong> Cliente solicitou cart\u00e3o em branco</div>`
      : (o.cardMessage?`<div style="background:#FDF4F7;border-left:4px solid ${cor};padding:5px 10px;border-radius:0 6px 6px 0;font-size:10px;text-transform:none;line-height:1.3;">
      \u{1F48C} <strong>CART\u00c3O:</strong> ${o.cardPara?'PARA '+UC(o.cardPara)+' \u2014 ':''}"${truncate(o.cardMessage, 240)}" ${o.identifyClient!==false?'\u2014 DE: '+UC(o.cardDe||o.client?.name||o.clientName||''):'\u2014 AN\u00d4NIMO'}</div>`:'')}

    <!-- Horario Especifico (destaque se aplicavel) -->
    ${expressBadge}${horarioEspecificoBadge}

    <!-- Observacoes do PDV (se houver) -->
    ${obsBlock}

    <!-- Cobranca -->
    ${cobrancaBlock}
    ${pickupBlock}

    <!-- Entregador + QR -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:6px;border-top:1px dashed #bbb;">
      <div>
        <div style="font-size:9px;color:#888;">ENTREGADOR</div>
        <div style="font-size:14px;font-weight:900;color:#333;">${entregador}</div>
      </div>
      <div style="text-align:center;">
        <img src="${qrSrc}" style="width:60px;height:60px;"/>
        <div style="font-size:8px;color:#888;margin-top:1px;">QR BAIXA ENTREGA</div>
      </div>
    </div>
  </div>`;

  // ═══════════════════════════════════════════════════════════
  // VIA ENTREGADOR -- Campo de assinatura e foto
  // ═══════════════════════════════════════════════════════════
  const floriAddr  = UC(cfg.addr||'');
  const floriEmail = (cfg.email||'').toLowerCase();
  const floriSite  = (layout.site||cfg.site||'').toLowerCase();

  const viaEntregador = `
  <div style="padding:8px 14px;font-family:Arial,sans-serif;text-transform:uppercase;box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;gap:4px;position:relative;">
    ${editadoBadge}
    ${siteTopBar}
    ${ifoodTopBar}

    <!-- Header Entregador -->
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #333;padding-bottom:4px;">
      <div>
        <div style="font-size:12px;font-weight:900;color:#111;">${empresa}</div>
        <div style="background:#333;color:#fff;display:inline-block;padding:1px 7px;border-radius:20px;font-size:9px;font-weight:700;margin-top:2px;">\u{1F69A} VIA ENTREGADOR</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:24px;font-weight:900;color:#111;line-height:1;">${orderNumFmt}</div>
        <div style="font-size:8px;color:#666;">PEDIDO</div>
        ${(() => { const d = String(phone||'').replace(/\D/g,''); return d.length>=4 ? `<div style="font-size:11px;font-weight:800;color:#1E5AA8;margin-top:3px;background:#E0F2FE;border-radius:4px;padding:1px 6px;display:inline-block;letter-spacing:.5px;">📱 …${d.slice(-4)}</div>` : ''; })()}
      </div>
    </div>

    <!-- Produto (com foto para conferencia) -->
    <div>${itemsHtml}</div>

    <!-- DESTINATARIO + TURNO/HORARIO ampliados -->
    <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:5px;">
      <div style="background:#f5f5f5;border-left:5px solid #333;border-radius:0 8px 8px 0;padding:8px 12px;">
        <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:.5px;">\u{1F4E6} DESTINAT\u00c1RIO</div>
        <div style="font-size:20px;font-weight:900;color:#111;line-height:1.15;text-transform:uppercase;margin-top:2px;">${UC(truncate(o.recipient||'\u2014',30))}</div>
      </div>
      <div style="background:#C8436A;border-radius:8px;padding:7px 10px;text-align:center;display:flex;flex-direction:column;justify-content:center;">
        <div style="font-size:10px;color:rgba(255,255,255,.85);font-weight:700;">\u{1F4C5} ${UC(o.scheduledDate?formatOrderDate(o.scheduledDate,'curta'):'\u2014')}</div>
        <div style="font-size:16px;font-weight:900;color:#FFD700;line-height:1.1;">${UC(turno||'\u2014')}</div>
        ${horario?`<div style="font-size:13px;font-weight:900;color:#fff;background:rgba(0,0,0,0.3);border-radius:4px;padding:2px 6px;margin-top:3px;">\u23f0 ${UC(horario)}</div>`:''}
        ${(_ehSite && siteEstimativaTxt)?`<div style="font-size:11px;font-weight:900;color:#fff;background:#065F46;border-radius:4px;padding:2px 5px;margin-top:3px;">\u23f1\ufe0f ${siteEstimativaTxt}</div>`:''}
      </div>
    </div>

    <!-- Retirada na loja (destaque) -->
    ${reentregaBlock}
    ${retiradaBlock}

    <!-- Endereco AMPLIADO (oculto se for retirada) -->
    ${isRetirada ? '' : '<div style="background:#f8f8f8;border-left:5px solid #1E5AA8;border-radius:0 8px 8px 0;padding:8px 12px;">' +
      '<div style="font-size:10px;color:#555;font-weight:700;letter-spacing:.5px;">\ud83d\udccd ENDERE\u00c7O</div>' +
      (rua?'<div style="font-size:16px;font-weight:800;color:#111;line-height:1.2;margin-top:2px;">'+UC(truncate(rua,60))+'</div>':'') +
      (bairro?'<div style="font-size:18px;font-weight:900;color:#1E5AA8;line-height:1.15;margin-top:2px;">'+UC(bairro)+' \u2014 '+UC(cidade)+'</div>':'') +
      (cond?'<div style="font-size:13px;font-weight:700;color:#333;line-height:1.2;margin-top:2px;">\ud83c\udfe2 '+UC(truncate(cond,55))+'</div>':'') +
      (ref?'<div style="font-size:11px;color:#555;line-height:1.2;margin-top:2px;">\ud83d\udccd REF: '+UC(truncate(ref,70))+'</div>':'') +
    '</div>'}

    <!-- Vendedora + Unidade (via Entregador) -->
    ${unidadeBlock}

    <!-- Horario Especifico -->
    ${expressBadge}${horarioEspecificoBadge}

    <!-- Observacoes do PDV (se houver) -->
    ${obsBlock}

    <!-- Cobranca -->
    ${cobrancaBlock}
    ${pickupBlock}

    <!-- Entregador + QR -->
    <div style="display:flex;align-items:center;justify-content:space-between;background:#f0f0f0;border-radius:6px;padding:6px 10px;border-top:1px dashed #aaa;">
      <div>
        <div style="font-size:9px;color:#555;font-weight:700;">ENTREGADOR RESPONSÁVEL</div>
        <div style="font-size:14px;font-weight:900;color:#111;line-height:1.1;">${UC(truncate(entregador,28))}</div>
      </div>
      <div style="text-align:center;">
        <img src="${qrSrc}" style="width:54px;height:54px;"/>
        <div style="font-size:7px;color:#555;text-transform:none;">QR = ENTREGUE ✅</div>
      </div>
    </div>

    <!-- Recebimento: nome / assinatura / data e hora -->
    <div style="margin-top:auto;padding-top:6px;border-top:1px dashed #aaa;">
      <div style="font-size:9px;color:#666;font-weight:700;letter-spacing:.5px;">NOME DE QUEM RECEBE</div>
      <div style="border-bottom:1.5px solid #333;height:18px;"></div>
      <div style="font-size:9px;color:#666;font-weight:700;letter-spacing:.5px;margin-top:6px;">ASSINATURA</div>
      <div style="border-bottom:1.5px solid #333;height:18px;"></div>
      <div style="font-size:9px;color:#666;font-weight:700;letter-spacing:.5px;margin-top:6px;">DATA E HORA DA ENTREGA</div>
      <div style="border-bottom:1.5px solid #333;height:18px;"></div>
    </div>
  </div>`;

  // ── HTML final ─────────────────────────────────────────────
  const htmlDoc = `<!DOCTYPE html>
<html><head><title>Comanda \u2014 ${orderNumFmt}</title>
<meta charset="utf-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;font-family:${cmdFonte},Arial,sans-serif;font-size:${cmdTam}px;text-transform:uppercase;}
  .page{width:210mm;margin:0 auto;background:${cmdBg};}
  /* AS DUAS VIAS EM 1 SO A4 — corta no meio:
     - Cima: arquivo CD (148mm)
     - Baixo: entregador (148mm)
     Marcia (09/jun/2026): min-height (nao height fixa) — comanda gigante
     cresce e impressora divide em 2 folhas, nao perde info. */
  .page{
    width:210mm;
    min-height:297mm;
    margin:0 auto;
    background:${cmdBg};
    page-break-after:auto;
  }
  /* Marcia (09/jun/2026): min-height (nao height fixa) + SEM overflow:hidden
     + SEM page-break-inside:avoid. Comanda padrao (cabe em 148mm) imprime
     2-em-1-A4 como sempre. Comanda gigante (mensagem longa, muitos itens)
     cresce naturalmente — impressora divide em 2 folhas, NAO corta info. */
  .comanda{
    width:210mm;
    min-height:148mm;       /* metade exata de A4 — cresce se conteudo passar */
    background:${cmdBg};
    box-sizing:border-box;
    position:relative;
  }
  .comanda.tipo-arquivo{
    border-bottom:2px dashed #888;
  }
  .cut-label{
    position:absolute;
    bottom:-9px;
    left:50%;
    transform:translateX(-50%);
    background:#fff;
    padding:0 14px;
    font-size:9px;
    color:#888;
    white-space:nowrap;
    font-family:Arial;
    letter-spacing:2px;
    z-index:5;
  }
  .btn-print{display:block;margin:16px auto;background:#8B2252;color:#fff;border:none;padding:12px 36px;border-radius:8px;font-size:15px;cursor:pointer;font-family:Arial;font-weight:bold;}
  @media print{
    body{background:#fff;margin:0;}
    .btn-print{display:none!important;}
    .page{width:100%;height:auto;margin:0;}
    .comanda{
      width:100%;
      min-height:50vh;       /* metade do A4 padrao — cresce se passar */
      box-shadow:none;
    }
    @page{size:A4 portrait;margin:0;}
  }
</style></head>
<body>
<button class="btn-print" onclick="window.print()">\u{1F5A8}\uFE0F Imprimir Comanda (A4)</button>
${(() => {
  // Marker pra extrair o style + body em modo batch (sem regex pesada)
  return '';
})()}<div class="page">
  <div class="comanda tipo-arquivo">
    ${viaCD}
    <div class="cut-label">✂ ─────── DESTACAR AQUI ─────── ✂</div>
  </div>
  <div class="comanda tipo-entregador">
    ${viaEntregador}
  </div>
</div>
</body></html>`;

  // Modo BATCH: retorna apenas o HTML de uma pagina (sem o wrapper completo)
  // pra que printComandasBatch combine multiplas paginas com page-break.
  if (opts.returnHtml) {
    const pageHtml = `<div class="page">
      <div class="comanda tipo-arquivo">
        ${viaCD}
        <div class="cut-label">✂ ─────── DESTACAR AQUI ─────── ✂</div>
      </div>
      <div class="comanda tipo-entregador">
        ${viaEntregador}
      </div>
    </div>`;
    return {
      htmlDoc,
      pageHtml,
      orderNumFmt,
      cmdFonte, cmdTam, cmdBg,
    };
  }

  // ── Overlay preview ─────────────────────────────────────────
  const overlay = document.createElement('div');
  // Remove overlays antigos pra evitar empilhamento
  document.querySelectorAll('[data-overlay-comanda]').forEach(el => el.remove());
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
  overlay.setAttribute('data-overlay-comanda','true');
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:16px;width:100%;max-width:960px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.4);margin:auto;';
  box.innerHTML = `
    <div style="padding:14px 20px;background:#8B2252;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10;">
      <span style="color:#fff;font-weight:bold;font-size:15px;">\u{1F9FE} Comanda \u2014 ${orderNumFmt} \u00b7 ${UC(o.recipient||'')}</span>
      <div style="display:flex;gap:8px;">
        <button id="btn-do-print" style="background:#fff;color:#8B2252;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">\u{1F5A8}\uFE0F IMPRIMIR A4</button>
        <button id="btn-close-overlay" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">\u2715</button>
      </div>
    </div>
    ${(() => {
      // BANNER: aviso se o pedido foi editado nas ultimas 24h.
      // _lastEditedAt eh setado no saveEditOrder de pedidos.js.
      if (!o._lastEditedAt) return '';
      const editTime = new Date(o._lastEditedAt).getTime();
      const ageMin = Math.round((Date.now() - editTime) / 60000);
      if (ageMin >= 24*60) return '';
      const ageLabel = ageMin < 1 ? 'agora' :
                       ageMin < 60 ? ageMin + ' min atras' :
                       Math.round(ageMin/60) + 'h atras';
      return `<div style="background:#FEF3C7;border:2px solid #F59E0B;border-radius:8px;padding:10px 14px;margin:12px 16px 0;display:flex;align-items:center;gap:10px;">
        <span style="font-size:20px;">⚠️</span>
        <div style="flex:1;font-size:12px;color:#78350F;font-weight:600;">
          Pedido <strong>editado ${ageLabel}</strong>. A comanda gerada já reflete os novos dados. <strong>Reimprima</strong> e descarte a versão antiga.
        </div>
      </div>`;
    })()}
    <div id="comanda-iframe-wrap" style="padding:16px;background:#f5f5f5;min-height:200px;">
      <div id="comanda-loading" style="padding:40px;text-align:center;color:#666;font-size:13px;">⏳ Gerando comanda...</div>
      <iframe id="comanda-iframe" style="display:none;width:100%;height:700px;border:none;border-radius:8px;background:#fff;"></iframe>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Escreve no iframe COM tratamento de erro: se falhar (causa raiz da
  // 'tela em branco' no dashboard), renderiza inline em vez de deixar
  // o usuario olhando pra um overlay preto vazio.
  const _writeIframe = () => {
    try {
      const iframe = document.getElementById('comanda-iframe');
      const loader = document.getElementById('comanda-loading');
      if (!iframe) return false;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) throw new Error('iframe contentDocument indisponivel');
      doc.open(); doc.write(htmlDoc); doc.close();
      iframe.style.display = 'block';
      if (loader) loader.style.display = 'none';
      return true;
    } catch (err) {
      console.error('[printComanda] iframe falhou, fallback inline:', err);
      const wrap = document.getElementById('comanda-iframe-wrap');
      if (wrap) {
        const m = htmlDoc.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyHtml = m ? m[1] : htmlDoc;
        wrap.innerHTML = `
          <div style="padding:10px 14px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;margin-bottom:12px;color:#78350F;font-size:11px;">
            ⚠️ Preview no iframe falhou. Renderizando comanda diretamente. Erro: ${err.message||'desconhecido'}
          </div>
          <div style="background:#fff;border-radius:8px;overflow:auto;max-height:75vh;">${bodyHtml}</div>`;
      }
      return false;
    }
  };
  setTimeout(() => { if (!_writeIframe()) setTimeout(_writeIframe, 250); }, 30);

  const escHandler = (e) => { if (e.key === 'Escape') closeOverlay(); };
  const closeOverlay = () => { overlay.remove(); document.removeEventListener('keydown', escHandler); };
  document.addEventListener('keydown', escHandler);

  document.getElementById('btn-do-print')?.addEventListener('click',()=>{
    try {
      const iframe = document.getElementById('comanda-iframe');
      if (iframe && iframe.contentWindow && iframe.style.display !== 'none') {
        iframe.contentWindow.print();
      } else {
        // Fallback: abre janela nova com htmlDoc
        const w = window.open('', '_blank', 'width=900,height=700');
        if (w) { w.document.write(htmlDoc); w.document.close(); setTimeout(() => w.print(), 300); }
      }
      S._printedComanda={...(S._printedComanda||{}),[orderId]:true};
      localStorage.setItem('fv_printed_comanda',JSON.stringify(S._printedComanda));
      render();
    } catch (err) {
      console.error('[printComanda] erro imprimir:', err);
      try { if (typeof toast === 'function') toast('❌ Erro ao imprimir: '+(err.message||''), true); } catch(_){}
    }
  });
  document.getElementById('btn-close-overlay')?.addEventListener('click', closeOverlay);
  overlay.addEventListener('click',e=>{ if(e.target===overlay) closeOverlay(); });

  S._printedComanda={...(S._printedComanda||{}),[orderId]:true};
  localStorage.setItem('fv_printed_comanda',JSON.stringify(S._printedComanda));
  render();
}

// ── PRINT LABEL (Etiqueta) ─────────────────────────────────────
export function printLabel(orderId){
  const o = S.orders.find(x=>x._id===orderId);
  if(!o) { toast('❌ Pedido não encontrado', true); return; }
  const cfg    = JSON.parse(localStorage.getItem('fv_config')||'{}');
  const layout = JSON.parse(localStorage.getItem('fv_print_layout')||'{}');

  const eCor    = layout.labelCor     || '#1E5AA8';
  const eBg     = layout.labelBg      || '#FFFFFF';
  const eFonte  = layout.labelFonte   || 'Arial';
  const eTam    = layout.labelTamanho || '18';
  const eLargura= layout.labelLargura || '100';
  const eAltura = layout.labelAltura  || '50';
  const eTexto  = layout.labelTexto   || 'Laços Eternos Floricultura\n{recipient}\n{bairro}';
  const empresa = layout.nomeEmpresa || cfg.razao || 'Laços Eternos Floricultura';
  const whats   = layout.whatsapp    || cfg.whats || '';

  const textoRender = applyLabelVars(eTexto, o, empresa, whats);

  const htmlDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Etiqueta — ${o.orderNumber||''}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;padding:20px;font-family:${eFonte},sans-serif;}
  .label{
    width:${eLargura}mm;height:${eAltura}mm;
    border:2px solid ${eCor};background:${eBg};
    font-size:${eTam}px;padding:8mm;
    display:flex;flex-direction:column;justify-content:center;align-items:center;gap:6px;
    margin:0 auto;box-sizing:border-box;overflow:hidden;
  }
  .label img{max-height:${Math.min(parseInt(eAltura)/3, 20)}mm;object-fit:contain;}
  .label .txt{white-space:pre-wrap;text-align:center;line-height:1.3;width:100%;}
  .btn-print{display:block;margin:16px auto;background:${eCor};color:#fff;border:none;padding:10px 30px;border-radius:8px;font-size:14px;cursor:pointer;font-weight:bold;}
  @media print {
    body{background:#fff;padding:0;margin:0;}
    .btn-print{display:none!important;}
    .label{border:none;page-break-inside:avoid;}
    @page{size:${eLargura}mm ${eAltura}mm;margin:0;}
  }
</style></head>
<body>
  <button class="btn-print" onclick="window.print()">🖨️ Imprimir Etiqueta</button>
  <div class="label">
    ${layout.labelLogoBase64?`<img src="${layout.labelLogoBase64}"/>`:''}
    <div class="txt">${textoRender.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
  </div>
</body></html>`;

  // Overlay preview com iframe
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.setAttribute('data-overlay','true');
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:720px;overflow:hidden;">
      <div style="padding:12px 18px;background:${eCor};display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#fff;font-weight:bold;">🏷️ Etiqueta — ${o.orderNumber||''}</span>
        <div style="display:flex;gap:8px;">
          <button id="btn-do-print-label" style="background:#fff;color:${eCor};border:none;padding:8px 18px;border-radius:8px;font-weight:bold;cursor:pointer;">🖨️ IMPRIMIR</button>
          <button id="btn-close-label" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">✕</button>
        </div>
      </div>
      <div style="padding:20px;background:#f5f5f5;">
        <iframe id="label-iframe" style="width:100%;height:400px;border:none;border-radius:8px;background:#fff;"></iframe>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if(e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  setTimeout(() => {
    const iframe = document.getElementById('label-iframe');
    if (iframe) { iframe.contentDocument.open(); iframe.contentDocument.write(htmlDoc); iframe.contentDocument.close(); }
  }, 50);

  document.getElementById('btn-do-print-label')?.addEventListener('click', () => {
    document.getElementById('label-iframe')?.contentWindow?.print();
  });
  document.getElementById('btn-close-label')?.addEventListener('click', () => overlay.remove());
}

// ── SEND DELIVERY NOTIFICATION ──────────────────────────────────
export function sendDeliveryNotification(order, opts){
  // Importa dinamicamente para evitar dependencia circular
  import('./whatsapp.js').then(mod => {
    if(typeof mod.sendWhatsAppDeliveryConfirm === 'function') mod.sendWhatsAppDeliveryConfirm(order, opts);
  });
}

