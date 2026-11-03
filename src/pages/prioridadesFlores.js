// ── 🌸 PRIORIDADES DO DIA (Marcia 29/out/2026) ──────────────────────
// A montagem (Aninha / Ana Paula, revezando e pulando a folga) preenche até 4
// prioridades de venda, em ordem, as flores ESGOTADAS e observações.
// Marcia 03/nov: tudo acontece num pop-up aberto pelo botão 🌸 da barra
// superior (ao lado do sino) — quem preenche edita, as demais conferem. A
// Produção mostra um resumo. Lista do dia vazia → o pop-up abre sozinho pra
// quem preenche (dá pra adiar 30 min).
import { S } from '../state.js';
import { GET, PUT } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

let _d = null, _at = 0, _loading = false, _cfgAberta = false, _colabs = null;
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _br = (d) => String(d || '').split('-').reverse().slice(0, 2).join('/');
const _hm = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }); };
const _vazio = (r) => !r || (!r.prioridades?.length && !r.acabou && !r.obs);
const ROSA = '#9D174D';

function carregar(forcar = false) {
  if (_loading || (!forcar && _d && Date.now() - _at < 120000)) return;
  _loading = true;
  GET('/prioridades').then(x => { _d = x; }).catch(() => { if (!_d) _d = { erro: true }; })
    .finally(() => { _loading = false; _at = Date.now(); _rerender(); _atualizarModal(); });
}

const CSS = `<style id="prio-css">
  .prio-chip{font-size:12px;display:inline-flex;align-items:center;gap:4px;background:#FDF2F8;color:${ROSA};border:1px solid #FBCFE8;border-radius:999px;padding:4px 10px;cursor:pointer;user-select:none;transition:background .15s,color .15s;}
  .prio-chip input{display:none;}
  .prio-chip:has(input:checked){background:${ROSA};color:#fff;border-color:${ROSA};}
  .prio-slot{display:flex;gap:10px;background:#fff;border:1px solid #FBCFE8;border-radius:12px;padding:10px;}
  .prio-slot:focus-within{border-color:#EC4899;box-shadow:0 0 0 3px rgba(236,72,153,.12);}
  .prio-num{flex:0 0 32px;width:32px;height:32px;border-radius:50%;background:${ROSA};color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;font-size:15px;}
  .prio-mv{background:none;border:1px solid #F1D5E3;border-radius:6px;width:26px;height:22px;cursor:pointer;color:${ROSA};font-size:11px;line-height:1;padding:0;}
  .prio-mv:disabled{opacity:.3;cursor:default;}
  .prio-flor{width:100%;font-size:15px;font-weight:700;border:none;border-bottom:1.5px solid #F1D5E3;padding:4px 2px;outline:none;background:transparent;}
  .prio-flor:focus{border-bottom-color:#EC4899;}
  .prio-obs{width:100%;font-size:12px;border:none;border-bottom:1px dashed #E5E7EB;padding:4px 2px;outline:none;background:transparent;color:#475569;margin-top:6px;}
  .prio-box{border-radius:12px;padding:10px;}
  .prio-box textarea{width:100%;border:none;background:transparent;outline:none;resize:vertical;font:inherit;font-size:13px;margin-top:4px;}
  .prio-tb{position:relative;display:inline-flex;align-items:center;justify-content:center;}
  .prio-tb .prio-badge{position:absolute;top:-4px;right:-4px;border-radius:999px;min-width:14px;height:14px;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 3px;color:#fff;}
  @keyframes prioPulse{0%,100%{box-shadow:0 0 0 0 rgba(236,72,153,.6);}50%{box-shadow:0 0 0 6px rgba(236,72,153,0);}}
  .prio-tb.pulse{animation:prioPulse 1.4s ease-in-out infinite;border-radius:8px;}
</style>`;
const _css = () => { if (!document.getElementById('prio-css')) document.head.insertAdjacentHTML('beforeend', CSS); };

