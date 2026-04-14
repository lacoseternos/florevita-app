import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── CONSTANTES ────────────────────────────────────────────────
const ORC_KEY = 'fv_orcamentos';

// ── CRUD OR\u00c7AMENTOS (API com fallback localStorage) ──────────
export async function getOrcamentos(){
  try {
    const data = await GET('/orcamentos');
    if(Array.isArray(data)){
      localStorage.setItem(ORC_KEY, JSON.stringify(data));
      return data;
    }
  } catch(e){ /* fallback */ }
  return JSON.parse(localStorage.getItem(ORC_KEY)||'[]');
}

export async function saveOrcamentos(list){
  localStorage.setItem(ORC_KEY, JSON.stringify(list));
  try { await POST('/orcamentos', { orcamentos: list }); } catch(e){ /* silent */ }
}

// Sync helper para uso inline onde async n\u00e3o \u00e9 poss\u00edvel
function getOrcamentosSync(){ return JSON.parse(localStorage.getItem(ORC_KEY)||'[]'); }

// ── C\u00c1LCULO ─────────────────────────────────────────────────
export function calcOrcamento(itens){
  const custoTotal = itens.reduce((s,i)=>{
    const custo = parseFloat(i.custo)||0;
    const qty   = parseInt(i.qty)||1;
    return s + (custo * qty);
  }, 0);
  const precoFinal = custoTotal * 1.2 * 3; // F\u00f3rmula oculta: custo \u00d7 1.2 \u00d7 3
  return { custoTotal, precoFinal };
}

// ── NOVO ITEM TEMPLATE ────────────────────────────────────────
export function newOrcItem(){
  return { id: Date.now()+'_'+Math.random().toString(36).slice(2,6), prodId:'', nome:'', custo:0, qty:1 };
}

// ── Expose to window for inline onclick handlers ──────────────
window.calcOrcamento = calcOrcamento;
window.newOrcItem = newOrcItem;

