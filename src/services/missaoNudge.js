// 🎯 "Falta pouco!" (Marcia 25/nov/2026): de tempos em tempos olha as missões
// da colaboradora e, se alguma estiver entre 50% e quase completa, mostra um
// aviso no canto da tela — "Falta só 4 chocolates para ganhar 1⭐". Vale pra
// todos os setores. A mesma missão só é lembrada de novo depois de 1 hora.
import { S } from '../state.js';
import { GET } from './api.js';

const INTERVALO = 20 * 60 * 1000;
const PRIMEIRA = 2 * 60 * 1000;
const REPETIR_MS = 60 * 60 * 1000;
const KEY = 'fv_nudge_vistos';
let _timer = null, _first = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => 'R$ ' + Math.ceil(Number(v) || 0).toLocaleString('pt-BR');

function _vistos() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function _marcar(id) { try { const v = _vistos(); v[id] = Date.now(); for (const k of Object.keys(v)) if (Date.now() - v[k] > 6 * 3600e3) delete v[k]; localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) {} }

// Escolhe a missão mais perto de completar que ainda não foi lembrada há pouco.
function _escolher(missoes) {
  const vistos = _vistos();
  const cands = (missoes || []).filter(m => !m.manual && !m.autoBaixa && (m.vezes || 0) < (m.limite || 1) && Number(m.alvo) > 0
    && m.tipo !== 'semana' && !m.aguardaFimDia && !m.semMeta && m.metrica !== 'metaEmpresaDia')
    .map(m => ({ m, f: (Number(m.progresso) || 0) / Number(m.alvo) }))
    .filter(x => x.f >= 0.5 && x.f < 1 && !(vistos[x.m.id] && Date.now() - vistos[x.m.id] < REPETIR_MS))
    .sort((a, b) => b.f - a.f);
  return cands[0]?.m || null;
}

function _texto(m) {
  const falta = Math.max(0, Number(m.alvo) - (Number(m.progresso) || 0));
  if (m.pct) return `Faltam <b>${Math.ceil(falta)}%</b> para`;
  if (m.money) return `Faltam só <b>${brl(falta)}</b> para`;
  const n = Math.ceil(falta);
  return `Falta${n > 1 ? 'm' : ''} só <b>${n}</b> para`;
}

function _mostrar(m) {
  document.getElementById('fv-nudge')?.remove();
  const el = document.createElement('div');
  el.id = 'fv-nudge';
  el.setAttribute('style', 'position:fixed;left:16px;bottom:16px;z-index:99980;max-width:320px;width:calc(100vw - 32px);background:#fff;border:2px solid #F59E0B;border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:11px 12px;font-family:DM Sans,system-ui,sans-serif;animation:fvNudgeIn .35s ease;');
  el.innerHTML = `<style>@keyframes fvNudgeIn{from{transform:translateY(14px);opacity:0}to{transform:none;opacity:1}}</style>
    <div style="display:flex;gap:10px;align-items:flex-start;">
      <div style="font-size:26px;line-height:1;">${esc(m.icon || '🎯')}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:11px;font-weight:900;color:#B45309;text-transform:uppercase;letter-spacing:1px;">Falta pouco! ⭐</div>
        <div style="font-size:13px;color:#1E293B;line-height:1.35;margin-top:2px;">${_texto(m)} <b>${esc(m.label || m.nome)}</b> — vale <b>+${m.estrelasUnit || 1}⭐</b></div>
        <div style="height:6px;background:#FEF3C7;border-radius:99px;margin-top:7px;overflow:hidden;"><div style="height:100%;width:${Math.min(100, Math.round((Number(m.progresso) || 0) / Number(m.alvo) * 100))}%;background:linear-gradient(90deg,#F59E0B,#EA580C);"></div></div>
      </div>
      <button type="button" aria-label="Fechar" style="background:none;border:none;font-size:16px;cursor:pointer;color:#94A3B8;">✕</button>
    </div>`;
  el.querySelector('button').onclick = () => el.remove();
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 15000);
}

async function _checar() {
  try {
    if (!S.user || !S.token || document.hidden) return;
    const r = await GET('/campanha/me');
    if (!r?.ativa || !r.progresso) return;
    const m = _escolher(r.progresso.missoes);
    if (!m) return;
    _marcar(m.id);
    _mostrar(m);
  } catch (_) { /* silencioso */ }
}

export function startMissaoNudge() {
  if (_timer) return;
  _first = setTimeout(_checar, PRIMEIRA);
  _timer = setInterval(_checar, INTERVALO);
}
export function stopMissaoNudge() { clearInterval(_timer); clearTimeout(_first); _timer = null; }

