import { S } from '../state.js';
import { $c, $d, sc, ini, esc, PAY_STATUS_COLORS, PAY_STATUS_OPTIONS, paymentStatusBadge, normalizePaymentStatus } from '../utils/formatters.js';
import { toast, searchOrders } from '../utils/helpers.js';
import { PATCH, PUT } from '../services/api.js';
import { can, getColabs, findColab } from '../services/auth.js';
import { recarregarDados, invalidateCache } from '../services/cache.js';
import { normalizeUnidade, labelUnidade, isAdmin, filtrarPedidosParaListagem, siglaUnidade } from '../utils/unidadeRules.js';
import { ZONAS_MANAUS, bairrosAgrupados, agruparEroteirizar, agruparPorTurnoEZona, resolveZona, TURNOS, getTurnoPedido } from '../utils/zonasManaus.js';
import { manausDateStr as _manausDateStrSrv, serverNow as _serverNowSrv } from '../services/serverClock.js';

async function render(){ const { render:r } = await import('../main.js'); r(); }

export let selectedOrders = [];

// ── MONTAR ROTAS (Dashboard → ordem da Produção) ───────────────
// Marcia (out/2026): montar rotas manualmente (Rota 1, 2, ...), com os
// pedidos em ordem de PRIORIDADE DE SAÍDA. Essa ordem é a que a Produção
// usa pra preparar (Rota 1 inteira, depois Rota 2...). A rota é só um
// agrupamento — o entregador é atribuído depois, na Expedição.
// Persistência: campos `rota` (número) e `deliveryOrder` (prioridade dentro
// da rota) via PUT /orders/:id (backend strict:false aceita).
export function _isRouteEligible(o) {
  if (!o) return false;
  const t = String(o.tipo || o.type || 'delivery').toLowerCase();
  const isDel = (t.includes('deliver') || t.includes('entrega')) && !t.includes('retir') && !t.includes('balc');
  // Exclui despachados (já saíram) e finalizados — planejamos só o que falta.
  return isDel && o.status !== 'Cancelado' && o.status !== 'Entregue' && o.status !== 'Saiu p/ entrega';
}

// Um pedido está "não planejado" (mostra SUGESTÃO) quando rota é null/undefined.
// rota === 0 = confirmado SEM rota (não sugere); rota > 0 = confirmado numa rota.
function _isUnplanned(o) { return o.rota === undefined || o.rota === null; }

// Gera a SUGESTÃO de rotas (preview) pros pedidos ainda não planejados:
// agrupa por TURNO (respeita horário específico) e por ZONA/bairro próximos,
// e quebra em rotas de ATÉ 3 pedidos. Numera a partir de startFrom.
// Retorna Map<orderId, { rota, ordem }>. Marcia (out/2026).
function _computeRouteSuggestion(pool, startFrom) {
  const sug = new Map();
  let rotaNum = Math.max(1, startFrom || 1);
  const turnos = agruparPorTurnoEZona(pool || []);
  turnos.forEach(t => {
    (t.zonas || []).forEach(z => {
      const peds = z.pedidos || [];
      for (let i = 0; i < peds.length; i += 3) {
        const chunk = peds.slice(i, i + 3); // até 3 por rota
        chunk.forEach((o, idx) => sug.set(String(o._id), { rota: rotaNum, ordem: idx + 1 }));
        rotaNum++;
      }
    });
  });
  return sug;
}

function _rbColor(n) {
  const cores = ['#64748B', '#7C3AED', '#2563EB', '#059669', '#D97706', '#DB2777', '#0891B2', '#B45309'];
  return cores[n % cores.length];
}

function _buildRouteBuilderHtml(orders) {
  const pool = (orders || []).filter(_isRouteEligible);

  // SUGESTÃO (preview) pros não planejados — numerada após as rotas confirmadas.
  const maxConfirmado = pool.reduce((m, o) => Math.max(m, Number(o.rota) || 0), 0);
  const naoPlanejados = pool.filter(_isUnplanned);
  const sugestao = _computeRouteSuggestion(naoPlanejados, maxConfirmado + 1);

  // Valor efetivo (confirmado OU sugerido) de cada pedido.
  const eff = (o) => {
    if (!_isUnplanned(o)) return { rota: Number(o.rota) || 0, ordem: Number(o.deliveryOrder) || 0, sug: false };
    const s = sugestao.get(String(o._id));
    return s ? { rota: s.rota, ordem: s.ordem, sug: true } : { rota: 0, ordem: 0, sug: true };
  };

  const byRota = {};
  pool.forEach(o => { const r = eff(o).rota; (byRota[r] = byRota[r] || []).push(o); });
  const maxRota = pool.reduce((m, o) => Math.max(m, eff(o).rota), 0);

  // Colunas: Sem rota (0), Rota 1..maxRota, + 1 coluna vazia pra criar nova.
  const colNums = [0];
  for (let n = 1; n <= Math.max(1, maxRota) + 1; n++) colNums.push(n);

  const totalEmRota = pool.filter(o => eff(o).rota > 0).length;
  const semRota = (byRota[0] || []).length;
  const qtdSugeridos = pool.filter(o => eff(o).sug && eff(o).rota > 0).length;

  const card = (o, idx, rota, isSug) => {
    const num = esc(String(o.orderNumber || o.numero || '—'));
    const recip = esc(String(o.recipient || o.clientName || '—'));
    const bairro = esc(String(o.deliveryNeighborhood || o.deliveryZone || ''));
    const hora = (o.scheduledTime && o.scheduledTime !== '00:00') ? esc(o.scheduledTime) : '';
    const turno = esc(String(o.scheduledPeriod || ''));
    const cor = _rbColor(rota);
    const seq = rota > 0 ? `<span style="background:${isSug ? '#fff' : cor};color:${isSug ? cor : '#fff'};border:1.5px solid ${cor};min-width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0;">${idx + 1}</span>` : `<span style="width:22px;flex-shrink:0;"></span>`;
    return `<div class="rb-card" data-rb-id="${o._id}" data-rb-rota="${rota}"
      style="display:flex;align-items:center;gap:8px;background:${isSug ? '#FEFCE8' : '#fff'};border:${isSug ? '1.5px dashed ' + cor : '1px solid #E2E8F0'};border-left:4px solid ${cor};border-radius:8px;padding:8px 10px;margin-bottom:6px;">
      <input type="checkbox" class="rb-check" data-rb-id="${o._id}" style="width:17px;height:17px;flex-shrink:0;accent-color:#059669;cursor:pointer;"/>
      ${seq}
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;font-size:13px;color:#1E293B;">#${num} <span style="font-weight:600;color:#475569;">${recip}</span>${isSug && rota > 0 ? ' <span style="font-size:9px;font-weight:800;color:#CA8A04;background:#FEF9C3;border-radius:6px;padding:1px 5px;">💡 sugestão</span>' : ''}</div>
        <div style="font-size:11px;color:#64748B;">${bairro}${bairro && (hora || turno) ? ' · ' : ''}${hora}${hora && turno ? ' ' : ''}${turno}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">
        <button class="rb-up" data-rb-id="${o._id}" title="Subir prioridade" style="border:1px solid #E2E8F0;background:#F8FAFC;border-radius:5px;font-size:11px;line-height:1;padding:3px 6px;cursor:pointer;${rota > 0 ? '' : 'visibility:hidden;'}">▲</button>
        <button class="rb-down" data-rb-id="${o._id}" title="Descer prioridade" style="border:1px solid #E2E8F0;background:#F8FAFC;border-radius:5px;font-size:11px;line-height:1;padding:3px 6px;cursor:pointer;${rota > 0 ? '' : 'visibility:hidden;'}">▼</button>
      </div>
    </div>`;
  };

  // Opções de destino pra barra de seleção (mover marcados).
  const bulkOptions = () => {
    let opts = `<option value="">— mover para... —</option><option value="0">📥 Sem rota</option>`;
    for (let n = 1; n <= Math.max(1, maxRota) + 1; n++) {
      opts += `<option value="${n}">${n === Math.max(1, maxRota) + 1 ? '+ Nova rota ' + n : 'Rota ' + n}</option>`;
    }
    return opts;
  };

  const col = (n) => {
    const list = (byRota[n] || []).slice().sort((a, b) =>
      (eff(a).ordem || 999) - (eff(b).ordem || 999) ||
      String(a.scheduledTime || '99:99').localeCompare(String(b.scheduledTime || '99:99')));
    const cor = _rbColor(n);
    const titulo = n === 0 ? '📥 Sem rota' : `🚚 Rota ${n}`;
    const isNova = n > maxRota && n !== 0;
    return `<div class="rb-col" data-rb-col="${n}"
      style="flex:0 0 260px;background:#F8FAFC;border:2px dashed ${n === 0 ? '#CBD5E1' : cor + '66'};border-radius:12px;padding:10px;min-height:120px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <span style="font-weight:900;font-size:14px;color:${n === 0 ? '#475569' : cor};">${titulo}</span>
        <span style="background:${n === 0 ? '#CBD5E1' : cor};color:#fff;border-radius:12px;padding:1px 9px;font-size:11px;font-weight:800;">${list.length}</span>
      </div>
      ${list.map((o, i) => card(o, i, n, eff(o).sug)).join('') || `<div style="text-align:center;color:#94A3B8;font-size:11px;padding:16px 4px;">${isNova ? 'Arraste um pedido aqui<br>para criar esta rota' : (n === 0 ? 'Nenhum pedido fora de rota' : 'Arraste pedidos aqui')}</div>`}
    </div>`;
  };

  const temSugestao = qtdSugeridos > 0;
  return `
  <div id="route-builder">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;background:${temSugestao ? '#FEFCE8' : '#F0FDF4'};border:1px solid ${temSugestao ? '#FDE68A' : '#BBF7D0'};border-radius:10px;padding:10px 12px;">
      <div style="font-size:12px;color:#475569;flex:1;min-width:220px;">
        ${temSugestao
          ? `💡 <b>Sugestão automática</b> (por turno/horário + bairro próximo, até 3 por rota). Revise e <b>confirme</b> — ou ajuste marcando os pedidos e movendo / pelas setas ▲▼.`
          : `✅ Rotas confirmadas. <b>${totalEmRota}</b> em rota. Ajuste à vontade — a <b>Produção</b> segue esta ordem.`}
      </div>
      ${temSugestao ? `<button id="rb-confirm" class="btn btn-primary btn-sm" style="background:#059669;">✅ Confirmar sugestão (${qtdSugeridos})</button>` : ''}
      <button id="rb-resuggest" class="btn btn-ghost btn-sm" title="Refazer a sugestão do zero">🔄 Refazer sugestão</button>
      <button id="rb-clear" class="btn btn-ghost btn-sm" style="color:#DC2626;">🧹 Tirar todos das rotas</button>
    </div>
    <!-- Barra de seleção: marque os pedidos e mova (sem arrastar) -->
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:8px 12px;margin-bottom:10px;">
      <span style="font-size:12px;color:#1E40AF;font-weight:700;">☑️ <b id="rb-selcount">0</b> marcado(s)</span>
      <select id="rb-bulk-rota" class="fi" style="width:auto;min-width:150px;font-size:12px;padding:5px 8px;">${bulkOptions()}</select>
      <button id="rb-bulk-apply" class="btn btn-primary btn-sm">Mover marcados</button>
      <span style="width:1px;height:20px;background:#BFDBFE;"></span>
      <button id="rb-selall" class="btn btn-ghost btn-sm">Marcar todos</button>
      <button id="rb-selnone" class="btn btn-ghost btn-sm">Limpar seleção</button>
    </div>
    <div class="rb-cols" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;align-items:flex-start;">
      ${colNums.map(col).join('')}
    </div>
  </div>`;
}

