// ── 📦 CONTAGEM SEMANAL DE EMBALAGENS COREANAS (Marcia 04/nov/2026) ──
// Toda quarta, às 17h30, abre no perfil de quem é da montagem. Compara por
// modelo com a contagem anterior. Quem preenche também pode incluir modelo.
import { S } from '../state.js';
import { GET, PUT } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

let _d = null, _at = 0, _loading = false;
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _br = (d) => String(d || '').split('-').reverse().slice(0, 2).join('/');
const _snooze = () => 'fv_coreanas_snooze_' + (_d?.semana || '');

function carregar(forcar = false) {
  if (_loading || (!forcar && _d && Date.now() - _at < 300000)) return;
  _loading = true;
  GET('/coreanas').then(x => { _d = x; }).catch(() => { if (!_d) _d = { erro: true }; })
    .finally(() => { _loading = false; _at = Date.now(); checarPopupCoreanas(); });
}
const _qtd = (reg, modelo) => (reg?.itens || []).find(i => i.modelo === modelo)?.qtd;

const _nomeCurto = (m) => String(m).replace(/^(Pequena|Média) · /, '');
const _linha = (modelo, antes, agora, info = {}) => `<tr class="cor-l" data-modelo="${esc(modelo)}" data-meta="${Number(info.meta) || 0}" style="border-top:1px solid var(--border);">
  <td style="padding:7px 4px;font-size:13px;"><b>${esc(_nomeCurto(modelo))}</b>${info.produto ? `<div style="font-size:11px;color:var(--muted);">${esc(info.produto)}</div>` : ''}</td>
  <td style="padding:7px 4px;text-align:center;font-weight:700;">${Number(info.meta) || '—'}</td>
  <td style="padding:7px 4px;text-align:center;color:var(--muted);">${antes ?? '—'}</td>
  <td style="padding:7px 4px;text-align:center;"><input class="fi cor-q" type="number" min="0" inputmode="numeric" value="${agora ?? ''}" data-antes="${antes ?? ''}" oninput="corDif(this)" onkeydown="if(event.key==='Enter'){event.preventDefault();corProx(this);}" style="width:76px;text-align:center;font-weight:700;"/></td>
  <td class="cor-d" style="padding:7px 4px;text-align:center;font-weight:800;">${_dif(antes, agora)}</td>
</tr>`;
function _dif(antes, agora) {
  if (agora === '' || agora == null || antes === '' || antes == null) return '—';
  const d = Number(agora) - Number(antes);
  return `<span style="color:${d === 0 ? '#64748B' : d < 0 ? '#B91C1C' : '#15803D'};">${d > 0 ? '+' : ''}${d}</span>`;
}

