// ── PONTO ELETRONICO ─────────────────────────────────────────
import { S } from '../state.js';
import { $d } from '../utils/formatters.js';
import { GET, POST, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { findColab, getColabs } from '../services/auth.js';
import { rolec } from '../utils/formatters.js';

// ── SCHEDULES (horários configurados por colaborador) ───────
let _schedules = null;
export async function loadSchedules(){
  try {
    const r = await GET('/settings/ponto-schedules');
    _schedules = r?.value || {};
    return _schedules;
  } catch { _schedules = {}; return {}; }
}
export async function saveSchedules(data){
  _schedules = data;
  try { await PUT('/settings/ponto-schedules', { value: data }); } catch {}
}
export function getScheduleForUser(userId){
  return (_schedules || {})[userId] || null;
}
export function getAllSchedules(){ return _schedules || {}; }

// ── REMINDER SYSTEM ──────────────────────────────────────────
let _pontoReminderTimer = null;
let _pontoLastReminded = {}; // { 'entrada_2026-04-16': true }

function playBeep(freq = 440, duration = 200){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration/1000);
    osc.start(); osc.stop(ctx.currentTime + duration/1000);
  } catch(e){}
}

export function startPontoReminder(){
  if(_pontoReminderTimer) return;

  _pontoReminderTimer = setInterval(async () => {
    if(!S.user) return;

    // Garante schedules carregados
    if(_schedules === null) await loadSchedules();

    const sched = getScheduleForUser(S.user._id || S.user.id);
    if(!sched) return;

    const now = new Date();
    const dow = now.getDay();
    if(!(sched.diasSemana||[]).includes(dow)) return;

    const today = now.toISOString().split('T')[0];
    const records = getPontoRecordsSync();
    const todayRec = records.find(r => r.userId === S.user._id && r.date === today);

    const momentos = [
      { key:'entrada',     label:'Entrada',      targetField:'chegada',     time: sched.entrada },
      { key:'saidaAlmoco', label:'Saída Almoço', targetField:'saidaAlmoco', time: sched.saidaAlmoco },
      { key:'voltaAlmoco', label:'Volta Almoço', targetField:'voltaAlmoco', time: sched.voltaAlmoco },
      { key:'saida',       label:'Saída',        targetField:'saida',       time: sched.saida },
    ];

    for(const m of momentos){
      if(!m.time) continue;
      if(todayRec && todayRec[m.targetField]) continue; // já bateu

      const [h, mn] = m.time.split(':').map(Number);
      const target = new Date(now);
      target.setHours(h, mn, 0, 0);
      const diffMin = (target - now) / 60000;

      const reminderKey = `${m.key}_${today}`;
      const lateKey = `late_${m.key}_${today}`;

      // Lembrete 5min ANTES
      if(diffMin > 0 && diffMin <= 5 && !_pontoLastReminded[reminderKey]){
        _pontoLastReminded[reminderKey] = true;
        toast(`⏰ Hora de bater o ponto: ${m.label} às ${m.time}`, false);
        playBeep(440, 200);
      }

      // Atraso: até 30min depois
      if(diffMin < 0 && diffMin > -30){
        const atrasoMin = Math.abs(Math.floor(diffMin));
        if((atrasoMin === 5 || atrasoMin === 15 || atrasoMin === 30) && !_pontoLastReminded[lateKey+'_'+atrasoMin]){
          _pontoLastReminded[lateKey+'_'+atrasoMin] = true;
          toast(`🚨 ATRASO: ${m.label} era ${m.time} — atrasado ${atrasoMin} min!`, true);
          playBeep(800, 500);
        }
      }
    }
  }, 30000);
}

// ── DATA — migrado de localStorage para API ──────────────────

export async function getPontoRecords() {
  try { return await GET('/ponto'); }
  catch { return JSON.parse(localStorage.getItem('fv_ponto') || '[]'); }
}

export async function savePontoRecord(record) {
  try { return await POST('/ponto', record); }
  catch {
    // fallback localStorage
    const records = JSON.parse(localStorage.getItem('fv_ponto') || '[]');
    const idx = records.findIndex(r => r.id === record.id);
    if (idx >= 0) records[idx] = record; else records.push(record);
    localStorage.setItem('fv_ponto', JSON.stringify(records));
  }
}

export async function deletePontoRecord(id) {
  try { await DELETE('/ponto/' + id); }
  catch { /* ignore */ }
  // Always clean localStorage too
  const records = JSON.parse(localStorage.getItem('fv_ponto') || '[]');
  const filtered = records.filter(r => r.id !== id && r._id !== id);
  localStorage.setItem('fv_ponto', JSON.stringify(filtered));
}

// sync version for backward compat
export function getPontoRecordsSync() {
  return JSON.parse(localStorage.getItem('fv_ponto') || '[]');
}
export function savePontoRecordsSync(r) {
  localStorage.setItem('fv_ponto', JSON.stringify(r));
}

// ── MERGE BACKEND + LOCALSTORAGE ─────────────────────────────
export async function loadAndMergePonto() {
  let api = [];
  try { api = await GET('/ponto'); if(!Array.isArray(api)) api = []; } catch { api = []; }
  const local = getPontoRecordsSync();
  const map = new Map();
  // Index by id (or composite userId+date as fallback)
  const keyOf = r => r.id || r._id || `${r.userId}__${r.date}`;
  api.forEach(r => map.set(keyOf(r), r));
  local.forEach(r => {
    const k = keyOf(r);
    if (!map.has(k)) map.set(k, r);
  });
  const merged = Array.from(map.values());
  // Persist merged to localStorage so sync helpers stay in sync
  savePontoRecordsSync(merged);
  S._pontoRecords = merged;
  S._pontoLoaded = true;
  return merged;
}

