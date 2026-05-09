// ── PAINEL DE CHAT INTERNO ───────────────────────────────────
// Botao flutuante 💬 + panel minimizavel (canto inferior direito)
// com sidebar de salas + thread de mensagens + input.
//
// Carregado por main.js depois do login. Ignora entregadores apenas
// na visibilidade das salas (controlado pelo backend).
import { S } from '../state.js';
import { GET, POST } from '../services/api.js';
import { connectChat, disconnectChat, on, joinRoom, leaveRoom,
         sendMessage, markRead, typing, isConnected } from '../services/chatClient.js';

let mounted = false;
let openPanel = false;
let activeRoomId = null;
let rooms = [];
let messages = [];        // mensagens da sala ativa
let onlineUsers = new Set();
let typingUsers = new Map(); // roomId -> Map(userId -> {name, unit, timer})
let unsubFns = [];
let typingDebounce = null;

// "Nome • Unidade" — padronizacao de nicknames
function nick(name, unit) {
  return `${name || '?'} • ${unit || 'Geral'}`;
}

function fmtTime(d) {
  try {
    return new Date(d).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  } catch { return ''; }
}
function fmtDate(d) {
  try {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()} às ${fmtTime(dt)}`;
  } catch { return ''; }
}
function esc(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function _userIsAdm() {
  const cargo = String(S.user?.cargo||'').toLowerCase();
  const role  = String(S.user?.role||'').toLowerCase();
  return cargo === 'admin' || role === 'administrador';
}

// HTML do botao flutuante + panel
function renderChat() {
  if (!S.user) return '';
  const totalUnread = rooms.reduce((s, r) => s + (r.unread || 0), 0);
  return `
<!-- Botão flutuante 💬 -->
<button id="fv-chat-fab" aria-label="Abrir chat" style="
  position:fixed;bottom:20px;right:20px;z-index:9998;
  width:56px;height:56px;border-radius:50%;
  background:linear-gradient(135deg,#C8736A 0%,#a85f57 100%);
  color:#fff;border:none;cursor:pointer;
  font-size:24px;
  box-shadow:0 8px 24px rgba(200,115,106,.4);
  display:${openPanel?'none':'flex'};align-items:center;justify-content:center;
  transition:transform .2s;
">
  💬
  ${totalUnread>0?`<span style="position:absolute;top:-2px;right:-2px;background:#DC2626;color:#fff;font-size:10px;min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;padding:0 5px;">${totalUnread>99?'99+':totalUnread}</span>`:''}
</button>

<!-- Painel -->
<div id="fv-chat-panel" style="
  position:fixed;bottom:20px;right:20px;z-index:9998;
  width:min(720px,calc(100vw - 40px));height:min(560px,calc(100vh - 80px));
  background:#fff;border-radius:14px;
  box-shadow:0 20px 60px rgba(0,0,0,.25);
  display:${openPanel?'flex':'none'};flex-direction:column;
  overflow:hidden;border:1px solid #e5e7eb;
  font-family:inherit;
">
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#C8736A 0%,#a85f57 100%);color:#fff;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:18px;">💬</span>
      <strong style="font-size:13px;">Chat Interno · Laços Eternos</strong>
      <span style="font-size:10px;opacity:.85;">${isConnected()?'🟢 online':'🔴 offline'}</span>
    </div>
    <div style="display:flex;gap:6px;">
      <button id="fv-chat-min" title="Minimizar" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;">−</button>
    </div>
  </div>

  <!-- Body: sidebar + thread -->
  <div style="flex:1;display:flex;min-height:0;">

    <!-- SIDEBAR -->
    <aside style="width:200px;background:#FAFAFA;border-right:1px solid #E5E7EB;overflow-y:auto;flex-shrink:0;">
      ${_renderSidebar()}
    </aside>

    <!-- THREAD -->
    <main style="flex:1;display:flex;flex-direction:column;min-width:0;background:#fff;">
      ${_renderThread()}
    </main>
  </div>
</div>

<style>
  #fv-chat-fab:hover { transform: scale(1.08); }
  #fv-chat-panel .fv-msg { animation: fvFadeIn .25s ease-out; }
  @keyframes fvFadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  @media (max-width: 640px) {
    #fv-chat-panel { bottom:0!important; right:0!important; width:100vw!important; height:100vh!important; border-radius:0!important; }
    #fv-chat-panel aside { width:160px!important; }
  }
</style>
`;
}

function _renderSidebar() {
  if (!rooms.length) {
    return `<div style="padding:20px 14px;text-align:center;color:#6B7280;font-size:11px;">
      Carregando salas...
    </div>`;
  }
  // Agrupa por categoria
  const cats = { geral:[], unidade:[], funcao:[], dm:[], custom:[] };
  rooms.forEach(r => { (cats[r.category] || cats.custom).push(r); });
  const catLabel = { geral:'GERAL', unidade:'POR UNIDADE', funcao:'POR FUNÇÃO', dm:'CONVERSAS', custom:'CUSTOM' };
  let html = '';
  for (const [k, list] of Object.entries(cats)) {
    if (!list.length) continue;
    html += `<div style="padding:10px 12px 4px;font-size:9px;font-weight:700;color:#9CA3AF;letter-spacing:1px;">${catLabel[k]}</div>`;
    for (const r of list) {
      const active = r._id === activeRoomId;
      const unread = r.unread || 0;
      html += `<button class="fv-room-btn" data-room-id="${r._id}" style="
        width:100%;text-align:left;padding:8px 12px;border:none;cursor:pointer;
        background:${active?'#FDF2F1':'transparent'};color:#1F2937;
        display:flex;justify-content:space-between;align-items:center;gap:6px;
        border-left:3px solid ${active?'#C8736A':'transparent'};
        font-size:12px;
      ">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${unread>0?'font-weight:700;':''}">${esc(r.name)}</span>
        ${unread>0?`<span style="background:#DC2626;color:#fff;font-size:9px;min-width:18px;height:16px;border-radius:8px;display:flex;align-items:center;justify-content:center;padding:0 5px;">${unread}</span>`:''}
      </button>`;
    }
  }
  return html;
}

function _renderThread() {
  if (!activeRoomId) {
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9CA3AF;padding:20px;">
      <div style="font-size:48px;margin-bottom:10px;">💬</div>
      <div style="font-size:13px;">Selecione uma sala à esquerda</div>
    </div>`;
  }
  const room = rooms.find(r => r._id === activeRoomId);
  if (!room) return '';

  // Indicador "digitando..."
  const typingMap = typingUsers.get(activeRoomId);
  const typingList = typingMap ? Array.from(typingMap.values()).map(t => nick(t.name, t.unit)) : [];

  const myId = String(S.user?._id || S.user?.id);

  return `
<!-- Header da sala -->
<div style="padding:10px 14px;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;align-items:center;background:#FAFAFA;">
  <div>
    <div style="font-weight:700;font-size:13px;">${esc(room.name)}</div>
    <div style="font-size:10px;color:#9CA3AF;">${room.category === 'dm' ? 'Conversa direta' : 'Sala em grupo'}</div>
  </div>
</div>

<!-- Mensagens -->
<div id="fv-chat-msgs" style="flex:1;overflow-y:auto;padding:12px 14px;background:#FBFBFB;display:flex;flex-direction:column;gap:8px;">
  ${messages.length === 0 ? `
    <div style="text-align:center;color:#9CA3AF;font-size:12px;padding:40px 0;">
      Nenhuma mensagem ainda. Seja o primeiro! 🌹
    </div>
  ` : messages.map(m => _renderMessage(m, myId)).join('')}
</div>

<!-- Indicador de digitando -->
<div id="fv-chat-typing" style="padding:0 14px;height:16px;font-size:10px;color:#9CA3AF;font-style:italic;">
  ${typingList.length > 0 ? `${typingList.slice(0,3).join(', ')}${typingList.length>3?' e outros':''} digitando...` : ''}
</div>

<!-- Input -->
<div style="padding:8px 12px 10px;border-top:1px solid #E5E7EB;background:#fff;">
  <div style="display:flex;gap:6px;align-items:flex-end;">
    <textarea id="fv-chat-input" rows="1" placeholder="Digite uma mensagem..." style="
      flex:1;resize:none;padding:8px 10px;border:1px solid #D1D5DB;border-radius:18px;
      font-family:inherit;font-size:13px;line-height:1.4;max-height:80px;
      outline:none;
    "></textarea>
    <button id="fv-chat-send" style="
      background:linear-gradient(135deg,#C8736A,#a85f57);color:#fff;
      border:none;padding:8px 16px;border-radius:18px;cursor:pointer;
      font-weight:600;font-size:13px;
    ">Enviar</button>
  </div>
  <div style="font-size:9px;color:#9CA3AF;margin-top:4px;text-align:right;">
    Enter envia · Shift+Enter quebra linha
  </div>
</div>
`;
}

