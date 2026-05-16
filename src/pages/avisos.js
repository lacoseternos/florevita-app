// ── MODULO: AVISOS E COMUNICADOS INTERNOS ─────────────────
// Admin/Gerente: cria/edita/cancela avisos targetados.
// Sistema mostra popup pro usuario quando ele abre o sistema.
import { S, API } from '../state.js';
import { GET, POST, PATCH, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { esc } from '../utils/formatters.js';
import { isAdmin } from '../utils/unidadeRules.js';

// ── Helpers ───────────────────────────────────────────────
// Renderiza markdown LEVE com seguranca (escape HTML primeiro, depois
// reaplica apenas tags permitidas). Suporta:
//   **negrito**   -> <strong>
//   __negrito__   -> <strong>
//   *italico*     -> <em>
//   _italico_     -> <em>
//   ~~tachado~~   -> <s>
//   `codigo`      -> <code>
//   - item lista  -> <li>
//   quebra linha  -> <br>
//   URL           -> <a target=_blank>
// Sanitiza HTML do editor rich-text: permite apenas tags/atributos seguros.
// Remove <script>, on*=, javascript:, etc. Mantem imagens, links, formatacao.
export function sanitizeRichHtml(html) {
  if (!html) return '';
  const ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','S','STRIKE','BR','P','DIV','SPAN','H1','H2','H3','BLOCKQUOTE','UL','OL','LI','A','IMG','FIGURE','FIGCAPTION','HR','CODE','PRE']);
  const ALLOWED_ATTRS = {
    'A':   ['href','target','rel','download','title'],
    'IMG': ['src','alt','title','width','height','style'],
    '*':   ['style'], // style restrito abaixo
  };
  const SAFE_STYLE_PROPS = /^(color|background|background-color|font-weight|font-style|font-size|line-height|letter-spacing|text-decoration|text-align|text-transform|max-width|min-width|width|height|max-height|border|border-radius|border-color|border-width|border-style|padding|margin|display|gap|align-items|justify-content|flex-direction|vertical-align|list-style)$/i;
  const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root');
  if (!root) return '';
  const walk = (node) => {
    const kids = [...node.childNodes];
    for (const child of kids) {
      if (child.nodeType === 1) { // element
        const tag = child.tagName;
        if (!ALLOWED_TAGS.has(tag)) {
          // desembrulha conteudo
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          continue;
        }
        // Limpa atributos
        const allowed = new Set([...(ALLOWED_ATTRS[tag]||[]), ...(ALLOWED_ATTRS['*']||[])]);
        [...child.attributes].forEach(attr => {
          const n = attr.name.toLowerCase();
          if (n.startsWith('on')) { child.removeAttribute(attr.name); return; }
          if (!allowed.has(n)) { child.removeAttribute(attr.name); return; }
          if (n === 'href' || n === 'src') {
            const v = String(attr.value || '').trim().toLowerCase();
            // permite http, https, mailto, tel, data:image
            if (!(v.startsWith('http://') || v.startsWith('https://') || v.startsWith('mailto:') || v.startsWith('tel:') || v.startsWith('data:image/'))) {
              child.removeAttribute(attr.name);
            }
          }
          if (n === 'style') {
            // filtra propriedades perigosas
            const safe = String(attr.value || '').split(';').map(p => p.trim()).filter(p => {
              const k = p.split(':')[0]?.trim();
              return k && SAFE_STYLE_PROPS.test(k);
            }).join('; ');
            if (safe) child.setAttribute('style', safe);
            else child.removeAttribute('style');
          }
        });
        // Garante target=_blank e rel seguro em links
        if (tag === 'A') {
          child.setAttribute('target','_blank');
          child.setAttribute('rel','noopener noreferrer');
        }
        // Imagens: limita estilo
        if (tag === 'IMG') {
          const cur = child.getAttribute('style') || '';
          if (!/max-width/.test(cur)) child.setAttribute('style', (cur + ';max-width:100%;height:auto;border-radius:8px;').replace(/^;/,''));
        }
        walk(child);
      } else if (child.nodeType !== 3) {
        // remove comments etc
        node.removeChild(child);
      }
    }
  };
  walk(root);
  return root.innerHTML;
}

export function formatMensagemRich(text) {
  if (!text) return '';
  const raw = String(text);
  // Detecta HTML (editor rich-text). Caso afirmativo, sanitiza e devolve direto.
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeRichHtml(raw);
  }
  // Fallback: markdown legado de mensagens antigas
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  // 2) Aplica markdown simples (ja escapado)
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,     '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+?)_/g,   '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`([^`]+)`/g, '<code style="background:#F3F4F6;padding:1px 6px;border-radius:4px;font-size:.92em;">$1</code>');
  // 3) Listas: linhas que comecam com "- " viram <li>
  const lines = s.split('\n');
  let html = '';
  let inList = false;
  for (const ln of lines) {
    const m = ln.match(/^\s*-\s+(.*)$/);
    if (m) {
      if (!inList) { html += '<ul style="margin:6px 0;padding-left:20px;">'; inList = true; }
      html += `<li style="margin-bottom:3px;">${m[1]}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += ln + '<br/>';
    }
  }
  if (inList) html += '</ul>';
  // 4) Linkifica URLs
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#1D4ED8;text-decoration:underline;">$1</a>');
  return html;
}

function podeGerenciar() {
  const u = S.user || {};
  if (isAdmin(u)) return true;
  const cargo = String(u.cargo || u.role || '').toLowerCase();
  if (cargo === 'gerente') {
    const mods = u.modulos || {};
    return mods.avisos !== false;
  }
  return false;
}

