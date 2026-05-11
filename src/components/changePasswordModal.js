// ── MODAL ALTERAR SENHA ──────────────────────────────────────
// Acessivel pelo botao 🔒 na sidebar (qualquer user logado).
// Para ADM exibe regras mais rigorosas + medidor de forca.
import { S } from '../state.js';
import { POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';

function _ehAdm() {
  const cargo = String(S.user?.cargo||'').toLowerCase();
  const role  = String(S.user?.role||'').toLowerCase();
  return cargo === 'admin' || role === 'administrador';
}

function _calcStrength(pw) {
  if (!pw) return { level:0, label:'-' };
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  if (s >= 5) return { level:3, label:'Muito forte', color:'#15803D' };
  if (s >= 3) return { level:2, label:'Boa',         color:'#D97706' };
  if (s >= 1) return { level:1, label:'Fraca',       color:'#DC2626' };
  return { level:0, label:'Muito fraca', color:'#DC2626' };
}

function _checks(pw) {
  const isAdm = _ehAdm();
  const r = [
    { ok: pw.length >= (isAdm ? 8 : 6), label: `Mínimo ${isAdm?8:6} caracteres` },
    { ok: /[a-zA-Z]/.test(pw),          label: 'Pelo menos 1 letra' },
  ];
  if (isAdm) {
    r.push(
      { ok: /[A-Z]/.test(pw), label: '1 letra MAIÚSCULA' },
      { ok: /[a-z]/.test(pw), label: '1 letra minúscula' },
      { ok: /\d/.test(pw),    label: '1 número' },
    );
  }
  return r;
}

export function openChangePasswordModal() {
  if (document.getElementById('fv-pw-modal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'fv-pw-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:480px;width:100%;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.3);">
      <div style="background:linear-gradient(135deg,#C8736A,#a85f57);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">
        <strong>🔒 Alterar minha senha</strong>
        <button id="fv-pw-close" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;">×</button>
      </div>
      <div style="padding:18px 20px;">
        <div style="background:#FFF7F4;border:1px solid #FCE7E2;padding:10px 12px;border-radius:8px;margin-bottom:14px;font-size:11px;color:#7C4438;">
          Você está alterando a senha de <strong>${S.user?.name || S.user?.email || 'sua conta'}</strong>
          ${_ehAdm() ? '<br>👑 Conta de Administrador — regras de complexidade reforçadas' : ''}
        </div>

        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:11px;font-weight:700;color:#374151;margin-bottom:4px;">Senha atual *</label>
          <input id="fv-pw-current" type="password" autocomplete="current-password" placeholder="Digite sua senha atual" style="
            width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;
          "/>
        </div>

        <div style="margin-bottom:8px;">
          <label style="display:block;font-size:11px;font-weight:700;color:#374151;margin-bottom:4px;">Nova senha *</label>
          <input id="fv-pw-new" type="password" autocomplete="new-password" placeholder="Digite a nova senha" style="
            width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;
          "/>
          <!-- Medidor de forca -->
          <div id="fv-pw-meter" style="margin-top:6px;height:5px;background:#E5E7EB;border-radius:3px;overflow:hidden;">
            <div id="fv-pw-meter-fill" style="height:100%;width:0;background:#DC2626;transition:width .25s;"></div>
          </div>
          <div id="fv-pw-meter-label" style="font-size:10px;color:#6B7280;margin-top:3px;">Força da senha: -</div>
          <!-- Checklist -->
          <div id="fv-pw-checks" style="margin-top:8px;padding:8px 10px;background:#FAFAFA;border-radius:6px;font-size:10px;"></div>
        </div>

        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:11px;font-weight:700;color:#374151;margin-bottom:4px;">Confirmar nova senha *</label>
          <input id="fv-pw-confirm" type="password" autocomplete="new-password" placeholder="Digite a nova senha novamente" style="
            width:100%;padding:9px 12px;border:1px solid #D1D5DB;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;
          "/>
          <div id="fv-pw-confirm-msg" style="font-size:10px;margin-top:3px;color:#6B7280;"></div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="fv-pw-cancel" style="background:#F3F4F6;color:#374151;border:none;padding:9px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px;">Cancelar</button>
          <button id="fv-pw-save" style="background:linear-gradient(135deg,#C8736A,#a85f57);color:#fff;border:none;padding:9px 22px;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;">💾 Alterar senha</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const $ = (id) => document.getElementById(id);
  const newInp = $('fv-pw-new');
  const confInp = $('fv-pw-confirm');

  // Forca + checklist em tempo real
  const updateMeter = () => {
    const pw = newInp.value;
    const m = _calcStrength(pw);
    const fill = $('fv-pw-meter-fill');
    fill.style.width = `${(m.level / 3) * 100}%`;
    fill.style.background = m.color || '#E5E7EB';
    $('fv-pw-meter-label').textContent = `Força da senha: ${m.label}`;
    $('fv-pw-meter-label').style.color = m.color || '#6B7280';
    // Checklist
    const checks = _checks(pw);
    $('fv-pw-checks').innerHTML = checks.map(c =>
      `<div style="display:flex;gap:6px;margin:2px 0;color:${c.ok?'#15803D':'#9CA3AF'};">
        ${c.ok ? '✅' : '◯'} ${c.label}
      </div>`
    ).join('');
  };
  newInp.addEventListener('input', updateMeter);
  updateMeter();

  // Confirmacao em tempo real
  const updateConfirm = () => {
    const pw = newInp.value;
    const cf = confInp.value;
    const msg = $('fv-pw-confirm-msg');
    if (!cf) { msg.textContent = ''; return; }
    if (pw === cf) {
      msg.textContent = '✓ Senhas conferem';
      msg.style.color = '#15803D';
    } else {
      msg.textContent = '✗ Senhas não conferem';
      msg.style.color = '#DC2626';
    }
  };
  confInp.addEventListener('input', updateConfirm);
  newInp.addEventListener('input', updateConfirm);

  const close = () => overlay.remove();
  $('fv-pw-close').onclick = close;
  $('fv-pw-cancel').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  $('fv-pw-save').onclick = async () => {
    const senhaAtual = $('fv-pw-current').value;
    const novaSenha = newInp.value;
    const confirma  = confInp.value;
    if (!senhaAtual) return toast('Informe a senha atual', true);
    if (!novaSenha)  return toast('Informe a nova senha', true);
    if (novaSenha !== confirma) return toast('As senhas não conferem', true);
    const checks = _checks(novaSenha);
    if (checks.some(c => !c.ok)) {
      return toast('A nova senha não atende todos os requisitos', true);
    }
    const btn = $('fv-pw-save');
    btn.disabled = true; btn.textContent = '⏳ Salvando...';
    try {
      await POST('/auth/change-password', { senhaAtual, novaSenha });
      toast('✅ Senha alterada com sucesso!');
      close();
    } catch (e) {
      const msg = e?.message || 'Erro ao alterar senha';
      toast('❌ ' + msg, true);
      btn.disabled = false; btn.textContent = '💾 Alterar senha';
    }
  };

  setTimeout(() => $('fv-pw-current')?.focus(), 100);
}

// Expor globalmente p/ binding via main.js
window.openChangePasswordModal = openChangePasswordModal;
