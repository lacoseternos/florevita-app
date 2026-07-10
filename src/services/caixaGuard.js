// ── CAIXA GUARD ───────────────────────────────────────────────
// Regras de abertura/fechamento de caixa integradas ao ponto eletronico.
// Marcia (19/05/2026): funcionarias esquecem de abrir/fechar caixa.
// Fluxo obrigatorio:
//   - Entrada → se caixa nao aberto, FORCA abertura antes de tudo.
//   - Saida → se ela abriu o caixa, FORCA fechamento antes de sair.
//   - So a colab que abriu pode fechar.
//   - Nao permite 2 caixas abertos na mesma unidade.

import { S } from '../state.js';
import { getCaixaRegistrosSync, saveCaixaRegistrosSync, saveCaixaRegistro, syncCaixaFromBackend } from '../pages/caixa.js';

// Helpers
function _hojeStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
}

function _norm(s) {
  return String(s || '').trim().toLowerCase();
}

// Retorna o caixa ABERTO (sem fechamento) da unidade no dia atual, ou null
export function getCaixaAbertoHoje(unit) {
  const hoje = _hojeStr();
  const regs = getCaixaRegistrosSync();
  return regs.find(r => r.date === hoje && r.unit === unit && !r.fechamento) || null;
}

// Retorna QUALQUER caixa do dia (aberto ou fechado) da unidade
export function getCaixaDoDia(unit) {
  const hoje = _hojeStr();
  const regs = getCaixaRegistrosSync();
  return regs.find(r => r.date === hoje && r.unit === unit) || null;
}

// A colaboradora atual eh a responsavel pela abertura do caixa de hoje?
export function isResponsavelAbertura(user, caixaReg) {
  if (!caixaReg || !caixaReg.abertura) return false;
  const nomeAbertura = _norm(caixaReg.abertura.usuario);
  const nomeUser = _norm(user?.name || user?.nome || '');
  return nomeAbertura === nomeUser;
}

// Determina unidade da colab (admin escolhe via S._caixaUnit)
function _getUnitForUser(user) {
  if (user?.role === 'Administrador' || user?.cargo === 'admin') {
    return S._caixaUnit || user?.unit || 'Loja Novo Aleixo';
  }
  return user?.unit || '';
}

// Cargos que precisam abrir/fechar caixa (atendentes que ficam no PDV das lojas)
// Admin, gerente, entregador, expedicao NAO precisam.
const CARGOS_CAIXA = new Set([
  'atendimento', 'atendente', 'caixa', 'vendedor', 'vendedora',
]);

export function precisaCaixa(user) {
  if (!user) return false;
  const cargo = _norm(user.cargo);
  const role  = _norm(user.role);
  // Admin/Gerente nao tem obrigacao de caixa (mas podem se quiserem)
  if (['admin','administrador','gerente','entregador'].includes(cargo)) return false;
  if (['administrador','gerente','entregador'].includes(role)) return false;
  // Loja Novo Aleixo ou Allegro com cargo de atendimento → precisa
  const unit = _getUnitForUser(user);
  if (!['Loja Novo Aleixo','Loja Allegro Mall'].includes(unit)) return false;
  return CARGOS_CAIXA.has(cargo) || CARGOS_CAIXA.has(role);
}

// ─────────────────────────────────────────────────────────────
// MODAL DE ALERTA VISUAL (genérico, NÃO-fechável p/ casos críticos)
// ─────────────────────────────────────────────────────────────
function _mostrarAlertaCaixa({ icon, titulo, mensagem, cor, botaoLabel, botaoAcao, secundario }) {
  return new Promise((resolve) => {
    // Remove modal anterior se existir
    document.getElementById('fv-caixa-alert')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'fv-caixa-alert';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5);">
        <div style="background:${cor.bg};color:${cor.fg};padding:24px 26px;text-align:center;">
          <div style="font-size:48px;line-height:1;margin-bottom:8px;">${icon}</div>
          <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:800;line-height:1.2;">${titulo}</div>
        </div>
        <div style="padding:24px 26px;">
          <div style="font-size:14px;color:#374151;line-height:1.6;text-align:center;margin-bottom:18px;">${mensagem}</div>
          <div style="display:flex;gap:8px;flex-direction:column;">
            <button id="fv-cxalert-ok" style="background:${cor.btnBg};color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;letter-spacing:.3px;">${botaoLabel}</button>
            ${secundario ? `<button id="fv-cxalert-sec" style="background:#fff;color:#6B7280;border:2px solid #D1D5DB;border-radius:10px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;">${secundario.label}</button>` : ''}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#fv-cxalert-ok').onclick = () => {
      overlay.remove();
      try { botaoAcao && botaoAcao(); } catch(_){}
      resolve('ok');
    };
    if (secundario) {
      overlay.querySelector('#fv-cxalert-sec').onclick = () => {
        overlay.remove();
        try { secundario.acao && secundario.acao(); } catch(_){}
        resolve('secundario');
      };
    }
  });
}

