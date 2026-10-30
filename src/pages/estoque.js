import { S } from '../state.js';
import { $c, $d, esc } from '../utils/formatters.js';
import { GET, POST, PUT, PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can } from '../services/auth.js';
import { invalidateCache } from '../services/cache.js';
import { emoji } from '../utils/formatters.js';
import { renderInventariosTab } from './inventario.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── Unidades de estoque ──────────────────────────────────────
// Marcia (jul/2026): os helpers agora vivem em utils/stock.js — fonte
// UNICA de verdade compartilhada com a tela de Produtos e os alertas
// (antes cada tela calculava o estoque de um jeito diferente).
import { STOCK_UNITS, UNIT_LABEL, getStockByUnit, buildStockPayload } from '../utils/stock.js';
export { STOCK_UNITS, getStockByUnit };

function _totalFromSbu(sbu){
  return STOCK_UNITS.reduce((s,u)=>s+(Number(sbu[u])||0),0);
}

// ── Helper: renderiza uma linha de produto ───────────────────
// Marcia (30/out/2026): linha enxuta — produto, saldo por unidade (editável),
// total com a situação e ações. Preço/custo saíram daqui (ficam no cadastro
// do produto e na aba "Preços em lote").
const _sit = (p, total) => {
  const min = Number(p.minStock || p.estoqueMinimo) || 5;
  return total <= min ? { k: 'critico', l: 'Crítico', cor: '#B91C1C', bg: '#FEF2F2' }
    : total <= min * 1.5 ? { k: 'baixo', l: 'Baixo', cor: '#B45309', bg: '#FFFBEB' }
    : { k: 'ok', l: 'OK', cor: '#15803D', bg: '#F0FDF4' };
};
function _renderStockRow(p){
  const sbu = getStockByUnit(p);
  const total = _totalFromSbu(sbu);
  const sit = _sit(p, total);
  const min = Number(p.minStock || p.estoqueMinimo) || 5;
  const checked = (S._stockSelected||[]).includes(p._id) ? 'checked' : '';
  const unidades = S._stockUnit && STOCK_UNITS.includes(S._stockUnit) ? [S._stockUnit] : STOCK_UNITS;
  const img = p.images?.[0]
    ? `<img src="${p.images[0]}" loading="lazy" decoding="async" style="width:36px;height:36px;border-radius:6px;object-fit:cover;flex-shrink:0;">`
    : `<span style="font-size:20px;width:36px;text-align:center;flex-shrink:0;">${emoji(p.category)}</span>`;
  return `<div class="stk-row" style="border-left:4px solid ${sit.cor};">
    <input type="checkbox" class="stock-row-chk" data-stock-sel="${p._id}" ${checked} title="Selecionar (preços em lote)"/>
    ${img}
    <div style="flex:1;min-width:150px;">
      <div style="font-size:13px;font-weight:700;line-height:1.25;">${esc(p.name||'')}</div>
      <div style="font-size:10.5px;color:var(--muted);">${esc(p.category||'—')}${(p.code||p.sku)?' · '+esc(p.code||p.sku):''}${p.active===false?' · <b style="color:var(--red)">inativo no PDV</b>':''}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:flex-end;">
      ${unidades.map(u=>`<label style="text-align:center;font-size:9.5px;color:var(--muted);">${esc(UNIT_LABEL[u]||u)}
        <input type="number" min="0" class="fi stock-unit-inline" data-unit="${esc(u)}" data-pid="${p._id}" value="${sbu[u]||0}" style="display:block;width:64px;padding:3px 4px;font-size:13px;text-align:center;font-weight:700;"/></label>`).join('')}
      <div style="text-align:center;min-width:58px;">
        <div style="font-size:9.5px;color:var(--muted);">Total</div>
        <div style="font-size:16px;font-weight:900;color:${sit.cor};" data-total-pid="${p._id}">${total}</div>
        <div style="font-size:9.5px;font-weight:800;color:${sit.cor};background:${sit.bg};border-radius:999px;padding:0 6px;" title="Mínimo: ${min}">${sit.l} · mín ${min}</div>
      </div>
    </div>
    <div style="display:flex;gap:4px;">
      <button class="btn btn-ghost btn-xs" data-stock-add="${p._id}" data-stock-name="${esc(p.name||'')}" title="Entrada">＋</button>
      <button class="btn btn-ghost btn-xs" data-stock-rem="${p._id}" data-stock-name="${esc(p.name||'')}" title="Saída">−</button>
      <button class="btn btn-ghost btn-xs" data-stock-edit="${p._id}" title="Editar produto">✏️</button>
    </div>
  </div>`;
}

