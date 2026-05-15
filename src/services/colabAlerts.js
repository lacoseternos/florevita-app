// ── ALERTAS DE COMPORTAMENTO DO COLABORADOR ────────────────────
// 1) Click impaciente em botoes criticos (>3x em 10s):
//    'Tenha calma! Sua falta de paciencia sera registrada.'
// 2) Inatividade >7min: aviso pra atualizar a pagina.
//
// Pedido da usuaria — comuns no comeco da implantacao do sistema
// (colab clica varias vezes achando que travou, ou deixa pagina
// antiga aberta e nao ve novidades).
import { S, API } from '../state.js';
import { toast } from '../utils/helpers.js';

// ── Helpers comum ──────────────────────────────────────────────
function _registraNaAuditoria(type, descricao, meta) {
  try {
    const tk = localStorage.getItem('fv2_token') || S.token;
    if (!tk) return;
    fetch(API + '/activities', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+tk },
      body: JSON.stringify({
        type,
        description: descricao,
        user: S.user?.name,
        userEmail: S.user?.email,
        userId: S.user?._id || S.user?.id,
        colabId: S.user?.colabId,
        date: new Date().toISOString(),
        meta,
      }),
    }).catch(()=>{});
  } catch(_){}
}

// ── 1) CLIQUE IMPACIENTE ──────────────────────────────────────
// Mapa: { 'btn-id': [timestamps...] }
const _clickStream = new Map();
const CLICK_WINDOW_MS = 10_000;   // 10s
const CLICK_LIMIT = 3;            // mais que 3 dentro de 10s = alerta
let _impacienteOpen = false;

