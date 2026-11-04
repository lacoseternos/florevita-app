// ── 🧾 INVENTÁRIO (contagem física do estoque) — Marcia 30/out/2026 ──
// Gerência cria (data, unidade, responsáveis, categorias e/ou produtos).
// Responsáveis imprimem a folha (contagem ÀS CEGAS: a folha não mostra o
// saldo do sistema, salvo se a gerência liberar), contam e lançam aqui.
// Gerência revisa "No sistema × Contado × Diferença" e aplica no estoque.
// A tela do inventário abre num painel próprio (fora do render do app) pra
// não perder o que foi digitado num re-render.
import { S } from '../state.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { getColabs } from '../services/auth.js';
import { STOCK_UNITS, UNIT_LABEL, getStockUnit } from '../utils/stock.js';

let _lista = null, _at = 0, _loading = false, _novo = null, _aberto = null, _colabsSrv = null;
// Equipe: o cadastro guardado no aparelho; se vazio, busca no servidor.
function _equipe() {
  const loc = getColabs();
  if (loc.length) return loc;
  if (_colabsSrv === null) { _colabsSrv = []; GET('/collaborators').then(l => { _colabsSrv = Array.isArray(l) ? l : (l?.data || []); _rerender(); }).catch(() => {}); }
  return _colabsSrv;
}
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _br = (d) => String(d || '').split('-').reverse().join('/');
const _hoje = () => new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
const STATUS = { aberto: ['📝 Em contagem', '#1D4ED8', '#EFF6FF'], concluido: ['✅ Contagem concluída — revisar', '#B45309', '#FFFBEB'], aplicado: ['📦 Aplicado no estoque', '#15803D', '#ECFDF5'], cancelado: ['✖ Cancelado', '#64748B', '#F1F5F9'] };
const _selo = (st) => { const s = STATUS[st] || STATUS.aberto; return `<span style="font-size:11px;font-weight:800;color:${s[1]};background:${s[2]};border-radius:999px;padding:2px 9px;white-space:nowrap;">${s[0]}</span>`; };

export function carregarInventarios(forcar = false) {
  if (_loading || (!forcar && _lista && Date.now() - _at < 300000)) return;
  _loading = true;
  GET('/inventarios').then(x => { _lista = x; }).catch(() => { if (!_lista) _lista = { erro: true, inventarios: [] }; })
    .finally(() => { _loading = false; _at = Date.now(); _rerender(); });
}

// ── Aba "Inventários" do Estoque (gerência vê todos; responsável, os dela) ──
export function renderInventariosTab() {
  carregarInventarios();
  if (!_lista) return `<div class="card" style="color:var(--muted);">⏳ Carregando inventários…</div>`;
  if (_lista.erro) return `<div class="card" style="color:var(--red);">Não foi possível carregar os inventários. <button class="btn btn-ghost btn-sm" onclick="invRecarregar()">Tentar de novo</button></div>`;
  const inv = _lista.inventarios || [];
  return `
  ${_lista.podeGerir ? `<div style="margin-bottom:12px;"><button class="btn btn-primary" onclick="invNovo()">➕ Novo inventário</button></div>` : ''}
  <div class="card">
    <div class="card-title">🧾 Inventários</div>
    <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">A folha impressa sai <b>sem a quantidade do sistema</b> (contagem às cegas): quem conta escreve o que vê, e o sistema mostra a diferença depois.</div>
    ${!inv.length ? `<div class="empty"><div class="empty-icon">🧾</div><p>Nenhum inventário ainda.</p></div>` : `
    <div style="display:grid;gap:8px;">${inv.map(i => `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:#fff;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:800;font-size:14px;">${esc(i.titulo)}</div>
          <div style="font-size:12px;color:var(--muted);">${esc(UNIT_LABEL[i.unidade] || i.unidade)} · ${_br(i.data)} · ${esc((i.responsaveis || []).map(r => r.nome).join(', '))}</div>
          <div style="height:5px;background:#E2E8F0;border-radius:5px;margin-top:6px;max-width:320px;overflow:hidden;"><div style="height:100%;width:${i.resumo.total ? Math.round(i.resumo.contados * 100 / i.resumo.total) : 0}%;background:${i.resumo.contados === i.resumo.total ? '#16A34A' : '#2563EB'};"></div></div>
          <div style="font-size:12px;margin-top:3px;">${i.resumo.contados}/${i.resumo.total} contados${_lista.podeGerir && i.resumo.contados ? ` · <b style="color:${i.resumo.comDiferenca ? '#B45309' : '#15803D'};">${i.resumo.comDiferenca} com diferença</b>` : ''}</div>
        </div>
        ${_selo(i.status)}
        <button class="btn btn-primary btn-sm" onclick="invAbrir('${i._id}')">${i.status === 'aberto' && (i.souResponsavel || _lista.podeGerir) ? '📝 Abrir / contar' : '👁️ Abrir'}</button>
      </div>`).join('')}</div>`}
  </div>`;
}