const PRIORIDADES = {
  baixa:   { label: 'Baixa',   cor: '#6B7280', bg: '#F3F4F6', icon: '💬' },
  media:   { label: 'Média',   cor: '#1E40AF', bg: '#DBEAFE', icon: 'ℹ️' },
  alta:    { label: 'Alta',    cor: '#D97706', bg: '#FEF3C7', icon: '⚠️' },
  urgente: { label: 'Urgente', cor: '#DC2626', bg: '#FEE2E2', icon: '🚨' },
};

const SETORES_OPCOES = [
  'Geral', 'Atendimento', 'Montagem', 'Producao', 'Expedicao',
  'Entregador', 'Gerente', 'Admin', 'Financeiro',
];
const UNIDADES_OPCOES = [
  { value: 'Todas',             label: '🌐 Todas' },
  { value: 'CDLE',              label: '🏭 CDLE' },
  { value: 'Loja Novo Aleixo',  label: '🏪 Novo Aleixo' },
  { value: 'Loja Allegro Mall', label: '🏪 Allegro' },
];

const _statusLabel = (s) => ({
  ativo:     { label: 'Ativo',     bg: '#DCFCE7', fg: '#15803D' },
  agendado:  { label: 'Agendado',  bg: '#FEF3C7', fg: '#92400E' },
  expirado:  { label: 'Expirado',  bg: '#F3F4F6', fg: '#6B7280' },
  cancelado: { label: 'Cancelado', bg: '#FEE2E2', fg: '#991B1B' },
}[s] || { label: s, bg: '#F3F4F6', fg: '#6B7280' });

function _fmtData(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Manaus', dateStyle: 'short', timeStyle: 'short' });
  } catch { return '—'; }
}

// ── Cache de avisos
let _avisosCache = null;
async function loadAvisos(status = '') {
  try {
    const url = status ? `/avisos?status=${status}` : '/avisos';
    const r = await GET(url);
    _avisosCache = Array.isArray(r) ? r : [];
    return _avisosCache;
  } catch (e) {
    toast('Erro ao carregar avisos: ' + (e.message || ''), true);
    return [];
  }
}

// ── RENDER PRINCIPAL ──────────────────────────────────────
export function renderAvisos() {
  if (!podeGerenciar()) {
    return `<div class="empty card">
      <div class="empty-icon">🔒</div>
      <p style="font-weight:600">Acesso restrito</p>
      <p style="font-size:12px;margin-top:4px">Apenas Administrador e Gerente podem gerenciar avisos.</p>
    </div>`;
  }

  // Trigger load
  if (!_avisosCache) {
    loadAvisos(S._avisoTab || '').then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    }).catch(()=>{});
  }

  const aba = S._avisoTab || 'ativo';
  const todos = _avisosCache || [];
  const filtered = todos.filter(a => (a._status || 'ativo') === aba);

  const cnt = (s) => todos.filter(a => (a._status || 'ativo') === s).length;

  return `
<div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
  <span>📣 Avisos e Comunicados Internos</span>
  <button class="btn btn-primary btn-sm" id="btn-novo-aviso">➕ Novo Comunicado</button>
</div>

<div class="tabs" style="margin-bottom:14px;display:flex;gap:6px;flex-wrap:wrap;">
  ${['ativo','agendado','expirado','cancelado'].map(s => {
    const sl = _statusLabel(s);
    const ativo = aba === s;
    return `<button class="tab ${ativo?'active':''}" data-aviso-tab="${s}"
      style="background:${ativo?sl.fg:'transparent'};color:${ativo?'#fff':sl.fg};border:1px solid ${sl.fg};padding:8px 14px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">
      ${sl.label} <span style="background:${ativo?'rgba(255,255,255,.25)':sl.bg};color:${ativo?'#fff':sl.fg};border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;">${cnt(s)}</span>
    </button>`;
  }).join('')}
  <button class="btn btn-ghost btn-sm" id="btn-refresh-avisos" style="margin-left:auto;">🔄 Atualizar</button>
</div>

${filtered.length === 0 ? `
  <div class="empty card">
    <div class="empty-icon">📭</div>
    <p>Nenhum aviso ${_statusLabel(aba).label.toLowerCase()}${aba === 'ativo' ? '' : ''} no momento.</p>
    ${aba === 'ativo' ? `<button class="btn btn-primary btn-sm" id="btn-novo-aviso-2" style="margin-top:10px;">➕ Criar primeiro aviso</button>` : ''}
  </div>
