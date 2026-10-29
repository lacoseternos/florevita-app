// ── ⚡ ENTREGA EXPRESS LIBERADA/PAUSADA (Marcia 29/out/2026) ──────────
// A expedição liga/desliga. Todas as telas logadas recebem um aviso no canto
// superior (com "Entendi") quando muda — via SSE 'express:status' e, como
// garantia, poll a cada 60s. O PDV mostra "Entrega Express liberada".
import { S } from '../state.js';
import { GET, PUT } from './api.js';

const POLL_MS = 60000;
const LS_VISTO = 'fv_express_visto'; // 'em' do último aviso que ela já confirmou
let _st = null, _timer = null, _box = null;

export const expressLiberada = () => _st?.ativo === true;
export const expressStatus = () => _st;

const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
const _hm = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Manaus' }); };
const _visto = () => { try { return localStorage.getItem(LS_VISTO) || ''; } catch { return ''; } };

function _aviso() {
  if (_box && document.body.contains(_box)) _box.remove();
  if (!_st?.em || _visto() === _st.em) return;
  // Aviso só de mudança recente (abriu o sistema 1 dia depois: não incomoda).
  if (Date.now() - new Date(_st.em).getTime() > 12 * 3600e3) return;
  const on = _st.ativo;
  _box = document.createElement('div');
  _box.id = 'fv-express-aviso';
  _box.setAttribute('style', `position:fixed;top:14px;right:14px;z-index:99995;max-width:340px;width:calc(100vw - 28px);
    background:${on ? 'linear-gradient(135deg,#7C3AED,#DB2777)' : '#334155'};color:#fff;border-radius:14px;padding:12px 14px;
    box-shadow:0 12px 30px rgba(0,0,0,.25);font-family:'DM Sans',system-ui,sans-serif;`);
  _box.innerHTML = `<div style="font-size:15px;font-weight:900;">⚡ Entrega Express ${on ? 'LIBERADA' : 'PAUSADA'}</div>
    <div style="font-size:12.5px;margin-top:4px;line-height:1.4;opacity:.95;">${on
      ? 'Já pode oferecer entrega em até 2h após o pagamento.'
      : 'Não ofereça entrega Express até ser liberada de novo.'}${_st.por ? `<br><span style="opacity:.85;">${_st.por} · ${_hm(_st.em)}</span>` : ''}</div>
    <button type="button" style="margin-top:9px;background:#fff;color:${on ? '#6D28D9' : '#334155'};border:none;border-radius:8px;padding:6px 16px;font-weight:800;cursor:pointer;">Entendi</button>`;
  _box.querySelector('button').onclick = () => { try { localStorage.setItem(LS_VISTO, _st.em); } catch { /* segue */ } _box.remove(); };
  document.body.appendChild(_box);
}

function _aplicar(v) {
  const mudou = !_st || _st.ativo !== v?.ativo || _st.em !== v?.em;
  _st = { ativo: v?.ativo === true, por: v?.por || '', em: v?.em || null };
  if (mudou) { _aviso(); if (['pdv', 'expedicao'].includes(S.page)) _rerender(); }
}

export async function expressRefresh() {
  if (!S.user || !S.token) return;
  try { _aplicar(await GET('/express/status')); } catch { /* sem rede: mantém o último */ }
}
// SSE 'express:status' (realtime.js)
export function expressEvento(v) { _aplicar(v); }

export function startExpressStatus() {
  expressRefresh();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(expressRefresh, POLL_MS);
}

// Botão da expedição
export async function alternarExpress() {
  const novo = !expressLiberada();
  if (!confirm(novo ? 'Liberar a entrega Express? Todas vão receber o aviso.' : 'Pausar a entrega Express? Todas vão receber o aviso.')) return;
  try {
    const v = await PUT('/express/status', { ativo: novo });
    try { localStorage.setItem(LS_VISTO, v.em); } catch { /* segue */ } // quem clicou não precisa do aviso
    _aplicar(v);
    _rerender();
  } catch (e) { alert('Erro: ' + (e.message || 'não foi possível salvar')); }
}
if (typeof window !== 'undefined') window.fvAlternarExpress = alternarExpress;
