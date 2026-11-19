// Edição rápida do cliente (nome, WhatsApp, CPF) — Marcia 19/nov/2026.
// Usada no PDV (cliente escolhido/recém-cadastrado) e na edição do pedido,
// pra corrigir o cadastro sem precisar criar outro cliente.
import { S } from '../state.js';
import { PUT } from './api.js';
import { toast } from '../utils/helpers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function abrirEdicaoCliente({ cliId, nome = '', fone = '', cpf = '', titulo = 'Editar cliente', onSalvo } = {}) {
  document.getElementById('ecr-overlay')?.remove();
  const el = document.createElement('div');
  el.id = 'ecr-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:99995;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:14px;';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;box-shadow:0 25px 60px rgba(0,0,0,.3);overflow:hidden;">
    <div style="background:linear-gradient(135deg,#FDF2F8,#fff);padding:14px 18px;border-bottom:1px solid #FCE7F3;display:flex;justify-content:space-between;align-items:center;">
      <div style="font-weight:900;font-size:16px;color:#8B2252;">✏️ ${esc(titulo)}</div>
      <button type="button" id="ecr-x" style="background:none;border:none;font-size:18px;cursor:pointer;color:#64748B;">✕</button>
    </div>
    <div style="padding:14px 18px;display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12px;font-weight:700;color:#475569;">Nome
        <input id="ecr-nome" class="fi" value="${esc(nome)}" autocomplete="off" style="margin-top:4px;width:100%;box-sizing:border-box;"/></label>
      <label style="font-size:12px;font-weight:700;color:#475569;">WhatsApp
        <input id="ecr-fone" class="fi" value="${esc(fone)}" inputmode="tel" autocomplete="off" placeholder="(92) 9xxxx-xxxx" style="margin-top:4px;width:100%;box-sizing:border-box;"/></label>
      <label style="font-size:12px;font-weight:700;color:#475569;">CPF <span style="font-weight:400;color:#94A3B8;">(opcional)</span>
        <input id="ecr-cpf" class="fi" value="${esc(cpf)}" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="000.000.000-00" style="margin-top:4px;width:100%;box-sizing:border-box;"/></label>
      ${cliId ? '<div style="font-size:11px;color:#64748B;">Muda o cadastro do cliente — vale para os próximos pedidos também.</div>' : '<div style="font-size:11px;color:#B45309;">Este pedido não tem cliente cadastrado vinculado: a mudança vale só para o pedido.</div>'}
    </div>
    <div style="display:flex;gap:8px;padding:0 18px 16px;">
      <button type="button" id="ecr-salvar" style="flex:1;background:#8B2252;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:800;cursor:pointer;">✅ Salvar</button>
      <button type="button" id="ecr-cancelar" style="background:#F1F5F9;border:none;border-radius:10px;padding:11px 14px;font-weight:700;cursor:pointer;">Cancelar</button>
    </div></div>`;
  document.body.appendChild(el);
  const fechar = () => el.remove();
  el.querySelector('#ecr-x').onclick = fechar;
  el.querySelector('#ecr-cancelar').onclick = fechar;
  el.addEventListener('click', (e) => { if (e.target === el) fechar(); });
  const cpfEl = el.querySelector('#ecr-cpf');
  cpfEl.addEventListener('input', () => {
    const d = cpfEl.value.replace(/\D/g, '').slice(0, 11);
    cpfEl.value = d.length > 9 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2}).*/, '$1.$2.$3-$4')
      : d.length > 6 ? d.replace(/^(\d{3})(\d{3})(\d{0,3}).*/, '$1.$2.$3')
      : d.length > 3 ? d.replace(/^(\d{3})(\d{0,3}).*/, '$1.$2') : d;
  });
  setTimeout(() => el.querySelector('#ecr-nome')?.focus(), 50);
  el.querySelector('#ecr-salvar').onclick = async () => {
    const btn = el.querySelector('#ecr-salvar');
    const n = el.querySelector('#ecr-nome').value.trim();
    const f = el.querySelector('#ecr-fone').value.trim();
    const c = cpfEl.value.trim();
    const fd = f.replace(/\D/g, ''), cd = c.replace(/\D/g, '');
    if (!n) return toast('❌ Digite o nome', true);
    if (fd && fd.length < 10) return toast('❌ WhatsApp incompleto — use o número com DDD', true);
    if (cd && cd.length !== 11) return toast('❌ CPF incompleto (11 números)', true);
    // Telefone de outro cliente? avisa pra não duplicar cadastro
    if (fd) {
      const dup = (S.clients || []).find(x => String(x._id) !== String(cliId) && String(x.phone || x.telefone || '').replace(/\D/g, '').slice(-8) === fd.slice(-8));
      if (dup && !confirm(`Esse WhatsApp já está no cadastro de "${dup.name || dup.nome}". Salvar mesmo assim?`)) return;
    }
    btn.disabled = true; btn.textContent = '⏳ Salvando...';
    try {
      let cli = null;
      if (cliId) {
        const body = { name: n, nome: n, phone: f, telefone: f };
        if (cd) body.cpf = c;
        cli = await PUT('/clients/' + cliId, body);
        S.clients = (S.clients || []).map(x => String(x._id) === String(cliId) ? { ...x, ...body, ...(cli || {}) } : x);
      }
      await onSalvo?.({ nome: n, fone: f, cpf: c, cpfDigits: cd, cli });
      toast('✅ Cliente atualizado');
      fechar();
    } catch (e) {
      btn.disabled = false; btn.textContent = '✅ Salvar';
      toast('❌ Não deu pra salvar: ' + (e?.message || 'erro'), true);
    }
  };
}
if (typeof window !== 'undefined') window.abrirEdicaoCliente = abrirEdicaoCliente;
