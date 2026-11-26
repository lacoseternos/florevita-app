// ── MÓDULO: MENSAGENS PRONTAS / RESPOSTAS RÁPIDAS ─────────────
// Abas (Marcia 26/nov — layout novo):
//   • 💬 Mensagens — busca por palavra-chave + categorias; copiar com 1 toque.
//       – Padrão da loja: todas copiam; só admin/gerente cria/edita.
//       – ⭐ Minhas Favoritas: cada colaboradora cria as suas (privadas).
//       – 💡 Sugestões da equipe (gerência): favoritas das outras; ao aceitar,
//         a sugestão SAI da caixa e fica só na categoria escolhida.
//   • 🖼️ Imagens — catálogos por grupo (pelúcias, chocolates, balões…):
//       copiar a imagem, baixar ou compartilhar; gerência adiciona/troca.
import { S } from '../state.js';
import { GET, POST, PATCH, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';

// Categorias padrão sugeridas no campo (sempre aparecem no datalist).
const CATEGORIAS_PADRAO = ['Atendimento', 'Recuperação', 'Pós-venda', 'Cobrança', 'Entrega', 'Agradecimento', 'Dúvidas frequentes'];
const GRUPOS_IMG_PADRAO = ['Pelúcias', 'Chocolates', 'Balões', 'Polaroids', 'Cestas e Kits', 'Buquês', 'Formas de pagamento'];

function podeGerir() {
  const r = String(S.user?.role || '');
  const c = String(S.user?.cargo || '').toLowerCase();
  return r === 'Administrador' || r === 'Gerente' || c === 'admin' || c === 'gerente';
}
function meuId() { return String(S.user?._id || S.user?.id || ''); }
const _norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

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
async function carregarImagens(force) {
  if (S._imgsLoading) return;
  if (!force && S._imgsLoaded) return;
  S._imgsLoading = true;
  try {
    const r = await GET('/imagens-prontas');
    if (Array.isArray(r)) { S._imgs = r; S._imgsLoaded = true; }
  } catch (_) {}
  finally { S._imgsLoading = false; _reRender(); }
}

const _ESTILO = `<style>
  .qm-tabs{display:flex;gap:6px;margin-bottom:12px;}
  .qm-tab{flex:1;border:1.5px solid var(--border);background:#fff;border-radius:12px;padding:10px;font-weight:800;font-size:13px;cursor:pointer;color:#475569;}
  .qm-tab.on{border-color:var(--rose);background:var(--rose-l, #FDF2F4);color:var(--rose);}
  .qm-busca{position:relative;margin-bottom:10px;}
  .qm-busca input{width:100%;padding:12px 14px 12px 40px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;background:#fff;box-sizing:border-box;}
  .qm-busca input:focus{outline:none;border-color:var(--rose);}
  .qm-busca span{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:16px;opacity:.6;}
  .qm-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:12px;scrollbar-width:thin;}
  .qm-chip{white-space:nowrap;border:1px solid var(--border);background:#fff;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;color:#475569;}
  .qm-chip.on{background:var(--rose);border-color:var(--rose);color:#fff;}
  .qm-chip small{opacity:.7;font-weight:600;}
  .qm-grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:10px;}
  .qm-card{background:#fff;border:1px solid var(--border);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;}
  .qm-card:hover{border-color:#F9A8D4;}
  .qm-tit{font-weight:800;font-size:13.5px;color:#1E293B;}
  .qm-cat{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--rose);}
  .qm-txt{white-space:pre-wrap;font-size:12.5px;color:#475569;line-height:1.5;background:#FAFAFA;border-radius:8px;padding:8px 10px;max-height:7.5em;overflow:hidden;position:relative;cursor:pointer;}
  .qm-txt.aberto{max-height:none;}
  .qm-txt:not(.aberto)::after{content:'';position:absolute;left:0;right:0;bottom:0;height:22px;background:linear-gradient(transparent,#FAFAFA);}
  .qm-acoes{display:flex;gap:6px;align-items:center;}
  .qm-copiar{flex:1;background:var(--rose);color:#fff;border:none;border-radius:9px;padding:8px;font-weight:800;font-size:12.5px;cursor:pointer;}
  .qm-mini{background:#F1F5F9;border:none;border-radius:8px;padding:7px 9px;cursor:pointer;font-size:12px;}
  .qm-sec{font-size:12px;font-weight:900;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin:14px 0 6px;}
  .qm-img{background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;cursor:pointer;display:flex;flex-direction:column;}
  .qm-img img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#F8FAFC;display:block;}
  .qm-img div{padding:6px 8px;font-size:11.5px;font-weight:700;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .qm-gimg{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;}
  mark.qm-hl{background:#FEF08A;padding:0 1px;border-radius:2px;}
</style>`;

export function renderMensagens() {
  const aba = S._qmTab === 'imagens' ? 'imagens' : 'msgs';
  const gerir = podeGerir();
  const topo = `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:#1E293B;">💬 Mensagens Prontas</div>
      <div style="font-size:11px;color:#94A3B8;">${aba === 'imagens' ? 'Catálogos e imagens — toque para copiar, baixar ou enviar.' : 'Procure por palavra-chave e copie com um toque.'}</div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${aba === 'msgs' ? `<button class="btn btn-ghost" id="btn-qm-fav">⭐ Nova favorita</button>${gerir ? `<button class="btn btn-primary" id="btn-qm-nova">+ Nova mensagem</button>` : ''}`
        : (gerir ? `<button class="btn btn-primary" id="btn-qm-img-nova">+ Adicionar imagens</button>` : '')}
    </div>
  </div>
  <div class="qm-tabs">
    <button class="qm-tab ${aba === 'msgs' ? 'on' : ''}" data-qm-tab="msgs">💬 Mensagens</button>
    <button class="qm-tab ${aba === 'imagens' ? 'on' : ''}" data-qm-tab="imagens">🖼️ Imagens / Catálogos</button>
  </div>`;
  return _ESTILO + topo + (aba === 'imagens' ? _renderImagens() : _renderMsgs());
}

function _renderMsgs() {
  const gerir = podeGerir();
  const meId = meuId();
  const all = Array.isArray(S._quickMsgs) ? S._quickMsgs : [];
  if (!S._quickMsgsLoaded && !S._quickMsgsLoading) carregarMensagens();

  const shared = all.filter(m => m.scope !== 'personal');
  const myFavs = all.filter(m => m.scope === 'personal' && String(m.ownerId || '') === meId);
  const suggestions = gerir ? all.filter(m => m.scope === 'personal' && String(m.ownerId || '') !== meId) : [];
  const cats = [...new Set(shared.map(m => m.category || 'Geral'))].sort((a, b) => a.localeCompare(b));
  const chavesValidas = new Set(['__todas', '__favs', ...cats]);
  if (gerir) chavesValidas.add('__sugestoes');
  const catSel = (S._quickMsgCat && chavesValidas.has(S._quickMsgCat)) ? S._quickMsgCat : '__todas';

  let filtered, mode;
  if (catSel === '__favs') { filtered = myFavs; mode = 'fav'; }
  else if (catSel === '__sugestoes') { filtered = suggestions; mode = 'sug'; }
  else if (catSel === '__todas') { filtered = shared; mode = 'shared'; }
  else { filtered = shared.filter(m => (m.category || 'Geral') === catSel); mode = 'shared'; }

  const nCat = (c) => shared.filter(m => (m.category || 'Geral') === c).length;
  const chip = (k, l, n) => `<button class="qm-chip ${catSel === k ? 'on' : ''}" data-qm-cat="${esc(k)}">${esc(l)}${n != null ? ` <small>${n}</small>` : ''}</button>`;
  const chips = [
    chip('__todas', 'Todas', shared.length),
    ...cats.map(c => chip(c, c, nCat(c))),
    chip('__favs', '⭐ Minhas favoritas', myFavs.length),
    ...(gerir ? [chip('__sugestoes', '💡 Sugestões da equipe', suggestions.length)] : []),
  ].join('');

  const card = (m) => {
    const id = String(m._id);
    const podeEditar = mode === 'fav' || (mode === 'shared' && gerir);
    const credito = mode === 'sug' ? `por ${esc(m.ownerName || 'colaboradora')}` : (m.suggestedByName ? `💡 sugerido por ${esc(m.suggestedByName)}` : '');
    const busca = _norm([m.title, m.text, m.category].join(' '));
    return `<div class="qm-card" data-qm-item data-busca="${esc(busca)}">
      <div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">
        <div style="min-width:0;">
          ${mode !== 'shared' || credito ? `<div class="qm-cat">${mode !== 'shared' ? esc(m.category || 'Geral') : ''}${credito ? ` <span style="color:#94A3B8;text-transform:none;letter-spacing:0;font-weight:600;">${mode !== 'shared' ? '· ' : ''}${credito}</span>` : ''}</div>` : ''}
          <div class="qm-tit" data-qm-hl>${esc(m.title || '(sem título)')}</div>
        </div>
        ${podeEditar ? `<div style="display:flex;gap:4px;flex-shrink:0;"><button class="qm-mini" data-qm-edit="${id}" title="Editar">✏️</button><button class="qm-mini" data-qm-del="${id}" title="Excluir">🗑️</button></div>` : ''}
      </div>
      <div class="qm-txt" data-qm-abrir data-qm-hl title="Toque para ver tudo">${esc(m.text || '')}</div>
      <div class="qm-acoes">
        <button class="qm-copiar" data-qm-copy="${id}">📋 Copiar</button>
        ${mode === 'sug' ? `<button class="qm-copiar" style="background:#15803D;" data-qm-promote="${id}">✅ Aceitar</button>` : ''}
      </div>
    </div>`;
  };

  let corpo;
  if (S._quickMsgsLoading && !all.length) corpo = '<div class="empty card"><div class="empty-icon">⏳</div><p>Carregando mensagens...</p></div>';
  else if (!filtered.length) corpo = `<div class="empty card"><div class="empty-icon">${mode === 'fav' ? '⭐' : (mode === 'sug' ? '💡' : '💬')}</div><p>${
    mode === 'fav' ? 'Você ainda não tem favoritas. Toque em “⭐ Nova favorita” para criar as suas.'
      : mode === 'sug' ? 'Nenhuma sugestão nova da equipe.'
      : 'Nenhuma mensagem aqui ainda.'}</p></div>`;
  else if (catSel === '__todas') {
    corpo = cats.map(c => {
      const l = filtered.filter(m => (m.category || 'Geral') === c);
      return l.length ? `<div data-qm-secao><div class="qm-sec">${esc(c)}</div><div class="qm-grade">${l.map(card).join('')}</div></div>` : '';
    }).join('');
  } else corpo = `<div class="qm-grade">${filtered.map(card).join('')}</div>`;

  return `
  <div class="qm-busca"><span>🔎</span><input id="qm-q" type="search" placeholder="Procurar: pix, endereço, atraso, cartão, entrega…" value="${esc(S._qmBusca || '')}" autocomplete="off"/></div>
  <div class="qm-chips">${chips}</div>
  ${mode === 'sug' ? '<div style="font-size:11.5px;color:#64748B;margin:-4px 0 10px;">Ao aceitar, a sugestão vai para a categoria escolhida e sai daqui.</div>' : ''}
  <div id="qm-lista">${corpo}</div>
  <div id="qm-vazio" class="empty card" style="display:none;"><div class="empty-icon">🔎</div><p>Nada encontrado. Tente outra palavra ou toque em <b>Todas</b>.</p></div>`;
}

function _renderImagens() {
  const gerir = podeGerir();
  const all = Array.isArray(S._imgs) ? S._imgs : [];
  if (!S._imgsLoaded && !S._imgsLoading) carregarImagens();
  const grupos = [...new Set(all.map(x => x.grupo || 'Geral'))].sort((a, b) => a.localeCompare(b));
  const gSel = S._qmImgGrupo && grupos.includes(S._qmImgGrupo) ? S._qmImgGrupo : '__todos';
  const chip = (k, l, n) => `<button class="qm-chip ${gSel === k ? 'on' : ''}" data-qm-grupo="${esc(k)}">${esc(l)} <small>${n}</small></button>`;
  const chips = [chip('__todos', 'Todos', all.length), ...grupos.map(g => chip(g, g, all.filter(x => (x.grupo || 'Geral') === g).length))].join('');
  const tile = (x) => `<div class="qm-img" data-qm-item data-busca="${esc(_norm([x.titulo, x.grupo, x.legenda].join(' ')))}" data-qm-ver="${esc(String(x._id))}">
    <img src="${x.miniatura}" alt="" loading="lazy"/><div title="${esc(x.titulo || '')}">${esc(x.titulo || x.grupo || '')}</div></div>`;
  let corpo;
  if (S._imgsLoading && !all.length) corpo = '<div class="empty card"><div class="empty-icon">⏳</div><p>Carregando imagens...</p></div>';
  else if (!all.length) corpo = `<div class="empty card"><div class="empty-icon">🖼️</div><p>${gerir ? 'Nenhuma imagem ainda. Toque em “+ Adicionar imagens” e escolha o grupo (ex.: Pelúcias).' : 'Nenhuma imagem cadastrada ainda.'}</p></div>`;
  else {
    const gs = gSel === '__todos' ? grupos : [gSel];
    corpo = gs.map(g => `<div data-qm-secao><div class="qm-sec">${esc(g)}</div><div class="qm-gimg">${all.filter(x => (x.grupo || 'Geral') === g).map(tile).join('')}</div></div>`).join('');
  }
  return `
  <div class="qm-busca"><span>🔎</span><input id="qm-q" type="search" placeholder="Procurar imagem: urso, ferrero, balão…" value="${esc(S._qmBusca || '')}" autocomplete="off"/></div>
  <div class="qm-chips">${chips}</div>
  <div id="qm-lista">${corpo}</div>
  <div id="qm-vazio" class="empty card" style="display:none;"><div class="empty-icon">🔎</div><p>Nenhuma imagem encontrada.</p></div>`;
}

// Filtra na tela (sem redesenhar, pra não perder o foco do campo).
function _aplicarBusca() {
  const q = _norm(S._qmBusca || '').trim();
  const termos = q.split(/\s+/).filter(Boolean);
  let vis = 0;
  document.querySelectorAll('[data-qm-item]').forEach(el => {
    const ok = !termos.length || termos.every(t => (el.dataset.busca || '').includes(t));
    el.style.display = ok ? '' : 'none';
    if (ok) vis++;
  });
  document.querySelectorAll('[data-qm-secao]').forEach(sec => {
    sec.style.display = [...sec.querySelectorAll('[data-qm-item]')].some(e => e.style.display !== 'none') ? '' : 'none';
  });
  const vazio = document.getElementById('qm-vazio');
  const temItens = document.querySelectorAll('[data-qm-item]').length > 0;
  if (vazio) vazio.style.display = termos.length && temItens && !vis ? '' : 'none';
}

export function bindMensagens() {
  const aba = S._qmTab === 'imagens' ? 'imagens' : 'msgs';
  if (aba === 'msgs' && !S._quickMsgsLoaded && !S._quickMsgsLoading) carregarMensagens();
  if (aba === 'imagens' && !S._imgsLoaded && !S._imgsLoading) carregarImagens();
  document.querySelectorAll('[data-qm-tab]').forEach(b => { b.onclick = () => { S._qmTab = b.dataset.qmTab; S._qmBusca = ''; _reRender(); }; });
  const q = document.getElementById('qm-q');
  if (q) { q.oninput = () => { S._qmBusca = q.value; _aplicarBusca(); }; _aplicarBusca(); }

  // ── Mensagens ──
  document.querySelectorAll('[data-qm-cat]').forEach(b => { b.onclick = () => { S._quickMsgCat = b.dataset.qmCat; _reRender(); }; });
  document.querySelectorAll('[data-qm-abrir]').forEach(el => { el.onclick = () => el.classList.toggle('aberto'); });
  document.querySelectorAll('[data-qm-copy]').forEach(b => {
    b.onclick = async () => {
      const m = (S._quickMsgs || []).find(x => String(x._id) === b.dataset.qmCopy);
      if (!m) return;
      try { await navigator.clipboard.writeText(m.text || ''); toast('📋 Mensagem copiada!'); b.textContent = '✅ Copiada'; setTimeout(() => { b.textContent = '📋 Copiar'; }, 1500); }
      catch (_) { toast('Não consegui copiar — selecione e copie manualmente', true); }
    };
  });
  document.getElementById('btn-qm-fav')?.addEventListener('click', () => showMensagemModal(null, { scope: 'personal' }));
  document.querySelectorAll('[data-qm-edit]').forEach(b => { b.onclick = () => showMensagemModal(b.dataset.qmEdit); });
  document.querySelectorAll('[data-qm-del]').forEach(b => { b.onclick = () => excluirMensagem(b.dataset.qmDel); });
  if (podeGerir()) {
    document.getElementById('btn-qm-nova')?.addEventListener('click', () => showMensagemModal(null, { scope: 'shared' }));
    document.querySelectorAll('[data-qm-promote]').forEach(b => { b.onclick = () => showMensagemModal(null, { promoteFrom: b.dataset.qmPromote }); });
  }

  // ── Imagens ──
  document.querySelectorAll('[data-qm-grupo]').forEach(b => { b.onclick = () => { S._qmImgGrupo = b.dataset.qmGrupo; _reRender(); }; });
  document.querySelectorAll('[data-qm-ver]').forEach(b => { b.onclick = () => abrirImagem(b.dataset.qmVer); });
  document.getElementById('btn-qm-img-nova')?.addEventListener('click', () => showImagemModal(null));
}

// ── Imagens: ler/encolher arquivo ──
function _lerImg(file, max, q) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
const _cacheFoto = new Map();
async function _fotoCompleta(id) {
  if (_cacheFoto.has(id)) return _cacheFoto.get(id);
  const f = await GET('/imagens-prontas/' + id);
  _cacheFoto.set(id, f);
  return f;
}
function _pngBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/png');
    };
    img.src = dataUrl;
  });
}
const _nomeArq = (f) => (String(f.titulo || f.grupo || 'imagem').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'imagem') + '.jpg';