// "Materializa" a SUGESTÃO: grava em memória (sem persistir) a rota/ordem
// sugerida nos pedidos ainda não planejados, pra qualquer ação manual já
// trabalhar com tudo planejado (what-you-see-is-what-you-get).
function _materializeSuggestion() {
  const elig = (S.orders || []).filter(_isRouteEligible);
  const unplanned = elig.filter(_isUnplanned);
  if (!unplanned.length) return;
  const maxConf = elig.reduce((m, o) => Math.max(m, Number(o.rota) || 0), 0);
  const sug = _computeRouteSuggestion(unplanned, maxConf + 1);
  unplanned.forEach(o => {
    const s = sug.get(String(o._id));
    if (s) { o.rota = s.rota; o.deliveryOrder = s.ordem; }
    else { o.rota = 0; o.deliveryOrder = null; }
  });
}

// Recalcula rota + deliveryOrder dos pedidos PLANEJADOS (rota != null),
// compacta 1..N por rota, re-renderiza e persiste só o que mudou. Não mexe
// nos não-planejados (que seguem mostrando a sugestão).
function _renumberAndPersistRoutes() {
  const elig = (S.orders || []).filter(_isRouteEligible);
  const planned = elig.filter(o => !_isUnplanned(o)); // rota 0 (sem rota) ou >0
  const byRota = {};
  planned.forEach(o => { const r = Number(o.rota) || 0; (byRota[r] = byRota[r] || []).push(o); });
  const changed = [];
  Object.keys(byRota).forEach(rk => {
    const r = Number(rk);
    if (r === 0) {
      byRota[r].forEach(o => {
        if ((Number(o.rota) || 0) !== 0 || o.deliveryOrder != null) {
          o.rota = 0; o.deliveryOrder = null;
          changed.push({ id: o._id, rota: 0, deliveryOrder: null });
        }
      });
      return;
    }
    const list = byRota[r].slice().sort((a, b) =>
      (Number(a.deliveryOrder) || 999) - (Number(b.deliveryOrder) || 999) ||
      String(a.scheduledTime || '99:99').localeCompare(String(b.scheduledTime || '99:99')));
    list.forEach((o, i) => {
      const no = i + 1;
      if ((Number(o.rota) || 0) !== r || (Number(o.deliveryOrder) || 0) !== no) {
        o.rota = r; o.deliveryOrder = no;
        changed.push({ id: o._id, rota: r, deliveryOrder: no });
      }
    });
  });
  render();
  changed.forEach(ch => { PUT('/orders/' + ch.id, { rota: ch.rota, deliveryOrder: ch.deliveryOrder }).catch(() => {}); });
  if (changed.length) { try { toast('✅ Rotas salvas'); } catch (_) {} }
}

// Define rota de TODOS os elegíveis (null = volta a sugerir; 0 = sem rota) e
// persiste só o que mudou. Usado por "Refazer sugestão" e "Tirar todos".
function _setAllRoutes(rotaVal) {
  const elig = (S.orders || []).filter(_isRouteEligible);
  const changed = [];
  elig.forEach(o => {
    const cur = _isUnplanned(o) ? null : (Number(o.rota) || 0);
    if (cur !== rotaVal || o.deliveryOrder != null) {
      o.rota = rotaVal; o.deliveryOrder = null;
      changed.push(o._id);
    }
  });
  render();
  changed.forEach(id => { PUT('/orders/' + id, { rota: rotaVal, deliveryOrder: null }).catch(() => {}); });
}

