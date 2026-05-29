// ── MODULO CARTÕES ───────────────────────────────────────────
// Gerencia geracao e impressao de cartoes personalizados (mensagens
// que acompanham os arranjos). Layout fixo: 2 colunas x 8 linhas =
// 16 cartoes por folha A4. Cada cartao: 94mm x 32mm (paisagem).
//
// Padrao similar ao modulo Etiquetas (etiquetas.js):
//   - Constantes no topo (templates, dimensoes)
//   - Funcoes helpers (_render, _save, _get)
//   - Render principal com tabs
//   - Bind events ao final
//
// Pedido pela Marcia em 29/mai/2026.

import { S } from '../state.js';
import { toast } from '../utils/helpers.js';

// ── DIMENSOES DO LAYOUT A4 ───────────────────────────────────
// A4 util = 190x277mm (margem 10mm cada lado). Gap = 2mm entre cards.
// 2 cols: (190 - 1*2) / 2 = 94mm ; 8 rows: (277 - 7*2) / 8 ≈ 32mm
export const CARTAO_W_MM    = 94;
export const CARTAO_H_MM    = 32;
export const CARTAO_COLS    = 2;
export const CARTAO_ROWS    = 8;
export const CARTAO_GAP_MM  = 2;
export const CARTAO_POR_FOLHA = CARTAO_COLS * CARTAO_ROWS; // 16

// Instagram default (pode ser sobrescrito por cfg/ec se existir)
const INSTAGRAM_DEFAULT = '@floriculturalacoseternos';

// ── TEMPLATES DE CARTAO ──────────────────────────────────────
export const CARTAO_TEMPLATES = [
  { id:'classico',     nome:'Clássico',        desc:'Logo + gradient rosa + mensagem central',  emoji:'🌹' },
  { id:'minimalista',  nome:'Minimalista',     desc:'Rosa simples + mensagem limpa',            emoji:'✨' },
  { id:'floral',       nome:'Floral Premium',  desc:'Decoracao floral + tipografia elegante',  emoji:'✿' },
  { id:'verso',        nome:'Verso (sem msg)', desc:'So branding — pra imprimir no verso',     emoji:'🔄' },
];

// ── LOCAL STORAGE: padrao + historico ────────────────────────
const LS_TEMPLATE_KEY = 'fv_cartoes_template_padrao';
const LS_HIST_KEY     = 'fv_cartoes_hist';

function _getTemplatePadrao() {
  try {
    const v = localStorage.getItem(LS_TEMPLATE_KEY);
    if (v && CARTAO_TEMPLATES.find(t => t.id === v)) return v;
  } catch(_){}
  return 'classico';
}
function _saveTemplatePadrao(id) {
  try { localStorage.setItem(LS_TEMPLATE_KEY, id); } catch(_){}
}
function _getHistorico() {
  try { return JSON.parse(localStorage.getItem(LS_HIST_KEY) || '[]'); }
  catch { return []; }
}
function _saveHistorico(arr) {
  try { localStorage.setItem(LS_HIST_KEY, JSON.stringify(arr.slice(0, 50))); } catch(_){}
}
function _addHistorico(entry) {
  const hist = _getHistorico();
  hist.unshift({
    ...entry,
    id: Date.now()+'_'+Math.random().toString(36).slice(2,6),
    criadoEm: new Date().toISOString(),
    usuario: (S.user?.name || S.user?.email || '—'),
  });
  _saveHistorico(hist);
}

// ── HELPERS DE LOGO + INSTAGRAM ──────────────────────────────
// Le do localStorage (fv_config) onde modulos como recibos.js tambem leem.
export function _getBranding() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('fv_config') || '{}'); } catch(_){}
  let ec = {};
  try { ec = JSON.parse(localStorage.getItem('fv_ecommerce_config') || '{}'); } catch(_){}
  const logo = ec.siteLogo || cfg.siteLogo || cfg.loginLogo || cfg.logo || '';
  const insta = (ec.social && ec.social.instagram) || INSTAGRAM_DEFAULT;
  return { logo, instagram: insta };
}

