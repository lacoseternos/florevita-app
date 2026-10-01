// ── MÓDULO: MENSAGENS PRONTAS / RESPOSTAS RÁPIDAS ─────────────
// Três visões:
//   • Padrão da loja — todas copiam; só admin/gerente cria/edita.
//   • ⭐ Minhas Favoritas — cada colaboradora cria as suas (privadas).
//   • 💡 Sugestões da equipe — admin/gerente veem as favoritas de todas e
//     podem adicioná-las às categorias padrão. Marcia (out/2026).
import { S } from '../state.js';
import { GET, POST, PATCH, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';

// Categorias padrão sugeridas no campo (sempre aparecem no datalist).
const CATEGORIAS_PADRAO = ['Atendimento', 'Recuperação', 'Pós-venda', 'Cobrança', 'Entrega', 'Agradecimento', 'Dúvidas frequentes'];

function podeGerir() {
  const r = String(S.user?.role || '');
  const c = String(S.user?.cargo || '').toLowerCase();
  return r === 'Administrador' || r === 'Gerente' || c === 'admin' || c === 'gerente';
}
function meuId() { return String(S.user?._id || S.user?.id || ''); }

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
  const meId = meuId();
  const all = Array.isArray(S._quickMsgs) ? S._quickMsgs : [];
  if (!S._quickMsgsLoaded && !S._quickMsgsLoading) carregarMensagens();

  const shared = all.filter(m => m.scope !== 'personal');
  const myFavs = all.filter(m => m.scope === 'personal' && String(m.ownerId || '') === meId);
  const suggestions = gerir ? all.filter(m => m.scope === 'personal' && String(m.ownerId || '') !== meId) : [];

  const cats = [...new Set(shared.map(m => m.category || 'Geral'))].sort((a, b) => a.localeCompare(b));

  // Valida a visão selecionada
  const chavesValidas = new Set(['__todas', '__favs', ...cats]);
  if (gerir) chavesValidas.add('__sugestoes');
  const catSel = (S._quickMsgCat && chavesValidas.has(S._quickMsgCat)) ? S._quickMsgCat : '__todas';

  let filtered, mode;
  if (catSel === '__favs') { filtered = myFavs; mode = 'fav'; }
  else if (catSel === '__sugestoes') { filtered = suggestions; mode = 'sug'; }
  else if (catSel === '__todas') { filtered = shared; mode = 'shared'; }
  else { filtered = shared.filter(m => (m.category || 'Geral') === catSel); mode = 'shared'; }

  const chip = (k, l, active) => `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}" data-qm-cat="${esc(k)}" style="border-radius:20px;">${esc(l)}</button>`;
  const chipsArr = [
    chip('__todas', 'Todas', catSel === '__todas'),
    ...cats.map(c => chip(c, c, catSel === c)),
    chip('__favs', `⭐ Minhas Favoritas${myFavs.length ? ' (' + myFavs.length + ')' : ''}`, catSel === '__favs'),
  ];
  if (gerir) chipsArr.push(chip('__sugestoes', `💡 Sugestões da equipe${suggestions.length ? ' (' + suggestions.length + ')' : ''}`, catSel === '__sugestoes'));
  const chips = chipsArr.join('');

  const cards = filtered.length ? filtered.map(m => {
    const id = String(m._id);
    const catLabel = m.category || 'Geral';
    // Ações por visão
    let acoes = '';
    if (mode === 'fav') {
      acoes = `<div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" data-qm-edit="${id}" title="Editar">✏️</button>
        <button class="btn btn-ghost btn-sm" data-qm-del="${id}" title="Excluir" style="color:var(--red)">🗑️</button>
      </div>`;
    } else if (mode === 'shared' && gerir) {
      acoes = `<div style="display:flex;gap:4px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" data-qm-edit="${id}" title="Editar">✏️</button>
        <button class="btn btn-ghost btn-sm" data-qm-del="${id}" title="Excluir" style="color:var(--red)">🗑️</button>
      </div>`;
    }
    // Créditos / autor
    const credito = mode === 'sug'
      ? `<div style="font-size:10px;color:#94A3B8;margin-top:3px;">por ${esc(m.ownerName || 'colaboradora')}</div>`
      : (m.suggestedByName ? `<div style="font-size:10px;color:#94A3B8;margin-top:3px;">💡 sugerido por ${esc(m.suggestedByName)}</div>` : '');
    // Botão principal
    const botao = mode === 'sug'
      ? `<div style="display:flex;gap:8px;">
           <button class="btn btn-ghost btn-sm" data-qm-copy="${id}" style="flex:1;justify-content:center;">📋 Copiar</button>
           <button class="btn btn-primary btn-sm" data-qm-promote="${id}" style="flex:1;justify-content:center;">➕ Adicionar às padrão</button>
         </div>`
      : `<button class="btn btn-primary btn-sm" data-qm-copy="${id}" style="width:100%;justify-content:center;">📋 Copiar mensagem</button>`;

    return `<div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
        <div style="min-width:0;">
          <span style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--rose);background:var(--petal);padding:2px 8px;border-radius:10px;">${esc(catLabel)}</span>
          <div style="font-weight:800;font-size:14px;margin-top:6px;color:#1E293B;">${esc(m.title || '(sem título)')}</div>
          ${credito}
        </div>
        ${acoes}
      </div>
      <div style="white-space:pre-wrap;font-size:13px;color:#374151;line-height:1.55;margin:10px 0;background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:10px 12px;">${esc(m.text || '')}</div>
      ${botao}
    </div>`;
  }).join('') : `<div class="empty card"><div class="empty-icon">${mode === 'fav' ? '⭐' : (mode === 'sug' ? '💡' : '💬')}</div><p>${
    mode === 'fav' ? 'Você ainda não tem favoritas. Clique em “⭐ Nova favorita” para criar as suas.'
      : mode === 'sug' ? 'Nenhuma sugestão da equipe por enquanto.'
      : (catSel === '__todas' ? 'Nenhuma mensagem cadastrada ainda.' : 'Nenhuma mensagem nesta categoria.')
  }</p></div>`;

  const subtitulo = mode === 'fav'
    ? 'Suas mensagens pessoais — só você vê. Copie e cole no WhatsApp.'
    : mode === 'sug'
    ? 'Favoritas criadas pela equipe — adicione as melhores às categorias padrão.'
    : 'Respostas rápidas por categoria — clique em copiar e cole no WhatsApp.';

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1E293B;">💬 Mensagens Prontas</div>
      <div style="font-size:11px;color:#94A3B8;">${subtitulo}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost" id="btn-qm-fav">⭐ Nova favorita</button>
      ${gerir ? `<button class="btn btn-primary" id="btn-qm-nova">+ Nova mensagem</button>` : ''}
    </div>
  </div>
  <div class="card" style="margin-bottom:14px;"><div style="display:flex;gap:6px;flex-wrap:wrap;">${chips}</div></div>
  ${(S._quickMsgsLoading && !all.length) ? '<div class="empty card"><div class="empty-icon">⏳</div><p>Carregando mensagens...</p></div>' : cards}
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
  // Nova favorita: disponível pra todas
  document.getElementById('btn-qm-fav')?.addEventListener('click', () => showMensagemModal(null, { scope: 'personal' }));
  // Editar/excluir favorita própria (backend valida o dono)
  document.querySelectorAll('[data-qm-edit]').forEach(b => { b.onclick = () => showMensagemModal(b.dataset.qmEdit); });
  document.querySelectorAll('[data-qm-del]').forEach(b => { b.onclick = () => excluirMensagem(b.dataset.qmDel); });
  if (podeGerir()) {
    document.getElementById('btn-qm-nova')?.addEventListener('click', () => showMensagemModal(null, { scope: 'shared' }));
    document.querySelectorAll('[data-qm-promote]').forEach(b => { b.onclick = () => showMensagemModal(null, { promoteFrom: b.dataset.qmPromote }); });
  }
}

