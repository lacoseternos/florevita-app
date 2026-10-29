// ── 🌡️ TERMÔMETRO DA META GERAL (Marcia 29/out/2026) ──────────────────
// Meta da LOJA do dia (soma dos canais) com as luzes da régua do servidor
// (statusMeta): 🔴 abaixo · 🟡 95% da realista · 🟢 realista com ticket
// médio ≥ R$ 180 (ou a agressiva) · ⭐ 17% acima da agressiva. A cor vem do
// status que o servidor manda (/comissoes/resumo-dia → loja). Mesma lógica
// no painel-tv.html (cópia inline, lá não tem módulos).
// A cada luz subida no dia toca uma musiquinha (uma vez por aparelho).
// Nada de R$ nem % na tela: só a barra subindo e as luzes.
export const NIVEIS = ['vermelho', 'amarelo', 'verde', 'estrela'];
const COR = { vermelho: '#EF4444', amarelo: '#F59E0B', verde: '#22C55E', estrela: '#EAB308' };
const EMOJI = { vermelho: '🔴', amarelo: '🟡', verde: '🟢', estrela: '⭐' };

// Marcas da régua em R$ (só as que existem com a meta configurada).
export function marcasTermometro(l) {
  const R = Number(l?.realista) || 0, A = Number(l?.agressiva) || 0;
  const m = [];
  if (R > 0) m.push({ nivel: 'amarelo', valor: R * 0.95 }, { nivel: 'verde', valor: R });
  else if (A > 0) m.push({ nivel: 'verde', valor: A });
  if (A > 0) m.push({ nivel: 'estrela', valor: A * 1.17 });
  return m;
}

// Próxima luz — SEM valores (Marcia 29/out: "só subindo, não mostre valores").
function _proxima(l) {
  const F = Number(l.faturamento) || 0, R = Number(l.realista) || 0, A = Number(l.agressiva) || 0;
  const s = l.status;
  if (s === 'estrela') return '⭐ Estrela do dia! Vocês arrasaram!';
  if (s === 'verde') return A > 0 ? '🟢 Meta batida! Rumo à ⭐ estrela' : '🟢 Meta batida!';
  if (s === 'amarelo') return F >= R && R > 0 ? '🟡 Quase lá! Capricha no ticket médio para o 🟢' : '🟡 Quase lá! Próxima luz: 🟢';
  return '🔴 Bora subir! Próxima luz: 🟡';
}

// HTML do termômetro (horizontal). compacto = Meu Painel no celular.
export function termometroHTML(l) {
  if (!l || !l.status) return '';
  const F = Number(l.faturamento) || 0;
  const marcas = marcasTermometro(l);
  if (!marcas.length) return '';
  const topo = Math.max(marcas[marcas.length - 1].valor * 1.05, F);
  const pct = (v) => Math.max(0, Math.min(100, v / topo * 100));
  const cor = COR[l.status] || '#94A3B8';
  return `<div class="card" style="margin-bottom:14px;padding:14px 16px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <div style="font-size:14px;font-weight:800;color:#0F172A;">🌡️ Meta geral da loja hoje</div>
    </div>
    <div style="display:flex;align-items:center;gap:0;">
      <div style="width:34px;height:34px;border-radius:50%;background:${cor};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 0 0 3px #fff,0 0 0 5px ${cor}33;z-index:1;">${EMOJI[l.status]}</div>
      <div style="position:relative;flex:1;height:18px;margin-left:-6px;background:#F1F5F9;border:2px solid #E2E8F0;border-left:none;border-radius:0 999px 999px 0;">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${pct(F)}%;background:linear-gradient(90deg,${cor}AA,${cor});border-radius:0 999px 999px 0;transition:width .8s;"></div>
        ${marcas.map(m => `<div style="position:absolute;left:${pct(m.valor)}%;top:-4px;bottom:-4px;width:2px;background:${COR[m.nivel]};"></div>`).join('')}
      </div>
    </div>
    <div style="position:relative;height:18px;margin-left:28px;">
      ${marcas.map(m => `<div style="position:absolute;left:${pct(m.valor)}%;transform:translateX(-50%);font-size:11px;top:3px;">${EMOJI[m.nivel]}</div>`).join('')}
    </div>
    <div style="font-size:12px;font-weight:700;color:#334155;margin-top:4px;">${_proxima(l)}</div>
  </div>`;
}

// ── 🎵 Musiquinhas (Web Audio, sem arquivo) ──
let _ctx = null;
function _nota(f, ini, dur, vol = 0.25, tipo = 'triangle') {
  try {
    _ctx = _ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
    const o = _ctx.createOscillator(), g = _ctx.createGain();
    o.type = tipo; o.frequency.value = f;
    const t = _ctx.currentTime + ini;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(_ctx.destination); o.start(t); o.stop(t + dur + 0.05);
  } catch (_) {}
}
// [freq, duração] em sequência — cada luz tem a sua (mais festa a cada nível).
export const MUSICAS = {
  amarelo: [[523, .15], [659, .15], [784, .3]],
  verde:   [[523, .12], [659, .12], [784, .12], [1047, .4]],
  estrela: [[784, .1], [988, .1], [1175, .1], [1568, .25], [1175, .1], [1568, .5], [2093, .6]],
};
export function tocarNivel(nivel) {
  let t = 0;
  for (const [f, d] of (MUSICAS[nivel] || [])) { _nota(f, t, d + 0.05); t += d; }
}

// Toca quando a luz SOBE em relação à última vista hoje neste aparelho. A
// primeira vez no dia só guarda (não toca ao abrir a página no meio do dia).
export function checarSubidaNivel(status, chave = 'fv_termo') {
  if (!NIVEIS.includes(status)) return;
  const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
  const k = `${chave}_${dia}`;
  let antes = null;
  try { antes = localStorage.getItem(k); } catch (_) {}
  if (antes === status) return;
  try { localStorage.setItem(k, status); } catch (_) {}
  if (antes && NIVEIS.indexOf(status) > NIVEIS.indexOf(antes)) tocarNivel(status);
}
