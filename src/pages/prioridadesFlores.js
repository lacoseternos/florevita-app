// ── 🌸 PRIORIDADES DO DIA (Marcia 29/out/2026) ──────────────────────
// Fica na PRODUÇÃO (Marcia 30/out). A montagem (Aninha / Ana Paula, revezando
// e pulando a folga) preenche até 4 prioridades de venda, em ordem, as flores
// ESGOTADAS e observações. Quando a lista do dia ainda está vazia, abre um
// pop-up na tela delas (dá pra adiar 30 min).
import { S } from '../state.js';
import { GET, PUT } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

let _d = null, _at = 0, _loading = false, _editando = false, _cfgAberta = false, _colabs = null;
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _br = (d) => String(d || '').split('-').reverse().slice(0, 2).join('/');
const _hm = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }); };
const _vazio = (r) => !r || (!r.prioridades?.length && !r.acabou && !r.obs);

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
      ${_d.podeEditar && !_editando ? `<button class="btn btn-primary btn-sm" onclick="prioEditar()">${_vazio(r) ? '📝 Preencher' : '✏️ Atualizar'}</button>` : ''}
      ${_d.podeConfigurar && !_editando ? `<button class="btn btn-ghost btn-sm" onclick="prioCfg()" title="Quem da montagem faz a lista">⚙️</button>` : ''}
    </div>
  </div>`;
  const corpo = _editando ? formulario(r, 'prio') : visualizar(r, crit);
  return `<div class="card" style="margin-bottom:14px;border:2px solid #FBCFE8;background:linear-gradient(135deg,#FDF2F8,#fff);">
    ${topo}${_cfgAberta ? configHtml() : ''}${corpo}
  </div>`;
}

function visualizar(r, crit) {
  if (_vazio(r)) {
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
      ${bloco('⛔ Esgotadas — não oferecer', '#B91C1C', r.acabou)}${bloco('📝 Observações', '#475569', r.obs)}
    </div>`;
}