// ── Botão da barra superior (ao lado do sino) ──
export function renderPrioBotaoTopo() {
  // Entregador não usa a lista.
  if (!S.user || /entregador/i.test(String(S.user.role || '') + ' ' + String(S.user.cargo || ''))) return '';
  carregar();
  _css();
  const ok = _d && !_d.erro;
  const r = ok ? _d.registro : null;
  const vazio = ok && _vazio(r);
  const n = r?.prioridades?.length || 0;
  // Vazio: alerta pra quem preenche (pulsa), cinza discreto pras demais.
  const badge = !ok ? '' : vazio
    ? `<span class="prio-badge" style="background:${_d.podeEditar ? 'var(--red)' : '#94A3B8'};">!</span>`
    : n ? `<span class="prio-badge" style="background:#059669;">${n}</span>` : '';
  const tit = !ok ? 'Prioridades do dia' : vazio ? 'Prioridades do dia — ainda não preenchidas' : `Prioridades do dia — ${n} flor(es)`;
  return `<button class="btn btn-ghost btn-sm prio-tb${vazio && _d.podeEditar ? ' pulse' : ''}" onclick="prioAbrir()" title="${tit}">🌸${badge}</button>`;
}

// ── Resumo na Produção ──
export function renderPrioridadesCard() {
  carregar();
  _css();
  if (!_d) return `<div class="card" style="margin-bottom:14px;color:var(--muted);font-size:13px;">🌸 Carregando prioridades do dia…</div>`;
  if (_d.erro) return '';
  const r = _d.registro;
  if (_vazio(r)) {
    return `<div class="card" style="margin-bottom:14px;border:1.5px dashed #F9A8D4;background:#FDF2F8;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;">
      <div style="flex:1;min-width:200px;font-size:13px;color:${ROSA};"><b>🌸 Prioridades do dia</b> ainda não preenchidas${_d.responsavel?.nome ? ` · hoje é com <b>${esc(_d.responsavel.nome)}</b>` : ''}.</div>
      <button class="btn btn-primary btn-sm" onclick="prioAbrir(${_d.podeEditar ? "'editar'" : ''})">${_d.podeEditar ? '📝 Preencher' : '🌸 Abrir'}</button>
    </div>`;
  }
  const ps = r.prioridades || [];
  return `<div class="card" style="margin-bottom:14px;border:1.5px solid #FBCFE8;background:linear-gradient(135deg,#FDF2F8,#fff);padding:10px 14px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <b style="color:${ROSA};font-size:14px;">🌸 Prioridades de hoje</b>
      <div style="display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0;">
        ${ps.map((p, i) => `<span style="background:#fff;border:1px solid #FBCFE8;border-radius:999px;padding:3px 10px 3px 4px;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:6px;"><span style="background:${ROSA};color:#fff;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;">${i + 1}</span>${esc(p.flor)}</span>`).join('')}
        ${r.acabou ? `<span style="background:#FEF2F2;border:1px solid #FECACA;color:#B91C1C;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;">⛔ ${esc(r.acabou.replace(/\n+/g, ', '))}</span>` : ''}
      </div>
      <button class="btn btn-ghost btn-sm" onclick="prioAbrir()">Ver lista</button>
    </div>
  </div>`;
}

// ── Pop-up ──
// Fora do render do app (div própria no body) pra não brigar com outros
// modais nem perder o que ela digitou num re-render.
let _modo = 'ver', _auto = false;
function _cabecalho(r) {
  const resp = _d.responsavel?.nome;
  return `<div style="background:linear-gradient(135deg,#FCE7F3,#FDF2F8);padding:16px 18px 12px;border-bottom:1px solid #FBCFE8;position:relative;">
    <button onclick="prioFechar()" title="Fechar" style="position:absolute;top:10px;right:10px;background:none;border:none;font-size:20px;cursor:pointer;color:${ROSA};line-height:1;">×</button>
    <div style="font-size:19px;font-weight:900;color:${ROSA};padding-right:24px;">🌸 Prioridades do dia · ${_br(_d.dia)}</div>
    <div style="font-size:12px;color:#6B7280;margin-top:3px;">
      ${resp ? `Hoje quem preenche: <b>${esc(resp)}</b>` : 'Ninguém da montagem escalado hoje'}
      ${r?.updatedAt ? ` · atualizado às ${_hm(r.updatedAt)}${r.preenchidoPor ? ' por ' + esc(r.preenchidoPor) : ''}` : ''}
    </div>
  </div>`;
}

