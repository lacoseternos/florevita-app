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
export function formatMensagemRich(text) {
  if (!text) return '';
  // 1) Escape HTML PRIMEIRO (anti-XSS)
  let s = String(text)
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
        <textarea class="fi" id="av-mensagem" rows="5" maxlength="5000" placeholder="Conteúdo completo do comunicado...">${esc(aviso?.mensagem||'')}</textarea>
        <div style="font-size:11px;color:var(--muted);margin-top:4px;line-height:1.5;background:#FAFAFA;border:1px dashed #D1D5DB;border-radius:6px;padding:6px 10px;">
          💡 <strong>Formatação:</strong>
          <code style="background:#fff;padding:1px 5px;border-radius:3px;">**negrito**</code>,
          <code style="background:#fff;padding:1px 5px;border-radius:3px;">*itálico*</code>,
          <code style="background:#fff;padding:1px 5px;border-radius:3px;">~~tachado~~</code>,
          <code style="background:#fff;padding:1px 5px;border-radius:3px;">- lista</code>,
          URLs viram links automáticos.
        </div>
      </div>

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

      <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
        <button class="btn btn-ghost" onclick="S._modal='';render();">Cancelar</button>
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

function bindAvisoModal() {
  const btn = document.getElementById('btn-salvar-aviso');
  if (!btn) return;
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '⏳ Salvando...';
    try {
      const id = btn.dataset.id;
      const titulo = document.getElementById('av-titulo')?.value.trim() || '';
      const mensagem = document.getElementById('av-mensagem')?.value.trim() || '';
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

        <div style="display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--border);padding-top:14px;">
          <button class="btn btn-ghost" onclick="S._modal='';render();">Fechar</button>
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
