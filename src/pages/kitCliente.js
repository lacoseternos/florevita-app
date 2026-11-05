// ── 🧩 KIT PERSONALIZADO PELO CLIENTE: itens que compõem (Marcia 05/nov/2026) ──
// Ao lançar o kit no PDV abre este pop-up. Os itens ficam DENTRO da linha do
// kit (item.componentes): vão para a produção e a comanda, baixam do estoque e
// contam como complemento. O preço começa com a soma e pode ser ajustado.
import { S, PDV } from '../state.js';
import { $c, esc } from '../utils/formatters.js';

const _norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const ehKitCliente = (nome) => /kit\s+personali[sz].*cliente/.test(_norm(nome));

const FILTROS = {
  '': 'Todos',
  flores: '🌸 Flores',
  chocolates: '🍫 Chocolates',
  baloes: '🎈 Balões',
  pelucias: '🧸 Pelúcias',
};
const RE = {
  chocolates: /chocolate|ferrero|bombom|lindt|kinder|nutella|sonho de valsa|ouro branco|brigadeiro|trufa|raffaello|toblerone/,
  baloes: /balao/,
  pelucias: /pelucia|urso/,
  flores: /\b(flor|flores|rosa|rosas|girassol|girassois|lirio|lirios|gerbera|gerberas|astromelia|astromelias|orquidea|orquideas|crisantemo|tulipa|tulipas)\b/,
};
const _textoProd = (p) => _norm(`${p.name || p.nome || ''} ${p.category || p.categoria || ''} ${(p.categories || []).join(' ')}`);
const _precoProd = (p) => Number(p.salePrice || p.preco || 0);
const _nomeProd = (p) => p.name || p.nome || '';

let _st = null;

export const somaKit = (lista) => (lista || []).reduce((s, c) => s + (Number(c.unitPrice) || 0) * (Number(c.qty) || 0), 0);

// Texto que a produção e a comanda leem junto com a descrição do kit.
export function notasDoKit(item) {
  const comp = item?.componentes || [];
  const lista = comp.length ? `Itens do kit: ${comp.map(c => `${c.qty}x ${c.name}`).join(', ')}` : '';
  return [lista, item?.notes].filter(Boolean).join('\n') || undefined;
}

function _resultados() {
  const q = _norm(_st.busca), f = _st.filtro;
  const mapa = new Map();
  for (const p of (S.products || [])) {
    if (!p?._id || p.archived === true || ehKitCliente(_nomeProd(p)) || mapa.has(String(p._id))) continue;
    const t = _textoProd(p);
    if (q && !q.split(/\s+/).every(w => t.includes(w))) continue;
    if (f && !RE[f].test(t)) continue;
    mapa.set(String(p._id), p);
  }
  return [...mapa.values()].sort((a, b) => _nomeProd(a).localeCompare(_nomeProd(b), 'pt-BR')).slice(0, 30);
}

function _pintarLista() {
  const box = document.getElementById('kit-result'); if (!box) return;
  const r = _resultados();
  box.innerHTML = r.length ? r.map(p => {
    const id = String(p._id), n = _st.itens.find(c => c.product === id)?.qty || 0;
    return `<button type="button" data-kit-add="${esc(id)}" style="display:flex;justify-content:space-between;gap:8px;width:100%;padding:8px 10px;border:none;border-bottom:1px solid var(--border);background:${n ? '#F5F3FF' : '#fff'};cursor:pointer;text-align:left;font-size:13px;">
      <span>${esc(_nomeProd(p))}${n ? ` <b style="color:#5B21B6;">(${n})</b>` : ''}</span><b style="white-space:nowrap;">${$c(_precoProd(p))}</b></button>`;
  }).join('') : '<div style="padding:14px;font-size:13px;color:var(--muted);text-align:center;">Nenhum produto encontrado.</div>';
}

