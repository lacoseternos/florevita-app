// ── TELA DE ATIVAÇÃO / BLOQUEIO ──────────────────────────────────────
// Exibida quando o trial expira ou a licença é inválida.
// Substitui completamente o #root enquanto não houver licença válida.

import { getMachineId, formatMachineId, activateLicense, checkLicense } from '../services/license.js';

const WHATSAPP = '5592993002433';

// Mensagens de status para cada cenário de bloqueio
const STATUS_MSG = {
  trial_expired:   { icon: '⏰', titulo: 'Período de Teste Encerrado',     cor: '#c0392b' },
  expired_license: { icon: '📅', titulo: 'Licença Expirada',               cor: '#c0392b' },
  wrong_machine:   { icon: '💻', titulo: 'Dispositivo Não Autorizado',     cor: '#8B2252' },
  tampered:        { icon: '⚠️', titulo: 'Problema de Segurança Detectado', cor: '#7d3c00' },
  invalid:         { icon: '🔒', titulo: 'Licença Inválida',               cor: '#c0392b' },
};

export async function renderActivation(licStatus) {
  const root = document.getElementById('root');
  if (!root) return;

  const machineId = await getMachineId();
  const machineDisplay = formatMachineId(machineId);
  const info = STATUS_MSG[licStatus.status] || STATUS_MSG.invalid;
  const isTrial = licStatus.status === 'trial_expired';
  const msg = licStatus.message || '';

  root.innerHTML = `
    <div id="activation-screen" style="
      min-height:100vh; background:linear-gradient(135deg,#fdf2f8 0%,#fce4ec 100%);
      display:flex; align-items:center; justify-content:center;
      font-family:'Segoe UI',sans-serif; padding:20px; box-sizing:border-box;">

      <div style="background:#fff; border-radius:20px; box-shadow:0 8px 40px rgba(139,34,82,.15);
                  max-width:520px; width:100%; overflow:hidden;">

        <!-- Cabeçalho -->
        <div style="background:linear-gradient(135deg,#8B2252,#b5547a);
                    padding:32px 36px; text-align:center; color:#fff;">
          <div style="font-size:52px; margin-bottom:8px">🌸</div>
          <h1 style="margin:0 0 4px; font-size:22px; font-weight:700; letter-spacing:.5px">
            Laços Eternos
          </h1>
          <p style="margin:0; opacity:.85; font-size:13px">Sistema de Gestão de Floriculturas</p>
        </div>

        <!-- Aviso de status -->
        <div style="background:#fef2f2; border-left:4px solid ${info.cor};
                    padding:16px 24px; margin:0 24px 0; display:flex; align-items:flex-start; gap:12px;
                    border-radius:0 0 8px 8px;">
          <span style="font-size:28px; line-height:1">${info.icon}</span>
          <div>
            <p style="margin:0 0 4px; font-weight:700; color:${info.cor}; font-size:15px">
              ${info.titulo}
            </p>
            <p style="margin:0; font-size:13px; color:#555">${msg || (isTrial
              ? 'Seu período de avaliação de 7 dias foi encerrado.'
              : 'Insira seu código de ativação para continuar usando o sistema.')}</p>
          </div>
        </div>

        <!-- Corpo -->
        <div style="padding:24px 36px 32px">

          <!-- Machine ID -->
          <div style="background:#f8f0fb; border:1px solid #e8c9de; border-radius:12px;
                      padding:14px 18px; margin-bottom:20px;">
            <p style="margin:0 0 6px; font-size:12px; color:#8B2252; font-weight:600; text-transform:uppercase; letter-spacing:.5px">
              ID deste dispositivo
            </p>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <code id="machine-id-display" style="
                font-size:20px; font-weight:700; color:#5a1035; letter-spacing:3px;
                font-family:'Courier New',monospace; background:#fff; border:1px solid #e8c9de;
                padding:6px 14px; border-radius:8px; flex:1; text-align:center; user-select:all">
                ${machineDisplay}
              </code>
              <button onclick="window._copyMachineId()" style="
                background:#8B2252; color:#fff; border:none; padding:8px 14px;
                border-radius:8px; font-size:12px; cursor:pointer; white-space:nowrap;
                font-weight:600; transition:background .2s">
                📋 Copiar
              </button>
            </div>
            <p style="margin:6px 0 0; font-size:11px; color:#888">
              Envie este ID ao adquirir sua licença para vincular ao dispositivo.
            </p>
          </div>

          <!-- Campo de ativação -->
          <div style="margin-bottom:8px">
            <label style="display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px">
              Código de Ativação
            </label>
            <textarea id="activation-code-input" rows="4"
              placeholder="Cole aqui o código de ativação recebido..."
              style="width:100%; box-sizing:border-box; padding:10px 14px; border:2px solid #e5e7eb;
                     border-radius:10px; font-size:13px; font-family:'Courier New',monospace;
                     resize:vertical; outline:none; transition:border-color .2s; color:#1f2937;
                     line-height:1.5"
              onfocus="this.style.borderColor='#8B2252'"
              onblur="this.style.borderColor='#e5e7eb'"></textarea>
          </div>

          <!-- Erro -->
          <div id="activation-error" style="
            display:none; background:#fef2f2; border:1px solid #fecaca;
            border-radius:8px; padding:10px 14px; margin-bottom:12px;
            font-size:13px; color:#c0392b; white-space:pre-line"></div>

          <!-- Sucesso -->
          <div id="activation-success" style="
            display:none; background:#f0fdf4; border:1px solid #bbf7d0;
            border-radius:8px; padding:10px 14px; margin-bottom:12px;
            font-size:13px; color:#166534; font-weight:600"></div>

          <!-- Botões principais -->
          <div style="display:flex; gap:10px; margin-bottom:12px">
            <button id="btn-activate" onclick="window._doActivate()" style="
              flex:1; background:linear-gradient(135deg,#8B2252,#b5547a);
              color:#fff; border:none; padding:13px; border-radius:10px;
              font-size:15px; font-weight:700; cursor:pointer; transition:opacity .2s;
              letter-spacing:.3px">
              🔑 Ativar Sistema
            </button>
          </div>

          <!-- Botão WhatsApp -->
          <a href="https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
            `Olá! Gostaria de adquirir uma licença do sistema Laços Eternos.\nID do dispositivo: ${machineId}`
          )}" target="_blank" style="
            display:block; text-align:center; background:#25d366; color:#fff;
            text-decoration:none; padding:12px; border-radius:10px;
            font-size:14px; font-weight:600; margin-bottom:10px; transition:opacity .2s"
            onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
            💬 Adquirir Licença via WhatsApp
          </a>

          ${isTrial ? `
          <button onclick="window._dismissActivation()" style="
            width:100%; background:none; border:1px solid #d1d5db; color:#6b7280;
            padding:10px; border-radius:10px; font-size:13px; cursor:pointer;
            transition:background .2s"
            onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='none'">
            ← Voltar ao sistema (trial encerrado)
          </button>` : ''}

          <p style="text-align:center; margin:16px 0 0; font-size:11px; color:#aaa">
            Laços Eternos v1.0 · Sistema de Gestão de Floriculturas
          </p>
        </div>
      </div>
    </div>`;

  // ── Handlers globais ─────────────────────────────────────────────
  window._copyMachineId = () => {
    navigator.clipboard.writeText(machineId).then(() => {
      const btn = document.querySelector('[onclick="window._copyMachineId()"]');
      if (btn) { btn.textContent = '✅ Copiado!'; setTimeout(() => { btn.textContent = '📋 Copiar'; }, 2000); }
    }).catch(() => {
      const el = document.getElementById('machine-id-display');
      if (el) { const r = document.createRange(); r.selectNode(el); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); }
    });
  };

  window._doActivate = async () => {
    const code  = (document.getElementById('activation-code-input')?.value || '').trim();
    const errEl = document.getElementById('activation-error');
    const sucEl = document.getElementById('activation-success');
    const btn   = document.getElementById('btn-activate');
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
      sucEl.textContent = `✅ Licença ativada com sucesso! Plano: ${result.license.plan || 'Básico'} · Bem-vindo(a), ${result.license.clientName || result.license.companyName}!`;
      sucEl.style.display = 'block';
      btn.textContent = '🔄 Reiniciando...';
      setTimeout(() => location.reload(), 2000);
    } else {
      errEl.textContent = result.error || 'Código inválido.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '🔑 Ativar Sistema';
    }
  };

  window._dismissActivation = () => {
    // Fecha a tela (trial encerrado — acesso somente leitura ou bloqueado)
    location.reload();
  };

  // Permite colar e ativar com Enter no textarea (Ctrl+Enter)
  document.getElementById('activation-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) window._doActivate();
  });
}
