// ── MODULO ETIQUETAS ─────────────────────────────────────────
// Gerencia geracao e impressao de etiquetas em diversos formatos
// (preco, codigo de barras, plaquinhas de exposicao).
// Saida em A4 com layout de grade ajustavel.

import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

// Templates de etiqueta (mm). 3 tamanhos calibrados pra A4.
// A4 útil = 190×277mm (margem 10mm cada lado)
export const ETIQUETA_TEMPLATES = [
  // ── PREÇO INDIVIDUAL — 5 × 8 = 40 por folha A4 ──
  // 190/5 = 38mm de largura · 277/8 = 34mm de altura
  {
    id: 'preco-individual',
    nome: 'Preço Individual',
    w: 38, h: 34, cols: 5, tipo: 'preco',
    desc: '5×8 por A4 (40 etiquetas) — Preço central + nome + código',
  },
  // ── PLAQUINHA PEQUENA — 3 × 5 = 15 por folha A4 ──
  // 190/3 ≈ 63mm de largura · 277/5 ≈ 55mm de altura
  {
    id: 'plaquinha-pequena',
    nome: 'Plaquinha Pequena',
    w: 63, h: 55, cols: 3, tipo: 'plaqueta',
    desc: '3×5 por A4 (15 plaquinhas) — Ideal para prateleira',
  },
  // ── PLAQUINHA GRANDE — 1 × 2 = 2 por folha A4 ──
  // 190mm de largura · 277/2 ≈ 138mm de altura
  {
    id: 'plaquinha-grande',
    nome: 'Plaquinha Grande',
    w: 190, h: 138, cols: 1, tipo: 'display',
    desc: '1×2 por A4 (2 plaquinhas) — Vitrine e exposição',
  },
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

// Renderiza UMA etiqueta segundo o tipo.
// HIERARQUIA VISUAL (escolhida pela Marcia):
//   - Nome (peso 2): em cima, menor
//   - Preço (peso 1): centralizado, GIGANTE
//   - Código: em baixo, pequeno mas legível
function _renderUmaEtiqueta(p, template) {
  const nome = p.name || p.nome || 'Produto';
  const preco = Number(p.salePrice || p.preco || 0);
  const promo = Number(p.promoPrice || 0);
  const code = p.code || p.sku || p.codigo || '—';
  const now = Date.now();
  const promoActive = promo > 0 && promo < preco
    && (!p.promoStart || new Date(p.promoStart).getTime() <= now)
    && (!p.promoEnd   || new Date(p.promoEnd).getTime()   >= now);
  const precoExib = promoActive ? promo : preco;
  const precoStr = precoExib.toFixed(2).replace('.', ',');
  const precoCheioStr = preco.toFixed(2).replace('.', ',');

  // ────────────────── PREÇO INDIVIDUAL (38×34mm) ──────────────────
  if (template.tipo === 'preco') {
    return `
      <div style="width:${template.w}mm;height:${template.h}mm;box-sizing:border-box;
                  padding:2mm 2.5mm;display:flex;flex-direction:column;justify-content:space-between;
                  page-break-inside:avoid;overflow:hidden;
                  font-family:'Inter','Helvetica Neue',Arial,sans-serif;
                  background:#fff;border:0.3mm solid #E5E7EB;border-radius:1.5mm;">

        <!-- NOME (peso 2 — secundário, em cima) -->
        <div style="font-size:7pt;font-weight:600;line-height:1.1;
                    color:#475569;text-align:center;
                    overflow:hidden;text-overflow:ellipsis;
                    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
                    letter-spacing:.1pt;">
          ${nome}
        </div>

        <!-- PREÇO (peso 1 — DESTAQUE PRINCIPAL, central) -->
        <div style="text-align:center;line-height:1;">
          ${promoActive ? `
            <div style="font-size:6.5pt;color:#94A3B8;text-decoration:line-through;line-height:1;margin-bottom:.4mm;">
              R$ ${precoCheioStr}
            </div>` : ''}
          <div style="display:flex;justify-content:center;align-items:baseline;gap:.6mm;
                      color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">
            <span style="font-size:8pt;font-weight:700;letter-spacing:-.2pt;margin-bottom:1.2mm;">R$</span>
            <span style="font-size:20pt;font-weight:900;letter-spacing:-.6pt;">${precoStr}</span>
          </div>
        </div>

        <!-- CÓDIGO (em baixo, pequeno mas legível) -->
        <div style="text-align:center;font-size:6.5pt;font-weight:600;
                    color:#1E293B;font-family:'SF Mono','Consolas',Monaco,monospace;
                    letter-spacing:.2pt;border-top:0.2mm solid #F1F5F9;padding-top:1mm;">
          ${code}
        </div>
      </div>
    `;
  }

  // ────────────────── PLAQUINHA PEQUENA (63×55mm) ──────────────────
  if (template.tipo === 'plaqueta') {
    return `
      <div style="width:${template.w}mm;height:${template.h}mm;box-sizing:border-box;
                  padding:4mm;display:flex;flex-direction:column;justify-content:space-between;
                  page-break-inside:avoid;overflow:hidden;
                  font-family:'Inter','Helvetica Neue',Arial,sans-serif;
                  background:linear-gradient(180deg,#FFFFFF 0%,#FFF9F7 100%);
                  border:0.5mm solid #C8736A;border-radius:3mm;
                  box-shadow:inset 0 0 0 0.5mm rgba(200,115,106,.08);">

        <!-- NOME (peso 2 — serif, elegante, em cima) -->
        <div style="text-align:center;">
          <div style="font-family:'Playfair Display','Times New Roman',serif;
                      font-size:10pt;font-weight:700;line-height:1.2;color:#1E293B;
                      overflow:hidden;text-overflow:ellipsis;
                      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
            ${nome}
          </div>
          <div style="height:0.3mm;width:8mm;background:#C8736A;margin:1.2mm auto 0;border-radius:1mm;"></div>
        </div>

        <!-- PREÇO (peso 1 — DESTAQUE PRINCIPAL, central) -->
        <div style="text-align:center;line-height:1;">
          ${promoActive ? `
            <div style="font-size:8pt;color:#94A3B8;text-decoration:line-through;line-height:1;margin-bottom:.4mm;">
              De R$ ${precoCheioStr}
            </div>` : ''}
          <div style="font-size:6.5pt;color:#9F1239;font-weight:600;letter-spacing:1.5pt;
                      text-transform:uppercase;margin-bottom:.4mm;">
            ${promoActive ? 'Promoção' : 'Por apenas'}
          </div>
          <div style="display:flex;justify-content:center;align-items:baseline;gap:1mm;
                      color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">
            <span style="font-size:11pt;font-weight:700;letter-spacing:-.2pt;margin-bottom:2mm;">R$</span>
            <span style="font-size:32pt;font-weight:900;letter-spacing:-1pt;">${precoStr}</span>
          </div>
        </div>

        <!-- CÓDIGO (em baixo, pequeno e legível) -->
        <div style="text-align:center;font-size:7pt;font-weight:600;
                    color:#64748B;font-family:'SF Mono','Consolas',Monaco,monospace;
                    letter-spacing:.3pt;">
          ${code}
        </div>
      </div>
    `;
  }

  // ────────────────── PLAQUINHA GRANDE (190×138mm) ──────────────────
  if (template.tipo === 'display') {
    return `
      <div style="width:${template.w}mm;height:${template.h}mm;box-sizing:border-box;
                  padding:14mm 18mm;display:flex;flex-direction:column;justify-content:space-between;
                  page-break-inside:avoid;overflow:hidden;
                  font-family:'Inter','Helvetica Neue',Arial,sans-serif;
                  background:linear-gradient(135deg,#FFFFFF 0%,#FFF9F7 60%,#FAE8E6 100%);
                  border:1mm solid #C8736A;border-radius:6mm;
                  box-shadow:inset 0 0 0 1mm rgba(200,115,106,.08);position:relative;">

        <!-- DECORAÇÃO TOPO -->
        <div style="text-align:center;">
          <div style="font-size:8pt;color:#9F1239;letter-spacing:4pt;font-weight:700;
                      text-transform:uppercase;margin-bottom:3mm;">
            🌹 Laços Eternos
          </div>
          <div style="height:0.5mm;width:30mm;background:#C8736A;margin:0 auto 6mm;border-radius:1mm;"></div>
        </div>

        <!-- NOME (peso 2 — serif grande, centralizado) -->
        <div style="text-align:center;">
          <div style="font-family:'Playfair Display','Times New Roman',serif;
                      font-size:22pt;font-weight:700;line-height:1.2;color:#1E293B;
                      max-width:160mm;margin:0 auto;
                      overflow:hidden;text-overflow:ellipsis;
                      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
            ${nome}
          </div>
        </div>

        <!-- PREÇO (peso 1 — DESTAQUE MÁXIMO, central) -->
        <div style="text-align:center;line-height:1;">
          ${promoActive ? `
            <div style="font-size:14pt;color:#94A3B8;text-decoration:line-through;line-height:1;margin-bottom:1mm;">
              De R$ ${precoCheioStr}
            </div>` : ''}
          <div style="font-size:9pt;color:#9F1239;font-weight:700;letter-spacing:3pt;
                      text-transform:uppercase;margin-bottom:1mm;">
            ${promoActive ? '✦ Promoção ✦' : 'Por Apenas'}
          </div>
          <div style="display:flex;justify-content:center;align-items:baseline;gap:2mm;
                      color:${promoActive?'#DC2626':'#9F1239'};line-height:1;">
            <span style="font-size:22pt;font-weight:700;letter-spacing:-.5pt;margin-bottom:6mm;">R$</span>
            <span style="font-size:72pt;font-weight:900;letter-spacing:-2pt;">${precoStr}</span>
          </div>
          ${promoActive ? `
            <div style="background:#DC2626;color:#fff;padding:2mm 6mm;border-radius:4mm;
                        display:inline-block;font-size:11pt;font-weight:800;letter-spacing:1pt;
                        margin-top:3mm;box-shadow:0 1mm 2mm rgba(220,38,38,.3);">
              OFERTA LIMITADA
            </div>` : ''}
        </div>

        <!-- CÓDIGO (em baixo, pequeno e legível) -->
        <div style="text-align:center;font-size:8pt;font-weight:600;
                    color:#64748B;font-family:'SF Mono','Consolas',Monaco,monospace;
                    letter-spacing:.5pt;">
          Cód. ${code}
        </div>
      </div>
    `;
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
  if (!S._etqTemplate || !ETIQUETA_TEMPLATES.find(t => t.id === S._etqTemplate)) {
    S._etqTemplate = 'preco-individual';
  }
  const template = ETIQUETA_TEMPLATES.find(t => t.id === S._etqTemplate) || ETIQUETA_TEMPLATES[0];

  const tabBtn = (k, label, icon) => `
    <button data-etq-tab="${k}" class="tab ${tab===k?'active':''}" style="padding:10px 18px;font-size:13px;">${icon} ${label}</button>
  `;

  return `
<div style="max-width:1100px;margin:0 auto;">
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
        <label class="fl" style="font-weight:600;">Tamanho da Etiqueta</label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:6px;">
          ${ETIQUETA_TEMPLATES.map(t => {
            const sel = t.id === template.id;
            return `<button type="button" data-etq-select-template="${t.id}"
              style="background:${sel?'linear-gradient(135deg,#9F1239,#C8736A)':'#fff'};color:${sel?'#fff':'#1E293B'};
                     border:2px solid ${sel?'#9F1239':'#E5E7EB'};border-radius:10px;padding:10px 12px;
                     cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;">
              <div style="font-weight:700;font-size:13px;line-height:1.2;margin-bottom:2px;">${t.nome}</div>
              <div style="font-size:10px;opacity:.85;line-height:1.3;">${t.w}×${t.h}mm · ${t.cols}×${Math.floor(277/t.h)} por A4</div>
            </button>`;
          }).join('')}
        </div>
        <select id="etq-template" style="display:none;">
          ${ETIQUETA_TEMPLATES.map(t => `<option value="${t.id}" ${t.id===template.id?'selected':''}>${t.nome}</option>`).join('')}
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
      <div style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:10px;padding:18px;display:flex;justify-content:center;align-items:center;min-height:200px;overflow:hidden;">
        ${(() => {
          // Zoom adequado pra cada tamanho preencher bem a area de preview (~320px wide)
          const targetWidth = 280; // px
          const tWmm = template.w;
          const tMmToPx = 3.78; // ~3.78px/mm em 96dpi
          const naturalPx = tWmm * tMmToPx;
          const zoom = Math.min(2.4, Math.max(0.8, targetWidth / naturalPx));
          return `<div style="transform:scale(${zoom.toFixed(2)});transform-origin:center;display:inline-block;">${previewHtml}</div>`;
        })()}
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
  const previewProd = { name:'Buquê Premium', salePrice:189.90, code:'LE0001' };
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
    ⚙️ Templates Disponíveis
    <span style="font-size:11px;color:var(--muted);font-weight:400;">3 tamanhos calibrados para folha A4</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;">
    ${ETIQUETA_TEMPLATES.map(t => {
      const perA4 = t.cols * Math.floor(277/t.h);
      const preview = _renderUmaEtiqueta(previewProd, t);
      const previewZoom = Math.min(1.6, 220 / (t.w * 3.78));
      return `
      <div style="background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div>
          <div style="font-weight:700;color:#1E293B;font-size:14px;margin-bottom:2px;">${t.nome}</div>
          <div style="font-size:11px;color:var(--muted);line-height:1.4;">${t.desc}</div>
        </div>
        <div style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:8px;padding:14px;display:flex;justify-content:center;align-items:center;min-height:140px;overflow:hidden;">
          <div style="transform:scale(${previewZoom.toFixed(2)});transform-origin:center;display:inline-block;">${preview}</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;font-size:10px;">
          <div style="background:#F1F5F9;border-radius:6px;padding:6px 8px;text-align:center;">
            <div style="color:var(--muted);">Tamanho</div>
            <strong style="color:#1E293B;">${t.w}×${t.h}mm</strong>
          </div>
          <div style="background:#F1F5F9;border-radius:6px;padding:6px 8px;text-align:center;">
            <div style="color:var(--muted);">Por A4</div>
            <strong style="color:#9F1239;">${perA4} etiquetas</strong>
          </div>
          <div style="background:#F1F5F9;border-radius:6px;padding:6px 8px;text-align:center;">
            <div style="color:var(--muted);">Grade</div>
            <strong style="color:#1E293B;">${t.cols}×${Math.floor(277/t.h)}</strong>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>
  <div style="background:#EFF6FF;border:1px solid #3B82F6;border-radius:8px;padding:12px;margin-top:14px;font-size:12px;color:#1E3A8A;line-height:1.5;">
    💡 <strong>Dica de impressão:</strong><br/>
    • Preço Individual → papel adesivo (Pimaco) ou comum 75g<br/>
    • Plaquinha Pequena → papel cartão 180g+ (melhor apresentação)<br/>
    • Plaquinha Grande → papel cartão 240g+ ou colado em base rígida (vitrine)
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

  // Template change — botões-card OU select fallback
  document.querySelectorAll('[data-etq-select-template]').forEach(b => {
    b.onclick = () => {
      S._etqTemplate = b.dataset.etqSelectTemplate;
      render();
    };
  });
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
