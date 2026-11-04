// ── 🗑️ DESCARTE DE FLORES (Marcia 04/nov/2026) ──
// Na Produção: registra de uma vez tudo o que foi descartado no dia e copia um
// resumo para mandar no grupo junto com a foto. A foto não sobe para o sistema.
import { S } from '../state.js';
import { GET, PUT } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';
import { STOCK_UNITS, UNIT_LABEL } from '../utils/stock.js';

const MOTIVOS = ['Murchou', 'Quebrou', 'Sobra', 'Outro'];
const MEDIDAS = ['hastes', 'maços', 'unidades'];
const FLORES_BASE = ['Rosa vermelha', 'Rosa branca', 'Rosa colombiana', 'Mini rosa', 'Lírio', 'Girassol', 'Gérbera', 'Gypsophila', 'Astromélia', 'Crisântemo', 'Folhagem'];
let _d = null, _at = 0, _loading = false, _f = null;
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _br = (d) => String(d || '').split('-').reverse().slice(0, 2).join('/');

function carregar(forcar = false) {
  if (_loading || (!forcar && _d && Date.now() - _at < 120000)) return;
  _loading = true;
  GET('/descartes?dias=30').then(x => { _d = x; }).catch(() => { if (!_d) _d = { erro: true }; })
    .finally(() => { _loading = false; _at = Date.now(); _rerender(); });
}
const _unidadePadrao = () => (/aleixo/i.test(String(S.user?.unidade || S.user?.unit || '')) ? 'Loja Novo Aleixo' : 'CDLE');
const _doDia = (dia, unidade) => (_d?.registros || []).find(r => r.dia === dia && r.unidade === unidade);
const _total = (itens) => (itens || []).reduce((s, i) => s + (Number(i.qtd) || 0), 0);

export function renderDescarteCard() {
  carregar();
  if (!_d || _d.erro) return '';
  const hoje = (_d.registros || []).filter(r => r.dia === _d.hoje);
  const feito = hoje.length > 0;
  return `<div class="card" style="margin-bottom:14px;padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1.5px solid ${feito ? '#BBF7D0' : '#E2E8F0'};background:${feito ? '#F0FDF4' : '#fff'};">
    <div style="flex:1;min-width:210px;font-size:13px;">
      <b>🗑️ Descarte de flores de hoje</b>
      <span style="color:var(--muted);">${feito ? hoje.map(r => `${esc(UNIT_LABEL[r.unidade] || r.unidade)}: ${_total(r.itens)} (${r.itens.length} flor${r.itens.length > 1 ? 'es' : ''})${r.fotoEnviada ? ' · 📸 foto enviada' : ' · falta a foto'}`).join(' · ') : ' ainda não registrado'}</span>
    </div>
    <button class="btn ${feito ? 'btn-ghost' : 'btn-primary'} btn-sm" onclick="dscAbrir()">${feito ? '✏️ Atualizar' : '📝 Registrar'}</button>
    ${_d.podeGerir ? `<button class="btn btn-ghost btn-sm" onclick="dscResumo()">📊 Últimos 30 dias</button>` : ''}
  </div>`;
}