// pre = prefixo dos ids ('prio' no card, 'pprio' no pop-up).
function formulario(r, pre) {
  const ps = [...(r?.prioridades || [])];
  while (ps.length < (_d.max || 4)) ps.push({ flor: '', criterios: [], obs: '' });
  const crits = _d.criterios || [];
  return `<div style="margin-top:10px;">
    <div style="font-size:12px;background:#fff;border:1px solid #FBCFE8;border-radius:10px;padding:8px 10px;margin-bottom:10px;">
      <b>Até 4, em ordem:</b> primeiro o que está <b>perto de murchar</b>, depois o que <b>chegou há mais tempo</b>, o que tem <b>em maior quantidade</b> e os <b>arranjos prontos parados</b>. A <b>margem</b> só desempata.
    </div>
    ${ps.map((p, i) => `<div style="background:#fff;border:1px solid #FBCFE8;border-radius:10px;padding:8px 10px;margin-bottom:8px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <b style="color:#9D174D;">${i + 1}º</b>
        <input class="fi" id="${pre}-flor-${i}" placeholder="Flor ou produto (ex.: Rosa vermelha)" value="${esc(p.flor || '')}" style="flex:1;min-width:160px;"/>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        ${crits.map(c => `<label title="${esc(c.d)}" style="font-size:12px;display:flex;align-items:center;gap:4px;background:#FDF2F8;border-radius:999px;padding:3px 9px;cursor:pointer;">
          <input type="checkbox" data-${pre}-crit="${i}" value="${c.k}" ${(p.criterios || []).includes(c.k) ? 'checked' : ''}/> ${esc(c.l)}</label>`).join('')}
      </div>
      <input class="fi" id="${pre}-obs-${i}" placeholder="Observação (opcional): quantidade, vaso, cor…" value="${esc(p.obs || '')}" style="margin-top:6px;width:100%;"/>
    </div>`).join('')}
    <label style="font-size:12px;font-weight:700;color:#B91C1C;display:block;">⛔ Esgotadas — não oferecer<textarea class="fi" id="${pre}-acabou" rows="2" placeholder="Ex.: lírio branco, girassol" style="width:100%;">${esc(r?.acabou || '')}</textarea></label>
    <label style="font-size:12px;font-weight:700;display:block;margin-top:8px;">📝 Observações<textarea class="fi" id="${pre}-obsgeral" rows="2" style="width:100%;">${esc(r?.obs || '')}</textarea></label>
    ${pre === 'prio' ? `<div style="display:flex;gap:8px;margin-top:10px;">
      <button class="btn btn-primary" onclick="prioSalvar('prio')">💾 Salvar</button>
      <button class="btn btn-ghost" onclick="prioCancelar()">Cancelar</button>
    </div>` : ''}
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

// ── 🔔 POP-UP pra montagem (lista do dia vazia) ──
// Só pra quem é da montagem (podeEditar sem ser gerência). Fora do render do
// app (div própria no body) pra não brigar com outros modais nem perder o
// que ela digitou num re-render.
const _snoozeKey = () => 'fv_prio_snooze_' + (_d?.dia || '');
export function checarPopupPrioridades() {
  if (!S.user || document.getElementById('prio-popup')) return;
  carregar();
  if (!_d || _d.erro || !_d.podeEditar || _d.podeConfigurar || !_vazio(_d.registro)) return;
  let ate = 0; try { ate = Number(localStorage.getItem(_snoozeKey())) || 0; } catch (_) {}
  if (Date.now() < ate) return;
  const el = document.createElement('div');
  el.id = 'prio-popup';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:92vh;overflow-y:auto;padding:16px 16px 14px;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="font-size:18px;font-weight:900;color:#9D174D;">🌸 Prioridades do dia — ${_br(_d.dia)}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:2px;">${esc(S.user?.name || '')}, liste o que as atendentes devem oferecer primeiro hoje. Todo mundo vê na Produção.</div>
    ${formulario(null, 'pprio')}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
      <button class="btn btn-primary" style="flex:1;justify-content:center;" onclick="prioSalvar('pprio')">💾 Salvar prioridades</button>
      <button class="btn btn-ghost" onclick="prioAdiar()">Lembrar em 30 min</button>
    </div>
  </div>`;
  document.body.appendChild(el);
}
window.prioAdiar = () => {
  try { localStorage.setItem(_snoozeKey(), String(Date.now() + 30 * 60000)); } catch (_) {}
  document.getElementById('prio-popup')?.remove();
};

window.prioEditar = () => { _editando = true; _cfgAberta = false; _rerender(); };
window.prioCancelar = () => { _editando = false; _rerender(); };
window.prioCfg = () => { _cfgAberta = !_cfgAberta; _rerender(); };
window.prioSalvar = async (pre = 'prio') => {
  const n = _d?.max || 4;
  const prioridades = [];
  for (let i = 0; i < n; i++) {
    const flor = document.getElementById(`${pre}-flor-${i}`)?.value.trim();
    if (!flor) continue;
    prioridades.push({ flor, obs: document.getElementById(`${pre}-obs-${i}`)?.value.trim() || '',
      criterios: [...document.querySelectorAll(`[data-${pre}-crit="${i}"]:checked`)].map(x => x.value) });
  }
  const v = (id) => document.getElementById(id)?.value.trim() || '';
  const acabou = v(`${pre}-acabou`), obs = v(`${pre}-obsgeral`);
  if (!prioridades.length && !acabou && !obs) { toast('Preencha pelo menos uma prioridade.', true); return; }
  const r = _d?.registro || {};
  try {
    // temos/pouco saíram do formulário — mantém o que já estava gravado.
    await PUT('/prioridades/' + _d.dia, { prioridades, temos: r.temos || '', pouco: r.pouco || '', acabou, obs });
    toast('🌸 Prioridades do dia salvas!');
    _editando = false;
    document.getElementById('prio-popup')?.remove();
    carregar(true);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
};
window.prioSalvarCfg = async () => {
  const montadoras = [...document.querySelectorAll('[data-prio-mont]:checked')].map(x => x.value);
  try { await PUT('/prioridades/config', { montadoras }); toast('✅ Equipe da lista salva.'); _cfgAberta = false; carregar(true); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
