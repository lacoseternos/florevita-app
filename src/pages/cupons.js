// ── CUPONS DE DESCONTO ───────────────────────────────────────
// Admin gerencia (criar, editar, ativar/desativar, deletar).
// API: GET/POST/PATCH/DELETE /coupons (auth admin).
// Aplicacao real do cupom roda no backend (publicOrderController
// usa couponController.validateAndApplyCoupon).
import { S } from '../state.js';
import { GET, POST, PATCH, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';

function _isAdmin() {
  const role  = String(S.user?.role  || '').toLowerCase();
  const cargo = String(S.user?.cargo || '').toLowerCase();
  return role === 'administrador' || cargo === 'admin';
}

async function _fetch() {
  try {
    const r = await GET('/coupons').catch(() => null);
    S._cupons = Array.isArray(r) ? r : [];
  } catch (e) {
    S._cupons = [];
    toast('❌ Falha ao carregar cupons: ' + (e.message || ''), true);
  }
}

function _fmtData(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return '—'; }
}
function _fmtVal(c) {
  return c.type === 'percent' ? `${c.value}% off` : `R$ ${Number(c.value).toFixed(2)}`;
}
function _statusBadge(c) {
  const now = new Date();
  if (!c.active) return `<span style="background:#FEE2E2;color:#991B1B;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">DESATIVADO</span>`;
  if (c.validUntil && new Date(c.validUntil) < now) return `<span style="background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">EXPIRADO</span>`;
  if (c.maxUses > 0 && c.usedCount >= c.maxUses) return `<span style="background:#E0E7FF;color:#3730A3;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">ESGOTADO</span>`;
  return `<span style="background:#DCFCE7;color:#166534;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">ATIVO</span>`;
}