function _lerLinhas() {
  return [...document.querySelectorAll('#dsc-linhas .dsc-l')].map(l => ({
    flor: l.querySelector('.dsc-flor').value.trim(), qtd: Number(l.querySelector('.dsc-qtd').value) || 0,
    medida: l.querySelector('.dsc-med').value, motivo: l.querySelector('.dsc-mot').value,
  }));
}
const _opts = (lista, sel) => lista.map(x => `<option value="${esc(x)}" ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const _linha = (i = {}) => `<div class="dsc-l dsc-g" style="display:grid;gap:6px;align-items:center;margin-bottom:6px;">
  <input class="fi dsc-flor" list="dsc-flores" placeholder="Flor" value="${esc(i.flor || '')}" maxlength="80"/>
  <input class="fi dsc-qtd" type="number" min="1" inputmode="numeric" placeholder="Qtd" value="${i.qtd || ''}" style="text-align:center;" onkeydown="if(event.key==='Enter'){event.preventDefault();dscLinha();}"/>
  <select class="fi dsc-med" style="padding:6px 4px;">${_opts(MEDIDAS, i.medida || 'hastes')}</select>
  <select class="fi dsc-mot" style="padding:6px 4px;">${_opts(MOTIVOS, i.motivo || 'Murchou')}</select>
  <button type="button" onclick="this.closest('.dsc-l').remove()" title="Tirar" style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;">×</button>
</div>`;

function _desenhar() {
  document.getElementById('dsc-popup')?.remove();
  if (!_f) return;
  const reg = _doDia(_d.hoje, _f.unidade);
  const flores = [...new Set([...(_d.porFlor || []).map(x => x.flor), ...FLORES_BASE])];
  const el = document.createElement('div');
  el.id = 'dsc-popup';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.innerHTML = `<style>.dsc-g{grid-template-columns:minmax(130px,1fr) 70px 92px 100px 28px}@media(max-width:560px){.dsc-g{grid-template-columns:1fr 64px 28px}.dsc-tit{display:none!important}.dsc-l .dsc-med{grid-column:1}.dsc-l .dsc-mot{grid-column:2/4}.dsc-l .dsc-flor{grid-row:1}.dsc-l .dsc-qtd{grid-row:1}.dsc-l>button{grid-row:1;grid-column:3}}</style><div style="background:#fff;border-radius:16px;max-width:620px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="padding:14px 18px 8px;display:flex;justify-content:space-between;gap:8px;">
      <div><div style="font-size:17px;font-weight:900;">🗑️ Descarte de flores · ${_br(_d.hoje)}</div>
      <div style="font-size:12px;color:var(--muted);">Coloque tudo o que foi descartado hoje e tire uma foto de tudo junto para o grupo.</div></div>
      <button type="button" onclick="dscFechar()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1;">×</button>
    </div>
    <div style="padding:6px 18px 12px;overflow:auto;flex:1;">
      <label class="fl" style="display:block;max-width:220px;">Unidade<select class="fi" onchange="dscUnidade(this.value)">${STOCK_UNITS.map(u => `<option value="${esc(u)}" ${u === _f.unidade ? 'selected' : ''}>${esc(UNIT_LABEL[u] || u)}</option>`).join('')}</select></label>
      <datalist id="dsc-flores">${flores.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      <div class="dsc-g dsc-tit" style="display:grid;gap:6px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:10px 0 4px;"><span>Flor</span><span>Qtd</span><span>Medida</span><span>Motivo</span><span></span></div>
      <div id="dsc-linhas">${(reg?.itens?.length ? reg.itens : [{}, {}, {}]).map(_linha).join('')}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="dscLinha()">+ outra flor</button>
      <label class="fl" style="display:block;margin-top:10px;">Observação (opcional)<textarea class="fi" id="dsc-obs" rows="2" style="width:100%;" maxlength="500">${esc(reg?.obs || '')}</textarea></label>
      <label style="display:flex;gap:7px;align-items:center;margin-top:8px;font-size:13px;font-weight:600;"><input type="checkbox" id="dsc-foto" ${reg?.fotoEnviada ? 'checked' : ''} style="width:18px;height:18px;"/> 📸 Foto de tudo junto enviada no grupo</label>
    </div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-primary" style="flex:1;justify-content:center;min-width:150px;" onclick="dscSalvar()">💾 Salvar descarte</button>
      <button class="btn btn-ghost" onclick="dscCopiar()">📋 Copiar para o grupo</button>
    </div>
  </div>`;
  document.body.appendChild(el);
}

function _resumoTexto() {
  const itens = _lerLinhas().filter(i => i.flor && i.qtd > 0);
  const obs = document.getElementById('dsc-obs')?.value.trim();
  return `🗑️ *Descarte de flores ${_br(_d.hoje)} — ${UNIT_LABEL[_f.unidade] || _f.unidade}*\n\n${itens.map(i => `• ${i.qtd} ${i.medida} de ${i.flor} (${i.motivo.toLowerCase()})`).join('\n')}\n\nRegistrado por ${S.user?.name || S.user?.nome || ''}${obs ? `\nObs.: ${obs}` : ''}`;
}

window.dscAbrir = () => { _f = { unidade: _unidadePadrao() }; _desenhar(); };
window.dscFechar = () => { _f = null; document.getElementById('dsc-popup')?.remove(); };
window.dscUnidade = (u) => { _f.unidade = u; _desenhar(); };
window.dscLinha = () => {
  const box = document.getElementById('dsc-linhas'); if (!box) return;
  box.insertAdjacentHTML('beforeend', _linha());
  box.lastElementChild.querySelector('.dsc-flor')?.focus();
};
window.dscCopiar = async () => {
  if (!_lerLinhas().some(i => i.flor && i.qtd > 0)) return toast('Preencha pelo menos uma flor com quantidade.', true);
  try { await navigator.clipboard.writeText(_resumoTexto()); toast('📋 Resumo copiado! Cole no grupo com a foto.'); }
  catch (_) { toast('Não consegui copiar. Tente de novo.', true); }
};
window.dscSalvar = async () => {
  const itens = _lerLinhas();
  if (itens.some(i => i.flor && !i.qtd)) return toast('Falta a quantidade de alguma flor.', true);
  if (itens.some(i => !i.flor && i.qtd)) return toast('Falta o nome de alguma flor.', true);
  const validos = itens.filter(i => i.flor && i.qtd > 0);
  if (!validos.length) return toast('Preencha pelo menos uma flor com quantidade.', true);
  try {
    await PUT('/descartes/' + _d.hoje, { unidade: _f.unidade, itens: validos, obs: document.getElementById('dsc-obs')?.value || '', fotoEnviada: !!document.getElementById('dsc-foto')?.checked });
    toast('🗑️ Descarte registrado!');
    window.dscFechar();
    carregar(true);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
};
window.dscResumo = async () => {
  try { _d = await GET('/descartes?dias=30'); _at = Date.now(); } catch (e) { return toast('❌ ' + (e.message || 'Erro'), true); }
  document.getElementById('dsc-popup')?.remove();
  const el = document.createElement('div');
  el.id = 'dsc-popup';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  const flores = _d.porFlor || [], regs = _d.registros || [];
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:620px;width:100%;max-height:92vh;overflow:auto;padding:16px 18px;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="display:flex;justify-content:space-between;"><div style="font-size:17px;font-weight:900;">📊 Descarte · últimos 30 dias</div>
    <button type="button" onclick="document.getElementById('dsc-popup').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1;">×</button></div>
    ${!regs.length ? `<div class="empty" style="padding:24px;text-align:center;color:var(--muted);">Nenhum descarte registrado ainda.</div>` : `
    <div style="font-size:12px;color:var(--muted);margin:2px 0 10px;">${regs.length} registro(s). Sem registro não significa zero descarte: pode ser dia em que não preencheram.</div>
    <div style="font-weight:800;font-size:13px;margin-bottom:4px;">Mais descartadas</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">${flores.slice(0, 12).map(x => `<tr style="border-top:1px solid var(--border);"><td style="padding:5px 4px;">${esc(x.flor)}</td><td style="padding:5px 4px;text-align:right;font-weight:800;">${x.qtd} ${esc(x.medida)}</td><td style="padding:5px 4px;text-align:right;color:var(--muted);">${x.vezes} dia(s)</td></tr>`).join('')}</table>
    <div style="font-weight:800;font-size:13px;margin:12px 0 4px;">Dia a dia</div>
    ${regs.map(r => `<div style="border-top:1px solid var(--border);padding:6px 4px;font-size:12px;"><b>${_br(r.dia)} · ${esc(UNIT_LABEL[r.unidade] || r.unidade)}</b> <span style="color:var(--muted);">por ${esc(r.por || '—')}${r.fotoEnviada ? ' · 📸' : ' · sem foto'}</span><br>${(r.itens || []).map(i => `${i.qtd} ${esc(i.medida)} de ${esc(i.flor)} (${esc(i.motivo.toLowerCase())})`).join(' · ')}${r.obs ? `<br><i>${esc(r.obs)}</i>` : ''}</div>`).join('')}`}
  </div>`;
  document.body.appendChild(el);
};
