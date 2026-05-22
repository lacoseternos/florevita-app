// ── MODULO ETIQUETAS ─────────────────────────────────────────
// Gerencia geracao e impressao de etiquetas em diversos formatos
// (preco, codigo de barras, plaquinhas de exposicao).
// Saida em A4 com layout de grade ajustavel.

import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

// Templates de etiqueta (mm). Pode ser estendido pela admin.
export const ETIQUETA_TEMPLATES = [
  // ── PEQUENAS (preco/codigo) ──
  { id:'pp-30x20',  nome:'Etiqueta Pequena 30×20mm',  w:30,  h:20,  cols:7, tipo:'preco',   desc:'Mini etiqueta de preço (Pimaco 6280 / Letterfile)' },
  { id:'pp-40x25',  nome:'Etiqueta Pequena 40×25mm',  w:40,  h:25,  cols:5, tipo:'preco',   desc:'Pequena com nome + preço' },
  { id:'pp-50x30',  nome:'Etiqueta Pequena 50×30mm',  w:50,  h:30,  cols:4, tipo:'preco',   desc:'Pequena com nome + preço + código' },
  { id:'cb-60x30',  nome:'Código de Barras 60×30mm',  w:60,  h:30,  cols:3, tipo:'barcode', desc:'Etiqueta com código de barras / SKU' },
  { id:'pm-60x40',  nome:'Etiqueta Média 60×40mm',    w:60,  h:40,  cols:3, tipo:'completa',desc:'Nome + código + preço + R$' },
  // ── MÉDIAS (plaquinhas de prateleira) ──
  { id:'pl-100x70', nome:'Plaquinha 100×70mm',         w:100, h:70,  cols:2, tipo:'plaqueta', desc:'Plaquinha de exposição com nome destacado' },
  { id:'pl-90x60',  nome:'Plaquinha 90×60mm',          w:90,  h:60,  cols:2, tipo:'plaqueta', desc:'Plaquinha média de prateleira' },
  // ── GRANDES (display de vitrine) ──
  { id:'dv-a6',     nome:'Display A6 (vertical)',      w:105, h:148, cols:2, tipo:'display',  desc:'Cartaz pequeno para vitrine (148×105 = A6)' },
  { id:'dv-a5',     nome:'Display A5 (horizontal)',    w:210, h:148, cols:1, tipo:'display',  desc:'Cartaz grande para vitrine (A5 horizontal)' },
];

// Helper: gera padrão de barras simples (visual, sem ler — só pra layout)
function _barcodeSvg(code) {
  if (!code) return '';
  // Gera padrão pseudo-EAN visual a partir do hash do código
  const str = String(code);
  let bars = '';
  let x = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    // Cada caractere vira 4 barras de larguras diferentes (1, 2 ou 3)
    const widths = [
      ((c >> 0) & 3) + 1,
      ((c >> 2) & 3) + 1,
      ((c >> 4) & 3) + 1,
      ((c >> 6) & 3) + 1,
    ];
    widths.forEach((w, j) => {
      if (j % 2 === 0) {
        bars += `<rect x="${x}" y="0" width="${w}" height="40" fill="#000"/>`;
      }
      x += w;
    });
  }
  return `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" style="width:100%;height:14mm;">${bars}</svg>`;
}

