// ── PRECIFICAÇÃO (markup divisor + lista de materiais + mão de obra) ──
// Portado do FlorExe (Documents/FlorExe) com as MESMAS funcionalidades:
//   1. Regra de precificação (despesas, impostos, comissão, lucro, perda
//      + mão de obra da equipe diluída como % do faturamento)
//   2. Calcular preço a partir dos materiais (markup divisor) e salvar no
//      catálogo
//   3. Calculadora numérica simples
// Acesso: ADM e Gerente sempre; funcionário só se o ADM liberar o módulo
// 'precificacao' (gating feito em services/auth.can + nav em main.js).
import { S } from '../state.js';
import { toast } from '../utils/helpers.js';
import { $c } from '../utils/formatters.js';
import { GET, PUT, POST } from '../services/api.js';

const LS_CFG = 'fv_prec_cfg';
const SETTINGS_KEY = 'precificacao';
const CFG_DEFAULT = {
  despesas: 20, impostos: 6, comissao: 5, lucro: 20, perda: 15,
  num_funcionarios: 1, custo_funcionario: 1500, faturamento_mes: 20000,
};

let _precCfgReady = false;

function _getCfgLocal() {
  try {
    const raw = localStorage.getItem(LS_CFG);
    if (raw) return { ...CFG_DEFAULT, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...CFG_DEFAULT };
}
function _saveCfgLocal(cfg) {
  try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) {}
}

function _initState() {
  if (!(S._precCfg && typeof S._precCfg === 'object')) S._precCfg = _getCfgLocal();
  if (!Array.isArray(S._precMateriais)) S._precMateriais = [];
}

