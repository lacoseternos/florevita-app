// ── POPUP DE AVISOS — automatico ao logar / periodico ─────
// Verifica /api/avisos/meus a cada N segundos. Quando ha pendentes,
// mostra modal central escurecendo o fundo. Botao 'Marcar como lido'
// chama POST /api/avisos/:id/leitura.
//
// Regras:
// - Avisos com 'exigirConfirmacao' bloqueiam fechamento por click fora
// - Urgentes (prioridade='urgente') reaparecem ate confirmar
// - Marcas como lido somem da fila imediatamente
import { S } from '../state.js';
import { GET, POST } from './api.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';
import { formatMensagemRich } from '../pages/avisos.js';

const PRIORIDADES = {
  baixa:   { label: 'BAIXA',   cor: '#6B7280', bg: '#F3F4F6', icon: '💬', border: '#9CA3AF' },
  media:   { label: 'MÉDIA',   cor: '#1E40AF', bg: '#DBEAFE', icon: 'ℹ️', border: '#3B82F6' },
  alta:    { label: 'ALTA',    cor: '#D97706', bg: '#FEF3C7', icon: '⚠️', border: '#F59E0B' },
  urgente: { label: 'URGENTE', cor: '#DC2626', bg: '#FEE2E2', icon: '🚨', border: '#DC2626' },
};

let _pollTimer = null;
let _modalOpen = false;
// Avisos que ja mostrei nesta sessao (mesmo nao confirmados, evita
// reabrir modal a cada poll — so urgentes reaparecem)
const _shownSession = new Set();

function _fmtData(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Manaus', dateStyle: 'short', timeStyle: 'short' });
  } catch { return ''; }
}

async function _checkPendentes() {
  if (_modalOpen) return; // ja tem modal aberto
  if (!S.user || !S.token) return;
  try {
    const r = await GET('/avisos/meus');
    if (!Array.isArray(r) || !r.length) return;
    // Pega o primeiro nao mostrado ainda (urgentes priorizados pelo backend)
    const proximo = r.find(a => a.prioridade === 'urgente' || !_shownSession.has(a._id));
    if (!proximo) return;
    _shownSession.add(proximo._id);
    _showAvisoModal(proximo, r.length);
  } catch (e) {
    console.warn('[avisos] check falhou:', e.message);
  }
}