` : `
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;">
  ${filtered.map(a => {
    const p = PRIORIDADES[a.prioridade] || PRIORIDADES.media;
    const total = a._totalLeituras || 0;
    return `
    <div class="card" data-aviso-detail="${a._id}" style="cursor:pointer;border-left:5px solid ${p.cor};transition:all .2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 18px rgba(0,0,0,.1)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">${p.icon}</span>
          <span style="background:${p.bg};color:${p.cor};padding:2px 10px;border-radius:10px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;">${p.label}</span>
        </div>
        <span style="font-size:10px;color:var(--muted);">${_fmtData(a.createdAt)}</span>
      </div>
      <div style="font-weight:700;font-size:15px;color:var(--ink);margin-bottom:6px;line-height:1.3;">${esc(a.titulo)}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(a.mensagem)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;font-size:10px;">
        ${(a.destinatarios?.unidades || []).slice(0,3).map(u => `<span style="background:#EFF6FF;color:#1E40AF;padding:2px 8px;border-radius:10px;font-weight:700;">🏪 ${u}</span>`).join('')}
        ${(a.destinatarios?.setores || []).slice(0,3).map(s => `<span style="background:#F0FDF4;color:#15803D;padding:2px 8px;border-radius:10px;font-weight:700;">👥 ${s}</span>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed var(--border);padding-top:8px;font-size:11px;">
        <span style="color:var(--muted);">📅 ${_fmtData(a.dataDisparo)}${a.dataExpiracao ? ` → ${_fmtData(a.dataExpiracao).split(' ')[0]}` : ''}</span>
        <span style="font-weight:700;color:#1E40AF;">👁 ${total} leitura${total!==1?'s':''}</span>
      </div>
    </div>`;
  }).join('')}
</div>
`}`;
}

// ── MODAL: CRIAR / EDITAR AVISO ───────────────────────────
export function showAvisoModal(aviso = null) {
  const edit = !!aviso;
  const dest = aviso?.destinatarios || { unidades: [], setores: [], usuariosIds: [] };
  const dataDisparo = aviso?.dataDisparo ? new Date(aviso.dataDisparo).toISOString().slice(0, 16) : '';
  const dataExpiracao = aviso?.dataExpiracao ? new Date(aviso.dataExpiracao).toISOString().slice(0, 16) : '';

  S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
    <div class="mo-box" style="max-width:680px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:16px;">
        <div style="font-family:'Playfair Display',serif;font-size:20px;">${edit?'✏️ Editar':'➕ Novo'} Comunicado</div>
        <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">&times;</button>
      </div>

      <!-- Titulo + Prioridade -->
      <div class="fr2" style="margin-bottom:10px;">
        <div class="fg" style="grid-column:span 2;">
          <label class="fl">Título <span style="color:var(--red)">*</span></label>
          <input class="fi" id="av-titulo" maxlength="200" value="${esc(aviso?.titulo||'')}" placeholder="Ex: Reunião amanhã às 9h"/>
        </div>
      </div>

      <div class="fg" style="margin-bottom:10px;">
        <label class="fl">Mensagem <span style="color:var(--red)">*</span></label>
        <div id="av-rte-toolbar" style="display:flex;flex-wrap:wrap;gap:4px;background:#F9FAFB;border:1px solid var(--border);border-bottom:none;border-radius:8px 8px 0 0;padding:6px;">
          <button type="button" class="av-rte-btn" data-cmd="bold" title="Negrito (Ctrl+B)" style="font-weight:900;">B</button>
          <button type="button" class="av-rte-btn" data-cmd="italic" title="Itálico (Ctrl+I)" style="font-style:italic;">I</button>
          <button type="button" class="av-rte-btn" data-cmd="underline" title="Sublinhado (Ctrl+U)" style="text-decoration:underline;">U</button>
          <button type="button" class="av-rte-btn" data-cmd="strikeThrough" title="Tachado" style="text-decoration:line-through;">S</button>
          <span class="av-rte-sep"></span>
          <button type="button" class="av-rte-btn" data-cmd="formatBlock" data-val="H1" title="Título grande" style="font-weight:800;">H1</button>
          <button type="button" class="av-rte-btn" data-cmd="formatBlock" data-val="H2" title="Subtítulo" style="font-weight:700;font-size:12px;">H2</button>
          <button type="button" class="av-rte-btn" data-cmd="formatBlock" data-val="BLOCKQUOTE" title="Citação">❝</button>
          <span class="av-rte-sep"></span>
          <button type="button" class="av-rte-btn" data-cmd="insertUnorderedList" title="Lista">• ≡</button>
          <button type="button" class="av-rte-btn" data-cmd="insertOrderedList" title="Lista numerada">1. ≡</button>
          <span class="av-rte-sep"></span>
          <button type="button" class="av-rte-btn" data-cmd="justifyLeft" title="Alinhar à esquerda">⇤</button>
          <button type="button" class="av-rte-btn" data-cmd="justifyCenter" title="Centralizar">≡</button>
          <button type="button" class="av-rte-btn" data-cmd="justifyRight" title="Alinhar à direita">⇥</button>
          <span class="av-rte-sep"></span>
          <button type="button" class="av-rte-btn" data-cmd="createLink" title="Inserir link">🔗</button>
          <button type="button" class="av-rte-btn" id="av-rte-image" title="Inserir imagem">🖼️</button>
          <button type="button" class="av-rte-btn" data-cmd="removeFormat" title="Limpar formatação">⨉</button>
        </div>
        <div id="av-mensagem" contenteditable="true" class="fi" style="min-height:160px;max-height:340px;overflow-y:auto;border-top-left-radius:0;border-top-right-radius:0;padding:12px;line-height:1.55;font-size:14px;background:#fff;" data-placeholder="Conteúdo completo do comunicado…">${aviso?.mensagem ? formatMensagemRich(aviso.mensagem) : ''}</div>
        <input type="file" id="av-img-file" accept="image/*" style="display:none;"/>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.5;background:#FAFAFA;border:1px dashed #D1D5DB;border-radius:6px;padding:6px 10px;">
          💡 <strong>Dica:</strong> Selecione o texto e use os botões da barra (B = negrito, I = itálico, etc). Para inserir imagens, clique em 🖼️. As imagens vêm com botão de download para quem ler.
        </div>
      </div>
      <style>
        #av-rte-toolbar .av-rte-btn {
          background:#fff; border:1px solid #D1D5DB; border-radius:6px;
          padding:5px 9px; min-width:30px; cursor:pointer; font-size:13px;
          color:#374151; transition:all .15s; line-height:1;
        }
        #av-rte-toolbar .av-rte-btn:hover { background:#EFF6FF; border-color:#3B82F6; color:#1D4ED8; }
        #av-rte-toolbar .av-rte-btn:active,
        #av-rte-toolbar .av-rte-btn.active { background:#DBEAFE; border-color:#1D4ED8; color:#1E3A8A; }
        #av-rte-toolbar .av-rte-sep { width:1px; background:#D1D5DB; margin:0 4px; }
        #av-mensagem:empty:before { content: attr(data-placeholder); color:#9CA3AF; pointer-events:none; }
        #av-mensagem:focus { outline:2px solid var(--rose); outline-offset:-1px; }
        #av-mensagem img { max-width:100%; height:auto; border-radius:8px; display:block; margin:8px 0; }
        #av-mensagem blockquote { border-left:3px solid #D1D5DB; padding:4px 12px; color:#4B5563; font-style:italic; margin:6px 0; }
        #av-mensagem h1 { font-size:22px; font-weight:800; margin:10px 0 6px; }
        #av-mensagem h2 { font-size:17px; font-weight:700; margin:8px 0 4px; }
        #av-mensagem ul, #av-mensagem ol { padding-left:24px; margin:6px 0; }
        #av-mensagem figure { margin:8px 0; }
        #av-mensagem figure .av-img-actions { display:flex; gap:6px; margin-top:4px; }
        #av-mensagem figure a.av-img-dl {
          display:inline-flex; align-items:center; gap:4px;
          background:#1D4ED8; color:#fff; padding:4px 10px;
          border-radius:6px; font-size:11px; font-weight:600;
          text-decoration:none;
        }
      </style>

      <div class="fr2" style="margin-bottom:10px;">
        <div class="fg">
          <label class="fl">Prioridade</label>
          <select class="fi" id="av-prioridade">
            ${Object.entries(PRIORIDADES).map(([k,v]) =>
              `<option value="${k}" ${aviso?.prioridade===k?'selected':''}>${v.icon} ${v.label}</option>`
            ).join('')}
          </select>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Urgentes reaparecem até confirmação de leitura.</div>
        </div>
        <div class="fg">
          <label class="fl">Disparo (data/hora)</label>
          <input class="fi" type="datetime-local" id="av-data-disparo" value="${dataDisparo}"/>
          <div style="font-size:10px;color:var(--muted);margin-top:2px;">Deixe em branco pra disparar AGORA.</div>
        </div>
      </div>

      <div class="fr2" style="margin-bottom:10px;">
        <div class="fg">
          <label class="fl">Expiração (opcional)</label>
          <input class="fi" type="datetime-local" id="av-data-expiracao" value="${dataExpiracao}"/>
        </div>
        <div class="fg" style="display:flex;align-items:flex-end;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;">
            <input type="checkbox" id="av-exigir" ${aviso?.exigirConfirmacao !== false ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;"/>
            Exigir confirmação de leitura
          </label>
        </div>
      </div>

      <!-- Destinatarios -->
      <div style="background:#FAFAFA;border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:10px;">📍 Destinatários</div>

        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Unidades</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
          ${UNIDADES_OPCOES.map(u => {
            const checked = (dest.unidades || []).map(String).includes(u.value);
            return `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 10px;background:${checked?'var(--rose-l)':'#fff'};border:1.5px solid ${checked?'var(--rose)':'#D1D5DB'};border-radius:8px;font-size:12px;font-weight:600;">
              <input type="checkbox" class="av-unidade" value="${u.value}" ${checked?'checked':''}/>
              ${u.label}
            </label>`;
          }).join('')}
        </div>

        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Setores / Cargos</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${SETORES_OPCOES.map(s => {
            const checked = (dest.setores || []).includes(s);
            return `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 10px;background:${checked?'var(--rose-l)':'#fff'};border:1.5px solid ${checked?'var(--rose)':'#D1D5DB'};border-radius:8px;font-size:12px;font-weight:600;">
              <input type="checkbox" class="av-setor" value="${s}" ${checked?'checked':''}/>
              ${s}
            </label>`;
          }).join('')}
        </div>

        <div style="font-size:10px;color:var(--muted);margin-top:10px;line-height:1.5;background:#FEF3C7;border:1px dashed #F59E0B;border-radius:6px;padding:6px 10px;color:#78350F;">
          💡 <strong>Como funciona o filtro:</strong><br>
          • Só <strong>Setor</strong> → atinge todos com aquele cargo (qualquer unidade)<br>
          • Só <strong>Unidade</strong> → atinge todos daquela unidade (qualquer cargo)<br>
          • <strong>Ambos</strong> → atinge SÓ quem combina os 2 (ex: "Atendimento" + "CDLE" = atendentes da CDLE; entregadores NÃO recebem)<br>
          • <strong>Geral</strong> em Setor → atinge TODOS, ignora unidade
        </div>
      </div>

      <!-- Anexos (URL opcional) -->
      <div class="fg" style="margin-bottom:14px;">
        <label class="fl">Link/Anexo (opcional)</label>
        <input class="fi" id="av-anexo-url" value="${esc(aviso?.anexos?.[0]?.url||'')}" placeholder="Ex: https://link.com/documento.pdf"/>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;">URL externa (Google Drive, Dropbox, foto pública, etc).</div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:14px;">
        <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
        <button class="btn btn-blue" id="btn-preview-aviso" type="button">👁️ Pré-visualizar</button>
        <button class="btn btn-primary" id="btn-salvar-aviso" data-id="${aviso?._id||''}">${edit?'💾 Salvar Alterações':'📣 Publicar Comunicado'}</button>
      </div>
    </div>
  </div>`;

  // Trigger render pra injetar o modal no DOM, dai bind
  import('../main.js').then(m => {
    m.render();
    setTimeout(() => bindAvisoModal(), 60);
  }).catch(() => setTimeout(() => bindAvisoModal(), 80));
}

// Comprime imagem via canvas pra base64 JPEG/PNG que caiba no doc Mongo.
// Antes: arquivos de 1-2MB viravam base64 de 2-3MB de chars, ESTOURAVAM o
// maxlength do schema (500k) e a mensagem ficava truncada -> img quebrada.
// Agora: redimensiona pra max 1200px de largura e exporta JPEG q=0.82.
// Resultado tipico: imagem de 2MB -> base64 ~150-300k chars.
function compressImageToBase64(file, opts = {}) {
  const maxWidth = opts.maxWidth || 1200;
  const maxHeight = opts.maxHeight || 1600;
  const quality = opts.quality || 0.82;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        const ratio = Math.min(maxWidth / w, maxHeight / h, 1);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        // Fundo branco pra fotos PNG com transparencia (JPEG nao suporta)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        // JPEG menor que PNG na maioria dos casos
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        // Se ainda passou de 400k chars, recomprime mais agressivamente
        if (dataUrl.length > 400 * 1024) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.65);
        }
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Insere uma <figure> com imagem + botao baixar dentro do editor contenteditable.
// Usa o range/selection corrente; se nao houver, anexa no final.
function inserirImagemNoEditor(editor, src, nome = 'imagem') {
  if (!editor || !src) return;
  const safeName = String(nome).replace(/[^\w.\-]+/g, '_').slice(0, 80) || 'imagem';
  const figureHtml = `<figure contenteditable="false" style="margin:8px 0;">
    <img src="${src}" alt="${safeName}" style="max-width:100%;height:auto;border-radius:8px;display:block;"/>
    <div class="av-img-actions" style="margin-top:4px;"><a class="av-img-dl" href="${src}" download="${safeName}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:4px;background:#1D4ED8;color:#fff;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;">⬇️ Baixar imagem</a></div>
  </figure><p><br/></p>`;
  editor.focus();
  // Tenta inserir na posicao do cursor
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
    document.execCommand('insertHTML', false, figureHtml);
  } else {
    editor.insertAdjacentHTML('beforeend', figureHtml);
  }
}