// ── HELPERS ──────────────────────────────────────────────────
const toMin = t => { if(!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fmtHrs = (mins) => {
  if (mins <= 0) return '0h00min';
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}min`;
};

function calcMinutosTrabalhados(r) {
  if (!r.chegada || !r.saida) return 0;
  const total = toMin(r.saida) - toMin(r.chegada);
  const almoco = (r.saidaAlmoco && r.voltaAlmoco) ? (toMin(r.voltaAlmoco) - toMin(r.saidaAlmoco)) : 0;
  const liq = total - almoco;
  return liq > 0 ? liq : 0;
}

function calcHorasStr(r) {
  const m = calcMinutosTrabalhados(r);
  return m > 0 ? fmtHrs(m) : '\u2014';
}

// Return entrada/saida pair shown for "Daily" simplified view
function getEntradaSaida(r) {
  return {
    entrada: r.chegada || null,
    saida: r.saida || null,
    total: calcMinutosTrabalhados(r)
  };
}

// Range start/end (inclusive) for filter selection
function getDateRange() {
  const todayD = new Date(); todayD.setHours(0,0,0,0);
  const today = todayD.toISOString().split('T')[0];
  const f = S._pontoFilter || 'hoje';
  if (S._pontoDate) return { start: S._pontoDate, end: S._pontoDate, label: new Date(S._pontoDate+'T12:00').toLocaleDateString('pt-BR') };
  if (S._pontoMonth) {
    const [y,m] = S._pontoMonth.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2,'0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return { start, end, label: new Date(y, m-1, 1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}) };
  }
  if (f === 'semana') {
    const d = new Date(todayD);
    const day = d.getDay(); // 0=Dom
    const diffToMon = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diffToMon);
    const start = d.toISOString().split('T')[0];
    const e = new Date(d); e.setDate(e.getDate()+6);
    const end = e.toISOString().split('T')[0];
    return { start, end, label: 'Semana atual' };
  }
  if (f === 'mes') {
    const d = new Date(todayD);
    const start = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const lastDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
    const end = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
    return { start, end, label: d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}) };
  }
  return { start: today, end: today, label: 'Hoje' };
}

// ── RENDER ───────────────────────────────────────────────────

export function renderPonto() {
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Trigger background load on first render
  if (!S._pontoLoaded) {
    loadAndMergePonto().then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    }).catch(()=>{});
  }

  // Carrega schedules (uma vez)
  if (_schedules === null) {
    loadSchedules().then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    }).catch(()=>{});
  }

  const records = (Array.isArray(S._pontoRecords) && S._pontoRecords.length)
    ? S._pontoRecords
    : getPontoRecordsSync();

  const today = records.find(r => r.userId === S.user._id && r.date === todayStr);
  const hist = records.filter(r => r.userId === S.user._id && r.date !== todayStr)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  const calcHoras = r => calcHorasStr(r);

  // ── Card "Registrar Ponto" do usuario logado ─────────────
  const lastEvent = (() => {
    if (!today) return null;
    if (today.saida) return { tipo: 'Saída', hora: today.saida, color: 'var(--rose)' };
    if (today.voltaAlmoco) return { tipo: 'Volta do almoço', hora: today.voltaAlmoco, color: 'var(--blue)' };
    if (today.saidaAlmoco) return { tipo: 'Saída para almoço', hora: today.saidaAlmoco, color: 'var(--gold)' };
    if (today.chegada) return { tipo: 'Entrada', hora: today.chegada, color: 'var(--leaf)' };
    return null;
  })();

  // ── LÓGICA DOS 4 MOMENTOS DO PONTO ────────────────────────
  // Sequência: Entrada → Saída Almoço → Volta Almoço → Saída Final
  const hasCheg  = !!(today && today.chegada);
  const hasSaidA = !!(today && today.saidaAlmoco);
  const hasVoltA = !!(today && today.voltaAlmoco);
  const hasSaida = !!(today && today.saida);

  // Botão VERDE (registra "entrada-like"):
  //   1. Sem chegada → registra chegada (Entrada)
  //   2. Com saidaAlmoco mas sem voltaAlmoco → registra voltaAlmoco (Volta do almoço)
  const canEntrada = (!hasCheg) || (hasSaidA && !hasVoltA);

  // Botão LARANJA (registra "saida-like"):
  //   1. Com chegada mas sem saidaAlmoco → registra saidaAlmoco (Saída p/ almoço)
  //   2. Com voltaAlmoco mas sem saida → registra saida (Saída final)
  const canSaida = (hasCheg && !hasSaidA) || (hasVoltA && !hasSaida);

  // Labels dinâmicos dos botões conforme o momento atual
  const entradaLabel = !hasCheg ? '\u2600\uFE0F Registrar Entrada'
    : (hasSaidA && !hasVoltA) ? '\uD83D\uDD19 Volta do Almoço'
    : '\u2600\uFE0F Entrada';
  const saidaLabel = (hasCheg && !hasSaidA) ? '\uD83C\uDF7D\uFE0F Saída p/ Almoço'
    : (hasVoltA && !hasSaida) ? '\uD83C\uDF19 Registrar Saída'
    : '\uD83C\uDF19 Saída';

  const myCard = `
<div class="card" style="max-width:640px;margin:0 auto 16px;">
  <div style="text-align:center;padding:6px 0 18px;">
    <div style="font-family:'Playfair Display',serif;font-size:20px;margin-bottom:2px">${S.user.name}</div>
    <div style="font-size:12px;color:var(--muted)">${S.user.role} \u00B7 ${S.user.unit || '\u2014'}</div>
    <div style="font-size:46px;font-weight:800;color:var(--ink);margin:14px 0 4px;font-variant-numeric:tabular-nums;letter-spacing:1px;" id="ponto-clock">${now}</div>
    <div style="font-size:12px;color:var(--muted)">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
  </div>

  ${lastEvent ? `
    <div style="background:var(--cream);border-radius:var(--r);padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--border);">
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;">Último registro</div>
      <div style="font-weight:700;color:${lastEvent.color}">${lastEvent.tipo} \u00B7 ${lastEvent.hora}</div>
    </div>` : `
    <div style="background:var(--cream);border-radius:var(--r);padding:10px 14px;margin-bottom:14px;text-align:center;font-size:12px;color:var(--muted);border:1px solid var(--border);">
      Nenhum registro hoje ainda
    </div>`}

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px;">
    ${[
      { k: 'chegada', l: 'Chegada', i: '\uD83D\uDFE2' },
      { k: 'saidaAlmoco', l: 'Saida Almoco', i: '\uD83D\uDFE1' },
      { k: 'voltaAlmoco', l: 'Volta Almoco', i: '\uD83D\uDD35' },
      { k: 'saida', l: 'Saida', i: '\uD83D\uDD34' },
    ].map(f => `
    <div style="text-align:center;padding:10px 6px;background:${today?.[f.k] ? 'var(--leaf-l)' : 'var(--cream)'};border-radius:var(--r);border:1px solid ${today?.[f.k] ? 'rgba(45,106,79,.2)' : 'var(--border)'};">
      <div style="font-size:18px">${f.i}</div>
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:3px 0">${f.l}</div>
      <div style="font-size:14px;font-weight:700;color:${today?.[f.k] ? 'var(--leaf)' : 'var(--muted)'}">${today?.[f.k] || '--:--'}</div>
    </div>`).join('')}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <button id="btn-ponto-entrada" ${!canEntrada ? 'disabled' : ''}
      style="padding:18px 14px;font-size:16px;font-weight:700;background:${canEntrada ? '#2D6A4F' : '#cbd5d1'};color:#fff;border:none;border-radius:var(--r);cursor:${canEntrada ? 'pointer' : 'not-allowed'};opacity:${canEntrada ? 1 : .55};transition:all .2s;">
      ${entradaLabel}
    </button>
    <button id="btn-ponto-saida" ${!canSaida ? 'disabled' : ''}
      style="padding:18px 14px;font-size:16px;font-weight:700;background:${canSaida ? '#E07B00' : '#cbd5d1'};color:#fff;border:none;border-radius:var(--r);cursor:${canSaida ? 'pointer' : 'not-allowed'};opacity:${canSaida ? 1 : .55};transition:all .2s;">
      ${saidaLabel}
    </button>
  </div>

  ${hasCheg && !hasSaida ? `
    <div style="margin-top:10px;text-align:center;font-size:11px;color:var(--muted)">
      ${!hasSaidA ? '\u2728 Pr\u00F3ximo: Sa\u00EDda para almo\u00E7o' : !hasVoltA ? '\u2728 Pr\u00F3ximo: Volta do almo\u00E7o' : '\u2728 Pr\u00F3ximo: Sa\u00EDda final'}
    </div>` : ''}

  ${today && today.saida ? `
    <div style="margin-top:14px;background:var(--leaf-l);border-radius:var(--r);padding:12px;text-align:center;border:1px solid rgba(45,106,79,.2);">
      <div style="font-weight:700;color:var(--leaf)">\u2705 Expediente encerrado \u2014 ${calcHoras(today)} trabalhadas hoje</div>
    </div>` : ''}
</div>`;

  // ── Histórico do funcionário (sempre visível) ────────────
  const myHistCard = `
<div class="card">
  <div class="card-title">\uD83D\uDCCB Meu Histórico de Ponto
    <span style="font-size:11px;font-weight:400;color:var(--muted)">Últimos 30 dias</span>
  </div>
  ${hist.length === 0 ? `<div class="empty"><div class="empty-icon">\uD83D\uDCC5</div><p>Nenhum registro ainda</p></div>` : `
  <div class="tw"><table>
    <thead><tr><th>Data</th><th>Chegada</th><th>S. Almoço</th><th>V. Almoço</th><th>Saída</th><th>Total</th></tr></thead>
    <tbody>
    ${hist.map(r => `<tr>
      <td style="font-weight:600">${new Date(r.date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}</td>
      <td style="color:var(--leaf)">${r.chegada || '\u2014'}</td>
      <td style="color:var(--gold)">${r.saidaAlmoco || '\u2014'}</td>
      <td style="color:var(--blue)">${r.voltaAlmoco || '\u2014'}</td>
      <td style="color:var(--rose)">${r.saida || '\u2014'}</td>
      <td style="font-weight:700">${calcHoras(r)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>`;

  // Admin: pode ver todos
  const canSeeAll = S.user.role === 'Administrador' || S.user.role === 'Gerente';
  if (!canSeeAll) {
    return myCard + myHistCard;
  }

  // ── ADMIN VIEW ───────────────────────────────────────────
  const filter = S._pontoFilter || 'hoje';
  const range = getDateRange();
  const colabs = getColabs();
  const colabFilter = S._pontoColab || '';

  // Filtra registros por período + colaborador
  const filtered = records.filter(r => {
    if (!r.date) return false;
    if (r.date < range.start || r.date > range.end) return false;
    if (colabFilter && r.userId !== colabFilter) return false;
    return true;
  });

  const isDailyView = (range.start === range.end);

  // ── Card: Horários dos Colaboradores (admin) ─────────────
  const canEditSchedules = S.user.role === 'Administrador';
  const schedulesCard = canEditSchedules ? `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">\u2699\uFE0F Horários dos Colaboradores
    <button id="btn-add-schedule" class="btn btn-primary btn-sm" style="margin-left:auto;padding:6px 12px;background:var(--leaf);color:#fff;border:none;border-radius:var(--r);font-size:12px;font-weight:600;cursor:pointer;">\u2795 Novo horário</button>
  </div>
  <div class="tw"><table>
    <thead>
      <tr><th>Colaborador</th><th>Entrada</th><th>S. Almoço</th><th>V. Almoço</th><th>Saída</th><th>Dias</th><th>Ações</th></tr>
    </thead>
    <tbody>
      ${colabs.map(c => {
        const cid = c._id || c.id || c.email;
        const sched = getScheduleForUser(cid);
        return `<tr>
          <td style="font-weight:600">${c.name || c.nome || c.email}</td>
          <td>${sched?.entrada || '\u2014'}</td>
          <td>${sched?.saidaAlmoco || '\u2014'}</td>
          <td>${sched?.voltaAlmoco || '\u2014'}</td>
          <td>${sched?.saida || '\u2014'}</td>
          <td>${(sched?.diasSemana || []).map(d => ['D','S','T','Q','Q','S','S'][d]).join(' ') || '\u2014'}</td>
          <td style="white-space:nowrap;">
            <button class="btn btn-ghost btn-xs" data-edit-sched="${cid}" style="padding:4px 8px;background:var(--cream);border:1px solid var(--border);border-radius:6px;cursor:pointer;">\u270F\uFE0F</button>
            ${sched ? `<button class="btn btn-ghost btn-xs" data-del-sched="${cid}" style="padding:4px 8px;background:#FFEBEE;border:1px solid #FCC;color:#C62828;border-radius:6px;cursor:pointer;margin-left:3px;">\uD83D\uDDD1\uFE0F</button>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>
</div>` : '';

  // ── Filter Bar ───────────────────────────────────────────
  const filterBar = `
<div class="card" style="margin-bottom:14px;">
  <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
    <div style="display:flex;gap:6px;flex-wrap:wrap;">
      ${[
        { k: 'hoje', l: 'Hoje' },
        { k: 'semana', l: 'Semana' },
        { k: 'mes', l: 'Mês' },
      ].map(p => `
        <button class="btn-period" data-period="${p.k}"
          style="padding:7px 14px;border-radius:var(--r);border:1px solid var(--border);font-size:12px;font-weight:600;cursor:pointer;
            background:${(filter===p.k && !S._pontoDate && !S._pontoMonth) ? 'var(--rose)' : 'var(--cream)'};
            color:${(filter===p.k && !S._pontoDate && !S._pontoMonth) ? '#fff' : 'var(--ink)'};">${p.l}</button>
      `).join('')}
    </div>

    <div style="display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap;">
      <label style="font-size:11px;color:var(--muted);">Data:</label>
      <input type="date" class="fi" id="ponto-date" value="${S._pontoDate || ''}" style="width:160px;font-size:12px;padding:6px 8px;"/>

      <label style="font-size:11px;color:var(--muted);margin-left:6px;">Mês:</label>
      <input type="month" class="fi" id="ponto-month" value="${S._pontoMonth || ''}" style="width:140px;font-size:12px;padding:6px 8px;"/>

      <label style="font-size:11px;color:var(--muted);margin-left:6px;">Colaborador:</label>
      <select class="fi" id="ponto-colab" style="min-width:200px;font-size:12px;padding:6px 8px;">
        <option value="">Todos os colaboradores</option>
        ${colabs.map(c => `<option value="${c._id || c.email}" ${colabFilter===(c._id || c.email)?'selected':''}>${c.name || c.nome || c.email}</option>`).join('')}
      </select>

      <button id="btn-ponto-manual" class="btn"
        style="padding:7px 12px;background:var(--leaf);color:#fff;font-weight:600;font-size:12px;border-radius:var(--r);">
        \u2795 Registro Manual
      </button>
    </div>
  </div>
  <div style="margin-top:8px;font-size:11px;color:var(--muted)">
    Período selecionado: <strong style="color:var(--ink)">${range.label}</strong>
    \u00B7 Total de registros: <strong style="color:var(--ink)">${filtered.length}</strong>
  </div>
</div>`;

  // ── Daily view (cards per collaborator) ──────────────────
  let mainPanel = '';
  if (isDailyView) {
    if (filtered.length === 0) {
      mainPanel = `<div class="card"><div class="empty"><p>Nenhum registro para este dia</p></div></div>`;
    } else {
      // Group by user
      const byUser = {};
      filtered.forEach(r => {
        const k = r.userId || r.userName;
        if (!byUser[k]) byUser[k] = r;
      });

      const cards = Object.values(byUser).map(r => {
        const es = getEntradaSaida(r);
        const dataFmt = new Date(r.date+'T12:00').toLocaleDateString('pt-BR');
        return `
<div class="card" style="margin-bottom:10px;border-left:4px solid var(--rose);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:15px;font-weight:700;color:var(--ink);">
        \uD83D\uDC64 ${r.userName || '—'}
        <span style="font-weight:400;color:var(--muted);font-size:12px;margin-left:6px;">— ${dataFmt}</span>
      </div>
      <div style="margin-top:6px;display:flex;gap:18px;flex-wrap:wrap;font-size:13px;">
        <span style="color:var(--leaf)">\u2705 Entrada: <strong>${es.entrada || '—'}</strong></span>
        <span style="color:var(--rose)">\uD83D\uDEAA Saída: <strong>${es.saida || '—'}</strong></span>
        <span style="color:var(--gold)">\uD83C\uDF7D\uFE0F S. Almoço: <strong>${r.saidaAlmoco || '—'}</strong></span>
        <span style="color:var(--blue)">\uD83D\uDD19 V. Almoço: <strong>${r.voltaAlmoco || '—'}</strong></span>
      </div>
      <div style="margin-top:6px;font-size:13px;">
        \u23F1\uFE0F Total: <strong style="color:var(--ink)">${es.total > 0 ? fmtHrs(es.total) : '—'}</strong>
      </div>
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn-ponto-edit" data-rid="${r.id || r._id || ''}"
        style="padding:6px 10px;background:var(--cream);border:1px solid var(--border);border-radius:var(--r);font-size:11px;cursor:pointer;">\u270F\uFE0F Editar</button>
      <button class="btn-ponto-del" data-rid="${r.id || r._id || ''}"
        style="padding:6px 10px;background:#FFEBEE;border:1px solid #FCC;color:#C62828;border-radius:var(--r);font-size:11px;cursor:pointer;">\uD83D\uDDD1\uFE0F Excluir</button>
    </div>
  </div>
</div>`;
      }).join('');

      mainPanel = `<div>${cards}</div>`;
    }
  } else {
    // ── Weekly/Monthly: summary table ─────────────────────
    // Aggregate by user
    const agg = {};
    filtered.forEach(r => {
      const k = r.userId || r.userName;
      if (!agg[k]) agg[k] = { name: r.userName || '—', role: r.userRole || '—', dias: new Set(), totalMin: 0 };
      const m = calcMinutosTrabalhados(r);
      if (m > 0) {
        agg[k].dias.add(r.date);
        agg[k].totalMin += m;
      } else if (r.chegada || r.saida) {
        // Day had partial registration; still count
        agg[k].dias.add(r.date);
      }
    });

    const summary = Object.values(agg).sort((a,b) => (b.totalMin) - (a.totalMin));

    if (summary.length === 0) {
      mainPanel = `<div class="card"><div class="empty"><p>Nenhum registro para o período selecionado</p></div></div>`;
    } else {
      mainPanel = `
<div class="card">
  <div class="card-title">\uD83D\uDCCA Resumo do Período \u2014 ${range.label}</div>
  <div class="tw"><table>
    <thead>
      <tr><th>Colaborador</th><th>Cargo</th><th>Dias Trabalhados</th><th>Horas Total</th><th>Média/Dia</th></tr>
    </thead>
    <tbody>
      ${summary.map(u => {
        const dias = u.dias.size || 0;
        const media = dias > 0 ? Math.round(u.totalMin / dias) : 0;
        return `<tr>
          <td style="font-weight:700">${u.name}</td>
          <td><span class="tag ${rolec(u.role)}">${u.role}</span></td>
          <td>${dias}</td>
          <td style="font-weight:700">${fmtHrs(u.totalMin)}</td>
          <td>${dias>0 ? fmtHrs(media) : '—'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>
</div>

<div class="card">
  <div class="card-title">\uD83D\uDCC4 Registros Detalhados \u2014 ${range.label}
    <span style="font-size:11px;font-weight:400;color:var(--muted)">${filtered.length} registros</span>
  </div>
  <div class="tw"><table>
    <thead><tr><th>Data</th><th>Funcionário</th><th>Cargo</th><th>Chegada</th><th>S. Almoço</th><th>V. Almoço</th><th>Saída</th><th>Total</th><th>Ações</th></tr></thead>
    <tbody>
    ${filtered.sort((a,b) => b.date.localeCompare(a.date)).slice(0, 200).map(r => `<tr>
      <td>${new Date(r.date + 'T12:00').toLocaleDateString('pt-BR')}</td>
      <td style="font-weight:600">${r.userName || '—'}</td>
      <td><span class="tag ${rolec(r.userRole)}">${r.userRole || '—'}</span></td>
      <td>${r.chegada || '\u2014'}</td>
      <td>${r.saidaAlmoco || '\u2014'}</td>
      <td>${r.voltaAlmoco || '\u2014'}</td>
      <td>${r.saida || '\u2014'}</td>
      <td style="font-weight:700">${calcHoras(r)}</td>
      <td style="white-space:nowrap;">
        <button class="btn-ponto-edit" data-rid="${r.id || r._id || ''}"
          style="padding:4px 8px;background:var(--cream);border:1px solid var(--border);border-radius:6px;font-size:10px;cursor:pointer;margin-right:3px;">\u270F\uFE0F</button>
        <button class="btn-ponto-del" data-rid="${r.id || r._id || ''}"
          style="padding:4px 8px;background:#FFEBEE;border:1px solid #FCC;color:#C62828;border-radius:6px;font-size:10px;cursor:pointer;">\uD83D\uDDD1\uFE0F</button>
      </td>
    </tr>`).join('')}
    </tbody>
  </table></div>
</div>`;
    }
  }

  return myCard + schedulesCard + filterBar + mainPanel + myHistCard;
}

// ── MODAL: Editar horário do colaborador ─────────────────────
export function showScheduleModal(userId){
  const colabs = getColabs();
  const colab = colabs.find(c => (c._id || c.id || c.email) === userId);
  if(!colab){ toast('Colaborador não encontrado'); return; }
  const sched = getScheduleForUser(userId);
  S._schedEditUserId = userId;

  S._modal = `<div class="mo" id="mo">
  <div class="mo-box" style="max-width:500px;" onclick="event.stopPropagation()">
    <div class="mo-h">
      <div class="mo-title" style="font-weight:700;font-size:16px;">\u2699\uFE0F Horário de ${colab.name || colab.nome || colab.email}</div>
      <button data-action="close-modal" style="background:none;border:none;font-size:22px;cursor:pointer;line-height:1;">×</button>
    </div>
    <div style="padding:16px;">
      <div class="fr2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="fg"><label class="fl" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Entrada *</label><input type="time" class="fi" id="sch-entrada" value="${sched?.entrada||'08:00'}" style="width:100%;margin-top:4px;"/></div>
        <div class="fg"><label class="fl" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Saída Almoço</label><input type="time" class="fi" id="sch-saidaAlmoco" value="${sched?.saidaAlmoco||'12:00'}" style="width:100%;margin-top:4px;"/></div>
        <div class="fg"><label class="fl" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Volta Almoço</label><input type="time" class="fi" id="sch-voltaAlmoco" value="${sched?.voltaAlmoco||'13:00'}" style="width:100%;margin-top:4px;"/></div>
        <div class="fg"><label class="fl" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Saída *</label><input type="time" class="fi" id="sch-saida" value="${sched?.saida||'18:00'}" style="width:100%;margin-top:4px;"/></div>
      </div>
      <div class="fg" style="margin-top:14px;">
        <label class="fl" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Dias da semana</label>
        <div style="display:flex;gap:6px;margin-top:6px;">
          ${['D','S','T','Q','Q','S','S'].map((l,i) => `
            <label style="flex:1;text-align:center;padding:6px;border:1px solid var(--border);border-radius:6px;cursor:pointer;">
              <input type="checkbox" class="sch-dia" value="${i}" ${(sched?.diasSemana||[1,2,3,4,5]).includes(i)?'checked':''} style="display:block;margin:0 auto;"/>
              ${l}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="mo-foot" style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
        <button class="btn btn-ghost" data-action="close-modal" style="padding:10px 18px;background:var(--cream);border:1px solid var(--border);border-radius:var(--r);cursor:pointer;">Cancelar</button>
        <button class="btn btn-primary" id="btn-save-sched" style="padding:10px 18px;background:var(--leaf);color:#fff;font-weight:700;border:none;border-radius:var(--r);cursor:pointer;">\uD83D\uDCBE Salvar</button>
      </div>
    </div>
  </div>
</div>`;

  import('../main.js').then(m => m.render()).catch(()=>{});
}

// ── MODAL: Registro Manual / Edição ──────────────────────────
export function showPontoManualModal(record = null) {
  const colabs = getColabs();
  const isEdit = !!record;
  const r = record || {
    userId: '',
    date: new Date().toISOString().split('T')[0],
    chegada: '',
    saidaAlmoco: '',
    voltaAlmoco: '',
    saida: ''
  };
  S._pontoEditId = r.id || r._id || null;

  S._modal = `<div class="mo" id="mo">
  <div class="mo-box" style="max-width:520px;" onclick="event.stopPropagation()">
    <div class="mo-h">
      <div style="font-weight:700;font-size:16px;">${isEdit ? '\u270F\uFE0F Editar Registro de Ponto' : '\u2795 Registro Manual de Ponto'}</div>
      <button data-action="close-modal" style="background:none;border:none;font-size:22px;cursor:pointer;line-height:1;">×</button>
    </div>
    <div style="padding:16px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Colaborador</label>
          <select class="fi" id="pm-colab" ${isEdit ? 'disabled' : ''} style="width:100%;margin-top:4px;">
            <option value="">Selecione...</option>
            ${colabs.map(c => {
              const id = c._id || c.email;
              return `<option value="${id}" data-name="${c.name || c.nome || ''}" data-role="${c.role || c.cargo || ''}" ${id===r.userId?'selected':''}>${c.name || c.nome || c.email}</option>`;
            }).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Data</label>
          <input type="date" class="fi" id="pm-date" value="${r.date || ''}" style="width:100%;margin-top:4px;"/>
        </div>
      </div>

      <div style="background:var(--cream);padding:12px;border-radius:var(--r);margin:10px 0;">
        <div style="font-size:12px;font-weight:700;color:var(--ink);margin-bottom:8px;">Horários (formato HH:MM)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div>
            <label style="font-size:11px;color:var(--leaf);font-weight:600;">\u2600\uFE0F Chegada / Entrada</label>
            <input type="time" class="fi" id="pm-chegada" value="${r.chegada || ''}" style="width:100%;margin-top:4px;"/>
          </div>
          <div>
            <label style="font-size:11px;color:var(--gold);font-weight:600;">\uD83C\uDF7D\uFE0F Saída Almoço</label>
            <input type="time" class="fi" id="pm-saidaAlmoco" value="${r.saidaAlmoco || ''}" style="width:100%;margin-top:4px;"/>
          </div>
          <div>
            <label style="font-size:11px;color:var(--blue);font-weight:600;">\uD83D\uDD19 Volta Almoço</label>
            <input type="time" class="fi" id="pm-voltaAlmoco" value="${r.voltaAlmoco || ''}" style="width:100%;margin-top:4px;"/>
          </div>
          <div>
            <label style="font-size:11px;color:var(--rose);font-weight:600;">\uD83C\uDF19 Saída</label>
            <input type="time" class="fi" id="pm-saida" value="${r.saida || ''}" style="width:100%;margin-top:4px;"/>
          </div>
        </div>
      </div>

      <div style="font-size:11px;color:var(--muted);margin:6px 0 14px;">
        Preencha apenas os horários necessários. Campos vazios não serão alterados.
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button data-action="close-modal" class="btn"
          style="padding:10px 18px;background:var(--cream);border:1px solid var(--border);">Cancelar</button>
        <button id="pm-save" class="btn"
          style="padding:10px 18px;background:var(--leaf);color:#fff;font-weight:700;">
          ${isEdit ? '\uD83D\uDCBE Salvar Alterações' : '\u2795 Adicionar Registro'}
        </button>
      </div>
    </div>
  </div>
</div>`;

  // Trigger render to display the modal
  import('../main.js').then(m => m.render()).catch(()=>{});
}

// ── BIND EVENTS ──────────────────────────────────────────────

export function bindPontoEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(() => {});

  // ── Botão Entrada ─────────────────────────────────────────
  const btnEnt = document.getElementById('btn-ponto-entrada');
  if (btnEnt) btnEnt.onclick = () => {
    if (btnEnt.disabled) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const records = getPontoRecordsSync();
    let rec = records.find(r => r.userId === S.user._id && r.date === todayStr);
    if (!rec) {
      rec = {
        id: Date.now() + '_' + S.user._id,
        userId: S.user._id,
        userName: S.user.name,
        userRole: S.user.role,
        date: todayStr,
        chegada: null, saidaAlmoco: null, voltaAlmoco: null, saida: null
      };
      records.push(rec);
    }
    if (!rec.chegada) {
      rec.chegada = now;
      toast('\u2600\uFE0F Entrada registrada: ' + now);
    } else if (!rec.voltaAlmoco && rec.saidaAlmoco) {
      // Se já saiu para almoço e ainda não voltou, registrar volta como "entrada"
      rec.voltaAlmoco = now;
      toast('\uD83D\uDD19 Volta do almoço: ' + now);
    } else {
      toast('Entrada já registrada hoje');
      return;
    }
    savePontoRecordsSync(records);
    S._pontoRecords = records;
    savePontoRecord(rec).catch(()=>{});
    render();
  };

  // ── Botão Saída ───────────────────────────────────────────
  const btnSai = document.getElementById('btn-ponto-saida');
  if (btnSai) btnSai.onclick = () => {
    if (btnSai.disabled) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const records = getPontoRecordsSync();
    let rec = records.find(r => r.userId === S.user._id && r.date === todayStr);
    if (!rec || !rec.chegada) { toast('Registre a entrada primeiro'); return; }
    if (!rec.saidaAlmoco) {
      rec.saidaAlmoco = now;
      toast('\uD83C\uDF7D\uFE0F Saída para almoço: ' + now);
    } else if (!rec.saida) {
      rec.saida = now;
      toast('\uD83C\uDF19 Saída registrada: ' + now);
    } else {
      toast('Expediente já encerrado');
      return;
    }
    savePontoRecordsSync(records);
    S._pontoRecords = records;
    savePontoRecord(rec).catch(()=>{});
    render();
  };

  // ── Filter buttons (período) ──────────────────────────────
  document.querySelectorAll('.btn-period').forEach(b => {
    b.onclick = () => {
      S._pontoFilter = b.dataset.period;
      S._pontoDate = '';
      S._pontoMonth = '';
      render();
    };
  });

  document.getElementById('ponto-date')?.addEventListener('change', e => {
    S._pontoDate = e.target.value;
    if (e.target.value) S._pontoMonth = '';
    render();
  });

  document.getElementById('ponto-month')?.addEventListener('change', e => {
    S._pontoMonth = e.target.value;
    if (e.target.value) S._pontoDate = '';
    render();
  });

  document.getElementById('ponto-colab')?.addEventListener('change', e => {
    S._pontoColab = e.target.value;
    render();
  });

  // ── Botão Registro Manual (admin) ─────────────────────────
  document.getElementById('btn-ponto-manual')?.addEventListener('click', () => {
    showPontoManualModal();
  });

  // ── Editar registro ──────────────────────────────────────
  document.querySelectorAll('.btn-ponto-edit').forEach(b => {
    b.onclick = () => {
      const rid = b.dataset.rid;
      if (!rid) return;
      const records = (S._pontoRecords && S._pontoRecords.length) ? S._pontoRecords : getPontoRecordsSync();
      const r = records.find(x => (x.id === rid) || (x._id === rid));
      if (r) showPontoManualModal(r);
    };
  });

  // ── Excluir registro ─────────────────────────────────────
  document.querySelectorAll('.btn-ponto-del').forEach(b => {
    b.onclick = async () => {
      const rid = b.dataset.rid;
      if (!rid) return;
      if (!confirm('Excluir este registro de ponto? Esta ação não pode ser desfeita.')) return;
      await deletePontoRecord(rid);
      // Update in-memory cache
      const records = getPontoRecordsSync().filter(r => r.id !== rid && r._id !== rid);
      savePontoRecordsSync(records);
      S._pontoRecords = records;
      toast('\uD83D\uDDD1\uFE0F Registro excluído');
      render();
    };
  });

  // ── Schedules: botões de edição/exclusão ─────────────────
  document.getElementById('btn-add-schedule')?.addEventListener('click', () => {
    const colabs = getColabs();
    if(!colabs.length){ toast('Nenhum colaborador disponível'); return; }
    // Prompt simples para escolher colaborador
    const opts = colabs.map((c,i) => `${i+1}. ${c.name || c.nome || c.email}`).join('\n');
    const choice = prompt('Escolha o colaborador (número):\n\n' + opts);
    const idx = parseInt(choice, 10) - 1;
    if(isNaN(idx) || idx < 0 || idx >= colabs.length) return;
    const c = colabs[idx];
    showScheduleModal(c._id || c.id || c.email);
  });

  document.querySelectorAll('[data-edit-sched]').forEach(b => {
    b.onclick = () => showScheduleModal(b.dataset.editSched);
  });

  document.querySelectorAll('[data-del-sched]').forEach(b => {
    b.onclick = async () => {
      const uid = b.dataset.delSched;
      if(!uid) return;
      if(!confirm('Excluir o horário configurado deste colaborador?')) return;
      const all = { ...getAllSchedules() };
      delete all[uid];
      await saveSchedules(all);
      toast('\uD83D\uDDD1\uFE0F Horário removido');
      render();
    };
  });

  document.getElementById('btn-save-sched')?.addEventListener('click', async () => {
    const uid = S._schedEditUserId;
    if(!uid){ toast('Usuário não identificado'); return; }
    const entrada = document.getElementById('sch-entrada')?.value || '';
    const saidaAlmoco = document.getElementById('sch-saidaAlmoco')?.value || '';
    const voltaAlmoco = document.getElementById('sch-voltaAlmoco')?.value || '';
    const saida = document.getElementById('sch-saida')?.value || '';
    if(!entrada || !saida){ toast('Entrada e Saída são obrigatórias'); return; }
    const diasSemana = Array.from(document.querySelectorAll('.sch-dia:checked')).map(i => parseInt(i.value, 10));

    const all = { ...getAllSchedules() };
    all[uid] = { entrada, saidaAlmoco, voltaAlmoco, saida, diasSemana };
    await saveSchedules(all);
    S._schedEditUserId = null;
    S._modal = '';
    toast('\uD83D\uDCBE Horário salvo');
    render();
  });

  // ── Salvar registro manual / edição ──────────────────────
  document.getElementById('pm-save')?.addEventListener('click', async () => {
    const sel = document.getElementById('pm-colab');
    const userId = sel?.value || '';
    if (!userId) { toast('Selecione um colaborador'); return; }
    const opt = sel.options[sel.selectedIndex];
    const userName = opt?.dataset?.name || opt?.textContent?.trim() || '';
    const userRole = opt?.dataset?.role || '';

    const date = document.getElementById('pm-date')?.value || '';
    if (!date) { toast('Informe a data'); return; }

    const chegada = document.getElementById('pm-chegada')?.value || null;
    const saidaAlmoco = document.getElementById('pm-saidaAlmoco')?.value || null;
    const voltaAlmoco = document.getElementById('pm-voltaAlmoco')?.value || null;
    const saida = document.getElementById('pm-saida')?.value || null;

    const records = getPontoRecordsSync();
    const editId = S._pontoEditId;
    let rec;
    if (editId) {
      rec = records.find(r => r.id === editId || r._id === editId);
      if (rec) {
        rec.chegada = chegada;
        rec.saidaAlmoco = saidaAlmoco;
        rec.voltaAlmoco = voltaAlmoco;
        rec.saida = saida;
        rec.date = date;
      }
    } else {
      // Check if entry already exists for this user/date - if so, update it
      const existing = records.find(r => r.userId === userId && r.date === date);
      if (existing) {
        if (chegada) existing.chegada = chegada;
        if (saidaAlmoco) existing.saidaAlmoco = saidaAlmoco;
        if (voltaAlmoco) existing.voltaAlmoco = voltaAlmoco;
        if (saida) existing.saida = saida;
        rec = existing;
      } else {
        rec = {
          id: Date.now() + '_' + userId,
          userId, userName, userRole,
          date,
          chegada, saidaAlmoco, voltaAlmoco, saida,
          manual: true
        };
        records.push(rec);
      }
    }

    savePontoRecordsSync(records);
    S._pontoRecords = records;
    if (rec) await savePontoRecord(rec).catch(()=>{});
    S._pontoEditId = null;
    S._modal = '';
    toast(editId ? '\uD83D\uDCBE Registro atualizado' : '\u2795 Registro adicionado');
    render();
  });
}
