// ── SAÚDE DO SISTEMA ─────────────────────────────────────────
// Painel pra admin ver saúde do backend, erros do site/admin,
// latência e status. Marcia (02/jun/2026): instalado pre-Namorados.
import { S, API } from '../state.js';
import { GET, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';

function _isAdmin() {
  const role  = String(S.user?.role  || '').toLowerCase();
  const cargo = String(S.user?.cargo || '').toLowerCase();
  return role === 'administrador' || cargo === 'admin';
}

async function _checkHealth() {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API}/health`, { cache: 'no-store' });
    const elapsed = Math.round(performance.now() - t0);
    if (!r.ok) return { ok: false, elapsed, error: `HTTP ${r.status}` };
    const data = await r.json();
    return { ok: true, elapsed, data };
  } catch (e) {
    return { ok: false, elapsed: Math.round(performance.now() - t0), error: e.message };
  }
}

async function _loadAll() {
  const [health, errors, stats] = await Promise.all([
    _checkHealth(),
    GET('/errors?since=' + new Date(Date.now() - 24*60*60*1000).toISOString()).catch(() => []),
    GET('/errors/stats').catch(() => []),
  ]);
  S._saudeHealth = health;
  S._saudeErrors = Array.isArray(errors) ? errors : [];
  S._saudeStats  = Array.isArray(stats)  ? stats  : [];
}

function _fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }); }
  catch { return '—'; }
}

export function renderSaude() {
  if (!_isAdmin()) {
    return `<div class="card" style="padding:30px;text-align:center;"><div style="font-size:42px;">🔒</div><h3>Acesso restrito</h3><p style="color:var(--muted);">Apenas administradores.</p></div>`;
  }

  if (!S._saudeBoot) {
    S._saudeBoot = true;
    _loadAll().then(() => {
      import('../main.js').then(m => m.render && m.render()).catch(() => {});
    });
  }

  const h = S._saudeHealth || null;
  const errors = S._saudeErrors || [];
  const stats  = S._saudeStats  || [];
  const filter = S._saudeFilter || 'all';
  const errsFiltered = filter === 'all'
    ? errors
    : errors.filter(e => e.origin === filter);

  const upMs = h?.data?.uptime ? Math.round(h.data.uptime * 1000) : 0;
  const upH = Math.floor(upMs / 3600000);
  const upM = Math.floor((upMs % 3600000) / 60000);

  const latColor = h?.elapsed > 3000 ? '#DC2626' : h?.elapsed > 1000 ? '#D97706' : '#15803D';

  return `
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
  <div>
    <h2 style="margin:0;font-family:'Playfair Display',serif;font-size:22px;color:#1E293B;">🩺 Saúde do Sistema</h2>
    <p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Status do backend + erros JS capturados (últimas 24h).</p>
  </div>
  <button id="btn-saude-refresh" style="background:linear-gradient(135deg,#1E40AF,#3B82F6);color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">🔄 Atualizar</button>
</div>

<!-- STATUS DOS SERVIÇOS -->
<div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,${h?.ok?'#F0FDF4':'#FEF2F2'},#fff);border:2px solid ${h?.ok?'#86EFAC':'#FCA5A5'};">
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;">
    <div>
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Backend (Render)</div>
      <div style="font-size:20px;font-weight:800;color:${h?.ok?'#15803D':'#991B1B'};margin-top:2px;">${h?.ok?'✅ ONLINE':'❌ OFFLINE'}</div>
      ${h?.error ? `<div style="font-size:11px;color:#991B1B;margin-top:3px;">${h.error}</div>` : ''}
    </div>
    <div>
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Latência</div>
      <div style="font-size:20px;font-weight:800;color:${latColor};margin-top:2px;">${h?.elapsed || '—'}ms</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">${(h?.elapsed||0) > 3000 ? 'Lento — talvez cold start' : (h?.elapsed||0) > 1000 ? 'OK mas pesado' : 'Excelente'}</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">MongoDB</div>
      <div style="font-size:20px;font-weight:800;color:${h?.data?.db==='connected'?'#15803D':'#991B1B'};margin-top:2px;">${h?.data?.db==='connected'?'✅ Conectado':'⚠️ ' + (h?.data?.db||'?')}</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Uptime</div>
      <div style="font-size:20px;font-weight:800;color:#1E293B;margin-top:2px;">${upH}h ${upM}m</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">desde o último restart</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Memória</div>
      <div style="font-size:20px;font-weight:800;color:#1E293B;margin-top:2px;">${h?.data?.memory?.heapUsedMB || '—'}MB</div>
      <div style="font-size:10px;color:var(--muted);margin-top:3px;">RSS: ${h?.data?.memory?.rssMB || '—'}MB</div>
    </div>
    <div>
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Ambiente</div>
      <div style="font-size:14px;font-weight:700;color:#1E293B;margin-top:6px;">${h?.data?.env || '—'} · Node ${h?.data?.node || '—'}</div>
    </div>
  </div>
</div>

<!-- TOP ERROS AGRUPADOS -->
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">📊 Erros mais frequentes (últimas 24h)</div>
  ${stats.length === 0 ? `<div style="padding:24px;text-align:center;color:#15803D;font-weight:700;">✅ Nenhum erro nas últimas 24h. Tudo limpo.</div>` : `
  <div style="overflow-x:auto;"><table style="width:100%;font-size:12px;">
    <thead><tr style="background:#F8FAFC;border-bottom:2px solid #E5E7EB;">
      <th style="padding:8px;text-align:left;">Origem</th>
      <th style="padding:8px;text-align:left;">Mensagem</th>
      <th style="padding:8px;text-align:center;">Qtd</th>
      <th style="padding:8px;text-align:left;">Páginas</th>
      <th style="padding:8px;text-align:left;">Última vez</th>
    </tr></thead>
    <tbody>
    ${stats.slice(0, 30).map(s => `
      <tr style="border-bottom:1px solid #F1F5F9;">
        <td style="padding:8px;"><span style="background:${s.origin==='site'?'#DBEAFE':'#FAE8E6'};color:${s.origin==='site'?'#1E40AF':'#9F1239'};padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">${s.origin}</span></td>
        <td style="padding:8px;font-family:Monaco,monospace;color:#1E293B;">${(s.message||'').slice(0, 100)}</td>
        <td style="padding:8px;text-align:center;font-weight:800;color:#9F1239;">${s.count}</td>
        <td style="padding:8px;font-size:11px;color:var(--muted);">${(s.pages||[]).slice(0,3).join(', ')}</td>
        <td style="padding:8px;font-size:11px;color:var(--muted);">${_fmtTime(s.lastAt)}</td>
      </tr>
    `).join('')}
    </tbody>
  </table></div>`}
</div>

<!-- LISTA DETALHADA -->
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
    <div class="card-title" style="margin:0;">📋 Erros detalhados (${errsFiltered.length})</div>
    <div style="display:flex;gap:5px;">
      ${[{k:'all',l:'Todos'},{k:'site',l:'Só site'},{k:'admin',l:'Só admin'}].map(f => `
        <button data-saude-filter="${f.k}" style="background:${filter===f.k?'#1E40AF':'#fff'};color:${filter===f.k?'#fff':'#1E293B'};border:1.5px solid ${filter===f.k?'#1E40AF':'#E5E7EB'};padding:5px 11px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">${f.l}</button>
      `).join('')}
      <button id="btn-saude-clear" style="background:#FEE2E2;color:#991B1B;border:none;padding:5px 11px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;" title="Limpar erros visualizados">🗑️ Limpar</button>
    </div>
  </div>
  ${errsFiltered.length === 0 ? `<div style="padding:30px;text-align:center;color:var(--muted);">Nenhum erro registrado.</div>` : `
  <div style="max-height:500px;overflow-y:auto;">
    ${errsFiltered.slice(0, 100).map(e => `
      <div style="border:1px solid #E5E7EB;border-left:4px solid ${e.severity==='critical'?'#DC2626':e.severity==='warning'?'#D97706':'#3B82F6'};border-radius:6px;padding:10px 12px;margin-bottom:6px;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--muted);margin-bottom:4px;">
          <div>
            <span style="background:${e.origin==='site'?'#DBEAFE':'#FAE8E6'};color:${e.origin==='site'?'#1E40AF':'#9F1239'};padding:1px 6px;border-radius:4px;font-weight:700;">${e.origin}</span>
            <span style="margin-left:6px;">📄 ${e.page||'—'}</span>
            ${e.userName?`<span style="margin-left:6px;">👤 ${e.userName}</span>`:''}
          </div>
          <span>${_fmtTime(e.createdAt)}</span>
        </div>
        <div style="font-family:Monaco,monospace;font-size:12px;color:#1E293B;font-weight:600;">${(e.message||'').slice(0, 300)}</div>
        ${e.stack ? `<details style="margin-top:6px;"><summary style="font-size:10px;color:#3B82F6;cursor:pointer;">stack</summary><pre style="font-size:10px;color:#475569;background:#F8FAFC;padding:6px;border-radius:4px;overflow-x:auto;margin-top:4px;">${(e.stack||'').slice(0, 600)}</pre></details>` : ''}
      </div>
    `).join('')}
  </div>`}
</div>

<div style="margin-top:14px;padding:12px;background:#EFF6FF;border:1px dashed #BFDBFE;border-radius:8px;font-size:11px;color:#1E3A8A;line-height:1.5;">
  💡 <strong>Como usar:</strong> Se uma colaboradora ou cliente reportar erro, abra esta tela e procure pela mensagem. Os erros das últimas 24h ficam aqui. Erros idênticos são agrupados (top 30 em "Mais frequentes"). Mande pra mim o texto do erro quando precisar que eu corrija.
</div>
`;
}

export function bindSaudeEvents() {
  if (!_isAdmin()) return;
  const rerender = () => import('../main.js').then(m => m.render && m.render()).catch(() => {});

  document.getElementById('btn-saude-refresh')?.addEventListener('click', async () => {
    await _loadAll();
    rerender();
    toast('🔄 Atualizado');
  });

  document.querySelectorAll('[data-saude-filter]').forEach(b => {
    b.onclick = () => { S._saudeFilter = b.dataset.saudeFilter; rerender(); };
  });

  document.getElementById('btn-saude-clear')?.addEventListener('click', async () => {
    if (!confirm('Limpar TODOS os erros registrados? (continua coletando os novos)')) return;
    try {
      await DELETE('/errors?before=' + new Date().toISOString());
      await _loadAll();
      rerender();
      toast('🗑️ Limpos');
    } catch (e) {
      toast('Erro: ' + (e.message||''), true);
    }
  });
}