// ── RENDER DE UM CARTAO ──────────────────────────────────────
// Renderiza UM cartao em 94x32mm segundo o template.
// 'msg' = mensagem do cartao. 'opts.semBorda' = sem borda guia (para print final).
export function renderUmCartao(msg, templateId, opts = {}) {
  const { logo, instagram } = _getBranding();
  const tmpl = CARTAO_TEMPLATES.find(t => t.id === templateId) || CARTAO_TEMPLATES[0];
  const mensagem = String(msg || '').slice(0, 200);
  const borda = opts.semBorda
    ? 'border:none;'
    : 'border:0.2mm dashed #CBD5E1;'; // guia de corte que SUMA no print via @media
  const baseStyle = `
    width:${CARTAO_W_MM}mm;height:${CARTAO_H_MM}mm;box-sizing:border-box;
    page-break-inside:avoid;overflow:hidden;background:#fff;
    font-family:'Inter','Helvetica Neue',Arial,sans-serif;${borda}`;

  const logoImg = logo
    ? `<img src="${logo}" alt="logo" style="height:7mm;max-width:18mm;object-fit:contain;"/>`
    : `<span style="font-size:14pt;">🌹</span>`;

  // ── CLASSICO ──
  if (tmpl.id === 'classico') {
    return `
      <div style="${baseStyle}display:flex;flex-direction:column;">
        <!-- HEADER com gradient rosa -->
        <div style="background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;
                    padding:1.5mm 3mm;display:flex;align-items:center;gap:2mm;height:8mm;flex:0 0 auto;">
          <div style="background:#fff;border-radius:50%;width:6mm;height:6mm;display:flex;
                      align-items:center;justify-content:center;overflow:hidden;flex:0 0 auto;">
            ${logoImg.replace('height:7mm','height:5mm').replace('max-width:18mm','max-width:5mm')}
          </div>
          <div style="font-family:'Playfair Display','Times New Roman',serif;line-height:1.1;">
            <div style="font-size:8pt;font-weight:700;letter-spacing:.3pt;">Floricultura</div>
            <div style="font-size:6pt;font-style:italic;opacity:.92;">Laços Eternos</div>
          </div>
        </div>
        <!-- MENSAGEM central -->
        <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:1.5mm 3mm;">
          <div style="font-family:'Cormorant Garamond','Playfair Display',Georgia,serif;
                      font-style:italic;font-size:9.5pt;line-height:1.25;color:#2D1A20;text-align:center;
                      overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;">
            ${mensagem ? '"'+_escapeHtml(mensagem)+'"' : '<span style="color:#CBD5E1;">(mensagem)</span>'}
          </div>
        </div>
        <!-- FOOTER instagram -->
        <div style="background:#FAE8E6;color:#9F1239;padding:1mm 3mm;text-align:center;
                    font-size:6.5pt;font-weight:600;letter-spacing:.3pt;flex:0 0 auto;">
          ${_escapeHtml(instagram)}
        </div>
      </div>`;
  }

  // ── MINIMALISTA ──
  if (tmpl.id === 'minimalista') {
    return `
      <div style="${baseStyle}padding:3mm 4mm;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="text-align:center;font-size:11pt;color:#9F1239;line-height:1;">🌹</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:1mm 0;">
          <div style="font-family:'Cormorant Garamond','Playfair Display',Georgia,serif;
                      font-style:italic;font-size:10pt;line-height:1.3;color:#2D1A20;text-align:center;
                      overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">
            ${mensagem ? _escapeHtml(mensagem) : '<span style="color:#CBD5E1;">(mensagem)</span>'}
          </div>
        </div>
        <div style="text-align:center;font-size:6.5pt;color:#9F1239;font-weight:600;letter-spacing:.4pt;">
          ${_escapeHtml(instagram)}
        </div>
      </div>`;
  }

  // ── FLORAL PREMIUM ──
  if (tmpl.id === 'floral') {
    return `
      <div style="${baseStyle}padding:2mm 3mm;display:flex;flex-direction:column;justify-content:space-between;
                  background:linear-gradient(135deg,#FFFFFF 0%,#FFF9F7 100%);">
        <div style="display:flex;align-items:center;justify-content:center;gap:1.5mm;text-align:center;">
          <span style="color:#C8736A;font-size:8pt;">✿</span>
          <div style="font-family:'Playfair Display','Times New Roman',serif;line-height:1.1;">
            <div style="font-size:8pt;font-weight:700;color:#9F1239;letter-spacing:.3pt;">Floricultura Laços Eternos</div>
          </div>
          <span style="color:#C8736A;font-size:8pt;">✿</span>
        </div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:.5mm 0;">
          <div style="font-family:'Cormorant Garamond','Playfair Display',Georgia,serif;
                      font-style:italic;font-size:9.5pt;line-height:1.25;color:#2D1A20;text-align:center;
                      overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">
            ${mensagem ? _escapeHtml(mensagem) : '<span style="color:#CBD5E1;">(mensagem)</span>'}
          </div>
        </div>
        <div style="text-align:center;font-size:6.5pt;color:#9F1239;font-weight:600;letter-spacing:.3pt;
                    border-top:0.2mm solid #FAE8E6;padding-top:.8mm;">
          ${_escapeHtml(instagram)}
        </div>
      </div>`;
  }

  // ── VERSO (so branding) ──
  if (tmpl.id === 'verso') {
    return `
      <div style="${baseStyle}padding:3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.5mm;
                  background:linear-gradient(135deg,#FFF9F7,#FAE8E6);">
        <div style="display:flex;align-items:center;gap:2mm;">
          ${logoImg}
          <div style="font-family:'Playfair Display','Times New Roman',serif;line-height:1.1;color:#9F1239;">
            <div style="font-size:10pt;font-weight:700;letter-spacing:.3pt;">Floricultura</div>
            <div style="font-size:7.5pt;font-style:italic;">Laços Eternos</div>
          </div>
        </div>
        <div style="font-size:7pt;color:#9F1239;font-weight:600;letter-spacing:.4pt;">
          ${_escapeHtml(instagram)}
        </div>
      </div>`;
  }

  return '';
}

