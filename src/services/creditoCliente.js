// Crédito do cliente (Marcia 22/nov/2026) — registrar no módulo Clientes
// (valor, motivo, forma de pagamento + senha de operações) e usar como
// desconto no PDV. O saldo fica no servidor (/clients/:id/creditos).
import { GET, POST } from './api.js';
import { toast } from '../utils/helpers.js';
import { $c } from '../utils/formatters.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _cache = new Map(); // clientId → { saldo, historico, carregando, em }
const _rerender = () => import('../main.js').then(m => m.render && m.render()).catch(() => {});

export function creditoDe(cid) {
  if (!cid) return null;
  const c = _cache.get(String(cid));
  if (!c || (!c.carregando && Date.now() - (c.em || 0) > 60_000)) carregarCredito(cid);
  return _cache.get(String(cid)) || null;
}
export async function carregarCredito(cid, { forcar = false } = {}) {
  const k = String(cid);
  const atual = _cache.get(k);
  if (atual?.carregando && !forcar) return atual;
  _cache.set(k, { ...(atual || { saldo: 0, historico: [] }), carregando: true });
  try {
    const r = await GET('/clients/' + k + '/creditos');
    _cache.set(k, { saldo: Number(r?.saldo) || 0, historico: r?.historico || [], carregando: false, em: Date.now() });
  } catch { _cache.set(k, { saldo: 0, historico: [], carregando: false, em: Date.now(), erro: true }); }
  _rerender();
  return _cache.get(k);
}

const FORMAS = ['Pix', 'Dinheiro', 'Cartão', 'Link', 'Transferência', 'Troca / devolução', 'Cortesia', 'Outro'];
const dt = (s) => { try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// Cartão de crédito na ficha do cliente (módulo Clientes)
export function cartaoCreditoHTML(cli) {
  if (!cli?._id) return '';
  const c = creditoDe(cli._id);
  const saldo = c?.saldo || 0;
  const hist = (c?.historico || []).slice(0, 8);
  const cor = (t) => t === 'credito' ? '#15803D' : t === 'estorno' ? '#0369A1' : '#B91C1C';
  const rot = (t) => t === 'credito' ? 'Crédito' : t === 'estorno' ? 'Devolvido' : 'Usado';
  return `<div class="card" style="margin-top:16px;">
    <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <span>💰 Crédito do cliente</span>
      <button type="button" class="btn btn-primary btn-sm" onclick="abrirRegistrarCredito('${esc(cli._id)}')">➕ Registrar crédito</button>
    </div>
    <div style="font-size:13px;margin-bottom:6px;">Saldo disponível: <b style="font-size:18px;color:${saldo > 0 ? '#15803D' : 'var(--muted)'};">${c?.carregando && !c?.em ? '⏳' : $c(saldo)}</b></div>
    ${hist.length ? hist.map(h => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding:5px 0;border-top:1px dashed var(--border);">
      <span style="min-width:0;"><b style="color:${cor(h.tipo)};">${rot(h.tipo)}</b> · ${esc(h.motivo || '')}${h.formaPagamento ? ' · ' + esc(h.formaPagamento) : ''}${h.pedidoNumero ? ' · pedido #' + esc(h.pedidoNumero) : ''}
        <span style="color:var(--muted);display:block;">${dt(h.em)} · ${esc(h.por || '')}</span></span>
      <b style="white-space:nowrap;color:${cor(h.tipo)};">${h.valor > 0 ? '+' : '−'}${$c(Math.abs(h.valor))}</b></div>`).join('')
      : '<div style="font-size:11.5px;color:var(--muted);">Nenhum crédito registrado.</div>'}
  </div>`;
}

// Modal: registrar crédito (valor, motivo, forma de pagamento) + senha
export function abrirRegistrarCredito(cid) {
  document.getElementById('cred-overlay')?.remove();
  const el = document.createElement('div');
  el.id = 'cred-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:14px;';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,.3);overflow:hidden;">
    <div style="background:linear-gradient(135deg,#ECFDF5,#fff);padding:14px 18px;border-bottom:1px solid #D1FAE5;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:900;font-size:16px;color:#065F46;">💰 Registrar crédito</div>
      <button type="button" id="cred-x" style="background:none;border:none;font-size:18px;cursor:pointer;color:#64748B;">✕</button></div>
    <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12px;font-weight:700;color:#475569;">Valor (R$)
        <input id="cred-valor" class="fi" type="number" step="0.01" min="0.01" placeholder="0,00" style="margin-top:4px;width:100%;box-sizing:border-box;font-size:18px;font-weight:800;"/></label>
      <label style="font-size:12px;font-weight:700;color:#475569;">Motivo
        <input id="cred-motivo" class="fi" maxlength="300" placeholder="Ex.: pedido com problema, pagou adiantado, devolução…" style="margin-top:4px;width:100%;box-sizing:border-box;"/></label>
      <label style="font-size:12px;font-weight:700;color:#475569;">Forma de pagamento
        <select id="cred-forma" class="fi" style="margin-top:4px;width:100%;box-sizing:border-box;"><option value="">— Selecione —</option>${FORMAS.map(f => `<option>${f}</option>`).join('')}</select></label>
      <div style="font-size:11px;color:#64748B;">O crédito fica no cadastro do cliente e aparece no PDV para usar como desconto. Pede a senha de operações.</div>
    </div>
    <div style="display:flex;gap:8px;padding:0 18px 16px;">
      <button type="button" id="cred-ok" style="flex:1;background:#15803D;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">✅ Registrar</button>
      <button type="button" id="cred-cancelar" style="background:#F1F5F9;border:none;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer;">Cancelar</button></div></div>`;
  document.body.appendChild(el);
  const fechar = () => el.remove();
  el.querySelector('#cred-x').onclick = fechar;
  el.querySelector('#cred-cancelar').onclick = fechar;
  setTimeout(() => el.querySelector('#cred-valor')?.focus(), 50);
  el.querySelector('#cred-ok').onclick = async () => {
    const valor = Math.round((parseFloat(el.querySelector('#cred-valor').value) || 0) * 100) / 100;
    const motivo = el.querySelector('#cred-motivo').value.trim();
    const formaPagamento = el.querySelector('#cred-forma').value;
    if (!(valor > 0)) return toast('❌ Digite o valor do crédito', true);
    if (!motivo) return toast('❌ Digite o motivo', true);
    if (!formaPagamento) return toast('❌ Escolha a forma de pagamento', true);
    el.style.display = 'none';
    const ok = typeof window.pedirSenhaOperacao === 'function'
      ? await window.pedirSenhaOperacao({ titulo: '💰 Aprovar crédito de ' + $c(valor), subtitulo: 'Confirme a senha para registrar o crédito', pedirMotivo: false, corHeader: '#15803D' })
      : true;
    if (!ok) { el.style.display = 'flex'; return; }
    try {
      await POST('/clients/' + cid + '/creditos', { valor, motivo, formaPagamento });
      toast('✅ Crédito de ' + $c(valor) + ' registrado');
      fechar();
      carregarCredito(cid, { forcar: true });
    } catch (e) { el.style.display = 'flex'; toast('❌ ' + (e?.message || 'Não deu pra registrar'), true); }
  };
}
if (typeof window !== 'undefined') window.abrirRegistrarCredito = abrirRegistrarCredito;
