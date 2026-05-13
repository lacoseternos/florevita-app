// ── PAINEL DE CHAT INTERNO ───────────────────────────────────
// Botao flutuante 💬 + panel minimizavel (canto inferior direito)
// com sidebar de salas + thread de mensagens + input.
//
// Carregado por main.js depois do login. Ignora entregadores apenas
// na visibilidade das salas (controlado pelo backend).
import { S } from '../state.js';
import { GET, POST, PUT } from '../services/api.js';
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
let showNewChatModal = false;
let showAvatarPicker = false; // popover do emoji picker do meu avatar
let chatUsers = []; // cache da lista de usuarios pra DM picker
let pendingAttachments = []; // anexos pendentes do input atual
let myAvatarEmoji = '';     // emoji escolhido pelo proprio user (sync com S.user.avatarEmoji)

// Catalogo de emojis pra foto de perfil
const AVATAR_EMOJIS = [
  '🌹','🌸','🌷','🌺','🌻','🌼','💐','🪷','🌿','🍃',
  '😊','😎','🤩','🥰','😇','🤗','🌟','✨','💫','⭐',
  '👩','👨','🧑','👩‍🦱','👨‍🦱','👩‍🦰','👨‍🦰','👱‍♀️','👱‍♂️','🧕',
  '🦊','🐱','🐶','🐰','🐻','🐨','🐼','🦁','🐯','🐸',
  '🍓','🍒','🍑','🥑','🍰','🧁','☕','🍵','🌈','🦋',
];

// Verifica se o user logado eh entregador — entregadores nao tem chat.
function _isEntregador() {
  const cargo = String(S.user?.cargo||'').toLowerCase();
  const role  = String(S.user?.role||'').toLowerCase();
  return cargo === 'entregador' || role === 'entregador';
}

// Avatar do user: emoji escolhido, ou fallback pela inicial do nome
function _avatarOf(user) {
  if (!user) return '👤';
  if (user.avatarEmoji) return user.avatarEmoji;
  if (user.userAvatarEmoji) return user.userAvatarEmoji;
  const name = String(user.name || user.userName || user.nome || '?').trim();
  // Sem emoji: retorna inicial estilizada (renderizada como circulo)
  return name[0]?.toUpperCase() || '?';
}

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
<button id="fv-chat-fab" class="${totalUnread>0?'has-unread':''}" aria-label="Abrir chat" style="
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
  ${totalUnread>0?`<span class="fv-unread-badge" style="position:absolute;top:-2px;right:-2px;background:#DC2626;color:#fff;font-size:10px;min-width:20px;height:20px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;padding:0 5px;">${totalUnread>99?'99+':totalUnread}</span>`:''}
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
      <button id="fv-chat-myavatar" title="Mudar minha foto de perfil" style="
        background:rgba(255,255,255,.22);border:1.5px solid rgba(255,255,255,.35);
        width:32px;height:32px;border-radius:50%;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        font-size:${myAvatarEmoji?'18px':'13px'};font-weight:700;color:#fff;
        padding:0;line-height:1;
      ">${myAvatarEmoji || (S.user?.name||S.user?.nome||'?')[0]?.toUpperCase()||'?'}</button>
      <div style="display:flex;flex-direction:column;gap:1px;">
        <strong style="font-size:13px;line-height:1;">Chat Interno · Laços Eternos</strong>
        <span style="font-size:10px;opacity:.85;line-height:1;">${isConnected()?'🟢 online':'🔴 reconectando…'}</span>
      </div>
    </div>
    <div style="display:flex;gap:6px;">
      <button id="fv-chat-min" title="Minimizar" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:12px;">−</button>
    </div>
  </div>
  ${_renderAvatarPicker()}

  <!-- Body: sidebar + thread -->
  <div style="flex:1;display:flex;min-height:0;">

    <!-- SIDEBAR -->
    <aside style="width:280px;background:#FAFAFA;border-right:1px solid #E5E7EB;overflow-y:auto;flex-shrink:0;">
      ${_renderSidebar()}
    </aside>

    <!-- THREAD -->
    <main style="flex:1;display:flex;flex-direction:column;min-width:0;background:#fff;">
      ${_renderThread()}
    </main>
  </div>
</div>

${_renderNewChatModal()}

