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
import { STOCK_UNITS, UNIT_LABEL } from '../utils/stock.js';

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
  ${_lista.podeGerir ? (_novo ? formNovo() : `<div style="margin-bottom:12px;"><button class="btn btn-primary" onclick="invNovo()">➕ Novo inventário</button></div>`) : ''}
  <div class="card">
    <div class="card-title">🧾 Inventários</div>
    <div style="font-size:12px;color:var(--muted);margin:-4px 0 10px;">A folha impressa sai <b>sem a quantidade do sistema</b> (contagem às cegas): quem conta escreve o que vê, e o sistema mostra a diferença depois.</div>
    ${!inv.length ? `<div class="empty"><div class="empty-icon">🧾</div><p>Nenhum inventário ainda.</p></div>` : `
    <div style="display:grid;gap:8px;">${inv.map(i => `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:#fff;">
        <div style="flex:1;min-width:200px;">
          <div style="font-weight:800;font-size:14px;">${esc(i.titulo)}</div>
          <div style="font-size:12px;color:var(--muted);">${esc(UNIT_LABEL[i.unidade] || i.unidade)} · ${_br(i.data)} · ${esc((i.responsaveis || []).map(r => r.nome).join(', '))}</div>
          <div style="font-size:12px;margin-top:3px;">${i.resumo.contados}/${i.resumo.total} contados${_lista.podeGerir && i.resumo.contados ? ` · <b style="color:${i.resumo.comDiferenca ? '#B45309' : '#15803D'};">${i.resumo.comDiferenca} com diferença</b>` : ''}</div>
        </div>
        ${_selo(i.status)}
        <button class="btn btn-primary btn-sm" onclick="invAbrir('${i._id}')">${i.status === 'aberto' && (i.souResponsavel || _lista.podeGerir) ? '📝 Abrir / contar' : '👁️ Abrir'}</button>
      </div>`).join('')}</div>`}
  </div>`;
}

function formNovo() {
  const n = _novo;
  const colabs = _equipe().filter(c => c && c.active !== false && !/entregador/i.test(String(c.cargo || '')) && !/painel\s*tv/i.test(String(c.name || '')))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const cats = [...new Set((S.products || []).filter(p => p.archived !== true).flatMap(p => [...(Array.isArray(p.categories) ? p.categories : []), p.category]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const q = (n.busca || '').toLowerCase().trim();
  const achados = q.length >= 2 ? (S.products || []).filter(p => p.archived !== true && String(p.name || '').toLowerCase().includes(q) && !n.produtos.includes(String(p._id))).slice(0, 8) : [];
  const nomeProd = (id) => (S.products || []).find(p => String(p._id) === id)?.name || id;
  const qtdCat = (c) => (S.products || []).filter(p => p.archived !== true && [...(p.categories || []), p.category].includes(c)).length;
  return `<div class="card" style="margin-bottom:14px;border:2px solid #BFDBFE;">
    <div class="card-title">➕ Novo inventário</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;">
      <label class="fl">Data<input class="fi" type="date" id="inv-data" value="${esc(n.data)}" onchange="invCampo('data',this.value)"/></label>
      <label class="fl">Unidade<select class="fi" id="inv-unid" onchange="invCampo('unidade',this.value)">${STOCK_UNITS.map(u => `<option value="${esc(u)}" ${n.unidade === u ? 'selected' : ''}>${esc(UNIT_LABEL[u] || u)}</option>`).join('')}</select></label>
    </div>
    <div class="fl" style="margin-top:10px;">Responsável(is)</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${colabs.map(c => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;border:1px solid ${n.resp[c._id] ? '#3B82F6' : 'var(--border)'};background:${n.resp[c._id] ? '#EFF6FF' : '#fff'};border-radius:999px;padding:4px 10px;cursor:pointer;">
      <input type="checkbox" ${n.resp[c._id] ? 'checked' : ''} onchange="invResp('${esc(c._id)}', this.checked)"/> ${esc(c.name)}</label>`).join('')}</div>
    <div class="fl" style="margin-top:12px;">Categorias inteiras</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${cats.map(c => `<label style="font-size:12px;display:flex;align-items:center;gap:4px;border:1px solid ${n.categorias.includes(c) ? '#7C3AED' : 'var(--border)'};background:${n.categorias.includes(c) ? '#F5F3FF' : '#fff'};border-radius:999px;padding:4px 10px;cursor:pointer;">
      <input type="checkbox" ${n.categorias.includes(c) ? 'checked' : ''} onchange="invCat(this.dataset.c, this.checked)" data-c="${esc(c)}"/> ${esc(c)} <span style="color:var(--muted);">${qtdCat(c)}</span></label>`).join('')}</div>
    <div class="fl" style="margin-top:12px;">E/ou produtos específicos</div>
    <input class="fi" id="inv-busca" placeholder="Digite o nome do produto…" value="${esc(n.busca || '')}" oninput="invBusca(this.value)" style="max-width:420px;"/>
    ${achados.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${achados.map(p => `<button type="button" class="btn btn-ghost btn-xs" onclick="invProd('${p._id}', true)">+ ${esc(p.name)}</button>`).join('')}</div>` : ''}
    ${n.produtos.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${n.produtos.map(id => `<span style="font-size:12px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:999px;padding:3px 9px;">${esc(nomeProd(id))} <a href="#" onclick="invProd('${id}', false);return false;" style="color:var(--red);text-decoration:none;">✕</a></span>`).join('')}</div>` : ''}
    <label class="fl" style="margin-top:12px;display:block;">Observação para quem vai contar<textarea class="fi" id="inv-obs" rows="2" style="width:100%;" oninput="invCampo('obsGerencia',this.value)">${esc(n.obsGerencia || '')}</textarea></label>
    <label style="font-size:12px;display:flex;gap:6px;align-items:center;margin-top:8px;"><input type="checkbox" ${n.mostrarSistema ? 'checked' : ''} onchange="invCampo('mostrarSistema',this.checked)"/> Mostrar a quantidade do sistema na folha e pra quem conta <span style="color:var(--muted);">(não recomendado — tende a copiar o número)</span></label>
    <div style="display:flex;gap:8px;margin-top:12px;">
      <button class="btn btn-primary" onclick="invCriar()">✅ Criar inventário</button>
      <button class="btn btn-ghost" onclick="invNovoCancelar()">Cancelar</button>
    </div>
  </div>`;
}

window.invRecarregar = () => carregarInventarios(true);
window.invNovo = () => { _novo = { data: _hoje(), unidade: STOCK_UNITS[0], resp: {}, categorias: [], produtos: [], busca: '', obsGerencia: '', mostrarSistema: false }; _rerender(); };
window.invNovoCancelar = () => { _novo = null; _rerender(); };
window.invCampo = (k, v) => { if (_novo) _novo[k] = v; };
window.invResp = (id, on) => { if (!_novo) return; if (on) _novo.resp[id] = true; else delete _novo.resp[id]; _rerender(); };
window.invCat = (c, on) => { if (!_novo) return; _novo.categorias = on ? [...new Set([..._novo.categorias, c])] : _novo.categorias.filter(x => x !== c); _rerender(); };
let _buscaT = null;
window.invBusca = (v) => { if (!_novo) return; _novo.busca = v; clearTimeout(_buscaT); _buscaT = setTimeout(() => { _rerender(); setTimeout(() => { const el = document.getElementById('inv-busca'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 30); }, 350); };
window.invProd = (id, on) => { if (!_novo) return; _novo.produtos = on ? [...new Set([..._novo.produtos, String(id)])] : _novo.produtos.filter(x => x !== String(id)); if (on) _novo.busca = ''; _rerender(); };
window.invCriar = async () => {
  const n = _novo; if (!n) return;
  const colabs = _equipe();
  const responsaveis = Object.keys(n.resp).map(id => ({ id, nome: colabs.find(c => String(c._id) === id)?.name || '' }));
  if (!responsaveis.length) return toast('Escolha pelo menos um responsável.', true);
  if (!n.categorias.length && !n.produtos.length) return toast('Escolha categorias ou produtos.', true);
  try {
    const inv = await POST('/inventarios', { data: n.data, unidade: n.unidade, responsaveis, categorias: n.categorias, produtos: n.produtos, obsGerencia: n.obsGerencia, mostrarSistema: !!n.mostrarSistema });
    toast(`✅ Inventário criado com ${inv.itens?.length || 0} itens.`);
    _novo = null; carregarInventarios(true);
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
  const cats = [...new Set(inv.itens.map(i => i.categoria || 'Sem categoria'))];
  const linhas = cats.map(c => `<tr><td colspan="${verSistema ? (ger ? 5 : 4) : 3}" style="background:#F8FAFC;font-weight:800;font-size:12px;padding:6px 8px;">${esc(c)}</td></tr>` + inv.itens.filter(i => (i.categoria || 'Sem categoria') === c).map(i => {
    const dif = ger && i.contado !== null && i.contado !== undefined ? i.contado - i.sistema : null;
    return `<tr>
      <td style="padding:6px 8px;font-size:13px;">${esc(i.nome)}${i.sku ? `<div style="font-size:10px;color:var(--muted);">${esc(i.sku)}</div>` : ''}</td>
      ${verSistema ? `<td style="text-align:center;font-size:13px;color:var(--muted);">${i.sistema ?? '—'}</td>` : ''}
      <td style="text-align:center;"><input type="number" min="0" inputmode="numeric" class="fi" data-inv-qtd="${esc(i.productId)}" value="${i.contado ?? ''}" ${editavel ? '' : 'disabled'} style="width:80px;text-align:center;font-weight:700;"/></td>
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
    <div class="tw" style="margin-top:10px;max-height:60vh;overflow:auto;"><table style="width:100%;border-collapse:collapse;">
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
}
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
  const rows = cats.map(c => `<tr class="cat"><td colspan="${ver ? 5 : 4}">${esc(c)}</td></tr>` + inv.itens.filter(i => (i.categoria || 'Sem categoria') === c).map(i => `<tr><td class="n">${++n}</td><td>${esc(i.nome)}</td>${ver ? `<td class="c">${i.sistema ?? ''}</td>` : ''}<td class="box"></td><td class="obs"></td></tr>`).join('')).join('');
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
