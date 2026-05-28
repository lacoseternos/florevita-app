// ── Instagram DMs — UI moderna estilo WhatsApp Web ──────────
// Layout 3 colunas: lista de conversas | thread | (opcional) info
// Marcia (27/mai/2026) pediu interface simples e moderna pra equipe
// responder DMs do Instagram sem sair do sistema.
import { S } from '../state.js';
import { GET, POST, PATCH } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { esc, ini } from '../utils/formatters.js';

const IG_STATE = (S._ig = S._ig || {
  conversations: [],
  activeId: null,
  activeConv: null,
  activeMessages: [],
  loading: false,
  search: '',
  status: 'open',     // open | archived | spam
  configChecked: false,
  configured: false,
});

// ─── DATA FETCH ────────────────────────────────────────────
async function loadConfig() {
  try {
    const cfg = await GET('/instagram/config');
    IG_STATE.configured = !!(cfg.active && cfg.hasAccessToken && cfg.igBusinessId);
    IG_STATE.cfgInfo = cfg;
  } catch { IG_STATE.configured = false; }
  IG_STATE.configChecked = true;
}

async function loadConversations() {
  try {
    const list = await GET(`/instagram/conversations?status=${IG_STATE.status}&q=${encodeURIComponent(IG_STATE.search)}`);
    IG_STATE.conversations = Array.isArray(list) ? list : [];
  } catch (e) {
    IG_STATE.conversations = [];
  }
}

async function loadConversation(id) {
  IG_STATE.loading = true;
  try {
    const data = await GET(`/instagram/conversations/${id}`);
    IG_STATE.activeConv = data.conversation;
    IG_STATE.activeMessages = data.messages || [];
    IG_STATE.activeId = id;
    // Marca como lido
    if (data.conversation.unreadCount > 0) {
      await POST(`/instagram/conversations/${id}/read`, {}).catch(()=>{});
      // Atualiza local
      const c = IG_STATE.conversations.find(x => x._id === id);
      if (c) c.unreadCount = 0;
    }
  } catch (e) {
    toast('Erro ao carregar conversa: ' + e.message, true);
  }
  IG_STATE.loading = false;
}

async function sendReply(text) {
  if (!IG_STATE.activeId || !text.trim()) return;
  try {
    const r = await POST('/instagram/send', { conversationId: IG_STATE.activeId, text: text.trim() });
    if (r?.message) {
      IG_STATE.activeMessages.push(r.message);
      // Refresh sidebar
      const c = IG_STATE.conversations.find(x => x._id === IG_STATE.activeId);
      if (c) {
        c.lastMessagePreview = text.slice(0, 120);
        c.lastMessageAt = new Date().toISOString();
        c.lastMessageFrom = 'us';
      }
    }
  } catch (e) {
    toast('❌ ' + (e.message || 'Erro ao enviar'), true);
  }
}

// ─── RENDER HELPERS ────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diff = (now - d) / (24*60*60*1000);
  if (diff < 7) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function avatar(conv) {
  if (conv?.profilePic) {
    return `<img src="${esc(conv.profilePic)}" loading="lazy" style="width:42px;height:42px;border-radius:50%;object-fit:cover;background:#E5E7EB;" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"/>
      <div style="display:none;width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#E1306C,#833AB4,#F77737);color:#fff;align-items:center;justify-content:center;font-weight:700;font-size:14px;">${ini(conv.igName || conv.igUsername || '?')}</div>`;
  }
  return `<div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#E1306C,#833AB4,#F77737);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">${ini(conv?.igName || conv?.igUsername || '?')}</div>`;
}

// ─── RENDER PRINCIPAL ──────────────────────────────────────