// Renderiza UMA etiqueta segundo o tipo
function _renderUmaEtiqueta(p, template) {
  const nome = p.name || p.nome || 'Produto';
  const preco = Number(p.salePrice || p.preco || 0);
  const promo = Number(p.promoPrice || 0);
  const code = p.code || p.sku || p.codigo || '—';
  // Promo ativa?
  const now = Date.now();
  const promoActive = promo > 0 && promo < preco
    && (!p.promoStart || new Date(p.promoStart).getTime() <= now)
    && (!p.promoEnd   || new Date(p.promoEnd).getTime()   >= now);
  const precoExib = promoActive ? promo : preco;

  const baseStyle = `width:${template.w}mm;height:${template.h}mm;box-sizing:border-box;border:1px dashed #CBD5E1;padding:2mm;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid;overflow:hidden;font-family:Arial,sans-serif;`;

  if (template.tipo === 'preco') {
    return `<div style="${baseStyle}">
      <div style="font-size:${template.h<25?6:8}pt;font-weight:600;line-height:1.1;color:#1E293B;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${nome}</div>
      <div style="text-align:right;">
        ${promoActive?`<div style="font-size:7pt;color:#94A3B8;text-decoration:line-through;line-height:1;">R$ ${preco.toFixed(2).replace('.',',')}</div>`:''}
        <div style="font-size:${template.h<25?11:14}pt;font-weight:800;color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">R$ ${precoExib.toFixed(2).replace('.',',')}</div>
        ${template.h>=30?`<div style="font-size:6pt;color:#64748B;margin-top:1mm;">${code}</div>`:''}
      </div>
    </div>`;
  }

  if (template.tipo === 'barcode') {
    return `<div style="${baseStyle}">
      <div style="font-size:7pt;font-weight:600;color:#1E293B;line-height:1.1;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;">${nome}</div>
      ${_barcodeSvg(code)}
      <div style="display:flex;justify-content:space-between;font-size:7pt;font-family:Monaco,monospace;">
        <span>${code}</span>
        <strong style="color:#9F1239;">R$ ${precoExib.toFixed(2).replace('.',',')}</strong>
      </div>
    </div>`;
  }

  if (template.tipo === 'completa') {
    return `<div style="${baseStyle}">
      <div style="font-size:9pt;font-weight:700;color:#1E293B;line-height:1.15;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${nome}</div>
      <div style="font-size:7pt;color:#64748B;font-family:Monaco,monospace;">${code}</div>
      <div style="text-align:right;">
        ${promoActive?`<div style="font-size:8pt;color:#94A3B8;text-decoration:line-through;line-height:1;">R$ ${preco.toFixed(2).replace('.',',')}</div>`:''}
        <div style="font-size:16pt;font-weight:800;color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">R$ ${precoExib.toFixed(2).replace('.',',')}</div>
      </div>
    </div>`;
  }

  if (template.tipo === 'plaqueta') {
    return `<div style="${baseStyle}border:2px solid #9F1239;border-radius:4mm;background:linear-gradient(135deg,#FFF7ED,#FFEDD5);padding:4mm;">
      <div style="font-size:10pt;font-weight:800;color:#9F1239;line-height:1.2;text-align:center;font-family:'Playfair Display',Georgia,serif;">${nome}</div>
      ${promoActive?`<div style="text-align:center;font-size:9pt;color:#94A3B8;text-decoration:line-through;margin-bottom:1mm;">De R$ ${preco.toFixed(2).replace('.',',')}</div>`:''}
      <div style="text-align:center;">
        <div style="font-size:8pt;color:#7C2D12;font-weight:600;">${promoActive?'POR APENAS':'POR APENAS'}</div>
        <div style="font-size:22pt;font-weight:900;color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">R$ ${precoExib.toFixed(2).replace('.',',')}</div>
        ${promoActive?`<div style="background:#DC2626;color:#fff;padding:1mm 3mm;border-radius:3mm;display:inline-block;font-size:9pt;font-weight:700;margin-top:1mm;">PROMOÇÃO</div>`:''}
      </div>
      <div style="text-align:center;font-size:6pt;color:#7C2D12;opacity:.7;font-family:Monaco,monospace;">${code}</div>
    </div>`;
  }

  if (template.tipo === 'display') {
    const h = template.h;
    const isHoriz = template.w > template.h;
    return `<div style="${baseStyle}border:3px solid #9F1239;border-radius:6mm;background:linear-gradient(135deg,#FAE8E6,#FFF);padding:6mm;display:flex;${isHoriz?'flex-direction:row;align-items:center;':'flex-direction:column;'}justify-content:center;gap:4mm;text-align:center;">
      <div style="flex:1;">
        <div style="font-size:8pt;color:#9F1239;letter-spacing:2pt;font-weight:600;text-transform:uppercase;margin-bottom:2mm;">🌹 Floricultura Laços Eternos</div>
        <div style="font-size:${isHoriz?20:18}pt;font-weight:800;color:#1E293B;line-height:1.2;font-family:'Playfair Display',Georgia,serif;margin-bottom:3mm;">${nome}</div>
        ${promoActive?`<div style="font-size:12pt;color:#94A3B8;text-decoration:line-through;">R$ ${preco.toFixed(2).replace('.',',')}</div>`:''}
        <div style="font-size:8pt;color:#7C2D12;font-weight:600;margin-top:2mm;">${promoActive?'PROMOÇÃO':'POR APENAS'}</div>
        <div style="font-size:${isHoriz?34:28}pt;font-weight:900;color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">R$ ${precoExib.toFixed(2).replace('.',',')}</div>
        ${promoActive?`<div style="background:#DC2626;color:#fff;padding:2mm 4mm;border-radius:4mm;display:inline-block;font-size:11pt;font-weight:800;margin-top:3mm;">OFERTA LIMITADA</div>`:''}
        <div style="font-size:7pt;color:#64748B;margin-top:4mm;font-family:Monaco,monospace;">Cód.: ${code}</div>
      </div>
    </div>`;
  }

  return '';
}

