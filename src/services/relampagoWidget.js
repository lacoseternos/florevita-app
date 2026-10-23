// ── ⚡ METAS RELÂMPAGO — card flutuante em tempo real ─────────────────────
// Missões com tempo determinado (Programa Estrelas). Aparece num card fixo no
// canto inferior direito de QUALQUER tela do sistema logado, com countdown ao
// vivo e progresso. Faz poll de /campanha/relampago/ativas a cada ~15s (o
// countdown roda no cliente, 1x por segundo). SSE 'relampago:nova' faz aparecer
// na hora que a gerência cria. Mobile-first (a maioria acessa no celular).
import { S } from '../state.js';
import { GET } from './api.js';

const POLL_MS = 15000;      // recarrega a lista do servidor
let _timer = null;          // poll
let _tick = null;           // countdown 1s
let _container = null;
let _metas = [];            // última lista do servidor
let _offset = 0;            // (relógio do servidor − relógio do cliente) em ms
const _celebradas = new Set(); // metas que já soltaram confete (cumprida)

const agoraServidor = () => Date.now() + _offset;

// Só roda pra usuária logada (o servidor decide o público/ativação).
function _podeRodar() {
  if (!S.user || !S.token) return false;
  return true;
}

function ensureContainer() {
  if (_container && document.body.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.id = 'fv-relampago';
  _container.setAttribute('style', `
    position:fixed; bottom:20px; right:20px; z-index:99990;
    display:flex; flex-direction:column; gap:10px;
    max-width:340px; width:calc(100vw - 40px);
    pointer-events:none;`);
  _container.innerHTML = `<style>
    @keyframes rl-in { from { transform:translateY(16px) scale(.96); opacity:0; } to { transform:none; opacity:1; } }
    @keyframes rl-pulse { 0%,100%{ box-shadow:0 0 0 0 rgba(239,68,68,.55);} 50%{ box-shadow:0 0 0 7px rgba(239,68,68,0);} }
    @keyframes rl-dot { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:.35;transform:scale(.8);} }
    @keyframes rl-shine { 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }
    @keyframes rl-confetti { 0%{ transform:translateY(0) rotate(0); opacity:1;} 100%{ transform:translateY(260px) rotate(540deg); opacity:0;} }
    .rl-card{ pointer-events:auto; border-radius:16px; overflow:hidden; background:#fff;
      border:2px solid #FBBF24; box-shadow:0 12px 30px rgba(124,58,237,.22); font-family:'DM Sans',system-ui,sans-serif;
      animation:rl-in .35s cubic-bezier(.2,.8,.2,1); position:relative; }
    .rl-head{ display:flex; align-items:center; gap:8px; padding:9px 12px; color:#fff;
      background:linear-gradient(135deg,#7C3AED,#DB2777,#F59E0B); background-size:200% 100%; animation:rl-shine 6s linear infinite; }
    .rl-head .rl-ic{ font-size:20px; line-height:1; filter:drop-shadow(0 1px 1px rgba(0,0,0,.25)); }
    .rl-head .rl-nm{ flex:1; min-width:0; font-weight:900; font-size:13.5px; line-height:1.2;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .rl-head button{ background:rgba(255,255,255,.22); color:#fff; border:none; width:22px; height:22px;
      border-radius:6px; cursor:pointer; font-size:13px; line-height:1; flex:0 0 auto; }
    .rl-body{ padding:11px 12px; }
    .rl-det{ font-size:11.5px; color:#475569; line-height:1.45; margin-bottom:9px; }
    .rl-count{ display:flex; align-items:baseline; gap:6px; margin-bottom:9px; }
    .rl-count .rl-lbl{ font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#94A3B8; font-weight:800; }
    .rl-count .rl-time{ font-size:21px; font-weight:900; font-variant-numeric:tabular-nums; color:#0F172A; }
    .rl-card.urg .rl-count .rl-time{ color:#DC2626; }
    .rl-card.urg .rl-timewrap{ animation:rl-pulse 1.1s infinite; border-radius:9px; }
    .rl-timewrap{ display:inline-flex; align-items:center; gap:6px; padding:2px 8px; background:#F8FAFC; border-radius:9px; }
    .rl-bar{ height:9px; border-radius:999px; background:#EDE9FE; overflow:hidden; }
    .rl-bar>div{ height:100%; border-radius:999px; background:linear-gradient(90deg,#8B5CF6,#EC4899); transition:width .5s cubic-bezier(.2,.8,.2,1); }
    .rl-prog{ display:flex; justify-content:space-between; align-items:center; font-size:11.5px; font-weight:800; color:#6D28D9; margin:5px 0 2px; }
    .rl-manual{ font-size:11.5px; color:#9333EA; font-weight:700; background:#FAF5FF; border:1px dashed #D8B4FE; border-radius:9px; padding:7px 9px; }
    .rl-reward{ display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
    .rl-pill{ font-size:11px; font-weight:800; padding:4px 9px; border-radius:999px; }
    .rl-pill.star{ background:#FEF3C7; color:#92400E; }
    .rl-pill.cash{ background:#DCFCE7; color:#166534; }
    .rl-done{ background:linear-gradient(135deg,#ECFDF5,#D1FAE5); border:1.5px solid #34D399; border-radius:11px;
      padding:9px 10px; text-align:center; font-weight:900; color:#047857; font-size:13px; margin-top:4px; }
    .rl-card.ok{ border-color:#34D399; }
    .rl-conf{ position:absolute; top:0; left:0; right:0; height:0; overflow:visible; pointer-events:none; z-index:5; }
    .rl-conf i{ position:absolute; top:8px; width:7px; height:11px; border-radius:2px; animation:rl-confetti 1.1s ease-in forwards; }
    .rl-min{ pointer-events:auto; cursor:pointer; display:flex; align-items:center; gap:8px; background:linear-gradient(135deg,#7C3AED,#DB2777);
      color:#fff; border-radius:999px; padding:7px 13px; font-family:'DM Sans',system-ui,sans-serif; font-weight:800; font-size:12px;
      box-shadow:0 8px 20px rgba(124,58,237,.3); animation:rl-in .3s; }
    .rl-min .rl-d{ width:8px;height:8px;border-radius:50%;background:#fff;animation:rl-dot 1.2s infinite; }
    @media(max-width:560px){ #fv-relampago{ bottom:12px; right:12px; left:12px; width:auto; max-width:none; } }
  </style>`;
  document.body.appendChild(_container);
  return _container;
}

// Estado colapsado por meta (conveniência por aparelho).
function _colapsada(id, set) {
  try {
    if (set === undefined) return localStorage.getItem('fv_rl_min_' + id) === '1';
    if (set) localStorage.setItem('fv_rl_min_' + id, '1'); else localStorage.removeItem('fv_rl_min_' + id);
  } catch (_) { return false; }
}

function fmtTempo(ms) {
  if (ms <= 0) return '00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(mi)}:${p(se)}` : `${p(mi)}:${p(se)}`;
}

function soltarConfete(card) {
  const box = document.createElement('div');
  box.className = 'rl-conf';
  const cores = ['#F59E0B', '#EC4899', '#8B5CF6', '#34D399', '#38BDF8', '#FB7185'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('i');
    p.style.left = (6 + Math.random() * 88) + '%';
    p.style.background = cores[i % cores.length];
    p.style.animationDelay = (Math.random() * 0.25) + 's';
    box.appendChild(p);
  }
  card.appendChild(box);
  setTimeout(() => box.remove(), 1500);
}

function corpoMeta(m) {
  const cumprida = !!m.cumprida;
  const auto = m.modo === 'auto';
  const reward = `<div class="rl-reward">
      <span class="rl-pill star">⭐ ${m.estrelas} ${m.estrelas === 1 ? 'estrela' : 'estrelas'}</span>
      ${m.bonusRs > 0 ? `<span class="rl-pill cash">💰 R$ ${Number(m.bonusRs).toFixed(2).replace('.', ',')}</span>` : ''}
    </div>`;
  if (cumprida) {
    return `<div class="rl-done">🎉 Cumprida! +${m.estrelas}⭐${m.bonusRs > 0 ? ' e R$ ' + Number(m.bonusRs).toFixed(2).replace('.', ',') : ''}</div>${reward}`;
  }
  let meio;
  if (auto) {
    const pct = Math.max(0, Math.min(100, Number(m.pct) || 0));
    const money = m.metrica === 'faturamento';
    const val = money ? ('R$ ' + Number(m.valor || 0).toLocaleString('pt-BR')) : (m.valor || 0);
    const alv = money ? ('R$ ' + Number(m.alvo || 0).toLocaleString('pt-BR')) : (m.alvo || 0);
    meio = `<div class="rl-prog"><span>${val} de ${alv}</span><span>${pct}%</span></div>
      <div class="rl-bar"><div style="width:${pct}%"></div></div>`;
  } else {
    meio = `<div class="rl-manual">✋ Missão livre — a gerência confirma quem cumprir.</div>`;
  }
  return `${m.detalhes ? `<div class="rl-det">${esc(m.detalhes)}</div>` : ''}
    <div class="rl-count">
      <span class="rl-timewrap"><span class="rl-lbl">⏱️ termina em</span> <span class="rl-time" data-rl-time="${m.id}">${fmtTempo((Date.parse(m.fim) || 0) - agoraServidor())}</span></span>
    </div>
    ${meio}${reward}`;
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function cardMinimizado(m) {
  const el = document.createElement('div');
  el.className = 'rl-min';
  el.setAttribute('data-rl-id', m.id);
  el.innerHTML = `<span class="rl-d"></span><span>${m.icon || '⚡'}</span><span data-rl-time="${m.id}">${fmtTempo((Date.parse(m.fim) || 0) - agoraServidor())}</span>`;
  el.addEventListener('click', () => { _colapsada(m.id, false); render(); });
  return el;
}

function cardCompleto(m) {
  const card = document.createElement('div');
  card.className = 'rl-card' + (m.cumprida ? ' ok' : '');
  card.setAttribute('data-rl-id', m.id);
  card.innerHTML = `
    <div class="rl-head">
      <span class="rl-ic">${m.icon || '⚡'}</span>
      <span class="rl-nm">⚡ ${esc(m.nome)}</span>
      <button data-rl-close title="Minimizar">–</button>
    </div>
    <div class="rl-body">${corpoMeta(m)}</div>`;
  card.querySelector('[data-rl-close]')?.addEventListener('click', () => { _colapsada(m.id, true); render(); });
  if (m.cumprida && !_celebradas.has(m.id)) { _celebradas.add(m.id); setTimeout(() => soltarConfete(card), 60); }
  return card;
}

// Reconstrói os cards a partir de _metas (poll). O tick só atualiza os tempos.
function render() {
  if (!_metas.length) { if (_container) _container.querySelectorAll('.rl-card,.rl-min').forEach(n => n.remove()); return; }
  const c = ensureContainer();
  c.querySelectorAll('.rl-card,.rl-min').forEach(n => n.remove());
  for (const m of _metas) c.appendChild(_colapsada(m.id) ? cardMinimizado(m) : cardCompleto(m));
}

// Atualiza só os números do countdown (1x/s) sem recriar os cards.
function tickCountdown() {
  if (!_container || !_metas.length) return;
  let precisaPoll = false;
  for (const m of _metas) {
    const rest = (Date.parse(m.fim) || 0) - agoraServidor();
    const els = _container.querySelectorAll(`[data-rl-time="${CSS.escape(m.id)}"]`);
    els.forEach(el => { el.textContent = fmtTempo(rest); });
    const card = _container.querySelector(`.rl-card[data-rl-id="${CSS.escape(m.id)}"]`);
    if (card && !m.cumprida) card.classList.toggle('urg', rest > 0 && rest <= 5 * 60000);
    if (rest <= 0) precisaPoll = true; // acabou → confirma com o servidor e tira da tela
  }
  if (precisaPoll) poll();
}

let _polling = false;
async function poll() {
  if (_polling || !_podeRodar()) return;
  _polling = true;
  try {
    const d = await GET('/campanha/relampago/ativas');
    if (d && Array.isArray(d.metas)) {
      if (d.agora) { const sv = Date.parse(d.agora); if (!Number.isNaN(sv)) _offset = sv - Date.now(); }
      // Mantém a ordem estável (mais perto de terminar primeiro).
      _metas = d.metas.slice().sort((a, b) => (Date.parse(a.fim) || 0) - (Date.parse(b.fim) || 0));
      render();
    }
  } catch (_) { /* silencioso: é um widget de fundo */ }
  finally { _polling = false; }
}

// Chamado pelo realtime (SSE) quando a gerência cria uma meta — aparece na hora.
export function relampagoRefresh() { poll(); }

export function startRelampagoWidget() {
  if (_timer) return;
  if (!_podeRodar()) return;
  setTimeout(poll, 2500);
  _timer = setInterval(poll, POLL_MS);
  _tick = setInterval(tickCountdown, 1000);
  console.log('[relampago] widget iniciado — poll a cada ' + (POLL_MS / 1000) + 's');
}

export function stopRelampagoWidget() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_tick) { clearInterval(_tick); _tick = null; }
  _metas = [];
  if (_container) { _container.remove(); _container = null; }
}
