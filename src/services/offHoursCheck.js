// ── ACESSO FORA DO HORARIO ────────────────────────────────────
// Regra (Marcia, 19/05/2026):
//   Todo colaborador exceto Admin, Gerente e Entregador que acessar o
//   sistema entre 20:30 e 06:30 (Manaus) recebe modal pedindo
//   justificativa. Registra em AuditLog (module='off_hours') pra admin
//   visualizar no relatorio.
import { S } from '../state.js';
import { GET, POST } from './api.js';

// Cargos que NAO precisam justificar acesso noturno
const CARGOS_LIVRES = new Set([
  'admin', 'administrador',
  'gerente',
  'entregador',
]);

function _isCargoLivre(user) {
  if (!user) return true;
  const cargo = String(user.cargo || '').toLowerCase().trim();
  const role  = String(user.role  || '').toLowerCase().trim();
  return CARGOS_LIVRES.has(cargo) || CARGOS_LIVRES.has(role);
}

// Detecta tipo de dispositivo
function _detectarDevice() {
  const ua = String(navigator.userAgent || '').toLowerCase();
  if (/tablet|ipad/.test(ua)) return 'Tablet';
  if (/mobile|android|iphone|phone/.test(ua)) return 'Celular';
  if (/smart-tv|tv\b/.test(ua)) return 'TV';
  return 'PC';
}

// Chave de cache por dia em Manaus — evita perguntar de novo no mesmo dia
function _chaveDoDia() {
  const utc = new Date();
  const m = new Date(utc.getTime() - 4*60*60*1000);
  return `fv_offhours_justified_${m.toISOString().slice(0,10)}`;
}

// Mostra modal NAO-fechavel pedindo justificativa.
// Retorna Promise<string> com a justificativa (rejeita logout se vazio).
function _mostrarModalJustificativa(user) {
  return new Promise((resolve) => {
    const nome = (user?.name || user?.nome || '').split(' ')[0] || 'Colaboradora';
    const overlay = document.createElement('div');
    overlay.id = 'fv-offhours-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:999999;display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);animation:fvFadeIn .25s ease-out;">
        <div style="background:linear-gradient(135deg,#92400E,#B45309);color:#fff;padding:20px 26px;">
          <div style="font-size:36px;line-height:1;margin-bottom:8px;">🌙</div>
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:800;line-height:1.2;">Acesso fora do horário</div>
          <div style="font-size:13px;opacity:.92;margin-top:4px;">Olá, ${nome}! Você está acessando o sistema fora do horário do seu trabalho.</div>
        </div>
        <div style="padding:22px 26px;">
          <!-- AVISO REFORÇADO: regra de logout obrigatorio -->
          <div style="background:#FEE2E2;border:2px solid #DC2626;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
            <div style="font-size:13px;font-weight:800;color:#991B1B;margin-bottom:4px;">⚠️ REGRA IMPORTANTE</div>
            <div style="font-size:12px;color:#7F1D1D;line-height:1.5;">
              É <strong>PROIBIDO</strong> deixar o sistema aberto após terminar o turno de trabalho.
              Sempre clique em <strong>SAIR</strong> ao encerrar o expediente —
              caso contrário, atividades automáticas e notificações ficam registradas em seu nome.
            </div>
          </div>
          <div style="font-size:13px;color:#374151;margin-bottom:12px;line-height:1.5;">
            <strong>Justifique o motivo do acesso agora:</strong><br>
            <span style="font-size:11px;color:#6B7280;">(Esta justificativa será registrada e visualizada pela administração)</span>
          </div>
          <textarea id="fv-offhours-just" rows="4" placeholder="Ex: Conferindo pedidos atrasados, ajustando comanda urgente, treinamento, etc." style="width:100%;border:2px solid #F59E0B;border-radius:10px;padding:12px;font-size:13px;font-family:inherit;resize:vertical;outline:none;box-sizing:border-box;"></textarea>
          <div id="fv-offhours-err" style="font-size:11px;color:#DC2626;margin-top:6px;display:none;">Justificativa obrigatória (mínimo 5 caracteres).</div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
            <button id="fv-offhours-ok" style="flex:1;background:#15803D;color:#fff;border:none;border-radius:10px;padding:12px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.3px;">✅ Confirmar e Continuar</button>
            <button id="fv-offhours-logout" style="background:#fff;color:#991B1B;border:2px solid #FCA5A5;border-radius:10px;padding:12px 16px;font-size:13px;font-weight:700;cursor:pointer;">🚪 Sair do Sistema</button>
          </div>
        </div>
      </div>
      <style>
        @keyframes fvFadeIn { from { opacity:0; transform:scale(.95);} to { opacity:1; transform:scale(1);} }
      </style>
    `;
    document.body.appendChild(overlay);
    const txt = overlay.querySelector('#fv-offhours-just');
    const err = overlay.querySelector('#fv-offhours-err');
    setTimeout(() => txt?.focus(), 100);

    overlay.querySelector('#fv-offhours-ok').onclick = () => {
      const v = String(txt.value || '').trim();
      if (v.length < 5) {
        err.style.display = 'block';
        txt.style.borderColor = '#DC2626';
        return;
      }
      overlay.remove();
      resolve(v);
    };
    overlay.querySelector('#fv-offhours-logout').onclick = () => {
      overlay.remove();
      // Logout direto
      localStorage.removeItem('fv2_token');
      localStorage.removeItem('fv2_user');
      window.location.reload();
    };
  });
}

// Funcao principal — chamada no init e depois do login.
// SERVIDOR decide se deve mostrar o modal (logica completa la):
//   - Hora Manaus entre 22:00 e 05:30 (off-hours profundo)
//   - Cargo nao eh admin/gerente/entregador
//   - IP NAO esta na whitelist (CDLE, N.Aleixo, Allegro)
// Se servidor diz shouldShowModal=true, mostra. Caso contrario skip.
export async function checkOffHoursAccess() {
  try {
    const user = S.user;
    if (!user) return;
    // Filtro local antecipado (evita request) — se cargo livre, nao precisa nem perguntar
    if (_isCargoLivre(user)) return;

    // Ja justificou hoje?
    const cacheKey = _chaveDoDia();
    if (localStorage.getItem(cacheKey) === '1') return;

    // Pergunta ao servidor (que sabe TZ Manaus + whitelist de IP)
    let status;
    try {
      status = await GET('/auth/check-off-hours-status');
    } catch (e) {
      console.warn('[offHours] falha ao consultar status:', e?.message);
      return; // sem decisao do servidor, melhor nao incomodar
    }
    if (!status || !status.shouldShowModal) {
      // Servidor disse que nao precisa mostrar (cargo livre, dentro do horario,
      // OU IP whitelisted como CDLE/N.Aleixo/Allegro)
      return;
    }

    // Mostra modal e pega justificativa
    const justificativa = await _mostrarModalJustificativa(user);
    const device = _detectarDevice();

    // Registra no backend
    try {
      await POST('/audit-logs/off-hours', { justificativa, device });
      localStorage.setItem(cacheKey, '1');
    } catch (e) {
      console.warn('[offHours] falha ao registrar:', e?.message);
      localStorage.setItem(cacheKey, '1');
    }
  } catch (e) {
    console.warn('[offHours] erro:', e?.message);
  }
}