// ─────────────────────────────────────────────────────────────
// HOOK: APÓS BATER PONTO DE ENTRADA (chegada / voltaAlmoco)
// ─────────────────────────────────────────────────────────────
export async function onPontoEntrada(user) {
  if (!precisaCaixa(user)) return;
  const unit = _getUnitForUser(user);
  if (!unit) return;

  // SYNC: garante que o estado do caixa veio do backend, não só do localStorage local desta máquina
  try { await syncCaixaFromBackend({ silent: true }); } catch(_) {}

  const caixa = getCaixaAbertoHoje(unit);
  if (caixa) {
    // Caixa ja aberto — informa quem e quando
    if (!isResponsavelAbertura(user, caixa)) {
      await _mostrarAlertaCaixa({
        icon: '✅',
        titulo: 'Caixa já aberto',
        mensagem: `O caixa de hoje já foi aberto por <strong>${caixa.abertura.usuario}</strong> às <strong>${caixa.abertura.hora}</strong>.<br><br>Você pode usar o sistema normalmente. Somente <strong>${caixa.abertura.usuario}</strong> poderá fechar este caixa.`,
        cor: { bg:'#DCFCE7', fg:'#15803D', btnBg:'#15803D' },
        botaoLabel: '👍 Entendi',
      });
    }
    return;
  }

  // Caixa NAO aberto — forca abrir
  await _mostrarAlertaCaixa({
    icon: '⚠️',
    titulo: 'Abertura de Caixa Obrigatória',
    mensagem: `Olá, <strong>${user.name || user.nome || ''}</strong>! Antes de iniciar o expediente, é obrigatório abrir o caixa da unidade <strong>${unit}</strong>.<br><br>Você não conseguirá usar o sistema sem isso.`,
    cor: { bg:'#FEF3C7', fg:'#92400E', btnBg:'#D97706' },
    botaoLabel: '💵 Abrir Caixa Agora',
    botaoAcao: () => {
      S._caixaUnit = unit;
      S.page = 'caixa';
      import('../main.js').then(m => m.render && m.render()).catch(()=>{});
      // Dispara o modal de abertura
      setTimeout(() => {
        const btn = document.getElementById('btn-abrir-caixa');
        if (btn) btn.click();
      }, 600);
    },
  });
}

// ─────────────────────────────────────────────────────────────
// HOOK: APÓS BATER PONTO DE SAÍDA (saida final)
// ─────────────────────────────────────────────────────────────
export async function onPontoSaida(user) {
  if (!precisaCaixa(user)) return;
  const unit = _getUnitForUser(user);
  if (!unit) return;

  try { await syncCaixaFromBackend({ silent: true }); } catch(_) {}

  const caixa = getCaixaAbertoHoje(unit);
  if (!caixa) return; // sem caixa aberto, nada a fazer

  if (!isResponsavelAbertura(user, caixa)) {
    // Outra colab abriu — apenas avisar (nao bloquear saida)
    await _mostrarAlertaCaixa({
      icon: 'ℹ️',
      titulo: 'Saída registrada',
      mensagem: `O caixa de hoje ainda está aberto, mas foi <strong>${caixa.abertura.usuario}</strong> quem abriu. Somente ela pode fechar.<br><br>Você pode sair tranquila.`,
      cor: { bg:'#DBEAFE', fg:'#1E40AF', btnBg:'#1E40AF' },
      botaoLabel: '👍 OK',
    });
    return;
  }

  // Eh ela mesma — FORCA fechar
  await _mostrarAlertaCaixa({
    icon: '🔒',
    titulo: 'Fechamento de Caixa Obrigatório',
    mensagem: `Você abriu o caixa hoje às <strong>${caixa.abertura.hora}</strong>. Antes de encerrar o expediente, é obrigatório <strong>fechar o caixa</strong> e gerar o recibo.`,
    cor: { bg:'#FEE2E2', fg:'#991B1B', btnBg:'#DC2626' },
    botaoLabel: '🔒 Fechar Caixa Agora',
    botaoAcao: () => {
      S._caixaUnit = unit;
      S.page = 'caixa';
      import('../main.js').then(m => m.render && m.render()).catch(()=>{});
      setTimeout(() => {
        const btn = document.getElementById('btn-fechar-caixa');
        if (btn) btn.click();
      }, 600);
    },
  });
}