// Lista de categorias já existentes (pra autocompletar ao salvar no catálogo)
function _categorias() {
  const set = new Set();
  for (const p of (S.products || [])) {
    const cs = Array.isArray(p.categories) ? p.categories : [p.category || p.categoria].filter(Boolean);
    cs.forEach(c => { if (c && String(c).trim()) set.add(String(c).trim()); });
  }
  try {
    const extra = JSON.parse(localStorage.getItem('fv_categorias') || '[]');
    if (Array.isArray(extra)) extra.forEach(c => { if (c) set.add(String(c)); });
  } catch (_) {}
  return [...set].sort((a, b) => a.localeCompare(b));
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ── RENDER ───────────────────────────────────────────────────
export function renderPrecificacao() {
  _initState();
  const f = S._precCfg;
  const cats = _categorias();
  const podeSalvarProd = !(typeof window.can === 'function') || window.can('products');

  return `
<div style="max-width:1100px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:18px;">
    <h1 style="font-family:'Playfair Display',serif;font-size:26px;color:var(--ink,#1E293B);margin:0 0 4px;">💲 Precificação</h1>
    <p style="font-size:13px;color:var(--muted);margin:0;">Calcule o preço de venda justo dos seus arranjos (markup + mão de obra) e salve no catálogo</p>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1.3fr;gap:18px;align-items:start;">

    <!-- ── REGRA ── -->
    <div class="card">
      <h3 style="font-weight:700;color:var(--rose,#8B2252);margin-bottom:6px;">⚙️ Sua Regra de Precificação</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">Percentuais sobre o <strong>preço de venda</strong>.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="fg"><label class="fl">Despesas fixas (%)</label><input class="fi" type="number" id="prec-despesas" step="0.1" value="${f.despesas}" data-prec-recalc/></div>
        <div class="fg"><label class="fl">Impostos (%)</label><input class="fi" type="number" id="prec-impostos" step="0.1" value="${f.impostos}" data-prec-recalc/></div>
        <div class="fg"><label class="fl">Comissão (%)</label><input class="fi" type="number" id="prec-comissao" step="0.1" value="${f.comissao}" data-prec-recalc/></div>
        <div class="fg"><label class="fl">Lucro desejado (%)</label><input class="fi" type="number" id="prec-lucro" step="0.1" value="${f.lucro}" data-prec-recalc/></div>
        <div class="fg" style="grid-column:1/-1;"><label class="fl">Perda de flores (%) — só perecíveis</label><input class="fi" type="number" id="prec-perda" step="0.1" value="${f.perda}" data-prec-recalc/></div>
      </div>

      <div style="margin-top:14px;border-top:1px solid var(--border,#f3e8ff);padding-top:12px;">
        <strong style="color:var(--rose,#8B2252);font-size:14px;">👥 Mão de Obra (equipe)</strong>
        <p style="font-size:12px;color:var(--muted);margin:4px 0 10px;">O custo da equipe é diluído como % sobre o faturamento.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="fg"><label class="fl">Nº de funcionários</label><input class="fi" type="number" id="prec-num-func" min="0" value="${f.num_funcionarios}" data-prec-recalc/></div>
          <div class="fg"><label class="fl">Custo mensal por funcionário (R$)</label><input class="fi" type="number" id="prec-custo-func" step="0.01" min="0" value="${f.custo_funcionario}" data-prec-recalc/></div>
          <div class="fg" style="grid-column:1/-1;"><label class="fl">Faturamento médio mensal (R$)</label><input class="fi" type="number" id="prec-faturamento" step="0.01" min="0" value="${f.faturamento_mes}" data-prec-recalc/></div>
        </div>
        <div id="prec-maoobra-info" style="background:#EFF6FF;border-radius:8px;padding:8px;font-size:13px;color:#1E40AF;margin-top:6px;"></div>
      </div>

      <button class="btn btn-primary" style="margin-top:14px;" id="prec-save-cfg">💾 Salvar Regra</button>
    </div>

    <!-- ── CALCULAR PREÇO ── -->
    <div class="card" style="background:var(--rose-l,#f8f0fb);">
      <h3 style="font-weight:700;color:var(--rose,#8B2252);margin-bottom:10px;">🧮 Calcular Preço</h3>
      <label style="font-size:13px;font-weight:600;color:var(--ink,#374151);">Materiais do produto</label>
      <div style="display:flex;gap:8px;align-items:flex-end;margin-top:6px;">
        <div class="fg" style="flex:1;"><input class="fi" type="text" id="prec-mat-desc" placeholder="Ex: 12 rosas, vaso, fita..."/></div>
        <div class="fg" style="width:120px;"><input class="fi" type="number" id="prec-mat-valor" step="0.01" min="0" placeholder="Custo R$"/></div>
        <button class="btn btn-primary" id="prec-add-mat">➕</button>
      </div>
      <div id="prec-materiais-lista" style="margin-top:10px;"></div>

      <div style="margin-top:12px;">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:13px;cursor:pointer;">
          <input type="checkbox" id="prec-perecivel" checked data-prec-recalc> 🌹 Produto perecível (aplica a % de perda)
        </label>
      </div>

      <div id="prec-resultado" style="margin-top:14px;"></div>

      <div style="margin-top:16px;border-top:2px solid var(--border,#e8c9de);padding-top:14px;">
        ${podeSalvarProd ? `
        <div class="fg" style="margin-bottom:8px;"><label class="fl">Salvar como produto (opcional)</label><input class="fi" type="text" id="prec-nome" placeholder="Nome do produto..."/></div>
        <div class="fg" style="margin-bottom:10px;"><label class="fl">Categoria</label>
          <input class="fi" type="text" id="prec-categoria" list="prec-cat-list" placeholder="Digite ou escolha..."/>
          <datalist id="prec-cat-list">${cats.map(c => `<option value="${_esc(c)}"></option>`).join('')}</datalist>
        </div>
        <button class="btn btn-primary" style="width:100%;" id="prec-save-prod">💾 Salvar no Catálogo</button>
        ` : `<div style="font-size:12px;color:var(--muted);text-align:center;">Para salvar no catálogo é preciso permissão de <strong>Produtos</strong>.</div>`}
      </div>
    </div>
  </div>

  <!-- ── CALCULADORA NUMÉRICA ── -->
  <div class="card" style="max-width:300px;margin-top:18px;">
    <h3 style="font-weight:700;color:var(--rose,#8B2252);margin-bottom:10px;">🧮 Calculadora</h3>
    <input type="text" id="prec-calc-display" readonly style="width:100%;box-sizing:border-box;text-align:right;font-size:22px;padding:10px;border:2px solid var(--border,#e8c9de);border-radius:8px;background:#fff;margin-bottom:8px;" placeholder="0"/>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
      ${['C','⌫','÷','×','7','8','9','−','4','5','6','+','1','2','3','=','0','.'].map(t => {
        const op = ['÷','×','−','+'].includes(t);
        const igual = t === '=';
        const limpar = t === 'C' || t === '⌫';
        const span = t === '0' ? 'grid-column:span 2' : igual ? 'grid-row:span 2' : '';
        const bg = igual ? 'var(--rose,#8B2252)' : op ? '#f3e8ff' : limpar ? '#fee2e2' : '#fff';
        const cor = igual ? '#fff' : '#1f2937';
        return `<button type="button" data-prec-key="${t}" style="${span};padding:12px;font-size:17px;font-weight:600;border:1px solid var(--border,#e8c9de);border-radius:8px;background:${bg};color:${cor};cursor:pointer;">${t}</button>`;
      }).join('')}
    </div>
  </div>
</div>`;
}

// ── LÓGICA ───────────────────────────────────────────────────
function _lerCfg() {
  const num = parseFloat(document.getElementById('prec-num-func')?.value) || 0;
  const custoFunc = parseFloat(document.getElementById('prec-custo-func')?.value) || 0;
  const faturamento = parseFloat(document.getElementById('prec-faturamento')?.value) || 0;
  const custoEquipe = num * custoFunc;
  const maoObraPct = faturamento > 0 ? (custoEquipe / faturamento * 100) : 0;
  return {
    despesas: parseFloat(document.getElementById('prec-despesas')?.value) || 0,
    impostos: parseFloat(document.getElementById('prec-impostos')?.value) || 0,
    comissao: parseFloat(document.getElementById('prec-comissao')?.value) || 0,
    lucro:    parseFloat(document.getElementById('prec-lucro')?.value) || 0,
    perda:    parseFloat(document.getElementById('prec-perda')?.value) || 0,
    num_funcionarios: num, custo_funcionario: custoFunc, faturamento_mes: faturamento,
    custoEquipe, maoObraPct,
  };
}

function _renderMateriais() {
  const el = document.getElementById('prec-materiais-lista');
  if (!el) return;
  const mats = S._precMateriais || [];
  const total = mats.reduce((s, m) => s + m.valor, 0);
  if (!mats.length) {
    el.innerHTML = '<p style="font-size:12px;color:var(--muted);">Nenhum material adicionado. Liste cada item com o custo.</p>';
    return;
  }
  el.innerHTML = `
    <table style="width:100%;font-size:13px;border-collapse:collapse;">
      <tbody>
        ${mats.map((m, i) => `
          <tr style="border-bottom:1px solid var(--border,#f3e8ff);">
            <td style="padding:4px 0;">${_esc(m.desc)}</td>
            <td style="text-align:right;font-weight:600;">${$c(m.valor)}</td>
            <td style="text-align:right;width:34px;"><button type="button" data-prec-del-mat="${i}" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:14px;">🗑️</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-weight:700;color:var(--rose,#8B2252);">
      <span>Custo total dos materiais:</span><span>${$c(total)}</span>
    </div>`;
  // Religa os botões de excluir (lista é re-renderizada)
  el.querySelectorAll('[data-prec-del-mat]').forEach(b => {
    b.onclick = () => {
      const i = Number(b.dataset.precDelMat);
      S._precMateriais.splice(i, 1);
      _renderMateriais();
      _calcular();
    };
  });
}

function _calcular() {
  const el = document.getElementById('prec-resultado');
  if (!el) return;
  const c = _lerCfg();

  const mo = document.getElementById('prec-maoobra-info');
  if (mo) mo.innerHTML = `👥 Equipe: ${c.num_funcionarios} func. × ${$c(c.custo_funcionario)} = <strong>${$c(c.custoEquipe)}/mês</strong> → mão de obra = <strong>${c.maoObraPct.toFixed(1)}%</strong> do faturamento`;

  const custoTotal = (S._precMateriais || []).reduce((s, m) => s + m.valor, 0);
  const perecivel = document.getElementById('prec-perecivel')?.checked;
  const perdaPct = perecivel ? c.perda : 0;
  const somaPct = c.despesas + c.impostos + c.comissao + c.lucro + perdaPct + c.maoObraPct;
  const divisor = 1 - somaPct / 100;

  if (divisor <= 0) {
    el.innerHTML = `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:14px;color:#dc2626;font-size:13px;">⚠️ A soma dos percentuais (${somaPct.toFixed(1)}%) chegou a 100% ou mais. Reduza algum percentual ou aumente o faturamento médio.</div>`;
    return;
  }
  if (custoTotal <= 0) {
    el.innerHTML = `<div style="color:var(--muted);font-size:13px;">Adicione os materiais para calcular o preço.</div>`;
    return;
  }

  const preco = custoTotal / divisor;
  const despesasV = preco * c.despesas / 100;
  const impostosV = preco * c.impostos / 100;
  const comissaoV = preco * c.comissao / 100;
  const maoObraV  = preco * c.maoObraPct / 100;
  const perdaV    = preco * perdaPct / 100;
  const lucroV    = preco - custoTotal - despesasV - impostosV - comissaoV - maoObraV - perdaV;
  const margem    = preco > 0 ? (lucroV / preco * 100) : 0;
  const markup    = custoTotal > 0 ? (preco / custoTotal) : 0;
  S._precUltimo = { custoTotal, preco };

  const linha = (lbl, v, cor) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:2px 0;"><span style="color:var(--muted);">${lbl}</span><span style="color:${cor || 'var(--ink,#374151)'};">${$c(v)}</span></div>`;

  el.innerHTML = `
    <div style="background:#fff;border:2px solid var(--rose,#8B2252);border-radius:12px;padding:16px;text-align:center;margin-bottom:12px;">
      <div style="font-size:12px;color:var(--muted);">💡 PREÇO DE VENDA SUGERIDO</div>
      <div style="font-size:34px;font-weight:800;color:var(--rose,#8B2252);">${$c(preco)}</div>
      <div style="font-size:12px;color:var(--muted);">Markup ×${markup.toFixed(2)} · Margem real ${margem.toFixed(1)}%</div>
    </div>
    <div style="background:#fff;border-radius:10px;padding:12px;">
      <div style="font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-bottom:6px;">Composição do preço</div>
      ${linha('Custo dos materiais', custoTotal)}
      ${linha('Mão de obra (' + c.maoObraPct.toFixed(1) + '%)', maoObraV)}
      ${linha('Despesas fixas (' + c.despesas + '%)', despesasV)}
      ${linha('Impostos (' + c.impostos + '%)', impostosV)}
      ${linha('Comissão (' + c.comissao + '%)', comissaoV)}
      ${perecivel ? linha('Perda de flores (' + c.perda + '%)', perdaV) : ''}
      <div style="border-top:1px solid var(--border,#f3e8ff);margin-top:4px;padding-top:4px;">${linha('🪙 Lucro líquido', lucroV, '#16a34a')}</div>
    </div>`;
}