function _escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────
export function renderCartoes() {
  const tab = S._cartTab || 'imprimir';
  if (!S._cartTemplate || !CARTAO_TEMPLATES.find(t => t.id === S._cartTemplate)) {
    S._cartTemplate = _getTemplatePadrao();
  }
  if (typeof S._cartMsg !== 'string') S._cartMsg = '';
  if (typeof S._cartQty !== 'number') S._cartQty = 2;
  if (!Array.isArray(S._cartFila)) S._cartFila = []; // [{msg, templateId}]
  if (!Array.isArray(S._cartPedFila)) S._cartPedFila = []; // ids de pedidos

  const tabBtn = (k, label, icon) => `
    <button data-cart-tab="${k}" class="tab ${tab===k?'active':''}" style="padding:10px 18px;font-size:13px;">${icon} ${label}</button>
  `;

  return `
<div style="max-width:1100px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:20px;">
    <h1 style="font-family:'Playfair Display',serif;font-size:28px;color:#1E293B;margin:0 0 4px;">💌 Cartões Personalizados</h1>
    <p style="font-size:13px;color:var(--muted);margin:0;">Imprima cartões com mensagem em folha A4 (16 por folha — 94×32mm cada)</p>
  </div>

  <div style="display:flex;gap:8px;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:12px;padding:6px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);flex-wrap:wrap;">
    ${tabBtn('imprimir',  'Imprimir',        '✏️')}
    ${tabBtn('pedidos',   'Por Pedido',      '📋')}
    ${tabBtn('templates', 'Templates',       '🎨')}
    ${tabBtn('historico', 'Histórico',       '📊')}
  </div>

  ${tab === 'imprimir'  ? renderTabImprimir() : ''}
  ${tab === 'pedidos'   ? renderTabPedidos()  : ''}
  ${tab === 'templates' ? renderTabTemplates() : ''}
  ${tab === 'historico' ? renderTabHistorico() : ''}
</div>
`;
}