async function abrirImagem(id) {
  const resumo = (S._imgs || []).find(x => String(x._id) === id) || {};
  const gerir = podeGerir();
  S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:560px" onclick="event.stopPropagation()">
    <div class="mo-title">🖼️ ${esc(resumo.titulo || resumo.grupo || 'Imagem')}</div>
    <div id="qi-area" style="text-align:center;background:#F8FAFC;border-radius:10px;min-height:200px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;">
      <img src="${resumo.miniatura || ''}" style="max-width:100%;max-height:60vh;border-radius:8px;filter:blur(2px);" id="qi-img"/>
    </div>
    ${resumo.legenda ? `<div style="white-space:pre-wrap;font-size:12.5px;background:#FAFAFA;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:10px;">${esc(resumo.legenda)}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;">
      <button class="btn btn-primary" id="qi-copiar" style="justify-content:center;">📋 Copiar imagem</button>
      <button class="btn btn-ghost" id="qi-baixar" style="justify-content:center;">⬇️ Baixar</button>
      ${navigator.share ? '<button class="btn btn-ghost" id="qi-share" style="justify-content:center;">📤 Enviar</button>' : ''}
      ${resumo.legenda ? '<button class="btn btn-ghost" id="qi-legenda" style="justify-content:center;">📝 Copiar texto</button>' : ''}
    </div>
    <div class="mo-foot" style="margin-top:10px;">
      ${gerir ? '<button class="btn btn-ghost" id="qi-editar">✏️ Editar</button><button class="btn btn-ghost" id="qi-excluir" style="color:var(--red)">🗑️ Excluir</button>' : ''}
      <button class="btn btn-ghost" id="qi-fechar" style="margin-left:auto;">Fechar</button>
    </div>
  </div></div>`;
  _reRender();
  setTimeout(async () => {
    const fechar = () => { S._modal = ''; _reRender(); };
    document.getElementById('mo')?.addEventListener('click', e => { if (e.target.id === 'mo') fechar(); });
    document.getElementById('qi-fechar')?.addEventListener('click', fechar);
    let full = null;
    try { full = await _fotoCompleta(id); const im = document.getElementById('qi-img'); if (im) { im.src = full.foto; im.style.filter = 'none'; } }
    catch (e) { toast('❌ Não consegui abrir a imagem', true); }
    document.getElementById('qi-copiar')?.addEventListener('click', async () => {
      try {
        if (!full) throw new Error();
        const blob = await _pngBlob(full.foto);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('📋 Imagem copiada! Cole no WhatsApp (Ctrl+V)');
      } catch (_) { toast('Não deu pra copiar aqui — use ⬇️ Baixar ou 📤 Enviar', true); }
    });
    document.getElementById('qi-baixar')?.addEventListener('click', () => {
      if (!full) return;
      const a = document.createElement('a'); a.href = full.foto; a.download = _nomeArq(full); document.body.appendChild(a); a.click(); a.remove();
    });
    document.getElementById('qi-share')?.addEventListener('click', async () => {
      try {
        if (!full) return;
        const blob = await (await fetch(full.foto)).blob();
        const file = new File([blob], _nomeArq(full), { type: 'image/jpeg' });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('sem suporte');
        await navigator.share({ files: [file], text: full.legenda || undefined });
      } catch (e) { if (e?.name !== 'AbortError') toast('Não deu pra enviar daqui — use ⬇️ Baixar', true); }
    });
    document.getElementById('qi-legenda')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(resumo.legenda || ''); toast('📝 Texto copiado!'); } catch (_) {}
    });
    document.getElementById('qi-editar')?.addEventListener('click', () => showImagemModal(id));
    document.getElementById('qi-excluir')?.addEventListener('click', async () => {
      if (!confirm('Excluir esta imagem do catálogo?')) return;
      try { await DELETE('/imagens-prontas/' + id); _cacheFoto.delete(id); toast('🗑️ Imagem excluída'); S._modal = ''; await carregarImagens(true); }
      catch (e) { toast('❌ ' + (e.message || 'Erro ao excluir'), true); }
    });
  }, 40);
}