// Renderiza preview num overlay (igual o popup que a colab vai ver).
// Chamado pelo botao "👁️ Pré-visualizar" no modal de criar/editar.
function abrirPreviewAviso() {
  const titulo = document.getElementById('av-titulo')?.value.trim() || '(Sem título)';
  const prioridade = document.getElementById('av-prioridade')?.value || 'media';
  const editorEl = document.getElementById('av-mensagem');
  const rawHtml = editorEl ? editorEl.innerHTML : '';
  const mensagemSan = sanitizeRichHtml(rawHtml);
  const anexoUrl = document.getElementById('av-anexo-url')?.value.trim() || '';
  const p = PRIORIDADES[prioridade] || PRIORIDADES.media;

  const overlay = document.createElement('div');
  overlay.id = 'av-preview-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(4px);';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;max-width:560px;width:100%;max-height:88vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);">
      <!-- Barra de preview (so admin ve) -->
      <div style="background:#1F2937;color:#fff;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:700;">
        <span>👁️ PRÉ-VISUALIZAÇÃO — assim que a colaboradora vai ver</span>
        <button id="av-preview-close" style="background:#DC2626;color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-weight:700;font-size:11px;">✕ Fechar</button>
      </div>
      <!-- Header igual popup -->
      <div style="padding:18px 24px 12px;background:linear-gradient(135deg,${p.bg},#fff);border-bottom:3px solid ${p.cor};">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <span style="font-size:32px;">${p.icon}</span>
          <span style="background:${p.bg};color:${p.cor};padding:4px 14px;border-radius:14px;font-size:11px;font-weight:900;letter-spacing:1px;">${p.label.toUpperCase()}</span>
        </div>
        <div style="font-family:'Playfair Display',serif;font-size:24px;color:#111827;line-height:1.3;font-weight:700;">
          ${esc(titulo)}
        </div>
      </div>
      <!-- Mensagem -->
      <div style="padding:20px 26px;overflow-y:auto;flex:1;">
        <div class="av-preview-msg" style="font-size:14px;color:#374151;line-height:1.6;">
          ${mensagemSan || '<em style="color:#9CA3AF;">(Mensagem vazia)</em>'}
        </div>
        ${anexoUrl ? `
          <div style="margin-top:14px;padding:10px 14px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;">
            <a href="${esc(anexoUrl)}" target="_blank" rel="noopener" style="color:#1D4ED8;text-decoration:underline;font-size:13px;font-weight:600;">📎 Ver anexo</a>
          </div>` : ''}
      </div>
      <div style="padding:14px 24px;border-top:1px solid #E5E7EB;background:#FAFAFA;text-align:center;font-size:11px;color:#6B7280;">
        💡 Esta é apenas uma prévia. Os botões reais (Marcar como lido / Lembrar depois) aparecem no popup verdadeiro.
      </div>
    </div>
    <style>
      .av-preview-msg p { margin: 0 0 8px; }
      .av-preview-msg p:last-child { margin-bottom: 0; }
      .av-preview-msg div { margin: 0 0 4px; }
      .av-preview-msg img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 8px 0; }
      .av-preview-msg figure { margin: 8px 0; }
      .av-preview-msg figure img { display: block; margin-bottom: 4px; }
      .av-preview-msg blockquote { border-left: 3px solid #D1D5DB; padding: 4px 12px; color: #4B5563; font-style: italic; margin: 6px 0; }
      .av-preview-msg h1 { font-size: 22px; font-weight: 800; margin: 10px 0 6px; }
      .av-preview-msg h2 { font-size: 17px; font-weight: 700; margin: 8px 0 4px; }
      .av-preview-msg ul, .av-preview-msg ol { padding-left: 24px; margin: 6px 0; }
    </style>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('av-preview-close')?.addEventListener('click', () => overlay.remove());
}

