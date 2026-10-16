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
import { manausDateStr as _manausDateStrSrv, serverNowMs as _serverNowMsSrv } from './serverClock.js';

// Helpers
// Marcia (out/2026): usa o RELÓGIO DO SERVIDOR (manausDateStr). Os tablets das
// lojas às vezes têm a DATA errada — com data do device, o "hoje" não batia com
// o registro do caixa e o alerta "abra o caixa" nunca saía (nagava sem parar
// mesmo com o caixa aberto). O servidor é a fonte canônica do dia.
function _hojeStr() {
  return _manausDateStrSrv();
}

// Data do registro normalizada p/ YYYY-MM-DD (tolera registro legado com ISO).
function _regDate(r) {
  return String(r && r.date || '').slice(0, 10);
}

function _norm(s) {
  return String(s || '').trim().toLowerCase();
}

// Compara unidade de forma tolerante (trim + case-insensitive) — evita que
// diferença de maiúsc/espaço no texto da unidade faça o caixa "sumir".
function _unitEq(a, b) { return _norm(a) === _norm(b); }

// Retorna o caixa ABERTO (sem fechamento) da unidade no dia atual, ou null
export function getCaixaAbertoHoje(unit) {
  const hoje = _hojeStr();
  const regs = getCaixaRegistrosSync();
  return regs.find(r => _regDate(r) === hoje && _unitEq(r.unit, unit) && !r.fechamento) || null;
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
      const mz = new Date(_serverNowMsSrv() - 4 * 3600 * 1000);  // Manaus via relógio do servidor
      const mins = mz.getUTCHours() * 60 + mz.getUTCMinutes();
      if (mins < 540) return;                              // antes das 9h — não lembra
      if (mins > 1200) return;                             // depois das 20h — para de insistir
      const unit = _getUnitForUser(user);
      if (!unit) return;
      // Só alerta se CONFIRMOU com o servidor que não há caixa aberto. Se o
      // sync falhar (servidor dormindo/sem internet), NÃO nag com dado velho —
      // era essa a causa do "fica alertando mesmo com o caixa aberto".
      let syncOk = false;
      try { syncOk = await syncCaixaFromBackend({ silent: true, force: true }); } catch(_){}
      if (!syncOk) return;
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