function _showAvisoModal(aviso, totalPendentes) {
  if (_modalOpen) return;
  _modalOpen = true;

  const p = PRIORIDADES[aviso.prioridade] || PRIORIDADES.media;
  const obrigatorio = aviso.exigirConfirmacao !== false;
  const urgente = aviso.prioridade === 'urgente';

  // Remove modal anterior se existir
  document.getElementById('aviso-popup-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'aviso-popup-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.78);
    z-index:2147483647;display:flex;align-items:center;justify-content:center;
    padding:20px;box-sizing:border-box;
    animation:av-fadein .3s ease-out;backdrop-filter:blur(4px);
  `;

  overlay.innerHTML = `
    <style>
      @keyframes av-fadein { from { opacity: 0; } to { opacity: 1; } }
      @keyframes av-slideup { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
      @keyframes av-pulse { 0%,100% { box-shadow: 0 0 0 0 ${p.border}99; } 50% { box-shadow: 0 0 0 12px ${p.border}00; } }
    </style>
    <div style="
      background:#fff;border-radius:20px;max-width:600px;width:100%;
      max-height:90vh;overflow-y:auto;
      box-shadow:0 25px 70px rgba(0,0,0,.35);
      animation:av-slideup .35s ease-out;
      border-top:8px solid ${p.border};
      ${urgente ? 'animation: av-slideup .35s ease-out, av-pulse 2s infinite;' : ''}
    ">
      <!-- Header -->
      <div style="padding:22px 26px 14px;border-bottom:1px solid #F3F4F6;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:32px;">${p.icon}</span>
            <span style="background:${p.bg};color:${p.cor};padding:4px 14px;border-radius:14px;font-size:11px;font-weight:900;letter-spacing:1px;">${p.label}</span>
          </div>
          ${totalPendentes > 1 ? `<span style="background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">+${totalPendentes - 1} pendente${totalPendentes-1!==1?'s':''}</span>` : ''}
        </div>
        <div style="font-family:'Playfair Display',serif;font-size:24px;color:#111827;line-height:1.3;font-weight:700;">
          ${esc(aviso.titulo)}
        </div>
      </div>

      <!-- Mensagem -->
      <div style="padding:20px 26px;">
        <div style="font-size:14px;color:#374151;line-height:1.6;">
          ${formatMensagemRich(aviso.mensagem)}
        </div>

        ${aviso.anexos?.[0]?.url ? `
          <div style="margin-top:14px;padding:10px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;">
            <a href="${esc(aviso.anexos[0].url)}" target="_blank" rel="noopener" style="color:#1D4ED8;text-decoration:underline;font-size:13px;font-weight:600;">
              📎 ${esc(aviso.anexos[0].nome || 'Ver anexo')}
            </a>
          </div>
        ` : ''}

        <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #E5E7EB;font-size:11px;color:#6B7280;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span>📅 ${_fmtData(aviso.dataDisparo)}</span>
          ${aviso.criadoPorNome ? `<span>👤 ${esc(aviso.criadoPorNome)}</span>` : ''}
        </div>
      </div>

      <!-- Footer / Botoes -->
      <div style="padding:14px 26px 22px;background:#FAFAFA;border-top:1px solid #F3F4F6;border-radius:0 0 20px 20px;">
        ${obrigatorio ? `<div style="font-size:11px;color:#7F1D1D;font-weight:600;margin-bottom:10px;text-align:center;">
          🔒 Confirmação obrigatória — leia antes de prosseguir.
        </div>` : ''}
        <div style="display:flex;gap:8px;${obrigatorio?'':'justify-content:flex-end;'}">
          ${!obrigatorio ? `<button id="av-pop-depois" style="background:transparent;color:#6B7280;border:1px solid #D1D5DB;padding:11px 18px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;">Ver depois</button>` : ''}
          <button id="av-pop-confirmar" style="
            flex:${obrigatorio?'1':'unset'};
            background:linear-gradient(135deg,${p.cor},${p.border});
            color:#fff;border:none;padding:13px 24px;border-radius:10px;
            font-size:14px;font-weight:800;cursor:pointer;
            text-transform:uppercase;letter-spacing:.5px;
            box-shadow:0 4px 14px ${p.cor}40;
          ">
            ✅ Marcar como lido
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Click fora — apenas se NAO obrigatorio
  if (!obrigatorio) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) _closeModal();
    });
  } else {
    // Obrigatorio: click fora mostra aviso "leia primeiro"
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        toast('🔒 Clique em "Marcar como lido" pra continuar', true);
      }
    });
  }

  // ESC tambem so se nao obrigatorio
  const escHandler = (e) => {
    if (e.key === 'Escape' && !obrigatorio) {
      _closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // Botoes
  document.getElementById('av-pop-depois')?.addEventListener('click', _closeModal);
  document.getElementById('av-pop-confirmar')?.addEventListener('click', async () => {
    const btn = document.getElementById('av-pop-confirmar');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
    try {
      await POST(`/avisos/${aviso._id}/leitura`, {});
      _closeModal();
      // Logo apos confirmar, checa proximo aviso pendente
      setTimeout(() => _checkPendentes(), 500);
    } catch (e) {
      toast('❌ Erro ao confirmar: ' + (e.message || ''), true);
      if (btn) { btn.disabled = false; btn.textContent = '✅ Marcar como lido'; }
    }
  });

  function _closeModal() {
    document.getElementById('aviso-popup-overlay')?.remove();
    _modalOpen = false;
  }
}

// ── Inicia polling automatico ─────────────────────────────
// Chamado em main.js apos login e/ou no boot.
export function startAvisosPopup() {
  if (_pollTimer) return;
  // Primeira checagem em 3s (deixa sistema carregar)
  setTimeout(() => _checkPendentes(), 3000);
  // Repete a cada 2 minutos
  _pollTimer = setInterval(_checkPendentes, 2 * 60 * 1000);
}

export function stopAvisosPopup() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  document.getElementById('aviso-popup-overlay')?.remove();
  _modalOpen = false;
  _shownSession.clear();
}