function bindAvisoModal() {
  const btn = document.getElementById('btn-salvar-aviso');
  if (!btn) return;
  // Botao Preview
  document.getElementById('btn-preview-aviso')?.addEventListener('click', abrirPreviewAviso);

  // ── Wire up rich-text toolbar
  const editor = document.getElementById('av-mensagem');
  const toolbar = document.getElementById('av-rte-toolbar');
  if (editor && toolbar) {
    // Coloca <br> inicial pra placeholder sumir só quando digita
    if (!editor.innerHTML.trim()) editor.innerHTML = '';

    toolbar.querySelectorAll('.av-rte-btn').forEach(b => {
      const cmd = b.dataset.cmd;
      if (!cmd) return; // botao especial (imagem) tem id proprio
      b.addEventListener('mousedown', (e) => e.preventDefault()); // mantem caret
      b.addEventListener('click', () => {
        editor.focus();
        const val = b.dataset.val;
        if (cmd === 'createLink') {
          const url = prompt('Cole a URL do link:', 'https://');
          if (url) document.execCommand('createLink', false, url);
        } else if (cmd === 'formatBlock') {
          document.execCommand('formatBlock', false, val);
        } else {
          document.execCommand(cmd, false, null);
        }
        // Garante target=_blank em links criados
        editor.querySelectorAll('a').forEach(a => {
          a.setAttribute('target','_blank'); a.setAttribute('rel','noopener noreferrer');
        });
      });
    });

    // Botao imagem: abre file picker, converte pra base64, insere <figure> com download
    const imgBtn = document.getElementById('av-rte-image');
    const imgFile = document.getElementById('av-img-file');
    if (imgBtn && imgFile) {
      imgBtn.addEventListener('mousedown', (e) => e.preventDefault());
      imgBtn.addEventListener('click', () => {
        // Oferece escolha: arquivo ou URL
        const escolha = confirm('Clique OK pra enviar do computador, ou Cancelar pra colar URL externa.');
        if (escolha) {
          imgFile.value = '';
          imgFile.click();
        } else {
          const url = prompt('Cole a URL da imagem (https://...):', 'https://');
          if (url && /^https?:\/\//i.test(url)) {
            inserirImagemNoEditor(editor, url, 'imagem');
          }
        }
      });
      imgFile.addEventListener('change', async () => {
        const file = imgFile.files?.[0];
        if (!file) return;
        // Aceita ate 10MB de arquivo bruto (sera comprimido)
        if (file.size > 10 * 1024 * 1024) {
          toast('Imagem muito grande (máx 10MB original). Use uma URL externa.', true);
          return;
        }
        try {
          toast('⏳ Comprimindo imagem...');
          const dataUrl = await compressImageToBase64(file, { maxWidth: 1200, quality: 0.82 });
          const kb = Math.round(dataUrl.length / 1024);
          inserirImagemNoEditor(editor, dataUrl, file.name || 'imagem');
          toast(`✅ Imagem inserida (${kb} KB)`);
        } catch (e) {
          toast('❌ Erro ao processar imagem: ' + (e.message || ''), true);
        }
      });
    }

    // ── Quebra de linha consistente
    // Antes: Enter no Chrome criava <div> que sumia depois da sanitizacao
    // do popup pq divs vazias colapsam. Agora forcamos <p> como separador
    // de paragrafo (mais compativel com o renderizador do popup).
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch(_){}
    if (editor) {
      // Garante que o editor abra ja com 1 paragrafo vazio (pra Enter ter
      // referencia de bloco)
      if (!editor.innerHTML.trim() || editor.innerHTML === '<br>') {
        editor.innerHTML = '<p><br></p>';
      }
      // Atalhos teclado padrao (Ctrl+B/I/U) ja funcionam em contenteditable.
    }
  }

  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ Salvando...';
    try {
      const id = btn.dataset.id;
      const titulo = document.getElementById('av-titulo')?.value.trim() || '';
      const editorEl = document.getElementById('av-mensagem');
      const rawHtml = editorEl ? editorEl.innerHTML : '';
      // Texto puro pra validacao (se so tem espaco/br, considera vazio)
      const plain = (editorEl?.innerText || '').replace(/\s+/g, '').trim();
      const mensagem = plain ? sanitizeRichHtml(rawHtml) : '';
      if (!titulo) { toast('❌ Título é obrigatório', true); return; }
      if (!mensagem) { toast('❌ Mensagem é obrigatória', true); return; }

      const prioridade = document.getElementById('av-prioridade')?.value || 'media';
      const dDisp = document.getElementById('av-data-disparo')?.value;
      const dExp  = document.getElementById('av-data-expiracao')?.value;
      const exigir = document.getElementById('av-exigir')?.checked;
      const anexoUrl = document.getElementById('av-anexo-url')?.value.trim() || '';

      const unidades = [...document.querySelectorAll('.av-unidade:checked')].map(el => el.value);
      const setores  = [...document.querySelectorAll('.av-setor:checked')].map(el => el.value);

      if (unidades.length === 0 && setores.length === 0) {
        toast('❌ Selecione pelo menos uma Unidade OU um Setor', true);
        return;
      }

      const payload = {
        titulo, mensagem, prioridade,
        dataDisparo: dDisp || undefined,
        dataExpiracao: dExp || undefined,
        exigirConfirmacao: exigir,
        anexos: anexoUrl ? [{ nome: 'Anexo', url: anexoUrl, tipo: 'documento' }] : [],
        destinatarios: { unidades, setores, usuariosIds: [] },
      };

      if (id) {
        await PATCH('/avisos/' + id, payload);
        toast('✅ Comunicado atualizado!');
      } else {
        await POST('/avisos', payload);
        toast('✅ Comunicado publicado!');
      }
      _avisosCache = null;
      S._modal = '';
      import('../main.js').then(m => m.render()).catch(()=>{});
    } catch (e) {
      toast('❌ Erro: ' + (e.message || ''), true);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  };
}

