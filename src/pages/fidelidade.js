// ── FIDELIDADE (ADMIN) ───────────────────────────────────────
// Etapa inicial Marcia (30/mai/2026): brinde secreto no 10o pedido.
// Lista clientes que ja solicitaram resgate (fila pra preparar) e
// permite marcar como entregue.
import { S } from '../state.js';
import { GET, POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';

function _isAdmin() {
  const role  = String(S.user?.role  || '').toLowerCase();
  const cargo = String(S.user?.cargo || '').toLowerCase();
  return role === 'administrador' || cargo === 'admin';
}

async function _fetchAll() {
  try {
    const [pending, stats] = await Promise.all([
      GET('/loyalty/pending').catch(() => []),
      GET('/loyalty/stats').catch(() => null),
    ]);
    S._loyaltyPending = Array.isArray(pending) ? pending : [];
    S._loyaltyStats = stats || null;
  } catch (e) {
    toast('❌ Falha ao carregar fidelidade: ' + (e.message || ''), true);
  }
}

function _fmtData(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return '—'; }
}

export function renderFidelidade() {
  if (!_isAdmin()) {
    return `<div class="card" style="padding:30px;text-align:center;"><div style="font-size:42px;">🔒</div><h3>Acesso restrito</h3><p style="color:var(--muted);">Apenas administradores podem ver o painel de fidelidade.</p></div>`;
  }

  if (!S._loyaltyBoot) {
    S._loyaltyBoot = true;
    _fetchAll().then(() => {
      import('../main.js').then(m => m.render && m.render()).catch(() => {});
    });
  }

  const pending = S._loyaltyPending || [];
  const stats = S._loyaltyStats || { threshold: 10, pending: 0, delivered: 0, potentiallyUnlocked: 0 };

  return `
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
  <div>
    <h2 style="margin:0;font-family:'Playfair Display',serif;font-size:22px;color:#1E293B;">🌸 Programa de Fidelidade</h2>
    <p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Brinde secreto desbloqueado no <strong>${stats.threshold}º pedido</strong>. Aqui você vê quem está pra resgatar.</p>
  </div>
  <button id="btn-loyalty-refresh" style="background:#fff;color:#1E293B;border:1.5px solid #E5E7EB;padding:9px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">🔄 Atualizar</button>
</div>

<!-- STATS -->
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:18px;">
  <div class="card" style="padding:14px;text-align:center;">
    <div style="font-size:11px;color:var(--muted);font-weight:600;">⏳ Aguardando preparo</div>
    <div style="font-size:28px;font-weight:800;color:#9F1239;margin-top:4px;">${stats.pending}</div>
    <div style="font-size:10px;color:var(--muted);">brinde(s) p/ preparar</div>
  </div>
  <div class="card" style="padding:14px;text-align:center;">
    <div style="font-size:11px;color:var(--muted);font-weight:600;">✅ Entregues</div>
    <div style="font-size:28px;font-weight:800;color:#166534;margin-top:4px;">${stats.delivered}</div>
    <div style="font-size:10px;color:var(--muted);">brindes entregues no total</div>
  </div>
  <div class="card" style="padding:14px;text-align:center;">
    <div style="font-size:11px;color:var(--muted);font-weight:600;">👥 Clientes ativos</div>
    <div style="font-size:28px;font-weight:800;color:#1E40AF;margin-top:4px;">${stats.potentiallyUnlocked}</div>
    <div style="font-size:10px;color:var(--muted);">no programa</div>
  </div>
</div>

<div class="card" style="padding:0;overflow:hidden;">
  <div style="padding:14px 16px;border-bottom:1px solid #E5E7EB;font-weight:700;">📋 Fila de resgates</div>
  ${pending.length === 0 ? `
  <div style="padding:40px 20px;text-align:center;color:var(--muted);">
    <div style="font-size:42px;margin-bottom:10px;">🎁</div>
    <p style="font-weight:600;">Nenhum resgate pendente no momento.</p>
    <p style="font-size:12px;">Quando alguma cliente solicitar o brinde secreto, ela aparece aqui.</p>
  </div>
  ` : `
  <div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#F8FAFC;text-align:left;border-bottom:2px solid #E5E7EB;">
        <th style="padding:11px 14px;">Cliente</th>
        <th style="padding:11px 14px;">Contato</th>
        <th style="padding:11px 14px;">Pedidos</th>
        <th style="padding:11px 14px;">Solicitado em</th>
        <th style="padding:11px 14px;text-align:right;">Ações</th>
      </tr>
    </thead>
    <tbody>
      ${pending.map(p => `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:12px 14px;">
            <div style="font-weight:700;color:#1E293B;">${p.nome || '—'}</div>
            <div style="font-size:11px;color:var(--muted);font-family:Monaco,monospace;">${String(p._id).slice(-8)}</div>
          </td>
          <td style="padding:12px 14px;font-size:12px;color:var(--muted);">
            ${p.telefone ? `📱 ${p.telefone}<br>` : ''}
            ${p.email || ''}
          </td>
          <td style="padding:12px 14px;">
            <span style="background:#FCE7F3;color:#9F1239;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;">${p.ordersAtUnlock || 0} pedidos</span>
          </td>
          <td style="padding:12px 14px;font-size:12px;color:var(--muted);">${_fmtData(p.requestedAt)}</td>
          <td style="padding:12px 14px;text-align:right;white-space:nowrap;">
            <button data-loyalty-deliver="${p._id}"
              style="background:linear-gradient(135deg,#15803D,#16A34A);color:#fff;border:none;padding:8px 14px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;margin-right:6px;">
              ✅ Marcar entregue
            </button>
            <button data-loyalty-reset="${p._id}" title="Desfazer solicitação (caso de erro)"
              style="background:#FEE2E2;color:#991B1B;border:none;padding:8px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">
              ↩️
            </button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  </div>
  `}
</div>
`;
}

export function bindFidelidadeEvents() {
  if (!_isAdmin()) return;
  const rerender = () => import('../main.js').then(m => m.render && m.render()).catch(() => {});

  document.getElementById('btn-loyalty-refresh')?.addEventListener('click', async () => {
    await _fetchAll();
    rerender();
    toast('🔄 Atualizado');
  });

  document.querySelectorAll('[data-loyalty-deliver]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.loyaltyDeliver;
      const c = (S._loyaltyPending || []).find(x => String(x._id) === String(id));
      if (!c) return;
      if (!confirm(`Confirmar entrega do brinde secreto pra ${c.nome}?`)) return;
      try {
        await POST('/loyalty/' + id + '/deliver-secret', {});
        S._loyaltyPending = (S._loyaltyPending || []).filter(x => String(x._id) !== String(id));
        if (S._loyaltyStats) {
          S._loyaltyStats.pending = Math.max(0, S._loyaltyStats.pending - 1);
          S._loyaltyStats.delivered = S._loyaltyStats.delivered + 1;
        }
        toast('✅ Brinde marcado como entregue');
        rerender();
      } catch (e) {
        toast('❌ Erro: ' + (e.message || ''), true);
      }
    };
  });

  document.querySelectorAll('[data-loyalty-reset]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.loyaltyReset;
      if (!confirm('Desfazer a solicitação? O brinde volta pra estado "desbloqueado" e a cliente pode solicitar novamente.')) return;
      try {
        await POST('/loyalty/' + id + '/reset-secret', {});
        S._loyaltyPending = (S._loyaltyPending || []).filter(x => String(x._id) !== String(id));
        if (S._loyaltyStats) S._loyaltyStats.pending = Math.max(0, S._loyaltyStats.pending - 1);
        toast('↩️ Solicitação desfeita');
        rerender();
      } catch (e) {
        toast('❌ Erro: ' + (e.message || ''), true);
      }
    };
  });
}