function showMensagemModal(id, opts = {}) {
  const editing = id ? (S._quickMsgs || []).find(x => String(x._id) === id) : null;
  const promoteSrc = opts.promoteFrom ? (S._quickMsgs || []).find(x => String(x._id) === opts.promoteFrom) : null;
  const base = editing || promoteSrc || null;
  // Escopo: edição mantém; nova segue o botão; promoção vira padrão.
  const scope = promoteSrc ? 'shared' : (editing ? (editing.scope || 'shared') : (opts.scope || 'personal'));
  const ehFavorita = scope === 'personal' && !promoteSrc;

  // Datalist = categorias padrão + categorias já existentes (padrão).
  const existentes = (S._quickMsgs || []).filter(m => m.scope !== 'personal').map(m => m.category || 'Geral');
  const cats = [...new Set([...CATEGORIAS_PADRAO, ...existentes])];
  const catInicial = base?.category || (S._quickMsgCat && !String(S._quickMsgCat).startsWith('__') ? S._quickMsgCat : '');

  const titulo = promoteSrc ? '➕ Adicionar às categorias padrão'
    : editing ? (ehFavorita ? '⭐ Editar favorita' : '💬 Editar mensagem')
    : (ehFavorita ? '⭐ Nova favorita' : '💬 Nova mensagem');

  const aviso = ehFavorita
    ? `<div style="font-size:11px;color:#64748B;background:var(--petal);border-radius:8px;padding:8px 10px;margin-bottom:10px;">⭐ <b>Favorita</b> — fica só com você. A gerente/admin pode vê-la como sugestão e adicioná-la às mensagens padrão da loja.</div>`
    : promoteSrc
    ? `<div style="font-size:11px;color:#64748B;background:var(--petal);border-radius:8px;padding:8px 10px;margin-bottom:10px;">Esta mensagem virará <b>padrão da loja</b> (todas verão). A favorita original da colaboradora continua intacta.</div>`
    : '';

  S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:520px" onclick="event.stopPropagation()">
    <div class="mo-title">${titulo}</div>
    ${aviso}
    <div class="fg"><label class="fl">Categoria *</label>
      <input class="fi" id="qm-cat" list="qm-cats" value="${esc(catInicial)}" placeholder="Ex.: Atendimento, Recuperação"/>
      <datalist id="qm-cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    </div>
    <div class="fg"><label class="fl">Título *</label>
      <input class="fi" id="qm-title" value="${esc(base?.title || '')}" placeholder="Ex.: Falta confirmar o pagamento"/>
    </div>
    <div class="fg"><label class="fl">Mensagem *</label>
      <textarea class="fi" id="qm-text" rows="7" placeholder="Digite a mensagem...">${esc(base?.text || '')}</textarea>
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
        if (promoteSrc) {
          await POST('/quick-messages/' + opts.promoteFrom + '/promote', { category, title, text });
          toast('✅ Adicionada às mensagens padrão!');
        } else if (editing) {
          await PATCH('/quick-messages/' + id, { category, title, text });
          toast('✅ Mensagem salva!');
        } else {
          await POST('/quick-messages', { category, title, text, scope });
          toast(ehFavorita ? '⭐ Favorita salva!' : '✅ Mensagem salva!');
        }
        S._modal = '';
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