// ── Novo inventário: assistente em 3 passos (Marcia 04/nov) ──
// 1) dados e quem conta · 2) produtos, um a um ou em lote · 3) quem conta o quê.
// Painel próprio, fora do render do app: digitar não perde o foco nem a seleção.
const _catsDe = (p) => [...new Set([...(Array.isArray(p.categories) ? p.categories : []), p.category, p.categoria].filter(Boolean).map(String))];
const _catPrincipal = (p) => _catsDe(p)[0] || 'Sem categoria';
const _subsDe = (p) => [...new Set([...(Array.isArray(p.subcategorias) ? p.subcategorias : []), p.subcategoria].filter(Boolean).map(String))];
const _prods = () => (S.products || []).filter(p => p && p.archived !== true);
const _iniciais = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const _norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function _equipeInv() {
  return _equipe().filter(c => c && c.active !== false && !/entregador/i.test(String(c.cargo || '')) && !/painel\s*tv/i.test(String(c.name || '')));
}
const _daUnidade = (c, u) => [c.unidade, ...(Array.isArray(c.unidades) ? c.unidades : [])].some(x => x === u || /todas/i.test(String(x || '')));

function _passoResp(n) {
  const q = _norm(n.buscaResp);
  const equipe = _equipeInv().filter(c => !q || _norm(c.name).includes(q) || _norm(c.cargo).includes(q))
    .sort((a, b) => (_daUnidade(b, n.unidade) - _daUnidade(a, n.unidade)) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  return equipe.map(c => {
    const id = String(c._id), on = n.resp.includes(id);
    return `<button type="button" onclick="invResp('${esc(id)}')" style="display:flex;align-items:center;gap:8px;text-align:left;background:${on ? '#EFF6FF' : '#fff'};border:1.5px solid ${on ? '#3B82F6' : 'var(--border)'};border-radius:10px;padding:8px 10px;cursor:pointer;">
      <span style="flex:0 0 32px;width:32px;height:32px;border-radius:50%;background:${on ? '#2563EB' : '#E2E8F0'};color:${on ? '#fff' : '#475569'};font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;">${on ? '✓' : esc(_iniciais(c.name))}</span>
      <span style="min-width:0;"><span style="display:block;font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.name)}</span>
      <span style="display:block;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.cargo || '')}${_daUnidade(c, n.unidade) ? '' : ' · outra unidade'}</span></span>
    </button>`;
  }).join('') || `<div style="color:var(--muted);font-size:13px;padding:10px;">Ninguém encontrado.</div>`;
}

function _filtrados(n) {
  const q = _norm(n.busca);
  return _prods().filter(p => {
    if (q && !_norm(p.name).includes(q) && !_norm(p.sku || p.code).includes(q)) return false;
    if (n.cat && !_catsDe(p).includes(n.cat) && !(n.cat === 'Sem categoria' && !_catsDe(p).length)) return false;
    if (n.sub && !_subsDe(p).includes(n.sub)) return false;
    const saldo = getStockUnit(p, n.unidade);
    if (n.saldo === 'com' && saldo <= 0) return false;
    if (n.saldo === 'sem' && saldo > 0) return false;
    return true;
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

function _listaProdutos(n) {
  const lista = _filtrados(n);
  const el = document.getElementById('inv-plista');
  if (el) el.innerHTML = lista.length ? lista.map(p => {
    const id = String(p._id), on = n.sel.has(id), saldo = getStockUnit(p, n.unidade);
    return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;background:${on ? '#F5F3FF' : '#fff'};">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="invProd('${esc(id)}', this.checked)" style="width:18px;height:18px;flex:0 0 18px;"/>
      <span style="flex:1;min-width:0;"><span style="display:block;font-weight:600;font-size:13px;">${esc(p.name)}</span>
      <span style="display:block;font-size:11px;color:var(--muted);">${esc(_catPrincipal(p))}${_subsDe(p).length ? ' › ' + esc(_subsDe(p).join(', ')) : ''}${p.sku || p.code ? ' · ' + esc(p.sku || p.code) : ''}</span></span>
      <span style="font-size:12px;font-weight:700;color:${saldo > 0 ? '#334155' : '#94A3B8'};white-space:nowrap;">${saldo} no estoque</span>
    </label>`;
  }).join('') : `<div style="color:var(--muted);font-size:13px;padding:16px;text-align:center;">Nenhum produto com esse filtro.</div>`;
  const marcados = lista.filter(p => n.sel.has(String(p._id))).length;
  const info = document.getElementById('inv-pinfo');
  if (info) info.innerHTML = `Mostrando <b>${lista.length}</b> · <b style="color:#6D28D9;">${n.sel.size} selecionado(s) no total</b>`;
  const bt = document.getElementById('inv-ptodos');
  if (bt) bt.textContent = marcados === lista.length && lista.length ? `Desmarcar os ${lista.length}` : `✓ Marcar os ${lista.length} da lista`;
  document.querySelectorAll('[data-inv-chip]').forEach(ch => {
    const c = ch.dataset.invChip, ps = c ? _prods().filter(p => _catsDe(p).includes(c)) : _prods();
    const s = ps.filter(p => n.sel.has(String(p._id))).length;
    const b = ch.querySelector('b'); if (b) b.textContent = s ? `${s}/${ps.length}` : String(ps.length);
    ch.style.background = n.cat === c ? '#6D28D9' : (s ? '#F5F3FF' : '#fff');
    ch.style.color = n.cat === c ? '#fff' : '#334155';
    ch.style.borderColor = n.cat === c || s ? '#7C3AED' : 'var(--border)';
  });
}

function _porCategoria(n) {
  const grupos = new Map();
  for (const p of _prods()) if (n.sel.has(String(p._id))) { const c = _catPrincipal(p); grupos.set(c, (grupos.get(c) || 0) + 1); }
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
}

function _corpoNovo(n) {
  if (n.passo === 1) return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
      <label class="fl">Data<input class="fi" type="date" value="${esc(n.data)}" onchange="invCampo('data',this.value)"/></label>
      <label class="fl">Unidade<select class="fi" onchange="invCampo('unidade',this.value);invDesenhar()">${STOCK_UNITS.map(u => `<option value="${esc(u)}" ${n.unidade === u ? 'selected' : ''}>${esc(UNIT_LABEL[u] || u)}</option>`).join('')}</select></label>
      <label class="fl">Nome (opcional)<input class="fi" value="${esc(n.titulo)}" placeholder="Ex.: Vasos e adubos" maxlength="80" oninput="invCampo('titulo',this.value)"/></label>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px;">
      <div class="fl" style="margin:0;">Quem vai contar? <span style="font-weight:400;color:var(--muted);" id="inv-rinfo">${n.resp.length} escolhida(s)</span></div>
      <input class="fi" placeholder="Buscar pessoa…" value="${esc(n.buscaResp)}" oninput="invCampo('buscaResp',this.value);invRespLista()" style="max-width:220px;"/>
    </div>
    <div id="inv-rlista" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin-top:8px;max-height:44vh;overflow:auto;">${_passoResp(n)}</div>`;

  if (n.passo === 2) {
    const cats = [...new Set(_prods().flatMap(_catsDe))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const subs = n.cat ? [...new Set(_prods().filter(p => _catsDe(p).includes(n.cat)).flatMap(_subsDe))].sort((a, b) => a.localeCompare(b, 'pt-BR')) : [];
    const chip = (c, l) => `<button type="button" data-inv-chip="${esc(c)}" onclick="invFiltroCat(this.dataset.invChip)" style="font-size:12px;border:1.5px solid var(--border);border-radius:999px;padding:4px 10px;background:#fff;cursor:pointer;white-space:nowrap;">${esc(l)} <b style="font-weight:800;"></b></button>`;
    return `
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <input class="fi" id="inv-busca" placeholder="🔍 Buscar por nome ou código…" value="${esc(n.busca)}" oninput="invCampo('busca',this.value);invListar()" style="flex:1;min-width:190px;"/>
      <select class="fi" style="max-width:190px;" onchange="invCampo('saldo',this.value);invListar()">
        ${[['', 'Com ou sem estoque'], ['com', 'Só com estoque'], ['sem', 'Só sem estoque']].map(([v, l]) => `<option value="${v}" ${n.saldo === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      ${subs.length ? `<select class="fi" style="max-width:190px;" onchange="invCampo('sub',this.value);invListar()"><option value="">Todas as subcategorias</option>${subs.map(s => `<option value="${esc(s)}" ${n.sub === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;max-height:92px;overflow:auto;">${chip('', 'Todas')}${cats.map(c => chip(c, c)).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <div id="inv-pinfo" style="font-size:12px;color:var(--muted);"></div>
      <div style="display:flex;gap:6px;">
        <button type="button" id="inv-ptodos" class="btn btn-ghost btn-xs" onclick="invMarcarLista()"></button>
        <button type="button" class="btn btn-ghost btn-xs" onclick="invLimparSel()">Limpar tudo</button>
      </div>
    </div>
    <div id="inv-plista" style="border:1px solid var(--border);border-radius:10px;margin-top:6px;max-height:46vh;overflow:auto;"></div>`;
  }

  const grupos = _porCategoria(n);
  const pessoas = n.resp.map(id => ({ id, nome: _equipeInv().find(c => String(c._id) === id)?.name || '' }));
  return `
    <div style="background:#F8FAFC;border-radius:10px;padding:10px 12px;font-size:13px;">
      <b>${_br(n.data)}</b> · ${esc(UNIT_LABEL[n.unidade] || n.unidade)} · <b>${n.sel.size}</b> produto(s) em ${grupos.length} categoria(s) · ${esc(pessoas.map(p => p.nome).join(', '))}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;">
      <div class="fl" style="margin:0;">Quem conta o quê</div>
      ${pessoas.length > 1 ? `<button type="button" class="btn btn-ghost btn-xs" onclick="invDividir()">⚖️ Dividir igualmente</button>` : ''}
    </div>
    <div style="border:1px solid var(--border);border-radius:10px;margin-top:6px;max-height:34vh;overflow:auto;">
      ${grupos.map(([c, q]) => `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);">
        <span style="flex:1;min-width:0;font-size:13px;font-weight:600;">${esc(c)} <span style="color:var(--muted);font-weight:400;">${q}</span></span>
        ${pessoas.length > 1 ? `<select class="fi" data-c="${esc(c)}" style="max-width:170px;padding:4px 6px;" onchange="invDiv(this.dataset.c,this.value)"><option value="">Qualquer uma</option>${pessoas.map(p => `<option value="${esc(p.id)}" ${n.divisao[c] === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select>`
          : `<span style="font-size:12px;color:var(--muted);">${esc(pessoas[0]?.nome || '')}</span>`}
      </div>`).join('')}
    </div>
    <label class="fl" style="margin-top:12px;display:block;">Recado para quem vai contar<textarea class="fi" rows="2" style="width:100%;" oninput="invCampo('obsGerencia',this.value)">${esc(n.obsGerencia)}</textarea></label>
    <label style="font-size:12px;display:flex;gap:6px;align-items:flex-start;margin-top:8px;"><input type="checkbox" ${n.mostrarSistema ? 'checked' : ''} onchange="invCampo('mostrarSistema',this.checked)"/> <span>Mostrar a quantidade do sistema para quem conta. <span style="color:var(--muted);">Desmarcado é mais confiável: quem conta anota só o que vê.</span></span></label>`;
}

function _desenharNovo() {
  const n = _novo;
  let el = document.getElementById('inv-novo');
  if (!n) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'inv-novo'; el.style.cssText = 'position:fixed;inset:0;z-index:8500;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;'; document.body.appendChild(el); }
  const passos = ['Dados e equipe', 'Produtos', 'Revisar'];
  const podeAvancar = n.passo === 1 ? n.resp.length > 0 : n.passo === 2 ? n.sel.size > 0 : true;
  el.innerHTML = `<div style="background:#fff;border-radius:18px;max-width:760px;width:100%;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="padding:14px 18px 10px;border-bottom:1px solid var(--border);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="font-size:17px;font-weight:900;">🧾 Novo inventário</div>
        <button type="button" onclick="invNovoCancelar()" title="Fechar" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1;">×</button>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">${passos.map((p, i) => { const k = i + 1, at = n.passo === k, ok = n.passo > k; return `<div style="flex:1;min-width:0;">
        <div style="height:4px;border-radius:4px;background:${at || ok ? '#2563EB' : '#E2E8F0'};"></div>
        <div style="font-size:11px;margin-top:3px;font-weight:${at ? 800 : 500};color:${at ? '#1D4ED8' : 'var(--muted)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ok ? '✓ ' : k + '. '}${p}</div></div>`; }).join('')}</div>
    </div>
    <div style="padding:14px 18px;overflow:auto;flex:1;">${_corpoNovo(n)}</div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:space-between;">
      <button type="button" class="btn btn-ghost" onclick="${n.passo === 1 ? 'invNovoCancelar()' : 'invPasso(-1)'}">${n.passo === 1 ? 'Cancelar' : '← Voltar'}</button>
      ${n.passo < 3 ? `<button type="button" id="inv-avancar" class="btn btn-primary" ${podeAvancar ? '' : 'disabled style="opacity:.5;"'} onclick="invPasso(1)">Continuar →</button>`
        : `<button type="button" class="btn btn-primary" onclick="invCriar()">✅ Criar inventário</button>`}
    </div>
  </div>`;
  if (n.passo === 2) _listaProdutos(n);
}
const _atualizarAvancar = () => {
  const b = document.getElementById('inv-avancar'); if (!b || !_novo) return;
  const ok = _novo.passo === 1 ? _novo.resp.length > 0 : _novo.sel.size > 0;
  b.disabled = !ok; b.style.opacity = ok ? '' : '.5';
};

window.invRecarregar = () => carregarInventarios(true);
window.invNovo = () => {
  _novo = { passo: 1, data: _hoje(), unidade: STOCK_UNITS[0], titulo: '', resp: [], buscaResp: '', sel: new Set(), busca: '', cat: '', sub: '', saldo: '', divisao: {}, obsGerencia: '', mostrarSistema: false };
  // Catálogo pode não ter vindo ainda: garante antes de abrir a lista.
  if (!_prods().length) GET('/products?limit=2000').then(p => { if (Array.isArray(p) && p.length) { S.products = p; if (_novo) _desenharNovo(); } }).catch(() => {});
  _desenharNovo();
};
window.invNovoCancelar = () => { if (_novo && (_novo.sel.size || _novo.resp.length) && !confirm('Sair sem criar o inventário?')) return; _novo = null; _desenharNovo(); };
window.invDesenhar = () => _desenharNovo();
window.invCampo = (k, v) => { if (_novo) _novo[k] = v; };
window.invRespLista = () => { const el = document.getElementById('inv-rlista'); if (el && _novo) el.innerHTML = _passoResp(_novo); };
window.invResp = (id) => {
  if (!_novo) return;
  _novo.resp = _novo.resp.includes(id) ? _novo.resp.filter(x => x !== id) : [..._novo.resp, id];
  window.invRespLista();
  const i = document.getElementById('inv-rinfo'); if (i) i.textContent = `${_novo.resp.length} escolhida(s)`;
  _atualizarAvancar();
};
window.invPasso = (d) => {
  if (!_novo) return;
  if (d > 0 && _novo.passo === 1 && !_novo.resp.length) return toast('Escolha quem vai contar.', true);
  if (d > 0 && _novo.passo === 2 && !_novo.sel.size) return toast('Escolha pelo menos um produto.', true);
  _novo.passo = Math.max(1, Math.min(3, _novo.passo + d));
  _desenharNovo();
};
window.invListar = () => { if (_novo) _listaProdutos(_novo); };
window.invFiltroCat = (c) => { if (!_novo) return; _novo.cat = _novo.cat === c ? '' : c; _novo.sub = ''; _desenharNovo(); };
window.invProd = (id, on) => { if (!_novo) return; if (on) _novo.sel.add(String(id)); else _novo.sel.delete(String(id)); _listaProdutos(_novo); _atualizarAvancar(); };
window.invMarcarLista = () => {
  if (!_novo) return;
  const lista = _filtrados(_novo).map(p => String(p._id));
  const todos = lista.length && lista.every(id => _novo.sel.has(id));
  lista.forEach(id => { if (todos) _novo.sel.delete(id); else _novo.sel.add(id); });
  _listaProdutos(_novo); _atualizarAvancar();
};
window.invLimparSel = () => { if (!_novo) return; _novo.sel.clear(); _listaProdutos(_novo); _atualizarAvancar(); };
window.invDiv = (c, id) => { if (!_novo) return; if (id) _novo.divisao[c] = id; else delete _novo.divisao[c]; };
// Maior categoria primeiro, sempre pra quem está com menos itens.
window.invDividir = () => {
  if (!_novo) return;
  const carga = Object.fromEntries(_novo.resp.map(id => [id, 0]));
  _novo.divisao = {};
  for (const [c, q] of [..._porCategoria(_novo)].sort((a, b) => b[1] - a[1])) {
    const id = _novo.resp.reduce((m, x) => carga[x] < carga[m] ? x : m, _novo.resp[0]);
    _novo.divisao[c] = id; carga[id] += q;
  }
  _desenharNovo();
};
window.invCriar = async () => {
  const n = _novo; if (!n) return;
  const colabs = _equipe();
  const responsaveis = n.resp.map(id => ({ id, nome: colabs.find(c => String(c._id) === id)?.name || '' }));
  if (!responsaveis.length) return toast('Escolha quem vai contar.', true);
  if (!n.sel.size) return toast('Escolha pelo menos um produto.', true);
  try {
    const inv = await POST('/inventarios', { data: n.data, unidade: n.unidade, titulo: n.titulo, responsaveis, categorias: [], produtos: [...n.sel], divisao: n.divisao, obsGerencia: n.obsGerencia, mostrarSistema: !!n.mostrarSistema });
    toast(`✅ Inventário criado com ${inv.itens?.length || 0} itens.`);
    _novo = null; _desenharNovo(); carregarInventarios(true);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao criar'), true); }
};

// ── Painel do inventário (contagem / revisão) ──
window.invAbrir = async (id) => {
  try { _aberto = await GET('/inventarios/' + id); }
  catch (e) { return toast('❌ ' + (e.message || 'Erro ao abrir'), true); }
  desenharPainel();
};
function desenharPainel() {
  const inv = _aberto; if (!inv) return;
  let el = document.getElementById('inv-painel');
  if (!el) { el = document.createElement('div'); el.id = 'inv-painel'; el.style.cssText = 'position:fixed;inset:0;z-index:8500;background:rgba(15,23,42,.55);display:flex;align-items:flex-start;justify-content:center;padding:12px;overflow-y:auto;'; document.body.appendChild(el); }
  const ger = inv.podeGerir, editavel = inv.status === 'aberto' || (ger && inv.status === 'concluido');
  const verSistema = ger || inv.mostrarSistema;
  const meuNome = _norm(S.user?.name || S.user?.nome);
  const temDivisao = inv.itens.some(i => i.responsavelNome);
  const padraoMeus = !ger && temDivisao && inv.itens.some(i => _norm(i.responsavelNome) === meuNome);
  const cats = [...new Set(inv.itens.map(i => i.categoria || 'Sem categoria'))];
  const linhas = cats.map(c => `<tr data-inv-cat="${esc(c)}"><td colspan="${verSistema ? (ger ? 5 : 4) : 3}" style="background:#F8FAFC;font-weight:800;font-size:12px;padding:6px 8px;">${esc(c)}</td></tr>` + inv.itens.filter(i => (i.categoria || 'Sem categoria') === c).map(i => {
    const dif = ger && i.contado !== null && i.contado !== undefined ? i.contado - i.sistema : null;
    return `<tr data-inv-row data-cat="${esc(c)}" data-nome="${esc(_norm(i.nome + ' ' + (i.sku || '')))}" data-meu="${_norm(i.responsavelNome) === meuNome ? 1 : 0}" data-sis="${i.sistema ?? ''}">
      <td style="padding:6px 8px;font-size:13px;">${esc(i.nome)}${i.sku || i.responsavelNome ? `<div style="font-size:10px;color:var(--muted);">${esc(i.sku || '')}${i.sku && i.responsavelNome ? ' · ' : ''}${i.responsavelNome ? '👤 ' + esc(i.responsavelNome) : ''}</div>` : ''}</td>
      ${verSistema ? `<td style="text-align:center;font-size:13px;color:var(--muted);">${i.sistema ?? '—'}</td>` : ''}
      <td style="text-align:center;"><input type="number" min="0" inputmode="numeric" class="fi" data-inv-qtd="${esc(i.productId)}" value="${i.contado ?? ''}" ${editavel ? '' : 'disabled'} oninput="invProgresso()" onkeydown="invEnter(event,this)" style="width:80px;text-align:center;font-weight:700;"/></td>
      ${ger ? `<td style="text-align:center;font-weight:800;color:${dif === null ? 'var(--muted)' : dif === 0 ? '#15803D' : dif < 0 ? '#B91C1C' : '#1D4ED8'};">${dif === null ? '—' : dif > 0 ? '+' + dif : dif}</td>` : ''}
      <td><input class="fi" data-inv-obs="${esc(i.productId)}" value="${esc(i.obs || '')}" ${editavel ? '' : 'disabled'} placeholder="Observação" style="width:100%;min-width:120px;font-size:12px;"/></td>
    </tr>`;
  }).join('')).join('');
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:860px;width:100%;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,.3);margin:auto 0;">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap;">
      <div>
        <div style="font-size:18px;font-weight:900;">🧾 ${esc(inv.titulo)}</div>
        <div style="font-size:12px;color:var(--muted);">${esc(UNIT_LABEL[inv.unidade] || inv.unidade)} · ${_br(inv.data)} · Responsável(is): ${esc((inv.responsaveis || []).map(r => r.nome).join(', '))}</div>
        <div style="margin-top:4px;">${_selo(inv.status)} <span style="font-size:12px;color:var(--muted);">${inv.resumo.contados}/${inv.resumo.total} contados${ger && inv.resumo.contados ? ` · ${inv.resumo.comDiferenca} com diferença` : ''}</span></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="invImprimir()">🖨️ Imprimir folha</button>
        <button class="btn btn-ghost btn-sm" onclick="invFechar()">✕ Fechar</button>
      </div>
    </div>
    ${inv.obsGerencia ? `<div style="margin-top:8px;font-size:12px;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 10px;"><b>Da gerência:</b> ${esc(inv.obsGerencia)}</div>` : ''}
    <div style="height:7px;background:#E2E8F0;border-radius:7px;margin-top:10px;overflow:hidden;"><div id="inv-barra" style="height:100%;width:0;background:#2563EB;transition:width .2s;"></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">
      <input class="fi" id="inv-fbusca" placeholder="🔍 Buscar produto…" oninput="invFiltrar()" style="flex:1;min-width:170px;"/>
      <select class="fi" id="inv-ffiltro" onchange="invFiltrar()" style="max-width:190px;">
        <option value="">Todos os itens</option>
        ${temDivisao ? `<option value="meus" ${padraoMeus ? 'selected' : ''}>Só os meus</option>` : ''}
        <option value="faltam">Faltam contar</option>
        ${ger ? '<option value="dif">Com diferença</option>' : ''}
      </select>
      <span id="inv-fconta" style="font-size:12px;color:var(--muted);"></span>
    </div>
    <div class="tw" style="margin-top:8px;max-height:52vh;overflow:auto;"><table style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:11px;color:var(--muted);text-transform:uppercase;"><th style="text-align:left;padding:6px 8px;">Produto</th>${verSistema ? '<th>No sistema</th>' : ''}<th>Contado</th>${ger ? '<th>Diferença</th>' : ''}<th style="text-align:left;">Observações</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
    <label class="fl" style="display:block;margin-top:10px;">Observações gerais da contagem<textarea class="fi" id="inv-obsgeral" rows="2" style="width:100%;" ${editavel ? '' : 'disabled'}>${esc(inv.obsGeral || '')}</textarea></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
      ${editavel ? `<button class="btn btn-ghost" onclick="invSalvar(false)">💾 Salvar (continuar depois)</button>` : ''}
      ${inv.status === 'aberto' ? `<button class="btn btn-primary" onclick="invSalvar(true)">✅ Concluir contagem</button>` : ''}
      ${ger && inv.status === 'concluido' ? `<button class="btn btn-primary" onclick="invAplicar()">📦 Aplicar ao estoque</button><button class="btn btn-ghost" onclick="invReabrir()">↩️ Reabrir contagem</button>` : ''}
      ${ger && (inv.status === 'aberto' || inv.status === 'concluido') ? `<button class="btn btn-ghost" style="color:var(--red);margin-left:auto;" onclick="invCancelar()">✖ Cancelar inventário</button>` : ''}
    </div>
  </div>`;
  window.invFiltrar(); window.invProgresso();
}
// Busca e filtros só escondem linhas: o que foi digitado continua lá.
window.invFiltrar = () => {
  const q = _norm(document.getElementById('inv-fbusca')?.value), f = document.getElementById('inv-ffiltro')?.value || '';
  const visiveis = new Set(); let n = 0;
  document.querySelectorAll('#inv-painel [data-inv-row]').forEach(tr => {
    const v = tr.querySelector('[data-inv-qtd]')?.value ?? '';
    const ok = (!q || tr.dataset.nome.includes(q)) && (f !== 'meus' || tr.dataset.meu === '1') && (f !== 'faltam' || v === '')
      && (f !== 'dif' || (v !== '' && Number(v) !== Number(tr.dataset.sis)));
    tr.style.display = ok ? '' : 'none';
    if (ok) { n++; visiveis.add(tr.dataset.cat); }
  });
  document.querySelectorAll('#inv-painel [data-inv-cat]').forEach(tr => { tr.style.display = visiveis.has(tr.dataset.invCat) ? '' : 'none'; });
  const c = document.getElementById('inv-fconta'); if (c) c.textContent = n + ' item(ns)';
};
window.invProgresso = () => {
  const qs = [...document.querySelectorAll('#inv-painel [data-inv-qtd]')];
  const b = document.getElementById('inv-barra');
  if (b && qs.length) { const f = qs.filter(x => x.value !== '').length; b.style.width = Math.round(f * 100 / qs.length) + '%'; b.style.background = f === qs.length ? '#16A34A' : '#2563EB'; }
};
// Enter vai pro próximo item visível: conta sem tirar a mão do teclado.
window.invEnter = (e, el) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const qs = [...document.querySelectorAll('#inv-painel [data-inv-qtd]')].filter(x => x.closest('tr').style.display !== 'none');
  const prox = qs[qs.indexOf(el) + 1];
  if (prox) { prox.focus(); prox.select(); }
};
const _coletar = () => [...document.querySelectorAll('[data-inv-qtd]')].map(inp => ({
  productId: inp.dataset.invQtd, contado: inp.value === '' ? null : Number(inp.value),
  obs: document.querySelector(`[data-inv-obs="${CSS.escape(inp.dataset.invQtd)}"]`)?.value || '',
}));
window.invFechar = () => { document.getElementById('inv-painel')?.remove(); _aberto = null; carregarInventarios(true); };
window.invSalvar = async (concluir) => {
  if (!_aberto) return;
  if (concluir && !confirm('Concluir a contagem? Depois disso só a gerência reabre.')) return;
  try {
    await PUT(`/inventarios/${_aberto._id}/contagem`, { itens: _coletar(), obsGeral: document.getElementById('inv-obsgeral')?.value || '', concluir: !!concluir });
    toast(concluir ? '✅ Contagem concluída! A gerência vai revisar.' : '💾 Contagem salva.');
    await window.invAbrir(_aberto._id);
  } catch (e) {
    toast('⚠️ ' + (e.message || 'Erro ao salvar'), true);
    if (_aberto) await window.invAbrir(_aberto._id).catch(() => {}); // mostra o que já ficou salvo
  }
};
window.invReabrir = async () => {
  try { await PUT(`/inventarios/${_aberto._id}/contagem`, { itens: _coletar(), reabrir: true }); toast('↩️ Contagem reaberta.'); await window.invAbrir(_aberto._id); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
window.invAplicar = async () => {
  const d = (_aberto.itens || []).filter(i => i.contado !== null && i.contado !== undefined && i.contado !== i.sistema).length;
  if (!confirm(`Aplicar no estoque de ${UNIT_LABEL[_aberto.unidade] || _aberto.unidade}?\n\n${d} produto(s) terão o saldo trocado pelo contado. Fica registrado no histórico de movimentações.`)) return;
  try {
    const r = await POST(`/inventarios/${_aberto._id}/aplicar`, {});
    toast(`📦 Estoque atualizado: ${r.ajustados} produto(s) ajustado(s).`);
    GET('/products').then(p => { if (Array.isArray(p) && p.length) S.products = p; _rerender(); }).catch(() => {});
    GET('/stock/moves').then(m => { if (Array.isArray(m)) S.stockMoves = m; }).catch(() => {});
    await window.invAbrir(_aberto._id);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao aplicar'), true); }
};
window.invCancelar = async () => {
  if (!confirm('Cancelar este inventário? (o estoque não muda)')) return;
  try { await DELETE('/inventarios/' + _aberto._id); toast('Inventário cancelado.'); window.invFechar(); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};

// Folha pra imprimir e escrever à mão (sem o saldo do sistema, salvo se liberado).
window.invImprimir = () => {
  const inv = _aberto; if (!inv) return;
  const ver = inv.mostrarSistema && inv.itens.some(i => i.sistema !== undefined);
  const cats = [...new Set(inv.itens.map(i => i.categoria || 'Sem categoria'))];
  let n = 0;
  const rows = cats.map(c => `<tr class="cat"><td colspan="${ver ? 5 : 4}">${esc(c)}</td></tr>` + inv.itens.filter(i => (i.categoria || 'Sem categoria') === c).map(i => `<tr><td class="n">${++n}</td><td>${esc(i.nome)}${i.responsavelNome ? ` <span style="color:#555;font-size:10px;">(${esc(i.responsavelNome)})</span>` : ''}</td>${ver ? `<td class="c">${i.sistema ?? ''}</td>` : ''}<td class="box"></td><td class="obs"></td></tr>`).join('')).join('');
  const w = window.open('', '_blank');
  if (!w) return toast('Libere os pop-ups do navegador para imprimir.', true);
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(inv.titulo)}</title><style>
    body{font-family:Arial,sans-serif;margin:18px;color:#111;} h1{font-size:18px;margin:0 0 4px;} .info{font-size:12px;margin-bottom:10px;}
    table{width:100%;border-collapse:collapse;font-size:12px;} th,td{border:1px solid #999;padding:6px 6px;} th{background:#eee;text-align:left;}
    td.n{width:28px;text-align:center;color:#555;} td.c{width:70px;text-align:center;} td.box{width:90px;} td.obs{width:38%;}
    tr.cat td{background:#f3f3f3;font-weight:bold;} tr{page-break-inside:avoid;} .ass{margin-top:24px;font-size:12px;display:flex;gap:40px;} .ass div{flex:1;border-top:1px solid #333;padding-top:4px;}
    @media print{button{display:none;}}
  </style></head><body>
    <h1>🧾 ${esc(inv.titulo)}</h1>
    <div class="info">Unidade: <b>${esc(UNIT_LABEL[inv.unidade] || inv.unidade)}</b> · Data: <b>${_br(inv.data)}</b> · Responsável(is): <b>${esc((inv.responsaveis || []).map(r => r.nome).join(', '))}</b>${inv.obsGerencia ? `<br>Obs.: ${esc(inv.obsGerencia)}` : ''}</div>
    <table><thead><tr><th>#</th><th>Produto</th>${ver ? '<th>No sistema</th>' : ''}<th>Contado</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="ass"><div>Contado por</div><div>Conferido por</div><div>Data / hora</div></div>
    <button onclick="window.print()" style="margin-top:16px;padding:8px 14px;">🖨️ Imprimir</button>
    <script>setTimeout(()=>window.print(),300);<\/script>
  </body></html>`);
  w.document.close();
};

// ── Aviso pra quem é responsável (aparece em qualquer tela) ──
export function checarAvisoInventario() {
  if (!S.user) return;
  carregarInventarios();
  const meus = (_lista?.inventarios || []).filter(i => i.souResponsavel && i.status === 'aberto' && i.data <= _hoje());
  let el = document.getElementById('inv-aviso');
  if (!meus.length || document.getElementById('inv-painel')) { el?.remove(); return; }
  if (!el) { el = document.createElement('button'); el.id = 'inv-aviso'; el.type = 'button'; el.style.cssText = 'position:fixed;left:14px;bottom:84px;z-index:8000;background:#1D4ED8;color:#fff;border:none;border-radius:999px;padding:10px 16px;font-weight:800;font-size:13px;box-shadow:0 8px 20px rgba(29,78,216,.35);cursor:pointer;'; document.body.appendChild(el); }
  const i = meus[0];
  el.textContent = `🧾 Você tem inventário para contar — ${UNIT_LABEL[i.unidade] || i.unidade} ${_br(i.data).slice(0, 5)}`;
  el.onclick = () => window.invAbrir(i._id);
}