// ── ABA 1: IMPRIMIR ──────────────────────────────────────────
function renderTabImprimir() {
  const msg = S._cartMsg;
  const qty = Math.max(2, Math.min(16, Number(S._cartQty)||2));
  const templateId = S._cartTemplate;
  const fila = S._cartFila;
  const previewHtml = renderUmCartao(msg || 'Sua mensagem aparece aqui...', templateId);

  return `
<div style="display:grid;grid-template-columns:1fr 360px;gap:18px;">
  <!-- COL ESQ -->
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        ✏️ Mensagem do Cartão
      </div>
      <textarea id="cart-msg" maxlength="200" rows="3" placeholder="Ex: Feliz aniversário! Que esse novo ciclo seja repleto de amor e flores 🌸"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:8px;
               font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:14px;resize:vertical;line-height:1.4;">${_escapeHtml(msg)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:11px;color:var(--muted);">
        <span>Use linhas curtas pro cartão ficar bonito (máx 200 caracteres)</span>
        <span><strong id="cart-msg-count">${msg.length}</strong>/200</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;">🎨 Escolha o Template</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
        ${CARTAO_TEMPLATES.map(t => {
          const sel = t.id === templateId;
          return `<button type="button" data-cart-template="${t.id}"
            style="background:${sel?'linear-gradient(135deg,#9F1239,#C8736A)':'#fff'};color:${sel?'#fff':'#1E293B'};
                   border:2px solid ${sel?'#9F1239':'#E5E7EB'};border-radius:10px;padding:10px 12px;
                   cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;">
            <div style="font-weight:700;font-size:13px;line-height:1.2;margin-bottom:2px;">${t.emoji} ${t.nome}</div>
            <div style="font-size:10px;opacity:.85;line-height:1.3;">${t.desc}</div>
          </button>`;
        }).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;">🔢 Quantidade de cópias deste cartão</div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <input type="number" id="cart-qty" min="2" max="16" value="${qty}"
          style="width:90px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:18px;font-weight:700;text-align:center;"/>
        <div style="font-size:12px;color:var(--muted);">
          (mínimo 2 — máximo 16 por folha A4)<br/>
          ${qty < 16 ? `Restante na folha: <strong>${16-qty}</strong> espaço(s)` : '<strong style="color:#9F1239;">Folha cheia ✓</strong>'}
        </div>
      </div>

      ${fila.length > 0 ? `
      <div style="margin-top:12px;background:#FAE8E6;border:1px dashed #FECDD3;border-radius:8px;padding:10px;">
        <div style="font-size:11px;font-weight:700;color:#9F1239;margin-bottom:6px;">
          📋 Fila de cartões com mensagens diferentes (${fila.reduce((s,f)=>s+f.qty,0)}/16)
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${fila.map((f, i) => `
            <div style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:6px;padding:6px 8px;font-size:11px;">
              <span style="background:#9F1239;color:#fff;border-radius:8px;padding:1px 6px;font-weight:700;">${f.qty}×</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic;color:#475569;">"${_escapeHtml(f.msg).slice(0,60)}${f.msg.length>60?'...':''}"</span>
              <span style="font-size:9px;color:var(--muted);">${(CARTAO_TEMPLATES.find(t=>t.id===f.templateId)||{}).nome||'—'}</span>
              <button data-cart-fila-del="${i}" style="background:#FEE2E2;color:#991B1B;border:none;width:22px;height:22px;border-radius:5px;cursor:pointer;font-size:11px;">🗑️</button>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" id="btn-cart-add-fila"
          style="flex:1;min-width:200px;background:#fff;color:#9F1239;border:2px dashed #9F1239;padding:12px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">
          ➕ Adicionar à fila (msg diferente)
        </button>
        <button type="button" id="btn-cart-imprimir"
          style="flex:2;min-width:200px;background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;border:none;padding:14px;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.5px;">
          🖨️ Imprimir ${fila.length>0 ? fila.reduce((s,f)=>s+f.qty,0)+' cartões da fila' : qty+' cópias'}
        </button>
      </div>
      <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px;line-height:1.5;">
        ${fila.length===0
          ? 'Vai imprimir <strong>'+qty+'</strong> cópias do mesmo cartão em uma folha A4.'
          : 'Imprime os cartões da fila + (se houver espaço) cópias do cartão atual.'}
      </div>
    </div>
  </div>

  <!-- COL DIREITA: preview -->
  <div>
    <div class="card" style="position:sticky;top:20px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span>👁️ Preview</span>
        <span style="background:#F1F5F9;color:#475569;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:600;">${CARTAO_W_MM}×${CARTAO_H_MM}mm</span>
      </div>
      <div style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:10px;padding:18px;display:flex;justify-content:center;align-items:center;min-height:160px;overflow:hidden;">
        ${(() => {
          // Zoom para preencher ~300px de preview (94mm ~ 355px @96dpi → escala 0.85)
          const targetWidth = 300;
          const naturalPx = CARTAO_W_MM * 3.78;
          const zoom = Math.min(1.2, Math.max(0.6, targetWidth / naturalPx));
          return `<div style="transform:scale(${zoom.toFixed(2)});transform-origin:center;display:inline-block;">${previewHtml}</div>`;
        })()}
      </div>
      <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:#78350F;line-height:1.5;">
        💡 <strong>Dica:</strong> Use folha A4 180g+ (papel mais grosso) para os cartões ficarem mais firmes. Borda pontilhada some no print — corte com tesoura ou guilhotina.
      </div>
    </div>
  </div>
</div>
`;
}

// ── ABA 2: POR PEDIDO ────────────────────────────────────────
function renderTabPedidos() {
  const fila = S._cartPedFila || [];
  const hoje = new Date().toISOString().slice(0,10);
  const dataFiltro = S._cartPedData || hoje;
  // Pega pedidos do dia (data de entrega) que tenham cardMessage
  const pedidos = (S.orders || []).filter(o => {
    const d = String(o.scheduledDate||'').slice(0,10);
    return d === dataFiltro && o.cardMessage && String(o.cardMessage).trim();
  });
  const totalFila = fila.length;

  return `
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
    <div style="font-weight:700;">📋 Pedidos com cartão da data</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <label style="font-size:12px;color:var(--muted);">Entrega em:</label>
      <input type="date" id="cart-ped-data" value="${dataFiltro}" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;"/>
      <span style="background:#FAE8E6;color:#9F1239;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;">${pedidos.length} pedido(s)</span>
    </div>
  </div>

  ${pedidos.length === 0 ? `
  <div style="text-align:center;padding:40px 20px;color:var(--muted);">
    <div style="font-size:48px;margin-bottom:10px;">📭</div>
    <p style="font-size:13px;font-weight:600;">Nenhum pedido com mensagem de cartão para esta data.</p>
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:6px;max-height:480px;overflow-y:auto;">
    ${pedidos.map(o => {
      const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
      const cli = o.clientName || o.client?.name || '—';
      const naFila = fila.includes(String(o._id));
      const preview = String(o.cardMessage||'').slice(0,80);
      return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid ${naFila?'#15803D':'var(--border)'};border-radius:8px;${naFila?'background:#F0FDF4;':''}">
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;color:#7C3AED;font-weight:700;font-family:Monaco,monospace;">#${num} · ${cli}</div>
          <div style="font-size:12px;color:#475569;font-style:italic;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">"${_escapeHtml(preview)}${o.cardMessage.length>80?'...':''}"</div>
        </div>
        <button data-cart-ped-toggle="${o._id}"
          style="background:${naFila?'#15803D':'#9F1239'};color:#fff;border:none;padding:7px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
          ${naFila ? '✓ Na fila' : '+ Adicionar'}
        </button>
      </div>`;
    }).join('')}
  </div>`}
</div>

${totalFila > 0 ? `
<div class="card" style="background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-weight:700;color:#9F1239;">🎯 Fila de impressão: ${totalFila}/16 cartões</div>
      <div style="font-size:11px;color:var(--muted);">Vai gerar ${Math.ceil(totalFila/16)} folha(s) A4 — template padrão: <strong>${(CARTAO_TEMPLATES.find(t=>t.id===_getTemplatePadrao())||{}).nome||'Clássico'}</strong></div>
    </div>
    <div style="display:flex;gap:8px;">
      <button id="btn-cart-ped-clear" style="background:#FEE2E2;color:#991B1B;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">✕ Limpar</button>
      <button id="btn-cart-ped-print" style="background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">🖨️ Imprimir folha (${totalFila}/16)</button>
    </div>
  </div>
</div>` : ''}
`;
}

// ── ABA 3: TEMPLATES ─────────────────────────────────────────
function renderTabTemplates() {
  const padrao = _getTemplatePadrao();
  const exemploMsg = 'Feliz aniversário! Que esse novo ciclo seja repleto de amor e flores 🌸';
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
    🎨 Templates Disponíveis
    <span style="font-size:11px;color:var(--muted);font-weight:400;">— escolha o padrão usado em impressões automáticas</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;">
    ${CARTAO_TEMPLATES.map(t => {
      const ehPadrao = t.id === padrao;
      const preview = renderUmCartao(exemploMsg, t.id);
      const previewZoom = Math.min(1.0, 320 / (CARTAO_W_MM * 3.78));
      return `
      <div style="background:#fff;border:2px solid ${ehPadrao?'#9F1239':'var(--border)'};border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;color:#1E293B;font-size:14px;">${t.emoji} ${t.nome}</div>
            <div style="font-size:11px;color:var(--muted);">${t.desc}</div>
          </div>
          ${ehPadrao ? '<span style="background:#15803D;color:#fff;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;">⭐ PADRÃO</span>' : ''}
        </div>
        <div style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:8px;padding:14px;display:flex;justify-content:center;align-items:center;min-height:140px;overflow:hidden;">
          <div style="transform:scale(${previewZoom.toFixed(2)});transform-origin:center;display:inline-block;">${preview}</div>
        </div>
        ${!ehPadrao ? `<button data-cart-set-padrao="${t.id}" style="background:#fff;color:#9F1239;border:1.5px solid #9F1239;padding:8px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">⭐ Definir como padrão</button>` : ''}
      </div>`;
    }).join('')}
  </div>
  <div style="background:#EFF6FF;border:1px solid #3B82F6;border-radius:8px;padding:12px;margin-top:14px;font-size:12px;color:#1E3A8A;line-height:1.5;">
    💡 <strong>Padrão:</strong> usado nas impressões em massa (datas comemorativas e pedidos do dia).
    Na aba "Imprimir" você pode escolher um template diferente por cartão.
  </div>
</div>
`;
}

// ── ABA 4: HISTORICO ─────────────────────────────────────────
function renderTabHistorico() {
  const hist = _getHistorico();
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
    <span>📊 Histórico de Impressões</span>
    ${hist.length > 0 ? `<button id="btn-cart-clear-hist" style="background:#FEE2E2;color:#991B1B;border:none;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">🗑️ Limpar histórico</button>` : ''}
  </div>
  ${hist.length === 0 ? `
  <div style="text-align:center;padding:40px 20px;color:var(--muted);">
    <div style="font-size:48px;margin-bottom:10px;">📭</div>
    <p style="font-size:13px;font-weight:600;">Nenhuma impressão ainda</p>
    <p style="font-size:11px;margin-top:4px;">Aqui aparecerão suas últimas impressões de cartões.</p>
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:8px;">
    ${hist.map(h => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff;border:1px solid var(--border);border-radius:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;color:#1E293B;">${_escapeHtml(h.origem||'Manual')} · ${(CARTAO_TEMPLATES.find(t=>t.id===h.templateId)||{}).nome||h.templateId||'—'}</div>
        <div style="font-size:11px;color:var(--muted);">${h.totalCartoes||0} cartão(ões) · ${h.folhas||1} folha(s) A4 · por ${_escapeHtml(h.usuario||'—')}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);text-align:right;">${new Date(h.criadoEm).toLocaleString('pt-BR')}</div>
    </div>`).join('')}
  </div>`}
</div>
`;
}

// ── BIND EVENTS ──────────────────────────────────────────────
export function bindCartoesEvents() {
  const render = () => import('../main.js').then(m => m.render?.());

  document.querySelectorAll('[data-cart-tab]').forEach(b => {
    b.onclick = () => { S._cartTab = b.dataset.cartTab; render(); };
  });

  // ── ABA IMPRIMIR ──
  const msgEl = document.getElementById('cart-msg');
  if (msgEl) {
    msgEl.addEventListener('input', e => {
      S._cartMsg = e.target.value.slice(0, 200);
      const c = document.getElementById('cart-msg-count');
      if (c) c.textContent = S._cartMsg.length;
    });
  }
  document.querySelectorAll('[data-cart-template]').forEach(b => {
    b.onclick = () => { S._cartTemplate = b.dataset.cartTemplate; render(); };
  });
  const qtyEl = document.getElementById('cart-qty');
  if (qtyEl) {
    qtyEl.addEventListener('input', e => {
      S._cartQty = Math.max(2, Math.min(16, parseInt(e.target.value)||2));
      render();
    });
  }
  document.getElementById('btn-cart-add-fila')?.addEventListener('click', () => {
    const msg = (S._cartMsg||'').trim();
    if (!msg) return toast('❌ Digite a mensagem antes de adicionar à fila', true);
    const qty = Math.max(1, Math.min(16, Number(S._cartQty)||1));
    const total = S._cartFila.reduce((s,f)=>s+f.qty,0) + qty;
    if (total > 16) return toast(`❌ Fila excede 16 (atual: ${total}). Reduza a quantidade.`, true);
    S._cartFila.push({ msg, qty, templateId: S._cartTemplate });
    S._cartMsg = ''; // limpa para proxima
    toast(`✅ Adicionado à fila (${total}/16)`);
    render();
  });
  document.querySelectorAll('[data-cart-fila-del]').forEach(b => {
    b.onclick = () => {
      const i = parseInt(b.dataset.cartFilaDel);
      S._cartFila.splice(i, 1);
      render();
    };
  });
  document.getElementById('btn-cart-imprimir')?.addEventListener('click', () => {
    const fila = S._cartFila;
    const lista = [];
    if (fila.length > 0) {
      fila.forEach(f => {
        for (let i=0;i<f.qty;i++) lista.push({ msg:f.msg, templateId:f.templateId });
      });
      // Se ainda houver espaco e tiver msg atual, completa
      const msg = (S._cartMsg||'').trim();
      const espacoFolha = 16 - (lista.length % 16 || 16);
      if (msg && espacoFolha < 16) {
        const add = Math.min(espacoFolha, S._cartQty);
        for (let i=0;i<add;i++) lista.push({ msg, templateId: S._cartTemplate });
      }
    } else {
      const msg = (S._cartMsg||'').trim();
      if (!msg) return toast('❌ Digite uma mensagem antes de imprimir', true);
      const qty = Math.max(2, Math.min(16, Number(S._cartQty)||2));
      for (let i=0;i<qty;i++) lista.push({ msg, templateId: S._cartTemplate });
    }
    if (lista.length === 0) return toast('❌ Nada para imprimir', true);
    imprimirCartoes(lista, { origem: fila.length > 0 ? 'Fila manual' : 'Manual' });
    // Limpa fila apos imprimir
    S._cartFila = [];
    render();
  });

  // ── ABA PEDIDOS ──
  document.getElementById('cart-ped-data')?.addEventListener('change', e => {
    S._cartPedData = e.target.value;
    render();
  });
  document.querySelectorAll('[data-cart-ped-toggle]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.cartPedToggle;
      const idx = S._cartPedFila.indexOf(id);
      if (idx >= 0) S._cartPedFila.splice(idx, 1);
      else {
        if (S._cartPedFila.length >= 16) return toast('❌ Limite de 16 cartões por folha atingido', true);
        S._cartPedFila.push(id);
      }
      render();
    };
  });
  document.getElementById('btn-cart-ped-clear')?.addEventListener('click', () => {
    S._cartPedFila = [];
    render();
  });
  document.getElementById('btn-cart-ped-print')?.addEventListener('click', () => {
    const ids = S._cartPedFila || [];
    const lista = ids.map(id => {
      const o = (S.orders||[]).find(x => String(x._id) === String(id));
      if (!o) return null;
      return { msg: o.cardMessage || '', templateId: _getTemplatePadrao(), pedido: (o.orderNumber||o.numero||'') };
    }).filter(Boolean);
    if (!lista.length) return toast('❌ Nenhum pedido na fila', true);
    imprimirCartoes(lista, { origem: 'Pedidos do dia' });
    S._cartPedFila = [];
    render();
  });

  // ── ABA TEMPLATES ──
  document.querySelectorAll('[data-cart-set-padrao]').forEach(b => {
    b.onclick = () => {
      _saveTemplatePadrao(b.dataset.cartSetPadrao);
      toast('✅ Template padrão atualizado');
      render();
    };
  });

  // ── ABA HISTORICO ──
  document.getElementById('btn-cart-clear-hist')?.addEventListener('click', () => {
    if (!confirm('Limpar todo o histórico de impressões de cartões?')) return;
    _saveHistorico([]);
    render();
  });
}

// ── IMPRESSAO ────────────────────────────────────────────────
// 'lista' = array de {msg, templateId, pedido?}
// Gera N folhas A4 (16 cartoes por folha) e abre window.print()
export function imprimirCartoes(lista, opts = {}) {
  if (!Array.isArray(lista) || lista.length === 0) {
    return toast('❌ Nada para imprimir', true);
  }
  const total = lista.length;
  const folhas = Math.ceil(total / CARTAO_POR_FOLHA);

  // Monta folhas (HTML)
  const folhasHtml = [];
  for (let f = 0; f < folhas; f++) {
    const ini = f * CARTAO_POR_FOLHA;
    const fim = Math.min(ini + CARTAO_POR_FOLHA, total);
    const lote = lista.slice(ini, fim);
    const cellsHtml = lote.map(c => renderUmCartao(c.msg, c.templateId || _getTemplatePadrao())).join('');
    // Preenche vazios pra manter grid
    const vazios = CARTAO_POR_FOLHA - lote.length;
    const vaziosHtml = Array(vazios).fill(
      `<div style="width:${CARTAO_W_MM}mm;height:${CARTAO_H_MM}mm;"></div>`
    ).join('');
    folhasHtml.push(`
      <div class="cart-folha" style="width:210mm;height:297mm;padding:10mm;box-sizing:border-box;page-break-after:${f<folhas-1?'always':'auto'};">
        <div style="display:grid;grid-template-columns:repeat(${CARTAO_COLS},${CARTAO_W_MM}mm);grid-auto-rows:${CARTAO_H_MM}mm;gap:${CARTAO_GAP_MM}mm;justify-content:center;">
          ${cellsHtml}${vaziosHtml}
        </div>
      </div>
    `);
  }

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return toast('❌ Pop-up bloqueado — habilite no navegador', true);

  w.document.open();
  w.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Cartões — ${total} cartão(ões) · ${folhas} folha(s)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400;1,700&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin:0; padding:0; font-family: Arial, sans-serif; background:#F1F5F9; }
    .cart-folha { background:#fff; margin:10px auto; box-shadow:0 2px 8px rgba(0,0,0,.1); }
    @media print {
      body { background:#fff; margin:0; }
      .cart-folha { margin:0; box-shadow:none; }
      .no-print { display:none !important; }
      /* Bordas guia somem no print */
      .cart-folha div[style*="dashed"] { border:none !important; }
    }
    .bar { background:#9F1239;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10; }
    .bar h1 { margin:0;font-size:16px;font-weight:700; }
    .bar p { margin:0;font-size:12px;opacity:.85; }
    .bar button { background:#fff;color:#9F1239;border:none;padding:10px 22px;border-radius:8px;font-weight:800;cursor:pointer;font-size:13px; }
    .bar button:hover { background:#FAE8E6; }
  </style>
</head>
<body>
  <div class="bar no-print">
    <div>
      <h1>💌 ${total} cartão(ões) · ${folhas} folha(s) A4</h1>
      <p>${CARTAO_W_MM}×${CARTAO_H_MM}mm · 16 por folha (2×8)</p>
    </div>
    <button onclick="window.print()">🖨️ Imprimir</button>
  </div>
  ${folhasHtml.join('')}
  <script>setTimeout(()=>window.print(),500);<\/script>
</body>
</html>`);
  w.document.close();

  _addHistorico({
    origem: opts.origem || 'Manual',
    templateId: lista[0]?.templateId || _getTemplatePadrao(),
    totalCartoes: total,
    folhas,
  });

  toast(`🖨️ ${total} cartão(ões) gerados em ${folhas} folha(s)!`);
}

// ── INTEGRACAO COM RELATORIOS (CHAO DE DATAS COMEMORATIVAS) ──
// Recebe lista de pedidos e gera cartoes pra todos com cardMessage,
// usando o template padrao salvo em localStorage.
export function imprimirCartoesDePedidos(pedidos, origemLabel = 'Datas Comemorativas') {
  const comMsg = (pedidos || []).filter(o => o.cardMessage && String(o.cardMessage).trim());
  if (comMsg.length === 0) {
    return toast('❌ Nenhum pedido com mensagem de cartão preenchida', true);
  }
  const templateId = _getTemplatePadrao();
  const lista = comMsg.map(o => ({
    msg: o.cardMessage,
    templateId,
    pedido: o.orderNumber || o.numero || '',
  }));
  imprimirCartoes(lista, { origem: origemLabel });
}