export function renderInstagramDms() {
  // Carrega config + conversas em background na primeira vez
  if (!IG_STATE.configChecked) {
    loadConfig().then(() => loadConversations()).then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }

  // Modo nao configurado — mostra wizard
  if (IG_STATE.configChecked && !IG_STATE.configured) {
    return renderConfigEmpty();
  }

  return `
<div style="display:grid;grid-template-columns:340px 1fr;gap:0;height:calc(100vh - 80px);background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB;">
  <!-- COLUNA 1: Lista de conversas -->
  <div style="display:flex;flex-direction:column;border-right:1px solid #E5E7EB;background:#FAFAFA;">
    <!-- Header da lista -->
    <div style="padding:14px;border-bottom:1px solid #E5E7EB;background:#fff;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <div style="background:linear-gradient(135deg,#E1306C,#833AB4,#F77737);color:#fff;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;">📷</div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:14px;color:#1F2937;">Instagram DMs</div>
          <div style="font-size:10px;color:#6B7280;">${IG_STATE.cfgInfo?.igUsername ? '@' + IG_STATE.cfgInfo.igUsername : 'Conectado'}</div>
        </div>
        <button onclick="window._igRefresh && window._igRefresh()" title="Atualizar" style="background:#F3F4F6;border:none;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:14px;">🔄</button>
      </div>
      <input id="ig-search" type="text" placeholder="🔍 Buscar conversa..." value="${esc(IG_STATE.search)}"
        style="width:100%;padding:8px 10px;border:1px solid #E5E7EB;border-radius:8px;font-size:12px;background:#F9FAFB;"/>
      <div style="display:flex;gap:4px;margin-top:8px;">
        ${[{k:'open',l:'Abertas'},{k:'archived',l:'Arquivadas'},{k:'spam',l:'Spam'}].map(t =>
          `<button data-ig-status="${t.k}" style="flex:1;padding:5px 8px;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;background:${IG_STATE.status===t.k?'linear-gradient(135deg,#E1306C,#833AB4)':'transparent'};color:${IG_STATE.status===t.k?'#fff':'#6B7280'};">${t.l}</button>`
        ).join('')}
      </div>
    </div>
    <!-- Lista -->
    <div style="flex:1;overflow-y:auto;">
      ${IG_STATE.conversations.length === 0 ? `
        <div style="padding:40px 20px;text-align:center;color:#9CA3AF;">
          <div style="font-size:48px;margin-bottom:12px;opacity:.4;">📭</div>
          <div style="font-size:13px;font-weight:600;color:#6B7280;margin-bottom:4px;">Nenhuma conversa</div>
          <div style="font-size:11px;">Aguardando DMs do Instagram aparecerem aqui...</div>
        </div>
      ` : IG_STATE.conversations.map(c => {
        const active = c._id === IG_STATE.activeId;
        const hasUnread = (c.unreadCount || 0) > 0;
        return `
        <div data-ig-conv="${c._id}" style="display:flex;gap:10px;padding:12px 14px;cursor:pointer;border-bottom:1px solid #F3F4F6;background:${active ? 'linear-gradient(90deg,rgba(225,48,108,.08),transparent)' : (hasUnread ? '#FFFBEB' : '#fff')};border-left:3px solid ${active ? '#E1306C' : 'transparent'};transition:background .12s;">
          ${avatar(c)}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:2px;">
              <div style="font-weight:${hasUnread?'700':'600'};font-size:13px;color:#1F2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(c.igName || c.igUsername || 'Sem nome')}</div>
              <div style="font-size:10px;color:#9CA3AF;white-space:nowrap;flex-shrink:0;">${fmtTime(c.lastMessageAt)}</div>
            </div>
            ${c.igUsername ? `<div style="font-size:10px;color:#9CA3AF;margin-bottom:2px;">@${esc(c.igUsername)}</div>` : ''}
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <div style="font-size:12px;color:${hasUnread?'#1F2937':'#6B7280'};font-weight:${hasUnread?'600':'400'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${c.lastMessageFrom==='us'?'<span style="color:#9CA3AF;">✓ </span>':''}${esc((c.lastMessagePreview || '').slice(0,40))}</div>
              ${hasUnread ? `<span style="background:#E1306C;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:700;flex-shrink:0;">${c.unreadCount}</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>

  <!-- COLUNA 2: Thread -->
  ${IG_STATE.activeId ? renderThread() : renderEmptyThread()}
</div>
  `;
}

function renderEmptyThread() {
  return `
  <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#FDF4FF,#FFF1F2);padding:40px;text-align:center;">
    <div style="font-size:80px;margin-bottom:20px;opacity:.3;">💬</div>
    <div style="font-size:18px;font-weight:700;color:#9D174D;margin-bottom:8px;">Selecione uma conversa</div>
    <div style="font-size:13px;color:#6B7280;max-width:300px;line-height:1.5;">Escolha uma conversa na lista pra ler e responder as mensagens do Instagram da floricultura 🌹</div>
  </div>`;
}

function renderThread() {
  const conv = IG_STATE.activeConv;
  const within24h = conv?.windowExpiresAt && new Date(conv.windowExpiresAt).getTime() > Date.now();
  const expiresMin = conv?.windowExpiresAt
    ? Math.max(0, Math.floor((new Date(conv.windowExpiresAt).getTime() - Date.now()) / 60000))
    : 0;
  return `
  <div style="display:flex;flex-direction:column;height:100%;">
    <!-- Header da conversa -->
    <div style="padding:12px 16px;border-bottom:1px solid #E5E7EB;background:#fff;display:flex;align-items:center;gap:10px;">
      ${avatar(conv)}
      <div style="flex:1;">
        <div style="font-weight:700;font-size:14px;color:#1F2937;">${esc(conv.igName || conv.igUsername || '—')}</div>
        <div style="font-size:11px;color:#9CA3AF;">@${esc(conv.igUsername || '—')} ${within24h ? `· <span style="color:#10B981;">janela ativa ${expiresMin}min</span>` : '· <span style="color:#EF4444;">janela expirada</span>'}</div>
      </div>
      <button data-ig-archive style="background:#F3F4F6;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:11px;color:#6B7280;">📁 Arquivar</button>
    </div>
    <!-- Mensagens -->
    <div id="ig-thread-scroll" style="flex:1;overflow-y:auto;padding:16px;background:linear-gradient(180deg,#FAFAFA,#fff);">
      ${IG_STATE.activeMessages.length === 0 ? `
        <div style="text-align:center;color:#9CA3AF;padding:40px;font-size:12px;">Sem mensagens ainda</div>
      ` : IG_STATE.activeMessages.map(m => renderBubble(m)).join('')}
    </div>
    <!-- Compositor -->
    <div style="border-top:1px solid #E5E7EB;background:#fff;padding:12px;">
      ${!within24h ? `
        <div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:8px 12px;border-radius:8px;font-size:11px;margin-bottom:8px;">
          ⚠️ Janela de 24h expirou. Voce so pode responder apos o cliente enviar uma nova mensagem (regra Meta).
        </div>
      ` : ''}
      <form id="ig-reply-form" style="display:flex;gap:8px;align-items:flex-end;">
        <textarea id="ig-reply-text" placeholder="Escreva sua resposta..." rows="2" ${!within24h?'disabled':''}
          style="flex:1;padding:10px 12px;border:1.5px solid #E5E7EB;border-radius:10px;font-size:13px;resize:none;font-family:inherit;${!within24h?'background:#F3F4F6;cursor:not-allowed;':''}"></textarea>
        <button type="submit" ${!within24h?'disabled':''} style="background:linear-gradient(135deg,#E1306C,#833AB4);color:#fff;border:none;padding:10px 18px;border-radius:10px;font-weight:700;cursor:${within24h?'pointer':'not-allowed'};font-size:13px;${!within24h?'opacity:.4;':''}">Enviar ▶</button>
      </form>
    </div>
  </div>`;
}

function renderBubble(m) {
  const isUs = m.direction === 'out';
  const time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
  const txt = m.type === 'text' || m.type === 'story_reply'
    ? esc(m.text || '')
    : `<em style="opacity:.7;">[${esc(m.type)}]</em>${m.mediaUrl ? `<br/><a href="${esc(m.mediaUrl)}" target="_blank" style="color:#fff;text-decoration:underline;font-size:11px;">📎 ver mídia</a>` : ''}`;
  return `
  <div style="display:flex;justify-content:${isUs?'flex-end':'flex-start'};margin-bottom:8px;">
    <div style="max-width:65%;padding:8px 12px;border-radius:14px;${isUs?'background:linear-gradient(135deg,#E1306C,#833AB4);color:#fff;border-bottom-right-radius:4px;':'background:#fff;color:#1F2937;border:1px solid #E5E7EB;border-bottom-left-radius:4px;'}">
      ${m.type === 'story_reply' ? '<div style="font-size:10px;opacity:.8;margin-bottom:4px;">↩️ Resposta de Story</div>' : ''}
      <div style="font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;">${txt}</div>
      <div style="font-size:9px;opacity:.7;margin-top:3px;text-align:right;">${time}${isUs && m.sentByName ? ' · ' + esc(m.sentByName.split(' ')[0]) : ''}${isUs && m.readByClient ? ' ✓✓' : (isUs ? ' ✓' : '')}</div>
      ${m.error ? `<div style="background:rgba(255,255,255,.2);border-radius:4px;padding:4px 6px;margin-top:4px;font-size:10px;">❌ ${esc(m.error)}</div>` : ''}
    </div>
  </div>`;
}

function renderConfigEmpty() {
  return `
  <div style="display:flex;align-items:center;justify-content:center;min-height:60vh;padding:40px;">
    <div style="background:#fff;border-radius:16px;padding:40px;max-width:560px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.06);border:1px solid #F3F4F6;">
      <div style="width:80px;height:80px;margin:0 auto 20px;background:linear-gradient(135deg,#E1306C,#833AB4,#F77737);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:42px;">📷</div>
      <div style="font-family:'Playfair Display',serif;font-size:24px;color:#1F2937;margin-bottom:8px;">Instagram DMs</div>
      <div style="font-size:14px;color:#6B7280;margin-bottom:24px;line-height:1.5;">Conecte sua conta Instagram Business pra atender mensagens diretas dos clientes sem sair do sistema.</div>
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:12px;margin-bottom:20px;text-align:left;font-size:12px;color:#92400E;">
        <strong>📋 O que voce vai precisar:</strong>
        <ol style="margin:6px 0 0 18px;padding:0;line-height:1.7;">
          <li>Conta <strong>Instagram Business</strong> (nao Pessoal) vinculada a uma Pagina do Facebook</li>
          <li>App em <strong>developers.facebook.com</strong> com permissoes <code>instagram_manage_messages</code></li>
          <li><strong>Page Access Token</strong> de longa duração</li>
          <li><strong>App Secret</strong> e <strong>Verify Token</strong> pra webhook</li>
        </ol>
      </div>
      <a href="#" onclick="event.preventDefault();S.page='config';if(typeof window.render==='function')window.render();" style="display:inline-block;background:linear-gradient(135deg,#E1306C,#833AB4);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;font-size:13px;">⚙️ Configurar agora</a>
      <div style="margin-top:14px;font-size:11px;color:#9CA3AF;">Configurações → Integrações → Instagram</div>
    </div>
  </div>`;
}

// ─── BINDINGS (chamado pelo main.js depois do render) ──────

export function bindInstagramDms() {
  // Refresh global
  window._igRefresh = async () => {
    await loadConversations();
    if (IG_STATE.activeId) await loadConversation(IG_STATE.activeId);
    import('../main.js').then(m => m.render()).catch(()=>{});
  };

  // Click em conversa
  document.querySelectorAll('[data-ig-conv]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.igConv;
      await loadConversation(id);
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  });

  // Toggle status
  document.querySelectorAll('[data-ig-status]').forEach(b => {
    b.addEventListener('click', async () => {
      IG_STATE.status = b.dataset.igStatus;
      IG_STATE.activeId = null;
      await loadConversations();
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  });

  // Search (debounced)
  const inp = document.getElementById('ig-search');
  if (inp) {
    let t;
    inp.addEventListener('input', e => {
      IG_STATE.search = e.target.value;
      clearTimeout(t);
      t = setTimeout(async () => {
        await loadConversations();
        import('../main.js').then(m => m.render()).catch(()=>{});
      }, 300);
    });
  }

  // Reply form
  const form = document.getElementById('ig-reply-form');
  if (form) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const txt = document.getElementById('ig-reply-text')?.value;
      if (!txt?.trim()) return;
      await sendReply(txt);
      const el = document.getElementById('ig-reply-text');
      if (el) el.value = '';
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }

  // Arquivar
  const btnArchive = document.querySelector('[data-ig-archive]');
  if (btnArchive) {
    btnArchive.addEventListener('click', async () => {
      if (!IG_STATE.activeId) return;
      try {
        await PATCH(`/instagram/conversations/${IG_STATE.activeId}`, { status: 'archived' });
        IG_STATE.conversations = IG_STATE.conversations.filter(c => c._id !== IG_STATE.activeId);
        IG_STATE.activeId = null;
        toast('📁 Conversa arquivada');
        import('../main.js').then(m => m.render()).catch(()=>{});
      } catch (e) { toast('Erro: ' + e.message, true); }
    });
  }

  // Auto-scroll do thread pro fim
  const scroll = document.getElementById('ig-thread-scroll');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}
