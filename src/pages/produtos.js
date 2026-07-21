import { S } from '../state.js';
import { $c, emoji, esc } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE, PATCH } from '../services/api.js';
import { normalizeName } from '../utils/normalizeName.js';

// ── HELPER: redimensiona imagem ANTES de virar base64 ─────────
// Sem isso, fotos de celular (5-15MB) viram JSON gigante e o Mongo
// da timeout pra salvar. Reduz pra max width + JPEG comprimido.
// Tipico: 8MB original -> 250KB base64.
async function resizeImageToBase64(file, maxWidth = 1400, quality = 0.85) {
  if (!file) throw new Error('Arquivo invalido');
  if (file.size > 30 * 1024 * 1024) {
    throw new Error('Imagem muito grande (max 30MB). Tire uma foto menor.');
  }
  // Le como dataURL
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Falha ao ler arquivo'));
    r.readAsDataURL(file);
  });
  // Carrega num <img>
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Imagem corrompida'));
    i.src = dataUrl;
  });
  // Se ja for pequeno, retorna direto sem reprocessar
  if (img.naturalWidth <= maxWidth && file.size < 500 * 1024) {
    return dataUrl;
  }
  // Calcula nova dimensao mantendo proporcao
  const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  // Desenha em canvas
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  // Exporta como JPEG comprimido (mantem PNG se for foto com transparencia? raro)
  return canvas.toDataURL('image/jpeg', quality);
}

// ── CSV/JSON Import/Export helpers ────────────────────────────
function toCSV(rows, columns){
  const header = columns.join(';');
  const lines = rows.map(r => columns.map(c => {
    const val = c.split('.').reduce((o,k)=>o?.[k], r) ?? '';
    const str = String(val).replace(/"/g,'""');
    return /[;"\n]/.test(str) ? `"${str}"` : str;
  }).join(';'));
  return '\uFEFF' + header + '\n' + lines.join('\n');
}
function downloadFile(content, filename, mime='text/csv'){
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function parseCSV(text){
  const lines = text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length) return [];
  const header = lines[0].split(';');
  return lines.slice(1).map(line => {
    const values = line.split(';');
    const obj = {};
    header.forEach((h,i) => obj[h.trim()] = (values[i]||'').trim());
    return obj;
  });
}
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache, saveCachedData, recarregarDados } from '../services/cache.js';
// Marcia (jul/2026): estoque vem da fonte UNICA (soma por unidade).
import { getStockTotal, isLowStock, getStockByUnit, STOCK_UNITS, UNIT_LABEL } from '../utils/stock.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Helper: getCategorias (local) ─────────────────────────────
const CAT_KEY = 'fv_categorias';
const CAT_DEFAULT = ['Rosa','Buque','Orquidea','Planta','Kit','Vaso','Flor','Coroa','Cesta','Embalagem','Adicionais','Arranjo','Bouquet Premium','Decoracao','Outro'];
function getCategorias(){
  // Lê do localStorage E do S.products para pegar todas as categorias disponíveis.
  // Suporta tanto strings (legado) quanto objetos {_id, name} (backend sincronizado).
  const raw = JSON.parse(localStorage.getItem(CAT_KEY)||'null') || CAT_DEFAULT;
  const names = new Set();
  raw.forEach(c => {
    if (typeof c === 'string') names.add(c);
    else if (c && c.name) names.add(c.name);
  });
  // Também extrai categorias dos produtos carregados
  (S.products||[]).forEach(p => {
    if (Array.isArray(p.categories)) p.categories.forEach(c => c && names.add(c));
    if (p.category) names.add(p.category);
    if (p.categoria) names.add(p.categoria);
  });
  return [...names].sort();
}

// ── Helper: showFullImg ───────────────────────────────────────
function showFullImg(url){
  S._modal=`<div class="mo" id="mo" onclick="S._modal='';render()">
  <div style="background:#fff;border-radius:16px;padding:16px;max-width:500px;width:94%;text-align:center">
    <img src="${url}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;"/>
    <div style="margin-top:10px"><button class="btn btn-ghost" onclick="S._modal='';render()">Fechar</button></div>
  </div></div>`;
  render();
}

// ── Helper: collectInsumos ────────────────────────────────────
function collectInsumos(){
  const rows = document.querySelectorAll('[data-insumo-row]');
  const arr = [];
  rows.forEach(row=>{
    const id = row.querySelector('[data-insumo-id]')?.value;
    const qty = parseFloat(row.querySelector('[data-insumo-qty]')?.value)||0;
    if(id && qty>0) arr.push({productId:id, qty});
  });
  return arr;
}

// ── Expose to window for inline onclick handlers ──────────────
window.showNewProductModal = showNewProductModal;
window.deleteProduct = deleteProduct;
window.confirmDeleteProduct = confirmDeleteProduct;
window.showProductStockModal = showProductStockModal;
window.showFullImg = showFullImg;
window.saveStockFromModal = saveStockFromModal;
window.recarregarDados = recarregarDados;

// ── Multi-category helpers ────────────────────────────────────
function getProductCategories(p){
  if(!p) return [];
  if(Array.isArray(p.categories) && p.categories.length) return p.categories.slice();
  if(p.category) return [p.category];
  return [];
}
window.toggleProductCategory = function(cat, checked){
  S._prodCats = Array.isArray(S._prodCats) ? S._prodCats : [];
  if(checked){
    if(!S._prodCats.includes(cat)) S._prodCats.push(cat);
  } else {
    S._prodCats = S._prodCats.filter(c=>c!==cat);
  }
  renderProductCategoryUI();
};
window.removeProductCategory = function(cat){
  S._prodCats = (S._prodCats||[]).filter(c=>c!==cat);
  const cb = document.querySelector(`input[data-cat-cb="${cat}"]`);
  if(cb) cb.checked = false;
  renderProductCategoryUI();
};
function renderProductCategoryUI(){
  const pillsBox = document.getElementById('mp-cat-pills');
  const summary  = document.getElementById('mp-cat-summary');
  const sel = S._prodCats||[];
  if (pillsBox) {
    pillsBox.innerHTML = sel.map(c=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--primary);color:#fff;padding:3px 8px;border-radius:12px;font-size:11px;margin:2px;">${c}<button type="button" onclick="removeProductCategory('${c.replace(/'/g,"\\'")}')" style="background:rgba(255,255,255,.3);border:none;color:#fff;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;">×</button></span>`).join('');
  }
  if (summary) {
    summary.innerHTML = sel.length
      ? `<strong>${sel.length} categoria${sel.length===1?'':'s'} selecionada${sel.length===1?'':'s'}</strong>`
      : '<span style="color:var(--muted);font-style:italic;">Clique para escolher</span>';
  }
}
window.renderProductCategoryUI = renderProductCategoryUI;

// Toggle do painel colapsavel de categorias
window.toggleProductCategoryPanel = function(force){
  const panel = document.getElementById('mp-cat-panel');
  if(!panel) return;
  const isOpen = panel.style.display !== 'none';
  const next = (force === true) ? true : (force === false) ? false : !isOpen;
  panel.style.display = next ? 'block' : 'none';
  if (next) {
    setTimeout(()=>document.getElementById('mp-cat-search')?.focus(), 50);
  }
};

// Filtra a lista de categorias por texto digitado
window.filterProductCategories = function(query){
  const q = String(query||'').toLowerCase().trim();
  document.querySelectorAll('#mp-cat-list [data-cat-row]').forEach(el => {
    const txt = el.dataset.catRow || '';
    el.style.display = !q || txt.includes(q) ? '' : 'none';
  });
};

// Desmarca todas
window.clearAllProductCategories = function(){
  S._prodCats = [];
  document.querySelectorAll('#mp-cat-list input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    if (cb.parentElement) cb.parentElement.style.background = 'transparent';
  });
  renderProductCategoryUI();
};

// Fecha o painel ao clicar fora
document.addEventListener('click', (e) => {
  const panel = document.getElementById('mp-cat-panel');
  const toggle = document.getElementById('mp-cat-toggle');
  if (!panel || panel.style.display === 'none') return;
  if (panel.contains(e.target) || toggle?.contains(e.target)) return;
  panel.style.display = 'none';
});