// ── RENDER ────────────────────────────────────────────────────
export function renderCupons() {
  if (!_isAdmin()) {
    return `<div class="card" style="padding:30px;text-align:center;"><div style="font-size:42px;">🔒</div><h3>Acesso restrito</h3><p style="color:var(--muted);">Apenas administradores podem gerenciar cupons.</p></div>`;
  }

  // Boot — carrega na primeira renderizacao
  if (!S._cuponsBoot) {
    S._cuponsBoot = true;
    _fetch().then(() => {
      import('../main.js').then(m => m.render && m.render()).catch(() => {});
    });
  }

  const lista = S._cupons || [];
  const edit = S._cuponEdit || null;     // doc em edicao (modal aberto)
  const novo = S._cuponNovo || false;    // modal de novo cupom

  return `
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
  <div>
    <h2 style="margin:0;font-family:'Playfair Display',serif;font-size:22px;color:#1E293B;">🎟️ Cupons de Desconto</h2>
    <p style="font-size:13px;color:var(--muted);margin:4px 0 0;">Crie, ative/desative e acompanhe o uso dos cupons do site.</p>
  </div>
  <div style="display:flex;gap:8px;">
    <button id="btn-cupom-refresh" style="background:#fff;color:#1E293B;border:1.5px solid #E5E7EB;padding:9px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">🔄 Atualizar</button>
    <button id="btn-cupom-novo" style="background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;border:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">+ Novo cupom</button>
  </div>
</div>

${lista.length === 0 ? `
<div class="card" style="padding:40px 20px;text-align:center;color:var(--muted);">
  <div style="font-size:42px;margin-bottom:10px;">🎟️</div>
  <p style="font-weight:600;">Nenhum cupom cadastrado.</p>
  <p style="font-size:12px;">Clique em "+ Novo cupom" pra criar o primeiro.</p>
</div>
` : `
<div class="card" style="padding:0;overflow:hidden;">
  <div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#F8FAFC;text-align:left;border-bottom:2px solid #E5E7EB;">
        <th style="padding:11px 14px;">Código</th>
        <th style="padding:11px 14px;">Desconto</th>
        <th style="padding:11px 14px;">Validade</th>
        <th style="padding:11px 14px;">Uso</th>
        <th style="padding:11px 14px;">Regras</th>
        <th style="padding:11px 14px;">Status</th>
        <th style="padding:11px 14px;text-align:right;">Ações</th>
      </tr>
    </thead>
    <tbody>
      ${lista.map(c => `
        <tr style="border-bottom:1px solid #F1F5F9;">
          <td style="padding:12px 14px;">
            <div style="font-family:Monaco,monospace;font-weight:800;font-size:13px;color:#9F1239;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              ${c.code}
              ${c.isExitIntent ? `<span style="background:#FEF3C7;color:#92400E;border:1px solid #F59E0B;font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;letter-spacing:.5px;" title="Aparece no pop-up de saída do site">🎁 POP-UP</span>` : ''}
            </div>
            ${c.description ? `<div style="font-size:11px;color:var(--muted);margin-top:2px;">${c.description}</div>` : ''}
          </td>
          <td style="padding:12px 14px;font-weight:700;color:#166534;">${_fmtVal(c)}</td>
          <td style="padding:12px 14px;font-size:12px;color:var(--muted);">
            ${c.validFrom || c.validUntil ? `${_fmtData(c.validFrom)} → ${_fmtData(c.validUntil)}` : 'Sem prazo'}
          </td>
          <td style="padding:12px 14px;font-size:12px;">
            <strong>${c.usedCount||0}</strong>${c.maxUses>0?` / ${c.maxUses}`:''}
          </td>
          <td style="padding:12px 14px;font-size:11px;color:var(--muted);">
            ${c.firstOnly ? '🆕 1ª compra · ' : ''}
            ${c.maxUsesPerCpf > 0 ? `${c.maxUsesPerCpf}x por CPF` : ''}
            ${c.minOrderValue > 0 ? `<br>Mín R$ ${Number(c.minOrderValue).toFixed(2)}` : ''}
          </td>
          <td style="padding:12px 14px;">${_statusBadge(c)}</td>
          <td style="padding:12px 14px;text-align:right;white-space:nowrap;">
            <button data-cupom-toggle="${c._id}" title="${c.active?'Desativar':'Ativar'}"
              style="background:${c.active?'#FEF3C7':'#DCFCE7'};color:${c.active?'#92400E':'#166534'};border:none;padding:6px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px;">
              ${c.active?'⏸️':'▶️'}
            </button>
            <button data-cupom-edit="${c._id}" title="Editar"
              style="background:#E0E7FF;color:#3730A3;border:none;padding:6px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px;">
              ✏️
            </button>
            <button data-cupom-del="${c._id}" title="Excluir"
              style="background:#FEE2E2;color:#991B1B;border:none;padding:6px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">
              🗑️
            </button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
  </div>
</div>
`}

${(novo || edit) ? _renderModal(edit) : ''}
`;
}

// ── MODAL DE CRIACAO/EDICAO ───────────────────────────────────
function _renderModal(c) {
  const isEdit = !!c;
  c = c || { type:'percent', value:5, active:true, firstOnly:true, minOrderValue:0, maxUses:0, maxUsesPerCpf:1 };
  return `
<div style="position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:999;display:flex;align-items:center;justify-content:center;padding:16px;" data-cupom-modal-close>
  <div style="background:#fff;border-radius:14px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto;padding:22px;" onclick="event.stopPropagation()">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <h3 style="margin:0;font-family:'Playfair Display',serif;font-size:18px;color:#1E293B;">${isEdit ? '✏️ Editar cupom' : '+ Novo cupom'}</h3>
      <button data-cupom-modal-close style="background:#F1F5F9;border:none;width:30px;height:30px;border-radius:6px;font-size:14px;cursor:pointer;">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Código *
        <input id="cup-code" value="${c.code || ''}" ${isEdit?'readonly':''} maxlength="30" placeholder="EX: BEMVINDA"
          style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;text-transform:uppercase;font-family:Monaco,monospace;${isEdit?'background:#F1F5F9;color:#64748B;':''}"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Tipo *
        <select id="cup-type" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;">
          <option value="percent" ${c.type==='percent'?'selected':''}>Porcentagem (%)</option>
          <option value="fixed" ${c.type==='fixed'?'selected':''}>Valor fixo (R$)</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Valor do desconto *
        <input id="cup-value" type="number" step="0.01" min="0" value="${c.value}" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Valor mínimo do pedido (R$)
        <input id="cup-min" type="number" step="0.01" min="0" value="${c.minOrderValue||0}" placeholder="0 = sem mínimo" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
      <label style="grid-column:1 / -1;display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Descrição (interna)
        <input id="cup-desc" value="${c.description||''}" maxlength="200" placeholder="Ex: Cupom de boas-vindas — 1ª compra" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Limite total de usos
        <input id="cup-maxuses" type="number" min="0" value="${c.maxUses||0}" placeholder="0 = ilimitado" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Usos máximos por CPF
        <input id="cup-maxpercpf" type="number" min="0" value="${c.maxUsesPerCpf||1}" placeholder="0 = ilimitado" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Válido a partir de
        <input id="cup-from" type="date" value="${c.validFrom ? new Date(c.validFrom).toISOString().slice(0,10) : ''}" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
        Válido até
        <input id="cup-until" type="date" value="${c.validUntil ? new Date(c.validUntil).toISOString().slice(0,10) : ''}" style="padding:8px 10px;border:1px solid #E5E7EB;border-radius:6px;font-size:13px;"/>
      </label>
    </div>

    <div style="display:flex;gap:14px;margin-top:14px;padding:12px;background:#FAF5F5;border-radius:8px;flex-wrap:wrap;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;font-weight:600;cursor:pointer;">
        <input id="cup-active" type="checkbox" ${c.active!==false?'checked':''}/>
        Ativo
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#475569;font-weight:600;cursor:pointer;">
        <input id="cup-firstonly" type="checkbox" ${c.firstOnly?'checked':''}/>
        Apenas 1ª compra (por CPF/telefone/email)
      </label>
    </div>
    <div style="margin-top:10px;padding:12px;background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;">
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#92400E;font-weight:700;cursor:pointer;">
        <input id="cup-exitintent" type="checkbox" ${c.isExitIntent?'checked':''}/>
        🎁 Usar este cupom no pop-up de saída do site
      </label>
      <div style="font-size:10.5px;color:#78350F;margin-top:4px;margin-left:22px;font-style:italic;">
        Quando marcado, este cupom aparece automaticamente no pop-up que o cliente vê ao tentar sair do site.
        Marcar este desmarca os outros (só um por vez).
      </div>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
      <button data-cupom-modal-close style="background:#F1F5F9;color:#475569;border:none;padding:9px 16px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">Cancelar</button>
      <button id="btn-cupom-save" data-cupom-id="${isEdit?c._id:''}" style="background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;border:none;padding:9px 18px;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer;">
        ${isEdit ? '💾 Salvar alterações' : '+ Criar cupom'}
      </button>
    </div>
  </div>
</div>
  `;
}

// ── BIND EVENTOS ──────────────────────────────────────────────
export function bindCuponsEvents() {
  if (!_isAdmin()) return;
  const rerender = () => import('../main.js').then(m => m.render && m.render()).catch(() => {});

  document.getElementById('btn-cupom-refresh')?.addEventListener('click', async () => {
    await _fetch();
    rerender();
    toast('🔄 Lista atualizada');
  });

  document.getElementById('btn-cupom-novo')?.addEventListener('click', () => {
    S._cuponNovo = true;
    S._cuponEdit = null;
    rerender();
  });

  document.querySelectorAll('[data-cupom-modal-close]').forEach(el => {
    el.addEventListener('click', () => {
      S._cuponNovo = false;
      S._cuponEdit = null;
      rerender();
    });
  });

  document.querySelectorAll('[data-cupom-edit]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.cupomEdit;
      const doc = (S._cupons || []).find(c => String(c._id) === String(id));
      if (!doc) return;
      S._cuponEdit = doc;
      S._cuponNovo = false;
      rerender();
    };
  });

  document.querySelectorAll('[data-cupom-toggle]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.cupomToggle;
      const doc = (S._cupons || []).find(c => String(c._id) === String(id));
      if (!doc) return;
      try {
        const upd = await PATCH('/coupons/' + id, { active: !doc.active });
        const i = S._cupons.findIndex(c => String(c._id) === String(id));
        if (i >= 0) S._cupons[i] = upd;
        toast(upd.active ? '✅ Cupom ativado' : '⏸️ Cupom desativado');
        rerender();
      } catch (e) {
        toast('❌ Erro: ' + (e.message || ''), true);
      }
    };
  });

  document.querySelectorAll('[data-cupom-del]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.cupomDel;
      const doc = (S._cupons || []).find(c => String(c._id) === String(id));
      if (!doc) return;
      if (!confirm(`Excluir cupom ${doc.code}?\n\nUsos registrados nos pedidos antigos sao preservados.`)) return;
      try {
        await DELETE('/coupons/' + id);
        S._cupons = S._cupons.filter(c => String(c._id) !== String(id));
        toast('🗑️ Cupom excluido');
        rerender();
      } catch (e) {
        toast('❌ Erro: ' + (e.message || ''), true);
      }
    };
  });

  document.getElementById('btn-cupom-save')?.addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.cupomId || '';
    const body = {
      code: document.getElementById('cup-code')?.value.toUpperCase().trim(),
      type: document.getElementById('cup-type')?.value,
      value: Number(document.getElementById('cup-value')?.value || 0),
      description: document.getElementById('cup-desc')?.value || '',
      minOrderValue: Number(document.getElementById('cup-min')?.value || 0),
      maxUses: Number(document.getElementById('cup-maxuses')?.value || 0),
      maxUsesPerCpf: Number(document.getElementById('cup-maxpercpf')?.value || 0),
      active: document.getElementById('cup-active')?.checked,
      firstOnly: document.getElementById('cup-firstonly')?.checked,
      isExitIntent: document.getElementById('cup-exitintent')?.checked,
      validFrom: document.getElementById('cup-from')?.value || null,
      validUntil: document.getElementById('cup-until')?.value || null,
    };
    if (!body.code || body.code.length < 2) return toast('❌ Codigo invalido', true);
    if (!Number.isFinite(body.value) || body.value < 0) return toast('❌ Valor invalido', true);
    if (body.type === 'percent' && body.value > 100) return toast('❌ Percentual nao pode ser > 100', true);
    try {
      let saved;
      if (id) {
        saved = await PATCH('/coupons/' + id, body);
        const i = S._cupons.findIndex(c => String(c._id) === String(id));
        if (i >= 0) S._cupons[i] = saved;
        toast('💾 Cupom atualizado');
      } else {
        saved = await POST('/coupons', body);
        S._cupons.unshift(saved);
        toast('✅ Cupom criado');
      }
      S._cuponNovo = false;
      S._cuponEdit = null;
      rerender();
    } catch (e) {
      toast('❌ Erro: ' + (e.message || ''), true);
    }
  });
}