// Helper: histórico em localStorage
const HIST_KEY = 'fv_etiquetas_hist';
function _getHistorico() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch { return []; }
}
function _saveHistorico(arr) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(0, 50))); } catch {}
}
function _addHistorico(entry) {
  const hist = _getHistorico();
  hist.unshift({ ...entry, id: Date.now()+'_'+Math.random().toString(36).slice(2,6), criadoEm: new Date().toISOString() });
  _saveHistorico(hist);
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────
export function renderEtiquetas() {
  const tab = S._etqTab || 'criar';
  if (!Array.isArray(S._etqSelecionados)) S._etqSelecionados = [];
  if (!S._etqTemplate) S._etqTemplate = 'pm-60x40';
  const template = ETIQUETA_TEMPLATES.find(t => t.id === S._etqTemplate) || ETIQUETA_TEMPLATES[4];

  const tabBtn = (k, label, icon) => `
    <button data-etq-tab="${k}" class="tab ${tab===k?'active':''}" style="padding:10px 18px;font-size:13px;">${icon} ${label}</button>
  `;

  return `
<div style="max-width:1100px;margin:0 auto;">
  <!-- BREADCRUMB / VOLTAR -->
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;font-size:12px;">
    <button type="button" onclick="setPage('produtos')" style="background:transparent;border:none;color:#9F1239;cursor:pointer;font-size:13px;font-weight:600;padding:4px 8px;border-radius:6px;" onmouseover="this.style.background='#FAE8E6'" onmouseout="this.style.background='transparent'">← Voltar para Produtos</button>
    <span style="color:var(--muted);">›</span>
    <span style="color:#1E293B;font-weight:600;">🏷️ Etiquetas</span>
  </div>

  <!-- HEADER -->
  <div style="text-align:center;margin-bottom:20px;">
    <h1 style="font-family:'Playfair Display',serif;font-size:28px;color:#1E293B;margin:0 0 4px;">🏷️ Gerenciador de Etiquetas</h1>
    <p style="font-size:13px;color:var(--muted);margin:0;">Crie, configure e imprima etiquetas em diferentes formatos</p>
  </div>

  <!-- TABS -->
  <div style="display:flex;gap:8px;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:12px;padding:6px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);">
    ${tabBtn('criar',  'Criar Etiquetas', '📝')}
    ${tabBtn('templates', 'Templates', '⚙️')}
    ${tabBtn('historico', 'Histórico', '📊')}
  </div>

  ${tab === 'criar' ? renderTabCriar(template) : ''}
  ${tab === 'templates' ? renderTabTemplates() : ''}
  ${tab === 'historico' ? renderTabHistorico() : ''}
</div>
`;
}

function renderTabCriar(template) {
  const sel = S._etqSelecionados;
  const search = S._etqSearch || '';
  const totalEtiquetas = sel.reduce((s, x) => s + (x.qty || 1), 0);
  // Etiquetas por folha A4 (210x297mm) usando cols + altura
  const A4_W = 190, A4_H = 277; // margem 10mm cada lado
  const linhas = Math.floor(A4_H / template.h);
  const porFolha = template.cols * linhas;
  const folhas = porFolha > 0 ? Math.ceil(totalEtiquetas / porFolha) : 1;

  // Filtra produtos para a busca
  const matches = search.trim().length >= 2
    ? (S.products || []).filter(p => {
        const q = search.toLowerCase();
        const nome = (p.name || p.nome || '').toLowerCase();
        const code = (p.code || p.sku || p.codigo || '').toLowerCase();
        return nome.includes(q) || code.includes(q);
      }).slice(0, 8)
    : [];

  // Preview da primeira etiqueta selecionada (ou produto demo)
  const previewProd = sel[0] || { name:'Produto Exemplo', salePrice:99.90, code:'LE0001' };
  const previewHtml = _renderUmaEtiqueta(previewProd, template);

  return `
<div style="display:grid;grid-template-columns:1fr 360px;gap:18px;">
  <!-- COLUNA ESQUERDA: criar etiquetas -->
  <div>
    <!-- BUSCA -->
    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        🔍 Pesquisar Produtos
      </div>
      <input type="text" id="etq-search" placeholder="Nome ou código do produto..." value="${search.replace(/"/g,'&quot;')}" style="width:100%;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;"/>
      ${matches.length > 0 ? `
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
        ${matches.map(p => {
          const code = p.code || p.sku || p.codigo || '—';
          const preco = Number(p.salePrice || p.preco || 0);
          const promo = Number(p.promoPrice || 0);
          const now = Date.now();
          const promoActive = promo > 0 && promo < preco;
          return `
          <button type="button" data-etq-add="${p._id}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;cursor:pointer;text-align:left;transition:background .15s;" onmouseover="this.style.background='#FAE8E6'" onmouseout="this.style.background='#fff'">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:13px;color:#1E293B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name || p.nome || ''}</div>
              <div style="font-size:10px;color:var(--muted);font-family:Monaco,monospace;">${code}</div>
            </div>
            <div style="font-weight:700;color:#9F1239;font-size:13px;white-space:nowrap;">${$c(promoActive?promo:preco)}</div>
            <span style="background:#9F1239;color:#fff;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">+ Adicionar</span>
          </button>`;
        }).join('')}
      </div>` : (search.trim().length >= 2 ? `<div style="margin-top:10px;font-size:12px;color:var(--muted);font-style:italic;">Nenhum produto encontrado.</div>` : '')}
    </div>

    <!-- PRODUTOS SELECIONADOS -->
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div style="font-weight:700;">📦 Produtos Selecionados</div>
        <div style="display:flex;gap:6px;align-items:center;">
          <span style="background:#FAE8E6;color:#9F1239;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">${sel.length} produto(s) · ${totalEtiquetas} etiqueta(s)</span>
          ${sel.length > 0 ? `<button type="button" data-etq-clear style="background:#FEE2E2;color:#991B1B;border:none;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:700;">🗑️ Limpar</button>` : ''}
        </div>
      </div>
      ${sel.length === 0 ? `<div style="text-align:center;padding:24px 12px;color:var(--muted);font-size:12px;font-style:italic;">Nenhum produto selecionado. Use a busca acima.</div>` : `
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${sel.map((p, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:13px;color:#1E293B;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name || p.nome || '—'}</div>
            <div style="font-size:10px;color:var(--muted);font-family:Monaco,monospace;">${p.code || p.sku || '—'} · ${$c(p.salePrice||p.preco||0)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:11px;color:var(--muted);">Qtd:</span>
            <input type="number" min="1" max="500" data-etq-qty="${i}" value="${p.qty||1}" style="width:60px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:center;font-weight:700;"/>
          </div>
          <button type="button" data-etq-del="${i}" style="background:#FEE2E2;color:#991B1B;border:none;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:13px;">🗑️</button>
        </div>`).join('')}
      </div>`}
    </div>

    <!-- CONFIGURACAO -->
    <div class="card">
      <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        📋 Configurações da Etiqueta
      </div>
      <div class="fg" style="margin-bottom:14px;">
        <label class="fl" style="font-weight:600;">Template / Tamanho</label>
        <select class="fi" id="etq-template" style="width:100%;">
          <optgroup label="Pequenas (preço)">
            ${ETIQUETA_TEMPLATES.filter(t=>['preco','barcode'].includes(t.tipo)).map(t => `<option value="${t.id}" ${t.id===template.id?'selected':''}>${t.nome} — ${t.desc}</option>`).join('')}
          </optgroup>
          <optgroup label="Médias (completas)">
            ${ETIQUETA_TEMPLATES.filter(t=>t.tipo==='completa').map(t => `<option value="${t.id}" ${t.id===template.id?'selected':''}>${t.nome} — ${t.desc}</option>`).join('')}
          </optgroup>
          <optgroup label="Plaquinhas (prateleira)">
            ${ETIQUETA_TEMPLATES.filter(t=>t.tipo==='plaqueta').map(t => `<option value="${t.id}" ${t.id===template.id?'selected':''}>${t.nome} — ${t.desc}</option>`).join('')}
          </optgroup>
          <optgroup label="Display (vitrine)">
            ${ETIQUETA_TEMPLATES.filter(t=>t.tipo==='display').map(t => `<option value="${t.id}" ${t.id===template.id?'selected':''}>${t.nome} — ${t.desc}</option>`).join('')}
          </optgroup>
        </select>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;font-size:11px;">
        <div style="background:#F1F5F9;border-radius:8px;padding:8px 10px;">
          <div style="color:var(--muted);font-size:10px;">Tamanho</div>
          <div style="font-weight:700;color:#1E293B;">${template.w}×${template.h}mm</div>
        </div>
        <div style="background:#F1F5F9;border-radius:8px;padding:8px 10px;">
          <div style="color:var(--muted);font-size:10px;">Por folha A4</div>
          <div style="font-weight:700;color:#1E293B;">${porFolha} etiquetas</div>
        </div>
        <div style="background:#F1F5F9;border-radius:8px;padding:8px 10px;">
          <div style="color:var(--muted);font-size:10px;">Folhas necessárias</div>
          <div style="font-weight:700;color:${folhas>3?'#DC2626':'#9F1239'};">${folhas} folha${folhas>1?'s':''} A4</div>
        </div>
      </div>
      <button type="button" id="btn-etq-gerar" ${sel.length===0?'disabled':''} style="width:100%;background:${sel.length===0?'#CBD5E1':'linear-gradient(135deg,#9F1239,#C8736A)'};color:#fff;border:none;padding:14px;border-radius:10px;font-size:14px;font-weight:800;cursor:${sel.length===0?'not-allowed':'pointer'};letter-spacing:.5px;">
        🖨️ Gerar ${totalEtiquetas || 0} Etiqueta(s) — Imprimir
      </button>
    </div>
  </div>

  <!-- COLUNA DIREITA: preview -->
  <div>
    <div class="card" style="position:sticky;top:20px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span>👁️ Preview</span>
        <span style="background:#F1F5F9;color:#475569;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:600;">${template.w}×${template.h}mm</span>
      </div>
      <div style="background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:10px;padding:12px;display:flex;justify-content:center;align-items:center;min-height:180px;">
        <div style="transform:scale(2);transform-origin:center;display:inline-block;">${previewHtml}</div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--muted);text-align:center;line-height:1.5;">
        ${sel.length === 0 ? 'Selecione um produto para ver o preview real.' : `Mostrando: <strong>${sel[0].name||sel[0].nome}</strong>`}
      </div>
      <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:#78350F;line-height:1.5;">
        💡 <strong>Dica:</strong> Use folha A4 comum (75g) para etiquetas pequenas/médias.<br/>
        Para plaquinhas e displays, use papel mais grosso (180g) ou cartão para melhor apresentação.
      </div>
    </div>
  </div>
</div>
`;
}

function renderTabTemplates() {
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;">⚙️ Templates Disponíveis</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;">
    ${ETIQUETA_TEMPLATES.map(t => `
    <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div style="font-weight:700;color:#1E293B;font-size:13px;">${t.nome}</div>
        <span style="background:${t.tipo==='preco'?'#DBEAFE':t.tipo==='barcode'?'#FEF3C7':t.tipo==='completa'?'#DCFCE7':t.tipo==='plaqueta'?'#FAE8E6':'#FCE7F3'};color:${t.tipo==='preco'?'#1E40AF':t.tipo==='barcode'?'#92400E':t.tipo==='completa'?'#15803D':t.tipo==='plaqueta'?'#9F1239':'#9D174D'};padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;">${t.tipo}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:8px;line-height:1.4;">${t.desc}</div>
      <div style="display:flex;gap:8px;font-size:11px;color:#475569;">
        <span><strong>${t.w}×${t.h}</strong>mm</span>
        <span>·</span>
        <span><strong>${t.cols}</strong> por linha</span>
        <span>·</span>
        <span><strong>${Math.floor(277/t.h) * t.cols}</strong>/A4</span>
      </div>
    </div>`).join('')}
  </div>
  <div style="background:#EFF6FF;border:1px solid #3B82F6;border-radius:8px;padding:12px;margin-top:14px;font-size:12px;color:#1E3A8A;line-height:1.5;">
    💡 <strong>Sobre os templates:</strong> Para etiquetas pequenas (preço/código), use papel adesivo Pimaco. Para plaquinhas e displays, recomendamos papel cartão 180g+ ou impressão em papel comum colado em base de plástico/madeira.
  </div>
</div>
`;
}

function renderTabHistorico() {
  const hist = _getHistorico();
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
    <span>📊 Histórico de Impressões</span>
    ${hist.length > 0 ? `<button type="button" id="btn-etq-clear-hist" style="background:#FEE2E2;color:#991B1B;border:none;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">🗑️ Limpar histórico</button>` : ''}
  </div>
  ${hist.length === 0 ? `
  <div style="text-align:center;padding:40px 20px;color:var(--muted);">
    <div style="font-size:48px;margin-bottom:10px;">📭</div>
    <p style="font-size:13px;font-weight:600;">Nenhuma impressão ainda</p>
    <p style="font-size:11px;margin-top:4px;">Aqui aparecerão suas últimas gerações de etiquetas.</p>
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:8px;">
    ${hist.map(h => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff;border:1px solid var(--border);border-radius:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;color:#1E293B;">${h.templateNome || 'Etiqueta'}</div>
        <div style="font-size:11px;color:var(--muted);">${h.totalEtiquetas} etiquetas · ${h.produtos} produto(s) · ${h.folhas} folha(s) A4</div>
      </div>
      <div style="font-size:11px;color:var(--muted);text-align:right;">${new Date(h.criadoEm).toLocaleString('pt-BR')}</div>
    </div>`).join('')}
  </div>`}
</div>
`;
}

// ── BIND EVENTS ──────────────────────────────────────────────
export function bindEtiquetasEvents() {
  const render = () => import('../main.js').then(m => m.render?.());

  document.querySelectorAll('[data-etq-tab]').forEach(b => {
    b.onclick = () => { S._etqTab = b.dataset.etqTab; render(); };
  });

  // Search
  const sInput = document.getElementById('etq-search');
  if (sInput) {
    sInput.addEventListener('input', e => {
      S._etqSearch = e.target.value;
      render();
    });
  }

  // Add product
  document.querySelectorAll('[data-etq-add]').forEach(b => {
    b.onclick = () => {
      const pid = b.dataset.etqAdd;
      const p = (S.products || []).find(x => x._id === pid);
      if (!p) return;
      const existing = S._etqSelecionados.find(x => x._id === pid);
      if (existing) {
        existing.qty = (existing.qty || 1) + 1;
      } else {
        S._etqSelecionados.push({ ...p, qty: 1 });
      }
      S._etqSearch = ''; // limpa busca
      render();
    };
  });

  // Update quantity
  document.querySelectorAll('[data-etq-qty]').forEach(inp => {
    inp.addEventListener('input', e => {
      const i = parseInt(e.target.dataset.etqQty);
      const q = Math.max(1, Math.min(500, parseInt(e.target.value) || 1));
      if (S._etqSelecionados[i]) S._etqSelecionados[i].qty = q;
    });
  });

  // Delete product
  document.querySelectorAll('[data-etq-del]').forEach(b => {
    b.onclick = () => {
      const i = parseInt(b.dataset.etqDel);
      S._etqSelecionados.splice(i, 1);
      render();
    };
  });

  // Clear all
  const btnClear = document.querySelector('[data-etq-clear]');
  if (btnClear) btnClear.onclick = () => {
    if (!confirm('Limpar todos os produtos selecionados?')) return;
    S._etqSelecionados = [];
    render();
  };

  // Template change
  const tInput = document.getElementById('etq-template');
  if (tInput) tInput.addEventListener('change', e => {
    S._etqTemplate = e.target.value;
    render();
  });

  // Generate (print)
  const btnGerar = document.getElementById('btn-etq-gerar');
  if (btnGerar) btnGerar.onclick = () => gerarEImprimir();

  // Clear historic
  const btnClearHist = document.getElementById('btn-etq-clear-hist');
  if (btnClearHist) btnClearHist.onclick = () => {
    if (!confirm('Limpar todo o histórico de impressões?')) return;
    _saveHistorico([]);
    render();
  };
}

// ── GERAR + IMPRIMIR ─────────────────────────────────────────
function gerarEImprimir() {
  const sel = S._etqSelecionados || [];
  if (sel.length === 0) return toast('❌ Adicione produtos primeiro', true);
  const template = ETIQUETA_TEMPLATES.find(t => t.id === S._etqTemplate);
  if (!template) return toast('❌ Template inválido', true);

  // Expande lista: cada produto vezes sua quantidade
  const etiquetas = [];
  sel.forEach(p => {
    const qty = p.qty || 1;
    for (let i = 0; i < qty; i++) etiquetas.push(p);
  });

  // Calcula layout A4
  const linhas = Math.floor(277 / template.h);
  const porFolha = template.cols * linhas;
  const folhas = porFolha > 0 ? Math.ceil(etiquetas.length / porFolha) : 1;

  // Gera HTML completo das folhas
  const folhasHtml = [];
  for (let f = 0; f < folhas; f++) {
    const ini = f * porFolha;
    const fim = Math.min(ini + porFolha, etiquetas.length);
    const lote = etiquetas.slice(ini, fim);
    const cellsHtml = lote.map(p => _renderUmaEtiqueta(p, template)).join('');
    // Preenche células vazias se necessário pra manter grid
    const vazios = porFolha - lote.length;
    const vaziosHtml = Array(vazios).fill(`<div style="width:${template.w}mm;height:${template.h}mm;"></div>`).join('');
    folhasHtml.push(`
      <div class="etq-folha" style="width:210mm;height:297mm;padding:10mm;box-sizing:border-box;display:flex;flex-wrap:wrap;align-content:flex-start;gap:0;page-break-after:${f<folhas-1?'always':'auto'};">
        <div style="display:grid;grid-template-columns:repeat(${template.cols},${template.w}mm);grid-auto-rows:${template.h}mm;gap:0;">
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
  <title>Etiquetas — ${template.nome}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; padding: 0; font-family: Arial, sans-serif; background:#F1F5F9; }
    .etq-folha { background: #fff; margin: 10px auto; box-shadow: 0 2px 8px rgba(0,0,0,.1); }
    @media print {
      body { background: #fff; }
      .etq-folha { margin: 0; box-shadow: none; }
      .no-print { display: none !important; }
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
      <h1>🖨️ ${etiquetas.length} etiqueta(s) · ${folhas} folha(s) A4</h1>
      <p>${template.nome} — ${template.w}×${template.h}mm</p>
    </div>
    <button onclick="window.print()">🖨️ Imprimir</button>
  </div>
  ${folhasHtml.join('')}
  <script>setTimeout(()=>window.print(),500);</script>
</body>
</html>`);
  w.document.close();

  // Salva no histórico
  _addHistorico({
    templateId: template.id,
    templateNome: template.nome,
    produtos: sel.length,
    totalEtiquetas: etiquetas.length,
    folhas,
  });

  toast(`🖨️ ${etiquetas.length} etiqueta(s) geradas em ${folhas} folha(s)!`);
}