// ── PRODUTOS ─────────────────────────────────────────────────
export function renderProdutos(){
  // Build unique categories list from products
  const catSet = new Set();
  S.products.forEach(p=>{
    const cs = Array.isArray(p.categories)?p.categories:[p.category||p.categoria].filter(Boolean);
    cs.forEach(c=>{ if(c) catSet.add(c); });
  });
  const allCats = Array.from(catSet).sort();

  // Apply filters
  // Pre-compute lowercase search query once (not per product)
  const q = (S._prodSearch||'').toLowerCase().trim();
  const hasQ = q.length > 0;
  const catFilter = S._prodCat || '';
  const statusFilter = S._prodStatus || '';
  const filtered = S.products.filter(p => {
    if (hasQ) {
      const nome = (p.name||p.nome||'').toLowerCase();
      if (nome.indexOf(q) === -1) {
        const sku = String(p.sku||p.code||'').toLowerCase();
        if (sku.indexOf(q) === -1) return false;
      }
    }
    if (catFilter) {
      const cats = Array.isArray(p.categories) ? p.categories : [p.category||p.categoria].filter(Boolean);
      if (!cats.includes(catFilter)) return false;
    }
    if (statusFilter === 'ativo') {
      if (p.activeOnSite === false) return false;
    } else if (statusFilter === 'inativo') {
      if (p.activeOnSite !== false) return false;
    } else if (statusFilter === 'destaque') {
      if (p.destaque !== true) return false;
    } else if (statusFilter === 'lowstock') {
      // ANTES somava estoque + stock (o mesmo numero duas vezes), o que
      // DOBRAVA o total e escondia produtos realmente baixos do filtro.
      const total = getStockTotal(p);
      const min = Number(p.estoqueMinimo||p.minStock||5);
      if (total > min) return false;
    }
    return true;
  });
  // Expose filtered list for export consumers (full filtered list, not paginated)
  S._prodFiltered = filtered;
  const hasFilter = !!(S._prodSearch || S._prodCat || S._prodStatus);
  // Reset paginação ao mudar filtros (evita pagina vazia)
  if (hasFilter && (S._prodPage||1) > Math.ceil(filtered.length/(Number(S._prodPerPage||30))) && filtered.length>0) {
    S._prodPage = 1;
  }

  // Pagination com tamanho selecionavel + navegacao por pagina
  const total = filtered.length;
  const perPage = Math.max(1, Number(S._prodPerPage || 30));
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  let page = Math.max(1, Number(S._prodPage || 1));
  if (page > totalPages) { page = totalPages; S._prodPage = page; }
  const start = (page - 1) * perPage;
  const displayed = filtered.slice(start, start + perPage);
  const limit = perPage; // compat com codigo legado

  return`
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
  <span style="color:var(--muted);font-size:12px">${filtered.length} de ${S.products.length} produtos</span>
  <div style="display:flex;gap:6px;">
    <button class="btn btn-ghost btn-sm" id="btn-rel-prods">🔄</button>
    ${S.user?.role === 'Administrador' ? `
      <button class="btn btn-blue btn-sm" id="btn-import-prod">📥 Importar</button>
      <button class="btn btn-green btn-sm" id="btn-export-prod">📤 Exportar</button>
      <input type="file" id="file-import-prod" accept=".csv,.json" style="display:none" />
    ` : ''}
    <button class="btn btn-primary" id="btn-new-prod">+ Novo Produto</button>
  </div>
</div>
<div class="card">
  <div class="card-title">Catalogo</div>
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
    <div style="flex:1;min-width:220px;position:relative;">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:13px;pointer-events:none;">🔍</span>
      <input type="text" id="prod-search" class="fi" placeholder="Buscar por nome ou código..." value="${esc(S._prodSearch||'')}" style="padding-left:30px;width:100%;"/>
    </div>
    <select id="prod-filter-cat" class="fi" style="min-width:180px;flex:0 0 auto;">
      <option value="">Todas as categorias</option>
      ${allCats.map(c=>`<option value="${esc(c)}" ${S._prodCat===c?'selected':''}>${esc(c)}</option>`).join('')}
    </select>
    <select id="prod-filter-status" class="fi" style="min-width:160px;flex:0 0 auto;">
      <option value="" ${!S._prodStatus?'selected':''}>Todos os status</option>
      <option value="destaque" ${S._prodStatus==='destaque'?'selected':''}>⭐ Em destaque</option>
      <option value="lowstock" ${S._prodStatus==='lowstock'?'selected':''}>⚠️ Estoque baixo</option>
      <option value="archived" ${S._prodStatus==='archived'?'selected':''}>📁 Arquivados</option>
    </select>
    ${hasFilter?`<button class="btn btn-ghost btn-sm" id="btn-clear-filters">✖ Limpar filtros</button>`:''}
  </div>
  ${S.products.length===0?(S.loading ? `
    <div class="card" style="padding:40px 20px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;animation:sp 1.2s linear infinite;display:inline-block;">🌹</div>
      <div style="font-size:14px;font-weight:600;color:var(--muted);">Carregando catálogo de produtos...</div>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;">A primeira carga pode levar alguns segundos.</div>
    </div>
    ${Array.from({length:5}).map(()=>`
      <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--cream);border-radius:8px;margin-top:6px;opacity:.5;">
        <div style="width:40px;height:40px;background:#E5E7EB;border-radius:6px;animation:pulse 1.5s ease-in-out infinite;"></div>
        <div style="flex:1;height:14px;background:#E5E7EB;border-radius:4px;animation:pulse 1.5s ease-in-out infinite;"></div>
      </div>`).join('')}
  ` : `<div class="empty"><div class="empty-icon">🌹</div><p>Sem produtos</p><button class="btn btn-primary" id="btn-new-prod2" style="margin-top:10px">+ Cadastrar Produto</button>
        <button class="btn btn-ghost" style="margin-top:6px;font-size:11px" onclick="recarregarDados()">🔄 Recarregar dados do servidor</button></div>`):filtered.length===0?`<div class="empty"><div class="empty-icon">🔍</div><p>Nenhum produto encontrado com os filtros aplicados</p></div>`:`
  ${(() => {
    // Barra de acoes em massa — aparece quando ha selecionados
    const sel = S._prodSelected instanceof Set ? S._prodSelected : new Set();
    if (sel.size === 0) return '';
    return `<div style="background:linear-gradient(135deg,#FAE8E6,#FEFAF8);border:2px solid #FECDD3;border-radius:12px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div style="font-size:13px;color:#9F1239;font-weight:700;">
        ✓ <strong>${sel.size}</strong> produto${sel.size===1?'':'s'} selecionado${sel.size===1?'':'s'}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-sm" data-bulk="ativar" style="background:#DCFCE7;color:#15803D;border:1px solid #22C55E;">⚡ Ativar selecionados</button>
        <button class="btn btn-sm" data-bulk="desativar" style="background:#FEE2E2;color:#991B1B;border:1px solid #DC2626;">⏻ Desativar selecionados</button>
        <button class="btn btn-sm" data-bulk="destacar" style="background:#FEF3C7;color:#92400E;border:1px solid #F59E0B;">⭐ Destacar</button>
        <button class="btn btn-sm" data-bulk="undestacar" style="background:#fff;color:#92400E;border:1px solid #F59E0B;">☆ Tirar destaque</button>
        <button class="btn btn-sm" data-bulk="estoque" style="background:#DBEAFE;color:#1E40AF;border:1px solid #3B82F6;">📦 Definir estoque</button>
        ${S.user?.role === 'Administrador' ? `<button class="btn btn-sm" data-bulk="excluir" style="background:#7F1D1D;color:#fff;">🗑️ Excluir</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-bulk="clear">✕ Limpar</button>
      </div>
    </div>`;
  })()}
  <!-- TABS de status (estilo pill) -->
  <div style="display:flex;background:#FAF7F5;border-radius:10px;padding:4px;gap:2px;margin-bottom:14px;overflow-x:auto;">
    ${[
      {k:'',         l:'Todos',          c:''},
      {k:'ativo',    l:'● Ativos',       c:'#15803D'},
      {k:'inativo',  l:'● Inativos',     c:'#64748B'},
      {k:'destaque', l:'⭐ Destaques',   c:'#D97706'},
    ].map(t => {
      const active = (S._prodStatus||'') === t.k;
      const count = filtered.length; // contagem com TODOS filtros aplicados (so funciona pra tab atual)
      return `<button data-tab-status="${t.k}" style="flex:1;min-width:120px;padding:10px 14px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:${active?'700':'500'};color:${active?(t.c||'var(--primary)'):'#64748B'};background:${active?'#fff':'transparent'};box-shadow:${active?'0 1px 3px rgba(0,0,0,.06)':'none'};transition:all .2s;">${t.l}</button>`;
    }).join('')}
  </div>

  <div class="tw" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid var(--border);">
  <table style="width:100%;border-collapse:collapse;">
    <thead style="background:#FAFAFA;"><tr style="border-bottom:1px solid var(--border);">
      <th style="width:36px;text-align:center;padding:14px 6px;"><input type="checkbox" id="prod-sel-all" style="cursor:pointer;accent-color:var(--primary);width:16px;height:16px;"/></th>
      <th style="padding:14px 6px;text-align:left;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Capa</th>
      <th style="padding:14px 6px;text-align:left;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Codigo</th>
      <th style="padding:14px 6px;text-align:left;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Nome</th>
      <th style="padding:14px 6px;text-align:center;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Destaque</th>
      <th style="padding:14px 6px;text-align:right;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Custo</th>
      <th style="padding:14px 6px;text-align:right;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Venda</th>
      <th style="padding:14px 6px;text-align:center;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Margem</th>
      <th style="padding:14px 6px;text-align:center;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Estoque</th>
      <th style="padding:14px 6px;text-align:center;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Situacao</th>
      <th style="padding:14px 12px;text-align:right;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Acoes</th>
    </tr></thead>
    <tbody>${displayed.map(p=>{
      const mg=p.salePrice>0?((p.salePrice-(p.costPrice||0))/p.salePrice*100).toFixed(0):0;
      const low=isLowStock(p);
      const codigoProd = p.code || p.sku || '';
      const isSelected = (S._prodSelected instanceof Set) && S._prodSelected.has(p._id);
      const isAtivo = p.activeOnSite !== false; // default true
      const noFeed = p.includeInFeed === false; // default false (= esta no feed)
      const img = p.imagem||p.images?.[0]||p.image||'';
      return `<tr style="border-bottom:1px solid #F1F5F9;${isSelected?'background:#FEF7F5;':''}">
        <td style="text-align:center;padding:10px 6px;"><input type="checkbox" data-prod-sel="${p._id}" ${isSelected?'checked':''} style="cursor:pointer;accent-color:var(--primary);width:16px;height:16px;"/></td>
        <td style="padding:8px 6px;">${img?`<img src="${img}" loading="lazy" decoding="async" style="width:48px;height:48px;border-radius:8px;object-fit:cover;cursor:pointer;border:1px solid #F1F5F9;" onclick="showFullImg('${img}')">`:`<div class="prod-img-placeholder" data-pid="${p._id||''}" style="width:48px;height:48px;border-radius:8px;background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:22px;">${emoji(p.category)}</div>`}</td>
        <td style="padding:10px 6px;font-family:Monaco,monospace;font-size:12px;font-weight:600;color:#7C3AED;">${codigoProd || '-'}</td>
        <td style="padding:10px 6px;">
          <div style="font-weight:500;font-size:13px;color:#1E293B;line-height:1.3;">${p.name}</div>
          ${(p.colors||[]).length ? `<div style="display:flex;gap:3px;margin-top:3px;align-items:center;">${(p.colors||[]).slice(0,5).map(c => `<span title="${c.name}" style="width:11px;height:11px;border-radius:50%;background:${c.hex||'#999'};border:1px solid rgba(0,0,0,.1);display:inline-block;"></span>`).join('')}${p.colors.length > 5 ? `<span style="font-size:9px;color:#94A3B8;">+${p.colors.length-5}</span>` : ''}</div>` : ''}
          ${noFeed ? `<div style="margin-top:3px;display:inline-block;background:#FEF3C7;color:#92400E;border:1px solid #FCD34D;border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:.3px;" title="Produto NAO aparece no catálogo Facebook/Instagram/WhatsApp">📱❌ Fora do catálogo</div>` : ''}
        </td>
        <td style="text-align:center;padding:10px 6px;font-size:12px;color:${p.destaque?'#D97706':'#94A3B8'};font-weight:${p.destaque?'700':'400'};">${p.destaque?'⭐ Sim':'Não'}</td>
        <td style="padding:10px 6px;text-align:right;color:#94A3B8;font-size:12px;">${$c(p.costPrice)}</td>
        <td style="padding:10px 6px;text-align:right;">
          ${(() => {
            const promo = Number(p.promoPrice||0);
            const cheio = Number(p.salePrice||0);
            const now = Date.now();
            const pStart = p.promoStart ? new Date(p.promoStart).getTime() : null;
            const pEnd = p.promoEnd ? new Date(p.promoEnd).getTime() : null;
            const ativo = promo > 0 && promo < cheio && (!pStart || pStart <= now) && (!pEnd || pEnd >= now);
            const pct = ativo ? Math.round(((cheio - promo) / cheio) * 100) : 0;
            return `<div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;">
              <span style="font-size:11px;color:#94A3B8;">R$</span>
              <input type="number" step="0.01" min="0" value="${cheio.toFixed(2)}"
                     data-quick-price="${p._id}" data-orig="${cheio.toFixed(2)}"
                     title="Editar preço de venda (Enter ou clique fora pra salvar)"
                     style="width:90px;padding:5px 7px;border:1px solid transparent;border-radius:6px;font-size:13px;font-weight:${ativo?'500':'700'};color:${ativo?'#94A3B8':'#1E293B'};text-decoration:${ativo?'line-through':'none'};text-align:right;background:#fff;cursor:text;transition:all .15s;"
                     onfocus="this.style.borderColor='#3B82F6';this.style.background='#EFF6FF';"
                     onblur="this.style.borderColor='transparent';this.style.background='#fff';"/>
            </div>
            ${ativo ? `<div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:3px;" title="Promoção${p.promoLabel?': '+p.promoLabel:''}${pEnd?' (até '+new Date(pEnd).toLocaleDateString('pt-BR')+')':''}">
              <span style="background:#FEE2E2;color:#991B1B;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px;">-${pct}%</span>
              <span style="font-size:13px;font-weight:800;color:#DC2626;">${$c(promo)}</span>
            </div>` : ''}`;
          })()}
        </td>
        <td style="padding:10px 6px;text-align:center;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;background:${mg>=50?'#DCFCE7':mg>=30?'#FEF3C7':'#FEE2E2'};color:${mg>=50?'#15803D':mg>=30?'#92400E':'#991B1B'};">${mg}%</span></td>
        <td style="padding:10px 6px;text-align:center;font-size:13px;">
          <div style="font-weight:700;color:${low?'#DC2626':'#1E293B'};">${getStockTotal(p)}</div>
          <div style="font-size:9px;color:var(--muted);white-space:nowrap;">${
            STOCK_UNITS.map(u=>{
              const v = Number(getStockByUnit(p)[u])||0;
              return `${UNIT_LABEL[u]||u}: <strong style="color:${v<=0?'#DC2626':'var(--muted)'}">${v}</strong>`;
            }).join(' · ')
          }</div>
        </td>
        <td style="padding:10px 6px;text-align:center;">${isAtivo?'<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:10px;font-weight:700;background:#DCFCE7;color:#15803D;">● Ativo</span>':'<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:10px;font-weight:700;background:#F3F4F6;color:#64748B;">● Inativo</span>'}</td>
        <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
          <button type="button" data-act="destaque" data-id="${p._id}" title="${p.destaque?'Tirar destaque':'Marcar destaque'}" style="background:${p.destaque?'#FEF3C7':'transparent'};color:${p.destaque?'#D97706':'#94A3B8'};border:none;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;">⭐</button>
          <button type="button" data-act="edit" data-id="${p._id}" title="Editar" style="background:transparent;color:#3B82F6;border:none;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;">✏️</button>
          <button type="button" data-act="stock" data-id="${p._id}" title="Estoque" style="background:transparent;color:#10B981;border:none;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;">📦</button>
          <button type="button" data-act="${isAtivo?'desativar':'ativar'}" data-id="${p._id}" title="${isAtivo?'Desativar (sai do site)':'Ativar (entra no site)'}" style="background:transparent;color:${isAtivo?'#DC2626':'#10B981'};border:none;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;">${isAtivo?'⏻':'⚡'}</button>
          ${S.user?.role === 'Administrador' ? `<button type="button" data-act="delete" data-id="${p._id}" title="Excluir" style="background:transparent;color:#7F1D1D;border:none;width:30px;height:30px;border-radius:6px;cursor:pointer;font-size:14px;">🗑️</button>` : ''}
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  </div>
  ${(() => {
    if (total === 0) return '';
    const pages = [];
    const maxBtns = 7;
    let from = Math.max(1, page - 3), to = Math.min(totalPages, from + maxBtns - 1);
    from = Math.max(1, to - maxBtns + 1);
    for (let i = from; i <= to; i++) pages.push(i);
    return `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:14px 4px 0;border-top:1px solid var(--border);margin-top:8px;">
      <div style="font-size:11px;color:var(--muted);">
        Mostrando <strong>${start+1}–${Math.min(start+perPage,total)}</strong> de <strong>${total}</strong>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:11px;color:var(--muted);">Por página:</span>
        <select id="prod-per-page" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;">
          ${[10,30,50,100].map(n=>`<option value="${n}" ${perPage===n?'selected':''}>${n}</option>`).join('')}
        </select>
        ${page>1?`<button class="btn btn-ghost btn-sm" data-prod-page="${page-1}">‹ Anterior</button>`:''}
        ${pages.map(n=>`<button class="btn btn-sm ${n===page?'btn-primary':'btn-ghost'}" data-prod-page="${n}" ${n===page?'style="font-weight:700;"':''}>${n}</button>`).join('')}
        ${page<totalPages?`<button class="btn btn-ghost btn-sm" data-prod-page="${page+1}">Próxima ›</button>`:''}
      </div>
    </div>`;
  })()}
  `}
</div>`;
}

// ── showNewProductModal ───────────────────────────────────────
export async function showNewProductModal(prod=null){
  console.log('[showNewProductModal] abrindo modal — prod:', prod?._id || 'NOVO');
  const edit = !!prod;
  const cats = getCategorias();
  const tax = prod?.taxation||{};
  const d   = prod?.dimensoes||{};
  const draft = S._prodDraft||{};

  // Fotos do produto (até 3). Ao abrir: edição carrega as existentes, cadastro
  // novo começa vazio. Roda uma vez por abertura do modal.
  if (!edit) S._prodImg = null;
  S._prodImgs = Array.isArray(prod?.images) ? prod.images.filter(Boolean).slice(0,3)
    : (prod?.imagem ? [prod.imagem] : []);

  // Initialize selected categories for multi-select
  S._prodCats = getProductCategories(prod);

  // IMPORTANTE: data-prevent-close no overlay impede que o handler global
  // (main.js _bindModalActions) feche o modal ao detectar cliques. Apenas
  // o botao ✕ ou clique no overlay (mo) explicitamente fecham.
  S._modal=`<div class="mo" id="mo" data-prod-modal="1" onclick="if(event.target===this){if(confirm('Descartar cadastro?')){S._modal='';S._prodDraft=null;S._prodTab=null;S._prodCats=null;S._prodImg=null;S._prodImgs=null;render();}}">
  <div class="mo-box" style="max-width:820px;width:96vw;max-height:92vh;overflow-y:auto;padding:0;" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">

  <!-- Header fixo -->
  <div style="position:sticky;top:0;background:var(--primary);color:#fff;padding:16px 22px;display:flex;align-items:center;justify-content:space-between;z-index:10;">
    <div style="font-family:'Playfair Display',serif;font-size:18px;">${edit?'✏️ Editar Produto':'🌹 Novo Produto'}</div>
    <div style="display:flex;align-items:center;gap:10px;">
      <!-- TOGGLE: Ativar no site (default OFF em produto novo) -->
      <label id="mp-site-toggle-wrap" title="Visivel/comprivel no e-commerce" style="display:flex;align-items:center;gap:8px;background:${edit && prod?.activeOnSite !== false ? 'rgba(34,197,94,.35)' : 'rgba(0,0,0,.35)'};border:1.5px solid ${edit && prod?.activeOnSite !== false ? 'rgba(134,239,172,.85)' : 'rgba(255,255,255,.5)'};color:#fff;padding:6px 12px;border-radius:24px;cursor:pointer;font-size:12px;font-weight:700;user-select:none;transition:all .15s;">
        <span style="position:relative;display:inline-block;width:34px;height:18px;">
          <input type="checkbox" id="mp-site" ${edit && prod?.activeOnSite !== false ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;" onchange="(function(cb){const w=cb.closest('label');const t=w.querySelector('.mp-site-track');const k=w.querySelector('.mp-site-knob');const lbl=w.querySelector('.mp-site-lbl');if(cb.checked){t.style.background='#15803D';k.style.transform='translateX(16px)';lbl.textContent='\ud83d\uded2 Ativo no site';w.style.background='rgba(34,197,94,.35)';w.style.borderColor='rgba(134,239,172,.85)';}else{t.style.background='rgba(0,0,0,.45)';k.style.transform='translateX(0)';lbl.textContent='\ud83d\uded2 Inativo no site';w.style.background='rgba(0,0,0,.35)';w.style.borderColor='rgba(255,255,255,.5)';}})(this);"/>
          <span class="mp-site-track" style="position:absolute;inset:0;background:${edit && prod?.activeOnSite !== false ? '#15803D' : 'rgba(0,0,0,.45)'};border-radius:18px;transition:.18s;"></span>
          <span class="mp-site-knob" style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:transform .18s;transform:translateX(${edit && prod?.activeOnSite !== false ? '16px' : '0'});box-shadow:0 1px 2px rgba(0,0,0,.2);"></span>
        </span>
        <span class="mp-site-lbl" style="color:#fff;">\ud83d\uded2 ${edit && prod?.activeOnSite !== false ? 'Ativo no site' : 'Inativo no site'}</span>
      </label>
      <!-- TOGGLE: Aparece no catalogo Facebook/Instagram/WhatsApp (default ON) -->
      <label id="mp-feed-toggle-wrap" title="Aparece no catalogo Facebook/Instagram/WhatsApp Shopping (XML feed)" style="display:flex;align-items:center;gap:8px;background:${(!edit || prod?.includeInFeed !== false) ? 'rgba(59,130,246,.4)' : 'rgba(0,0,0,.35)'};border:1.5px solid ${(!edit || prod?.includeInFeed !== false) ? 'rgba(147,197,253,.85)' : 'rgba(255,255,255,.5)'};color:#fff;padding:6px 12px;border-radius:24px;cursor:pointer;font-size:12px;font-weight:700;user-select:none;transition:all .15s;">
        <span style="position:relative;display:inline-block;width:34px;height:18px;">
          <input type="checkbox" id="mp-feed" ${(!edit || prod?.includeInFeed !== false) ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;" onchange="(function(cb){const w=cb.closest('label');const t=w.querySelector('.mp-feed-track');const k=w.querySelector('.mp-feed-knob');const lbl=w.querySelector('.mp-feed-lbl');if(cb.checked){t.style.background='#1D4ED8';k.style.transform='translateX(16px)';lbl.textContent='\ud83d\udcf1 No cat\u00e1logo';w.style.background='rgba(59,130,246,.4)';w.style.borderColor='rgba(147,197,253,.85)';}else{t.style.background='rgba(0,0,0,.45)';k.style.transform='translateX(0)';lbl.textContent='\ud83d\udcf1 Fora do cat\u00e1logo';w.style.background='rgba(0,0,0,.35)';w.style.borderColor='rgba(255,255,255,.5)';}})(this);"/>
          <span class="mp-feed-track" style="position:absolute;inset:0;background:${(!edit || prod?.includeInFeed !== false) ? '#1D4ED8' : 'rgba(0,0,0,.45)'};border-radius:18px;transition:.18s;"></span>
          <span class="mp-feed-knob" style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:transform .18s;transform:translateX(${(!edit || prod?.includeInFeed !== false) ? '16px' : '0'});box-shadow:0 1px 2px rgba(0,0,0,.2);"></span>
        </span>
        <span class="mp-feed-lbl" style="color:#fff;">\ud83d\udcf1 ${(!edit || prod?.includeInFeed !== false) ? 'No cat\u00e1logo' : 'Fora do cat\u00e1logo'}</span>
      </label>
      <button onclick="S._modal='';S._prodDraft=null;S._prodTab=null;S._prodCats=null;render();" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">\u2715</button>
    </div>
  </div>

  <div style="padding:22px;">

  <!-- SECAO 1: DADOS PRINCIPAIS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📝 Dados Principais</div>
  <div class="fr2" style="gap:12px;margin-bottom:16px;">
    <div class="fg" style="grid-column:span 2">
      <label class="fl">Nome do Produto *</label>
      <input class="fi" id="mp-name" value="${draft.name||prod?.name||''}" placeholder="Nome completo do produto"/>
    </div>
    <div class="fg" style="grid-column:span 2;position:relative;">
      <label class="fl">Categorias <span style="font-size:9px;color:var(--muted);">(selecione uma ou mais)</span></label>
      <!-- Botao colapsavel: mostra resumo e abre/fecha o painel -->
      <button type="button" id="mp-cat-toggle" onclick="event.preventDefault();toggleProductCategoryPanel();" style="width:100%;text-align:left;padding:9px 12px;background:#fff;border:1px solid var(--border);border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:12px;">
        <span id="mp-cat-summary" style="color:var(--ink2);">${(S._prodCats||[]).length ? `<strong>${(S._prodCats||[]).length} categoria${(S._prodCats||[]).length===1?'':'s'} selecionada${(S._prodCats||[]).length===1?'':'s'}</strong>` : '<span style="color:var(--muted);font-style:italic;">Clique para escolher</span>'}</span>
        <span style="color:var(--muted);font-size:10px;">▼</span>
      </button>
      <!-- Pills das selecionadas (clica no × pra remover) -->
      <div id="mp-cat-pills" style="margin-top:6px;min-height:0;">
        ${(S._prodCats||[]).map(c=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--primary);color:#fff;padding:3px 8px;border-radius:12px;font-size:11px;margin:2px;">${c}<button type="button" onclick="removeProductCategory('${c.replace(/'/g,"\\'")}')" style="background:rgba(255,255,255,.3);border:none;color:#fff;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;padding:0;">×</button></span>`).join('')}
      </div>
      <!-- Painel colapsavel (escondido por padrao) -->
      <div id="mp-cat-panel" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:10;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);padding:8px;margin-top:4px;">
        <input type="text" id="mp-cat-search" placeholder="🔍 Buscar categoria..." oninput="filterProductCategories(this.value)" style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;margin-bottom:6px;"/>
        <div id="mp-cat-list" style="max-height:240px;overflow-y:auto;padding:4px;">
          ${cats.map(c=>`<label data-cat-row="${c.toLowerCase()}" style="display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;font-size:13px;${(S._prodCats||[]).includes(c)?'background:#FAE8E6;':''}" onmouseover="this.style.background='#FFF7F4'" onmouseout="this.style.background='${(S._prodCats||[]).includes(c)?'#FAE8E6':'transparent'}'">
            <input type="checkbox" data-cat-cb="${c}" ${(S._prodCats||[]).includes(c)?'checked':''} onchange="toggleProductCategory('${c.replace(/'/g,"\\'")}', this.checked); this.parentElement.style.background=this.checked?'#FAE8E6':'transparent';" style="width:16px;height:16px;cursor:pointer;accent-color:var(--primary);"/>
            <span>${c}</span>
          </label>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 4px 2px;border-top:1px solid var(--border);margin-top:4px;">
          <button type="button" onclick="event.preventDefault();clearAllProductCategories();" style="background:none;border:none;color:var(--red);font-size:11px;cursor:pointer;">✕ Limpar tudo</button>
          <button type="button" onclick="event.preventDefault();toggleProductCategoryPanel(false);" class="btn btn-primary btn-sm" style="font-size:11px;padding:4px 12px;">✓ Concluir</button>
        </div>
      </div>
    </div>
    <div class="fg">
      <label class="fl">Código do Produto <span style="font-size:9px;color:var(--muted);">(automático — formato LE0001)</span></label>
      <input class="fi" id="mp-code" value="${prod?.code||''}" placeholder="${edit ? '' : '🤖 Gerado pelo sistema ao salvar'}" readonly style="background:#F3F4F6;color:#6B7280;cursor:not-allowed;"/>
    </div>
  </div>

  <!-- SECAO 2: PRECOS -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">💰 Precos</div>
  <div class="fr2" style="gap:12px;margin-bottom:16px;">
    <div class="fg">
      <label class="fl">Custo (R$)</label>
      <input class="fi" type="number" id="mp-cost" value="${draft.cost||prod?.costPrice||''}" min="0" step="0.01" placeholder="0,00"
        oninput="const c=parseFloat(this.value)||0;const m=parseFloat(document.getElementById('mp-margin')?.value)||40;document.getElementById('mp-price').value=(c*(1+m/100)).toFixed(2);"/>
    </div>
    <div class="fg">
      <label class="fl">Margem (%)</label>
      <input class="fi" type="number" id="mp-margin" value="${prod?.margin||40}" min="0" step="1" placeholder="40"
        oninput="const c=parseFloat(document.getElementById('mp-cost')?.value)||0;const m=parseFloat(this.value)||40;document.getElementById('mp-price').value=(c*(1+m/100)).toFixed(2);"/>
    </div>
    <div class="fg">
      <label class="fl">Preco de Venda (R$) *</label>
      <input class="fi" type="number" id="mp-price" value="${draft.price||prod?.salePrice||''}" min="0" step="0.01" placeholder="0,00" style="font-weight:700;color:var(--primary);border-color:var(--primary);" oninput="window._fvCalcPromo&&window._fvCalcPromo()"/>
    </div>
  </div>

  <!-- SECAO 2b: PROMOÇÃO / DESCONTO TEMPORÁRIO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;">🎯 Promoção (opcional)</div>
  <div style="background:linear-gradient(135deg,#FEF3C7,#FFF7ED);border:2px solid #F59E0B;border-radius:10px;padding:12px;margin-bottom:16px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700;color:#78350F;font-size:13px;">
        <input type="checkbox" id="mp-promo-ativa" ${(prod?.promoPrice||0) > 0 ? 'checked' : ''} style="accent-color:#F59E0B;width:18px;height:18px;" onchange="document.getElementById('mp-promo-fields').style.display=this.checked?'block':'none'"/>
        Produto está em promoção
      </label>
      <span style="font-size:11px;color:#9A3412;font-style:italic;">→ exibe "DE / POR" + selo % OFF no site</span>
    </div>
    <div id="mp-promo-fields" style="display:${(prod?.promoPrice||0) > 0 ? 'block' : 'none'};">
      <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-bottom:10px;">
        <div class="fg" style="margin:0;">
          <label class="fl" style="color:#78350F;font-weight:700;">Preço promocional (R$) *</label>
          <input class="fi" type="number" id="mp-promo-price" value="${prod?.promoPrice||''}" min="0" step="0.01" placeholder="0,00" style="font-weight:700;color:#D97706;border:2px solid #FCD34D;font-size:16px;" oninput="window._fvCalcPromo&&window._fvCalcPromo()"/>
        </div>
        <div class="fg" style="margin:0;">
          <label class="fl" style="color:#78350F;">Desconto calculado</label>
          <div id="mp-promo-pct" style="background:#fff;border:2px solid #FCD34D;border-radius:8px;padding:10px;font-weight:800;color:#DC2626;font-size:18px;text-align:center;">—</div>
        </div>
        <div class="fg" style="margin:0;align-self:end;">
          <button type="button" id="mp-promo-clear" style="background:#fff;color:#991B1B;border:1px solid #FCA5A5;border-radius:8px;padding:8px 14px;font-size:11px;cursor:pointer;font-weight:600;">🗑️ Limpar</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px;">
        <div class="fg" style="margin:0;">
          <label class="fl" style="color:#78350F;">Início da promoção <span style="color:var(--muted);font-weight:400;">(opcional)</span></label>
          <input class="fi" type="date" id="mp-promo-start" value="${prod?.promoStart ? new Date(prod.promoStart).toISOString().slice(0,10) : ''}" style="border-color:#FCD34D;"/>
        </div>
        <div class="fg" style="margin:0;">
          <label class="fl" style="color:#78350F;">Fim da promoção <span style="color:var(--muted);font-weight:400;">(opcional)</span></label>
          <input class="fi" type="date" id="mp-promo-end" value="${prod?.promoEnd ? new Date(prod.promoEnd).toISOString().slice(0,10) : ''}" style="border-color:#FCD34D;"/>
        </div>
        <div class="fg" style="margin:0;">
          <label class="fl" style="color:#78350F;">Etiqueta (opcional)</label>
          <input class="fi" type="text" id="mp-promo-label" value="${prod?.promoLabel||''}" placeholder="Dia das Mães, Black Friday..." maxlength="40" style="border-color:#FCD34D;"/>
        </div>
      </div>
      <div style="font-size:10px;color:#92400E;font-style:italic;line-height:1.5;">
        💡 Datas vazias = promoção ativa imediatamente até você desativar.<br/>
        💡 Cliente vê preço cheio riscado + preço promocional + selo "% OFF" + etiqueta no site e PDV.
      </div>
    </div>
  </div>

  <!-- SECAO 3: ESTOQUE (POR UNIDADE) -->
  <!-- Marcia (jul/2026): os estoques das unidades sao INDEPENDENTES, entao o
       cadastro define quanto tem em CADA uma. Antes havia um unico campo de
       total: ele gravava so o total e deixava o saldo por unidade intacto,
       fazendo o total divergir da soma silenciosamente. -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📦 Estoque por unidade</div>
  <div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
    <div style="display:grid;grid-template-columns:repeat(2,1fr) auto;gap:10px;align-items:end;">
      ${[['CDLE','CDLE'],['Loja Novo Aleixo','Novo Aleixo']].map(([chave,rotulo])=>`
      <div class="fg" style="margin-bottom:0;">
        <label class="fl" style="font-size:11px;">${rotulo}</label>
        <input class="fi mp-stock-unit" data-unit="${chave}" type="number" min="0"
               value="${Number((prod?.stockByUnit||{})[chave] || 0)}" style="text-align:right;font-weight:700;"/>
      </div>`).join('')}
      <div style="text-align:center;padding-bottom:8px;min-width:70px;">
        <div style="font-size:10px;color:var(--muted);">Total</div>
        <div id="mp-stock-total" style="font-size:20px;font-weight:900;color:#0369A1;line-height:1.1;">
          ${[ 'CDLE','Loja Novo Aleixo' ].reduce((s,u)=>s+Number((prod?.stockByUnit||{})[u]||0),0)}
        </div>
      </div>
    </div>
    <div style="font-size:10px;color:#0369A1;margin-top:8px;line-height:1.4;">
      O total é a <strong>soma das unidades</strong> — não se digita direto. A venda baixa da unidade que <strong>produz</strong> o pedido: delivery → CDLE · retirada → loja da retirada · balcão → loja da venda.
    </div>
  </div>
  <div class="fr2" style="gap:12px;margin-bottom:16px;">
    <div class="fg">
      <label class="fl">Estoque minimo (alerta)</label>
      <input class="fi" type="number" id="mp-minstk" value="${draft.minstk||prod?.minStock||5}" min="0"/>
    </div>
  </div>

  <!-- SECAO 4: DESCRICAO & PRODUCAO -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📄 Descricao</div>
  <div style="margin-bottom:16px;">
    <div class="fg" style="margin-bottom:10px;">
      <label class="fl">Descricao para o cliente (aparece no site)</label>
      <textarea class="fi" id="mp-desc" rows="3" placeholder="Descreva o produto para o cliente, incluindo detalhes especiais...">${draft.desc||prod?.description||''}</textarea>
    </div>
    <div class="fg">
      <label class="fl">Notas de Producao <span style="font-size:10px;color:var(--muted)">(visivel apenas para o florista)</span></label>
      <textarea class="fi" id="mp-prodnotes" rows="2" placeholder="Como montar, flores utilizadas, cuidados especiais...">${draft.prodnotes||prod?.productionNotes||''}</textarea>
    </div>
  </div>

  <!-- SECAO 5: DIMENSOES -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📐 Dimensoes & Peso</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
    <div class="fg">
      <label class="fl" style="font-size:11px;">Altura (cm)</label>
      <input class="fi" type="number" id="mp-altura" value="${d.altura||''}" min="0" step="0.5" placeholder="0"/>
    </div>
    <div class="fg">
      <label class="fl" style="font-size:11px;">Largura (cm)</label>
      <input class="fi" type="number" id="mp-largura" value="${d.largura||''}" min="0" step="0.5" placeholder="0"/>
    </div>
    <div class="fg">
      <label class="fl" style="font-size:11px;">Profundidade (cm)</label>
      <input class="fi" type="number" id="mp-profundidade" value="${d.profundidade||''}" min="0" step="0.5" placeholder="0"/>
    </div>
    <div class="fg">
      <label class="fl" style="font-size:11px;">Peso (g)</label>
      <input class="fi" type="number" id="mp-peso" value="${d.peso||''}" min="0" step="1" placeholder="0"/>
    </div>
  </div>

  <!-- SECAO 5b: VARIACOES DE COR -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">🎨 Variações — Cores</div>
  <div id="mp-colors-section" style="margin-bottom:16px;background:var(--cream);border-radius:10px;padding:14px;">
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px;line-height:1.5;">
      Adicione as cores disponíveis deste produto. Cada cor aparece como opção no PDV e no e-commerce.
      Você pode incluir um <strong>ajuste de preço</strong> (+/- R$) e <strong>estoque próprio</strong> por cor.
    </div>
    <div id="mp-colors-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>
    <button type="button" id="mp-color-add" style="background:var(--primary);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;">
      ➕ Adicionar Cor
    </button>
  </div>

  <!-- SECAO 6: CONFIGURACOES -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">⚙️ Outras Configurações</div>
  <div style="display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,#EFF6FF,#FAF7F5);border:1px solid #BFDBFE;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#1E40AF;">
    💡 Use o botão <strong>Ativo no site</strong> no topo desta janela para controlar se o produto aparece em <strong>floriculturalacoseternos.com.br</strong>. Por padrão, produtos novos ficam <strong>inativos no site</strong> até você ativar.
  </div>
  <!-- COMBO / ITENS QUE ACOMPANHAM (Marcia jul/2026) ─────────────
       Ex: "Buquê com Barca de Brigadeiros" baixa tambem o estoque da
       barca de brigadeiros ao ser vendido. Usa produtos que JA existem —
       nao precisa cadastrar produto novo. -->
  <div style="margin-bottom:16px;">
    <label class="cb" style="display:inline-flex;margin-bottom:10px;">
      <input type="checkbox" id="mp-composto" ${(draft.composto||prod?.composto)?'checked':''}/>
      <span style="font-size:13px;">🧩 Produto combo — acompanha outros itens</span>
    </label>
    <div id="mp-insumos-box" style="display:${(draft.composto||prod?.composto)?'block':'none'};background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;">
      <div style="font-size:11px;font-weight:800;color:#9A3412;margin-bottom:4px;">🍫 Itens que acompanham este produto</div>
      <div style="font-size:11px;color:#9A3412;opacity:.9;margin-bottom:10px;line-height:1.45;">
        Ao vender 1 deste produto, o estoque dos itens abaixo também é baixado — na mesma unidade que produz o pedido.
        Escolha produtos que <strong>já existem</strong> (ex.: a caixa de brigadeiros). A quantidade é <strong>por unidade vendida</strong>.
      </div>
      <div id="mp-insumos-list"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="btn-add-insumo" style="margin-top:8px;">+ Adicionar item</button>
    </div>
  </div>

  <!-- SECAO 7: FISCAL (colapsavel) -->
  <details style="margin-bottom:16px;">
    <summary style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;cursor:pointer;padding:8px 0;user-select:none;">
      🏛️ Dados Fiscais (NF-e) \u2014 clique para expandir
    </summary>
    <div style="margin-top:12px;padding:14px;background:var(--cream);border-radius:10px;">
      <div class="fr2" style="gap:10px;">
        <div class="fg"><label class="fl">NCM</label><input class="fi" id="mp-ncm" value="${tax.ncm||''}" placeholder="0000.00.00"/></div>
        <div class="fg"><label class="fl">CEST</label><input class="fi" id="mp-cest" value="${tax.cest||''}" placeholder=""/></div>
        <div class="fg"><label class="fl">CFOP</label>
          <select class="fi" id="mp-cfop">
            ${['5102','5405','6102','5910','outro'].map(v=>`<option ${tax.cfop===v?'selected':''} value="${v}">${v==='outro'?'Outro (manual)':v}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label class="fl">CFOP manual</label><input class="fi" id="mp-cfop-manual" value="${tax.cfop&&!['5102','5405','6102','5910'].includes(tax.cfop)?tax.cfop:''}" placeholder="Apenas se 'Outro'"/></div>
        <div class="fg"><label class="fl">Origem</label>
          <select class="fi" id="mp-origin">
            ${['0','1','2','3','4','5','6','7','8'].map(v=>`<option ${(tax.origin||'0')===v?'selected':''} value="${v}">${v} - ${['Nacional','Estrangeira-importacao direta','Estrangeira-mercado interno','Nacional c/ >40% de conteudo estrangeiro','Nacional producao conf. proc. basico','Nacional c/ importacao conf. resolucao CAMEX','Estrangeira-importacao direta, sem similar nacional','Estrangeira-mercado interno, sem similar nacional','Nacional com importacao de qualquer origem'][parseInt(v)]}</option>`).join('')}
          </select>
        </div>
        <div class="fg"><label class="fl">CSOSN / CST ICMS</label><input class="fi" id="mp-csosn" value="${tax.csosn||''}" placeholder="102"/></div>
        <div class="fg"><label class="fl">CST PIS/COFINS</label><input class="fi" id="mp-cst-pis" value="${tax.cstPis||''}" placeholder="07"/></div>
        <div class="fg"><label class="fl">Un. Comercial</label><input class="fi" id="mp-unit-com" value="${tax.unitCom||'UN'}" placeholder="UN"/></div>
        <div class="fg"><label class="fl">Un. Tributavel</label><input class="fi" id="mp-unit-trib" value="${tax.unitTrib||'UN'}" placeholder="UN"/></div>
        <div class="fg"><label class="fl">% ICMS</label><input class="fi" type="number" id="mp-icms" value="${tax.icms||0}" min="0" step="0.01"/></div>
        <div class="fg"><label class="fl">% PIS</label><input class="fi" type="number" id="mp-pis" value="${tax.pis||0}" min="0" step="0.01"/></div>
        <div class="fg"><label class="fl">% COFINS</label><input class="fi" type="number" id="mp-cofins" value="${tax.cofins||0}" min="0" step="0.01"/></div>
      </div>
    </div>
  </details>

  <!-- FOTOS (até 3) -->
  <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;">📷 Fotos do Produto <span style="color:var(--rose);">(até 3)</span></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;" id="mp-fotos-wrap">
    ${[0,1,2].map(i=>{
      const src = (S._prodImgs && S._prodImgs[i]) || '';
      return `<div style="text-align:center;">
        <div id="prod-img-slot-${i}" onclick="document.getElementById('mp-img-file-${i}').click()" title="${i===0?'Foto principal':'Foto '+(i+1)}"
          style="position:relative;width:100px;height:100px;border-radius:10px;border:2px ${src?'solid':'dashed'} var(--border);cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--cream);">
          ${src
            ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;"/><span onclick="event.stopPropagation();window._removeProdFoto&&window._removeProdFoto(${i})" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.6);color:#fff;width:20px;height:20px;border-radius:50%;font-size:12px;display:flex;align-items:center;justify-content:center;">✕</span>`
            : `<span style="font-size:26px;color:var(--muted);">${i===0?'🌸':'➕'}</span>`}
        </div>
        <input type="file" id="mp-img-file-${i}" accept="image/*" style="display:none"/>
        <div style="font-size:9px;color:var(--muted);margin-top:3px;">${i===0?'principal':'foto '+(i+1)}</div>
      </div>`;
    }).join('')}
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:20px;">JPG ou PNG. A 1ª foto é a principal (aparece na lista e no site). Toque num quadro pra adicionar/trocar.</div>

  <!-- BOTOES -->
  <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid var(--border);">
    <button class="btn btn-ghost" id="btn-mp-cancel">Cancelar</button>
    <button class="btn btn-primary" id="btn-mp-save" style="padding:11px 32px;font-size:15px;">
      💾 ${edit?'Atualizar Produto':'Cadastrar Produto'}
    </button>
  </div>

  </div></div></div>`;

  await render();

  // ── Cancelar ──────────────────────────────────────────────
  document.getElementById('btn-mp-cancel')?.addEventListener('click',()=>{
    S._modal=''; S._prodDraft=null; S._prodTab=null; S._prodCats=null; render();
  });

  // ── COMBO: itens que acompanham (insumos) ────────────────────
  // Monta as linhas via DOM (evita HTML injection) no formato que o
  // collectInsumos() ja espera: [data-insumo-row] > [data-insumo-id] + [data-insumo-qty].
  const _insumoOptions = (selId) => (S.products||[])
    .filter(x => String(x._id) !== String(prod?._id || ''))
    .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR'))
    .map(x => `<option value="${x._id}" ${String(x._id)===String(selId||'')?'selected':''}>${esc(x.name||'')}</option>`)
    .join('');

  const _addInsumoRow = (data = {}) => {
    const list = document.getElementById('mp-insumos-list');
    if (!list) return;
    const row = document.createElement('div');
    row.setAttribute('data-insumo-row', '');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 90px 34px;gap:8px;align-items:center;margin-bottom:6px;';
    row.innerHTML = `
      <select class="fi" data-insumo-id style="font-size:12px;">
        <option value="">— escolha o produto —</option>
        ${_insumoOptions(data.productId)}
      </select>
      <input class="fi" data-insumo-qty type="number" min="0" step="1" value="${Number(data.qty)||1}"
             style="text-align:right;font-weight:700;" title="Quantidade baixada por unidade vendida"/>
      <button type="button" class="btn btn-ghost btn-xs" data-insumo-del title="Remover item">✕</button>`;
    row.querySelector('[data-insumo-del]').onclick = () => row.remove();
    list.appendChild(row);
  };

  // Carrega os itens ja cadastrados no produto
  (Array.isArray(prod?.insumos) ? prod.insumos : []).forEach(it => _addInsumoRow(it));

  document.getElementById('btn-add-insumo')?.addEventListener('click', () => _addInsumoRow());
  document.getElementById('mp-composto')?.addEventListener('change', e => {
    const box = document.getElementById('mp-insumos-box');
    if (box) box.style.display = e.target.checked ? 'block' : 'none';
    // Ao marcar pela primeira vez, ja abre uma linha pronta pra preencher
    if (e.target.checked && !document.querySelector('[data-insumo-row]')) _addInsumoRow();
  });

  // ── Total do estoque = soma das unidades (ao vivo) ────────────
  const _recalcStockTotal = () => {
    let t = 0;
    document.querySelectorAll('.mp-stock-unit').forEach(i => { t += Math.max(0, parseInt(i.value) || 0); });
    const el = document.getElementById('mp-stock-total');
    if (el) el.textContent = t;
  };
  document.querySelectorAll('.mp-stock-unit').forEach(i => i.addEventListener('input', _recalcStockTotal));

  // ── Upload de imagem (com redimensionamento) ──────────────────
  // Antes: imagem original era convertida pra base64 direto (10MB foto
  // do celular = 13MB de JSON → Mongo time out).
  // Agora: redimensiona pra max 1400px de largura + JPEG 85% qualidade
  // → fica em torno de 150-400KB. Mongo grava em <100ms.
  const _refreshFotoSlot = (i) => {
    const slot = document.getElementById('prod-img-slot-'+i);
    if (!slot) return;
    const src = (S._prodImgs && S._prodImgs[i]) || '';
    slot.style.borderStyle = src ? 'solid' : 'dashed';
    slot.innerHTML = src
      ? `<img src="${src}" style="width:100%;height:100%;object-fit:cover;"/><span onclick="event.stopPropagation();window._removeProdFoto&&window._removeProdFoto(${i})" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,.6);color:#fff;width:20px;height:20px;border-radius:50%;font-size:12px;display:flex;align-items:center;justify-content:center;">✕</span>`
      : `<span style="font-size:26px;color:var(--muted);">${i===0?'🌸':'➕'}</span>`;
  };
  window._removeProdFoto = (i) => {
    if (!Array.isArray(S._prodImgs)) return;
    S._prodImgs.splice(i, 1);            // remove e reindexa (as demais sobem)
    for (let k=0;k<3;k++) _refreshFotoSlot(k);
    // Mantem _prodImg (foto principal) em sincronia para compatibilidade
    S._prodImg = S._prodImgs[0] || null;
  };
  [0,1,2].forEach(i => {
    document.getElementById('mp-img-file-'+i)?.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        toast('🖼️ Otimizando imagem...');
        const b64 = await resizeImageToBase64(file, 1400, 0.85);
        if (!Array.isArray(S._prodImgs)) S._prodImgs = [];
        // Preenche sem deixar buracos: se clicar num slot além do fim, adiciona no fim
        const idx = Math.min(i, S._prodImgs.length);
        S._prodImgs[idx] = b64;
        S._prodImg = S._prodImgs[0] || null; // foto principal (compat)
        for (let k=0;k<3;k++) _refreshFotoSlot(k);
        const sizeKB = Math.round(b64.length * 0.75 / 1024);
        toast(`✅ Foto otimizada (${sizeKB}KB)`);
      } catch (err) {
        console.error('[saveProduct] resize falhou:', err);
        toast('❌ Erro ao processar imagem: ' + err.message, true);
      }
      e.target.value = ''; // permite re-selecionar o mesmo arquivo
    });
  });

  // ── Variacoes de cor: helpers DOM-only (evita HTML injection) ─
  const _addColorRow = (data = {}) => {
    const list = document.getElementById('mp-colors-list');
    if (!list) return;
    const row = document.createElement('div');
    row.setAttribute('data-color-row', '');
    row.style.cssText = 'display:grid;grid-template-columns:48px 36px 1fr 110px 100px 32px;gap:8px;align-items:center;padding:6px 8px;background:#fff;border-radius:8px;border:1px solid var(--border);';

    // ── Foto da cor (thumbnail clicavel) ─────────────────────────
    // Usuario clica no thumbnail para abrir seletor de arquivo.
    // base64 fica armazenado em dataset.colorImage (lido em collectColors)
    const imgWrap = document.createElement('label');
    imgWrap.style.cssText = 'width:48px;height:48px;border:2px dashed var(--border);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#FAF7F5;font-size:18px;color:var(--muted);position:relative;';
    imgWrap.title = 'Clique para escolher foto desta cor';
    if (data.image || data.imagem) {
      imgWrap.style.borderStyle = 'solid';
      imgWrap.innerHTML = `<img src="${data.image || data.imagem}" style="width:100%;height:100%;object-fit:cover;"/>`;
    } else {
      imgWrap.textContent = '📷';
    }
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.dataset.colorImage = '';
    // armazena base64 atual em data attribute (lido em collectColors)
    fileInput.setAttribute('data-color-image-base64', data.image || data.imagem || '');
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      // Redimensiona ANTES de salvar (mesmo flow da imagem principal)
      try {
        const b64 = await resizeImageToBase64(f, 1000, 0.85);
        fileInput.setAttribute('data-color-image-base64', b64);
        imgWrap.style.borderStyle = 'solid';
        imgWrap.innerHTML = '';
        const im = document.createElement('img');
        im.src = b64;
        im.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        imgWrap.appendChild(im);
        imgWrap.appendChild(fileInput);
      } catch (err) {
        alert('Erro ao processar imagem da cor: ' + err.message);
        e.target.value = '';
      }
    });
    fileInput.addEventListener('click', e => e.stopPropagation());
    imgWrap.appendChild(fileInput);
    imgWrap.addEventListener('click', e => e.stopPropagation());

    // Color picker
    const ihex = document.createElement('input');
    ihex.type = 'color'; ihex.value = data.hex || '#FF6FA8';
    ihex.dataset.colorHex = '';
    ihex.style.cssText = 'width:32px;height:32px;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:0;';
    // CRITICO: evita que o click bubble alcance handlers de cima
    ihex.addEventListener('click', e => e.stopPropagation());

    // Nome
    const inome = document.createElement('input');
    inome.type = 'text'; inome.placeholder = 'Nome (ex: Rosa Pink)';
    inome.value = data.name || data.nome || '';
    inome.dataset.colorName = '';
    inome.style.cssText = 'padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;';

    // Preço da variação (PREÇO CHEIO, não acréscimo)
    const ipreco = document.createElement('input');
    ipreco.type = 'number'; ipreco.step = '0.01';
    ipreco.placeholder = 'Preço cheio'; ipreco.value = data.priceAdjust ?? 0;
    ipreco.title = 'Preço CHEIO desta variação (não é acréscimo). Deixe 0 para usar o preço-base do produto.';
    ipreco.dataset.colorPrice = '';
    ipreco.style.cssText = 'padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:right;';

    // Estoque
    const istk = document.createElement('input');
    istk.type = 'number'; istk.min = '0';
    istk.placeholder = 'Estoque'; istk.value = data.stock ?? 0;
    istk.title = 'Estoque desta variação';
    istk.dataset.colorStock = '';
    istk.style.cssText = 'padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;text-align:right;';

    // Botao remover
    const brm = document.createElement('button');
    brm.type = 'button'; brm.textContent = '×';
    brm.style.cssText = 'background:rgba(220,38,38,.1);color:var(--red);border:1px solid rgba(220,38,38,.3);border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:14px;line-height:1;';
    brm.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.remove();
    });

    row.append(imgWrap, ihex, inome, ipreco, istk, brm);
    // Stop propagation no row inteiro pra blindar contra fechamento do modal
    row.addEventListener('click', e => e.stopPropagation());
    list.appendChild(row);
    return row;
  };

  // Popula linhas existentes (modo edicao)
  (prod?.colors || []).forEach(c => _addColorRow(c));

  // Botao adicionar
  document.getElementById('mp-color-add')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const row = _addColorRow();
    row?.querySelector('[data-color-name]')?.focus();
  });

  // ── PROMOÇÃO: cálculo de % desconto em tempo real ────────
  window._fvCalcPromo = () => {
    const price = parseFloat(document.getElementById('mp-price')?.value) || 0;
    const promo = parseFloat(document.getElementById('mp-promo-price')?.value) || 0;
    const el = document.getElementById('mp-promo-pct');
    if (!el) return;
    if (price > 0 && promo > 0 && promo < price) {
      const pct = Math.round(((price - promo) / price) * 100);
      el.innerHTML = `−${pct}% OFF`;
      el.style.background = '#FEE2E2';
      el.style.color = '#991B1B';
    } else if (promo >= price && price > 0) {
      el.innerHTML = '⚠️ ≥ preço';
      el.style.background = '#FEF3C7';
      el.style.color = '#92400E';
    } else {
      el.innerHTML = '—';
      el.style.background = '#fff';
      el.style.color = '#9CA3AF';
    }
  };
  // Calcula uma vez ao abrir o modal
  setTimeout(() => window._fvCalcPromo && window._fvCalcPromo(), 100);

  // Botão "Limpar promoção"
  document.getElementById('mp-promo-clear')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('mp-promo-price').value = '';
    document.getElementById('mp-promo-start').value = '';
    document.getElementById('mp-promo-end').value = '';
    document.getElementById('mp-promo-label').value = '';
    document.getElementById('mp-promo-ativa').checked = false;
    document.getElementById('mp-promo-fields').style.display = 'none';
    window._fvCalcPromo && window._fvCalcPromo();
  });

  // ── Salvar ────────────────────────────────────────────────
  document.getElementById('btn-mp-save')?.addEventListener('click',()=>{
    saveProduct(prod?._id||null, prod?.code||null);
  });
}

