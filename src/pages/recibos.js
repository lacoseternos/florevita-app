// ── RECIBOS DE PAGAMENTO ──────────────────────────────────────
// Marcia (09/nov/2026): módulo de volta, agora puxando dados de um pedido,
// com empresa/CNPJ do pagador, logo e assinatura em PNG (Configurar recibo).
// Modulo de Gestao: emite recibo simples pra cliente que solicita.
// NAO substitui nota fiscal. Permissao: admin/gerente por padrao,
// outros colabs precisam de modulos.recibos=true (configurado em
// Colaboradores).
import { S } from '../state.js';
import { $c, $d, esc } from '../utils/formatters.js';
import { GET, POST, PATCH, PUT, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';

// Emitente e assinatura (Settings 'recibo-config'; só o admin altera).
let _rcfg = null;
async function _carregarCfg() {
  try { const r = await GET('/settings/recibo-config'); _rcfg = r?.value || {}; } catch { _rcfg = _rcfg || {}; }
}
function _emitente() {
  const cfg = JSON.parse(localStorage.getItem('fv_config') || '{}');
  const c = _rcfg || {};
  return {
    razao: c.razao || cfg.razao || cfg.razaoSocial || 'Marcia Florentino de Barros ME',
    cnpj: c.cnpj || cfg.cnpj || '',
    endereco: c.endereco || cfg.addr || '',
    telefone: c.telefone || cfg.whats || '(92) 99300-2433',
    assinaturaPng: c.assinaturaPng || '',
    nomeAssinatura: c.nomeAssinatura || cfg.assinaturaRecibo || 'Marcia Florentino de Barros Pinheiro',
    logo: c.logo || cfg.loginLogo || cfg.logo || (location.origin + '/logo-lacos-eternos.png'),
  };
}

// State local da pagina
const R = {
  list: [],
  loading: false,
  search: '',
  showCancelled: false,
};

function _canAccess() {
  const u = S.user || {};
  const cargo = String(u.cargo||'').toLowerCase();
  const role  = String(u.role||'').toLowerCase();
  if (cargo === 'admin' || role === 'administrador') return true;
  if (cargo === 'gerente' || role === 'gerente') return true;
  const mods = u.modulos || u.modules || {};
  if (Array.isArray(mods)) return mods.includes('recibos');
  if (typeof mods === 'object' && mods.recibos === true) return true;
  return false;
}

function _isAdmin() {
  const u = S.user || {};
  return u.cargo === 'admin' || u.role === 'Administrador';
}

// ── Helper: valor por extenso ─────────────────────────────────
// Conversao basica pra valores BRL. Suporta ate 999.999,99.
function valorPorExtenso(valor) {
  const n = Math.round(Number(valor) * 100) / 100;
  if (!n || n <= 0) return 'zero reais';
  const inteiro = Math.floor(n);
  const cent    = Math.round((n - inteiro) * 100);
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const e = ['dez','onze','doze','treze','quatorze','quinze','dezesseis','dezessete','dezoito','dezenove'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  function ate999(num) {
    if (num === 0) return '';
    if (num === 100) return 'cem';
    const cn = Math.floor(num/100), dn = Math.floor((num%100)/10), un = num%10;
    let s = '';
    if (cn) s = c[cn];
    const resto = num % 100;
    if (resto > 0) {
      if (s) s += ' e ';
      if (resto < 10) s += u[resto];
      else if (resto < 20) s += e[resto-10];
      else {
        s += d[dn];
        if (un) s += ' e ' + u[un];
      }
    }
    return s;
  }
  let extInt = '';
  const milhar = Math.floor(inteiro/1000);
  const resto  = inteiro % 1000;
  if (milhar > 0) {
    if (milhar === 1) extInt = 'mil';
    else extInt = ate999(milhar) + ' mil';
    if (resto > 0) extInt += (resto < 100 ? ' e ' : ' ') + ate999(resto);
  } else {
    extInt = ate999(inteiro);
  }
  let txt = extInt + ' ' + (inteiro === 1 ? 'real' : 'reais');
  if (cent > 0) {
    txt += ' e ' + ate999(cent) + ' ' + (cent === 1 ? 'centavo' : 'centavos');
  }
  return txt.replace(/\s+/g, ' ').trim();
}

// ── LOAD ──────────────────────────────────────────────────────
async function loadList() {
  R.loading = true;
  if (!_rcfg) await _carregarCfg();
  try {
    const url = '/receipts?limit=200' + (R.showCancelled ? '' : '&cancelado=false');
    R.list = await GET(url) || [];
  } catch (e) {
    toast('❌ Erro ao carregar recibos: ' + (e.message||''), true);
    R.list = [];
  }
  R.loading = false;
  const { render } = await import('../main.js');
  render();
}

// ── RENDER PRINCIPAL ──────────────────────────────────────────
export function renderRecibos() {
  if (!_canAccess()) {
    return `<div class="empty card">
      <div class="empty-icon">🔒</div>
      <p>Sem permissão para acessar Recibos.</p>
      <p style="font-size:11px;color:var(--muted);margin-top:8px;">Peça ao Administrador para liberar este módulo no seu perfil de colaborador.</p>
    </div>`;
  }
  // Filtros
  const q = (R.search||'').toLowerCase().trim();
  const filtered = (R.list||[]).filter(r => {
    if (!q) return true;
    return (
      String(r.numero||'').toLowerCase().includes(q) ||
      String(r.clientName||'').toLowerCase().includes(q) ||
      String(r.descricao||'').toLowerCase().includes(q) ||
      String(r.clientDoc||'').replace(/\D/g,'').includes(q.replace(/\D/g,''))
    );
  });
  const totalValido = filtered
    .filter(r => !r.cancelado)
    .reduce((s, r) => s + Number(r.valor||0), 0);

  return `
<div class="page-header">
  <h1 style="display:flex;align-items:center;gap:8px;font-size:22px;">
    🧾 Recibos de Pagamento
    <span style="font-size:11px;background:#FEF3C7;color:#92400E;padding:2px 9px;border-radius:20px;font-weight:600;letter-spacing:.5px;">GESTÃO</span>
  </h1>
  <p style="font-size:12px;color:var(--muted);margin-top:2px;">Emite comprovante de recebimento pra clientes que solicitam. <strong>Não substitui nota fiscal.</strong></p>
</div>

<!-- Cards de resumo -->
<div class="g3" style="margin-bottom:14px;">
  <div class="mc rose"><div class="mc-label">Recibos Emitidos</div><div class="mc-val">${filtered.filter(r=>!r.cancelado).length}</div></div>
  <div class="mc leaf"><div class="mc-label">Valor Total Recebido</div><div class="mc-val" style="font-size:18px;">${$c(totalValido)}</div></div>
  <div class="mc gold"><div class="mc-label">Cancelados</div><div class="mc-val">${(R.list||[]).filter(r=>r.cancelado).length}</div></div>
</div>

<!-- Toolbar -->
<div class="card" style="margin-bottom:12px;">
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
    <div style="position:relative;flex:1;min-width:200px;">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none;">🔍</span>
      <input class="fi" id="rec-search" placeholder="Buscar por nº, cliente, CPF ou descrição..." value="${esc(R.search)}" style="padding-left:30px;"/>
    </div>
    <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);cursor:pointer;">
      <input type="checkbox" id="rec-show-cancelled" ${R.showCancelled?'checked':''} style="accent-color:#C8736A;"/>
      Mostrar cancelados
    </label>
    <button class="btn btn-primary" id="btn-rec-novo" style="white-space:nowrap;">➕ Novo Recibo</button>
    ${_isAdmin() ? '<button class="btn btn-ghost" id="btn-rec-cfg" style="white-space:nowrap;">✍️ Empresa e assinatura</button>' : ''}
    <button class="btn btn-ghost" id="btn-rec-refresh" title="Atualizar">🔄</button>
  </div>
</div>

<!-- Lista -->
${R.loading ? '<div class="empty"><p>Carregando recibos...</p></div>' :
  filtered.length === 0 ? `
  <div class="empty card">
    <div class="empty-icon">🧾</div>
    <p>${R.list.length === 0 ? 'Nenhum recibo emitido ainda. Clique em "➕ Novo Recibo" para emitir o primeiro.' : 'Nenhum recibo encontrado pra essa busca.'}</p>
  </div>
` : `
<div class="card" style="padding:0;overflow:hidden;">
  <div style="overflow-x:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#FAF7F5;border-bottom:1px solid var(--border);">
        <tr>
          <th style="padding:9px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Nº</th>
          <th style="padding:9px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Cliente</th>
          <th style="padding:9px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Descrição</th>
          <th style="padding:9px 12px;text-align:right;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Valor</th>
          <th style="padding:9px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Data</th>
          <th style="padding:9px 12px;text-align:left;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Emitido por</th>
          <th style="padding:9px 12px;text-align:center;font-size:10px;color:var(--muted);font-weight:700;letter-spacing:.5px;">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(r => `
        <tr style="border-bottom:1px solid #F1F5F9;${r.cancelado?'opacity:.55;':''}" onmouseover="this.style.background='#FFF7F4'" onmouseout="this.style.background='#fff'">
          <td style="padding:8px 12px;font-weight:700;color:#C8736A;font-family:monospace;">${esc(r.numero||'—')}</td>
          <td style="padding:8px 12px;">
            <div style="font-weight:600;color:#1F2937;">${esc(r.clientName||'—')}</div>
            ${r.clientDoc?`<div style="font-size:10px;color:var(--muted);">${esc(r.clientDoc)}</div>`:''}
          </td>
          <td style="padding:8px 12px;color:#4B5563;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.descricao||'')}">${esc(r.descricao||'—')}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:700;color:${r.cancelado?'#9CA3AF':'#15803D'};">${$c(r.valor||0)}</td>
          <td style="padding:8px 12px;font-size:11px;color:var(--muted);white-space:nowrap;">${r.dataRecebimento ? $d(r.dataRecebimento) : $d(r.createdAt)}</td>
          <td style="padding:8px 12px;font-size:11px;color:var(--muted);">${esc(r.emitidoPorNome||'—')}</td>
          <td style="padding:8px 12px;text-align:center;white-space:nowrap;">
            ${r.cancelado
              ? `<span style="background:#FEE2E2;color:#7F1D1D;padding:3px 8px;border-radius:6px;font-size:9px;font-weight:700;">CANCELADO</span>`
              : `<button data-rec-print="${r._id}" title="Imprimir/Visualizar" style="padding:4px 8px;background:#8B2252;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin-right:4px;">🖨️</button>
                 <button data-rec-cancel="${r._id}" title="Cancelar recibo" style="padding:4px 8px;background:#FEE2E2;color:#991B1B;border:1px solid #FCA5A5;border-radius:6px;cursor:pointer;font-size:11px;">❌</button>`}
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>`}

`;
}

// ── Modal: abre via S._modal (padrao do sistema — fica em root separado
// e nao eh wiped quando renderRecibos() reroda).
async function openReceiptForm() {
  const clients = (S.clients || []).slice(0, 200);
  const hoje = new Date().toISOString().slice(0,10);
  S._modal = `
<div class="mo" id="mo" onclick="if(event.target===this){S._modal='';render();}">
  <div class="mo-box" style="max-width:600px;" onclick="event.stopPropagation()">
    <div style="background:linear-gradient(135deg,#C8736A,#8B2252);color:#fff;padding:14px 18px;margin:-20px -20px 16px;border-radius:14px 14px 0 0;">
      <div style="font-family:'Playfair Display',serif;font-size:18px;">🧾 Emitir Novo Recibo</div>
      <div style="font-size:11px;opacity:.9;margin-top:2px;">Preencha os dados do pagamento</div>
    </div>

    <div style="display:flex;gap:8px;align-items:flex-end;background:#F5F3FF;border:1px dashed #A78BFA;border-radius:10px;padding:10px;margin-bottom:12px;">
      <div class="fg" style="flex:1;margin:0;"><label class="fl">📋 Aproveitar um pedido</label>
        <input class="fi" id="rec-buscar-pedido" placeholder="Nº do pedido (ex: 09450)" inputmode="numeric"/></div>
      <button type="button" class="btn btn-ghost" id="btn-rec-buscar">Buscar e preencher</button>
    </div>
    <div class="fr2" style="gap:10px;margin-bottom:10px;">
      <div class="fg" style="grid-column:span 2;">
        <label class="fl">Empresa (razão social, se for PJ)</label>
        <input class="fi" id="rec-client-empresa" placeholder="Ex.: Comercial Exemplo Ltda"/>
      </div>
      <div class="fg" style="grid-column:span 2;">
        <label class="fl">Cliente / responsável *</label>
        <input class="fi" id="rec-client-name" list="rec-clients-dl" placeholder="Nome completo / Razão social" autocomplete="off"/>
        <datalist id="rec-clients-dl">
          ${clients.map(c => `<option value="${esc(c.name||c.nome||'')}">`).join('')}
        </datalist>
      </div>
      <div class="fg"><label class="fl">CPF/CNPJ</label>
        <input class="fi" id="rec-client-doc" placeholder="000.000.000-00"/></div>
      <div class="fg"><label class="fl">Telefone</label>
        <input class="fi" id="rec-client-phone" placeholder="(92) 99999-9999"/></div>
      <div class="fg" style="grid-column:span 2;"><label class="fl">Endereço (opcional)</label>
        <input class="fi" id="rec-client-address" placeholder="Rua / Avenida, número, bairro, cidade"/></div>
    </div>

    <div class="fr2" style="gap:10px;margin-bottom:10px;">
      <div class="fg"><label class="fl">Valor (R$) *</label>
        <input class="fi" type="number" id="rec-valor" step="0.01" min="0" placeholder="0.00"/></div>
      <div class="fg"><label class="fl">Forma de Pagamento</label>
        <select class="fi" id="rec-payment">
          ${['Dinheiro','Pix','Cartão de Débito','Cartão de Crédito','Transferência','Cheque','Outro'].map(p => `<option>${p}</option>`).join('')}
        </select></div>
      <div class="fg" style="grid-column:span 2;"><label class="fl">Referente a *</label>
        <textarea class="fi" id="rec-descricao" rows="2" placeholder="Ex: pagamento de pedido #00123 — buquê de rosas vermelhas"></textarea></div>
      <div class="fg"><label class="fl">Data do Recebimento</label>
        <input class="fi" type="date" id="rec-data" value="${hoje}"/></div>
      <div class="fg"><label class="fl">Pedido vinculado (opcional)</label>
        <input class="fi" id="rec-order-number" placeholder="Nº do pedido (ex: 00123)"/>
        <input type="hidden" id="rec-order-id"/></div>
    </div>

    <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:10px 12px;font-size:11px;color:#78350F;margin-bottom:10px;">
      ⚠️ Este recibo é apenas um <strong>comprovante interno</strong>. Para necessidades fiscais, emita Nota Fiscal pelo módulo correspondente.
    </div>

    <div class="mo-foot">
      <button class="btn btn-ghost" id="btn-rec-cancel">Cancelar</button>
      <button class="btn btn-primary" id="btn-rec-save">💾 Emitir Recibo</button>
    </div>
  </div>
</div>`;
  const { render } = await import('../main.js');
  render();
  // Bind eventos do form depois do render
  setTimeout(_bindFormEvents, 30);
}

// Eventos do modal de novo recibo (bindados manualmente apos open)
function _bindFormEvents() {
  document.getElementById('btn-rec-cancel')?.addEventListener('click', async () => {
    S._modal = '';
    const { render } = await import('../main.js');
    render();
  });

  // Auto-preenche dados do cliente ao escolher do datalist
  const cliNameEl = document.getElementById('rec-client-name');
  cliNameEl?.addEventListener('change', () => {
    const name = cliNameEl.value.trim();
    const cli = (S.clients||[]).find(c => (c.name||c.nome||'').trim().toLowerCase() === name.toLowerCase());
    if (cli) {
      const docEl = document.getElementById('rec-client-doc');
      const phEl  = document.getElementById('rec-client-phone');
      const adEl  = document.getElementById('rec-client-address');
      if (docEl && !docEl.value) docEl.value = cli.cpf || cli.cnpj || '';
      if (phEl  && !phEl.value)  phEl.value  = cli.phone || cli.telefone || '';
      if (adEl  && !adEl.value && cli.address) {
        const a = cli.address;
        adEl.value = [a.street, a.number, a.neighborhood, a.city].filter(Boolean).join(', ');
      }
    }
  });

  // Aproveitar um pedido: preenche cliente, documento, valor, forma de pagamento e itens.
  const buscar = async () => {
    const num = String(document.getElementById('rec-buscar-pedido')?.value || '').replace(/\D/g, '');
    if (!num) return toast('Digite o número do pedido', true);
    const btn = document.getElementById('btn-rec-buscar'); if (btn) { btn.disabled = true; btn.textContent = '⏳ Buscando...'; }
    try {
      const so = (n) => String(n || '').replace(/\D/g, '').replace(/^0+/, '');
      let o = (S.orders || []).find(x => so(x.orderNumber || x.numero) === so(num));
      if (!o) {
        const r = await GET('/orders?search=' + encodeURIComponent(num) + '&limit=10');
        const lista = Array.isArray(r) ? r : (r?.orders || r?.data || []);
        o = lista.find(x => so(x.orderNumber || x.numero) === so(num));
      }
      if (!o) return toast('Pedido não encontrado', true);
      if (o._id && !(o.items || []).length) { try { o = { ...o, ...(await GET('/orders/' + o._id)) }; } catch {} }
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') el.value = v; };
      set('rec-client-name', o.clientName || o.cliente || '');
      set('rec-client-doc', o.cpfCnpj || o.clientCpf || o.clientCnpj || '');
      set('rec-client-phone', o.clientPhone || '');
      if (String(o.clientTipoPessoa || '').toUpperCase() === 'PJ') set('rec-client-empresa', o.clientRazaoSocial || o.clientName || '');
      set('rec-valor', Number(o.total || 0).toFixed(2));
      const pg = String(o.payment || o.paymentMethod || '');
      const opcoes = ['Dinheiro','Pix','Cartão de Débito','Cartão de Crédito','Transferência','Cheque','Outro'];
      const mapa = /pix/i.test(pg) ? 'Pix' : /d[eé]bito/i.test(pg) ? 'Cartão de Débito' : /cr[eé]dito|cart|link/i.test(pg) ? 'Cartão de Crédito' : /dinheiro/i.test(pg) ? 'Dinheiro' : /transf/i.test(pg) ? 'Transferência' : '';
      const sel = document.getElementById('rec-payment');
      if (sel) { if (mapa) sel.value = mapa; else if (pg) { sel.value = 'Outro'; } }
      const numFmt = String(o.orderNumber || o.numero || num);
      const itens = (o.items || []).map(i => `${i.qty || i.quantidade || 1}x ${i.name || i.nome || ''}`).filter(Boolean).join(', ');
      set('rec-descricao', `Pedido #${numFmt}${itens ? ' — ' + itens : ''}${pg && !mapa ? ' (' + pg + ')' : ''}`);
      const dt = o.paymentApprovedAt || o.createdAt;
      if (dt) set('rec-data', new Date(new Date(dt).getTime() - 4 * 3600e3).toISOString().slice(0, 10));
      set('rec-order-number', numFmt);
      set('rec-order-id', o._id || '');
      toast('✅ Dados do pedido preenchidos. Confira antes de emitir.');
    } catch (e) { toast('❌ ' + (e.message || 'Erro ao buscar o pedido'), true); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Buscar e preencher'; } }
  };
  document.getElementById('btn-rec-buscar')?.addEventListener('click', buscar);
  document.getElementById('rec-buscar-pedido')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });

  // Foco automatico no primeiro campo
  document.getElementById('rec-buscar-pedido')?.focus();

  // Salvar
  document.getElementById('btn-rec-save')?.addEventListener('click', async () => {
    if (window._recSaving) return;
    const g = id => document.getElementById(id)?.value?.trim() || '';
    const clientName = g('rec-client-name');
    const valor      = parseFloat(g('rec-valor'));
    const descricao  = g('rec-descricao');
    if (!clientName)              return toast('❌ Nome do cliente é obrigatório', true);
    if (!valor || valor <= 0)     return toast('❌ Valor deve ser maior que zero', true);
    if (!descricao)               return toast('❌ Descrição é obrigatória (referente a o quê)', true);

    const btn = document.getElementById('btn-rec-save');
    const orig = btn?.innerHTML;
    window._recSaving = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Emitindo...'; }

    try {
      const payload = {
        clientName,
        clientEmpresa: g('rec-client-empresa'),
        clientDoc:     g('rec-client-doc'),
        clientPhone:   g('rec-client-phone'),
        clientAddress: g('rec-client-address'),
        valor,
        valorExtenso:  valorPorExtenso(valor),
        descricao,
        paymentMethod: g('rec-payment') || 'Dinheiro',
        orderNumber:   g('rec-order-number'),
        dataRecebimento: g('rec-data') ? new Date(g('rec-data') + 'T12:00:00').toISOString() : new Date().toISOString(),
      };
      const cli = (S.clients||[]).find(c => (c.name||c.nome||'').trim().toLowerCase() === clientName.toLowerCase());
      if (cli) payload.clientId = cli._id;
      if (/^[a-f0-9]{24}$/i.test(g('rec-order-id'))) payload.orderId = g('rec-order-id');

      const created = await POST('/receipts', payload);
      R.list = [created, ...(R.list||[])];
      S._modal = '';
      toast(`✅ Recibo ${created.numero} emitido!`);
      const { render } = await import('../main.js');
      render();
      setTimeout(() => showReceiptPreview(created._id), 300);
    } catch (e) {
      console.error('[recibo] save erro:', e);
      toast('❌ Erro ao emitir: ' + (e.message||''), true);
      if (btn) { btn.disabled = false; btn.innerHTML = orig || '💾 Emitir Recibo'; }
    } finally {
      window._recSaving = false;
    }
  });
}