function _addMaterial() {
  const descEl = document.getElementById('prec-mat-desc');
  const valEl = document.getElementById('prec-mat-valor');
  const desc = (descEl?.value || '').trim();
  const valor = parseFloat(valEl?.value) || 0;
  if (!desc) { toast('Informe o material.', true); return; }
  if (valor <= 0) { toast('Informe o custo.', true); return; }
  S._precMateriais.push({ desc, valor });
  if (descEl) descEl.value = '';
  if (valEl) valEl.value = '';
  descEl?.focus();
  _renderMateriais();
  _calcular();
}

async function _salvarCfg() {
  const c = _lerCfg();
  const cfg = {
    despesas: c.despesas, impostos: c.impostos, comissao: c.comissao, lucro: c.lucro, perda: c.perda,
    num_funcionarios: c.num_funcionarios, custo_funcionario: c.custo_funcionario, faturamento_mes: c.faturamento_mes,
  };
  S._precCfg = cfg;
  _saveCfgLocal(cfg);
  try {
    await PUT('/settings/' + SETTINGS_KEY, { value: cfg });
    toast('✅ Regra de precificação salva!');
  } catch (e) {
    // Mesmo se o backend recusar, fica salvo localmente
    toast('💾 Regra salva neste dispositivo (não consegui sincronizar: ' + (e.message || 'erro') + ')', true);
  }
}