// ── MODAL: DETALHES + LEITURAS ────────────────────────────
export async function showAvisoDetalhes(id) {
  if (!id) return;
  try {
    const data = await GET('/avisos/' + id + '/leituras');
    const aviso = (_avisosCache || []).find(a => a._id === id);
    if (!aviso) { toast('Aviso nao encontrado', true); return; }
    const p = PRIORIDADES[aviso.prioridade] || PRIORIDADES.media;
    const leituras = data?.leituras || [];

    S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
      <div class="mo-box" style="max-width:680px;max-height:92vh;overflow-y:auto;" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:14px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:26px;">${p.icon}</span>
            <div>
              <div style="font-family:'Playfair Display',serif;font-size:18px;">${esc(aviso.titulo)}</div>
              <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                <span style="background:${p.bg};color:${p.cor};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;text-transform:uppercase;">${p.label}</span>
                <span style="font-size:11px;color:var(--muted);">criado ${_fmtData(aviso.createdAt)}</span>
              </div>
            </div>
          </div>
          <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">&times;</button>
        </div>

        <div style="background:#FAFAFA;border-radius:10px;padding:14px;margin-bottom:14px;font-size:13px;line-height:1.5;">
          ${formatMensagemRich(aviso.mensagem)}
        </div>

        ${aviso.anexos?.[0]?.url ? `
          <div style="margin-bottom:14px;">
            <a href="${esc(aviso.anexos[0].url)}" target="_blank" style="color:#1D4ED8;text-decoration:underline;font-size:12px;">📎 Ver anexo</a>
          </div>
        ` : ''}

        <div class="fr2" style="margin-bottom:14px;font-size:12px;">
          <div><strong>Disparo:</strong> ${_fmtData(aviso.dataDisparo)}</div>
          <div><strong>Expira:</strong> ${aviso.dataExpiracao ? _fmtData(aviso.dataExpiracao) : '—'}</div>
        </div>

        <div style="margin-bottom:14px;">
          <strong style="font-size:12px;">Destinatários:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
            ${(aviso.destinatarios?.unidades || []).map(u => `<span style="background:#EFF6FF;color:#1E40AF;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;">🏪 ${u}</span>`).join('')}
            ${(aviso.destinatarios?.setores || []).map(s => `<span style="background:#F0FDF4;color:#15803D;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:700;">👥 ${s}</span>`).join('')}
          </div>
        </div>

        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:13px;color:#15803D;">👁 Leituras Confirmadas</strong>
            <span style="font-size:14px;font-weight:800;color:#15803D;">${leituras.length}</span>
          </div>
          ${leituras.length === 0 ? `
            <div style="text-align:center;padding:8px;color:#15803D;font-size:12px;font-style:italic;">Nenhuma leitura ainda</div>
          ` : `
            <div style="max-height:220px;overflow-y:auto;">
              ${leituras.sort((a,b) => new Date(b.lidoEm) - new Date(a.lidoEm)).map(l => `
                <div style="background:#fff;border:1px solid #D1FAE5;border-radius:6px;padding:8px 10px;margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;gap:8px;">
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:12px;">${esc(l.userName || 'Sem nome')}</div>
                    <div style="font-size:10px;color:#6B7280;">${esc(l.userCargo || '')} · ${esc(l.userUnit || '')}</div>
                  </div>
                  <div style="font-size:10px;color:#15803D;font-weight:700;text-align:right;">${_fmtData(l.lidoEm)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:14px;">
          <button class="btn btn-ghost" onclick="S._modal='';render();">Fechar</button>
          <button class="btn btn-amber btn-sm" data-aviso-resend="${aviso._id}" title="Reenviar pra uma colab que nao recebeu">📨 Reenviar p/ colab</button>
          <button class="btn btn-blue btn-sm" data-aviso-edit="${aviso._id}">✏️ Editar</button>
          ${(S.user?.role === 'Administrador' || S.user?.cargo === 'admin') && !aviso.cancelado ? `
            <button class="btn btn-red btn-sm" data-aviso-cancel="${aviso._id}">🚫 Cancelar Aviso</button>
          ` : ''}
        </div>
      </div>
    </div>`;
    import('../main.js').then(m => m.render()).catch(()=>{});

    setTimeout(() => {
      document.querySelectorAll('[data-aviso-edit]').forEach(b => {
        b.onclick = () => {
          const a = (_avisosCache || []).find(x => x._id === b.dataset.avisoEdit);
          if (a) showAvisoModal(a);
        };
      });
      document.querySelectorAll('[data-aviso-resend]').forEach(b => {
        b.onclick = () => showReenviarModal(b.dataset.avisoResend);
      });
      document.querySelectorAll('[data-aviso-cancel]').forEach(b => {
        b.onclick = async () => {
          if (!confirm('Cancelar este aviso? Ele não aparecerá mais pras colabs.')) return;
          try {
            await DELETE('/avisos/' + b.dataset.avisoCancel);
            toast('✅ Aviso cancelado');
            _avisosCache = null;
            S._modal = '';
            import('../main.js').then(m => m.render()).catch(()=>{});
          } catch (e) {
            toast('❌ Erro ao cancelar: ' + (e.message || ''), true);
          }
        };
      });
    }, 50);
  } catch (e) {
    toast('Erro: ' + (e.message || ''), true);
  }
}

// ── MODAL: REENVIAR PARA COLAB ESPECIFICA ─────────────────
// Util quando o filtro do aviso original nao bateu numa colab especifica.
// Clona o aviso, mira so nela via destinatarios.usuariosIds. Backend cria
// um novo doc com clonadoDeId apontando pro original (auditoria).
async function showReenviarModal(avisoId) {
  if (!avisoId) return;
  try {
    // Carrega lista de colabs ativas
    const colabs = await GET('/collaborators').catch(() => []);
    const lista = (Array.isArray(colabs) ? colabs : [])
      .filter(c => c.ativo !== false)
      .sort((a, b) => String(a.nome || a.name || '').localeCompare(String(b.nome || b.name || '')));

    if (!lista.length) {
      toast('Nenhuma colaboradora cadastrada encontrada.', true);
      return;
    }

    S._modal = `<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
      <div class="mo-box" style="max-width:480px;max-height:88vh;overflow-y:auto;" onclick="event.stopPropagation()">
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid var(--border);margin-bottom:14px;">
          <div style="font-family:'Playfair Display',serif;font-size:18px;">📨 Reenviar Comunicado</div>
          <button onclick="S._modal='';render();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted)">&times;</button>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.5;">
          Selecione a colaboradora pra quem você quer <strong>reenviar este aviso</strong>.<br>
          Ela vai receber uma nova cópia direcionada só pra ela, no próximo refresh dela.
        </div>
        <div class="fg" style="margin-bottom:10px;">
          <label class="fl">Buscar colaboradora</label>
          <input class="fi" id="resend-search" placeholder="Digite o nome..." autocomplete="off"/>
        </div>
        <div id="resend-list" style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;background:#FAFAFA;">
          ${lista.map(c => {
            const id = String(c._id || c.id || '');
            const nome = c.nome || c.name || '(sem nome)';
            const cargo = c.cargo || c.role || '';
            const unit = c.unidade || c.unit || '';
            return `<label data-nome-lower="${nome.toLowerCase()}" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #EEE;cursor:pointer;font-size:13px;background:#fff;">
              <input type="radio" name="resend-colab" value="${id}" data-nome="${esc(nome)}" style="cursor:pointer;"/>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;">${esc(nome)}</div>
                <div style="font-size:11px;color:var(--muted);">${esc(cargo)} ${unit ? '· ' + esc(unit) : ''}</div>
              </div>
            </label>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;margin-top:14px;">
          <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
          <button class="btn btn-primary" id="btn-confirm-resend" data-aviso="${avisoId}">📨 Reenviar</button>
        </div>
      </div>
    </div>`;
    import('../main.js').then(m => m.render()).catch(()=>{});

    setTimeout(() => {
      // Filtro de busca
      const search = document.getElementById('resend-search');
      const listEl = document.getElementById('resend-list');
      if (search && listEl) {
        search.addEventListener('input', () => {
          const q = search.value.toLowerCase().trim();
          listEl.querySelectorAll('label[data-nome-lower]').forEach(lb => {
            lb.style.display = !q || lb.dataset.nomeLower.includes(q) ? '' : 'none';
          });
        });
      }
      // Confirma envio
      const btn = document.getElementById('btn-confirm-resend');
      if (btn) {
        btn.onclick = async () => {
          const sel = document.querySelector('input[name="resend-colab"]:checked');
          if (!sel) { toast('Selecione uma colaboradora', true); return; }
          const userId = sel.value;
          const userName = sel.dataset.nome || '';
          btn.disabled = true;
          const orig = btn.textContent;
          btn.textContent = '⏳ Enviando...';
          try {
            await POST(`/avisos/${btn.dataset.aviso}/reenviar`, { userId, userName });
            toast(`✅ Comunicado reenviado para ${userName}!`);
            _avisosCache = null;
            S._modal = '';
            import('../main.js').then(m => m.render()).catch(()=>{});
          } catch (e) {
            toast('❌ Erro ao reenviar: ' + (e.message || ''), true);
            btn.disabled = false;
            btn.textContent = orig;
          }
        };
      }
    }, 50);
  } catch (e) {
    toast('Erro ao carregar colaboradoras: ' + (e.message || ''), true);
  }
}

// ── BINDINGS DA PAGE PRINCIPAL ────────────────────────────
export function bindAvisos() {
  document.getElementById('btn-novo-aviso')?.addEventListener('click', () => showAvisoModal());
  document.getElementById('btn-novo-aviso-2')?.addEventListener('click', () => showAvisoModal());
  document.getElementById('btn-refresh-avisos')?.addEventListener('click', () => {
    _avisosCache = null;
    import('../main.js').then(m => m.render()).catch(()=>{});
  });
  document.querySelectorAll('[data-aviso-tab]').forEach(b => {
    b.onclick = () => {
      S._avisoTab = b.dataset.avisoTab;
      _avisosCache = null;
      import('../main.js').then(m => m.render()).catch(()=>{});
    };
  });
  document.querySelectorAll('[data-aviso-detail]').forEach(b => {
    b.onclick = () => showAvisoDetalhes(b.dataset.avisoDetail);
  });
}
