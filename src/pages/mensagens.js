// ── MÓDULO: MENSAGENS PRONTAS / RESPOSTAS RÁPIDAS ─────────────
// Divididas por categoria. Todas as colaboradoras copiam/usam; apenas
// ADMIN e GERENTE podem adicionar/editar/excluir. Marcia (out/2026).
import { S } from '../state.js';
import { GET, POST, PATCH, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';

function podeGerir() {
  const r = String(S.user?.role || '');
  const c = String(S.user?.cargo || '').toLowerCase();
  return r === 'Administrador' || r === 'Gerente' || c === 'admin' || c === 'gerente';
}

async function _reRender() { try { const m = await import('../main.js'); m.render && m.render(); } catch (_) {} }

export async function carregarMensagens(force) {
  if (S._quickMsgsLoading) return;
  if (!force && S._quickMsgsLoaded) return;
  S._quickMsgsLoading = true;
  try {
    const r = await GET('/quick-messages');
    if (Array.isArray(r)) { S._quickMsgs = r; S._quickMsgsLoaded = true; }
  } catch (_) { /* mantém o que já tem em cache */ }
  finally { S._quickMsgsLoading = false; _reRender(); }
}

export function renderMensagens() {
  const gerir = podeGerir();
  const msgs = Array.isArray(S._quickMsgs) ? S._quickMsgs : [];
  if (!S._quickMsgsLoaded && !S._quickMsgsLoading) carregarMensagens();

  const cats = [...new Set(msgs.map(m => m.category || 'Geral'))].sort((a, b) => a.localeCompare(b));
  const catSel = (S._quickMsgCat && cats.includes(S._quickMsgCat)) ? S._quickMsgCat : '__todas';
  const filtered = catSel === '__todas' ? msgs : msgs.filter(m => (m.category || 'Geral') === catSel);

  const chip = (k, l, active) => `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}" data-qm-cat="${esc(k)}" style="border-radius:20px;">${esc(l)}</button>`;
  const chips = [chip('__todas', 'Todas', catSel === '__todas'), ...cats.map(c => chip(c, c, catSel === c))].join('');

  const cards = filtered.length ? filtered.map(m => {
    const id = String(m._id);
    return `<div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="min-width:0;">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--rose);background:var(--petal);padding:2px 8px;border-radius:10px;">${esc(m.category || 'Geral')}</span>
          <div style="font-weight:800;font-size:14px;margin-top:6px;color:#1E293B;">${esc(m.title || '(sem título)')}</div>
        </div>
        ${gerir ? `<div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn btn-ghost btn-sm" data-qm-edit="${id}" title="Editar">✏️</button>
          <button class="btn btn-ghost btn-sm" data-qm-del="${id}" title="Excluir" style="color:var(--red)">🗑️</button>
        </div>` : ''}
      </div>
      <div style="white-space:pre-wrap;font-size:13px;color:#374151;line-height:1.55;margin:10px 0;background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:10px 12px;">${esc(m.text || '')}</div>
      <button class="btn btn-primary btn-sm" data-qm-copy="${id}" style="width:100%;justify-content:center;">📋 Copiar mensagem</button>
    </div>`;
  }).join('') : `<div class="empty card"><div class="empty-icon">💬</div><p>Nenhuma mensagem ${catSel === '__todas' ? 'cadastrada ainda' : 'nesta categoria'}.</p></div>`;

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1E293B;">💬 Mensagens Prontas</div>
      <div style="font-size:11px;color:#94A3B8;">Respostas rápidas por categoria — clique em copiar e cole no WhatsApp</div>
    </div>
    ${gerir ? `<button class="btn btn-primary" id="btn-qm-nova">+ Nova mensagem</button>` : ''}
  </div>
  <div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:6px;flex-wrap:wrap;">${chips}</div></div>
  ${(S._quickMsgsLoading && !msgs.length) ? '<div class="empty card"><div class="empty-icon">⏳</div><p>Carregando mensagens...</p></div>' : cards}
  `;
}

export function bindMensagens() {
  if (!S._quickMsgsLoaded && !S._quickMsgsLoading) carregarMensagens();
  document.querySelectorAll('[data-qm-cat]').forEach(b => { b.onclick = () => { S._quickMsgCat = b.dataset.qmCat; _reRender(); }; });
  document.querySelectorAll('[data-qm-copy]').forEach(b => {
    b.onclick = async () => {
      const m = (S._quickMsgs || []).find(x => String(x._id) === b.dataset.qmCopy);
      if (!m) return;
      try { await navigator.clipboard.writeText(m.text || ''); toast('📋 Mensagem copiada!'); }
      catch (_) { toast('Não consegui copiar — selecione e copie manualmente', true); }
    };
  });
  if (podeGerir()) {
    document.getElementById('btn-qm-nova')?.addEventListener('click', () => showMensagemModal());
    document.querySelectorAll('[data-qm-edit]').forEach(b => { b.onclick = () => showMensagemModal(b.dataset.qmEdit); });
    document.querySelectorAll('[data-qm-del]').forEach(b => { b.onclick = () => excluirMensagem(b.dataset.qmDel); });
  }
}

function showMensagemModal(id) {
  const editing = id ? (S._quickMsgs || []).find(x => String(x._id) === id) : null;
  const cats = [...new Set((S._quickMsgs || []).map(m => m.category || 'Geral'))];
  const catInicial = editing?.category || (S._quickMsgCat && S._quickMsgCat !== '__todas' ? S._quickMsgCat : '');
  S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:520px" onclick="event.stopPropagation()">
    <div class="mo-title">💬 ${editing ? 'Editar' : 'Nova'} mensagem</div>
    <div class="fg"><label class="fl">Categoria *</label>
      <input class="fi" id="qm-cat" list="qm-cats" value="${esc(catInicial)}" placeholder="Ex.: Atendimento, Recuperação"/>
      <datalist id="qm-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    </div>
    <div class="fg"><label class="fl">Título *</label>
      <input class="fi" id="qm-title" value="${esc(editing?.title || '')}" placeholder="Ex.: Falta confirmar o pagamento"/>
    </div>
    <div class="fg"><label class="fl">Mensagem *</label>
      <textarea class="fi" id="qm-text" rows="7" placeholder="Digite a mensagem...">${esc(editing?.text || '')}</textarea>
    </div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="qm-save" style="flex:1;justify-content:center;">💾 Salvar</button>
      <button class="btn btn-ghost" id="qm-cancel">Cancelar</button>
    </div>
  </div></div>`;
  _reRender();
  setTimeout(() => {
    document.getElementById('mo')?.addEventListener('click', e => { if (e.target.id === 'mo') { S._modal = ''; _reRender(); } });
    document.getElementById('qm-cancel')?.addEventListener('click', () => { S._modal = ''; _reRender(); });
    document.getElementById('qm-save')?.addEventListener('click', async () => {
      const category = (document.getElementById('qm-cat')?.value || '').trim();
      const title = (document.getElementById('qm-title')?.value || '').trim();
      const text = (document.getElementById('qm-text')?.value || '').trim();
      if (!category || !title || !text) { toast('Preencha categoria, título e mensagem', true); return; }
      try {
        if (editing) await PATCH('/quick-messages/' + id, { category, title, text });
        else await POST('/quick-messages', { category, title, text });
        S._modal = '';
        toast('✅ Mensagem salva!');
        await carregarMensagens(true);
      } catch (e) { toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
    });
  }, 40);
}

async function excluirMensagem(id) {
  const m = (S._quickMsgs || []).find(x => String(x._id) === id);
  if (!confirm(`Excluir a mensagem "${m?.title || ''}"?`)) return;
  try { await DELETE('/quick-messages/' + id); toast('🗑️ Mensagem excluída'); await carregarMensagens(true); }
  catch (e) { toast('❌ ' + (e.message || 'Erro ao excluir'), true); }
}