// Helper: le todas as linhas de variacao de cor do form
function collectColors(){
  const rows = document.querySelectorAll('#mp-colors-list [data-color-row]');
  const colors = [];
  rows.forEach(r => {
    const name = r.querySelector('[data-color-name]')?.value?.trim();
    if (!name) return; // ignora linha sem nome
    const imgInput = r.querySelector('[data-color-image]');
    const image = imgInput?.getAttribute('data-color-image-base64') || '';
    colors.push({
      name,
      hex: r.querySelector('[data-color-hex]')?.value || '#FF6FA8',
      priceAdjust: parseFloat(r.querySelector('[data-color-price]')?.value) || 0,
      stock: parseInt(r.querySelector('[data-color-stock]')?.value) || 0,
      image: image || undefined,
    });
  });
  return colors;
}

// ── saveProduct ──────────────────────────────────────────────
export async function saveProduct(editId=null, prodCode=null){
  const nameRaw=document.getElementById('mp-name')?.value?.trim();
  const name=normalizeName(nameRaw);
  if(!name) return toast('🚨 Nome do produto é obrigatório', true);

  // Validacao adicional: categoria e preco (backend exige)
  const selCats = Array.isArray(S._prodCats) ? S._prodCats : [];
  if (selCats.length === 0) {
    return toast('🚨 Selecione pelo menos uma categoria', true);
  }
  const precoVenda = parseFloat(document.getElementById('mp-price')?.value) || 0;
  if (precoVenda <= 0) {
    return toast('🚨 Preço de venda é obrigatório (maior que 0)', true);
  }

  // Le CFOP (select ou manual)
  const cfopSel = document.getElementById('mp-cfop')?.value||'';
  const cfopManual = document.getElementById('mp-cfop-manual')?.value?.trim()||'';
  const cfop = cfopSel==='outro' ? cfopManual : cfopSel;

  const taxation = {
    ncm:     document.getElementById('mp-ncm')?.value?.replace(/\s/g,'')||'',
    cfop,
    cest:    document.getElementById('mp-cest')?.value||'',
    csosn:   document.getElementById('mp-csosn')?.value||'',
    cst:     document.getElementById('mp-cst')?.value||'',
    cstPis:  document.getElementById('mp-cst-pis')?.value||'',
    origin:  document.getElementById('mp-origin')?.value||'0',
    icms:    parseFloat(document.getElementById('mp-icms')?.value)||0,
    pis:     parseFloat(document.getElementById('mp-pis')?.value)||0,
    cofins:  parseFloat(document.getElementById('mp-cofins')?.value)||0,
    unitCom: document.getElementById('mp-unit-com')?.value||'UN',
    unitTrib:document.getElementById('mp-unit-trib')?.value||'UN',
  };

  // Insumos
  const composto = document.getElementById('mp-composto')?.checked ||
                   document.getElementById('mp-composto2')?.checked ||
                   false;
  const insumos = collectInsumos();

  const selectedCats = Array.isArray(S._prodCats) ? S._prodCats.slice() : [];
  const data={
    name, nome: name, code: prodCode, sku: prodCode,
    categories:    selectedCats,
    category:      selectedCats[0] || '',
    costPrice:     parseFloat(document.getElementById('mp-cost')?.value)||0,
    salePrice:     parseFloat(document.getElementById('mp-price')?.value)||0,
    // ── PROMOÇÃO TEMPORÁRIA ──
    // Se checkbox desmarcada, zera tudo (= sem promo)
    promoPrice: (document.getElementById('mp-promo-ativa')?.checked)
                  ? (parseFloat(document.getElementById('mp-promo-price')?.value)||0)
                  : 0,
    promoStart: (document.getElementById('mp-promo-ativa')?.checked && document.getElementById('mp-promo-start')?.value)
                  ? document.getElementById('mp-promo-start').value
                  : null,
    promoEnd:   (document.getElementById('mp-promo-ativa')?.checked && document.getElementById('mp-promo-end')?.value)
                  ? document.getElementById('mp-promo-end').value
                  : null,
    promoLabel: (document.getElementById('mp-promo-ativa')?.checked)
                  ? (document.getElementById('mp-promo-label')?.value || '').trim()
                  : '',
    // Estoque POR UNIDADE + total coerente (soma). Marcia (jul/2026): antes
    // ia so o total, que ficava divergindo do saldo por unidade porque o
    // backend usa findByIdAndUpdate (o hook que recalcula nao roda).
    ...(() => {
      const sbu = { 'CDLE':0, 'Loja Novo Aleixo':0 };
      document.querySelectorAll('.mp-stock-unit').forEach(inp => {
        const u = inp.dataset.unit;
        if (u in sbu) sbu[u] = Math.max(0, parseInt(inp.value) || 0);
      });
      const total = Object.values(sbu).reduce((s,v) => s + v, 0);
      return { stockByUnit: sbu, estoque: total, stock: total };
    })(),
    minStock:      parseInt(document.getElementById('mp-minstk')?.value)||5,
    description:   document.getElementById('mp-desc')?.value||'',
    productionNotes:document.getElementById('mp-prodnotes')?.value||'',
    activeOnSite:  document.getElementById('mp-site')?.checked||false,
    // Toggle catalogo Facebook/Instagram/WhatsApp (default true em novo produto)
    includeInFeed: document.getElementById('mp-feed') ? !!document.getElementById('mp-feed').checked : true,
    dimensoes: {
      altura:       parseFloat(document.getElementById('mp-altura')?.value)||0,
      largura:      parseFloat(document.getElementById('mp-largura')?.value)||0,
      profundidade: parseFloat(document.getElementById('mp-profundidade')?.value)||0,
      peso:         parseFloat(document.getElementById('mp-peso')?.value)||0,
    },
    composto,
    insumos:       composto ? insumos : [],
    colors:        collectColors(),
    taxation,
    unit: 'Todas',
  };
  // Anexa fotos (até 3). Valida o tamanho de cada uma (base64 ≈ 1.37x o arquivo).
  const _fotos = (S._prodImgs || []).filter(Boolean).slice(0, 3);
  if (_fotos.length) {
    for (const im of _fotos) {
      const sizeKB = Math.ceil(im.length * 0.75 / 1024);
      if (sizeKB > 3500) {
        return toast(`🚨 Uma das fotos é muito grande (${(sizeKB/1024).toFixed(1)}MB). Use fotos com menos de 3MB.`, true);
      }
    }
    data.images = _fotos;
    data.imagem = _fotos[0]; // schema PT-BR (foto principal)
  }

  // UX: NAO fecha modal antes de confirmar o save. Bloqueia botao e
  // mostra estado de carregamento. Se der erro, modal fica aberto pra
  // a usuaria corrigir e tentar de novo (antes a tela 'sumia' e o
  // produto se perdia silenciosamente).
  const btnSave = document.getElementById('btn-mp-save');
  const originalBtnHtml = btnSave?.innerHTML;
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.innerHTML = '⏳ Salvando...';
  }

  try{
    let p;
    if(editId){
      // Tenta PUT. Se der 404 (id local nao existe no backend) ou 400
      // (id invalido), faz fallback automatico para POST e cria novo.
      try {
        p = await PUT('/products/'+editId, data);
        S.products = S.products.map(x=>x._id===editId?{...x,...data,...(p||{})}:x);
      } catch (eUpd) {
        const msg = String(eUpd?.message || eUpd?.error || '');
        const is404 = msg.includes('404') || msg.toLowerCase().includes('não encontrado') || msg.toLowerCase().includes('not found');
        const is400Cast = msg.includes('400') || msg.toLowerCase().includes('cast') || msg.toLowerCase().includes('inválido');
        if (is404 || is400Cast) {
          console.warn('[saveProduct] PUT '+editId+' falhou ('+msg+'). Fallback para POST (criar novo).');
          p = await POST('/products', data);
          if (p?._id) {
            // Substitui o item local pelo recem-criado
            S.products = S.products.map(x => x._id===editId ? p : x);
            // Se nao tinha no array, adiciona
            if (!S.products.some(x => x._id === p._id)) S.products.unshift(p);
          }
        } else {
          throw eUpd; // outros erros sobem para o catch externo
        }
      }
    } else {
      p = await POST('/products', data);
      if(p?._id) S.products.unshift(p);
    }
    // SUCESSO: agora sim fecha o modal e limpa o estado
    S._modal=''; S._prodImg=null; S._prodImgs=null; S._prodTab=null; S._prodDraft=null; S._prodCats=null;
    saveCachedData();
    try{ render(); }catch(e){}
    toast(editId?'✅ Produto atualizado com sucesso!':'✅ Produto cadastrado com sucesso!');
  }catch(e){
    console.error('[saveProduct] erro completo:', e);
    // Erro: NAO fecha o modal — usuaria pode corrigir.
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = originalBtnHtml || ('💾 ' + (editId ? 'Atualizar Produto' : 'Cadastrar Produto'));
    }
    // Tenta extrair mensagem ESPECIFICA do erro
    let msg = '';
    if (typeof e === 'string') msg = e;
    else if (e?.error) msg = e.error;
    else if (e?.message) msg = e.message;
    else msg = 'Verifique os dados e tente novamente.';
    // Detalhes de validacao do backend (campo: motivo)
    if (e?.details && typeof e.details === 'object') {
      const det = Object.entries(e.details)
        .map(([k,v]) => `${k}: ${v}`).join(' · ');
      if (det) msg += ' (' + det + ')';
    }
    // Traducoes amigaveis para erros HTTP comuns
    if (msg.includes('413') || msg.toLowerCase().includes('payload too large') || msg.toLowerCase().includes('entity too large')) {
      msg = '🖼️ Imagem muito grande. Use foto com menos de 3MB.';
    } else if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('failed to fetch')) {
      msg = '📡 Sem conexão com o servidor. Verifique sua internet.';
    } else if (msg.toLowerCase().includes('timeout')) {
      msg = '⏱️ Servidor demorou para responder. Tente novamente.';
    } else if (msg.includes('404') || msg.toLowerCase().includes('não encontrado')) {
      msg = '🔍 Produto não encontrado no servidor. Recarregue a página (F5) e tente novamente.';
    } else if (msg.includes('SESSAO_EXPIRADA') || msg.toLowerCase().includes('sessão expirada')) {
      msg = '🔐 Sessão expirada. Saia e entre novamente para continuar.';
    }
    toast('🚨 Erro: ' + msg, true);
  }
}