export function bindRouteBuilder() {
  const root = document.getElementById('route-builder');
  if (!root) return;
  const byId = (id) => (S.orders || []).find(o => String(o._id) === String(id));

  // ✅ Confirmar a sugestão (grava tudo que está como prévia).
  root.querySelector('#rb-confirm')?.addEventListener('click', () => {
    _materializeSuggestion();
    _renumberAndPersistRoutes();
  });
  // 🔄 Refazer sugestão (volta todos pra "não planejado" → sugere de novo).
  root.querySelector('#rb-resuggest')?.addEventListener('click', () => {
    if (!confirm('Refazer a sugestão do zero? Isso desfaz os ajustes manuais de rota do dia.')) return;
    _setAllRoutes(null);
  });
  // 🧹 Tirar todos das rotas (sem rota, confirmado).
  root.querySelector('#rb-clear')?.addEventListener('click', () => {
    if (!confirm('Tirar TODOS os pedidos das rotas? (não apaga pedidos, só desfaz o agrupamento)')) return;
    _setAllRoutes(0);
  });

  // ── Seleção por caixinha + mover em massa (sem arrastar) ─────
  const updCount = () => {
    const n = root.querySelectorAll('.rb-check:checked').length;
    const el = root.querySelector('#rb-selcount'); if (el) el.textContent = n;
  };
  root.querySelectorAll('.rb-check').forEach(c => c.addEventListener('change', updCount));
  root.querySelector('#rb-selall')?.addEventListener('click', () => {
    root.querySelectorAll('.rb-check').forEach(c => { c.checked = true; }); updCount();
  });
  root.querySelector('#rb-selnone')?.addEventListener('click', () => {
    root.querySelectorAll('.rb-check').forEach(c => { c.checked = false; }); updCount();
  });
  root.querySelector('#rb-bulk-apply')?.addEventListener('click', () => {
    const val = root.querySelector('#rb-bulk-rota')?.value;
    if (val === '' || val == null) { try { toast('Escolha a rota de destino'); } catch (_) {} return; }
    const ids = [...root.querySelectorAll('.rb-check:checked')].map(c => c.dataset.rbId);
    if (!ids.length) { try { toast('Marque ao menos um pedido'); } catch (_) {} return; }
    const destino = Number(val) || 0;
    _materializeSuggestion();
    let base = 100000;
    ids.forEach((id, i) => {
      const o = byId(id); if (!o) return;
      o.rota = destino;                                   // 0 = sem rota
      o.deliveryOrder = destino ? (base + i) : null;      // mantém a ordem marcada, no fim
    });
    _renumberAndPersistRoutes();
  });

  // ▲ / ▼ prioridade dentro da rota.
  root.querySelectorAll('.rb-up').forEach(b => {
    b.addEventListener('click', () => {
      _materializeSuggestion();
      const o = byId(b.dataset.rbId); if (!o || !(Number(o.rota) > 0)) return;
      o.deliveryOrder = (Number(o.deliveryOrder) || 1) - 1.5; // sobe 1 posição
      _renumberAndPersistRoutes();
    });
  });
  root.querySelectorAll('.rb-down').forEach(b => {
    b.addEventListener('click', () => {
      _materializeSuggestion();
      const o = byId(b.dataset.rbId); if (!o || !(Number(o.rota) > 0)) return;
      o.deliveryOrder = (Number(o.deliveryOrder) || 1) + 1.5; // desce 1 posição
      _renumberAndPersistRoutes();
    });
  });

}