// ─────────────────────────────────────────────────────────────
// LEMBRETE INSISTENTE DE ABERTURA DE CAIXA (Marcia jul/2026)
// A partir das 9h (Manaus), se o caixa da unidade ainda NÃO foi aberto,
// mostra um alerta no meio da tela a cada 3 minutos, até ser aberto.
// NÃO depende do ponto — a abertura do caixa é independente.
// ─────────────────────────────────────────────────────────────
let _caixaAberturaTimer = null;
export function startCaixaAberturaReminder() {
  if (_caixaAberturaTimer) return;
  const tick = async () => {
    try {
      const user = S.user;
      if (!user) return;
      if (!precisaCaixa(user)) return;                    // só quem opera caixa nas lojas
      const mz = new Date(Date.now() - 4 * 3600 * 1000);  // fuso Manaus (UTC-4)
      const mins = mz.getUTCHours() * 60 + mz.getUTCMinutes();
      if (mins < 540) return;                              // antes das 9h — não lembra
      if (mins > 1200) return;                             // depois das 20h — para de insistir
      const unit = _getUnitForUser(user);
      if (!unit) return;
      try { await syncCaixaFromBackend({ silent: true }); } catch(_){}
      if (getCaixaAbertoHoje(unit)) return;               // já aberto — nada a fazer
      if (document.getElementById('fv-caixa-alert')) return; // já tem alerta na tela
      await _mostrarAlertaCaixa({
        icon: '⏰',
        titulo: 'Abra o Caixa!',
        mensagem: `Bom dia, <strong>${user.name || user.nome || ''}</strong>! O caixa da unidade <strong>${unit}</strong> ainda <strong>não foi aberto hoje</strong>.<br><br>Abra o caixa para começar as vendas. Este lembrete volta a cada 3 minutos até o caixa ser aberto.`,
        cor: { bg:'#FEF3C7', fg:'#92400E', btnBg:'#D97706' },
        botaoLabel: '💵 Abrir Caixa Agora',
        botaoAcao: () => {
          S._caixaUnit = unit;
          S.page = 'caixa';
          import('../main.js').then(mm => mm.render && mm.render()).catch(()=>{});
          setTimeout(() => { document.getElementById('btn-abrir-caixa')?.click(); }, 600);
        },
        secundario: { label: 'Agora não (volta em 3 min)', acao: () => {} },
      });
    } catch(_){}
  };
  tick();
  _caixaAberturaTimer = setInterval(tick, 180000); // 3 minutos
}

// ─────────────────────────────────────────────────────────────
// VALIDACAO: pode abrir caixa? (chamada antes de criar registro)
// ─────────────────────────────────────────────────────────────
export async function podeAbrirCaixa(user, unit) {
  try { await syncCaixaFromBackend({ silent: true }); } catch(_) {}
  const existente = getCaixaAbertoHoje(unit);
  if (existente) {
    await _mostrarAlertaCaixa({
      icon: '🚫',
      titulo: 'Caixa já aberto',
      mensagem: `Já existe um caixa aberto por <strong>${existente.abertura.usuario}</strong> desde <strong>${existente.abertura.hora}</strong>.<br><br>Não é permitido abrir 2 caixas simultaneamente na mesma unidade.`,
      cor: { bg:'#FEE2E2', fg:'#991B1B', btnBg:'#DC2626' },
      botaoLabel: '👍 Entendi',
    });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// VALIDACAO: pode bater ponto de SAÍDA? (Marcia jul/2026)
// Regra: quem ABRIU o caixa só consegue bater a saída se o caixa já
// estiver FECHADO por ela. Enquanto estiver aberto, bloqueia a saída e
// força o fechamento. (Só afeta quem abriu — as demais saem livres.)
// Retorna true = pode sair; false = bloqueado (mostrou alerta).
// ─────────────────────────────────────────────────────────────
export async function podeBaterSaida(user) {
  if (!user) return true;
  const unit = _getUnitForUser(user);
  if (!unit) return true;
  try { await syncCaixaFromBackend({ silent: true }); } catch(_) {}
  const caixa = getCaixaAbertoHoje(unit);
  if (!caixa) return true;                               // nenhum caixa aberto → libera
  if (!isResponsavelAbertura(user, caixa)) return true;  // não foi ela quem abriu → libera
  // Foi ela quem abriu e o caixa AINDA está aberto → bloqueia a saída
  await _mostrarAlertaCaixa({
    icon: '🔒',
    titulo: 'Feche o Caixa antes de sair',
    mensagem: `Você abriu o caixa hoje às <strong>${caixa.abertura.hora}</strong> e ele ainda está <strong>aberto</strong>.<br><br>Só é possível bater o ponto de <strong>saída</strong> depois que você <strong>fechar o caixa</strong> e gerar o recibo.`,
    cor: { bg:'#FEE2E2', fg:'#991B1B', btnBg:'#DC2626' },
    botaoLabel: '🔒 Fechar Caixa Agora',
    botaoAcao: () => {
      S._caixaUnit = unit;
      S.page = 'caixa';
      import('../main.js').then(m => m.render && m.render()).catch(()=>{});
      setTimeout(() => { document.getElementById('btn-fechar-caixa')?.click(); }, 600);
    },
  });
  return false;
}

// ─────────────────────────────────────────────────────────────
// VALIDACAO: pode fechar caixa? (chamada antes de confirmar)
// ─────────────────────────────────────────────────────────────
export async function podeFecharCaixa(user, caixa) {
  if (!caixa || !caixa.abertura) return false;
  if (!isResponsavelAbertura(user, caixa)) {
    await _mostrarAlertaCaixa({
      icon: '🚫',
      titulo: 'Acesso negado',
      mensagem: `Somente <strong>${caixa.abertura.usuario}</strong> (quem abriu o caixa hoje às ${caixa.abertura.hora}) pode realizar o fechamento.<br><br>Por favor, peça pra ela fazer o fechamento.`,
      cor: { bg:'#FEE2E2', fg:'#991B1B', btnBg:'#DC2626' },
      botaoLabel: '👍 Entendi',
    });
    return false;
  }
  return true;
}