// ── deleteProduct ────────────────────────────────────────────
export async function deleteProduct(id){
  const p=S.products.find(x=>x._id===id); if(!p) return;
  // Validacao de exclusao: admin direto, demais com senha 2233
  const { autorizaExclusao } = await import('../utils/helpers.js');
  if (!autorizaExclusao('produto')) return;
  window._delProductId=id;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:360px;text-align:center;" onclick="event.stopPropagation()">
  <div style="font-size:40px;margin-bottom:10px">⚠️</div>
  <div style="font-family:'Playfair Display',serif;font-size:17px;margin-bottom:6px">Excluir Produto?</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:18px;"><strong>${p.name}</strong></div>
  <div style="display:flex;gap:8px;justify-content:center;">
    <button class="btn btn-red" onclick="confirmDeleteProduct()" style="padding:10px 20px;">🗑️ Excluir</button>
    <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
  </div></div></div>`;
  render();
}

// ── confirmDeleteProduct ─────────────────────────────────────
export function confirmDeleteProduct(){
  const id=window._delProductId; if(!id) return;
  const p=S.products.find(x=>x._id===id);
  DELETE('/products/'+id).then(()=>{
    S.products=S.products.filter(x=>x._id!==id);
    invalidateCache('products'); // produto excluido -- invalida cache
    S._modal=''; window._delProductId=null; render();
    toast('🗑️ '+(p?.name||'Produto')+' excluido');
  }).catch(e=>toast('❌ Erro: '+e.message,true));
}

// ── saveStockFromModal ───────────────────────────────────────
function saveStockFromModal(){
  const type = document.getElementById('st-type')?.value||'add';
  const qty  = parseInt(document.getElementById('st-qty')?.value)||0;
  const note = document.getElementById('st-reason')?.value||'';
  const unit = document.getElementById('st-unit')?.value||'CDLE';
  if(!qty||qty<1) return toast('❌ Quantidade invalida',true);
  const pid = window._stockModalProdId; if(!pid) return;
  const p = S.products.find(x=>x._id===pid); if(!p) return;

  // Marcia (jul/2026): o ajuste e SEMPRE por unidade — os estoques de CDLE
  // e das lojas sao independentes. Antes gravava so o total, que passava a
  // divergir da soma por unidade (o backend usa findByIdAndUpdate, entao o
  // hook que recalcula o total nao roda). Aqui mandamos tudo coerente.
  const UNITS = ['CDLE','Loja Novo Aleixo'];
  const sbu = { 'CDLE':0, 'Loja Novo Aleixo':0, ...(p.stockByUnit||{}) };
  UNITS.forEach(u => { sbu[u] = Math.max(0, Number(sbu[u])||0); });
  const antes = sbu[unit] || 0;
  sbu[unit] = type==='set' ? Math.max(0, qty)
            : type==='sub' ? Math.max(0, antes - qty)
            : antes + qty;
  const total = UNITS.reduce((s,u)=>s+(Number(sbu[u])||0),0);

  PATCH('/products/'+pid, { stockByUnit: sbu, estoque: total, stock: total }).then(()=>{
    S.products=S.products.map(x=>x._id===pid?{...x, stockByUnit:sbu, estoque:total, stock:total}:x);
    try{ invalidateCache && invalidateCache('products'); }catch(e){}
    // Registra no historico como 'Ajuste': o saldo JA foi gravado acima pelo
    // PATCH — se mandasse Entrada/Saida, o backend aplicaria de novo e
    // dobraria o movimento.
    const opLabel = type==='set' ? 'Definir saldo' : type==='sub' ? 'Saída' : 'Entrada';
    POST('/stock/moves',{
      productId:pid, productName:p.name, type:'Ajuste', quantity:qty, unit,
      reason: `${opLabel}${note ? ' — '+note : ''} (${antes} → ${sbu[unit]})`,
      date:new Date().toISOString(),
    }).catch(()=>{});
    S._modal=''; render();
    toast(`✅ ${unit}: ${antes} → ${sbu[unit]} (total ${total})`);
  }).catch(e=>toast('❌ '+e.message,true));
}

// ── showProductStockModal ────────────────────────────────────
export async function showProductStockModal(prodId){
  const p = S.products.find(x=>x._id===prodId);
  if(!p) return;
  window._stockModalProdId = prodId;
  S._modal=`<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:420px;" onclick="event.stopPropagation()">
  <div style="font-family:'Playfair Display',serif;font-size:18px;margin-bottom:4px;">📦 Ajustar Estoque</div>
  <div style="font-size:12px;color:var(--muted);margin-bottom:16px;">${p.name}</div>

  <div style="background:var(--cream);border-radius:10px;padding:14px;margin-bottom:12px;">
    <div style="font-size:11px;color:var(--muted);margin-bottom:6px;text-align:center;">Saldo atual por unidade</div>
    <div style="display:flex;gap:8px;justify-content:center;">
      ${[['CDLE','CDLE'],['Loja Novo Aleixo','N. Aleixo']].map(([k,r])=>`
        <div style="text-align:center;flex:1;">
          <div style="font-size:10px;color:var(--muted)">${r}</div>
          <div style="font-size:22px;font-weight:800;color:var(--ink)">${Number((p.stockByUnit||{})[k]||0)}</div>
        </div>`).join('')}
    </div>
    <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:6px;">m\u00ednimo: ${p.minStock||5}</div>
  </div>

  <div class="fr2">
    <div class="fg" style="grid-column:span 2"><label class="fl">Unidade *</label>
      <select class="fi" id="st-unit">
        ${['CDLE','Loja Novo Aleixo'].map(u=>`<option value="${u}" ${String(S.user?.unit||'')===u?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
    <div class="fg"><label class="fl">Tipo de lancamento</label>
      <select class="fi" id="st-type">
        <option value="add">➕ Entrada</option>
        <option value="sub">➖ Saida</option>
        <option value="set">🔄 Definir saldo</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Quantidade</label>
      <input class="fi" type="number" id="st-qty" min="1" value="1" placeholder="0"/>
    </div>
    <div class="fg" style="grid-column:span 2"><label class="fl">Motivo (opcional)</label>
      <input class="fi" id="st-reason" placeholder="Ex: Compra fornecedor, Inventario..."/>
    </div>
  </div>

  <div class="mo-foot">
    <button class="btn btn-primary" onclick="saveStockFromModal()" style="flex:1;justify-content:center;">💾 Salvar</button>
    <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
  </div>
  </div></div>`;
  await render();

  document.getElementById('btn-st-save')?.addEventListener('click',async()=>{
    const type   = document.getElementById('st-type')?.value;
    const qty    = parseInt(document.getElementById('st-qty')?.value)||0;
    const reason = document.getElementById('st-reason')?.value?.trim()||'';
    if(!qty||qty<=0) return toast('❌ Informe uma quantidade valida');

    let newStock = p.stock||0;
    if(type==='add') newStock += qty;
    else if(type==='sub') newStock = Math.max(0, newStock - qty);
    else if(type==='set') newStock = qty;

    S._modal=''; S.loading=true; try{render();}catch(e){}
    try{
      await PATCH('/products/'+prodId+'/stock',{stock:newStock,reason,type,qty}).catch(async()=>{
        await PUT('/products/'+prodId,{...p,stock:newStock});
      });
      S.products=S.products.map(x=>x._id===prodId?{...x,stock:newStock}:x);
      S.loading=false; render();
      toast(`✅ Estoque de ${p.name}: ${p.stock||0} \u2192 ${newStock} un`);
    }catch(e){
      S.loading=false; render(); toast('❌ Erro: '+(e.message||''));
    }
  });
}