function _renderMessage(m, myId) {
  const mine = String(m.userId) === myId;
  const isAdm = _userIsAdm();
  const sysBg = m.system ? '#EFF6FF' : (m.urgent ? '#FEE2E2' : (mine ? '#FDF2F1' : '#fff'));
  const sysBorder = m.system ? '#3B82F6' : (m.urgent ? '#DC2626' : (mine ? '#C8736A' : '#E5E7EB'));
  const reads = (m.reads || []).filter(r => String(r.userId) !== String(m.userId));
  const readSummary = reads.length > 0 ? `
    <details style="margin-top:4px;">
      <summary style="cursor:pointer;font-size:9px;color:#6B7280;">✔✔ Lida por ${reads.length} pessoa${reads.length===1?'':'s'}</summary>
      <div style="margin-top:3px;padding:5px 8px;background:#F3F4F6;border-radius:4px;font-size:10px;color:#374151;">
        ${reads.slice(0,8).map(r => `<div>• ${esc(nick(r.userName, r.userUnit))} <span style="color:#9CA3AF;">${fmtTime(r.readAt)}</span></div>`).join('')}
        ${reads.length>8?`<div style="color:#9CA3AF;">+${reads.length-8}</div>`:''}
      </div>
    </details>
  ` : '';

  const linkAction = m.linkType === 'order' && m.linkId
    ? `<div style="margin-top:6px;"><a href="#" onclick="window.openOrderFromChat?.('${m.linkId}');return false;" style="color:#3B82F6;font-weight:600;font-size:11px;text-decoration:underline;">📦 Abrir ${esc(m.linkLabel || 'pedido')} →</a></div>` : '';

  return `
<div class="fv-msg" data-msg-id="${m._id}" style="
  background:${sysBg};border-left:3px solid ${sysBorder};
  border-radius:6px;padding:7px 10px;
  ${m.resolved ? 'opacity:.65;' : ''}
">
  <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin-bottom:2px;">
    <div style="font-size:11px;font-weight:700;color:${m.system?'#1E40AF':'#1F2937'};">
      ${m.system ? '🤖 Sistema' : esc(nick(m.userName, m.userUnit))}
      ${m.urgent ? '<span style="background:#DC2626;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px;margin-left:4px;">URGENTE</span>' : ''}
      ${m.pinned ? '<span style="font-size:9px;color:#D97706;margin-left:4px;">📌 Fixada</span>' : ''}
    </div>
    <div style="font-size:9px;color:#9CA3AF;white-space:nowrap;">${fmtTime(m.createdAt)}</div>
  </div>
  <div style="font-size:13px;color:#1F2937;white-space:pre-wrap;word-break:break-word;">${esc(m.text)}</div>
  ${linkAction}
  ${m.resolved ? `
    <div style="margin-top:6px;padding:4px 8px;background:#D1FAE5;border-radius:4px;font-size:10px;color:#065F46;font-weight:600;">
      ✅ Resolvido por ${esc(nick(m.resolvedByName, m.resolvedByUnit))} · ${fmtDate(m.resolvedAt)}
      ${isAdm ? `<button class="fv-msg-unresolve" data-msg-id="${m._id}" style="margin-left:8px;background:transparent;border:none;color:#065F46;text-decoration:underline;cursor:pointer;font-size:9px;">desfazer</button>` : ''}
    </div>
  ` : `
    <div style="margin-top:5px;display:flex;gap:8px;font-size:10px;">
      <button class="fv-msg-resolve" data-msg-id="${m._id}" style="background:transparent;border:none;color:#15803D;cursor:pointer;font-weight:600;">✅ Marcar como resolvido</button>
      ${isAdm ? `<button class="fv-msg-pin" data-msg-id="${m._id}" style="background:transparent;border:none;color:#D97706;cursor:pointer;">📌 Fixar</button>` : ''}
      ${isAdm ? `<button class="fv-msg-del" data-msg-id="${m._id}" style="background:transparent;border:none;color:#DC2626;cursor:pointer;">🗑️ Remover</button>` : ''}
    </div>
  `}
  ${readSummary}
</div>`;
}