// ── BINDINGS ──────────────────────────────────────────────────
export function bindRecibos() {
  // Carrega ao entrar
  if (R.list.length === 0 && !R.loading && _canAccess()) {
    loadList();
  }

  // Search
  {
    let t = null;
    document.getElementById('rec-search')?.addEventListener('input', e => {
      R.search = e.target.value;
      clearTimeout(t);
      t = setTimeout(() => {
        requestAnimationFrame(async () => {
          const { render } = await import('../main.js');
          render();
          requestAnimationFrame(() => {
            const el = document.getElementById('rec-search');
            if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
          });
        });
      }, 350);
    });
  }
  document.getElementById('rec-show-cancelled')?.addEventListener('change', async e => {
    R.showCancelled = e.target.checked;
    await loadList();
  });
  document.getElementById('btn-rec-refresh')?.addEventListener('click', () => loadList());
  document.getElementById('btn-rec-novo')?.addEventListener('click', () => openReceiptForm());
  document.getElementById('btn-rec-cfg')?.addEventListener('click', () => abrirConfigRecibo());

  // Imprimir / Cancelar
  document.querySelectorAll('[data-rec-print]').forEach(b => {
    b.onclick = () => showReceiptPreview(b.dataset.recPrint);
  });
  document.querySelectorAll('[data-rec-cancel]').forEach(b => {
    b.onclick = () => cancelReceipt(b.dataset.recCancel);
  });
}