function _ver(r) {
  const crit = Object.fromEntries((_d.criterios || []).map(c => [c.k, c]));
  if (_vazio(r)) {
    return `<div style="padding:28px 18px;text-align:center;color:${ROSA};">
      <div style="font-size:38px;">🌱</div>
      <div style="font-weight:800;margin-top:6px;">Ainda não preenchido hoje</div>
      <div style="font-size:12px;color:#6B7280;margin-top:4px;">${_d.podeEditar ? 'Clique em Preencher para montar a lista.' : 'Assim que a montagem preencher, a lista aparece aqui.'}</div>
    </div>`;
  }
  const chips = (p) => (p.criterios || []).map(k => crit[k] ? `<span style="font-size:11px;background:#FCE7F3;color:${ROSA};border-radius:999px;padding:2px 8px;white-space:nowrap;">${esc(crit[k].l)}</span>` : '').join(' ');
  return `<div style="padding:14px 18px;display:grid;gap:8px;">
    ${(r.prioridades || []).map((p, i) => `<div class="prio-slot" style="align-items:flex-start;">
      <div class="prio-num">${i + 1}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:800;font-size:16px;">${esc(p.flor)}</div>
        ${(p.criterios || []).length ? `<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;">${chips(p)}</div>` : ''}
        ${p.obs ? `<div style="font-size:12.5px;color:#475569;margin-top:4px;">${esc(p.obs)}</div>` : ''}
      </div>
    </div>`).join('')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:4px;">
      ${r.acabou ? `<div class="prio-box" style="background:#FEF2F2;border:1px solid #FECACA;"><div style="font-size:11px;font-weight:800;color:#B91C1C;text-transform:uppercase;">⛔ Esgotadas — não oferecer</div><div style="font-size:13.5px;white-space:pre-line;margin-top:3px;">${esc(r.acabou)}</div></div>` : ''}
      ${r.obs ? `<div class="prio-box" style="background:#F8FAFC;border:1px solid #E2E8F0;"><div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;">📝 Observações</div><div style="font-size:13.5px;white-space:pre-line;margin-top:3px;">${esc(r.obs)}</div></div>` : ''}
    </div>
  </div>`;
}

function _form(r) {
  const n = _d.max || 4;
  const ps = [...(r?.prioridades || [])].slice(0, n);
  while (ps.length < n) ps.push({ flor: '', criterios: [], obs: '' });
  const crits = _d.criterios || [];
  const ontem = (_d.anteriores || []).find(a => !_vazio(a));
  return `<div style="padding:14px 18px;">
    <details style="font-size:12px;background:#FFF7FB;border:1px solid #FBCFE8;border-radius:10px;padding:7px 10px;margin-bottom:10px;">
      <summary style="cursor:pointer;font-weight:700;color:${ROSA};">Como escolher a ordem</summary>
      <div style="margin-top:4px;color:#475569;">Primeiro o que está <b>perto de murchar</b>, depois o que <b>chegou há mais tempo</b>, o que tem <b>em maior quantidade</b> e os <b>arranjos prontos parados</b>. A <b>margem</b> só desempata. Use ▲▼ para mudar a ordem.</div>
    </details>
    ${ontem ? `<div style="text-align:right;margin:-4px 0 8px;"><button type="button" class="btn btn-ghost btn-xs" onclick="prioCopiar()" title="Preenche com a lista de ${_br(ontem.dia)} — dá pra ajustar antes de salvar">↺ Copiar a lista de ${_br(ontem.dia)}</button></div>` : ''}
    <div id="prio-slots" style="display:grid;gap:8px;">
      ${ps.map((p, i) => `<div class="prio-slot" data-slot="${i}">
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
          <div class="prio-num">${i + 1}</div>
          <button type="button" class="prio-mv" onclick="prioMover(${i},-1)" ${i === 0 ? 'disabled' : ''} title="Subir">▲</button>
          <button type="button" class="prio-mv" onclick="prioMover(${i},1)" ${i === n - 1 ? 'disabled' : ''} title="Descer">▼</button>
        </div>
        <div style="flex:1;min-width:0;">
          <input class="prio-flor" data-f="flor" placeholder="${i === 0 ? 'Flor ou produto (ex.: Rosa vermelha)' : 'Flor ou produto'}" value="${esc(p.flor || '')}" maxlength="120"/>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px;">
            ${crits.map(c => `<label class="prio-chip" title="${esc(c.d)}"><input type="checkbox" data-f="crit" value="${esc(c.k)}" ${(p.criterios || []).includes(c.k) ? 'checked' : ''}/>${esc(c.l)}</label>`).join('')}
          </div>
          <input class="prio-obs" data-f="obs" placeholder="Observação (opcional): quantidade, vaso, cor…" value="${esc(p.obs || '')}" maxlength="300"/>
        </div>
      </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:10px;">
      <label class="prio-box" style="background:#FEF2F2;border:1px solid #FECACA;display:block;">
        <span style="font-size:11px;font-weight:800;color:#B91C1C;text-transform:uppercase;">⛔ Esgotadas — não oferecer</span>
        <textarea id="pprio-acabou" rows="3" placeholder="Ex.: lírio branco, girassol">${esc(r?.acabou || '')}</textarea>
      </label>
      <label class="prio-box" style="background:#F8FAFC;border:1px solid #E2E8F0;display:block;">
        <span style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;">📝 Observações</span>
        <textarea id="pprio-obsgeral" rows="3" placeholder="Recado para as atendentes">${esc(r?.obs || '')}</textarea>
      </label>
    </div>
  </div>`;
}

function _rodape(r) {
  const btn = 'flex:1;justify-content:center;min-width:140px;';
  if (_modo === 'editar') {
    return `<div style="position:sticky;bottom:0;background:#fff;border-top:1px solid #F1D5E3;padding:10px 18px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary" style="${btn}" onclick="prioSalvar()">💾 Salvar prioridades</button>
      ${_auto ? `<button class="btn btn-ghost" onclick="prioAdiar()">Lembrar em 30 min</button>`
        : `<button class="btn btn-ghost" onclick="${_vazio(r) ? 'prioFechar()' : "prioModo('ver')"}">Cancelar</button>`}
    </div>`;
  }
  return `<div style="position:sticky;bottom:0;background:#fff;border-top:1px solid #F1D5E3;padding:10px 18px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    ${_d.podeEditar ? `<button class="btn btn-primary" style="${btn}" onclick="prioModo('editar')">${_vazio(r) ? '📝 Preencher' : '✏️ Atualizar lista'}</button>` : ''}
    ${_d.podeConfigurar ? `<button class="btn btn-ghost btn-sm" onclick="prioCfg()" title="Quem da montagem faz a lista">⚙️ Equipe</button>` : ''}
    <button class="btn btn-ghost" style="${_d.podeEditar ? '' : btn}" onclick="prioFechar()">Fechar</button>
  </div>`;
}

function configHtml() {
  if (!_colabs) {
    GET('/collaborators').then(l => { _colabs = (Array.isArray(l) ? l : l?.data || []).filter(c => c.active !== false); _atualizarModal(); }).catch(() => { _colabs = []; _atualizarModal(); });
    return `<div style="margin:0 18px 12px;font-size:12px;color:var(--muted);">Carregando equipe…</div>`;
  }
  const sel = new Set((_d.montadoras || []).map(m => m.id));
  return `<div style="margin:0 18px 12px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:10px;">
    <div style="font-size:12px;font-weight:800;margin-bottom:6px;">Quem da montagem faz a lista (revezam um dia cada, pulando a folga cadastrada nas Estrelas):</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${[..._colabs].sort((a, b) => String(a.name).localeCompare(String(b.name))).map(c => `
      <label style="font-size:12px;display:flex;align-items:center;gap:4px;border:1px solid #E2E8F0;border-radius:999px;padding:3px 9px;">
        <input type="checkbox" data-prio-mont value="${esc(c._id)}" ${sel.has(String(c._id)) ? 'checked' : ''}/> ${esc(c.name)}</label>`).join('')}</div>
    ${(_d.montadoras || []).some(m => m.folga) ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">De folga hoje: ${_d.montadoras.filter(m => m.folga).map(m => esc(m.nome)).join(', ')}</div>` : ''}
    <button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="prioSalvarCfg()">Salvar equipe</button>
  </div>`;
}

function _htmlModal() {
  if (!_d || _d.erro) {
    return `<div style="padding:28px;text-align:center;color:var(--muted);">${_d?.erro ? 'Não foi possível carregar as prioridades. <button class="btn btn-ghost btn-sm" onclick="prioRecarregar()">Tentar de novo</button>' : '🌸 Carregando…'}</div>`;
  }
  const r = _d.registro;
  if (_modo === 'editar' && !_d.podeEditar) _modo = 'ver';
  return _cabecalho(r) + (_modo === 'ver' && _cfgAberta ? '<div style="height:12px"></div>' + configHtml() : '')
    + (_modo === 'editar' ? _form(r) : _ver(r)) + _rodape(r);
}

function _atualizarModal() {
  const box = document.getElementById('prio-modal-box');
  // Não redesenha com o formulário aberto (perderia o que ela digitou).
  if (box && !(_modo === 'editar' && box.querySelector('#prio-slots'))) box.innerHTML = _htmlModal();
}

export function abrirPrioridades(modo = 'ver', auto = false) {
  _css();
  _modo = modo; _auto = auto; _cfgAberta = false;
  document.getElementById('prio-popup')?.remove();
  const el = document.createElement('div');
  el.id = 'prio-popup';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.innerHTML = `<div id="prio-modal-box" style="background:#fff;border-radius:18px;max-width:600px;width:100%;max-height:92vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);"></div>`;
  // Clique fora fecha só no modo leitura (não perde formulário).
  el.addEventListener('click', (e) => { if (e.target === el && _modo === 'ver') window.prioFechar(); });
  document.body.appendChild(el);
  document.getElementById('prio-modal-box').innerHTML = _htmlModal();
  if (!_d || Date.now() - _at > 30000) carregar(true);
  if (modo === 'editar') setTimeout(() => document.querySelector('#prio-slots .prio-flor')?.focus(), 50);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('prio-popup') && _modo === 'ver') window.prioFechar();
});

// Lista do dia vazia → abre sozinho pra quem preenche (não pra gerência).
const _snoozeKey = () => 'fv_prio_snooze_' + (_d?.dia || '');
export function checarPopupPrioridades() {
  if (!S.user || document.getElementById('prio-popup')) return;
  carregar();
  if (!_d || _d.erro || !_d.podeEditar || _d.podeConfigurar || !_vazio(_d.registro)) return;
  let ate = 0; try { ate = Number(localStorage.getItem(_snoozeKey())) || 0; } catch (_) {}
  if (Date.now() < ate) return;
  abrirPrioridades('editar', true);
}

window.prioAbrir = (modo) => abrirPrioridades(modo || 'ver');
window.prioFechar = () => document.getElementById('prio-popup')?.remove();
window.prioRecarregar = () => { _d = null; carregar(true); _atualizarModal(); };
window.prioAdiar = () => {
  try { localStorage.setItem(_snoozeKey(), String(Date.now() + 30 * 60000)); } catch (_) {}
  window.prioFechar();
};
window.prioModo = (m) => {
  _modo = m; _cfgAberta = false;
  const box = document.getElementById('prio-modal-box');
  if (box) box.innerHTML = _htmlModal();
  if (m === 'editar') setTimeout(() => document.querySelector('#prio-slots .prio-flor')?.focus(), 50);
};
window.prioCfg = () => { _cfgAberta = !_cfgAberta; const box = document.getElementById('prio-modal-box'); if (box) box.innerHTML = _htmlModal(); };

// Lê / escreve os campos de um slot (pra mover e copiar).
const _slot = (i) => document.querySelector(`#prio-slots [data-slot="${i}"]`);
function _lerSlot(i) {
  const s = _slot(i); if (!s) return null;
  return { flor: s.querySelector('[data-f="flor"]').value, obs: s.querySelector('[data-f="obs"]').value,
    criterios: [...s.querySelectorAll('[data-f="crit"]:checked')].map(x => x.value) };
}
function _porSlot(i, p) {
  const s = _slot(i); if (!s) return;
  s.querySelector('[data-f="flor"]').value = p.flor || '';
  s.querySelector('[data-f="obs"]').value = p.obs || '';
  s.querySelectorAll('[data-f="crit"]').forEach(x => { x.checked = (p.criterios || []).includes(x.value); });
}
window.prioMover = (i, dir) => {
  const j = i + dir, a = _lerSlot(i), b = _lerSlot(j);
  if (!a || !b) return;
  _porSlot(i, b); _porSlot(j, a);
  _slot(j)?.querySelector('[data-f="flor"]')?.focus();
};
window.prioCopiar = () => {
  const ontem = (_d?.anteriores || []).find(a => !_vazio(a));
  if (!ontem) return;
  const n = _d.max || 4;
  for (let i = 0; i < n; i++) _porSlot(i, ontem.prioridades?.[i] || {});
  const a = document.getElementById('pprio-acabou'), o = document.getElementById('pprio-obsgeral');
  if (a) a.value = ontem.acabou || '';
  if (o) o.value = ontem.obs || '';
  toast(`↺ Lista de ${_br(ontem.dia)} copiada — confira e salve.`);
};

window.prioSalvar = async () => {
  const n = _d?.max || 4;
  const prioridades = [];
  for (let i = 0; i < n; i++) {
    const p = _lerSlot(i);
    if (!p || !p.flor.trim()) continue;
    prioridades.push({ flor: p.flor.trim(), obs: p.obs.trim(), criterios: p.criterios });
  }
  const v = (id) => document.getElementById(id)?.value.trim() || '';
  const acabou = v('pprio-acabou'), obs = v('pprio-obsgeral');
  if (!prioridades.length && !acabou && !obs) { toast('Preencha pelo menos uma prioridade.', true); return; }
  const r = _d?.registro || {};
  try {
    // temos/pouco saíram do formulário — mantém o que já estava gravado.
    await PUT('/prioridades/' + _d.dia, { prioridades, temos: r.temos || '', pouco: r.pouco || '', acabou, obs });
    toast('🌸 Prioridades do dia salvas!');
    _modo = 'ver'; _auto = false;
    const box = document.getElementById('prio-modal-box');
    if (box) box.innerHTML = '<div style="padding:28px;text-align:center;color:var(--muted);">🌸 Atualizando…</div>';
    carregar(true);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
};
window.prioSalvarCfg = async () => {
  const montadoras = [...document.querySelectorAll('[data-prio-mont]:checked')].map(x => x.value);
  try { await PUT('/prioridades/config', { montadoras }); toast('✅ Equipe da lista salva.'); _cfgAberta = false; carregar(true); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