<style>
  #fv-chat-fab:hover { transform: scale(1.08); }
  #fv-chat-panel .fv-msg { animation: fvFadeIn .25s ease-out; }
  #fv-chat-panel .fv-room-btn:hover,
  #fv-chat-panel .fv-newdm-btn:hover { background:#FCEEEA !important; }
  @keyframes fvFadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  .fv-toast-chat { animation: fvSlideInRight .3s ease-out, fvToastWiggle 1.2s ease-in-out infinite; }
  @keyframes fvSlideInRight { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
  @keyframes fvToastWiggle {
    0%, 100% { transform: translateX(0) scale(1); }
    20%      { transform: translateX(-2px) scale(1.01); }
    40%      { transform: translateX(2px) scale(1.01); }
    60%      { transform: translateX(-1px) scale(1); }
  }
  /* Animacao de "digitando..." (pontinhos pulsando) */
  .fv-dot-anim { display:inline-block; }
  .fv-dot-anim::after {
    content:'...';
    animation: fvDots 1.4s steps(4, end) infinite;
  }
  @keyframes fvDots {
    0%, 20%   { content:''; }
    40%       { content:'.'; }
    60%       { content:'..'; }
    80%, 100% { content:'...'; }
  }
  /* Botao flutuante: pulsa + balança quando tem mensagem nao lida */
  #fv-chat-fab.has-unread {
    animation: fvFabPulse 1.4s ease-in-out infinite, fvFabShake 2.8s ease-in-out infinite;
    box-shadow: 0 0 0 0 rgba(220,38,38,.7), 0 8px 24px rgba(200,115,106,.4);
  }
  @keyframes fvFabPulse {
    0%   { box-shadow: 0 0 0 0 rgba(220,38,38,.6), 0 8px 24px rgba(200,115,106,.4); }
    70%  { box-shadow: 0 0 0 18px rgba(220,38,38,0), 0 8px 24px rgba(200,115,106,.4); }
    100% { box-shadow: 0 0 0 0 rgba(220,38,38,0),   0 8px 24px rgba(200,115,106,.4); }
  }
  @keyframes fvFabShake {
    0%, 86%, 100% { transform: rotate(0); }
    88%  { transform: rotate(-12deg) scale(1.05); }
    90%  { transform: rotate( 12deg) scale(1.05); }
    92%  { transform: rotate(-10deg) scale(1.05); }
    94%  { transform: rotate( 10deg) scale(1.05); }
    96%  { transform: rotate(-4deg)  scale(1.02); }
    98%  { transform: rotate(0)      scale(1.02); }
  }
  /* Badge vermelho do FAB pulsa */
  #fv-chat-fab.has-unread .fv-unread-badge {
    animation: fvBadgePulse 1s ease-in-out infinite;
  }
  @keyframes fvBadgePulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.18); }
  }
  /* Sala com nao-lida: brilha + sublinha laranja na esquerda */
  #fv-chat-panel .fv-room-btn.has-new {
    animation: fvRoomGlow 1.6s ease-in-out infinite;
    border-left:3px solid #DC2626 !important;
  }
  @keyframes fvRoomGlow {
    0%, 100% { background: #FFF; }
    50%      { background: #FFE9E5; }
  }
  /* Mensagem nova entrando: flash + slide */
  #fv-chat-panel .fv-msg.fv-msg-new {
    animation: fvMsgPop .45s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes fvMsgPop {
    0%   { opacity:0; transform: translateY(10px) scale(.96); background:#FFF4F0; }
    60%  { opacity:1; transform: translateY(-2px) scale(1.02); background:#FFE9E5; }
    100% { opacity:1; transform: translateY(0) scale(1); }
  }
  @media (max-width: 640px) {
    #fv-chat-panel { bottom:0!important; right:0!important; width:100vw!important; height:100vh!important; border-radius:0!important; }
    #fv-chat-panel aside { width:240px!important; }
  }
</style>
`;
}

// Popover de emojis pra escolher como avatar
function _renderAvatarPicker() {
  if (!showAvatarPicker) return '';
  return `
<div id="fv-avatar-overlay" style="
  position:absolute;top:52px;left:14px;z-index:10000;
  background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);
  padding:12px;width:300px;border:1px solid #E5E7EB;
">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <strong style="font-size:12px;color:#1F2937;">Escolha sua foto de perfil</strong>
    <button id="fv-avatar-close" style="background:transparent;border:none;color:#9CA3AF;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">×</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:4px;max-height:220px;overflow-y:auto;">
    ${AVATAR_EMOJIS.map(e => `
      <button class="fv-avatar-emoji" data-emoji="${e}" style="
        background:${e===myAvatarEmoji?'#FDF2F1':'transparent'};
        border:1px solid ${e===myAvatarEmoji?'#C8736A':'transparent'};
        border-radius:6px;width:26px;height:26px;cursor:pointer;
        display:flex;align-items:center;justify-content:center;
        font-size:18px;padding:0;line-height:1;
      ">${e}</button>
    `).join('')}
  </div>
  <button id="fv-avatar-clear" style="
    margin-top:8px;width:100%;padding:6px;font-size:11px;
    background:#F3F4F6;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer;color:#6B7280;
  ">Remover (usar inicial do nome)</button>
</div>
  `;
}

// Formata timestamp curto: "agora", "5min", "2h", "ontem", "dd/mm"
function _shortTime(d) {
  if (!d) return '';
  try {
    const t = new Date(d);
    const diff = (Date.now() - t.getTime()) / 1000;
    if (diff < 60)    return 'agora';
    if (diff < 3600)  return Math.floor(diff/60) + 'min';
    if (diff < 86400) return Math.floor(diff/3600) + 'h';
    if (diff < 172800) return 'ontem';
    return String(t.getDate()).padStart(2,'0') + '/' + String(t.getMonth()+1).padStart(2,'0');
  } catch { return ''; }
}

// Render de um item de sala (avatar + nome + last msg + checks + unread)
function _renderRoomItem(r, opts = {}) {
  const active = r._id === activeRoomId;
  const unread = r.unread || 0;
  const myId = String(S.user?._id || S.user?.id);
  const last = r.lastMessage;
  // Avatar: usuario da DM (se DM) ou icone da sala (se grupo)
  const isDm = r.type === 'dm' || r.category === 'dm';
  const av = opts.avatarEmoji || _avatarOf({
    name: opts.name || r.name,
    avatarEmoji: opts.avatarEmoji,
  });
  const isEmojiAv = !!opts.avatarEmoji || (typeof av === 'string' && av.length > 1);
  const avatarBg = active ? '#C8736A' : (isDm ? '#a85f57' : '#9CA3AF');
  // Preview da ultima mensagem
  let preview = '';
  let checks = '';
  if (last) {
    const txt = last.text || (last.attachments?.length ? '📷 Imagem' : '');
    preview = txt.length > 35 ? txt.slice(0, 35) + '…' : txt;
    // Se EU mandei: mostra checkmarks (✓ enviado, ✓✓ lido)
    if (String(last.userId) === myId) {
      const reads = (last.reads || []).filter(x => String(x.userId) !== myId);
      const seen = reads.length > 0;
      checks = `<span style="font-size:11px;color:${seen?'#22C55E':'#9CA3AF'};font-weight:700;letter-spacing:-3px;margin-right:3px;">${seen?'✓✓':'✓'}</span>`;
    }
  } else if (!isDm) {
    preview = 'Sem mensagens ainda';
  }
  // Indicador "digitando..."
  const typingMap = typingUsers.get(r._id);
  const isTyping = typingMap && typingMap.size > 0;
  if (isTyping) {
    preview = `<span style="color:#10B981;font-style:italic;">digitando<span class="fv-dot-anim">...</span></span>`;
  }
  // Bolinha de online (so DM)
  const otherId = isDm && r.dmPair
    ? r.dmPair.split(':').find(id => id !== myId)
    : null;
  const isOnline = otherId && onlineUsers.has(otherId);
  const onlineDot = isOnline
    ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:#10B981;border:2px solid #fff;"></span>'
    : '';

  const newCls = unread > 0 ? 'has-new' : '';
  return `
<button class="fv-room-btn ${newCls}" data-room-id="${r._id}" data-user-id="${opts.userId||''}" style="
  width:100%;text-align:left;padding:10px 12px;border:none;cursor:pointer;
  background:${active?'#FDF2F1':'transparent'};
  display:flex;align-items:center;gap:10px;
  border-left:3px solid ${active?'#C8736A':'transparent'};
  border-bottom:1px solid #F3F4F6;
  transition:background .12s;
">
  <span style="position:relative;flex-shrink:0;width:38px;height:38px;border-radius:50%;
    background:${isEmojiAv?'#FDF2F1':avatarBg};
    color:#fff;font-size:${isEmojiAv?'20px':'14px'};font-weight:700;
    display:inline-flex;align-items:center;justify-content:center;
    border:1px solid ${isEmojiAv?'#FCE7E2':avatarBg};
  ">${av}${onlineDot}</span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;">
    <span style="display:flex;align-items:center;gap:6px;">
      <span style="flex:1;font-size:13px;font-weight:${unread>0?'700':'600'};color:#1F2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(opts.name || r.name)}</span>
      ${last ? `<span style="font-size:10px;color:#9CA3AF;flex-shrink:0;">${_shortTime(last.createdAt)}</span>` : ''}
    </span>
    <span style="display:flex;align-items:center;gap:2px;">
      ${checks}
      <span style="flex:1;font-size:11px;color:${unread>0?'#1F2937':'#6B7280'};font-weight:${unread>0?'600':'400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${preview}</span>
    </span>
  </span>
  ${unread>0?`<span style="flex-shrink:0;background:#DC2626;color:#fff;font-size:10px;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 5px;font-weight:700;">${unread>9?'9+':unread}</span>`:''}
</button>`;
}

// Mapeia nome de unidade -> chave do bucket (CDLE, NOVO ALEIXO, ALLEGRO)
function _unitBucket(unit) {
  const u = String(unit||'').toLowerCase();
  if (u.includes('cdle') || u.includes('montag') || u === 'montagem') return 'CDLE';
  if (u.includes('aleixo')) return 'NOVO ALEIXO';
  if (u.includes('allegro')) return 'ALLEGRO MALL';
  return null;
}
// Sub-label dentro do bucket CDLE (Montagem ou Vendas/Atendimento)
function _cdleSub(roomName) {
  const n = String(roomName||'').toLowerCase();
  if (n.includes('montag')) return 'Montagem';
  if (n.includes('vendas') || n.includes('atendimento')) return 'Vendas';
  return '';
}

function _renderSidebar() {
  let html = `
<!-- Header da sidebar -->
<div style="padding:8px 10px;border-bottom:1px solid #E5E7EB;display:flex;gap:6px;">
  <button id="fv-chat-new" style="
    flex:1;padding:8px 10px;
    background:linear-gradient(135deg,#C8736A,#a85f57);color:#fff;
    border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:11px;
    display:flex;align-items:center;justify-content:center;gap:4px;
  ">➕ Nova conversa</button>
</div>`;

  if (!rooms.length) {
    html += `<div style="padding:20px 14px;text-align:center;color:#6B7280;font-size:11px;">
      Carregando conversas...
    </div>`;
    return html;
  }

  const myId = String(S.user?._id || S.user?.id);
  const isAdm = _userIsAdm();

  // ── CATEGORIA 1: GERAL ──
  const gerais = rooms.filter(r => r.category === 'geral');
  if (gerais.length) {
    html += `<div style="padding:12px 14px 4px;font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:1.2px;">🌐 GERAL</div>`;
    for (const r of gerais) html += _renderRoomItem(r);
  }

  // ── CATEGORIA 2: POR UNIDADE ──
  // Combina salas de unidade + funcao em 3 buckets: CDLE, NOVO ALEIXO, ALLEGRO
  const buckets = { 'CDLE': [], 'NOVO ALEIXO': [], 'ALLEGRO MALL': [] };
  rooms.forEach(r => {
    if (r.category !== 'unidade' && r.category !== 'funcao') return;
    // Tenta inferir o bucket pelo nome ou autoMembership
    const fromName = _unitBucket(r.name);
    const fromAm = _unitBucket(r.autoMembership?.unidade);
    const fromFn = _unitBucket(r.autoMembership?.funcao);
    const bucket = fromName || fromAm || fromFn;
    if (bucket && buckets[bucket]) buckets[bucket].push(r);
  });
  const hasUnit = Object.values(buckets).some(arr => arr.length);
  if (hasUnit) {
    html += `<div style="padding:14px 14px 4px;font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:1.2px;">🏢 POR UNIDADE</div>`;
    for (const [name, list] of Object.entries(buckets)) {
      if (!list.length) continue;
      // Header da unidade
      html += `<div style="padding:8px 14px 3px;font-size:10px;font-weight:700;color:#C8736A;text-transform:uppercase;border-top:1px solid #F3F4F6;margin-top:2px;">${name}</div>`;
      // CDLE: agrupa por sub-setor (Montagem / Vendas)
      if (name === 'CDLE') {
        const subs = { 'Montagem': [], 'Vendas': [], 'Outros': [] };
        for (const r of list) {
          const sub = _cdleSub(r.name) || 'Outros';
          (subs[sub] || subs['Outros']).push(r);
        }
        for (const [subName, subList] of Object.entries(subs)) {
          if (!subList.length) continue;
          html += `<div style="padding:4px 18px 2px;font-size:9px;font-weight:600;color:#6B7280;font-style:italic;">• ${subName}</div>`;
          for (const r of subList) html += _renderRoomItem(r);
        }
      } else {
        for (const r of list) html += _renderRoomItem(r);
      }
    }
  }

  // ── CATEGORIA 3: INDIVIDUAIS ──
  // Combina DMs existentes (com unread/preview) + todos os usuarios sem DM ainda.
  // Ordena: 1) com mensagens recentes primeiro, 2) sem DM por ordem alfabetica.
  const dms = rooms.filter(r => r.category === 'dm' || r.type === 'dm');
  // Map de userId -> DM (pareamento dmPair: "me:other")
  const dmByUser = new Map();
  for (const r of dms) {
    if (!r.dmPair) continue;
    const otherId = r.dmPair.split(':').find(id => id !== myId);
    if (otherId) dmByUser.set(otherId, r);
  }
  // Filtra admins da lista geral de colabs (admins nao precisam aparecer)
  const colabs = (chatUsers || []).filter(u => {
    const c = String(u.cargo||'').toLowerCase();
    return !c.includes('admin') && !c.includes('administrador');
  });
  // Constroi lista combinada
  const dmRows = [];
  // 1) Colabs COM DM existente — ordena por timestamp da ultima msg (mais recente primeiro)
  const colabsComDm = colabs.filter(u => dmByUser.has(String(u._id)));
  colabsComDm.sort((a, b) => {
    const ra = dmByUser.get(String(a._id));
    const rb = dmByUser.get(String(b._id));
    const ta = ra.lastMessage?.createdAt ? new Date(ra.lastMessage.createdAt).getTime() : 0;
    const tb = rb.lastMessage?.createdAt ? new Date(rb.lastMessage.createdAt).getTime() : 0;
    return tb - ta;
  });
  for (const u of colabsComDm) {
    const r = dmByUser.get(String(u._id));
    dmRows.push(_renderRoomItem(r, { name: u.name, userId: u._id, avatarEmoji: u.avatarEmoji }));
  }
  // 2) Colabs SEM DM ainda — mostra como "clique pra iniciar conversa"
  const colabsSemDm = colabs.filter(u => !dmByUser.has(String(u._id)));
  colabsSemDm.sort((a, b) => String(a.name||'').localeCompare(String(b.name||''), 'pt-BR'));
  for (const u of colabsSemDm) {
    const av = u.avatarEmoji || (u.name||'?')[0].toUpperCase();
    const isEmojiAv = !!u.avatarEmoji;
    const isOnline = onlineUsers.has(String(u._id));
    dmRows.push(`
<button class="fv-newdm-btn" data-user-id="${u._id}" style="
  width:100%;text-align:left;padding:10px 12px;border:none;cursor:pointer;
  background:transparent;color:#1F2937;
  display:flex;align-items:center;gap:10px;
  border-left:3px solid transparent;
  border-bottom:1px solid #F3F4F6;
  transition:background .12s;
">
  <span style="position:relative;flex-shrink:0;width:38px;height:38px;border-radius:50%;
    background:${isEmojiAv?'#FDF2F1':'#9CA3AF'};
    color:#fff;font-size:${isEmojiAv?'20px':'14px'};font-weight:700;
    display:inline-flex;align-items:center;justify-content:center;
    border:1px solid ${isEmojiAv?'#FCE7E2':'#9CA3AF'};
  ">${esc(av)}
    ${isOnline?'<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:#10B981;border:2px solid #fff;"></span>':''}
  </span>
  <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;">
    <span style="font-size:13px;font-weight:500;color:#1F2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(u.name||'?')}</span>
    <span style="font-size:10px;color:#9CA3AF;font-style:italic;">${esc(u.cargo||'Colaborador')} · ${esc(u.unit||'Geral')}</span>
  </span>
</button>`);
  }
  if (dmRows.length) {
    html += `<div style="padding:14px 14px 4px;font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:1.2px;">💬 INDIVIDUAIS</div>`;
    html += dmRows.join('');
  }

  return html;
}

// Modal "Novo chat" — escolhe entre Grupo (predefinido) ou Direct (1:1)
function _renderNewChatModal() {
  if (!showNewChatModal) return '';
  // Salas disponiveis pra entrar (que ainda nao estao na sidebar — todas estao ja, mas
  // mostramos pra ele clicar pra ir direto)
  const grupos = rooms.filter(r => r.type !== 'dm');
  return `
<div id="fv-newchat-overlay" style="
  position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;
  display:flex;align-items:center;justify-content:center;padding:20px;
">
  <div style="background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 25px 70px rgba(0,0,0,.3);">
    <div style="background:linear-gradient(135deg,#C8736A,#a85f57);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;">
      <strong style="font-size:14px;">➕ Novo chat</strong>
      <button id="fv-newchat-close" style="background:rgba(255,255,255,.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:14px;">×</button>
    </div>
    <div style="padding:16px 18px;overflow-y:auto;">
      <!-- Tabs -->
      <div style="display:flex;gap:6px;margin-bottom:14px;">
        <button class="fv-newchat-tab" data-tab="grupo" style="flex:1;padding:8px;border:1px solid #C8736A;background:#FDF2F1;color:#C8736A;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px;">📂 Grupo</button>
        <button class="fv-newchat-tab" data-tab="direct" style="flex:1;padding:8px;border:1px solid #E5E7EB;background:#fff;color:#6B7280;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px;">👤 Conversa direta</button>
      </div>

      <!-- Aba Grupo -->
      <div id="fv-newchat-tab-grupo">
        <div style="font-size:11px;color:#6B7280;margin-bottom:8px;">Escolha um grupo já existente:</div>
        ${_renderGrupoList(grupos, 'unidade', 'POR UNIDADE')}
        ${_renderGrupoList(grupos, 'funcao', 'POR FUNÇÃO')}
        ${_renderGrupoList(grupos, 'geral', 'GERAL')}
      </div>

      <!-- Aba Direct (oculta por default) -->
      <div id="fv-newchat-tab-direct" style="display:none;">
        <div style="font-size:11px;color:#6B7280;margin-bottom:8px;">Escolha alguém para conversar:</div>
        <input type="search" id="fv-newchat-search" placeholder="Buscar pessoa..." style="
          width:100%;padding:8px 10px;border:1px solid #D1D5DB;border-radius:8px;
          font-size:13px;margin-bottom:10px;outline:none;
        "/>
        <div id="fv-newchat-userlist" style="max-height:300px;overflow-y:auto;border:1px solid #E5E7EB;border-radius:8px;">
          ${chatUsers.length === 0 ? '<div style="padding:20px;text-align:center;color:#9CA3AF;font-size:12px;">Carregando colaboradores...</div>' : _renderUserList(chatUsers)}
        </div>
      </div>
    </div>
  </div>
</div>`;
}

function _renderGrupoList(grupos, cat, label) {
  const list = grupos.filter(g => g.category === cat);
  if (!list.length) return '';
  return `
    <div style="font-size:9px;font-weight:700;color:#9CA3AF;letter-spacing:1px;margin:8px 0 4px;">${label}</div>
    ${list.map(g => `
      <button class="fv-newchat-room" data-room-id="${g._id}" style="
        width:100%;text-align:left;padding:9px 12px;margin-bottom:4px;
        background:#FAFAFA;border:1px solid #E5E7EB;border-radius:6px;cursor:pointer;
        display:flex;justify-content:space-between;align-items:center;font-size:12px;
      ">
        <span style="font-weight:600;">${esc(g.name)}</span>
        <span style="color:#9CA3AF;font-size:10px;">→</span>
      </button>
    `).join('')}
  `;
}

function _renderUserList(users) {
  if (!users.length) return '<div style="padding:20px;text-align:center;color:#9CA3AF;font-size:12px;">Nenhum colaborador encontrado.</div>';
  return users.map(u => {
    const isOnline = onlineUsers.has(String(u._id));
    const av = _avatarOf(u);
    const isEmojiAv = !!u.avatarEmoji;
    return `
      <button class="fv-newchat-user" data-user-id="${u._id}" data-user-name="${esc(u.name)}" style="
        width:100%;text-align:left;padding:9px 12px;
        background:#fff;border:none;border-bottom:1px solid #F3F4F6;cursor:pointer;
        display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:12px;
      ">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
          <span style="
            flex-shrink:0;width:34px;height:34px;border-radius:50%;
            background:${isEmojiAv?'#FDF2F1':'#C8736A'};
            color:#fff;font-size:${isEmojiAv?'20px':'13px'};font-weight:700;
            display:inline-flex;align-items:center;justify-content:center;
            border:1px solid ${isEmojiAv?'#FCE7E2':'#a85f57'};position:relative;
          ">
            ${av}
            <span style="position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;background:${isOnline?'#10B981':'#9CA3AF'};border:2px solid #fff;"></span>
          </span>
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;color:#1F2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${esc(u.name)} <span style="color:#9CA3AF;font-weight:400;">• ${esc(u.unit||'Geral')}</span>
            </div>
            <div style="font-size:10px;color:#9CA3AF;">${esc(u.cargo||'-')}</div>
          </div>
        </div>
        <span style="color:#C8736A;flex-shrink:0;">→</span>
      </button>
    `;
  }).join('');
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

<!-- Anexos pendentes (imagens prontas pra enviar) -->
${pendingAttachments.length > 0 ? `
<div style="padding:6px 12px;background:#FFF7F4;border-top:1px solid #FCE7E2;display:flex;gap:6px;flex-wrap:wrap;">
  ${pendingAttachments.map((a, i) => `
    <div style="position:relative;">
      <img src="${a.url}" style="height:48px;width:48px;object-fit:cover;border-radius:6px;border:1px solid #E5E7EB;"/>
      <button class="fv-att-remove" data-idx="${i}" style="position:absolute;top:-6px;right:-6px;background:#DC2626;color:#fff;border:none;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:11px;line-height:1;">×</button>
    </div>
  `).join('')}
</div>
` : ''}

<!-- Input -->
<div style="padding:8px 12px 10px;border-top:1px solid #E5E7EB;background:#fff;">
  <div style="display:flex;gap:6px;align-items:flex-end;">
    <button id="fv-chat-attach" title="Anexar imagem" style="
      background:#F3F4F6;border:1px solid #D1D5DB;color:#6B7280;
      width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:16px;
      flex-shrink:0;
    ">📎</button>
    <input type="file" id="fv-chat-file" accept="image/*" style="display:none;"/>
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
    Enter envia · Shift+Enter quebra linha · 📎 anexar imagem
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

  // Avatar do autor da msg: emoji escolhido, ou inicial estilizada
  const av = m.system ? '🤖' : _avatarOf({ name: m.userName, avatarEmoji: m.userAvatarEmoji });
  const isEmojiAv = m.system || (m.userAvatarEmoji && m.userAvatarEmoji.length > 0);
  const avatarHtml = `<span style="
    flex-shrink:0;width:26px;height:26px;border-radius:50%;
    background:${isEmojiAv ? 'transparent' : '#C8736A'};
    color:#fff;font-size:${isEmojiAv?'18px':'12px'};font-weight:700;
    display:inline-flex;align-items:center;justify-content:center;
    border:${isEmojiAv?'none':'1px solid #a85f57'};
  ">${av}</span>`;
  const pendingTag = m._pending ? '<span style="margin-left:6px;font-size:9px;color:#9CA3AF;">enviando…</span>' : '';

  return `
<div class="fv-msg" data-msg-id="${m._id}" style="
  background:${sysBg};border-left:3px solid ${sysBorder};
  border-radius:6px;padding:7px 10px;
  ${m.resolved ? 'opacity:.65;' : ''}
  ${m._pending ? 'opacity:.6;' : ''}
">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:2px;">
    <div style="display:flex;align-items:center;gap:6px;min-width:0;">
      ${avatarHtml}
      <div style="font-size:11px;font-weight:700;color:${m.system?'#1E40AF':'#1F2937'};overflow:hidden;text-overflow:ellipsis;">
        ${m.system ? '🤖 Sistema' : esc(nick(m.userName, m.userUnit))}
        ${m.urgent ? '<span style="background:#DC2626;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px;margin-left:4px;">URGENTE</span>' : ''}
        ${m.pinned ? '<span style="font-size:9px;color:#D97706;margin-left:4px;">📌 Fixada</span>' : ''}
        ${pendingTag}
      </div>
    </div>
    <div style="font-size:9px;color:#9CA3AF;white-space:nowrap;">${fmtTime(m.createdAt)}</div>
  </div>
  ${m.text ? `<div style="font-size:13px;color:#1F2937;white-space:pre-wrap;word-break:break-word;">${esc(m.text)}</div>` : ''}
  ${(m.attachments||[]).filter(a => a.type === 'image').map(a => `
    <div style="margin-top:6px;">
      <img src="${a.url}" alt="${esc(a.name||'imagem')}" style="max-width:240px;max-height:240px;border-radius:8px;border:1px solid #E5E7EB;cursor:pointer;display:block;" onclick="window.open('${a.url}','_blank')"/>
    </div>
  `).join('')}
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

// Toast lateral de nova mensagem — slide-in no canto superior direito,
// auto-close em 15s. Click abre o panel na sala da mensagem.
function _showChatToast(msg) {
  // Container fixo no canto superior direito (acumula toasts)
  let stack = document.getElementById('fv-chat-toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'fv-chat-toast-stack';
    stack.style.cssText = 'position:fixed;top:80px;right:20px;z-index:9997;display:flex;flex-direction:column;gap:8px;max-width:340px;';
    document.body.appendChild(stack);
  }
  const room = rooms.find(r => r._id === msg.roomId);
  const roomLabel = room ? room.name : 'Chat';
  const sender = msg.system ? '🤖 Sistema' : nick(msg.userName, msg.userUnit);
  const preview = msg.text
    ? (msg.text.length > 90 ? msg.text.slice(0, 90) + '…' : msg.text)
    : (msg.attachments?.length ? '📷 Imagem' : '');

  const toast = document.createElement('div');
  toast.className = 'fv-toast-chat';
  toast.style.cssText = `
    background:#fff;border-left:4px solid #C8736A;border-radius:8px;
    padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.15);
    cursor:pointer;font-family:inherit;font-size:12px;
    border:1px solid #E5E7EB;border-left:4px solid #C8736A;
    min-width:240px;
  `;
  toast.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start;gap:6px;">
      <div style="flex:1;overflow:hidden;">
        <div style="font-weight:700;color:#C8736A;font-size:10px;letter-spacing:.5px;">💬 ${esc(roomLabel)}</div>
        <div style="font-weight:600;color:#1F2937;margin-top:3px;">${esc(sender)}</div>
        <div style="color:#4B5563;margin-top:2px;line-height:1.3;">${esc(preview)}</div>
      </div>
      <button class="fv-toast-close" style="background:transparent;border:none;color:#9CA3AF;cursor:pointer;font-size:16px;line-height:1;padding:0;">×</button>
    </div>
  `;
  toast.onclick = (e) => {
    if (e.target.classList.contains('fv-toast-close')) {
      toast.remove(); return;
    }
    openPanel = true;
    _selectRoom(msg.roomId);
    toast.remove();
  };
  stack.appendChild(toast);

  // Auto-fecha em 15s
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'fvSlideInRight .25s reverse';
      setTimeout(() => toast.remove(), 250);
    }
  }, 15000);
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

  // Avatar do user — abre picker
  document.getElementById('fv-chat-myavatar')?.addEventListener('click', (e) => {
    e.stopPropagation();
    showAvatarPicker = !showAvatarPicker;
    _paint();
  });
  document.getElementById('fv-avatar-close')?.addEventListener('click', () => {
    showAvatarPicker = false; _paint();
  });
  document.querySelectorAll('.fv-avatar-emoji').forEach(b => {
    b.addEventListener('click', () => _saveAvatar(b.dataset.emoji));
  });
  document.getElementById('fv-avatar-clear')?.addEventListener('click', () => _saveAvatar(''));

  document.querySelectorAll('.fv-room-btn').forEach(btn => {
    btn.addEventListener('click', () => _selectRoom(btn.dataset.roomId));
  });

  // Click em colab SEM DM ainda — cria DM direto na hora
  document.querySelectorAll('.fv-newdm-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.userId;
      if (!uid) return;
      try {
        const room = await POST('/chat/rooms/dm', { withUserId: uid });
        // Adiciona/atualiza na lista local
        if (!rooms.some(r => r._id === room._id)) rooms.unshift({ ...room, unread: 0 });
        _selectRoom(room._id);
      } catch(e) {
        console.warn('[chat] open DM falhou:', e.message);
        alert('Erro ao abrir conversa: ' + e.message);
      }
    });
  });

  // Novo chat — abre modal
  document.getElementById('fv-chat-new')?.addEventListener('click', async () => {
    showNewChatModal = true;
    if (chatUsers.length === 0) {
      try { chatUsers = await GET('/chat/users'); } catch(e) { chatUsers = []; }
    }
    _paint();
  });
  document.getElementById('fv-newchat-close')?.addEventListener('click', () => {
    showNewChatModal = false; _paint();
  });
  document.getElementById('fv-newchat-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'fv-newchat-overlay') { showNewChatModal = false; _paint(); }
  });
  // Tabs do modal
  document.querySelectorAll('.fv-newchat-tab').forEach(b => b.onclick = () => {
    const tab = b.dataset.tab;
    document.querySelectorAll('.fv-newchat-tab').forEach(x => {
      const active = x.dataset.tab === tab;
      x.style.background = active ? '#FDF2F1' : '#fff';
      x.style.borderColor = active ? '#C8736A' : '#E5E7EB';
      x.style.color = active ? '#C8736A' : '#6B7280';
    });
    document.getElementById('fv-newchat-tab-grupo').style.display = tab === 'grupo' ? 'block' : 'none';
    document.getElementById('fv-newchat-tab-direct').style.display = tab === 'direct' ? 'block' : 'none';
  });
  // Click numa sala do modal -> seleciona e fecha
  document.querySelectorAll('.fv-newchat-room').forEach(b => b.onclick = () => {
    showNewChatModal = false;
    _selectRoom(b.dataset.roomId);
  });
  // Click num user -> abre/cria DM
  document.querySelectorAll('.fv-newchat-user').forEach(b => b.onclick = async () => {
    try {
      const room = await POST('/chat/rooms/dm', { withUserId: b.dataset.userId });
      showNewChatModal = false;
      // Adiciona/atualiza na lista local
      if (!rooms.some(r => r._id === room._id)) rooms.unshift({ ...room, unread: 0 });
      _selectRoom(room._id);
    } catch(e) { alert('Erro ao abrir conversa: ' + e.message); }
  });
  // Filtro do search no modal
  document.getElementById('fv-newchat-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const filtered = q
      ? chatUsers.filter(u => (u.name||'').toLowerCase().includes(q) ||
                              (u.unit||'').toLowerCase().includes(q) ||
                              (u.cargo||'').toLowerCase().includes(q))
      : chatUsers;
    const list = document.getElementById('fv-newchat-userlist');
    if (list) {
      list.innerHTML = _renderUserList(filtered);
      list.querySelectorAll('.fv-newchat-user').forEach(b => b.onclick = async () => {
        try {
          const room = await POST('/chat/rooms/dm', { withUserId: b.dataset.userId });
          showNewChatModal = false;
          if (!rooms.some(r => r._id === room._id)) rooms.unshift({ ...room, unread: 0 });
          _selectRoom(room._id);
        } catch(err) { alert('Erro: ' + err.message); }
      });
    }
  });

  // Anexo de imagem
  document.getElementById('fv-chat-attach')?.addEventListener('click', () => {
    document.getElementById('fv-chat-file')?.click();
  });
  document.getElementById('fv-chat-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Apenas imagens.'); return; }
    if (file.size > 5 * 1024 * 1024) { alert('Imagem muito grande (máx 5MB).'); return; }
    // Converte pra base64 (data URL)
    const reader = new FileReader();
    reader.onload = () => {
      pendingAttachments.push({ type:'image', url: reader.result, name: file.name, size: file.size });
      _paint();
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // reset
  });
  // Remover anexo pendente
  document.querySelectorAll('.fv-att-remove').forEach(b => b.onclick = () => {
    const idx = parseInt(b.dataset.idx);
    pendingAttachments.splice(idx, 1);
    _paint();
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

// Salva o emoji escolhido no backend e atualiza local
async function _saveAvatar(emoji) {
  myAvatarEmoji = emoji || '';
  if (S.user) S.user.avatarEmoji = myAvatarEmoji;
  showAvatarPicker = false;
  _paint();
  try {
    const uid = S.user?._id || S.user?.id;
    if (!uid) return;
    await PUT('/users/' + uid, { avatarEmoji: myAvatarEmoji });
    // Persiste localmente pra carregar rapido na proxima sessao
    try { localStorage.setItem('fv2_avatar_emoji', myAvatarEmoji); } catch(_) {}
  } catch (e) {
    console.warn('[chat] saveAvatar falhou', e?.message);
  }
}

// UI OTIMISTA: empurra mensagem na lista AGORA com flag _pending,
// e o echo do socket vem depois substituir pelo registro real (pelo clientMsgId).
async function _sendCurrent() {
  const input = document.getElementById('fv-chat-input');
  const text = (input?.value || '').trim();
  if (!activeRoomId) return;
  if (!text && pendingAttachments.length === 0) return;

  const roomId = activeRoomId;
  const clientMsgId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const attachmentsCopy = pendingAttachments.slice();
  const optimistic = {
    _id: clientMsgId,
    clientMsgId,
    _pending: true,
    roomId,
    userId: String(S.user?._id || S.user?.id),
    userName: S.user?.name || S.user?.nome || '',
    userUnit: S.user?.unit || S.user?.unidade || 'Geral',
    userCargo: S.user?.cargo || '',
    userAvatarEmoji: myAvatarEmoji || '',
    text,
    attachments: attachmentsCopy,
    createdAt: new Date().toISOString(),
    reads: [],
  };
  messages.push(optimistic);
  if (input) { input.value = ''; input.style.height = 'auto'; }
  pendingAttachments = [];
  typing(roomId, false);
  _paint();
  // Scroll pro fim imediato
  setTimeout(() => {
    const wrap = document.getElementById('fv-chat-msgs');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }, 10);

  try {
    const real = await sendMessage({
      roomId,
      text,
      attachments: attachmentsCopy,
      clientMsgId,
    });
    // Substitui a otimista pela real (caso o echo do socket nao tenha chego ainda)
    if (real && real._id) {
      const idx = messages.findIndex(m => m._id === clientMsgId);
      if (idx >= 0) {
        messages[idx] = { ...real, _pending: false };
        _paint();
      }
    }
  } catch (e) {
    // Falhou: marca a otimista como erro
    const idx = messages.findIndex(m => m._id === clientMsgId);
    if (idx >= 0) {
      messages[idx] = { ...messages[idx], _pending: false, _failed: true };
      _paint();
    }
    console.warn('[chat] send falhou:', e?.message);
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
  // ENTREGADORES NAO TEM CHAT INTERNO — sai antes de conectar socket.
  if (_isEntregador()) return;
  mounted = true;
  // Carrega avatar emoji salvo (S.user.avatarEmoji vem do /auth/validate;
  // localStorage eh fallback p/ render imediato antes da conexao)
  myAvatarEmoji = S.user.avatarEmoji
    || (() => { try { return localStorage.getItem('fv2_avatar_emoji') || ''; } catch { return ''; } })();
  // Conecta socket
  connectChat();
  // Listeners de eventos do socket
  unsubFns.push(on('connected', () => _paint()));
  unsubFns.push(on('disconnected', () => _paint()));
  unsubFns.push(on('chat:message', (msg) => {
    const myId = String(S.user?._id || S.user?.id);
    const isMine = String(msg.userId) === myId;
    const isCurrentRoom = msg.roomId === activeRoomId;
    const panelOpenAndOnRoom = openPanel && isCurrentRoom;

    // SEMPRE atualiza lastMessage no sidebar (mesmo se for a sala ativa)
    rooms = rooms.map(r => r._id === msg.roomId
      ? { ...r,
          lastMessage: msg,
          unread: (isCurrentRoom || isMine) ? r.unread : (r.unread||0) + 1
        }
      : r);

    if (isCurrentRoom) {
      // Reconcilia mensagem otimista (mesmo clientMsgId)
      let reconciled = false;
      if (msg.clientMsgId) {
        const idx = messages.findIndex(m => m._id === msg.clientMsgId || m.clientMsgId === msg.clientMsgId);
        if (idx >= 0) { messages[idx] = { ...msg, _pending: false }; reconciled = true; }
      }
      if (!reconciled && !messages.some(m => String(m._id) === String(msg._id))) {
        messages.push(msg);
      }
      _paint();
      // Anima entrada da mensagem mais recente (so se nao for minha)
      if (!isMine) {
        setTimeout(() => {
          const node = document.querySelector(`[data-msg-id="${msg._id}"]`);
          if (node) {
            node.classList.add('fv-msg-new');
            setTimeout(() => node.classList.remove('fv-msg-new'), 600);
          }
        }, 20);
        markRead([msg._id]);
      }
      setTimeout(() => {
        const wrap = document.getElementById('fv-chat-msgs');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      }, 30);
    } else {
      _paint();
    }

    // ── NOTIFICACAO LATERAL (toast 15s) ──
    // Mostra quando:
    //   - Mensagem nao eh minha
    //   - Painel fechado OU sala diferente da ativa
    // Se o painel ta aberto na sala ativa, ja viu a mensagem entrar.
    if (!isMine && !panelOpenAndOnRoom) {
      _showChatToast(msg);
    }
  }));
  unsubFns.push(on('chat:read', ({ messageId, reader }) => {
    messages = messages.map(m => {
      if (String(m._id) !== String(messageId)) return m;
      if ((m.reads||[]).some(r => String(r.userId) === String(reader.userId))) return m;
      return { ...m, reads: [...(m.reads||[]), reader] };
    });
    // Tambem atualiza lastMessage da sala (pra checkmark ✓✓ no sidebar)
    rooms = rooms.map(r => {
      if (!r.lastMessage || String(r.lastMessage._id) !== String(messageId)) return r;
      const existing = (r.lastMessage.reads || []).some(x => String(x.userId) === String(reader.userId));
      if (existing) return r;
      return { ...r, lastMessage: { ...r.lastMessage, reads: [...(r.lastMessage.reads||[]), reader] } };
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
  // Carrega salas + lista de colaboradoras em paralelo (pra sidebar individuais)
  await Promise.all([
    _loadRooms(),
    GET('/chat/users').then(u => { chatUsers = Array.isArray(u) ? u : []; }).catch(()=>{}),
  ]);
  _paint();
  // Sincroniza presence quando websocket reconecta + re-puxa lista de colabs
  // periodicamente (caso alguem novo seja cadastrada)
  setInterval(() => {
    GET('/chat/users').then(u => {
      if (Array.isArray(u) && u.length !== chatUsers.length) {
        chatUsers = u;
        _paint();
      } else if (Array.isArray(u)) {
        chatUsers = u;
      }
    }).catch(()=>{});
  }, 60000);
}

export function shutdownChat() {
  if (!mounted) return;
  mounted = false;
  unsubFns.forEach(fn => fn?.());
  unsubFns = [];
  disconnectChat();
  document.getElementById('fv-chat-host')?.remove();
}