export function renderDashboard(){
  // IMPORTANTE: usa relogio do SERVIDOR (Manaus UTC-4) em vez do device.
  // Antes: device com fuso/data errado fazia 'hoje' do dashboard pular
  // pro dia errado (pedidos sumiam). Agora serverClock.js neutraliza isso.
  const now = _serverNowSrv();
  const hh = String(now.getHours()).padStart(2,'0');
  const mm = String(now.getMinutes()).padStart(2,'0');
  const todayStr = _manausDateStrSrv();
  const tomorrowSrv = new Date(now.getTime() + 24*60*60*1000);
  const tomorrowStr = _manausDateStrSrv(tomorrowSrv);

  const isDashFuture = S._dashDate === 'future'; // Marcia (24/ago): datas futuras
  let targetDate;
  if(!S._dashDate || S._dashDate === 'today') targetDate = todayStr;
  else if(S._dashDate === 'tomorrow') targetDate = tomorrowStr;
  else if(isDashFuture) targetDate = 'future';
  else targetDate = S._dashDate; // YYYY-MM-DD

  // Filtro de unidade para Dashboard: mostra pedidos da loja que
  // VENDEU (saleUnit) E os que ela vai PRODUZIR (unidade). Assim a
  // colaboradora consegue aprovar pagamento dos pedidos que a propria
  // loja vendeu, mesmo que a producao seja em outra unidade.
  // DEDUP DEFENSIVO: remove pedidos duplicados (por _id e orderNumber)
  // antes de qualquer filtro/render. Cobre bug de POST+realtime double-push.
  const _dedupedOrders = (() => {
    const seenId = new Set();
    const seenNum = new Set();
    return (S.orders || []).filter(o => {
      const id = String(o._id || '');
      const num = String(o.orderNumber || o.numero || '');
      if (id && seenId.has(id)) return false;
      if (num && seenNum.has(num)) return false;
      if (id) seenId.add(id);
      if (num) seenNum.add(num);
      return true;
    });
  })();
  const ordersBaseDash = filtrarPedidosParaListagem(S.user, _dedupedOrders);

  // Helper: data em Manaus (UTC-4) no formato YYYY-MM-DD. TZ-safe.
  // FIX critico: scheduledDate muitas vezes vem como "2026-05-16" (date-only,
  // sem hora). new Date("2026-05-16") interpreta como UTC midnight = Manaus
  // 2026-05-15 20:00 -> retornava o DIA ANTERIOR. Causa o sintoma "Hoje"
  // mostra pedidos de amanha (e Amanha mostra depois de amanha). Agora,
  // se já vier como YYYY-MM-DD puro, retornamos direto sem conversao TZ.
  const _dManausDash = (ts) => {
    if (!ts) return '';
    const s = String(ts).trim();
    if (!s) return '';
    // Date-only string (YYYY-MM-DD): retorna sem conversao TZ
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // Date-only com hora suffix simples (ex: YYYY-MM-DDTHH:MM sem TZ): usa parte da data
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0,10);
    // FIX Marcia (25/mai/2026 — pedido #00592):
    // MongoDB salva Date objects como meianoite UTC (ex: "2026-05-25T00:00:00.000Z").
    // Se converter pra Manaus (UTC-4) vira "2026-05-24 20:00" → retornava dia
    // ANTERIOR. Pedido sumia do dashboard "Hoje" do dia certo.
    // Quando o ISO e' meia-noite UTC (T00:00:00...Z), interpreta como date-only.
    if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.\d+)?Z?$/.test(s)) return s.slice(0,10);
    // ISO completo com TZ (com Z, +/-XX:XX): converte pra Manaus
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
  };
  // FILTRO ORIGINAL (revertido conforme pedido da usuaria):
  // Pedido pertence ao dia se scheduledDate (entrega prevista) bate com
  // targetDate; quando nao houver scheduledDate, cai pelo createdAt.
  // Calculado em TZ Manaus pra evitar bug de pedidos noturnos.
  const filteredOrders = ordersBaseDash.filter(o => {
    const raw = o.scheduledDate || o.createdAt || '';
    const day = _dManausDash(raw);
    if(isDashFuture) return !!day && day > tomorrowStr; // além de hoje e amanhã
    return day === targetDate;
  });
  // Nas futuras, ordena por data de entrega (mais próxima primeiro)
  if(isDashFuture) filteredOrders.sort((a,b)=>{
    const da=_dManausDash(a.scheduledDate||a.createdAt||'');
    const db=_dManausDash(b.scheduledDate||b.createdAt||'');
    return da<db?-1:da>db?1:0;
  });
  const todayOrders = filteredOrders;

  // Dynamic label for date
  let dateLabel;
  if(!S._dashDate || S._dashDate === 'today') dateLabel = 'Hoje';
  else if(S._dashDate === 'tomorrow') dateLabel = 'Amanh\u00e3';
  else if(isDashFuture) dateLabel = 'Futuras';
  else {
    const parts = S._dashDate.split('-');
    dateLabel = parts.length===3 ? `${parts[2]}/${parts[1]}` : S._dashDate;
  }

  // 'Total do Dia' e demais KPIs operacionais NAO incluem cancelados —
  // eles aparecem so no card 'Cancelados' como informacao isolada.
  const todayOrdersAtivos = todayOrders.filter(o => o.status !== 'Cancelado');
  const totalToday = todayOrdersAtivos.length;
  const recebidos = totalToday;
  const aguardandoImpressao = todayOrdersAtivos.filter(o=>o.status==='Aguardando' && !S._printedComanda?.[o._id]).length;
  const aguardandoProducao = todayOrdersAtivos.filter(o=>o.status==='Aguardando').length;
  const emPreparo = todayOrdersAtivos.filter(o=>o.status==='Em preparo').length;
  const saiuEntrega = todayOrdersAtivos.filter(o=>o.status==='Saiu p/ entrega').length;
  const entregas = todayOrdersAtivos.filter(o=>o.status==='Entregue').length;
  const produzidos = todayOrdersAtivos.filter(o=>o.status==='Pronto').length;
  const retiradaLoja = todayOrdersAtivos.filter(o=>o.type==='Retirada'||o.type==='Balcao'||o.type===String.fromCharCode(66,97,108,99,227,111)).length;
  const cancelados = todayOrders.filter(o=>o.status==='Cancelado').length;

  const statusColors = {
    'Aguardando': '#F1F5F9',
    'Em preparo': '#FEF3C7',
    'Pronto': '#DBEAFE',
    'Saiu p/ entrega': '#EDE9FE',
    'Entregue': '#D1FAE5',
    'Cancelado': '#FEE2E2'
  };
  const statusTextColors = {
    'Aguardando': '#475569',
    'Em preparo': '#92400E',
    'Pronto': '#1E40AF',
    'Saiu p/ entrega': '#5B21B6',
    'Entregue': '#065F46',
    'Cancelado': '#991B1B'
  };
  const unitColors = { 'CDLE':'#DC2626', 'Loja Novo Aleixo':'#1D4ED8', 'Loja Allegro Mall':'#059669' };
  const allStatuses = ['Aguardando','Em preparo','Pronto','Saiu p/ entrega','Entregue','Cancelado'];

  // Filters
  const search = (S._dashSearch||'').toLowerCase();
  const filterStatus = S._dashStatus||'';
  const filterPayment = S._dashPayment||'';
  const filterUnit = S._dashUnit||'';
  const filterBairro = S._dashBairro||'';      // bairro especifico
  const filterZona = S._dashZona||'';          // zona (Bairros Proximos)
  const viewMode = S._dashView||'lista';       // 'lista' | 'rota' | 'emrota' | 'montarrotas'

  // Pedidos ENTREGUES saem da visao do Dashboard (ficam disponiveis em
  // Pedidos, Relatorios e demais modulos). O card de metrica "Entregues"
  // continua contando via `entregas` acima — apenas a LISTA oculta.
  // CANCELADOS tambem nao listam (so contam no card de metrica acima).
  // Marcia (25/mai/2026): aba 'Em Rota' isola "Saiu p/ entrega". As outras
  // 2 abas (Lista/Rota Sugerida) EXCLUEM esses pedidos — ja estao na rua,
  // nao precisam aparecer nas rotas sugeridas.
  let filtered;
  if (viewMode === 'emrota') {
    filtered = todayOrders.filter(o => o.status === 'Saiu p/ entrega');
  } else {
    filtered = todayOrders.filter(o => o.status !== 'Entregue' && o.status !== 'Cancelado' && o.status !== 'Saiu p/ entrega');
  }
  if(search){
    filtered = filtered.filter(o=>{
      const name = (o.clientName||o.cliente?.nome||'').toLowerCase();
      const num = (o.orderNumber||o.numero||'').toLowerCase();
      const recip = (o.recipient||'').toLowerCase();
      return name.includes(search)||num.includes(search)||recip.includes(search);
    });
  }
  if(filterStatus) filtered = filtered.filter(o=>o.status===filterStatus);
  if(filterPayment) filtered = filtered.filter(o=>(o.payment||o.paymentMethod||o.formaPagamento||'')=== filterPayment);
  if(filterUnit) filtered = filtered.filter(o=>o.unit===filterUnit);
  if(filterBairro) {
    const fb = filterBairro.toLowerCase();
    filtered = filtered.filter(o => (o.deliveryNeighborhood||o.deliveryZone||'').toLowerCase() === fb);
  }
  if(filterZona) {
    filtered = filtered.filter(o => resolveZona(o) === filterZona);
  }

  // Group by shift
  const shifts = [
    { key:'Manh\u00e3', icon:'\u2600\uFE0F', color:'#F59E0B', orders:[] },
    { key:'Tarde', icon:'\uD83C\uDF24\uFE0F', color:'#3B82F6', orders:[] },
    { key:'Noite', icon:'\uD83C\uDF19', color:'#7C3AED', orders:[] },
    { key:'Sem turno', icon:'\uD83D\uDCCB', color:'#6B7280', orders:[] }
  ];
  filtered.forEach(o=>{
    // Classifica por turno — horario especifico tem prioridade sobre o periodo
    // (ex: scheduledTime=14:30 vai pra TARDE mesmo se scheduledPeriod estiver vazio)
    const t = getTurnoPedido(o);
    if(t === 'manha')      shifts[0].orders.push(o);
    else if(t === 'tarde') shifts[1].orders.push(o);
    else if(t === 'noite') shifts[2].orders.push(o);
    else                   shifts[3].orders.push(o);
  });

  // Ordena dentro de cada turno: horario especifico primeiro (por hora crescente),
  // depois os sem horario no final
  shifts.forEach(sh => {
    sh.orders.sort((a, b) => {
      const ha = a.scheduledTime && a.scheduledTime !== '00:00' ? a.scheduledTime : '';
      const hb = b.scheduledTime && b.scheduledTime !== '00:00' ? b.scheduledTime : '';
      if (!ha && !hb) return 0;
      if (!ha) return 1;  // sem horario vai pro fim
      if (!hb) return -1;
      return ha.localeCompare(hb);
    });
  });

  // Progress helpers
  const pctRecebidos = 100;
  const pctAguardImp = totalToday ? Math.round((aguardandoImpressao/totalToday)*100) : 0;
  const pctAguardProd = totalToday ? Math.round((aguardandoProducao/totalToday)*100) : 0;
  const pctPreparo = totalToday ? Math.round((emPreparo/totalToday)*100) : 0;
  const pctSaiu = totalToday ? Math.round((saiuEntrega/totalToday)*100) : 0;
  const pctEntregas = totalToday ? Math.round((entregas/totalToday)*100) : 0;
  const pctProduzidos = totalToday ? Math.round((produzidos/totalToday)*100) : 0;
  const pctRetirada = totalToday ? Math.round((retiradaLoja/totalToday)*100) : 0;
  const pctCancelados = totalToday ? Math.round((cancelados/totalToday)*100) : 0;

  // Card helper
  function metricCard(title, value, subtitle, borderColor, progress, progressColor){
    const pct = progress!=null ? progress : 0;
    return `<div style="background:#fff;border-left:4px solid ${borderColor};border-radius:8px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);min-width:0;">
      <div style="font-size:10px;text-transform:uppercase;color:#94A3B8;font-weight:600;letter-spacing:.5px;margin-bottom:6px;">${title}</div>
      <div style="font-size:22px;font-weight:700;color:#1E293B;margin-bottom:2px;">${value}</div>
      <div style="font-size:10px;color:#94A3B8;margin-bottom:8px;">${subtitle}</div>
      <div style="height:5px;background:#F1F5F9;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:${progressColor||borderColor};border-radius:3px;transition:width .4s;"></div>
      </div>
    </div>`;
  }

  // Payment select helper — controla o STATUS de aprovação do pagamento
  function paymentSelect(o){
    // Normaliza pra valor canonico das options (evita bug de mostrar primeira
    // opcao por default quando paymentStatus = 'Aguardando Pagamento' full).
    const payment = normalizePaymentStatus(o.paymentStatus);
    const opts = [
      'Comprov. Enviado','Ag. Comprovante','Ag. Pagamento','Aprovado',
      'Cancelado','Extornado','Negado','Ag. Pagamento na Entrega','Pago na Entrega'
    ];
    const style = PAY_STATUS_COLORS[payment] || PAY_STATUS_COLORS['Ag. Pagamento'];
    const options = opts.map(op=>`<option value="${op}" ${op===payment?'selected':''}>${op}</option>`).join('');
    return `<select data-payment-select="${o._id}" style="${style}border:1px solid;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;outline:none;min-width:140px;">
      ${options}
    </select>`;
  }

  // Coluna Horario: mostra (HH:MM - HH:MM) na cor verde quando ha horario
  // especifico definido; (00:00 - 00:00) em amarelo quando nao ha.
  // Mantem editavel via inputs invisiveis sobrepostos (clique para editar).
  function timeInputs(o){
    const t1 = o.scheduledTime || '00:00';
    const t2 = o.scheduledTimeEnd || '00:00';
    const isSpecific = (t1 && t1!=='00:00') || (t2 && t2!=='00:00');
    const clr  = isSpecific ? '#059669' : '#D97706';
    const bg   = isSpecific ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.15)';
    const brd  = isSpecific ? 'rgba(16,185,129,.4)'  : 'rgba(245,158,11,.4)';
    const inputStyle = `width:50px;padding:0;border:none;font-family:'DM Sans',sans-serif;font-size:12px;font-weight:800;color:${clr};background:transparent;outline:none;text-align:center;-webkit-appearance:none;cursor:pointer;`;
    return `<div title="${isSpecific?'Horario especifico definido':'Sem horario especifico — clique para definir'}"
      style="display:inline-flex;align-items:center;gap:0;padding:4px 8px;background:${bg};border:1px solid ${brd};border-radius:8px;font-weight:800;color:${clr};">
      <span style="font-size:12px;">(</span>
      <input type="time" data-time-start="${o._id}" value="${t1}" style="${inputStyle}"/>
      <span style="font-size:12px;color:${clr};">-</span>
      <input type="time" data-time-end="${o._id}" value="${t2}" style="${inputStyle}"/>
      <span style="font-size:12px;">)</span>
    </div>`;
  }

  // Render order row
  function orderRow(o, opts = {}){
    const buyer = o.clientName||o.cliente?.nome||'\u2014';
    const phone = o.clientPhone||o.cliente?.telefone||'';
    const recip = o.recipient||'\u2014';
    const recipStyle = recip!=='\u2014' && recip.toLowerCase()!==buyer.toLowerCase() ? 'color:#059669;font-weight:600;' : '';
    const bairro = o.deliveryNeighborhood||o.endereco?.bairro||'';
    const unit = o.unit||'\u2014';

    const selBg = statusColors[o.status]||'#F1F5F9';
    const selColor = statusTextColors[o.status]||'#475569';
    const statusOpts = allStatuses.map(st=>`<option value="${st}" ${st===o.status?'selected':''}>${st}</option>`).join('');

    const isChecked = selectedOrders.includes(o._id);

    // Badge de sequencia quando estiver em modo rota
    const seqBadge = opts.seq
      ? `<span style="display:inline-block;background:${opts.zonaColor||'#64748B'};color:#fff;width:20px;height:20px;border-radius:50%;text-align:center;line-height:20px;font-size:10px;font-weight:800;margin-right:4px;vertical-align:middle;">${opts.seq}</span>`
      : '';

    // Destaque visual: pedido com HORARIO ESPECIFICO dentro do turno
    // recebe borda laranja e badge de alerta
    const hasHora = o.scheduledTime && o.scheduledTime !== '00:00';
    const rowBg = hasHora ? 'background:linear-gradient(90deg,#FEF3C722,transparent);border-left:3px solid #F59E0B;' : '';
    // Badge de horario removido — agora aparece SO na coluna de Horario
    // (formato (HH:MM - HH:MM) com cor verde/amarelo).
    const horaBadge = '';

    return `<tr style="border-bottom:1px solid #F1F5F9;${rowBg}">
      <td style="text-align:center;width:36px;">
        <input type="checkbox" data-check-order="${o._id}" ${isChecked?'checked':''} style="width:15px;height:15px;cursor:pointer;accent-color:#3B82F6;" />
      </td>
      <td style="color:#E11D48;font-weight:700;font-size:12px;">${seqBadge}${(()=>{const n=o.orderNumber||o.numero||''; const clean=n.replace(/^PED-?/i,''); return clean?'#'+clean:'\u2014';})()}${horaBadge}${isDashFuture&&o.scheduledDate?`<div style="font-size:10px;color:#7C3AED;font-weight:800;margin-top:2px;">&#128197; ${(()=>{const d=_dManausDash(o.scheduledDate);const p=d.split('-');return p.length===3?p[2]+'/'+p[1]:d;})()}</div>`:''}</td>
      <td>
        <div style="font-weight:600;font-size:12px;color:#1E293B;">${esc(buyer)}</div>
        ${phone?`<div style="font-size:10px;color:#94A3B8;">${esc(phone)}</div>`:''}
      </td>
      <td style="${recipStyle}font-size:12px;">
        <span data-view-comanda="${o._id}" title="Clique para visualizar a comanda" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;">${esc(recip)}</span>
      </td>
      <td>${(()=>{
        // Coluna 'Entrega':
        //  - Delivery → bairro
        //  - Retirada → "RETIRADA — UNIDADE" em destaque + valor pendente
        //    (quando 'total_retirada' ou 'parcial')
        const tipoRaw = String(o.tipo || o.type || 'delivery').toLowerCase();
        const isRetirada = (tipoRaw === 'retirada' || tipoRaw === 'retirada na loja');
        // Unidade de retirada (pickupUnit). Fallback: destino → unidade venda
        const pickupRaw = o.pickupUnit || o.destino || o.unidade || '';
        const pickupSlug = normalizeUnidade(pickupRaw);
        const pickupLabel = pickupSlug ? labelUnidade(pickupSlug) : (pickupRaw || '—');
        const pickupUC = String(pickupLabel||'—').toUpperCase();
        // Marcia (02/jun/2026 v3 - 09/jun/2026): valor pendente DETECTADO
        // por 3 caminhos pra ser ROBUSTO. Antes dependia so de
        // pickupPayMode, que podia estar undefined em pedidos antigos
        // ou editados — badge sumia e Marcia perdia o controle do que
        // o cliente ainda devia. CRITICO pra loja.
        //
        // Regras (qualquer uma dispara o badge):
        //   1) pickupPayMode = 'total_retirada' e nao pago
        //   2) pickupPayMode = 'parcial' e pickupParcialPendente > 0
        //   3) paymentStatus em ['Ag. Pagamento na Retirada',
        //      'Parcial — Falta na Retirada', 'Aguardando Pagamento']
        //      com Retirada — fallback de seguranca
        let valorPendente = 0;
        let pendenteLabel = '';
        const _isPgPago = new Set(['Aprovado','Pago','aprovado','pago','Recebido','Pago na Entrega']);
        const _jaPago = _isPgPago.has(String(o.paymentStatus||''));
        const _parcialPago = Number(o.pickupParcialPago||0);
        const _psStr = String(o.paymentStatus||'');
        const _statusFalta = ['Ag. Pagamento na Retirada','Parcial — Falta na Retirada','Aguardando Pagamento'];
        // Marcia (11/jun/2026): BUG FIX — pedidos com pickupPayMode='parcial'
        // (50/50) e cliente paga 50% online via MP ficam com paymentStatus=
        // 'Aprovado' (o MP confirmou os 50%). MAS ainda faltam os outros 50%
        // a receber na retirada. Antes o badge sumia (porque _jaPago=true
        // saltava todo o bloco). Agora: SEMPRE checa pickupPayMode primeiro
        // — se for parcial/total_retirada e tiver valor pendente, mostra
        // badge independente do paymentStatus.
        if (o.pickupPayMode === 'parcial') {
          // Parcial: mostra badge se ainda ha valor pendente
          const pend = Math.max(0,
            Number(o.pickupParcialPendente || 0) ||
            (Number(o.total || 0) - _parcialPago)
          );
          if (pend > 0) {
            valorPendente = pend;
            pendenteLabel = 'FALTA';
          }
        } else if (Number(o.pickupParcialPendente || 0) > 0) {
          // Saldo devedor gravado direto (ex.: link de pagamento PARCIAL,
          // que vale tanto pra entrega quanto pra retirada).
          valorPendente = Number(o.pickupParcialPendente);
          pendenteLabel = 'FALTA';
        } else if (isRetirada && o.pickupPayMode === 'total_retirada' && !_jaPago) {
          // Total na retirada: mostra badge se nao foi pago
          valorPendente = Math.max(0, Number(o.total||0) - _parcialPago);
          pendenteLabel = 'TOTAL';
        } else if (isRetirada && !_jaPago && _statusFalta.includes(_psStr)) {
          // Só RETIRADA cai neste fallback por status. Em delivery,
          // "Aguardando Pagamento" é o estado normal de quem ainda vai
          // pagar na entrega — marcar tudo como FALTA poluiria o painel.
          // Fallback: pedido sem pickupPayMode mas com status indicando falta
          if (_psStr.includes('Parcial')) {
            valorPendente = Math.max(0, Number(o.pickupParcialPendente||0) || (Number(o.total||0) - _parcialPago));
            pendenteLabel = 'FALTA';
          } else {
            valorPendente = Math.max(0, Number(o.total||0) - _parcialPago);
            pendenteLabel = _psStr.includes('Retirada') ? 'TOTAL' : 'FALTA';
          }
        }
        const valorBlock = valorPendente > 0
          ? `<button type="button" data-pay-pending="${o._id}" data-pay-amount="${valorPendente}" title="Clique para registrar o pagamento (entra no caixa da unidade da colaboradora logada)" style="display:block;width:100%;background:#FEE2E2;border:1.5px solid #DC2626;border-radius:6px;padding:4px 8px;margin-top:4px;font-size:11px;font-weight:900;color:#7F1D1D;text-align:center;letter-spacing:.3px;cursor:pointer;transition:all .15s;animation:flashFalta 1.8s ease-in-out infinite;" onmouseover="this.style.background='#FECACA';this.style.transform='scale(1.02)'" onmouseout="this.style.background='#FEE2E2';this.style.transform='scale(1)'">💰 ${pendenteLabel}: ${$c(valorPendente)} 👆</button>`
          : '';
        // Marcia (set/2026): o aviso "FALTA R$ X" agora vale também pra
        // DELIVERY. Com link de pagamento parcial, o cliente paga um sinal e
        // o saldo tem que ficar visível — seja entrega ou retirada.
        if (!isRetirada) {
          return `
            <div style="font-size:12px;color:#1E293B;font-weight:600;">${bairro?esc(bairro):'<span style="color:#94A3B8;font-weight:400;">—</span>'}</div>
            ${valorBlock}
          `;
        }
        return `
          <div style="background:#DCFCE7;border-left:4px solid #15803D;border-radius:6px;padding:5px 8px;">
            <div style="font-size:11px;font-weight:900;color:#14532D;letter-spacing:.5px;">📦 RETIRADA</div>
            <div style="font-size:12px;font-weight:800;color:#065F46;letter-spacing:.3px;line-height:1.2;margin-top:2px;">${esc(pickupUC)}</div>
          </div>
          ${valorBlock}
        `;
      })()}</td>
      <td style="font-weight:700;font-size:12px;color:#1E293B;">${$c(o.total)}</td>
      <td>${timeInputs(o)}</td>
      <td>${paymentSelect(o)}</td>
      <td>
        <select data-status-select="${o._id}" style="background:${selBg};color:${selColor};border:1px solid ${selBg};border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700;cursor:pointer;outline:none;">
          ${statusOpts}
        </select>
        ${(o.status === 'Saiu p/ entrega' && o.driverName) ? `
        <div style="margin-top:4px;background:#EDE9FE;border:1px solid #C4B5FD;border-radius:6px;padding:3px 6px;font-size:10px;color:#5B21B6;font-weight:700;text-align:center;">
          🚚 ${esc(o.driverName)}
        </div>` : ''}
      </td>
      <td style="text-align:center;">${(()=>{
        // Canal (mesma logica da aba Pedidos)
        const src = String(o.source||'').toLowerCase();
        const tipo = String(o.type||'').toLowerCase();
        let key='whatsapp', label='WhatsApp/Online';
        if (src.includes('whatsapp') || src==='pdv' || src==='' || src==='online') { key='whatsapp'; label='WhatsApp/Online'; }
        else if (src.includes('ifood')) { key='ifood'; label='iFood'; }
        else if (src.includes('ecomm') || src.includes('e-comm') || src==='site') { key='ecommerce'; label='E-commerce'; }
        else if (tipo==='balcão' || tipo==='balcao' || src.includes('balc')) { key='balcao'; label='Balcão'; }
        return `<img src="/icones/${key}.png" alt="${label}" title="${label}" style="width:24px;height:24px;object-fit:contain;vertical-align:middle;"/>`;
      })()}</td>
      <td>${(()=>{
        // Unidade de venda (onde foi cadastrado)
        const sellUnit = o.unit || labelUnidade(o.unidade) || '\u2014';
        const sellBg = unitColors[sellUnit] || unitColors[labelUnidade(o.unidade)] || '#6B7280';

        // Tipo do pedido (Delivery/Retirada/Balcão)
        const tipoRaw = (o.tipo || o.type || 'delivery').toLowerCase();
        const tipoMap = {
          'delivery':     { label: 'Delivery',   icon: '\uD83D\uDE9A', color: '#7C3AED' },
          'retirada':     { label: 'Retirada',   icon: '\uD83D\uDCE6', color: '#059669' },
          'retirada na loja': { label: 'Retirada', icon: '\uD83D\uDCE6', color: '#059669' },
          'balcao':       { label: 'Balc\u00E3o',icon: '\uD83C\uDFEA', color: '#F59E0B' },
          'balc\u00e3o':  { label: 'Balc\u00E3o',icon: '\uD83C\uDFEA', color: '#F59E0B' },
        };
        const tp = tipoMap[tipoRaw] || tipoMap['delivery'];

        // Destino (loja de retirada/balcão) — só mostra se diferente da unidade de venda
        const destSlug = normalizeUnidade(o.destino || o.pickupUnit || '');
        const destLabel = destSlug ? labelUnidade(destSlug) : '';
        const sellSlug = normalizeUnidade(o.unidade || o.unit || '');
        const showDest = (tipoRaw === 'retirada' || tipoRaw === 'retirada na loja' || tipoRaw === 'balcao' || tipoRaw === 'balc\u00e3o')
                      && destLabel && destSlug !== sellSlug;

        // Unidade operacional + Unidade de venda (saleUnit) + atendente
        const atendente = o.createdByName || '';
        const saleSigla = o.saleUnit ? siglaUnidade(o.saleUnit) : null;
        const saleBadge = saleSigla
          ? `<span style="background:${saleSigla.bg};color:${saleSigla.cor};border-radius:6px;padding:2px 7px;font-size:10px;font-weight:800;letter-spacing:.5px;white-space:nowrap;" title="Unidade que VENDEU: ${esc(o.saleUnit)}">🛒 Vendido: ${saleSigla.sigla}</span>`
          : '';

        return `
          <div style="display:flex;flex-direction:column;gap:3px;align-items:flex-start;">
            <span style="background:${sellBg};color:#fff;border-radius:20px;padding:2px 10px;font-size:10px;font-weight:600;white-space:nowrap;" title="Unidade que montará/retirada">${esc(sellUnit)}</span>
            <span style="background:${tp.color}15;color:${tp.color};border:1px solid ${tp.color}40;border-radius:20px;padding:1px 8px;font-size:9px;font-weight:700;white-space:nowrap;" title="Tipo de pedido">${tp.icon} ${tp.label}</span>
            ${saleBadge}
            ${showDest ? `<span style="font-size:9px;color:#64748B;white-space:nowrap;" title="Local de retirada/balc\u00e3o">\uD83C\uDFEA Em: ${esc(destLabel)}</span>` : ''}
            ${atendente ? `<span style="font-size:9px;color:#4F46E5;font-weight:600;white-space:nowrap;" title="Atendente que lançou o pedido">\uD83D\uDC64 ${esc(atendente)}</span>` : ''}
          </div>
        `;
      })()}</td>
      <td style="white-space:nowrap;">
        <button data-edit-order="${o._id}" title="Editar" class="btn btn-ghost btn-xs" style="padding:2px 4px;">&#9997;&#65039;</button>
        ${(() => {
          // VERMELHO destacado: nao impressa | VERDE destacado: ja impressa
          const printed = !!(S._printedComanda && S._printedComanda[o._id]);
          const bg = printed ? '#15803D' : '#DC2626';        // verde/vermelho solido
          const tt = printed ? 'Comanda j\u00e1 impressa (clique para reimprimir)' : 'COMANDA N\u00c3O IMPRESSA \u2014 clique para imprimir';
          const sh = printed ? '0 2px 6px rgba(21,128,61,.4)' : '0 2px 6px rgba(220,38,38,.4)';
          return `<button data-print-comanda="${o._id}" title="${tt}" style="padding:3px 7px;background:${bg};color:#fff;border-radius:6px;border:none;font-size:14px;font-weight:700;cursor:pointer;box-shadow:${sh};line-height:1;">\ud83d\udda8\ufe0f</button>`;
        })()}
        <button data-confirm="${o._id}" title="Confirmar Entrega" class="btn btn-ghost btn-xs" style="padding:2px 4px;">&#9989;</button>
        <button data-print-card="${o._id}" title="Ver Cart\u00e3o" class="btn btn-ghost btn-xs" style="padding:2px 4px;">&#128140;</button>
      </td>
    </tr>`;
  }

  // Build sections — 'rota' agrupa por ZONA (Bairros Proximos), 'lista' por TURNO
  let tableContent = '';
  if (viewMode === 'rota') {
    // Agrupa PRIMEIRO por TURNO (manha/tarde/noite), DEPOIS por ZONA.
    // Evita misturar pedidos de turnos diferentes na mesma rota
    // (ex: 10:00 Parque 10 Manha + 15:00 Parque 10 Tarde = 2 rotas).
    const turnos = agruparPorTurnoEZona(filtered);
    turnos.forEach((t) => {
      // Header do TURNO (linha maior, cor do turno)
      tableContent += `<tr>
        <td colspan="12" style="background:linear-gradient(90deg,${t.turnoColor}38,${t.turnoColor}10);padding:14px 14px;border-left:6px solid ${t.turnoColor};border-bottom:2px solid ${t.turnoColor};">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <span style="font-size:20px;font-weight:900;color:${t.turnoColor};">${t.turnoLabel}</span>
            <span style="background:${t.turnoColor};color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:800;">${t.totalPedidos} entrega${t.totalPedidos>1?'s':''}</span>
            <span style="font-size:11px;color:${t.turnoColor};font-weight:700;">${t.zonas.length} zona${t.zonas.length>1?'s':''}</span>
            <span style="font-size:10px;color:var(--muted);font-style:italic;margin-left:auto;">Rota separada por turno para evitar conflito de horários</span>
          </div>
        </td>
      </tr>`;
      // Sub-headers por ZONA dentro do turno
      t.zonas.forEach((z, zi) => {
        tableContent += `<tr>
          <td colspan="12" style="background:${z.color}10;padding:8px 14px 8px 36px;border-left:3px solid ${z.color};border-bottom:1px solid ${z.color}33;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <span style="background:${z.color};color:#fff;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;">${zi+1}</span>
              <span style="font-weight:700;font-size:13px;color:${z.color};">${z.label}</span>
              <span style="background:${z.color}22;color:${z.color};border-radius:12px;padding:1px 8px;font-size:10px;font-weight:700;">${z.count}</span>
            </div>
          </td>
        </tr>`;
        z.pedidos.forEach((o, oi) => {
          tableContent += orderRow(o, { seq: oi + 1, zonaColor: z.color });
        });
      });
    });
  } else if (viewMode === 'emrota') {
    // ── EM ROTA: agrupa por ENTREGADOR (Marcia set/2026) ──────────
    // Cada entregador vira um bloco com suas entregas "Saiu p/ entrega",
    // ordenadas por horário. "Sem entregador" fica por último.
    const grupos = new Map();
    filtered.forEach(o => {
      const drv = String(o.driverName || o.assignedDriverName || '').trim() || 'Sem entregador';
      if (!grupos.has(drv)) grupos.set(drv, []);
      grupos.get(drv).push(o);
    });
    const ordenados = [...grupos.entries()].sort((a, b) => {
      if (a[0] === 'Sem entregador') return 1;
      if (b[0] === 'Sem entregador') return -1;
      return a[0].localeCompare(b[0]);
    });
    const _cor = '#5B21B6';
    ordenados.forEach(([drv, pedidos]) => {
      pedidos.sort((x, y) => String(x.scheduledTime || '99:99').localeCompare(String(y.scheduledTime || '99:99')));
      const semDrv = drv === 'Sem entregador';
      const cor = semDrv ? '#B45309' : _cor;
      tableContent += `<tr>
        <td colspan="12" style="background:linear-gradient(90deg,${cor}30,${cor}08);padding:12px 14px;border-left:6px solid ${cor};border-bottom:2px solid ${cor};">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-size:17px;font-weight:900;color:${cor};">${semDrv ? '⚠️ Sem entregador' : '🚚 ' + esc(drv)}</span>
            <span style="background:${cor};color:#fff;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:800;">${pedidos.length} entrega${pedidos.length > 1 ? 's' : ''}</span>
            ${semDrv ? '<span style="font-size:10px;color:#92400E;font-style:italic;margin-left:auto;">Atribua um entregador na Expedição</span>' : ''}
          </div>
        </td>
      </tr>`;
      pedidos.forEach((o, oi) => { tableContent += orderRow(o, { seq: oi + 1, zonaColor: cor }); });
    });
  } else {
    // Modo lista padrao: agrupa por turno
    shifts.forEach(sh=>{
      if(sh.orders.length===0) return;
      tableContent += `<tr>
        <td colspan="12" style="background:linear-gradient(90deg,${sh.color}15,${sh.color}05);padding:10px 14px;border-left:3px solid ${sh.color};border-bottom:1px solid ${sh.color}22;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">${sh.icon}</span>
            <span style="font-weight:700;font-size:13px;color:${sh.color};">${sh.key}</span>
            <span style="background:${sh.color};color:#fff;border-radius:20px;padding:1px 8px;font-size:10px;font-weight:700;">${sh.orders.length}</span>
          </div>
        </td>
      </tr>`;
      sh.orders.forEach(o=>{ tableContent += orderRow(o); });
    });
  }

  const hasOrders = filtered.length > 0;
  const selCount = selectedOrders.length;

  // Badge da unidade do colaborador (admin nao mostra)
  const unidadeBadge = (() => {
    if (isAdmin(S.user)) return '';
    const lbl = labelUnidade(normalizeUnidade(S.user?.unidade || S.user?.unit));
    if (!lbl || lbl === '\u2014') return '';
    return `<span style="display:inline-flex;align-items:center;gap:5px;background:#FAE8E6;color:#9F1239;border:1.5px solid #FECDD3;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;">\ud83c\udfec ${lbl}</span>`;
  })();

  return `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
  <div style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:20px;">&#127919;</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1E293B;">Dashboard de Pedidos ${unidadeBadge}</div>
      <div style="font-size:11px;color:#94A3B8;">Atualizado \u00e0s ${hh}:${mm}</div>
    </div>
  </div>
  <div style="display:flex;gap:6px;">
<!-- Painel de Delivery desativado (Marcia jul/2026) -->
    <button class="btn btn-ghost btn-sm" title="Configura\u00e7\u00f5es">&#9881;&#65039;</button>
    <button class="btn btn-ghost btn-sm" id="btn-dash-refresh" title="Atualizar">&#128260;</button>
    <button class="btn btn-ghost btn-sm" title="Alertas">&#128276;</button>
  </div>
</div>

<!-- Row 1: 6 metric cards -->
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:10px;">
  ${metricCard('Pedidos de '+dateLabel, recebidos, recebidos===1?'1 pedido':recebidos+' pedidos', '#3B82F6', pctRecebidos, '#3B82F6')}
  ${metricCard('Aguardando Impress\u00e3o', aguardandoImpressao, aguardandoImpressao+' sem imprimir', '#F97316', pctAguardImp, '#F97316')}
  ${metricCard('Aguardando Produ\u00e7\u00e3o', aguardandoProducao, aguardandoProducao+' na fila', '#F59E0B', pctAguardProd, '#F59E0B')}
  ${metricCard('Em Produ\u00e7\u00e3o', emPreparo, emPreparo+' em andamento', '#7C3AED', pctPreparo, '#7C3AED')}
  ${metricCard('Saiu para Entrega', saiuEntrega, saiuEntrega+' a caminho', '#E11D48', pctSaiu, '#E11D48')}
  ${metricCard('Entregas', entregas+'/'+totalToday, pctEntregas+'% conclu\u00eddo', '#059669', pctEntregas, '#059669')}
</div>

<!-- Row 2: 4 metric cards -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;">
  ${metricCard('Produzidos', produzidos, produzidos+' prontos', '#1E40AF', pctProduzidos, '#1E40AF')}
  ${metricCard('Retirada na Loja', retiradaLoja, retiradaLoja+' para retirada', '#0891B2', pctRetirada, '#0891B2')}
  ${metricCard('Cancelados', cancelados, cancelados+' cancelados', '#DC2626', pctCancelados, '#DC2626')}
  ${metricCard('Total do Dia', totalToday, 'pedidos registrados', '#1E293B', 100, '#1E293B')}
</div>

<div class="card" style="margin-bottom:14px;background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:16px;">
  <!-- Filter bar -->
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <div style="font-weight:700;font-size:15px;color:#1E293B;">&#128666; Entregas ${dateLabel}</div>
    <div style="display:flex;gap:4px;align-items:center;">
      <button class="btn btn-sm ${S._dashDate==='today'||!S._dashDate?'btn-primary':'btn-ghost'}" data-dash-date="today">Hoje</button>
      <button class="btn btn-sm ${S._dashDate==='tomorrow'?'btn-primary':'btn-ghost'}" data-dash-date="tomorrow">Amanh\u00e3</button>
      <input type="date" class="fi" id="dash-filter-date-custom" value="${S._dashDate && S._dashDate !== 'today' && S._dashDate !== 'tomorrow' ? S._dashDate : ''}" style="width:auto;padding:3px 8px;font-size:11px;"/>
    </div>
    <div class="search-box" style="flex:1;min-width:200px;position:relative;">
      <span class="si" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);">&#128269;</span>
      <input class="fi" id="dash-search" placeholder="Buscar pedido ou cliente..." style="padding-left:30px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;" value="${esc(S._dashSearch||'')}"/>
    </div>
    <select class="fi" id="dash-filter-status" style="width:auto;min-width:140px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;">
      <option value="">Todos os Status</option>
      <option ${filterStatus==='Aguardando'?'selected':''}>Aguardando</option>
      <option ${filterStatus==='Em preparo'?'selected':''}>Em preparo</option>
      <option ${filterStatus==='Pronto'?'selected':''}>Pronto</option>
      <option ${filterStatus==='Saiu p/ entrega'?'selected':''}>Saiu p/ entrega</option>
      <!-- 'Entregue' e 'Cancelado' removidos — saem do Dashboard (ver em Pedidos / Relatorios) -->
      <!-- Cancelados continuam contabilizados no card de metrica acima, so somem da LISTA. -->
    </select>
    <select class="fi" id="dash-filter-payment" style="width:auto;min-width:150px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;">
      <option value="">Todos Pagamentos</option>
      <option ${filterPayment==='Pix'?'selected':''}>Pix</option>
      <option ${filterPayment==='Link'?'selected':''}>Link</option>
      <option ${filterPayment==='Cart\u00e3o'?'selected':''}>Cart\u00e3o</option>
      <option ${filterPayment==='Dinheiro'?'selected':''}>Dinheiro</option>
      <option ${filterPayment==='Pagar na Entrega'?'selected':''}>Pagar na Entrega</option>
      <option ${filterPayment==='Bemol'?'selected':''}>Bemol</option>
      <option ${filterPayment==='Giuliana'?'selected':''}>Giuliana</option>
      <option ${filterPayment==='iFood'?'selected':''}>iFood</option>
    </select>
    <select class="fi" id="dash-filter-unit" style="width:auto;min-width:130px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;">
      <option value="">Todas Unidades</option>
      <option ${filterUnit==='CDLE'?'selected':''}>CDLE</option>
      <option value="Loja Novo Aleixo" ${filterUnit==='Loja Novo Aleixo'?'selected':''}>N. Aleixo</option>
      <option value="Loja Allegro Mall" ${filterUnit==='Loja Allegro Mall'?'selected':''}>Allegro</option>
    </select>
    <!-- Filtro por Bairro especifico -->
    <select class="fi" id="dash-filter-bairro" style="width:auto;min-width:160px;border:1px solid #E2E8F0;border-radius:8px;font-size:12px;">
      <option value="">📍 Todos os Bairros</option>
      ${(()=>{
        const grupos = bairrosAgrupados(todayOrders);
        return Object.entries(grupos).map(([zona, bairros]) => `
          <optgroup label="${ZONAS_MANAUS[zona].label}">
            ${bairros.map(b => `<option value="${b.toLowerCase()}" ${filterBairro.toLowerCase()===b.toLowerCase()?'selected':''}>${b}</option>`).join('')}
          </optgroup>
        `).join('');
      })()}
    </select>
    <!-- Filtro por Zona (Bairros Proximos) -->
    <select class="fi" id="dash-filter-zona" style="width:auto;min-width:180px;border:1px solid var(--rose);border-radius:8px;font-size:12px;font-weight:600;background:#FFF7F7;">
      <option value="">🗺️ Bairros Próximos (Zona)</option>
      ${Object.entries(ZONAS_MANAUS).map(([k, z]) => {
        const count = todayOrders.filter(o => resolveZona(o) === k).length;
        if (count === 0) return '';
        return `<option value="${k}" ${filterZona===k?'selected':''}>${z.label} (${count})</option>`;
      }).join('')}
    </select>
    <!-- Toggle Lista/Rota/Em Rota -->
    <div style="display:inline-flex;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
      <button type="button" class="btn btn-xs" data-dash-view="lista" style="border-radius:0;padding:5px 10px;background:${viewMode==='lista'?'#1E293B':'#fff'};color:${viewMode==='lista'?'#fff':'#64748B'};border:none;font-size:11px;font-weight:600;">📋 Lista</button>
      <button type="button" class="btn btn-xs" data-dash-view="rota"  style="border-radius:0;padding:5px 10px;background:${viewMode==='rota'?'var(--rose)':'#fff'};color:${viewMode==='rota'?'#fff':'#64748B'};border:none;font-size:11px;font-weight:600;">🗺️ Rota Sugerida</button>
      <button type="button" class="btn btn-xs" data-dash-view="emrota" style="border-radius:0;padding:5px 10px;background:${viewMode==='emrota'?'#7C3AED':'#fff'};color:${viewMode==='emrota'?'#fff':'#64748B'};border:none;font-size:11px;font-weight:600;">🚚 Em Rota${saiuEntrega>0?` <span style="background:rgba(255,255,255,.25);border-radius:8px;padding:1px 6px;font-size:10px;margin-left:2px;">${saiuEntrega}</span>`:''}</button>
    </div>
  </div>

  <!-- Action bar with bulk buttons (oculta no modo Rota Sugerida / montar rotas) -->
  <div style="display:${viewMode==='rota'?'none':'flex'};align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
    <button id="btn-dash-print" style="background:#059669;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
      &#128424;&#65039; Imprimir
    </button>
    <button id="btn-dash-confirm" style="background:#059669;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:4px;">
      &#9989; Confirmar Entrega
    </button>
    <span id="dash-selected-count" style="font-size:12px;color:#64748B;font-weight:500;">${selCount} selecionados</span>
  </div>

  ${viewMode==='rota' ? _buildRouteBuilderHtml(todayOrders) : (hasOrders ? `
  <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead><tr style="background:#F8FAFC;border-bottom:2px solid #E2E8F0;">
        <th style="text-align:center;width:36px;padding:8px 4px;">
          <input type="checkbox" id="dash-select-all" style="width:15px;height:15px;cursor:pointer;accent-color:#3B82F6;" />
        </th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Code</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Comprador</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Destinat\u00e1rio</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Entrega</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Pre\u00e7o</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Hor\u00e1rio</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Pagamento</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Status</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;text-align:center;">Canal</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Unidade / Tipo</th>
        <th style="padding:8px 6px;font-size:11px;color:#64748B;font-weight:600;text-transform:uppercase;letter-spacing:.3px;">A\u00e7\u00f5es</th>
      </tr></thead>
      <tbody>${tableContent}</tbody>
    </table>
  </div>
  ` : `
  <div style="text-align:center;padding:40px 20px;">
    <div style="font-size:40px;margin-bottom:12px;">&#128203;</div>
    <div style="color:#94A3B8;font-size:14px;">Nenhum pedido para ${dateLabel.toLowerCase()}</div>
  </div>
  `)}
</div>
`;
}
