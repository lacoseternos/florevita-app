// ── PÁGINA DE LICENÇA (dentro do app logado) ─────────────────────────
// Acessada via menu Admin → Licença do Sistema.
// Mostra status atual, Machine ID e permite ativar/renovar licença.

import { getMachineId, formatMachineId, getTrialInfo, getLicenseInfo,
         activateLicense, getActivationLog, checkLicense, resetLicenseData } from '../services/license.js';

const WHATSAPP = '5592993002433';

export async function renderLicenca() {
  const machineId      = await getMachineId();
  const machineDisplay = formatMachineId(machineId);
  const license        = getLicenseInfo();
  const licStatus      = await checkLicense();
  const logs           = getActivationLog();
  const trial          = getTrialInfo();

  // Cartão de status
  const statusCard = _buildStatusCard(licStatus, machineDisplay, machineId, trial, license);

  return `
    <div style="max-width:760px; margin:0 auto; padding:24px 16px">

      <h2 style="font-size:20px; font-weight:700; color:#8B2252; margin:0 0 4px">
        🔑 Licença do Sistema
      </h2>
      <p style="font-size:13px; color:#6b7280; margin:0 0 24px">
        Gerencie a licença e ativação do Laços Eternos.
      </p>

      ${statusCard}

      <!-- Ativar / Renovar -->
      <div style="background:#fff; border-radius:14px; box-shadow:0 2px 12px rgba(0,0,0,.08);
                  padding:24px; margin-bottom:20px">
        <h3 style="margin:0 0 16px; font-size:16px; color:#1f2937; font-weight:700">
          ${license ? '🔄 Renovar / Atualizar Licença' : '🔑 Ativar Licença'}
        </h3>
        <p style="font-size:13px; color:#6b7280; margin:0 0 12px">
          Cole o código de ativação recebido do desenvolvedor:
        </p>
        <textarea id="lic-code-input" rows="4"
          placeholder="Cole aqui o código de ativação (texto Base64)..."
          style="width:100%; box-sizing:border-box; padding:10px 14px; border:2px solid #e5e7eb;
                 border-radius:10px; font-size:12px; font-family:'Courier New',monospace;
                 resize:vertical; outline:none; color:#1f2937"
          onfocus="this.style.borderColor='#8B2252'"
          onblur="this.style.borderColor='#e5e7eb'"></textarea>

        <div id="lic-activate-error" style="display:none; margin-top:10px; padding:10px 14px;
          background:#fef2f2; border:1px solid #fecaca; border-radius:8px;
          font-size:13px; color:#c0392b; white-space:pre-line"></div>

        <div id="lic-activate-success" style="display:none; margin-top:10px; padding:10px 14px;
          background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px;
          font-size:13px; color:#166534; font-weight:600"></div>

        <div style="display:flex; gap:10px; margin-top:14px; flex-wrap:wrap">
          <button id="lic-btn-activate" onclick="window._licActivate()" style="
            background:linear-gradient(135deg,#8B2252,#b5547a); color:#fff; border:none;
            padding:11px 24px; border-radius:10px; font-size:14px; font-weight:700;
            cursor:pointer; transition:opacity .2s">
            🔑 Ativar Licença
          </button>
          <a href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
            `Olá! Gostaria de adquirir/renovar a licença do sistema Laços Eternos.\nID do dispositivo: ${machineId}`
          )}" target="_blank" style="
            background:#25d366; color:#fff; text-decoration:none;
            padding:11px 20px; border-radius:10px; font-size:14px; font-weight:600;
            display:inline-flex; align-items:center; gap:6px">
            💬 Comprar Licença
          </a>
        </div>
      </div>

      <!-- Log de ativação -->
      ${logs.length > 0 ? `
      <div style="background:#fff; border-radius:14px; box-shadow:0 2px 12px rgba(0,0,0,.08);
                  padding:24px; margin-bottom:20px">
        <h3 style="margin:0 0 16px; font-size:15px; color:#1f2937; font-weight:700">
          📋 Histórico de Ativação
        </h3>
        <div style="font-family:'Courier New',monospace; font-size:12px; color:#374151;
                    max-height:200px; overflow-y:auto; background:#f9fafb;
                    border-radius:8px; padding:12px;">
          ${logs.slice().reverse().map(l => `
            <div style="margin-bottom:8px; border-bottom:1px solid #e5e7eb; padding-bottom:6px">
              <span style="color:#8B2252; font-weight:700">${l.event}</span>
              <span style="color:#6b7280; margin-left:8px">${new Date(l.ts).toLocaleString('pt-BR')}</span>
              <div style="color:#374151; margin-top:2px">${JSON.stringify(l.data)}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- Informações técnicas -->
      <div style="background:#f8f0fb; border:1px solid #e8c9de; border-radius:12px;
                  padding:16px 20px; font-size:12px; color:#5a1035">
        <strong>Informações técnicas:</strong>
        ID do Dispositivo: <code style="font-weight:700; letter-spacing:1px">${machineId}</code><br>
        Versão do sistema: 1.0.0 · Laços Eternos © 2026
      </div>

    </div>`;
}

function _buildStatusCard(licStatus, machineDisplay, machineId, trial, license) {
  if (licStatus.status === 'active') {
    const lic = licStatus.license;
    const expStr = lic.expirationDate
      ? new Date(lic.expirationDate).toLocaleDateString('pt-BR')
      : 'Vitalícia';
    return `
      <div style="background:linear-gradient(135deg,#f0fdf4,#dcfce7); border:1px solid #bbf7d0;
                  border-radius:14px; padding:20px 24px; margin-bottom:20px;
                  display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap">
        <div style="font-size:40px">✅</div>
        <div style="flex:1">
          <p style="margin:0 0 4px; font-weight:700; color:#166534; font-size:16px">Licença Ativa</p>
          <p style="margin:0 0 10px; color:#15803d; font-size:13px">
            Plano <strong>${lic.plan || 'Básico'}</strong> · ${lic.companyName || ''} · ${expStr}
          </p>
          <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:8px;
                      font-size:12px; color:#166534">
            <div>👤 <strong>Cliente:</strong> ${lic.clientName || '—'}</div>
            <div>🏢 <strong>Empresa:</strong> ${lic.companyName || '—'}</div>
            <div>🔑 <strong>Chave:</strong> <code>${lic.licenseKey || '—'}</code></div>
            <div>📅 <strong>Emissão:</strong> ${lic.issueDate || '—'}</div>
            <div>📅 <strong>Validade:</strong> ${expStr}</div>
            <div>💻 <strong>ID Dispositivo:</strong> <code>${machineDisplay}</code></div>
          </div>
        </div>
      </div>`;
  }

  if (licStatus.status === 'trial') {
    const days = licStatus.daysLeft;
    const color = days <= 2 ? '#c0392b' : days <= 4 ? '#d97706' : '#2563eb';
    return `
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:14px;
                  padding:20px 24px; margin-bottom:20px; display:flex; gap:16px; align-items:flex-start">
        <div style="font-size:40px">⏳</div>
        <div style="flex:1">
          <p style="margin:0 0 4px; font-weight:700; color:${color}; font-size:16px">
            Período de Teste — ${days} dia${days !== 1 ? 's' : ''} restante${days !== 1 ? 's' : ''}
          </p>
          <p style="margin:0 0 10px; color:#374151; font-size:13px">
            Início: ${trial.startDate} · Encerra em: ${trial.expireDate}
          </p>
          <div style="font-size:12px; color:#6b7280">
            💻 ID Dispositivo: <code style="font-weight:700; letter-spacing:1px">${machineDisplay}</code>
            <button onclick="window._copyLicMachineId('${machineId}')" style="
              margin-left:8px; background:#eff6ff; border:1px solid #bfdbfe; color:#2563eb;
              padding:3px 10px; border-radius:6px; font-size:11px; cursor:pointer">
              📋 Copiar ID
            </button>
          </div>
        </div>
      </div>`;
  }

  // Expirado / bloqueado
  const msgs = {
    trial_expired:   '⏰ Período de teste encerrado. Adquira sua licença para continuar.',
    expired_license: '📅 Licença expirada. Renove para continuar usando o sistema.',
    wrong_machine:   '💻 Esta licença está vinculada a outro dispositivo.',
    tampered:        '⚠️ Manipulação de relógio detectada.',
  };
  return `
    <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:14px;
                padding:20px 24px; margin-bottom:20px; display:flex; gap:16px">
      <div style="font-size:40px">🔒</div>
      <div>
        <p style="margin:0 0 4px; font-weight:700; color:#c0392b; font-size:16px">Acesso Bloqueado</p>
        <p style="margin:0; color:#555; font-size:13px">
          ${msgs[licStatus.status] || licStatus.message || 'Licença inválida.'}
        </p>
        <div style="margin-top:8px; font-size:12px; color:#6b7280">
          💻 ID Dispositivo: <code style="font-weight:700">${machineDisplay}</code>
        </div>
      </div>
    </div>`;
}

export function bindLicencaEvents() {
  window._licActivate = async () => {
    const code  = (document.getElementById('lic-code-input')?.value || '').trim();
    const errEl = document.getElementById('lic-activate-error');
    const sucEl = document.getElementById('lic-activate-success');
    const btn   = document.getElementById('lic-btn-activate');
    if (!errEl || !sucEl || !btn) return;

    errEl.style.display = 'none';
    sucEl.style.display = 'none';

    if (!code) {
      errEl.textContent = 'Cole o código de ativação no campo acima.';
      errEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ Verificando...';

    const result = await activateLicense(code);

    if (result.success) {
      sucEl.textContent = `✅ Licença ativada! Plano: ${result.license.plan || 'Básico'} · Recarregando...`;
      sucEl.style.display = 'block';
      setTimeout(() => location.reload(), 2500);
    } else {
      errEl.textContent = result.error || 'Código inválido.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '🔑 Ativar Licença';
    }
  };

  window._copyLicMachineId = (id) => {
    navigator.clipboard.writeText(id).catch(() => {});
  };
}
