// ── 🌸 PRIORIDADES DO DIA (Marcia 29/out/2026) ──────────────────────
// No topo do Catálogo. A montagem (Aninha / Ana Paula, revezando e pulando a
// folga) preenche como estamos de flores e até 4 prioridades de venda, em
// ordem. Todo mundo vê; as atendentes oferecem primeiro o que está no topo.
import { S } from '../state.js';
import { GET, PUT } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

let _d = null, _at = 0, _loading = false, _editando = false, _cfgAberta = false, _colabs = null;
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _br = (d) => String(d || '').split('-').reverse().slice(0, 2).join('/');
const _hm = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }); };

function carregar(forcar = false) {
  if (_loading || (!forcar && _d && Date.now() - _at < 120000)) return;
  _loading = true;
  GET('/prioridades').then(x => { _d = x; }).catch(() => { if (!_d) _d = { erro: true }; })
    .finally(() => { _loading = false; _at = Date.now(); _rerender(); });
}

export function renderPrioridadesCard() {
  carregar();
  if (!_d) return `<div class="card" style="margin-bottom:14px;color:var(--muted);font-size:13px;">🌸 Carregando prioridades do dia…</div>`;
  if (_d.erro) return '';
  const r = _d.registro;
  const crit = Object.fromEntries((_d.criterios || []).map(c => [c.k, c]));
  const resp = _d.responsavel?.nome;
  const topo = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
    <div>
      <div style="font-size:15px;font-weight:900;color:#9D174D;">🌸 Prioridades do dia — ${_br(_d.dia)}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px;">${resp ? `Hoje quem preenche: <b>${esc(resp)}</b>` : 'Ninguém da montagem escalado hoje'}${r?.updatedAt ? ` · atualizado às ${_hm(r.updatedAt)}${r.preenchidoPor ? ' por ' + esc(r.preenchidoPor) : ''}` : ''}</div>
    </div>
    <div style="display:flex;gap:6px;">
      ${_d.podeEditar && !_editando ? `<button class="btn btn-primary btn-sm" onclick="prioEditar()">${r ? '✏️ Atualizar' : '📝 Preencher'}</button>` : ''}
      ${_d.podeConfigurar && !_editando ? `<button class="btn btn-ghost btn-sm" onclick="prioCfg()" title="Quem da montagem faz a lista">⚙️</button>` : ''}
    </div>
  </div>`;
  const corpo = _editando ? formulario(r, crit) : visualizar(r, crit);
  return `<div class="card" style="margin-bottom:14px;border:2px solid #FBCFE8;background:linear-gradient(135deg,#FDF2F8,#fff);">
    ${topo}${_cfgAberta ? configHtml() : ''}${corpo}
  </div>`;
}

function visualizar(r, crit) {
  if (!r || (!r.prioridades?.length && !r.temos && !r.pouco && !r.acabou && !r.obs)) {
    return `<div style="margin-top:10px;font-size:13px;color:#9D174D;background:#fff;border:1px dashed #F9A8D4;border-radius:10px;padding:10px;">Ainda não preenchido hoje.${_d.podeEditar ? ' Clique em <b>Preencher</b>.' : ''}</div>`;
  }
  const chips = (p) => (p.criterios || []).map(k => crit[k] ? `<span style="font-size:11px;background:#FCE7F3;color:#9D174D;border-radius:999px;padding:2px 8px;white-space:nowrap;">${esc(crit[k].l)}</span>` : '').join(' ');
  const bloco = (titulo, cor, v) => v ? `<div style="flex:1;min-width:180px;background:#fff;border:1px solid ${cor};border-radius:10px;padding:8px 10px;"><div style="font-size:11px;font-weight:800;color:${cor};text-transform:uppercase;">${titulo}</div><div style="font-size:13px;white-space:pre-line;">${esc(v)}</div></div>` : '';
  return `
    ${r.prioridades?.length ? `<div style="margin-top:10px;display:grid;gap:6px;">${r.prioridades.map((p, i) => `
      <div style="display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #FBCFE8;border-radius:10px;padding:8px 10px;">
        <div style="flex:0 0 28px;height:28px;border-radius:50%;background:#9D174D;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;">${i + 1}</div>
        <div style="min-width:0;"><div style="font-weight:800;font-size:14px;">${esc(p.flor)}</div>
          <div style="margin-top:3px;display:flex;gap:4px;flex-wrap:wrap;">${chips(p)}</div>
          ${p.obs ? `<div style="font-size:12px;color:var(--muted);margin-top:3px;">${esc(p.obs)}</div>` : ''}</div>
      </div>`).join('')}</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      ${bloco('✅ Temos bem', '#15803D', r.temos)}${bloco('⚠️ Temos pouco', '#B45309', r.pouco)}${bloco('⛔ Acabou / não oferecer', '#B91C1C', r.acabou)}
    </div>
    ${r.obs ? `<div style="margin-top:8px;font-size:13px;"><b>Observações:</b> ${esc(r.obs)}</div>` : ''}`;
}

function formulario(r, crit) {
  const ps = [...(r?.prioridades || [])];
  while (ps.length < (_d.max || 4)) ps.push({ flor: '', criterios: [], obs: '' });
  const crits = _d.criterios || [];
  return `<div style="margin-top:10px;">
    <div style="font-size:12px;background:#fff;border:1px solid #FBCFE8;border-radius:10px;padding:8px 10px;margin-bottom:10px;">
      <b>Como escolher a ordem:</b> primeiro o que está <b>perto de murchar</b>, depois o que <b>chegou há mais tempo</b>, depois o que tem <b>em maior quantidade</b> e os <b>arranjos prontos parados</b>. A <b>margem</b> serve só para desempatar.
    </div>
    ${ps.map((p, i) => `<div style="background:#fff;border:1px solid #FBCFE8;border-radius:10px;padding:8px 10px;margin-bottom:8px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <b style="color:#9D174D;">${i + 1}º</b>
        <input class="fi" id="prio-flor-${i}" placeholder="Flor ou produto (ex.: Rosa vermelha)" value="${esc(p.flor || '')}" style="flex:1;min-width:180px;"/>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        ${crits.map(c => `<label title="${esc(c.d)}" style="font-size:12px;display:flex;align-items:center;gap:4px;background:#FDF2F8;border-radius:999px;padding:3px 9px;cursor:pointer;">
          <input type="checkbox" data-prio-crit="${i}" value="${c.k}" ${(p.criterios || []).includes(c.k) ? 'checked' : ''}/> ${esc(c.l)}</label>`).join('')}
      </div>
      <input class="fi" id="prio-obs-${i}" placeholder="Observação (opcional): quantidade, vaso, cor…" value="${esc(p.obs || '')}" style="margin-top:6px;width:100%;"/>
    </div>`).join('')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
      <label style="font-size:12px;font-weight:700;color:#15803D;">✅ Temos bem<textarea class="fi" id="prio-temos" rows="2" style="width:100%;">${esc(r?.temos || '')}</textarea></label>
      <label style="font-size:12px;font-weight:700;color:#B45309;">⚠️ Temos pouco<textarea class="fi" id="prio-pouco" rows="2" style="width:100%;">${esc(r?.pouco || '')}</textarea></label>
      <label style="font-size:12px;font-weight:700;color:#B91C1C;">⛔ Acabou / não oferecer<textarea class="fi" id="prio-acabou" rows="2" style="width:100%;">${esc(r?.acabou || '')}</textarea></label>
    </div>
    <label style="font-size:12px;font-weight:700;display:block;margin-top:8px;">Observações gerais<textarea class="fi" id="prio-obs" rows="2" style="width:100%;">${esc(r?.obs || '')}</textarea></label>
    <div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn btn-primary" onclick="prioSalvar()">💾 Salvar</button>
      <button class="btn btn-ghost" onclick="prioCancelar()">Cancelar</button>
    </div>
  </div>`;
}

function configHtml() {
  if (!_colabs) {
    GET('/collaborators').then(l => { _colabs = (Array.isArray(l) ? l : l?.data || []).filter(c => c.active !== false); _rerender(); }).catch(() => { _colabs = []; });
    return `<div style="margin-top:8px;font-size:12px;color:var(--muted);">Carregando equipe…</div>`;
  }
  const sel = new Set((_d.montadoras || []).map(m => m.id));
  return `<div style="margin-top:10px;background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:10px;">
    <div style="font-size:12px;font-weight:800;margin-bottom:6px;">Quem da montagem faz a lista (revezam um dia cada, pulando a folga cadastrada nas Estrelas):</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${_colabs.sort((a, b) => String(a.name).localeCompare(String(b.name))).map(c => `
      <label style="font-size:12px;display:flex;align-items:center;gap:4px;border:1px solid #E2E8F0;border-radius:999px;padding:3px 9px;">
        <input type="checkbox" data-prio-mont value="${esc(c._id)}" ${sel.has(String(c._id)) ? 'checked' : ''}/> ${esc(c.name)}</label>`).join('')}</div>
    ${(_d.montadoras || []).some(m => m.folga) ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">De folga hoje: ${_d.montadoras.filter(m => m.folga).map(m => esc(m.nome)).join(', ')}</div>` : ''}
    <button class="btn btn-primary btn-sm" style="margin-top:8px;" onclick="prioSalvarCfg()">Salvar equipe</button>
  </div>`;
}

window.prioEditar = () => { _editando = true; _cfgAberta = false; _rerender(); };
window.prioCancelar = () => { _editando = false; _rerender(); };
window.prioCfg = () => { _cfgAberta = !_cfgAberta; _rerender(); };
window.prioSalvar = async () => {
  const n = _d?.max || 4;
  const prioridades = [];
  for (let i = 0; i < n; i++) {
    const flor = document.getElementById(`prio-flor-${i}`)?.value.trim();
    if (!flor) continue;
    prioridades.push({ flor, obs: document.getElementById(`prio-obs-${i}`)?.value.trim() || '',
      criterios: [...document.querySelectorAll(`[data-prio-crit="${i}"]:checked`)].map(x => x.value) });
  }
  const v = (id) => document.getElementById(id)?.value.trim() || '';
  try {
    await PUT('/prioridades/' + _d.dia, { prioridades, temos: v('prio-temos'), pouco: v('prio-pouco'), acabou: v('prio-acabou'), obs: v('prio-obs') });
    toast('🌸 Prioridades do dia salvas!');
    _editando = false; carregar(true);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
};
window.prioSalvarCfg = async () => {
  const montadoras = [...document.querySelectorAll('[data-prio-mont]:checked')].map(x => x.value);
  try { await PUT('/prioridades/config', { montadoras }); toast('✅ Equipe da lista salva.'); _cfgAberta = false; carregar(true); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