async function _salvarProduto() {
  if (typeof window.can === 'function' && !window.can('products')) {
    toast('Você não tem permissão para salvar produtos.', true); return;
  }
  const nome = (document.getElementById('prec-nome')?.value || '').trim();
  if (!nome) { toast('Informe o nome do produto.', true); return; }
  const u = S._precUltimo;
  if (!u || u.preco <= 0) { toast('Adicione os materiais para calcular o preço.', true); return; }
  const categoria = (document.getElementById('prec-categoria')?.value || '').trim();
  const btn = document.getElementById('prec-save-prod');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
  try {
    const novo = await POST('/products', {
      name: nome, nome,
      categories: categoria ? [categoria] : [],
      category: categoria || '',
      costPrice: +u.custoTotal.toFixed(2),
      salePrice: +u.preco.toFixed(2),
      stock: 0, minStock: 5,
      activeOnSite: false, // entra como rascunho — admin ativa no site depois
      description: 'Precificado: ' + (S._precMateriais || []).map(m => m.desc).join(', '),
    });
    if (novo && (novo._id || novo.id || novo.ok !== false)) {
      if (Array.isArray(S.products)) S.products.unshift(novo);
      toast('✅ Produto salvo no catálogo!');
      const nEl = document.getElementById('prec-nome'); if (nEl) nEl.value = '';
    } else {
      toast('Erro ao salvar produto.', true);
    }
  } catch (e) {
    toast('Erro ao salvar produto: ' + (e.message || 'erro'), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Salvar no Catálogo'; }
  }
}

// Calculadora numérica
function _calcTecla(t) {
  const d = document.getElementById('prec-calc-display');
  if (!d) return;
  if (t === 'C') { d.value = ''; return; }
  if (t === '⌫') { d.value = d.value.slice(0, -1); return; }
  if (t === '=') {
    try {
      const expr = d.value.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
      if (!/^[0-9+\-*/.() ]+$/.test(expr) || !expr) { d.value = 'Erro'; return; }
      const r = Function('"use strict";return (' + expr + ')')();
      d.value = (Math.round(r * 100) / 100).toString();
    } catch (e) { d.value = 'Erro'; }
    return;
  }
  if (d.value === 'Erro') d.value = '';
  d.value += t;
}

// ── BIND ─────────────────────────────────────────────────────
export function bindPrecificacaoEvents() {
  _initState();

  // Carrega a regra do backend (compartilhada) na primeira vez
  if (!_precCfgReady) {
    GET('/settings/' + SETTINGS_KEY).then(r => {
      _precCfgReady = true;
      const val = r && (r.value || r);
      if (val && typeof val === 'object' && (val.despesas != null || val.lucro != null)) {
        S._precCfg = { ...CFG_DEFAULT, ...val };
        _saveCfgLocal(S._precCfg);
        import('../main.js').then(m => m.render()).catch(() => {});
      }
    }).catch(() => { _precCfgReady = true; });
  }

  // Recalcula ao digitar (regra + perecível) — sem re-render do framework
  document.querySelectorAll('[data-prec-recalc]').forEach(el => {
    el.addEventListener('input', _calcular);
    el.addEventListener('change', _calcular);
  });

  // Materiais
  document.getElementById('prec-add-mat')?.addEventListener('click', _addMaterial);
  ['prec-mat-desc', 'prec-mat-valor'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _addMaterial(); }
    });
  });

  // Salvar regra / produto
  document.getElementById('prec-save-cfg')?.addEventListener('click', _salvarCfg);
  document.getElementById('prec-save-prod')?.addEventListener('click', _salvarProduto);

  // Calculadora numérica
  document.querySelectorAll('[data-prec-key]').forEach(b => {
    b.addEventListener('click', () => _calcTecla(b.dataset.precKey));
  });

  _renderMateriais();
  _calcular();
}