// ── Atualiza estoque por unidade (chamado pelo main.js) ──────
export async function updateStockByUnit(productId, unit, newValue){
  const product = S.products.find(p => p._id === productId);
  if(!product) return;
  if(!STOCK_UNITS.includes(unit)) return toast('❌ Unidade inválida', true);

  const stockByUnit = { ...getStockByUnit(product) };
  const antes = Number(stockByUnit[unit]) || 0;
  const depois = Math.max(0, parseInt(newValue)||0);
  if (antes === depois) return; // nada mudou, nao polui o historico
  stockByUnit[unit] = depois;
  const newTotal = _totalFromSbu(stockByUnit);

  try{
    await PUT('/products/'+productId, buildStockPayload(stockByUnit));
    product.stockByUnit = stockByUnit;
    product.estoque = newTotal;
    product.stock = newTotal;
    // Atualizar display de total inline, sem re-render completo
    const totalEl = document.querySelector(`[data-total-pid="${productId}"]`);
    if(totalEl) totalEl.textContent = newTotal;
    try{ invalidateCache && invalidateCache('products'); }catch(e){}

    // ── HISTÓRICO (Marcia jul/2026) ──────────────────────────────
    // Antes esta edição inline era 100% SILENCIOSA: mudava o saldo sem
    // deixar rastro de quem, quando, em qual unidade e de quanto pra
    // quanto. Agora grava um Ajuste detalhado. Vai como 'Ajuste' porque
    // o saldo JÁ foi gravado no PUT acima — se fosse Entrada/Saída o
    // backend aplicaria de novo e dobraria o movimento.
    const delta = depois - antes;
    POST('/stock/moves', {
      productId, productName: product.name || '',
      type: 'Ajuste',
      quantity: Math.abs(delta),
      unit,
      before: antes, after: depois,
      user: S.user?.name || S.user?.nome || '',
      reason: `Edição manual na tela de Estoque (${antes} → ${depois})`,
      date: new Date().toISOString(),
    }).then(mv => { if (Array.isArray(S.stockMoves)) S.stockMoves.unshift(mv); })
      .catch(() => {});

    toast(`✅ ${UNIT_LABEL[unit]||unit}: ${antes} → ${depois} (total ${newTotal})`);
  }catch(e){
    toast('Erro: '+(e.message||'falha'), true);
  }
}

