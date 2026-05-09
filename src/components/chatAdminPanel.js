// ── PAINEL ADMIN DO CHAT ─────────────────────────────────────
// Visivel SOMENTE em Configuracoes E-commerce → aba 'Chat (Admin)'.
// Lista TODAS as salas (inclusive DMs alheios) e permite ver
// historico completo. Admin pode usar pra moderar conteudo.
import { S } from '../state.js';
import { GET } from '../services/api.js';

let allRooms = [];
let activeId = null;
let messages = [];

function esc(s) {
  return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function nick(name, unit) { return `${name||'?'} • ${unit||'Geral'}`; }
function fmtDate(d) {
  try {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  } catch { return ''; }
}

async function loadRooms() {
  try {
    allRooms = await GET('/chat/admin/rooms');
    if (!Array.isArray(allRooms)) allRooms = [];
  } catch(e) { allRooms = []; }
}

async function loadMessages(roomId) {
  try {
    messages = await GET('/chat/admin/rooms/'+roomId+'/messages?limit=200');
    if (!Array.isArray(messages)) messages = [];
  } catch(e) { messages = []; }
}

function html() {
  const totalRooms = allRooms.length;
  const totalMsgs = allRooms.reduce((s,r)=>s+(r.msgCount||0), 0);
  const cats = { geral:[], unidade:[], funcao:[], dm:[], custom:[] };
  allRooms.forEach(r => { (cats[r.category] || cats.custom).push(r); });
  const catLabel = { geral:'GERAL', unidade:'POR UNIDADE', funcao:'POR FUNÇÃO', dm:'CONVERSAS DIRETAS', custom:'CUSTOM' };

  const active = allRooms.find(r => r._id === activeId);

  return `
<div class="card" style="margin-bottom:14px;">
  <div class="card-title">💬 Chat — Painel Administrativo
    <span style="font-size:11px;color:var(--muted);font-weight:normal;margin-left:8px;">Visão completa</span>
  </div>
  <div class="g4" style="gap:10px;">
    <div class="mc rose"><div class="mc-label">Salas ativas</div><div class="mc-val">${allRooms.filter(r=>!r.archived).length}</div></div>
    <div class="mc leaf"><div class="mc-label">Salas arquivadas</div><div class="mc-val">${allRooms.filter(r=>r.archived).length}</div></div>
    <div class="mc gold"><div class="mc-label">Mensagens (total)</div><div class="mc-val">${totalMsgs}</div></div>
    <div class="mc purple"><div class="mc-label">DMs ativos</div><div class="mc-val">${cats.dm.length}</div></div>
  </div>
</div>

<div style="display:grid;grid-template-columns:280px 1fr;gap:14px;min-height:500px;">
  <!-- Lista de salas -->
  <div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:10px 12px;border-bottom:1px solid var(--border);font-weight:700;font-size:12px;background:#FAFAFA;">
      📋 Todas as salas (${totalRooms})
    </div>
    <div style="max-height:560px;overflow-y:auto;">
      ${Object.entries(cats).map(([k, list]) => {
        if (!list.length) return '';
        return `
          <div style="padding:8px 12px 4px;font-size:9px;font-weight:700;color:#9CA3AF;letter-spacing:1px;background:#FAFAFA;">${catLabel[k]}</div>
          ${list.map(r => {
            const sel = r._id === activeId;
            return `
              <button class="ec-chat-room-btn" data-room="${r._id}" style="
                width:100%;text-align:left;padding:8px 12px;border:none;cursor:pointer;
                background:${sel?'#FDF2F1':'transparent'};color:#1F2937;
                border-left:3px solid ${sel?'#C8736A':'transparent'};
                border-bottom:1px solid #F3F4F6;
              ">
                <div style="font-weight:600;font-size:12px;display:flex;justify-content:space-between;">
                  <span>${esc(r.name)}</span>
                  ${r.archived ? '<span style="background:#9CA3AF;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px;">ARQ</span>' : ''}
                </div>
                <div style="font-size:10px;color:#6B7280;margin-top:2px;">
                  ${r.msgCount||0} msg${r.msgCount===1?'':'s'} ${r.lastMessage ? '· última: '+fmtDate(r.lastMessage.createdAt) : ''}
                </div>
              </button>
            `;
          }).join('')}
        `;
      }).join('')}
    </div>
  </div>

  <!-- Mensagens da sala selecionada -->
  <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;">
    ${active ? `
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);background:#FAFAFA;">
        <div style="font-weight:700;font-size:13px;">${esc(active.name)}</div>
        <div style="font-size:10px;color:#6B7280;">Categoria: ${active.category} · Tipo: ${active.type} ${active.archived ? '· ARQUIVADA' : ''}</div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 14px;background:#FBFBFB;display:flex;flex-direction:column;gap:8px;max-height:520px;">
        ${messages.length === 0 ? `
          <div style="text-align:center;color:#9CA3AF;padding:30px;font-size:12px;">Sem mensagens nesta sala.</div>
        ` : messages.map(m => `
          <div style="background:${m.system?'#EFF6FF':(m.urgent?'#FEE2E2':'#fff')};border-left:3px solid ${m.system?'#3B82F6':(m.urgent?'#DC2626':'#E5E7EB')};border-radius:6px;padding:7px 10px;${m.resolved?'opacity:.7;':''}">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px;">
              <div style="font-size:11px;font-weight:700;color:${m.system?'#1E40AF':'#1F2937'};">
                ${m.system ? '🤖 Sistema' : esc(nick(m.userName, m.userUnit))}
                ${m.urgent ? '<span style="background:#DC2626;color:#fff;font-size:8px;padding:1px 5px;border-radius:3px;margin-left:4px;">URGENTE</span>' : ''}
                ${m.pinned ? '<span style="font-size:9px;color:#D97706;margin-left:4px;">📌</span>' : ''}
              </div>
              <div style="font-size:9px;color:#9CA3AF;">${fmtDate(m.createdAt)}</div>
            </div>
            ${m.text ? `<div style="font-size:13px;color:#1F2937;margin-top:3px;white-space:pre-wrap;">${esc(m.text)}</div>` : ''}
            ${(m.attachments||[]).filter(a=>a.type==='image').map(a => `
              <div style="margin-top:5px;"><img src="${a.url}" style="max-width:180px;max-height:180px;border-radius:6px;border:1px solid #E5E7EB;cursor:pointer;" onclick="window.open('${a.url}','_blank')"/></div>
            `).join('')}
            ${m.resolved ? `<div style="margin-top:4px;font-size:10px;color:#065F46;">✅ Resolvido por ${esc(nick(m.resolvedByName, m.resolvedByUnit))}</div>` : ''}
            ${(m.reads||[]).length > 0 ? `<div style="margin-top:3px;font-size:9px;color:#9CA3AF;">✔✔ Lida por ${(m.reads||[]).length} pessoa(s)</div>` : ''}
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:13px;">
        Selecione uma sala à esquerda para ver as mensagens
      </div>
    `}
  </div>
</div>

<div style="margin-top:10px;padding:8px 12px;background:#FFFBEB;border:1px solid #FCD34D;border-radius:6px;font-size:11px;color:#92400E;">
  ℹ️ Este painel é exclusivo do administrador. Você vê <strong>todas as salas e DMs</strong>.
  Use com responsabilidade — colaboradores não sabem que conversas privadas podem ser auditadas.
</div>
`;
}

function bindEvents(host) {
  host.querySelectorAll('.ec-chat-room-btn').forEach(b => b.onclick = async () => {
    activeId = b.dataset.room;
    await loadMessages(activeId);
    paint(host);
  });
}

function paint(host) {
  host.innerHTML = html();
  bindEvents(host);
}

export async function renderChatAdmin(hostId) {
  const host = document.getElementById(hostId);
  if (!host) return;
  await loadRooms();
  paint(host);
}