// Renderiza no DOM (substituindo tudo)
function _paint() {
  let host = document.getElementById('fv-chat-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'fv-chat-host';
    document.body.appendChild(host);
  }
  host.innerHTML = renderChat();
  _bindEvents();
}

function _bindEvents() {
  document.getElementById('fv-chat-fab')?.addEventListener('click', () => {
    openPanel = true;
    if (!activeRoomId && rooms[0]) _selectRoom(rooms[0]._id);
    else _paint();
  });
  document.getElementById('fv-chat-min')?.addEventListener('click', () => {
    openPanel = false; _paint();
  });
  document.querySelectorAll('.fv-room-btn').forEach(btn => {
    btn.addEventListener('click', () => _selectRoom(btn.dataset.roomId));
  });
  const input = document.getElementById('fv-chat-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _sendCurrent();
      }
    });
    input.addEventListener('input', () => {
      // Auto-resize
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
      // Typing indicator (debounced)
      if (activeRoomId) {
        typing(activeRoomId, true);
        clearTimeout(typingDebounce);
        typingDebounce = setTimeout(() => typing(activeRoomId, false), 2000);
      }
    });
  }
  document.getElementById('fv-chat-send')?.addEventListener('click', _sendCurrent);

  // Resolver / pin / delete / unresolve
  document.querySelectorAll('.fv-msg-resolve').forEach(b => b.onclick = async () => {
    try {
      await fetch(_apiBase()+'/api/chat/messages/'+b.dataset.msgId+'/resolve', {
        method:'PATCH', headers:{ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' },
      });
    } catch(e) {}
  });
  document.querySelectorAll('.fv-msg-unresolve').forEach(b => b.onclick = async () => {
    try {
      await fetch(_apiBase()+'/api/chat/messages/'+b.dataset.msgId+'/unresolve', {
        method:'PATCH', headers:{ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' },
      });
    } catch(e) {}
  });
  document.querySelectorAll('.fv-msg-pin').forEach(b => b.onclick = async () => {
    try {
      await fetch(_apiBase()+'/api/chat/messages/'+b.dataset.msgId+'/pin', {
        method:'PATCH', headers:{ 'Authorization':'Bearer '+S.token, 'Content-Type':'application/json' },
      });
    } catch(e) {}
  });
  document.querySelectorAll('.fv-msg-del').forEach(b => b.onclick = async () => {
    if (!confirm('Remover esta mensagem?')) return;
    try {
      await fetch(_apiBase()+'/api/chat/messages/'+b.dataset.msgId, {
        method:'DELETE', headers:{ 'Authorization':'Bearer '+S.token },
      });
    } catch(e) {}
  });
}

function _apiBase() {
  return (import.meta.env?.VITE_API_URL || 'https://florevita-backend-2-0.onrender.com').replace(/\/api$/, '');
}

async function _sendCurrent() {
  const input = document.getElementById('fv-chat-input');
  const text = (input?.value || '').trim();
  if (!text || !activeRoomId) return;
  try {
    await sendMessage({ roomId: activeRoomId, text });
    if (input) { input.value = ''; input.style.height = 'auto'; }
    typing(activeRoomId, false);
  } catch (e) {
    alert('Erro ao enviar: ' + e.message);
  }
}

async function _selectRoom(roomId) {
  if (activeRoomId === roomId) return;
  if (activeRoomId) leaveRoom(activeRoomId);
  activeRoomId = roomId;
  joinRoom(roomId);
  await _loadMessages(roomId);
  _paint();
  // Marca todas como lidas
  const unreadIds = messages.filter(m => {
    const myId = String(S.user?._id || S.user?.id);
    return String(m.userId) !== myId &&
           !(m.reads||[]).some(r => String(r.userId) === myId);
  }).map(m => m._id);
  if (unreadIds.length) markRead(unreadIds);
  // Reseta unread no sidebar
  rooms = rooms.map(r => r._id === roomId ? { ...r, unread: 0 } : r);
  // Scroll pro fim
  setTimeout(() => {
    const wrap = document.getElementById('fv-chat-msgs');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }, 50);
}

async function _loadRooms() {
  try {
    rooms = await GET('/chat/rooms');
    if (!Array.isArray(rooms)) rooms = [];
  } catch (e) {
    console.warn('[chat] loadRooms', e?.message);
    rooms = [];
  }
}

async function _loadMessages(roomId) {
  try {
    messages = await GET('/chat/rooms/'+roomId+'/messages?limit=50');
    if (!Array.isArray(messages)) messages = [];
  } catch (e) {
    messages = [];
  }
}

// ── ENTRYPOINT — chamado por main.js apos login ──────────────
export async function initChat() {
  if (mounted) return;
  if (!S.user) return;
  // Entregadores PODEM usar chat (regra do user: "podem visualizar
  // apenas grupos autorizados, podem enviar mensagens"). Backend
  // filtra automaticamente quais salas eles veem (Geral + Entregadores).
  mounted = true;
  // Conecta socket
  connectChat();
  // Listeners de eventos do socket
  unsubFns.push(on('connected', () => _paint()));
  unsubFns.push(on('disconnected', () => _paint()));
  unsubFns.push(on('chat:message', (msg) => {
    if (msg.roomId === activeRoomId) {
      messages.push(msg);
      _paint();
      // Marca como lida se a sala ta aberta
      const myId = String(S.user?._id || S.user?.id);
      if (String(msg.userId) !== myId) markRead([msg._id]);
      // Scroll bottom
      setTimeout(() => {
        const wrap = document.getElementById('fv-chat-msgs');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      }, 30);
    } else {
      // incrementa unread na sala
      rooms = rooms.map(r => r._id === msg.roomId ? { ...r, unread: (r.unread||0)+1, lastMessage: msg } : r);
      _paint();
    }
  }));
  unsubFns.push(on('chat:read', ({ messageId, reader }) => {
    messages = messages.map(m => {
      if (String(m._id) !== String(messageId)) return m;
      if ((m.reads||[]).some(r => String(r.userId) === String(reader.userId))) return m;
      return { ...m, reads: [...(m.reads||[]), reader] };
    });
    _paint();
  }));
  unsubFns.push(on('chat:typing', ({ roomId, userId, userName, userUnit, typing: isT }) => {
    if (!typingUsers.has(roomId)) typingUsers.set(roomId, new Map());
    const m = typingUsers.get(roomId);
    if (isT) {
      if (m.get(userId)?.timer) clearTimeout(m.get(userId).timer);
      m.set(userId, { name: userName, unit: userUnit, timer: setTimeout(() => {
        m.delete(userId); _paint();
      }, 3500) });
    } else {
      m.delete(userId);
    }
    if (roomId === activeRoomId) _paint();
  }));
  unsubFns.push(on('chat:resolved', ({ messageId, resolvedByName, resolvedByUnit, resolvedAt }) => {
    messages = messages.map(m => String(m._id) === String(messageId)
      ? { ...m, resolved:true, resolvedByName, resolvedByUnit, resolvedAt } : m);
    _paint();
  }));
  unsubFns.push(on('chat:unresolved', ({ messageId }) => {
    messages = messages.map(m => String(m._id) === String(messageId)
      ? { ...m, resolved:false, resolvedByName:'', resolvedByUnit:'', resolvedAt:null } : m);
    _paint();
  }));
  unsubFns.push(on('chat:deleted', ({ messageId }) => {
    messages = messages.filter(m => String(m._id) !== String(messageId));
    _paint();
  }));
  unsubFns.push(on('chat:online-list', (ids) => {
    onlineUsers = new Set(ids);
  }));
  unsubFns.push(on('chat:presence', ({ userId, online }) => {
    if (online) onlineUsers.add(userId); else onlineUsers.delete(userId);
  }));
  // Carrega salas + render inicial
  await _loadRooms();
  _paint();
}

export function shutdownChat() {
  if (!mounted) return;
  mounted = false;
  unsubFns.forEach(fn => fn?.());
  unsubFns = [];
  disconnectChat();
  document.getElementById('fv-chat-host')?.remove();
}