function _pintarEscolhidos() {
  const box = document.getElementById('kit-esc'); if (!box) return;
  box.innerHTML = _st.itens.length ? _st.itens.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px;">
      <span style="flex:1;min-width:0;">${esc(c.name)}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-kit-menos="${esc(c.product)}" aria-label="Diminuir">−</button>
      <b style="min-width:18px;text-align:center;">${c.qty}</b>
      <button type="button" class="btn btn-ghost btn-sm" data-kit-mais="${esc(c.product)}" aria-label="Aumentar">+</button>
      <span style="min-width:72px;text-align:right;font-weight:700;">${$c(c.unitPrice * c.qty)}</span>
    </div>`).join('') : '<div style="font-size:13px;color:var(--muted);padding:6px 0;">Escolha acima o que vai no kit.</div>';
  const soma = somaKit(_st.itens);
  if (!_st.manual) _st.preco = soma;
  const s = document.getElementById('kit-soma'); if (s) s.textContent = $c(soma);
  const i = document.getElementById('kit-preco');
  if (i && document.activeElement !== i) i.value = _st.preco ? Number(_st.preco).toFixed(2) : '';
  const u = document.getElementById('kit-usar-soma');
  if (u) u.style.display = _st.manual && Math.abs(soma - _st.preco) > 0.004 ? '' : 'none';
}

function _alterar(id, delta) {
  const atual = _st.itens.find(c => c.product === id);
  if (atual) {
    atual.qty += delta;
    if (atual.qty <= 0) _st.itens = _st.itens.filter(c => c !== atual);
  } else if (delta > 0) {
    const p = (S.products || []).find(x => String(x._id) === id);
    if (p) _st.itens.push({ product: id, name: _nomeProd(p), qty: 1, unitPrice: _precoProd(p) });
  }
  _pintarLista(); _pintarEscolhidos();
}

export function abrirKitItens(cartId, aoSalvar) {
  const item = PDV.cart.find(i => i.id === cartId); if (!item) return;
  document.getElementById('kit-popup')?.remove();
  _st = {
    cartId, aoSalvar, busca: '', filtro: '',
    itens: (item.componentes || []).map(c => ({ ...c })),
    manual: !!item.kitPrecoManual, preco: Number(item.price) || 0,
  };
  const el = document.createElement('div');
  el.id = 'kit-popup';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="padding:14px 18px 8px;"><div style="font-size:17px;font-weight:900;">🧩 Itens do kit</div>
      <div style="font-size:12px;color:var(--muted);">O que o cliente escolheu, incluindo chocolates e balões.</div></div>
    <div style="padding:0 18px;">
      <input class="fi" id="kit-busca" placeholder="Buscar produto…" autocomplete="off" style="width:100%;"/>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;">${Object.entries(FILTROS).map(([k, l]) => `<button type="button" class="btn btn-sm ${k ? 'btn-ghost' : 'btn-primary'}" data-kit-filtro="${k}">${l}</button>`).join('')}</div>
    </div>
    <div style="flex:1;min-height:110px;overflow:auto;margin:0 18px;border:1px solid var(--border);border-radius:10px;" id="kit-result"></div>
    <div style="padding:8px 18px 0;max-height:26vh;overflow:auto;" id="kit-esc"></div>
    <div style="padding:10px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;">
      <span>Soma: <b id="kit-soma"></b></span>
      <label style="display:flex;align-items:center;gap:6px;margin-left:auto;font-weight:700;">Preço do kit (R$)
        <input class="fi" id="kit-preco" type="number" min="0" step="0.01" style="width:110px;font-weight:800;"/></label>
      <button type="button" class="btn btn-ghost btn-sm" id="kit-usar-soma">Usar a soma</button>
    </div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;">
      <button type="button" class="btn btn-primary" id="kit-ok" style="flex:1;justify-content:center;">Concluir</button>
      <button type="button" class="btn btn-ghost" id="kit-fechar">Fechar sem salvar</button>
    </div></div>`;
  document.body.appendChild(el);

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.kitAdd) _alterar(b.dataset.kitAdd, 1);
    else if (b.dataset.kitMais) _alterar(b.dataset.kitMais, 1);
    else if (b.dataset.kitMenos) _alterar(b.dataset.kitMenos, -1);
    else if (b.dataset.kitFiltro !== undefined) {
      _st.filtro = b.dataset.kitFiltro;
      el.querySelectorAll('[data-kit-filtro]').forEach(x => {
        x.classList.toggle('btn-primary', x === b); x.classList.toggle('btn-ghost', x !== b);
      });
      _pintarLista();
    } else if (b.id === 'kit-usar-soma') { _st.manual = false; _pintarEscolhidos(); }
    else if (b.id === 'kit-fechar') { el.remove(); _st = null; }
    else if (b.id === 'kit-ok') {
      const { itens, preco, manual } = _st, cb = _st.aoSalvar;
      PDV.cart = PDV.cart.map(i => i.id === cartId ? { ...i, componentes: itens, price: Math.max(0, Number(preco) || 0), kitPrecoManual: manual } : i);
      el.remove(); _st = null; cb?.();
    }
  });
  document.getElementById('kit-busca').addEventListener('input', (e) => { _st.busca = e.target.value; _pintarLista(); });
  document.getElementById('kit-preco').addEventListener('input', (e) => { _st.manual = true; _st.preco = Math.max(0, parseFloat(e.target.value) || 0); _pintarEscolhidos(); });
  _pintarLista(); _pintarEscolhidos();
  document.getElementById('kit-busca').focus();
}