// ── CANCELAR RECIBO ───────────────────────────────────────────
async function cancelReceipt(id) {
  const r = (R.list||[]).find(x => x._id === id);
  if (!r) return;
  const motivo = prompt(`Cancelar recibo ${r.numero} de ${r.clientName} (${$c(r.valor)})?\n\nDigite o motivo:`);
  if (motivo === null) return;
  if (!motivo.trim()) { toast('Motivo é obrigatório', true); return; }
  try {
    await PATCH('/receipts/'+id+'/cancel', { motivo: motivo.trim() });
    R.list = R.list.map(x => x._id === id ? { ...x, cancelado:true, motivoCancelamento: motivo.trim() } : x);
    toast(`🗑️ Recibo ${r.numero} cancelado.`);
    const { render } = await import('../main.js');
    render();
  } catch (e) {
    toast('❌ Erro ao cancelar: ' + (e.message||''), true);
  }
}

// ── PREVIEW / IMPRESSAO DO RECIBO ─────────────────────────────
function showReceiptPreview(id) {
  const r = (R.list||[]).find(x => x._id === id);
  if (!r) { toast('Recibo nao encontrado', true); return; }
  const em = _emitente();
  const cnpj    = em.cnpj || '—';

  const dataFmt = r.dataRecebimento
    ? new Date(r.dataRecebimento).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
    : new Date(r.createdAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
  const valorFmt = $c(r.valor||0);
  const extenso = r.valorExtenso || valorPorExtenso(r.valor);

  // Data em pedacos para preencher "DIA de MES de ANO" no estilo classico
  const dt = r.dataRecebimento ? new Date(r.dataRecebimento) : new Date(r.createdAt);
  const dia  = String(dt.getDate()).padStart(2,'0');
  const meses= ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const mesNome = meses[dt.getMonth()];
  const ano  = dt.getFullYear();

  // Logo: tenta cfg.loginLogo / cfg.logo, senao usa logo embarcado (oficial)
  const logoSrc = em.logo;

  // Razao social: padrao se nao houver configurada
  const razao = em.razao;
  const cnpjStr = cnpj && cnpj !== '—' ? ', CNPJ ' + cnpj : '';

  // Numero do recibo: se vinculado a pedido, usa o NUMERO DO PEDIDO no lugar do REC-XXXXX
  const numeroExibido = r.orderNumber
    ? String(r.orderNumber).replace(/^#?/, '#')
    : (r.numero || '—');

  // Assinatura: nome em fonte cursiva (default 'Marcia Florentino de Barros Pinheiro').
  const nomeAssinatura = em.nomeAssinatura;
  // Pagador: empresa (com CNPJ) e, se houver, a pessoa responsável.
  const pagador = r.clientEmpresa
    ? `${r.clientEmpresa}${r.clientDoc ? ' — CNPJ/CPF ' + r.clientDoc : ''}${r.clientName && r.clientName !== r.clientEmpresa ? ' (A/C ' + r.clientName + ')' : ''}`
    : `${r.clientName || ''}${r.clientDoc ? ' — ' + r.clientDoc : ''}`;

  const htmlDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Recibo ${esc(r.numero)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Poppins:wght@400;500;600;700&family=Dancing+Script:wght@600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#f0f0f0;padding:20px;font-family:'Poppins',Arial,sans-serif;}
  .recibo{
    width:210mm;height:99mm;          /* metade de A4 (148mm) menos margem */
    background:#FFF8F1;
    margin:0 auto;border-radius:14px;
    box-shadow:0 8px 30px rgba(0,0,0,.12);
    display:grid;grid-template-columns:175px 1fr;
    overflow:hidden;position:relative;
  }
  /* Coluna ROSA (esquerda) — "canhoto" do recibo */
  .left{
    background:#E8917A;color:#fff;
    padding:18px 16px;display:flex;flex-direction:column;gap:12px;
    overflow:hidden;
  }
  .left h2{
    font-size:22px;letter-spacing:.5px;
    font-family:'Cormorant Garamond',serif;font-weight:600;
  }
  .left .num-box{
    background:#fff;color:#1F2937;border-radius:6px;
    padding:5px 8px;font-family:'Poppins',sans-serif;font-size:12px;font-weight:700;
    align-self:flex-start;min-width:110px;
    word-break:break-all;
  }
  .left .lbl{
    font-size:11px;font-weight:600;margin-bottom:2px;opacity:.95;
    font-family:'Poppins',sans-serif;
  }
  .left .val{
    font-size:10px;opacity:.92;line-height:1.3;
    word-break:break-word;
    /* Limita a 2 linhas (clamp) pra nao estourar */
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  }
  /* Coluna BRANCA (direita) — recibo completo */
  .right{
    padding:16px 22px 14px;position:relative;color:#111827;
    display:flex;flex-direction:column;
  }
  .logo{
    position:absolute;top:12px;right:18px;
    width:80px;height:80px;border-radius:50%;
    overflow:hidden;background:#0D0D0D;
    border:2px solid #E8917A;
    display:flex;align-items:center;justify-content:center;
    font-size:8px;text-align:center;font-weight:700;line-height:1.1;
    color:#fff;font-family:'Cormorant Garamond',serif;letter-spacing:.5px;
    padding:6px;
  }
  .logo img{width:100%;height:100%;object-fit:contain;}
  .right h1{
    font-size:24px;font-family:'Cormorant Garamond',serif;
    font-weight:700;letter-spacing:.5px;line-height:1;
  }
  .num-pedido{
    font-size:11px;color:#6B7280;font-weight:600;margin-top:2px;
    font-family:'Poppins',sans-serif;letter-spacing:.5px;
  }
  .valor-num{
    font-size:20px;font-weight:700;color:#1F2937;
    margin-top:6px;margin-bottom:10px;
    font-family:'Cormorant Garamond',serif;
  }
  .empresa{
    font-size:10px;font-weight:600;color:#374151;margin-bottom:8px;
    font-family:'Poppins',sans-serif;
    word-break:break-word;line-height:1.3;
  }
  .linha{
    display:flex;gap:6px;align-items:flex-end;margin-bottom:7px;
    font-size:11px;font-family:'Cormorant Garamond',serif;font-weight:500;
  }
  .linha .rotulo{font-weight:600;color:#1F2937;white-space:nowrap;font-size:12px;}
  .linha .traco{
    flex:1;border-bottom:1px solid #1F2937;
    min-height:16px;font-size:11px;color:#111827;
    text-align:left;padding:0 4px 2px;
    /* Quebra de linha permitida (recibo nao pode cortar) */
    word-wrap:break-word;overflow-wrap:break-word;
    font-family:'Poppins',sans-serif;line-height:1.3;
  }
  .data-row{
    display:flex;gap:6px;align-items:flex-end;margin:8px 0 6px;
    font-size:11px;justify-content:center;font-family:'Cormorant Garamond',serif;
  }
  .data-row .traco-d{
    border-bottom:1px solid #1F2937;min-height:16px;text-align:center;padding:0 4px;
    font-family:'Poppins',sans-serif;font-size:11px;font-weight:500;
  }
  .data-row .traco-d.dia{width:50px;}
  .data-row .traco-d.mes{width:110px;}
  .data-row .traco-d.ano{width:55px;}
  /* ASSINATURA — centralizada e elegante */
  .assinatura{
    margin-top:auto;padding-top:10px;
    text-align:center;display:flex;flex-direction:column;align-items:center;
  }
  .assinatura .nome-assinado{
    font-family:'Dancing Script',cursive;
    font-size:24px;color:#1F2937;font-weight:700;
    line-height:1;margin-bottom:-4px;
    transform:rotate(-1.5deg);
  }
  .assinatura .linha-ass{
    border-top:1.5px solid #1F2937;width:260px;
    padding-top:3px;font-size:10px;font-weight:600;
    color:#374151;font-family:'Poppins',sans-serif;
    letter-spacing:.5px;
  }
  .cancelado-stamp{
    position:absolute;top:50%;left:60%;
    transform:translate(-50%,-50%) rotate(-22deg);
    font-size:64px;color:rgba(220,38,38,.4);font-weight:bold;
    border:5px solid rgba(220,38,38,.4);padding:6px 22px;border-radius:14px;
    letter-spacing:4px;pointer-events:none;z-index:10;
    font-family:'Poppins',sans-serif;
  }
  .btn-print{
    display:block;margin:18px auto 0;background:#8B2252;color:#fff;
    border:none;padding:11px 32px;border-radius:8px;font-size:14px;
    cursor:pointer;font-family:'Poppins',sans-serif;font-weight:600;
  }
  @media print{
    body{background:#fff;padding:0;}
    .btn-print{display:none;}
    .recibo{margin:0;box-shadow:none;border-radius:0;}
    @page{size:A4 portrait;margin:10mm;}
  }
</style></head>
<body>
  <button class="btn-print" onclick="window.print()">🖨️ Imprimir Recibo</button>

  <div class="recibo">
    ${r.cancelado ? '<div class="cancelado-stamp">CANCELADO</div>' : ''}

    <!-- COLUNA ESQUERDA (canhoto) -->
    <aside class="left">
      <div>
        <h2>Recibo</h2>
        <div class="num-box" style="margin-top:4px;">${esc(numeroExibido)}</div>
      </div>
      <div>
        <div class="lbl">Recebi de:</div>
        <div class="val">${esc(r.clientEmpresa || r.clientName || '')}</div>
      </div>
      <div>
        <div class="lbl">O valor de</div>
        <div class="val">${valorFmt}</div>
      </div>
      <div style="flex:1;min-height:0;">
        <div class="lbl">Referente a</div>
        <div class="val" style="-webkit-line-clamp:3;">${esc(r.descricao||'')}</div>
      </div>
      <div>
        <div class="lbl">Data:</div>
        <div class="val">${dia}/${String(dt.getMonth()+1).padStart(2,'0')}/${ano}</div>
      </div>
    </aside>

    <!-- COLUNA DIREITA (corpo do recibo) -->
    <section class="right">
      ${logoSrc
        ? `<div class="logo"><img src="${logoSrc}" alt="logo"/></div>`
        : `<div class="logo">FLORICULTURA<br/>LAÇOS<br/>ETERNOS</div>`}

      <h1>Recibo</h1>
      <div class="num-pedido">Nº ${esc(numeroExibido)}</div>
      <div class="valor-num">${valorFmt}</div>

      <div class="empresa">${esc(razao)}${esc(cnpjStr)}</div>

      <div class="linha">
        <span class="rotulo">Recebi de</span>
        <span class="traco">${esc(pagador)}</span>
      </div>
      <div class="linha">
        <span class="rotulo">o valor de</span>
        <span class="traco">${valorFmt} (${esc(extenso)})</span>
      </div>
      <div class="linha">
        <span class="rotulo">referente a</span>
        <span class="traco">${esc(r.descricao||'')} — pago em ${esc(r.paymentMethod||'Dinheiro')}</span>
      </div>

      <!-- "Manaus, ____ de MES de ANO" -->
      <div class="data-row">
        <span style="font-weight:600;font-size:11px;">Manaus,</span>
        <span class="traco-d dia">${dia}</span>
        <span>de</span>
        <span class="traco-d mes">${esc(mesNome)}</span>
        <span>de</span>
        <span class="traco-d ano">${ano}</span>
      </div>

      <!-- ASSINATURA (cursiva — Marcia) — CENTRALIZADA -->
      <div class="assinatura">
        ${em.assinaturaPng
          ? `<img src="${em.assinaturaPng}" alt="assinatura" style="max-height:46px;max-width:220px;display:block;margin:0 auto -6px;object-fit:contain;"/>`
          : `<div class="nome-assinado">${esc(nomeAssinatura)}</div>`}
        <div class="linha-ass">Assinatura</div>
      </div>
    </section>
  </div>

  <div style="text-align:center;font-size:9px;color:#9CA3AF;margin-top:14px;font-family:Arial,sans-serif;">
    Recibo nº ${esc(r.numero)} · Emitido em ${dt.toLocaleString('pt-BR')} por ${esc(r.emitidoPorNome||'—')}
    ${r.cancelado ? '<br/><span style="color:#DC2626;font-weight:bold;">CANCELADO em ' + new Date(r.canceladoEm).toLocaleDateString('pt-BR') + (r.motivoCancelamento ? ' · Motivo: ' + esc(r.motivoCancelamento) : '') + '</span>' : ''}
  </div>
</body></html>`;

  // Overlay com iframe + fallback
  document.querySelectorAll('[data-overlay-recibo]').forEach(el => el.remove());
  const overlay = document.createElement('div');
  overlay.setAttribute('data-overlay-recibo', 'true');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:900px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);margin:auto;">
      <div style="padding:14px 20px;background:#8B2252;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;">
        <span style="color:#fff;font-weight:bold;font-size:15px;">🧾 Recibo ${esc(r.numero)} · ${esc(r.clientName)}</span>
        <div style="display:flex;gap:8px;">
          <button id="btn-rec-do-print" style="background:#fff;color:#8B2252;border:none;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">🖨️ Imprimir</button>
          <button id="btn-rec-close" title="Fechar (Esc)" style="background:rgba(255,255,255,.2);color:#fff;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;font-size:16px;">✕</button>
        </div>
      </div>
      <div style="padding:16px;background:#f5f5f5;">
        <iframe id="rec-iframe" style="width:100%;height:700px;border:none;border-radius:8px;background:#fff;"></iframe>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  setTimeout(() => {
    try {
      const ifr = document.getElementById('rec-iframe');
      ifr.contentDocument.open();
      ifr.contentDocument.write(htmlDoc);
      ifr.contentDocument.close();
    } catch (e) {
      console.error('[recibo] iframe falhou:', e);
    }
  }, 30);

  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc_);
  document.getElementById('btn-rec-close')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('btn-rec-do-print')?.addEventListener('click', () => {
    try {
      const ifr = document.getElementById('rec-iframe');
      if (ifr && ifr.contentWindow) ifr.contentWindow.print();
    } catch (e) {
      const w = window.open('', '_blank', 'width=900,height=700');
      if (w) { w.document.write(htmlDoc); w.document.close(); setTimeout(()=>w.print(),300); }
    }
  });
}

// ── CONFIGURAR RECIBO (admin) ─────────────────────────────────
function _lerImagem(file, maxW) {
  return new Promise((ok, erro) => {
    if (!file || !/^image\//.test(file.type)) return erro(new Error('Escolha uma imagem (PNG)'));
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxW / img.width);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        ok(cv.toDataURL('image/png')); // PNG mantém o fundo transparente
      };
      img.onerror = () => erro(new Error('Não consegui abrir a imagem'));
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}
async function abrirConfigRecibo() {
  await _carregarCfg();
  const em = _emitente();
  const st = { assinaturaPng: em.assinaturaPng, logo: (_rcfg || {}).logo || '' };
  document.getElementById('rec-cfg-modal')?.remove();
  const el = document.createElement('div');
  el.id = 'rec-cfg-modal';
  el.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:12px;';
  el.innerHTML = `<div style="background:#fff;border-radius:16px;max-width:520px;width:100%;max-height:92vh;overflow:auto;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.3);">
    <div style="font-size:17px;font-weight:900;">✍️ Empresa e assinatura do recibo</div>
    <div style="font-size:12px;color:var(--muted);margin:2px 0 12px;">Aparece em todos os recibos emitidos.</div>
    <div class="fr2" style="gap:10px;">
      <div class="fg" style="grid-column:span 2;"><label class="fl">Razão social</label><input class="fi" id="rc-razao" value="${esc(em.razao)}"/></div>
      <div class="fg"><label class="fl">CNPJ</label><input class="fi" id="rc-cnpj" value="${esc(em.cnpj)}" placeholder="00.000.000/0001-00"/></div>
      <div class="fg"><label class="fl">Telefone</label><input class="fi" id="rc-tel" value="${esc(em.telefone)}"/></div>
      <div class="fg" style="grid-column:span 2;"><label class="fl">Endereço</label><input class="fi" id="rc-end" value="${esc(em.endereco)}"/></div>
      <div class="fg" style="grid-column:span 2;"><label class="fl">Nome de quem assina</label><input class="fi" id="rc-nome" value="${esc(em.nomeAssinatura)}"/></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:12px;font-weight:800;margin-bottom:6px;">Assinatura (PNG)</div>
        <div id="rc-ass-prev" style="height:70px;display:flex;align-items:center;justify-content:center;background:repeating-conic-gradient(#F1F5F9 0 25%,#fff 0 50%) 0 0/14px 14px;border-radius:6px;"></div>
        <label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer;">📎 Anexar<input type="file" accept="image/png,image/*" id="rc-ass-file" style="display:none;"/></label>
        <button type="button" class="btn btn-ghost btn-sm" id="rc-ass-rm">Remover</button>
        <div style="font-size:10.5px;color:var(--muted);margin-top:4px;">Sem assinatura, sai o nome em letra cursiva.</div>
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:12px;font-weight:800;margin-bottom:6px;">Logo</div>
        <div id="rc-logo-prev" style="height:70px;display:flex;align-items:center;justify-content:center;"></div>
        <label class="btn btn-ghost btn-sm" style="margin-top:8px;cursor:pointer;">📎 Trocar<input type="file" accept="image/*" id="rc-logo-file" style="display:none;"/></label>
        <button type="button" class="btn btn-ghost btn-sm" id="rc-logo-rm">Usar a padrão</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button type="button" class="btn btn-primary" id="rc-salvar" style="flex:1;justify-content:center;">💾 Salvar</button>
      <button type="button" class="btn btn-ghost" id="rc-fechar">Fechar</button>
    </div></div>`;
  document.body.appendChild(el);
  const pintar = () => {
    el.querySelector('#rc-ass-prev').innerHTML = st.assinaturaPng ? `<img src="${st.assinaturaPng}" style="max-height:64px;max-width:100%;object-fit:contain;"/>` : '<span style="font-size:11px;color:#94A3B8;">sem assinatura</span>';
    el.querySelector('#rc-logo-prev').innerHTML = `<img src="${st.logo || (location.origin + '/logo-lacos-eternos.png')}" style="max-height:64px;max-width:100%;object-fit:contain;"/>`;
  };
  el.querySelector('#rc-ass-file').onchange = async (e) => { try { st.assinaturaPng = await _lerImagem(e.target.files[0], 600); pintar(); } catch (x) { toast('❌ ' + x.message, true); } };
  el.querySelector('#rc-logo-file').onchange = async (e) => { try { st.logo = await _lerImagem(e.target.files[0], 500); pintar(); } catch (x) { toast('❌ ' + x.message, true); } };
  el.querySelector('#rc-ass-rm').onclick = () => { st.assinaturaPng = ''; pintar(); };
  el.querySelector('#rc-logo-rm').onclick = () => { st.logo = ''; pintar(); };
  el.querySelector('#rc-fechar').onclick = () => el.remove();
  el.querySelector('#rc-salvar').onclick = async () => {
    const v = (id) => el.querySelector(id).value.trim();
    const value = { razao: v('#rc-razao'), cnpj: v('#rc-cnpj'), telefone: v('#rc-tel'), endereco: v('#rc-end'), nomeAssinatura: v('#rc-nome'), assinaturaPng: st.assinaturaPng, logo: st.logo };
    try { await PUT('/settings/recibo-config', { value }); _rcfg = value; toast('✅ Dados do recibo salvos'); el.remove(); }
    catch (x) { toast('❌ ' + (x.message || 'Erro ao salvar'), true); }
  };
  pintar();
}