// ── RENDER ────────────────────────────────────────────────────
export function renderOrcamento(){
  const orcamentos = getOrcamentosSync();
  const view = S._orcView || 'list'; // 'list' | 'new' | 'edit' | 'detail'
  const cfg  = JSON.parse(localStorage.getItem('fv_whats_config')||'{}');
  const wpp  = cfg.numero?.replace(/\D/g,'')||'5592993002433';

  // \u2500\u2500 LISTA DE OR\u00c7AMENTOS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if(view === 'list'){
    return`
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
  <div>
    <h2 style="font-family:'Playfair Display',serif;font-size:22px;color:var(--primary);">\ud83d\udccb Or\u00e7amentos</h2>
    <p style="font-size:13px;color:var(--muted);">${orcamentos.length} or\u00e7amento(s) salvo(s)</p>
  </div>
  <button class="btn btn-primary" id="btn-orc-new">+ Novo Or\u00e7amento</button>
</div>

${orcamentos.length===0?`
<div class="card" style="text-align:center;padding:60px 20px;">
  <div style="font-size:60px;margin-bottom:16px;">\ud83d\udccb</div>
  <h3 style="color:var(--primary);margin-bottom:8px;">Nenhum or\u00e7amento ainda</h3>
  <p style="color:var(--muted);margin-bottom:20px;">Crie seu primeiro or\u00e7amento e envie pelo WhatsApp</p>
  <button class="btn btn-primary" id="btn-orc-new2">+ Criar Or\u00e7amento</button>
</div>`:`
<div style="display:flex;flex-direction:column;gap:12px;">
  ${orcamentos.slice().reverse().map(o=>{
    const { precoFinal } = calcOrcamento(o.itens||[]);
    const dataStr = o.criadoEm ? new Date(o.criadoEm).toLocaleDateString('pt-BR') : '\u2014';
    const statusColor = o.status==='Aprovado'?'var(--leaf)':o.status==='Recusado'?'var(--red)':'var(--gold)';
    return`
  <div class="card" style="padding:16px;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div style="display:flex;align-items:center;gap:14px;">
        <div style="background:var(--primary-pale);border-radius:10px;padding:10px 14px;font-size:22px;">\ud83d\udccb</div>
        <div>
          <div style="font-weight:700;font-size:15px;">${o.titulo||'Or\u00e7amento #'+o.id.slice(-4)}</div>
          <div style="font-size:12px;color:var(--muted);">
            ${o.cliente?'\ud83d\udc64 '+o.cliente+' \u00b7 ':''}${dataStr} \u00b7 ${(o.itens||[]).length} item(ns)
          </div>
          <div style="margin-top:4px;">
            <span style="font-size:11px;font-weight:700;color:${statusColor};background:${statusColor}22;border-radius:20px;padding:2px 8px;">${o.status||'Pendente'}</span>
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:20px;font-weight:700;color:var(--primary);">${$c(precoFinal)}</div>
        <div style="font-size:11px;color:var(--muted);">Pre\u00e7o de Venda</div>
        <div style="display:flex;gap:6px;margin-top:8px;justify-content:flex-end;">
          <button class="btn btn-ghost btn-sm" data-orc-view="${o.id}">\ud83d\udc41\ufe0f Ver</button>
          <button class="btn btn-ghost btn-sm" data-orc-edit="${o.id}">\u270f\ufe0f</button>
          <button class="btn btn-ghost btn-sm" data-orc-wpp="${o.id}" style="background:#25D366;color:#fff;border-color:#25D366;">\ud83d\udcac</button>
          <button class="btn btn-ghost btn-sm" data-orc-del="${o.id}" style="color:var(--red);">\ud83d\uddd1\ufe0f</button>
        </div>
      </div>
    </div>
  </div>`;
  }).join('')}
</div>`}`;
  }

  // \u2500\u2500 FORMUL\u00c1RIO (NOVO / EDI\u00c7\u00c3O) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if(view === 'new' || view === 'edit'){
    const draft = S._orcDraft || { titulo:'', cliente:'', obs:'', status:'Pendente', itens:[newOrcItem()] };
    const { custoTotal, precoFinal } = calcOrcamento(draft.itens||[]);
    const prodOptions = S.products.map(p=>`<option value="${p._id}" data-custo="${p.costPrice||0}" data-nome="${p.name.replace(/"/g,'')}">${p.name} \u2014 ${$c(p.costPrice||0)} (custo)</option>`).join('');
    const isEdit = view === 'edit';

    return`
<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
  <button class="btn btn-ghost btn-sm" id="btn-orc-back">\u2190 Voltar</button>
  <h2 style="font-family:'Playfair Display',serif;font-size:20px;color:var(--primary);">
    ${isEdit?'\u270f\ufe0f Editar Or\u00e7amento':'\ud83d\udccb Novo Or\u00e7amento'}
  </h2>
</div>

<div class="g2" style="gap:16px;align-items:start;">
  <!-- COLUNA ESQUERDA -->
  <div>
    <!-- Dados do or\u00e7amento -->
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">\ud83d\udcdd Dados do Or\u00e7amento</div>
      <div class="fr2" style="gap:10px;">
        <div class="fg"><label class="fl">T\u00edtulo / Descri\u00e7\u00e3o</label>
          <input class="fi" id="orc-titulo" value="${draft.titulo||''}" placeholder="Ex: Buqu\u00ea para casamento da Ana"/></div>
        <div class="fg"><label class="fl">Nome do Cliente</label>
          <input class="fi" id="orc-cliente" value="${draft.cliente||''}" placeholder="Nome do cliente"/></div>
        <div class="fg"><label class="fl">Status</label>
          <select class="fi" id="orc-status">
            ${['Pendente','Aprovado','Recusado','Em an\u00e1lise'].map(s=>`<option ${(draft.status||'Pendente')===s?'selected':''}>${s}</option>`).join('')}
          </select></div>
        <div class="fg"><label class="fl">Observa\u00e7\u00f5es</label>
          <input class="fi" id="orc-obs" value="${draft.obs||''}" placeholder="Anota\u00e7\u00f5es, condi\u00e7\u00f5es especiais..."/></div>
      </div>
    </div>

    <!-- Itens -->
    <div class="card">
      <div class="card-title">\ud83c\udf38 Itens do Or\u00e7amento
        <button class="btn btn-primary btn-sm" id="btn-orc-add-item">+ Adicionar Produto</button>
      </div>

      ${(draft.itens||[]).length===0?`<div style="text-align:center;padding:32px;color:var(--muted);">Clique em "+ Adicionar Produto" para come\u00e7ar</div>`:''}

      <div id="orc-itens-list">
        ${(draft.itens||[]).map((item,idx)=>`
        <div class="orc-item" style="background:var(--cream);border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid var(--border);" data-idx="${idx}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span style="font-weight:700;font-size:13px;color:var(--primary);">Item ${idx+1}</span>
            ${(draft.itens||[]).length>1?`<button class="btn btn-ghost btn-xs" style="color:var(--red);" data-orc-remove="${idx}">\u2715 Remover</button>`:''}
          </div>
          <div class="fr2" style="gap:8px;">
            <div class="fg" style="grid-column:span 2">
              <label class="fl">Produto *</label>
              <select class="fi orc-prod-sel" data-idx="${idx}">
                <option value="">\u2014 Selecionar produto \u2014</option>
                ${S.products.map(p=>`<option value="${p._id}" data-custo="${p.costPrice||0}" data-nome="${p.name.replace(/"/g,'')}" ${item.prodId===p._id?'selected':''}>${p.name} \u2014 ${$c(p.costPrice||0)} custo</option>`).join('')}
              </select>
            </div>
            <div class="fg">
              <label class="fl">Quantidade</label>
              <input type="number" class="fi orc-qty" data-idx="${idx}" value="${item.qty||1}" min="1" step="1"/>
            </div>
            <div class="fg">
              <label class="fl">Custo unit\u00e1rio (R$)</label>
              <input type="number" class="fi orc-custo" data-idx="${idx}" value="${item.custo||0}" min="0" step="0.01"/>
            </div>
          </div>
          <div style="margin-top:8px;text-align:right;font-size:12px;color:var(--muted);">
            Subtotal custo: <strong>${$c((item.custo||0)*(item.qty||1))}</strong>
            ${item.nome?`<span style="margin-left:8px;">\u00b7 ${item.nome}</span>`:''}
          </div>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <!-- COLUNA DIREITA \u2014 RESUMO -->
  <div>
    <div class="card" style="position:sticky;top:80px;">
      <div class="card-title">\ud83d\udcb0 Resumo do Or\u00e7amento</div>

      <div style="background:var(--cream);border-radius:10px;padding:16px;margin-bottom:16px;">
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px;">\ud83d\udce6 Produtos selecionados</div>
        <div style="font-size:18px;font-weight:700;">${(draft.itens||[]).filter(i=>i.prodId||i.nome).length}</div>
      </div>

      <!-- PRE\u00c7O FINAL \u2014 \u00fanico valor exibido -->
      <div style="background:linear-gradient(135deg,var(--primary),var(--primary-light));border-radius:12px;padding:20px;text-align:center;margin-bottom:16px;">
        <div style="font-size:12px;color:rgba(255,255,255,.8);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px;">\ud83d\udc8e Pre\u00e7o de Venda</div>
        <div style="font-size:32px;font-weight:700;color:#fff;" id="orc-preco-final">${$c(precoFinal)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:4px;">Valor final para o cliente</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        <button class="btn btn-primary" id="btn-orc-save" style="width:100%;padding:13px;font-size:15px;">
          \ud83d\udcbe ${isEdit?'Atualizar Or\u00e7amento':'Salvar Or\u00e7amento'}
        </button>
        <button class="btn btn-ghost" id="btn-orc-wpp-draft" style="background:#25D366;color:#fff;border-color:#25D366;width:100%;padding:11px;">
          \ud83d\udcac Enviar via WhatsApp
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-orc-back2" style="width:100%;">Cancelar</button>
      </div>

      <div style="margin-top:16px;background:var(--petal);border-radius:8px;padding:10px;font-size:11px;color:var(--muted);text-align:center;">
        \ud83d\udd12 Os detalhes de c\u00e1lculo s\u00e3o internos e n\u00e3o aparecem para o cliente
      </div>
    </div>
  </div>
</div>`;
  }

  // \u2500\u2500 VISUALIZA\u00c7\u00c3O DETALHADA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if(view === 'detail'){
    const o = orcamentos.find(x=>x.id===S._orcDetail);
    if(!o) return`<div class="card"><div class="empty"><p>Or\u00e7amento n\u00e3o encontrado</p></div></div>`;
    const { precoFinal } = calcOrcamento(o.itens||[]);
    const dataStr = o.criadoEm ? new Date(o.criadoEm).toLocaleString('pt-BR') : '\u2014';
    const link = `${window.location?.origin||''}${window.location?.pathname||''}?orc=${o.id}`;
    const wppMsg = encodeURIComponent(
      `*Or\u00e7amento \u2014 ${o.titulo||'La\u00e7os Eternos'}*\n` +
      (o.cliente?`\ud83d\udc64 Cliente: ${o.cliente}\n`:'') +
      `\n\ud83d\udce6 *Itens:*\n` +
      (o.itens||[]).filter(i=>i.nome).map(i=>`\u2022 ${i.nome} \u00d7 ${i.qty}`).join('\n') +
      `\n\n\ud83d\udc8e *Pre\u00e7o de Venda: ${$c(precoFinal)}*` +
      (o.obs?`\n\n\ud83d\udcdd ${o.obs}`:'') +
      `\n\n_Or\u00e7amento gerado por La\u00e7os Eternos Floricultura_`
    );

    return`
<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
  <button class="btn btn-ghost btn-sm" id="btn-orc-back">\u2190 Voltar</button>
  <h2 style="font-family:'Playfair Display',serif;font-size:20px;color:var(--primary);">\ud83d\udccb ${o.titulo||'Or\u00e7amento'}</h2>
</div>

<div class="g2" style="gap:16px;align-items:start;">
  <div>
    <!-- Info -->
    <div class="card" style="margin-bottom:14px;">
      <div style="display:flex;gap:20px;flex-wrap:wrap;">
        ${o.cliente?`<div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Cliente</div><div style="font-weight:600;margin-top:4px;">\ud83d\udc64 ${o.cliente}</div></div>`:''}
        <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Data</div><div style="font-weight:600;margin-top:4px;">\ud83d\udcc5 ${dataStr}</div></div>
        <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Status</div><div style="font-weight:600;margin-top:4px;">${o.status||'Pendente'}</div></div>
      </div>
      ${o.obs?`<div style="margin-top:12px;background:var(--cream);border-radius:8px;padding:10px;font-size:13px;color:var(--muted);">\ud83d\udcdd ${o.obs}</div>`:''}
    </div>

    <!-- Itens -->
    <div class="card">
      <div class="card-title">\ud83c\udf38 Itens</div>
      <table>
        <thead><tr><th>Produto</th><th>Qtd</th><th></th></tr></thead>
        <tbody>
          ${(o.itens||[]).filter(i=>i.nome||i.prodId).map(i=>{
            const prod = S.products.find(p=>p._id===i.prodId);
            return`<tr>
              <td style="font-weight:500">${i.nome||prod?.name||'\u2014'}</td>
              <td><span class="tag t-blue">${i.qty||1} un</span></td>
              <td></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Resumo + A\u00e7\u00f5es -->
  <div>
    <div class="card" style="position:sticky;top:80px;">
      <div style="background:linear-gradient(135deg,var(--primary),var(--primary-light));border-radius:12px;padding:24px;text-align:center;margin-bottom:16px;">
        <div style="font-size:12px;color:rgba(255,255,255,.8);margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">\ud83d\udc8e Pre\u00e7o de Venda</div>
        <div style="font-size:36px;font-weight:700;color:#fff;">${$c(precoFinal)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <a href="https://wa.me/${wpp}?text=${wppMsg}" target="_blank"
           style="display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:#fff;border:none;padding:13px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;">
          \ud83d\udcac Enviar via WhatsApp
        </a>
        <button class="btn btn-ghost" data-orc-edit="${o.id}" style="width:100%;">\u270f\ufe0f Editar Or\u00e7amento</button>
        <button class="btn btn-primary" id="btn-orc-convert" data-orc-id="${o.id}" style="width:100%;background:var(--leaf);">
          \ud83d\uded2 Converter em Pedido
        </button>
        <button class="btn btn-ghost btn-sm" id="btn-orc-back2" style="width:100%;">\u2190 Voltar</button>
      </div>
    </div>
  </div>
</div>`;
  }

  return'';
}
