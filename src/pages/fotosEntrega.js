// ── 📷 FOTOS DAS ENTREGAS (Marcia 26/out/2026) ──────────────────────────────
// Galeria das fotos que os entregadores anexam ao confirmar a entrega, por
// data, com busca (pedido, cliente, quem recebeu, entregador, bairro).
// Miniaturas na lista; a foto grande vem sob demanda (GET /orders/:id/foto-entrega).
import { S } from '../state.js';
import { GET } from '../services/api.js';
import { esc } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

const _hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
const st = { de: '', ate: '', q: '', dados: null, erro: '', carregando: false, chave: '' };

async function _render() { const m = await import('../main.js'); m.render(); }
async function carregar() {
  const chave = st.de + '|' + st.ate + '|' + st.q;
  if (st.carregando || st.chave === chave) return;
  st.carregando = true; st.erro = ''; st.chave = chave;
  try {
    const p = new URLSearchParams({ de: st.de, ate: st.ate });
    if (st.q) p.set('q', st.q);
    st.dados = await GET('/fotos-entrega?' + p.toString());
  } catch (e) { st.erro = e.message || 'Erro ao carregar as fotos'; st.dados = null; }
  st.carregando = false;
  _render();
}
const _hora = (d) => { try { return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

export function renderFotosEntrega() {
  if (!st.de) { st.de = _hoje(); st.ate = st.de; }
  carregar();
  const fotos = st.dados?.fotos || [];
  return `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <div><div style="font-weight:900;font-size:16px;">📷 Fotos das entregas</div>
        <div style="font-size:11.5px;color:var(--muted);">Fotos que os entregadores anexam ao confirmar a entrega. Toque numa foto pra ver grande.</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;">
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:flex;flex-direction:column;gap:3px;">De<input class="fi" type="date" id="fe-de" value="${st.de}" style="max-width:150px;"/></label>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:flex;flex-direction:column;gap:3px;">Até<input class="fi" type="date" id="fe-ate" value="${st.ate}" style="max-width:150px;"/></label>
      <label style="font-size:11px;font-weight:700;color:var(--muted);display:flex;flex-direction:column;gap:3px;flex:1;min-width:160px;">Buscar<input class="fi" id="fe-q" value="${esc(st.q)}" placeholder="pedido, cliente, quem recebeu, entregador, bairro"/></label>
      <button class="btn btn-primary" onclick="feFiltrar()">🔍 Filtrar</button>
      <button class="btn btn-ghost" onclick="feAtalho(0)">Hoje</button>
      <button class="btn btn-ghost" onclick="feAtalho(1)">Ontem</button>
      <button class="btn btn-ghost" onclick="feAtalho(7)">7 dias</button>
    </div>
  </div>
  ${st.erro ? `<div class="card" style="color:var(--red);">⚠️ ${esc(st.erro)}</div>`
    : st.carregando && !st.dados ? '<div class="card" style="text-align:center;color:var(--muted);padding:30px;">⏳ Carregando as fotos…</div>'
    : !fotos.length ? '<div class="card" style="text-align:center;color:var(--muted);padding:30px;">Nenhuma foto de entrega nesse período.</div>'
    : `<div style="font-size:12px;color:var(--muted);margin:0 2px 8px;">${fotos.length} foto(s)</div>
       <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
       ${fotos.map(f => `<div class="card" style="padding:0;overflow:hidden;margin:0;">
         <div onclick="feVer('${esc(f.orderId)}')" style="cursor:zoom-in;background:#F1F5F9;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;">
           ${f.miniatura ? `<img src="${f.miniatura}" alt="Foto da entrega" style="width:100%;height:100%;object-fit:cover;"/>` : '<span style="font-size:30px;">📷</span>'}</div>
         <div style="padding:8px 10px;font-size:11.5px;line-height:1.45;">
           <div style="font-weight:800;">Pedido #${esc(f.orderNumber || '—')}</div>
           <div style="color:var(--muted);">${esc(_hora(f.entregueEm))}${f.bairro ? ' · ' + esc(f.bairro) : ''}</div>
           <div>👤 ${esc(f.recebidoPor || '—')}</div>
           <div>🛵 ${esc(f.entregadorNome || '—')}</div>
           <button class="btn btn-ghost btn-sm" style="margin-top:5px;width:100%;justify-content:center;" onclick="showOrderViewModal('${esc(f.orderId)}')">📋 Abrir pedido</button>
         </div></div>`).join('')}
       </div>`}`;
}

window.feFiltrar = () => {
  st.de = document.getElementById('fe-de')?.value || _hoje();
  st.ate = document.getElementById('fe-ate')?.value || st.de;
  if (st.ate < st.de) [st.de, st.ate] = [st.ate, st.de];
  st.q = (document.getElementById('fe-q')?.value || '').trim();
  st.chave = ''; _render();
};
window.feAtalho = (dias) => {
  const h = _hoje();
  const menos = (n) => new Date(new Date(h + 'T12:00:00Z').getTime() - n * 864e5).toISOString().slice(0, 10);
  if (dias === 1) { st.de = menos(1); st.ate = st.de; } else { st.de = dias ? menos(dias - 1) : h; st.ate = h; }
  st.chave = ''; _render();
};
// Foto grande: busca sob demanda e abre por cima da tela.
window.feVer = async (orderId) => {
  try {
    if (!S._fotosEntGaleria) S._fotosEntGaleria = {};
    if (!S._fotosEntGaleria[orderId]) S._fotosEntGaleria[orderId] = await GET('/orders/' + orderId + '/foto-entrega');
    window.verFotoEntregaGrande?.(orderId);
  } catch (e) { toast('❌ ' + (e.message || 'Não foi possível abrir a foto'), true); }
};