export function abrirCoreanas(auto = false) {
  if (!_d || _d.erro) return;
  document.getElementById('cor-popup')?.remove();
  const cad = (_d.modelos || []).map(m => (typeof m === 'string' ? { modelo: m } : m));
  const nomes = [...new Set([...cad.map(m => m.modelo), ...(_d.atual?.itens || []).map(i => i.modelo), ...(_d.anterior?.itens || []).map(i => i.modelo)])];
  const infoDe = (n) => cad.find(m => m.modelo === n) || {};
  let _tam = null;
  const linhasHtml = nomes.map(m => {
    const i = infoDe(m), t = i.tamanho || '';
    const cab = t && t !== _tam ? `<tr><td colspan="5" style="padding:8px 4px 3px;font-size:11px;font-weight:800;color:#9D174D;text-transform:uppercase;">${esc(t)}</td></tr>` : '';
    _tam = t;
    return cab + _linha(m, _qtd(_d.anterior, m), _qtd(_d.atual, m), i);
  }).join('');
  const pode = _d.podePreencher;
  const el = document.createElement('div');
  el.id = 'cor-popup';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:540px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="padding:14px 18px 8px;display:flex;justify-content:space-between;gap:8px;">
      <div><div style="font-size:17px;font-weight:900;">📦 Contagem de embalagens coreanas</div>
      <div style="font-size:12px;color:var(--muted);">Semana de ${_br(_d.semana)}${_d.anterior ? ` · comparando com ${_br(_d.anterior.semana)}` : ' · primeira contagem, ainda sem comparação'}${_d.atual?.por ? ` · contado por ${esc(_d.atual.por)}` : ''}</div></div>
      <button type="button" onclick="corFechar()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);line-height:1;">×</button>
    </div>
    <div style="padding:4px 18px 10px;overflow:auto;flex:1;">
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="font-size:10px;color:var(--muted);text-transform:uppercase;"><th style="text-align:left;padding:4px;">Modelo</th><th style="padding:4px;">Meta</th><th style="padding:4px;">Semana passada</th><th style="padding:4px;">Agora</th><th style="padding:4px;">Diferença</th></tr></thead>
      <tbody id="cor-linhas">${linhasHtml}</tbody></table>
      <div id="cor-resumo" style="font-size:12px;font-weight:700;margin-top:6px;"></div>
      ${nomes.length ? '' : `<div id="cor-vazio" style="font-size:13px;color:var(--muted);padding:12px 4px;">Nenhum modelo cadastrado ainda. Inclua abaixo.</div>`}
      ${pode ? `<div style="display:flex;gap:6px;margin-top:10px;"><input class="fi" id="cor-novo" placeholder="Incluir modelo…" maxlength="60" style="flex:1;" onkeydown="if(event.key==='Enter'){event.preventDefault();corAdd();}"/><button type="button" class="btn btn-ghost btn-sm" onclick="corAdd()">+ Incluir</button></div>` : ''}
    </div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
      ${pode ? `<button class="btn btn-primary" style="flex:1;justify-content:center;min-width:150px;" onclick="corSalvar()">💾 Salvar contagem</button>` : ''}
      ${auto ? `<button class="btn btn-ghost" onclick="corAdiar()">Lembrar em 30 min</button>` : `<button class="btn btn-ghost" onclick="corFechar()">Fechar</button>`}
    </div>
  </div>`;
  document.body.appendChild(el);
  _resumo();
}

// Abaixo da meta: quantos modelos e quantas unidades faltam.
function _resumo() {
  const box = document.getElementById('cor-resumo'); if (!box) return;
  let abaixo = 0, falta = 0, vazios = 0;
  document.querySelectorAll('.cor-l').forEach(l => {
    const meta = Number(l.dataset.meta) || 0, i = l.querySelector('.cor-q');
    const baixo = meta > 0 && i.value !== '' && Number(i.value) < meta;
    i.style.borderColor = baixo ? '#DC2626' : ''; i.style.color = baixo ? '#B91C1C' : '';
    if (i.value === '') vazios++; else if (baixo) { abaixo++; falta += meta - Number(i.value); }
  });
  box.innerHTML = abaixo ? `<span style="color:#B91C1C;">${abaixo} modelo(s) abaixo da meta · faltam ${falta} embalagens para repor</span>` : (vazios ? '' : '<span style="color:#15803D;">✅ Todos os modelos na meta</span>');
}

// Abre sozinho a partir de quarta 17h30 para quem é da montagem, até ser contada.
export function checarPopupCoreanas() {
  if (!S.user || document.getElementById('cor-popup') || document.getElementById('prio-popup')) return;
  carregar();
  if (!_d || _d.erro || !_d.podePreencher || _d.gerencia || _d.atual) return;
  let ate = 0; try { ate = Number(localStorage.getItem(_snooze())) || 0; } catch (_) {}
  if (Date.now() < ate) return;
  abrirCoreanas(true);
}

window.corFechar = () => document.getElementById('cor-popup')?.remove();
window.corAdiar = () => { try { localStorage.setItem(_snooze(), String(Date.now() + 30 * 60000)); } catch (_) {} window.corFechar(); };
window.corDif = (i) => { const c = i.closest('tr').querySelector('.cor-d'); if (c) c.innerHTML = _dif(i.dataset.antes, i.value); _resumo(); };
window.corProx = (i) => { const q = [...document.querySelectorAll('.cor-q')]; q[q.indexOf(i) + 1]?.focus(); };
window.corAdd = () => {
  const i = document.getElementById('cor-novo'); const m = i?.value.trim(); if (!m) return;
  if ([...document.querySelectorAll('.cor-l')].some(l => l.dataset.modelo.toLowerCase() === m.toLowerCase())) return toast('Esse modelo já está na lista.', true);
  document.getElementById('cor-vazio')?.remove();
  document.getElementById('cor-linhas').insertAdjacentHTML('beforeend', _linha(m, undefined, undefined));
  i.value = '';
  document.getElementById('cor-linhas').lastElementChild.querySelector('.cor-q').focus();
};
window.corSalvar = async () => {
  const linhas = [...document.querySelectorAll('.cor-l')].map(l => ({ modelo: l.dataset.modelo, v: l.querySelector('.cor-q').value }));
  if (!linhas.length) return toast('Inclua pelo menos um modelo.', true);
  if (linhas.some(l => l.v === '')) return toast('Preencha todos os modelos (use 0 se acabou).', true);
  try {
    await PUT('/coreanas', { itens: linhas.map(l => ({ modelo: l.modelo, qtd: Number(l.v) })) });
    toast('📦 Contagem salva!');
    window.corFechar();
    _d = null; _at = 0; carregar(true);
  } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
};
window.corAbrir = async () => {
  try { _d = await GET('/coreanas'); _at = Date.now(); abrirCoreanas(false); }
  catch (e) { toast('❌ ' + (e.message || 'Erro'), true); }
};