// ── ESTOQUE ──────────────────────────────────────────────────
// Marcia (30/out/2026): reorganizado em abas — Posição · Movimentações ·
// Inventários · Preços em lote. Arquivados ficam de fora.
window.stockTab = (t) => { S._stockTab = t; render(); };
window.stockStatus = (s) => { S._stockStatus = s; S._stockTab = 'posicao'; render(); };
export function renderEstoque(){
  const _prodTotal = (p)=> _totalFromSbu(getStockByUnit(p));
  const base = S.products.filter(p => p.archived !== true);
  const sitDe = (p) => _sit(p, _prodTotal(p)).k;
  const criticos = base.filter(p => sitDe(p) === 'critico');
  const baixos = base.filter(p => sitDe(p) === 'baixo');
  const unit = S._stockUnit || (S.user.unit==='Todas'?'':S.user.unit);
  const tab = S._stockTab || 'posicao';
  const isAdmin = S.user?.role==='Administrador' || S.user?.cargo==='admin';

  // Filtros da Posição
  let filtered = base.slice();
  const q = (S._stockSearch||'').trim().toLowerCase();
  if(q) filtered = filtered.filter(p => (p.name||'').toLowerCase().includes(q) || (p.code||'').toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q));
  const cat = S._stockCat||'';
  if(cat) filtered = filtered.filter(p=>(p.category||'')===cat || (Array.isArray(p.categories) && p.categories.includes(cat)));
  const st = S._stockStatus||'';
  if(st) filtered = filtered.filter(p => sitDe(p) === st);
  const sort = S._stockSort||'nome-asc';
  const byName = (a,b)=>(a.name||'').localeCompare(b.name||'','pt-BR');
  if(sort==='nome-asc') filtered.sort(byName);
  else if(sort==='nome-desc') filtered.sort((a,b)=>byName(b,a));
  else if(sort==='estoque-asc') filtered.sort((a,b)=>_prodTotal(a)-_prodTotal(b));
  else if(sort==='estoque-desc') filtered.sort((a,b)=>_prodTotal(b)-_prodTotal(a));
  else if(sort==='cat-asc') filtered.sort((a,b)=>((a.category||'').localeCompare(b.category||'','pt-BR'))||byName(a,b));

  const totalVal = base.reduce((s,p)=>s+(Number(p.costPrice)||0)*_prodTotal(p),0);
  const cats = Array.from(new Set(base.map(p=>p.category).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const hasFilter = !!(q || cat || st || (sort && sort!=='nome-asc'));
  const adj = S._stockAdjust || {};
  const selCount = (S._stockSelected||[]).length;

  // Lista (agrupa por categoria quando ordenado por categoria)
  let listHtml = '';
  if(filtered.length===0){
    listHtml = `<div class="empty"><div class="empty-icon">📦</div><p>Nenhum produto com esses filtros</p></div>`;
  } else if(sort==='cat-asc'){
    const groups = {};
    filtered.forEach(p=>{ const k = p.category||'Sem categoria'; (groups[k] = groups[k]||[]).push(p); });
    Object.keys(groups).sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(k=>{
      listHtml += `<div style="margin:12px 0 6px;font-weight:800;font-size:12px;color:var(--muted);text-transform:uppercase;">${emoji(k)} ${esc(k)} · ${groups[k].length}</div>`;
      listHtml += groups[k].sort(byName).map(_renderStockRow).join('');
    });
  } else {
    listHtml = filtered.map(_renderStockRow).join('');
  }

  const tabBtn = (k, l) => `<button type="button" class="tab ${tab===k?'active':''}" onclick="stockTab('${k}')">${l}</button>`;
  const chip = (k, l, n, cor) => `<button type="button" onclick="stockStatus('${k}')" style="border:1.5px solid ${st===k?cor:'var(--border)'};background:${st===k?cor+'18':'#fff'};color:${cor};border-radius:999px;padding:4px 11px;font-size:12px;font-weight:800;cursor:pointer;">${l}${n!==null?` · ${n}`:''}</button>`;
  const filtroCat = cats.map(c=>`<option value="${esc(c)}" ${c===cat?'selected':''}>${esc(c)}</option>`).join('');

  const posicao = `
<div class="card" style="padding:12px;">
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
    <input type="text" id="stock-search" class="fi" placeholder="🔎 Buscar produto ou SKU..." value="${esc(S._stockSearch||'')}" style="flex:1;min-width:180px;"/>
    <select id="stock-filter-cat" class="fi" style="flex:0 0 auto;min-width:140px;">
      <option value="">Todas categorias</option>
      ${filtroCat}
    </select>
    <select id="stock-sort" class="fi" style="flex:0 0 auto;min-width:150px;">
      <option value="nome-asc" ${sort==='nome-asc'?'selected':''}>Nome A-Z</option>
      <option value="nome-desc" ${sort==='nome-desc'?'selected':''}>Nome Z-A</option>
      <option value="estoque-asc" ${sort==='estoque-asc'?'selected':''}>Menor estoque primeiro</option>
      <option value="estoque-desc" ${sort==='estoque-desc'?'selected':''}>Maior estoque primeiro</option>
      <option value="cat-asc" ${sort==='cat-asc'?'selected':''}>Por categoria</option>
    </select>
  </div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
    ${chip('', 'Todos', base.length, '#334155')}${chip('critico', '🔴 Crítico', criticos.length, '#B91C1C')}${chip('baixo', '🟡 Baixo', baixos.length, '#B45309')}${chip('ok', '🟢 OK', null, '#15803D')}
    ${hasFilter?`<button class="btn btn-ghost btn-sm" id="btn-stock-clear" onclick="S._stockStatus=''">✖ Limpar filtros</button>`:''}
    <span style="margin-left:auto;font-size:11px;color:var(--muted);">${filtered.length} produto(s) · edite o número da unidade e ele salva sozinho${selCount?` · ${selCount} selecionado(s)`:''}</span>
  </div>
  ${listHtml}
</div>`;

  const filtroMov = S._stockFilter||'todos';
  const linhasMov = S.stockMoves
    .filter(m=>filtroMov==='todos'||m.type===filtroMov)
    .slice(0,100).map(m=>{
    const nome = m.productName || m.product?.name || (S.products||[]).find(p=>String(p._id)===String(m.productId))?.name || '—';
    const qtd  = Number(m.quantity ?? m.qty ?? 0);
    const dt   = m.date || m.createdAt;
    const sinal = m.type==='Entrada' ? '+' : m.type==='Saída' ? '−' : '';
    const corQtd = m.type==='Entrada' ? 'var(--leaf)' : m.type==='Saída' ? 'var(--red)' : 'var(--muted)';
    const temSaldo = m.before !== null && m.before !== undefined && m.after !== null && m.after !== undefined;
    const rota = m.type==='Transferência' && (m.from||m.to) ? `${m.from||'?'} → ${m.to||'?'}` : (m.unit||'—');
    const tagCls = m.type==='Entrada'?'t-green':m.type==='Saída'?'t-red':m.type==='Transferência'?'t-blue':'t-gray';
    const quando = dt ? new Date(dt).toLocaleDateString('pt-BR')+' '+new Date(dt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
    return `<tr>
    <td style="font-size:11px;color:var(--muted);white-space:nowrap">${quando}</td>
    <td style="font-weight:500;font-size:12px">${esc(nome)}</td>
    <td><span class="tag ${tagCls}">${esc(m.type||'—')}</span></td>
    <td style="font-weight:600;color:${corQtd}">${sinal}${qtd}</td>
    <td style="font-size:11px;font-weight:600;">${temSaldo?`${m.before} → <strong>${m.after}</strong>`:'—'}</td>
    <td style="font-size:11px">${esc(rota)}</td>
    <td style="font-size:11px;color:var(--muted)">${esc(m.user||'—')}</td>
    <td style="font-size:11px;color:var(--muted)">${esc(m.reason||'—')}</td>
  </tr>`;}).join('');
  const botoesMov = ['todos','Entrada','Saída','Transferência','Ajuste'].map(f=>`<button class="btn btn-ghost btn-xs ${filtroMov===f?'btn-primary':''}" data-sf="${f}">${f==='todos'?'Todos':f==='Transferência'?'Transf.':f==='Ajuste'?'Ajustes':f+'s'}</button>`).join('');
  const movs = `
<div class="card">
  <div class="card-title">📋 Movimentações <div style="display:flex;gap:4px;flex-wrap:wrap;">${botoesMov}</div></div>
  ${S.stockMoves.length===0?`<div class="empty"><div class="empty-icon">📋</div><p>Nenhuma movimentação ainda</p></div>`:`
  <div class="tw"><table><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Qtd</th><th>Saldo</th><th>Unidade</th><th>Quem</th><th>Motivo</th></tr></thead>
  <tbody>${linhasMov}</tbody></table></div>`}
</div>`;

  const precos = `
<div class="card">
  <div class="card-title">💰 Preços em lote</div>
  <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">Aplica nos produtos filtrados na aba Posição (busca/categoria/situação) ou só nos selecionados.</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
    <div class="fg" style="flex:0 0 auto;"><label class="fl">Aplicar em</label>
      <select class="fi" id="adj-scope" style="width:auto;">
        <option value="filtered" ${adj.scope==='filtered'?'selected':''}>Todos filtrados (${filtered.length})</option>
        <option value="selected" ${adj.scope==='selected'?'selected':''}>Selecionados (${selCount})</option>
      </select></div>
    <div class="fg" style="flex:0 0 auto;"><label class="fl">Operação</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <label style="font-size:12px;"><input type="radio" name="adj-op" value="inc" ${adj.op==='inc'?'checked':''}/> Aumentar</label>
        <label style="font-size:12px;"><input type="radio" name="adj-op" value="dec" ${adj.op==='dec'?'checked':''}/> Diminuir</label>
        <label style="font-size:12px;"><input type="radio" name="adj-op" value="set" ${adj.op==='set'?'checked':''}/> Definir</label>
      </div></div>
    <div class="fg" style="flex:0 0 auto;"><label class="fl">Tipo</label>
      <select class="fi" id="adj-type" style="width:auto;">
        <option value="pct" ${adj.type==='pct'?'selected':''}>Porcentagem (%)</option>
        <option value="fix" ${adj.type==='fix'?'selected':''}>Valor fixo (R$)</option>
      </select></div>
    <div class="fg" style="flex:0 0 auto;"><label class="fl">Valor</label>
      <input class="fi" type="number" step="0.01" id="adj-value" value="${adj.value||0}" style="width:100px;"/></div>
    <div class="fg" style="flex:0 0 auto;">
      <label style="font-size:12px;display:block;"><input type="checkbox" id="adj-venda" ${adj.applyVenda?'checked':''}/> Preço venda</label>
      <label style="font-size:12px;display:block;"><input type="checkbox" id="adj-custo" ${adj.applyCusto?'checked':''}/> Preço custo</label></div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-outline btn-sm" id="btn-preview-adjust">👁️ Visualizar</button>
      <button class="btn btn-primary btn-sm" id="btn-apply-adjust">✅ Aplicar Ajuste</button>
    </div>
  </div>
</div>`;

  const opUnidades = STOCK_UNITS.map(u=>`<option value="${esc(u)}" ${unit===u?'selected':''}>${esc(UNIT_LABEL[u]||u)}</option>`).join('');
  const conteudo = tab==='mov' ? movs : tab==='inv' ? renderInventariosTab() : (tab==='precos' && isAdmin) ? precos : posicao;

  return`
<style>
  .stk-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;margin-bottom:6px;border:1px solid var(--border);border-radius:10px;background:#fff;}
  .stk-kpi{flex:1;min-width:130px;border-radius:12px;padding:10px 12px;background:#fff;border:1px solid var(--border);}
  .stk-kpi b{display:block;font-size:22px;font-weight:900;}
  .stk-kpi span{font-size:10.5px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;}
</style>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
  <div class="stk-kpi"><span>Produtos</span><b>${base.length}</b></div>
  <div class="stk-kpi" style="cursor:pointer;border-color:#FCA5A5;" onclick="stockStatus('critico')"><span>🔴 Estoque crítico</span><b style="color:#B91C1C;">${criticos.length}</b></div>
  <div class="stk-kpi" style="cursor:pointer;border-color:#FDE68A;" onclick="stockStatus('baixo')"><span>🟡 Estoque baixo</span><b style="color:#B45309;">${baixos.length}</b></div>
  ${isAdmin?`<div class="stk-kpi"><span>Valor em estoque (custo)</span><b style="font-size:18px;">${$c(totalVal)}</b></div>`:''}
</div>

<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
  <select class="fi" id="stock-unit" style="width:auto;">
    <option value="">Todas as unidades</option>
    ${opUnidades}
  </select>
  <button class="btn btn-green btn-sm" id="btn-stock-entry">📦 Entrada</button>
  <button class="btn btn-outline btn-sm" id="btn-stock-exit">📤 Saída</button>
  <button class="btn btn-blue btn-sm" id="btn-new-transfer">🔄 Transferência</button>
  <details style="position:relative;">
    <summary class="btn btn-ghost btn-sm" style="list-style:none;cursor:pointer;">⋯ Mais</summary>
    <div style="position:absolute;z-index:20;top:110%;left:0;background:#fff;border:1px solid var(--border);border-radius:10px;padding:6px;display:grid;gap:4px;min-width:170px;box-shadow:var(--shadow);">
      <button class="btn btn-ghost btn-sm" id="btn-stock-export">⬇️ Exportar CSV</button>
      <button class="btn btn-ghost btn-sm" id="btn-stock-import">⬆️ Importar CSV</button>
      <button class="btn btn-ghost btn-sm" id="btn-rel-prods">🔄 Atualizar dados</button>
    </div>
  </details>
  <input type="file" id="stock-import-file" accept=".csv" style="display:none;"/>
</div>

<div class="tabs" style="margin-bottom:12px;flex-wrap:wrap;">
  ${tabBtn('posicao','📦 Posição')}${tabBtn('mov','📋 Movimentações')}${tabBtn('inv','🧾 Inventários')}${isAdmin?tabBtn('precos','💰 Preços em lote'):''}
</div>

${conteudo}`;
}

// ── MODAL ESTOQUE ────────────────────────────────────────────
export async function showStockModal(prodId, prodName, type='Entrada'){
  const validUnits = ['Loja Novo Aleixo','CDLE'];
  const defaultUnit = validUnits.includes(S.user.unit) ? S.user.unit : 'CDLE';
  // Marcia (jul/2026): quando aberto pelos botões do topo (Entrada/Saída
  // gerais), NÃO vinha produto — o campo ficava vazio e travado e não dava
  // pra registrar nada. Agora, sem produto definido, mostra um SELETOR.
  const produtosOrd = [...(S.products||[])]
    .sort((a,b)=>String(a.name||'').localeCompare(b.name||'','pt-BR'));
  const campoProduto = prodId
    ? `<input class="fi" value="${esc(prodName||'')}" readonly style="background:var(--cream)"/>`
    : `<select class="fi" id="sm-prod">
         <option value="">Selecione o produto…</option>
         ${produtosOrd.map(p=>`<option value="${p._id}">${esc(p.name||'')} — estoque ${_totalFromSbu(getStockByUnit(p))}</option>`).join('')}
       </select>`;
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()">
  <div class="mo-title">${type==='Entrada'?'📦 Entrada':'📤 Saída'} de Estoque</div>
  <div class="fg"><label class="fl">Produto *</label>${campoProduto}</div>
  <div class="fr2">
    <div class="fg"><label class="fl">Quantidade *</label><input class="fi" type="number" id="sm-qty" placeholder="0" min="1"/></div>
    <div class="fg"><label class="fl">Unidade *</label>
      <select class="fi" id="sm-unit">
        ${validUnits.map(u=>`<option value="${u}" ${u===defaultUnit?'selected':''}>${u}</option>`).join('')}
      </select>
    </div>
  </div>
  <div class="fg"><label class="fl">Motivo</label>
    <select class="fi" id="sm-reason">
      ${type==='Entrada'?
        '<option>Compra de fornecedor</option><option>Transferência recebida</option><option>Devolução</option><option>Ajuste de inventário</option><option>Outros</option>':
        '<option>Venda balcão</option><option>Perda/Avaria</option><option>Transferência enviada</option><option>Ajuste de inventário</option><option>Outros</option>'
      }
    </select>
  </div>
  <div class="fg"><label class="fl">Observação</label><textarea class="fi" id="sm-obs" rows="2" placeholder="Detalhes adicionais..."></textarea></div>
  <div class="mo-foot">
    <button class="btn ${type==='Entrada'?'btn-green':'btn-red'}" id="btn-sv-stock">Confirmar ${type}</button>
    <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
  </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-sv-stock')?.addEventListener('click',()=>saveStockMove(prodId,type));
}

// ── MODAL TRANSFERÊNCIA ──────────────────────────────────────
export async function showTransferModal(){
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()">
  <div class="mo-title">🔄 Transferência entre Unidades</div>
  <div class="fg"><label class="fl">Produto *</label>
    <select class="fi" id="tr-prod">
      <option value="">Selecionar produto...</option>
      ${[...(S.products||[])].sort((a,b)=>String(a.name||'').localeCompare(b.name||'','pt-BR')).map(p=>`<option value="${p._id}">${esc(p.name||'')} (Est: ${_totalFromSbu(getStockByUnit(p))})</option>`).join('')}
    </select>
  </div>
  <div class="fr2">
    <div class="fg"><label class="fl">Origem *</label>
      <select class="fi" id="tr-from">
        <option value="CDLE">CDLE</option>
        <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
      </select>
    </div>
    <div class="fg"><label class="fl">Destino *</label>
      <select class="fi" id="tr-to">
        <option value="Loja Novo Aleixo">Loja Novo Aleixo</option>
        <option value="CDLE">CDLE</option>
      </select>
    </div>
  </div>
  <div class="fg"><label class="fl">Quantidade *</label><input class="fi" type="number" id="tr-qty" placeholder="0" min="1"/></div>
  <div class="fg"><label class="fl">Observação</label><textarea class="fi" id="tr-obs" rows="2"></textarea></div>
  <div class="mo-foot">
    <button class="btn btn-blue" id="btn-sv-transfer">Confirmar Transferência</button>
    <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
  </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-sv-transfer')?.addEventListener('click',saveTransfer);
}

// ── SALVAR MOVIMENTAÇÃO ──────────────────────────────────────
export async function saveStockMove(prodId, type){
  // Sem produto fixo (botões gerais), lê o seletor do modal.
  const pid = prodId || document.getElementById('sm-prod')?.value || '';
  const qty = parseInt(document.getElementById('sm-qty')?.value||0);
  const unit = document.getElementById('sm-unit')?.value;
  const reason = document.getElementById('sm-reason')?.value;
  const obs = document.getElementById('sm-obs')?.value;
  if(!pid) return toast('❌ Selecione o produto', true);
  if(!qty||qty<=0) return toast('❌ Informe a quantidade', true);
  const p = S.products.find(x=>x._id===pid);
  if(!p) return toast('❌ Produto não encontrado', true);

  // Saldo por unidade ANTES/DEPOIS — o backend aplica a Entrada/Saída no
  // stockByUnit da unidade escolhida; espelhamos local com o mesmo cálculo.
  const sbu = { ...getStockByUnit(p) };
  const antes = Number(sbu[unit]) || 0;
  const depois = type==='Entrada' ? antes + qty : Math.max(0, antes - qty);
  try{
    S.loading=true;S._modal='';render();
    const move = await POST('/stock/moves',{
      product:pid, productName:p.name||'', type, qty, unit,
      before:antes, after:depois,
      user:S.user?.name||S.user?.nome||'',
      reason: obs ? (reason+' — '+obs) : reason,
    });
    if(Array.isArray(S.stockMoves)) S.stockMoves.unshift(move);
    // Espelha o saldo por unidade (não o antigo p.stock, que ficava defasado)
    sbu[unit] = depois;
    p.stockByUnit = sbu;
    p.estoque = _totalFromSbu(sbu);
    p.stock   = p.estoque;
    try{ invalidateCache && invalidateCache('products'); }catch(e){}
    S.loading=false;render();
    toast(`✅ ${type} de ${qty} em ${unit}: ${antes} → ${depois}`);
  }catch(e){
    S.loading=false;render();
    toast('❌ '+(e.message||'Falha ao registrar movimentação'), true);
  }
}

// ── SALVAR TRANSFERÊNCIA ─────────────────────────────────────
export async function saveTransfer(){
  const prodId = document.getElementById('tr-prod')?.value;
  const from = document.getElementById('tr-from')?.value;
  const to = document.getElementById('tr-to')?.value;
  const qty = parseInt(document.getElementById('tr-qty')?.value||0);
  const obs = document.getElementById('tr-obs')?.value;
  if(!prodId) return toast('❌ Selecione o produto');
  if(!qty||qty<=0) return toast('❌ Informe a quantidade');
  if(from===to) return toast('❌ Origem e destino devem ser diferentes');
  try{
    S.loading=true;S._modal='';render();
    const move = await POST('/stock/moves',{product:prodId,type:'Transferência',qty,unit:from,unitDest:to,reason:obs||'Transferência entre unidades'});
    S.stockMoves.unshift(move);
    // O servidor agora MOVE o saldo de verdade — reflete local (mesmo
    // padrao do updateStockByUnit) pra tela nao ficar desatualizada.
    const p = S.products.find(x => x._id === prodId);
    if (p) {
      const sbu = { ...getStockByUnit(p) };
      sbu[from] = Math.max(0, (Number(sbu[from])||0) - qty);
      sbu[to]   = (Number(sbu[to])||0) + qty;
      p.stockByUnit = sbu;
      p.estoque = _totalFromSbu(sbu);
      p.stock   = p.estoque;
    }
    try{ invalidateCache && invalidateCache('products'); }catch(e){}
    S.loading=false;render();
    toast(`✅ Transferência de ${qty} un. — ${from} → ${to}`);
  }catch(e){S.loading=false;render();}
}

// ── CARREGAR MOVIMENTAÇÕES ───────────────────────────────────
export async function loadStockMoves(){
  try{
    const moves = await GET('/stock/moves');
    S.stockMoves = moves||[];
  }catch(e){ S.stockMoves=[]; }
}

// ── AJUSTE DE PREÇOS EM LOTE ─────────────────────────────────
function _getAdjustTargets(){
  const adj = S._stockAdjust || {};
  // Recomputa produtos filtrados conforme estado atual
  const unit = S._stockUnit || (S.user.unit==='Todas'?'':S.user.unit);
  let filtered = (unit ? S.products.filter(p=>!p.unit||p.unit===unit||p.unit==='Todas') : S.products.slice()).filter(p=>p.archived!==true);
  if (S._stockStatus) filtered = filtered.filter(p => _sit(p, _totalFromSbu(getStockByUnit(p))).k === S._stockStatus);
  const q = (S._stockSearch||'').trim().toLowerCase();
  if(q){
    filtered = filtered.filter(p =>
      (p.name||'').toLowerCase().includes(q) ||
      (p.code||'').toLowerCase().includes(q) ||
      (p.sku||'').toLowerCase().includes(q)
    );
  }
  const cat = S._stockCat||'';
  if(cat) filtered = filtered.filter(p=>(p.category||'')===cat);
  if(adj.scope==='selected'){
    const sel = new Set(S._stockSelected||[]);
    return filtered.filter(p=>sel.has(p._id));
  }
  return filtered;
}

function _computeNewPrice(oldPrice, op, type, value){
  const v = Number(value)||0;
  if(type==='pct'){
    if(op==='inc') return oldPrice * (1 + v/100);
    if(op==='dec') return oldPrice * (1 - v/100);
    if(op==='set') return v; // definir percentual não faz sentido, mas definimos como valor
  } else {
    if(op==='inc') return oldPrice + v;
    if(op==='dec') return oldPrice - v;
    if(op==='set') return v;
  }
  return oldPrice;
}

export async function previewPriceAdjust(){
  const adj = S._stockAdjust || {};
  const targets = _getAdjustTargets();
  if(targets.length===0) return toast('❌ Nenhum produto para ajustar');
  const lines = targets.slice(0,20).map(p=>{
    const newV = adj.applyVenda ? Math.max(0, _computeNewPrice(p.price||0, adj.op, adj.type, adj.value)) : (p.price||0);
    const newC = adj.applyCusto ? Math.max(0, _computeNewPrice(p.costPrice||0, adj.op, adj.type, adj.value)) : (p.costPrice||0);
    return `<tr>
      <td style="font-size:11px">${esc(p.name||'')}</td>
      <td style="text-align:right;font-size:11px">${adj.applyVenda?`${$c(p.price||0)} → <strong>${$c(newV)}</strong>`:`${$c(p.price||0)}`}</td>
      <td style="text-align:right;font-size:11px">${adj.applyCusto?`${$c(p.costPrice||0)} → <strong>${$c(newC)}</strong>`:`${$c(p.costPrice||0)}`}</td>
    </tr>`;
  }).join('');
  S._modal=`<div class="mo" id="mo"><div class="mo-box" onclick="event.stopPropagation()" style="max-width:680px;">
    <div class="mo-title">👁️ Preview do Ajuste (${targets.length} produto${targets.length===1?'':'s'})</div>
    <div style="max-height:50vh;overflow:auto;">
      <table><thead><tr><th>Produto</th><th style="text-align:right">Venda</th><th style="text-align:right">Custo</th></tr></thead>
      <tbody>${lines}</tbody></table>
      ${targets.length>20?`<div style="padding:8px;font-size:11px;color:var(--muted)">... e mais ${targets.length-20} produtos</div>`:''}
    </div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="btn-apply-adjust-confirm">✅ Confirmar e Aplicar</button>
      <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
    </div>
  </div></div>`;
  await render();
  document.getElementById('btn-mo-close')?.addEventListener('click',()=>{S._modal='';render();});
  document.getElementById('btn-apply-adjust-confirm')?.addEventListener('click',()=>{S._modal='';applyPriceAdjust();});
}

export async function applyPriceAdjust(){
  const adj = S._stockAdjust || {};
  if(!adj.applyVenda && !adj.applyCusto) return toast('❌ Marque ao menos um preço (venda ou custo)');
  const targets = _getAdjustTargets();
  if(targets.length===0) return toast('❌ Nenhum produto para ajustar');
  let ok=0, err=0;
  toast(`⏳ Aplicando em ${targets.length} produtos...`);
  for(let i=0;i<targets.length;i++){
    const p = targets[i];
    const body = {};
    if(adj.applyVenda) body.price = Math.max(0, _computeNewPrice(p.price||0, adj.op, adj.type, adj.value));
    if(adj.applyCusto) body.costPrice = Math.max(0, _computeNewPrice(p.costPrice||0, adj.op, adj.type, adj.value));
    try{
      await PUT('/products/'+p._id, body);
      S.products = S.products.map(x=>x._id===p._id?{...x, ...body}:x);
      ok++;
      if((i+1)%5===0 || i===targets.length-1) toast(`⏳ ${i+1}/${targets.length}...`);
    }catch(e){ err++; }
  }
  try{ invalidateCache && invalidateCache('products'); }catch(e){}
  render();
  toast(`✅ Ajuste aplicado: ${ok} ok${err?`, ${err} erros`:''}`);
}

export async function updateProductFieldInline(pid, field, value){
  const p = S.products.find(x=>x._id===pid);
  if(!p) return;
  const num = Number(value);
  if(isNaN(num)) return toast('❌ Valor inválido');
  const body = { [field]: Math.max(0, num) };
  try{
    await PUT('/products/'+pid, body);
    S.products = S.products.map(x=>x._id===pid?{...x, ...body}:x);
    toast('✅ Atualizado');
  }catch(e){
    toast('❌ Erro ao atualizar');
    render();
  }
}

// ── EXPORT CSV (estoque por unidade) ─────────────────────────
function _csvCell(v){
  const s = String(v==null?'':v);
  if(/[",\n;]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
export function exportStockCSV(){
  const header = ['nome','sku','CDLE','Loja Novo Aleixo','total'];
  const rows = S.products.map(p=>{
    const sbu = getStockByUnit(p);
    const total = _totalFromSbu(sbu);
    return [
      p.name||'',
      p.code||p.sku||'',
      sbu['CDLE']||0,
      sbu['Loja Novo Aleixo']||0,
      total
    ];
  });
  const csv = [header.join(','), ...rows.map(r=>r.map(_csvCell).join(','))].join('\n');
  const blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `estoque-por-unidade-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('✅ CSV exportado');
}

export async function importStockCSV(file){
  if(!file) return;
  const text = await file.text();
  const lines = text.replace(/^\ufeff/,'').split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2) return toast('❌ CSV vazio', true);
  const parseLine = (line)=>{
    const out = []; let cur=''; let inQ=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(inQ){
        if(c==='"' && line[i+1]==='"'){ cur+='"'; i++; }
        else if(c==='"') inQ=false;
        else cur+=c;
      } else {
        if(c==='"') inQ=true;
        else if(c===','){ out.push(cur); cur=''; }
        else cur+=c;
      }
    }
    out.push(cur);
    return out;
  };
  const header = parseLine(lines[0]).map(h=>h.trim());
  const idx = {
    sku: header.findIndex(h=>/^sku$/i.test(h) || /codigo/i.test(h)),
    cdle: header.findIndex(h=>/^cdle$/i.test(h)),
    na: header.findIndex(h=>/novo\s*aleixo/i.test(h)),
  };
  if(idx.sku<0) return toast('❌ Coluna sku não encontrada', true);
  let ok=0, err=0;
  for(let i=1;i<lines.length;i++){
    const cols = parseLine(lines[i]);
    const sku = (cols[idx.sku]||'').trim();
    if(!sku) continue;
    const p = S.products.find(x=>(x.code||x.sku||'')===sku);
    if(!p){ err++; continue; }
    const sbu = {
      'CDLE': idx.cdle>=0 ? Number(cols[idx.cdle])||0 : (p.stockByUnit?.CDLE||0),
      'Loja Novo Aleixo': idx.na>=0 ? Number(cols[idx.na])||0 : (p.stockByUnit?.['Loja Novo Aleixo']||0)
    };
    const total = _totalFromSbu(sbu);
    try{
      await PUT('/products/'+p._id, { stockByUnit: sbu, estoque: total, stock: total });
      p.stockByUnit = sbu; p.estoque = total; p.stock = total;
      ok++;
    }catch(e){ err++; }
  }
  try{ invalidateCache && invalidateCache('products'); }catch(e){}
  render();
  toast(`✅ Importação: ${ok} ok${err?`, ${err} erros`:''}`);
}