function _showAlertaImpaciente(buttonLabel) {
  if (_impacienteOpen) return; // ja tem modal aberto
  _impacienteOpen = true;
  const nomeUC = String(S.user?.name || 'COLABORADOR').toUpperCase();
  S._modal = `<div class="mo" id="mo-impaciente" style="z-index:2147483647;background:rgba(0,0,0,.65);backdrop-filter:blur(3px);">
    <div class="mo-box" onclick="event.stopPropagation()" style="max-width:520px;border:3px solid #D97706;background:linear-gradient(180deg,#FFFBEB 0%,#FFF 70%);">
      <div style="text-align:center;padding:6px 0 12px;">
        <div style="font-size:48px;margin-bottom:6px;">⚠️</div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;color:#92400E;font-weight:800;">CALMA — UM CLIQUE BASTA</div>
        <div style="font-size:13px;color:#92400E;margin-top:4px;font-weight:600;">${nomeUC}</div>
      </div>
      <div style="background:#FEF3C7;border:2px solid #D97706;border-radius:10px;padding:14px 16px;margin:12px 0;line-height:1.5;">
        <div style="font-size:13px;color:#78350F;font-weight:600;">
          <strong>${nomeUC}</strong>, <strong>TENHA CALMA</strong>. Desta forma você está dificultando o processo de implantação do novo sistema.
        </div>
        <div style="font-size:12px;color:#78350F;margin-top:10px;">
          Esta ocorrência <strong>será registrada no sistema</strong> como sua falta de paciência — algo sobre o qual você já foi instruído.
        </div>
        <div style="font-size:11px;color:#92400E;margin-top:10px;font-style:italic;">
          🔘 Você clicou <strong>${(_clickStream.get(buttonLabel)||[]).length} vezes em ${CLICK_WINDOW_MS/1000} segundos</strong> no botão "${buttonLabel}".
          O sistema responde após o 1º clique — aguarde o resultado antes de clicar novamente.
        </div>
      </div>
      <button id="btn-imp-ciente" style="width:100%;background:linear-gradient(135deg,#D97706,#92400E);color:#fff;border:none;padding:13px 18px;border-radius:10px;font-size:13px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:.5px;box-shadow:0 4px 14px rgba(217,119,6,.4);">
        ✅ Entendido, vou ter paciência
      </button>
    </div>
  </div>`;
  import('../main.js').then(m => m.render()).catch(()=>{});
  setTimeout(() => {
    const btn = document.getElementById('btn-imp-ciente');
    if (btn) btn.addEventListener('click', () => {
      S._modal = '';
      _impacienteOpen = false;
      _clickStream.delete(buttonLabel); // reseta contador apos ack
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }, 100);
  // Registra na auditoria
  _registraNaAuditoria('clique_impaciente', `Cliques impacientes em "${buttonLabel}"`, {
    buttonLabel,
    cliques: (_clickStream.get(buttonLabel)||[]).length,
    janelaSegundos: CLICK_WINDOW_MS/1000,
  });
}

// Chamar isso ao clicar em botao critico. Label = texto humano do botao.
export function trackImpatientClick(label) {
  if (!label) return;
  const now = Date.now();
  const arr = (_clickStream.get(label) || []).filter(t => now - t < CLICK_WINDOW_MS);
  arr.push(now);
  _clickStream.set(label, arr);
  if (arr.length > CLICK_LIMIT) {
    _showAlertaImpaciente(label);
  }
}

// ── 2) INATIVIDADE >7 minutos ─────────────────────────────────
let _idleLast = Date.now();
let _idleTimer = null;
let _idleAlertOpen = false;
const IDLE_MS = 7 * 60 * 1000; // 7 min

function _resetIdle() {
  _idleLast = Date.now();
  if (_idleAlertOpen) {
    // se modal aberto, sai
    if (S._modal && document.getElementById('mo-idle')) {
      S._modal = '';
      _idleAlertOpen = false;
      import('../main.js').then(m => m.render()).catch(()=>{});
    }
  }
}

function _showIdleAlert() {
  if (_idleAlertOpen || S._modal) return; // nao sobrescreve modal aberto
  _idleAlertOpen = true;
  S._modal = `<div class="mo" id="mo-idle" style="z-index:2147483646;background:rgba(0,0,0,.5);">
    <div class="mo-box" onclick="event.stopPropagation()" style="max-width:480px;border:2px solid #3B82F6;">
      <div style="text-align:center;padding:8px 0 12px;">
        <div style="font-size:42px;margin-bottom:8px;">🔄</div>
        <div style="font-family:'Playfair Display',serif;font-size:18px;color:#1E40AF;font-weight:700;">Melhor atualizar sua página</div>
      </div>
      <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 16px;margin:10px 0;font-size:13px;color:#1E3A8A;line-height:1.5;">
        Atualizações para melhorar o sistema estão sendo feitas a todos os momentos.
        Atualize a página pra garantir que você está com a versão mais recente.
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="btn-idle-reload" style="flex:1;background:linear-gradient(135deg,#3B82F6,#1E40AF);color:#fff;border:none;padding:12px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">
          🔄 Atualizar agora
        </button>
        <button id="btn-idle-later" style="background:transparent;color:#6B7280;border:1px solid #D1D5DB;padding:12px 18px;border-radius:10px;font-size:12px;cursor:pointer;">
          Depois
        </button>
      </div>
    </div>
  </div>`;
  import('../main.js').then(m => m.render()).catch(()=>{});
  setTimeout(() => {
    document.getElementById('btn-idle-reload')?.addEventListener('click', () => {
      location.reload();
    });
    document.getElementById('btn-idle-later')?.addEventListener('click', () => {
      S._modal = '';
      _idleAlertOpen = false;
      _idleLast = Date.now(); // reset timer
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }, 100);
}

export function startIdleWatcher() {
  if (_idleTimer) return;
  // Reseta em qualquer atividade
  ['mousemove','keydown','click','scroll','touchstart'].forEach(ev => {
    window.addEventListener(ev, _resetIdle, { passive: true });
  });
  _idleTimer = setInterval(() => {
    if (!S.user) return; // so monitora se logada
    if (S._modal) return; // nao incomoda se ja tem modal
    if (Date.now() - _idleLast >= IDLE_MS) {
      _showIdleAlert();
    }
  }, 30 * 1000); // checa a cada 30s
}

export function stopIdleWatcher() {
  if (_idleTimer) { clearInterval(_idleTimer); _idleTimer = null; }
}
