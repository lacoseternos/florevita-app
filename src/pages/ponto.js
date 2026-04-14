// ── PONTO ELETRONICO ─────────────────────────────────────────
import { S } from '../state.js';
import { $d } from '../utils/formatters.js';
import { GET, POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { findColab, getColabs } from '../services/auth.js';
import { rolec } from '../utils/formatters.js';

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

// sync version for backward compat
export function getPontoRecordsSync() {
  return JSON.parse(localStorage.getItem('fv_ponto') || '[]');
}
export function savePontoRecordsSync(r) {
  localStorage.setItem('fv_ponto', JSON.stringify(r));
}

// ── RENDER ───────────────────────────────────────────────────

export function renderPonto() {
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const records = getPontoRecordsSync();
  const today = records.find(r => r.userId === S.user._id && r.date === todayStr);
  const hist = records.filter(r => r.userId === S.user._id && r.date !== todayStr)
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);

  // Calcula horas trabalhadas
  const calcHoras = (r) => {
    if (!r.chegada || !r.saida) return '\u2014';
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const total = toMin(r.saida) - toMin(r.chegada);
    const almoco = (r.saidaAlmoco && r.voltaAlmoco) ? (toMin(r.voltaAlmoco) - toMin(r.saidaAlmoco)) : 0;
    const liq = total - almoco;
    if (liq < 0) return '\u2014';
    return `${Math.floor(liq / 60)}h${String(liq % 60).padStart(2, '0')}m`;
  };

  // Status do ponto de hoje
  const pontoStatus = () => {
    if (!today) return { next: 'chegada', label: '\u23F0 Registrar Chegada', color: 'var(--leaf)', desc: 'Inicio do expediente' };
    if (!today.saidaAlmoco) return { next: 'saidaAlmoco', label: '\uD83C\uDF7D\uFE0F Saida para Almoco', color: 'var(--gold)', desc: 'Registrar saida almoco' };
    if (!today.voltaAlmoco) return { next: 'voltaAlmoco', label: '\uD83D\uDD19 Volta do Almoco', color: 'var(--blue)', desc: 'Registrar retorno' };
    if (!today.saida) return { next: 'saida', label: '\uD83D\uDEAA Registrar Saida', color: 'var(--rose)', desc: 'Encerrar expediente' };
    return { next: 'done', label: '\u2705 Expediente Encerrado', color: 'var(--leaf)', desc: 'Ponto completo hoje' };
  };

  const st = pontoStatus();

  // Admin: pode ver todos
  const canSeeAll = S.user.role === 'Administrador' || S.user.role === 'Gerente';
  const allToday = canSeeAll ? records.filter(r => r.date === todayStr) : [];
  const histFilter = S._pontoHistDate || '';
  const allHist = canSeeAll ? records.filter(r => !histFilter || r.date === histFilter).sort((a, b) => b.date.localeCompare(a.date)) : [];

  return `
<!-- Card de bater ponto -->
<div class="card" style="max-width:600px;margin:0 auto 16px;">
  <div style="text-align:center;padding:10px 0 20px;">
    <div style="font-size:48px;margin-bottom:8px">\u23F1\uFE0F</div>
    <div style="font-family:'Playfair Display',serif;font-size:22px;margin-bottom:4px">${S.user.name}</div>
    <div style="font-size:13px;color:var(--muted)">${S.user.role} \u00B7 ${S.user.unit || '\u2014'}</div>
    <div style="font-size:28px;font-weight:700;color:var(--ink);margin:12px 0;font-variant-numeric:tabular-nums" id="ponto-clock">${now}</div>
    <div style="font-size:12px;color:var(--muted)">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>
  </div>

  <!-- Linha do dia -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px;">
    ${[
      { k: 'chegada', l: 'Chegada', i: '\uD83D\uDFE2' },
      { k: 'saidaAlmoco', l: 'Saida Almoco', i: '\uD83D\uDFE1' },
      { k: 'voltaAlmoco', l: 'Volta Almoco', i: '\uD83D\uDD35' },
      { k: 'saida', l: 'Saida', i: '\uD83D\uDD34' },
    ].map(f => `
    <div style="text-align:center;padding:10px 6px;background:${today?.[f.k] ? 'var(--leaf-l)' : 'var(--cream)'};border-radius:var(--r);border:1px solid ${today?.[f.k] ? 'rgba(45,106,79,.2)' : 'var(--border)'};transition:all .2s;">
      <div style="font-size:18px">${f.i}</div>
      <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin:3px 0">${f.l}</div>
      <div style="font-size:14px;font-weight:700;color:${today?.[f.k] ? 'var(--leaf)' : 'var(--muted)'}">${today?.[f.k] || '--:--'}</div>
    </div>`).join('')}
  </div>

  ${st.next !== 'done' ? `
  <button class="btn" id="btn-bater-ponto" style="width:100%;justify-content:center;padding:14px;font-size:15px;font-weight:600;background:${st.color};color:#fff;border-radius:var(--r);">
    ${st.label}
  </button>
  <div style="text-align:center;font-size:11px;color:var(--muted);margin-top:8px">${st.desc}</div>
  ` : `
  <div style="background:var(--leaf-l);border-radius:var(--r);padding:14px;text-align:center;border:1px solid rgba(45,106,79,.2);">
    <div style="font-size:20px;margin-bottom:4px">\u2705</div>
    <div style="font-weight:600;color:var(--leaf)">Expediente encerrado \u2014 ${calcHoras(today)} trabalhadas hoje</div>
  </div>
  `}
  ${today && today.saida ? `
  <div style="margin-top:12px;text-align:center;font-size:12px;color:var(--muted)">
    Total hoje: <strong style="color:var(--ink)">${calcHoras(today)}</strong>
  </div>` : ''}
</div>

<!-- Historico do funcionario -->
<div class="card">
  <div class="card-title">\uD83D\uDCCB Meu Historico de Ponto
    <span style="font-size:11px;font-weight:400;color:var(--muted)">Ultimos 30 dias</span>
  </div>
  ${hist.length === 0 ? `<div class="empty"><div class="empty-icon">\uD83D\uDCC5</div><p>Nenhum registro ainda</p></div>` : `
  <div class="tw"><table>
    <thead><tr><th>Data</th><th>Chegada</th><th>S. Almoco</th><th>V. Almoco</th><th>Saida</th><th>Total</th></tr></thead>
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
</div>

${canSeeAll ? `
<!-- Painel admin: todos os funcionarios hoje -->
<div class="card">
  <div class="card-title">\uD83D\uDC65 Equipe \u2014 Ponto de Hoje
    <span class="tag t-rose">${new Date().toLocaleDateString('pt-BR')}</span>
  </div>
  ${allToday.length === 0 ? `<div class="empty"><p>Nenhum registro hoje ainda</p></div>` : `
  <div class="tw"><table>
    <thead><tr><th>Funcionario</th><th>Cargo</th><th>Chegada</th><th>S. Almoco</th><th>V. Almoco</th><th>Saida</th><th>Total</th></tr></thead>
    <tbody>
    ${allToday.map(r => `<tr>
      <td style="font-weight:600">${r.userName}</td>
      <td><span class="tag ${rolec(r.userRole)}">${r.userRole}</span></td>
      <td style="color:var(--leaf)">${r.chegada || '\u2014'}</td>
      <td style="color:var(--gold)">${r.saidaAlmoco || '\u2014'}</td>
      <td style="color:var(--blue)">${r.voltaAlmoco || '\u2014'}</td>
      <td style="color:var(--rose)">${r.saida || '\u2014'}</td>
      <td style="font-weight:700">${calcHoras(r)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>

<div class="card">
  <div class="card-title">\uD83D\uDCCA Historico Geral
    <input type="date" class="fi" id="ponto-hist-date" value="${histFilter}" style="width:160px;font-size:11px;padding:5px 8px;"/>
  </div>
  ${allHist.length === 0 ? `<div class="empty"><p>Nenhum registro para o periodo</p></div>` : `
  <div class="tw"><table>
    <thead><tr><th>Data</th><th>Funcionario</th><th>Cargo</th><th>Chegada</th><th>S. Almoco</th><th>V. Almoco</th><th>Saida</th><th>Total</th></tr></thead>
    <tbody>
    ${allHist.slice(0, 50).map(r => `<tr>
      <td>${new Date(r.date + 'T12:00').toLocaleDateString('pt-BR')}</td>
      <td style="font-weight:600">${r.userName}</td>
      <td><span class="tag ${rolec(r.userRole)}">${r.userRole}</span></td>
      <td>${r.chegada || '\u2014'}</td>
      <td>${r.saidaAlmoco || '\u2014'}</td>
      <td>${r.voltaAlmoco || '\u2014'}</td>
      <td>${r.saida || '\u2014'}</td>
      <td style="font-weight:700">${calcHoras(r)}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`}
</div>` : ''}`;
}

// ── BIND EVENTS ──────────────────────────────────────────────

export function bindPontoEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(() => {});

  // Bater ponto
  {
    const _el = document.getElementById('btn-bater-ponto');
    if (_el) _el.onclick = () => {
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
          chegada: null,
          saidaAlmoco: null,
          voltaAlmoco: null,
          saida: null
        };
        records.push(rec);
      }
      if (!rec.chegada) { rec.chegada = now; toast('\u23F0 Chegada registrada: ' + now); }
      else if (!rec.saidaAlmoco) { rec.saidaAlmoco = now; toast('\uD83C\uDF7D\uFE0F Saida para almoco: ' + now); }
      else if (!rec.voltaAlmoco) { rec.voltaAlmoco = now; toast('\uD83D\uDD19 Volta do almoco: ' + now); }
      else if (!rec.saida) { rec.saida = now; toast('\uD83D\uDEAA Saida registrada: ' + now); }
      else { toast('\u2705 Ponto ja encerrado hoje!'); return; }
      savePontoRecordsSync(records);
      // Also try to save to API in background
      savePontoRecord(rec).catch(() => {});
      render();
    };
  }

  // Filtro historico admin
  document.getElementById('ponto-hist-date')?.addEventListener('change', e => {
    S._pontoHistDate = e.target.value;
    render();
  });
}