// Adicionar (várias de uma vez) ou editar uma imagem — gerência.
function showImagemModal(id) {
  const ed = id ? (S._imgs || []).find(x => String(x._id) === id) : null;
  const grupos = [...new Set([...GRUPOS_IMG_PADRAO, ...(S._imgs || []).map(x => x.grupo || 'Geral')])];
  const gIni = ed?.grupo || (S._qmImgGrupo && S._qmImgGrupo !== '__todos' ? S._qmImgGrupo : '');
  S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:520px" onclick="event.stopPropagation()">
    <div class="mo-title">${ed ? '✏️ Editar imagem' : '🖼️ Adicionar imagens'}</div>
    <div class="fg"><label class="fl">Grupo *</label>
      <input class="fi" id="qi-grupo" list="qi-grupos" value="${esc(gIni)}" placeholder="Ex.: Pelúcias, Chocolates, Balões"/>
      <datalist id="qi-grupos">${grupos.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    </div>
    <div class="fg"><label class="fl">Nome ${ed ? '' : '<span style="color:var(--muted);font-weight:400;">(vazio = nome do arquivo)</span>'}</label>
      <input class="fi" id="qi-titulo" value="${esc(ed?.titulo || '')}" placeholder="Ex.: Urso pelúcia 30 cm"/>
    </div>
    <div class="fg"><label class="fl">Texto para mandar junto <span style="color:var(--muted);font-weight:400;">(opcional)</span></label>
      <textarea class="fi" id="qi-legenda" rows="3" placeholder="Ex.: Pelúcias a partir de R$ 49,90 — escolha a sua 🧸">${esc(ed?.legenda || '')}</textarea>
    </div>
    <div class="fg"><label class="fl">${ed ? 'Trocar a imagem (opcional)' : 'Imagens * (pode escolher várias)'}</label>
      <input class="fi" id="qi-arq" type="file" accept="image/*" ${ed ? '' : 'multiple'}/>
    </div>
    <div id="qi-prog" style="font-size:12px;color:#64748B;margin-bottom:6px;"></div>
    <div class="mo-foot">
      <button class="btn btn-primary" id="qi-salvar" style="flex:1;justify-content:center;">💾 Salvar</button>
      <button class="btn btn-ghost" id="qi-cancelar">Cancelar</button>
    </div>
  </div></div>`;
  _reRender();
  setTimeout(() => {
    const fechar = () => { S._modal = ''; _reRender(); };
    document.getElementById('mo')?.addEventListener('click', e => { if (e.target.id === 'mo') fechar(); });
    document.getElementById('qi-cancelar')?.addEventListener('click', fechar);
    document.getElementById('qi-salvar')?.addEventListener('click', async (ev) => {
      const grupo = (document.getElementById('qi-grupo')?.value || '').trim();
      const titulo = (document.getElementById('qi-titulo')?.value || '').trim();
      const legenda = (document.getElementById('qi-legenda')?.value || '').trim();
      const files = [...(document.getElementById('qi-arq')?.files || [])];
      const prog = document.getElementById('qi-prog');
      if (!grupo) return toast('Escolha o grupo (ex.: Pelúcias)', true);
      if (!ed && !files.length) return toast('Escolha pelo menos 1 imagem', true);
      ev.target.disabled = true;
      try {
        if (ed) {
          const body = { grupo, titulo, legenda };
          if (files[0]) { body.foto = await _lerImg(files[0], 1600, 0.85); body.miniatura = await _lerImg(files[0], 360, 0.72); _cacheFoto.delete(id); }
          await PATCH('/imagens-prontas/' + id, body);
          toast('✅ Imagem salva');
        } else {
          let n = 0;
          for (const f of files) {
            if (prog) prog.textContent = `Enviando ${n + 1} de ${files.length}…`;
            const foto = await _lerImg(f, 1600, 0.85), miniatura = await _lerImg(f, 360, 0.72);
            const nome = titulo ? (files.length > 1 ? `${titulo} ${n + 1}` : titulo) : f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
            await POST('/imagens-prontas', { grupo, titulo: nome, legenda, foto, miniatura, ordem: Date.now() % 1e9 });
            n++;
          }
          toast(`✅ ${n} imagem(ns) adicionada(s) em ${grupo}`);
          S._qmImgGrupo = grupo;
        }
        S._modal = '';
        await carregarImagens(true);
      } catch (e) { ev.target.disabled = false; toast('❌ ' + (e.message || 'Erro ao salvar'), true); }
    });
  }, 40);
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
    ? `<div style="font-size:11px;color:#64748B;background:var(--petal);border-radius:8px;padding:8px 10px;margin-bottom:10px;">Esta mensagem virará <b>padrão da loja</b> (todas verão). Ela sai da caixa de sugestões e fica só na categoria escolhida.</div>`
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
