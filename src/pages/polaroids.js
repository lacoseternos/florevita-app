// ── MODULO POLAROIDS ─────────────────────────────────────────
// Marcia (18/jun/2026): impressao de POLAROIDS e TRILHO DE FOTOS
// (faixa vertical com varias fotos empilhadas) pra anexar nos buques.
//
// 2 origens de fotos:
//   A) MANUAL  — upload direto (varias de uma vez), com legenda editavel.
//   B) PEDIDOS — puxa as fotos que o cliente anexou no site/PDV (campo
//      item.userPhotos, base64). Pedidos com produto "Polaroid" guardam
//      essas fotos; aqui a gente lista e imprime.
//
// 4 formatos (todos em A4 retrato, varios por folha):
//   - Mini      5.4 x 8.6 cm  (estilo Instax mini) — 9 por folha
//   - Quadrada  7.2 x 8.6 cm  (estilo Instax square) — 6 por folha
//   - Classica  8.8 x 10.8 cm (polaroid tradicional) — 4 por folha
//   - Trilho    faixa vertical com N fotos empilhadas — 3 por folha
//
// Exports (consumidos por main.js):
//   - renderPolaroids()
//   - bindPolaroidsEvents()

import { S } from '../state.js';
import { toast } from '../utils/helpers.js';

// ── FORMATOS ─────────────────────────────────────────────────
// A4 retrato util ~200x287mm (margem 5mm). Cada formato define:
//   w,h        = tamanho externo do quadro (mm) — h e calculado no trilho
//   padTop     = borda branca superior (mm)
//   padSide    = bordas brancas laterais (mm)
//   fotoH      = altura da area de foto (mm)
//   cols,rows  = quantos cabem por folha A4
//   gap        = espaco entre unidades na folha (mm)
//   tipo       = 'polaroid' (1 foto/unidade) | 'trilho' (N fotos/unidade)
export const POL_FORMATOS = [
  { id:'mini',     nome:'Mini (5.4 × 8.6 cm)',      emoji:'🎞️', tipo:'polaroid',
    w:54,  padTop:4, padSide:4, fotoH:62,  h:86,  cols:3, rows:3, gap:3,
    desc:'Estilo Instax mini — 9 por folha A4' },
  { id:'quadrada', nome:'Quadrada (7.2 × 8.6 cm)',  emoji:'⬛', tipo:'polaroid',
    w:72,  padTop:4, padSide:5, fotoH:62,  h:86,  cols:2, rows:3, gap:3,
    desc:'Estilo Instax square — 6 por folha A4' },
  { id:'classica', nome:'Clássica (8.8 × 10.8 cm)', emoji:'🖼️', tipo:'polaroid',
    w:88,  padTop:5, padSide:5, fotoH:79,  h:108, cols:2, rows:2, gap:4,
    desc:'Polaroid tradicional — 4 por folha A4' },
  { id:'trilho',   nome:'Trilho de fotos (faixa)',  emoji:'📷', tipo:'trilho',
    w:50,  padTop:3, padSide:3, fotoH:44,  gapInner:2, cols:3, rows:1, gap:4,
    desc:'Faixa vertical com várias fotos — 3 por folha A4' },
];

// A4 retrato — dimensoes da folha.
export const POL_FOLHA = { folhaW:210, folhaH:297, margemFolha:5 };

export const POL_FORMATO_DEFAULT = 'mini';

// ── CONFIG (localStorage) ────────────────────────────────────
const LS_CFG = 'fv_pol_cfg';
const LS_HIST = 'fv_pol_hist';

const CFG_DEFAULT = {
  frameColor: '#FFFFFF',   // cor da moldura (branco classico)
  capFont:   'Caveat',     // fonte da legenda (manuscrita)
  capSize:   13,           // pt
  capColor:  '#374151',
  showCap:   true,         // mostrar legenda
  photoFit:  'cover',      // cover | contain
  // Marcia (18/jun/2026): contorno de recorte — a moldura branca some no
  // papel branco, dificultando o corte. Um contorno fino e visivel ajuda
  // a guilhotina a achar o limite da polaroid.
  borderOn:    true,       // desenha o contorno
  borderColor: '#CBD5E1',  // cinza claro (discreto, mas visivel)
  // Sombra IMPRESSA com opacidade ajustavel (0 = sem sombra). Ajuda a
  // destacar a forma da polaroid no recorte. Antes era so na tela.
  shadowOpacity: 25,       // 0..100 (%)
};

function _getCfg() {
  try {
    const raw = localStorage.getItem(LS_CFG);
    if (raw) return { ...CFG_DEFAULT, ...JSON.parse(raw) };
  } catch (_) {}
  return { ...CFG_DEFAULT };
}
function _saveCfg(cfg) {
  try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (_) {}
}

function _getHist() {
  try { return JSON.parse(localStorage.getItem(LS_HIST) || '[]'); }
  catch { return []; }
}
function _addHist(entry) {
  const h = _getHist();
  h.unshift({ ...entry, id: Date.now()+'_'+Math.random().toString(36).slice(2,5),
              criadoEm: new Date().toISOString(),
              usuario: (S.user?.name || S.user?.email || '—') });
  try { localStorage.setItem(LS_HIST, JSON.stringify(h.slice(0,40))); } catch (_) {}
}

// ── HELPERS ──────────────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
function _normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Decoracao da moldura (sombra + contorno de recorte). Vale na tela E na
// impressao — a sombra impressa e o contorno ajudam a achar o corte.
// Compat: configs antigas sem shadowOpacity caem no campo booleano antigo.
function _frameDeco(cfg) {
  let op = cfg.shadowOpacity;
  if (op == null) op = cfg.shadow === false ? 0 : 25; // migra config antiga
  op = Math.max(0, Math.min(100, Number(op) || 0)) / 100;
  const sombra = op > 0 ? `box-shadow:0 0.7mm 2.2mm rgba(0,0,0,${op.toFixed(2)});` : '';
  const borda  = cfg.borderOn ? `border:0.25mm solid ${cfg.borderColor || '#CBD5E1'};` : '';
  return sombra + borda;
}

const CAP_FONTS = ['Caveat','Dancing Script','Inter','Playfair Display'];
function _polFontsHref() {
  const fam = CAP_FONTS.map(f =>
    'family=' + encodeURIComponent(f).replace(/%20/g,'+') + ':wght@400;600;700'
  ).join('&');
  return 'https://fonts.googleapis.com/css2?' + fam + '&display=swap';
}

// Detecta se um item de pedido e' polaroid (pelo nome).
function _itemEhPolaroid(it) {
  return /polar(oid|óide)/i.test(String(it?.name || it?.productName || ''));
}
// Fotos validas (data-URL ou http) de um item.
function _fotosDoItem(it) {
  const arr = Array.isArray(it?.userPhotos) ? it.userPhotos : [];
  return arr.filter(p => typeof p === 'string' && (p.startsWith('data:') || p.startsWith('http')));
}
// Quantas fotos um pedido ja tem carregadas em S.orders.
function _fotosCarregadasPedido(o) {
  return (o.items || []).reduce((s, it) => s + _fotosDoItem(it).length, 0);
}
// Pedido e' candidato a ter polaroids? (tem fotos OU tem item polaroid)
function _pedidoCandidato(o) {
  if (!o) return false;
  const st = String(o.status || '').trim();
  if (st === 'Cancelado') return false;
  if (_fotosCarregadasPedido(o) > 0) return true;
  return (o.items || []).some(_itemEhPolaroid);
}

// Compressao de imagem (igual padrao do modulo cartoes) — celular 4MB
// vira ~150-300KB. Mantem qualidade boa pra impressao.
function _compressImg(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) return reject(new Error('Não é imagem'));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const r = Math.min(MAX / width, MAX / height);
          width = Math.round(width * r); height = Math.round(height * r);
        }
        const cv = document.createElement('canvas');
        cv.width = width; cv.height = height;
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const jpg = cv.toDataURL('image/jpeg', 0.82);
        if (jpg.length < 700 * 1024) return resolve(jpg);
        resolve(cv.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

// ── STATE INIT ───────────────────────────────────────────────
function _initState() {
  if (!['manual','pedidos','config','historico'].includes(S._polTab)) S._polTab = 'manual';
  if (!POL_FORMATOS.find(f => f.id === S._polFormato)) S._polFormato = POL_FORMATO_DEFAULT;
  if (!Array.isArray(S._polFotos)) S._polFotos = []; // {id, src, legenda, copias, pedido?}
  if (typeof S._polTrilhoQtd !== 'number') S._polTrilhoQtd = 4; // fotos por trilho
  if (typeof S._polPedBusca !== 'string') S._polPedBusca = '';
  if (typeof S._polPedData !== 'string') S._polPedData = '';
  if (!(S._polCfgBuffer && typeof S._polCfgBuffer === 'object')) S._polCfgBuffer = _getCfg();
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────
export function renderPolaroids() {
  _initState();
  const tab = S._polTab;
  const tabBtn = (k, label, icon) => `
    <button data-pol-tab="${k}" class="tab ${tab===k?'active':''}" style="padding:10px 18px;font-size:13px;">${icon} ${label}</button>`;

  return `
<div style="max-width:1180px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:20px;">
    <h1 style="font-family:'Playfair Display',serif;font-size:28px;color:#1E293B;margin:0 0 4px;">📸 Polaroids & Trilho de Fotos</h1>
    <p style="font-size:13px;color:var(--muted);margin:0;">Imprima polaroids e faixas de fotos — manualmente ou puxando as fotos dos pedidos</p>
  </div>

  <div style="display:flex;gap:8px;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:12px;padding:6px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);flex-wrap:wrap;">
    ${tabBtn('manual',    'Manual',     '✍️')}
    ${tabBtn('pedidos',   'Por Pedido', '📋')}
    ${tabBtn('config',    'Aparência',  '🎨')}
    ${tabBtn('historico', 'Histórico',  '📊')}
  </div>

  ${tab === 'manual'    ? _renderTabManual()    : ''}
  ${tab === 'pedidos'   ? _renderTabPedidos()   : ''}
  ${tab === 'config'    ? _renderTabConfig()    : ''}
  ${tab === 'historico' ? _renderTabHistorico() : ''}
</div>`;
}

// ── SELETOR DE FORMATO + AREA DE FOTOS (compartilhado) ───────
function _seletorFormatoHtml() {
  const formatoId = S._polFormato;
  return `
  <div class="card" style="margin-bottom:14px;">
    <div style="font-weight:700;margin-bottom:10px;">🎨 Formato</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
      ${POL_FORMATOS.map(f => {
        const sel = f.id === formatoId;
        return `<button type="button" data-pol-formato="${f.id}"
          style="background:${sel?'linear-gradient(135deg,#7C3AED,#A78BFA)':'#fff'};color:${sel?'#fff':'#1E293B'};
                 border:2px solid ${sel?'#7C3AED':'#E5E7EB'};border-radius:10px;padding:10px 12px;
                 cursor:pointer;text-align:left;font-family:inherit;">
          <div style="font-weight:700;font-size:13px;line-height:1.2;margin-bottom:2px;">${f.emoji} ${f.nome}</div>
          <div style="font-size:10px;opacity:.85;line-height:1.3;">${f.desc}</div>
        </button>`;
      }).join('')}
    </div>
    ${formatoId === 'trilho' ? `
    <div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span style="font-size:12px;font-weight:600;color:#475569;">Fotos por trilho:</span>
      ${[2,3,4,5].map(n => `
        <button type="button" data-pol-trilho-qtd="${n}"
          style="width:38px;height:38px;border-radius:8px;font-weight:800;cursor:pointer;
                 border:2px solid ${S._polTrilhoQtd===n?'#7C3AED':'#E5E7EB'};
                 background:${S._polTrilhoQtd===n?'#7C3AED':'#fff'};color:${S._polTrilhoQtd===n?'#fff':'#1E293B'};">${n}</button>`).join('')}
    </div>` : ''}
  </div>`;
}

// Resumo de quantas folhas vao sair.
function _resumoImpressao() {
  const formato = POL_FORMATOS.find(f => f.id === S._polFormato) || POL_FORMATOS[0];
  const totalFotos = S._polFotos.reduce((s, f) => s + Math.max(1, Number(f.copias)||1), 0);
  if (!totalFotos) return { totalFotos:0, unidades:0, folhas:0 };
  let unidades;
  if (formato.tipo === 'trilho') {
    unidades = Math.ceil(totalFotos / Math.max(2, S._polTrilhoQtd));
  } else {
    unidades = totalFotos;
  }
  const porFolha = formato.cols * formato.rows;
  const folhas = Math.ceil(unidades / porFolha);
  return { totalFotos, unidades, folhas };
}

// ── ABA MANUAL ───────────────────────────────────────────────
function _renderTabManual() {
  const cfg = _getCfg();
  const formato = POL_FORMATOS.find(f => f.id === S._polFormato) || POL_FORMATOS[0];
  const fotos = S._polFotos;
  const r = _resumoImpressao();

  const galeriaHtml = fotos.length ? `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;">
      ${fotos.map((f, i) => `
        <div style="border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff;">
          ${_thumbHtml(f.src, cfg)}
          <input type="text" data-pol-legenda="${i}" value="${_esc(f.legenda||'')}" placeholder="Legenda (opcional)"
            style="width:100%;box-sizing:border-box;margin-top:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;"/>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;gap:6px;">
            <label style="font-size:11px;color:#475569;display:flex;align-items:center;gap:4px;">
              Cópias
              <input type="number" min="1" max="50" data-pol-copias="${i}" value="${Math.max(1,Number(f.copias)||1)}"
                style="width:54px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;text-align:center;"/>
            </label>
            ${f.pedido ? `<span style="font-size:10px;color:#7C3AED;font-weight:700;">#${_esc(f.pedido)}</span>` : ''}
            <button data-pol-rm="${i}" style="background:#FEE2E2;color:#991B1B;border:none;width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:12px;">🗑️</button>
          </div>
        </div>`).join('')}
    </div>` : `
    <div style="text-align:center;padding:40px 20px;color:var(--muted);background:#F8FAFC;border:2px dashed #CBD5E1;border-radius:12px;">
      <div style="font-size:40px;margin-bottom:8px;">📷</div>
      <div style="font-size:14px;">Nenhuma foto ainda. Faça upload ou puxe de um pedido.</div>
    </div>`;

  return `
<div style="display:grid;grid-template-columns:1fr 360px;gap:18px;align-items:start;">
  <div>
    ${_seletorFormatoHtml()}

    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <span>🖼️ Fotos (${fotos.length})</span>
        <div style="display:flex;gap:8px;">
          <label style="background:#7C3AED;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">
            📤 Adicionar fotos
            <input type="file" id="pol-file-add" accept="image/*" multiple style="display:none;"/>
          </label>
          ${fotos.length ? `<button id="pol-clear-all" style="background:#fff;color:#991B1B;border:1.5px solid #FECACA;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">Limpar tudo</button>` : ''}
        </div>
      </div>
      ${galeriaHtml}
    </div>
  </div>

  <div>
    <div class="card" style="position:sticky;top:20px;">
      <div style="font-weight:700;margin-bottom:10px;">🖨️ Imprimir</div>
      <div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:12px;font-size:13px;color:#5B21B6;line-height:1.7;">
        <div><strong>${fotos.length}</strong> foto(s) na fila · <strong>${r.totalFotos}</strong> com cópias</div>
        ${formato.tipo === 'trilho'
          ? `<div><strong>${r.unidades}</strong> trilho(s) de até ${S._polTrilhoQtd} fotos</div>`
          : `<div><strong>${r.unidades}</strong> polaroid(s)</div>`}
        <div>≈ <strong>${r.folhas}</strong> folha(s) A4</div>
        <div style="font-size:11px;opacity:.8;">Formato: ${formato.nome}</div>
      </div>
      <button id="pol-imprimir" ${r.totalFotos?'':'disabled'}
        style="width:100%;margin-top:12px;background:${r.totalFotos?'linear-gradient(135deg,#7C3AED,#A78BFA)':'#CBD5E1'};color:#fff;border:none;padding:14px;border-radius:10px;font-size:14px;font-weight:800;cursor:${r.totalFotos?'pointer':'not-allowed'};letter-spacing:.4px;">
        🖨️ Imprimir ${r.unidades || ''} ${formato.tipo==='trilho'?'trilho(s)':'polaroid(s)'}
      </button>
      <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:#78350F;line-height:1.5;">
        💡 Use papel fotográfico ou A4 180g+. As fotos saem com a moldura branca (corte com guilhotina).
      </div>
    </div>
  </div>
</div>`;
}

// ── ABA POR PEDIDO ───────────────────────────────────────────
function _renderTabPedidos() {
  const busca = S._polPedBusca || '';
  const buscaN = _normalizar(busca);

  let pedidos = (S.orders || []).filter(_pedidoCandidato);

  if (buscaN) {
    pedidos = pedidos.filter(o => {
      const num = _normalizar((o.orderNumber||o.numero||'').toString());
      const cli = _normalizar(o.clientName || o.client?.name || '');
      const rec = _normalizar(o.recipient || o.destinatario || o.recipientName || '');
      return num.includes(buscaN) || cli.includes(buscaN) || rec.includes(buscaN);
    });
  }
  // Ordena: mais recentes primeiro
  pedidos = pedidos.slice().sort((a,b) =>
    new Date(b.createdAt||0).getTime() - new Date(a.createdAt||0).getTime()).slice(0, 80);

  const linhas = pedidos.map(o => {
    const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
    const cli = o.clientName || o.client?.name || '—';
    const rec = o.recipient || o.destinatario || o.recipientName || '';
    const nFotos = _fotosCarregadasPedido(o);
    const temPolaroid = (o.items||[]).some(_itemEhPolaroid);
    const fotosLabel = nFotos > 0
      ? `<span style="color:#15803D;font-weight:700;">${nFotos} foto(s)</span>`
      : (temPolaroid ? `<span style="color:#B45309;font-weight:700;">fotos no pedido — carregar</span>` : `<span style="color:#94A3B8;">sem fotos</span>`);
    const thumbs = nFotos > 0
      ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;">${
          (o.items||[]).flatMap(_fotosDoItem).slice(0,6).map(p =>
            `<img src="${p}" style="width:38px;height:38px;object-fit:cover;border-radius:4px;border:1px solid #E5E7EB;"/>`).join('')
        }${nFotos>6?`<span style="font-size:11px;color:#64748B;align-self:center;">+${nFotos-6}</span>`:''}</div>`
      : '';
    return `
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px;background:#fff;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:13px;color:#7C3AED;font-weight:800;font-family:Monaco,monospace;">#${_esc(num)}</span>
            <strong style="font-size:13px;">${_esc(cli)}</strong>
            ${rec ? `<span style="color:#64748B;font-size:12px;">→ ${_esc(rec)}</span>` : ''}
          </div>
          <div style="font-size:12px;margin-top:3px;">${fotosLabel}</div>
          ${thumbs}
        </div>
        <button data-pol-add-ped="${_esc(String(o._id||''))}"
          style="background:#7C3AED;color:#fff;border:none;padding:9px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">
          ➕ Adicionar fotos
        </button>
      </div>`;
  }).join('');

  return `
<div style="max-width:760px;margin:0 auto;">
  ${_seletorFormatoHtml()}
  <div class="card" style="margin-bottom:14px;">
    <div style="font-weight:700;margin-bottom:10px;">📋 Pedidos com fotos do cliente</div>
    <input type="text" id="pol-ped-busca" value="${_esc(busca)}" placeholder="Buscar por nº do pedido, cliente ou destinatário..."
      style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;margin-bottom:12px;"/>
    <div style="display:flex;flex-direction:column;gap:10px;max-height:560px;overflow:auto;">
      ${linhas || `<div style="text-align:center;padding:30px;color:var(--muted);">Nenhum pedido com fotos encontrado.</div>`}
    </div>
  </div>
  ${S._polFotos.length ? `
  <div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <span style="font-size:13px;color:#475569;"><strong>${S._polFotos.length}</strong> foto(s) na fila de impressão.</span>
    <button id="pol-go-manual" style="background:#7C3AED;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">Ver fila e imprimir →</button>
  </div>` : ''}
</div>`;
}

// ── ABA APARENCIA (config) ───────────────────────────────────
function _renderTabConfig() {
  const cfg = S._polCfgBuffer || _getCfg();
  const formato = POL_FORMATOS.find(f => f.id === S._polFormato) || POL_FORMATOS[0];
  const fontOpts = CAP_FONTS.map(f => `<option value="${f}" ${f===cfg.capFont?'selected':''}>${f}</option>`).join('');
  return `
<div style="display:grid;grid-template-columns:1fr 360px;gap:18px;align-items:start;">
  <div class="card">
    <div style="font-weight:700;margin-bottom:14px;">🎨 Aparência da polaroid</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Cor da moldura
        <input type="color" data-pol-cfg="frameColor" value="${cfg.frameColor}" style="height:34px;border:1px solid var(--border);border-radius:6px;cursor:pointer;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Fonte da legenda
        <select data-pol-cfg="capFont" style="padding:8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">${fontOpts}</select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Tamanho da legenda (${cfg.capSize}pt)
        <input type="range" min="8" max="22" step="1" data-pol-cfg="capSize" value="${cfg.capSize}"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Cor da legenda
        <input type="color" data-pol-cfg="capColor" value="${cfg.capColor}" style="height:34px;border:1px solid var(--border);border-radius:6px;cursor:pointer;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Ajuste da foto
        <select data-pol-cfg="photoFit" style="padding:8px;border:1px solid var(--border);border-radius:6px;font-size:12px;">
          <option value="cover" ${cfg.photoFit==='cover'?'selected':''}>Preencher (corta excesso)</option>
          <option value="contain" ${cfg.photoFit==='contain'?'selected':''}>Inteira (com bordas)</option>
        </select>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Cor do contorno (recorte)
        <input type="color" data-pol-cfg="borderColor" value="${cfg.borderColor||'#CBD5E1'}" style="height:34px;border:1px solid var(--border);border-radius:6px;cursor:pointer;"/>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:#475569;">
        Opacidade da sombra (${cfg.shadowOpacity != null ? cfg.shadowOpacity : 25}%)
        <input type="range" min="0" max="100" step="5" data-pol-cfg="shadowOpacity" value="${cfg.shadowOpacity != null ? cfg.shadowOpacity : 25}"/>
      </label>
    </div>
    <div style="display:flex;gap:18px;margin-top:14px;flex-wrap:wrap;">
      <label style="font-size:12px;font-weight:600;color:#475569;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" data-pol-cfg="showCap" ${cfg.showCap?'checked':''}/> Mostrar legenda
      </label>
      <label style="font-size:12px;font-weight:600;color:#475569;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" data-pol-cfg="borderOn" ${cfg.borderOn?'checked':''}/> Mostrar contorno no recorte
      </label>
    </div>
    <div style="background:#F5F3FF;border:1px dashed #DDD6FE;border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:#5B21B6;line-height:1.5;">
      ✂️ O contorno e a sombra saem na impressão pra você enxergar o limite da polaroid na hora de cortar. Deixe a sombra em 0% se preferir sem.
    </div>
    <button id="pol-cfg-save" style="margin-top:16px;background:#7C3AED;color:#fff;border:none;padding:11px 20px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">💾 Salvar aparência</button>
  </div>

  <div class="card" style="position:sticky;top:20px;">
    <div style="font-weight:700;margin-bottom:10px;">👁️ Preview</div>
    <div id="pol-cfg-preview" style="display:flex;justify-content:center;padding:18px;background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:10px;">
      ${formato.tipo==='trilho'
        ? _previewTrilhoHtml(_fotosDemo(S._polTrilhoQtd), formato, cfg, 120)
        : _previewUnidadeHtml('', formato, cfg, 200, 'Maria 💛')}
    </div>
  </div>
</div>`;
}

function _fotosDemo(n) {
  return Array.from({length: Math.max(2, n||4)}, () => ({ src:'', legenda:'' }));
}

// ── ABA HISTORICO ────────────────────────────────────────────
function _renderTabHistorico() {
  const hist = _getHist();
  if (!hist.length) {
    return `<div class="card" style="text-align:center;padding:40px;color:var(--muted);">Nenhuma impressão registrada ainda.</div>`;
  }
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:12px;">📊 Últimas impressões</div>
  <div style="display:flex;flex-direction:column;gap:8px;">
    ${hist.map(h => {
      const dt = new Date(h.criadoEm);
      const dtStr = isNaN(dt) ? '' : dt.toLocaleString('pt-BR');
      const f = POL_FORMATOS.find(x => x.id === h.formatoId);
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#F8FAFC;border-radius:8px;font-size:12px;">
        <span><strong>${h.totalFotos||0}</strong> foto(s) · ${f?f.nome:h.formatoId} · ${h.folhas||0} folha(s)</span>
        <span style="color:#94A3B8;">${dtStr} · ${_esc(h.usuario||'')}</span>
      </div>`;
    }).join('')}
  </div>
</div>`;
}

// Thumbnail simples pra galeria da aba Manual — moldura polaroid fixa,
// independente do formato selecionado (evita depender de formato.h, que
// nao existe no trilho).
function _thumbHtml(src, cfg) {
  const fit = cfg.photoFit === 'contain' ? 'contain' : 'cover';
  const fotoHtml = src
    ? `<img src="${src}" style="width:100%;height:100%;object-fit:${fit};display:block;"/>`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#EEF2F7;color:#94A3B8;font-size:12px;">foto</div>`;
  return `
    <div style="width:100%;aspect-ratio:5/6;background:${cfg.frameColor};${_frameDeco(cfg)}
                padding:6px 6px 0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;">
      <div style="flex:1;overflow:hidden;background:#fff;">${fotoHtml}</div>
      <div style="height:22px;"></div>
    </div>`;
}

// ── RENDER DE UMA UNIDADE (polaroid ou demo) ─────────────────
// previewW = largura em px pra exibir na tela (escala). Pra impressao,
// usamos mm direto (escalaMm=true).
function _previewUnidadeHtml(src, formato, cfg, previewW, legendaDemo) {
  const mmToPx = previewW / formato.w;          // escala px/mm pra caber na tela
  const px = mm => (mm * mmToPx).toFixed(1) + 'px';
  return _polaroidBox(src, formato, cfg, px, legendaDemo, true);
}
function _previewTrilhoHtml(fotos, formato, cfg, previewW) {
  const mmToPx = previewW / formato.w;
  const px = mm => (mm * mmToPx).toFixed(1) + 'px';
  return _trilhoBox(fotos, formato, cfg, px, true);
}

// Gera o HTML de UMA polaroid. `unit` = funcao mm->css (px na tela, mm no print).
function _polaroidBox(src, formato, cfg, unit, legenda, tela) {
  const fotoW = formato.w - formato.padSide * 2;
  const capH  = formato.h - formato.padTop - formato.fotoH; // area inferior (legenda)
  const fit = cfg.photoFit === 'contain' ? 'contain' : 'cover';
  const deco = _frameDeco(cfg);
  const fotoHtml = src
    ? `<img src="${src}" style="width:100%;height:100%;object-fit:${fit};display:block;"/>`
    : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#EEF2F7;color:#94A3B8;font-size:${unit(8)};">foto</div>`;
  const capHtml = (cfg.showCap && (legenda || tela))
    ? `<div style="height:${unit(capH)};display:flex;align-items:center;justify-content:center;text-align:center;padding:0 ${unit(2)};
            font-family:'${cfg.capFont}',cursive;font-size:${cfg.capSize}pt;color:${cfg.capColor};line-height:1.1;overflow:hidden;">${_esc(legenda||'')}</div>`
    : `<div style="height:${unit(capH)};"></div>`;
  return `
    <div style="width:${unit(formato.w)};height:${unit(formato.h)};background:${cfg.frameColor};${deco}
                padding:${unit(formato.padTop)} ${unit(formato.padSide)} 0;box-sizing:border-box;
                display:flex;flex-direction:column;overflow:hidden;">
      <div style="width:${unit(fotoW)};height:${unit(formato.fotoH)};overflow:hidden;background:#fff;align-self:center;">
        ${fotoHtml}
      </div>
      ${capHtml}
    </div>`;
}

// Gera o HTML de UM trilho (faixa com N fotos empilhadas).
function _trilhoBox(fotos, formato, cfg, unit, tela) {
  const fotoW = formato.w - formato.padSide * 2;
  const gapInner = formato.gapInner || 2;
  const capH = 14; // rodape do trilho (legenda/assinatura)
  const n = fotos.length;
  const alturaTotal = formato.padTop + n * formato.fotoH + (n - 1) * gapInner + capH;
  const fit = cfg.photoFit === 'contain' ? 'contain' : 'cover';
  const deco = _frameDeco(cfg);
  const legendaTrilho = fotos.find(f => f && f.legenda) ? fotos.find(f => f && f.legenda).legenda : '';
  const fotosHtml = fotos.map((f, i) => {
    const src = f && f.src;
    const inner = src
      ? `<img src="${src}" style="width:100%;height:100%;object-fit:${fit};display:block;"/>`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#EEF2F7;color:#94A3B8;font-size:${unit(7)};">foto</div>`;
    return `<div style="width:${unit(fotoW)};height:${unit(formato.fotoH)};overflow:hidden;background:#fff;align-self:center;${i>0?`margin-top:${unit(gapInner)};`:''}">${inner}</div>`;
  }).join('');
  const capHtml = cfg.showCap
    ? `<div style="height:${unit(capH)};display:flex;align-items:center;justify-content:center;text-align:center;
            font-family:'${cfg.capFont}',cursive;font-size:${Math.max(9,cfg.capSize-2)}pt;color:${cfg.capColor};overflow:hidden;">${_esc(legendaTrilho)}</div>`
    : `<div style="height:${unit(capH)};"></div>`;
  return `
    <div style="width:${unit(formato.w)};height:${unit(alturaTotal)};background:${cfg.frameColor};${deco}
                padding:${unit(formato.padTop)} ${unit(formato.padSide)} 0;box-sizing:border-box;
                display:flex;flex-direction:column;overflow:hidden;">
      ${fotosHtml}
      ${capHtml}
    </div>`;
}

// ── IMPRESSAO ────────────────────────────────────────────────
function imprimirPolaroids() {
  const fotos = S._polFotos || [];
  if (!fotos.length) return toast('❌ Nenhuma foto pra imprimir', true);
  const formato = POL_FORMATOS.find(f => f.id === S._polFormato) || POL_FORMATOS[0];
  const cfg = _getCfg();

  // Expande copias.
  const expand = [];
  fotos.forEach(f => {
    const c = Math.max(1, Number(f.copias) || 1);
    for (let i = 0; i < c; i++) expand.push(f);
  });

  // Monta as "unidades" (cada celula da folha): polaroid = 1 foto;
  // trilho = grupo de N fotos.
  const unidadesHtml = [];
  const unitMm = mm => mm + 'mm';
  if (formato.tipo === 'trilho') {
    const n = Math.max(2, S._polTrilhoQtd || 4);
    for (let i = 0; i < expand.length; i += n) {
      const grupo = expand.slice(i, i + n);
      unidadesHtml.push(_trilhoBox(grupo, formato, cfg, unitMm, false));
    }
  } else {
    expand.forEach(f => unidadesHtml.push(_polaroidBox(f.src, formato, cfg, unitMm, f.legenda, false)));
  }

  if (unidadesHtml.length > 120) {
    const ok = confirm(`Vai gerar ${unidadesHtml.length} unidade(s) de impressão.\nPode demorar um pouco pra montar a visualização.\n\nContinuar?`);
    if (!ok) return;
  }

  // Altura da unidade (pra grid). Trilho tem altura variavel.
  const n = Math.max(2, S._polTrilhoQtd || 4);
  const unidadeH = formato.tipo === 'trilho'
    ? (formato.padTop + n * formato.fotoH + (n - 1) * (formato.gapInner||2) + 14)
    : formato.h;

  const porFolha = formato.cols * formato.rows;
  const folhasHtml = [];
  for (let i = 0; i < unidadesHtml.length; i += porFolha) {
    const lote = unidadesHtml.slice(i, i + porFolha);
    folhasHtml.push(`
      <div class="pol-folha" style="width:${POL_FOLHA.folhaW}mm;height:${POL_FOLHA.folhaH}mm;padding:${POL_FOLHA.margemFolha}mm;box-sizing:border-box;page-break-after:always;">
        <div style="display:grid;grid-template-columns:repeat(${formato.cols},${formato.w}mm);grid-auto-rows:${unidadeH}mm;gap:${formato.gap}mm;justify-content:center;align-content:start;height:100%;">
          ${lote.join('')}
        </div>
      </div>`);
  }

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return toast('❌ Pop-up bloqueado — habilite no navegador', true);

  const totalFolhas = folhasHtml.length;
  const totalFotos = expand.length;

  w.document.open();
  w.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Polaroids — ${totalFotos} foto(s) · ${totalFolhas} folha(s)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${_polFontsHref()}" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin:0; padding:0; font-family: Arial, sans-serif; background:#F1F5F9; }
    .pol-folha { background:#fff; margin:10px auto; box-shadow:0 2px 8px rgba(0,0,0,.1); }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      body { background:#fff; margin:0; padding:0; }
      .pol-folha { margin:0 !important; box-shadow:none; }
      .no-print { display:none !important; }
    }
    .bar { background:#7C3AED;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10; }
    .bar h1 { margin:0;font-size:16px;font-weight:700; }
    .bar button { background:#fff;color:#7C3AED;border:none;padding:10px 22px;border-radius:8px;font-weight:800;cursor:pointer;font-size:13px; }
  </style>
</head>
<body>
  <div class="bar no-print">
    <h1>📸 ${totalFotos} foto(s) · ${totalFolhas} folha(s) A4 · ${formato.nome}</h1>
    <button onclick="window.print()">🖨️ Imprimir</button>
  </div>
  ${folhasHtml.join('')}
  <script>
    function _go(){ setTimeout(function(){ window.print(); }, 250); }
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(_go); }
    else { setTimeout(_go, 700); }
  <\/script>
</body>
</html>`);
  w.document.close();

  _addHist({ formatoId: formato.id, totalFotos, folhas: totalFolhas });
  toast(`🖨️ ${totalFotos} foto(s) em ${totalFolhas} folha(s)!`);
}

// ── COLETA DE FOTOS DE UM PEDIDO (com lazy-fetch) ────────────
async function _coletarFotosPedido(orderId) {
  let o = (S.orders || []).find(x => String(x._id||x.id||'') === String(orderId));
  if (!o) return [];
  let fotos = (o.items || []).flatMap((it, idxIt) =>
    _fotosDoItem(it).map(src => ({ src, item: it.name || it.productName || '' })));
  // Light-load: pedido tem item polaroid mas as fotos nao vieram no S.orders.
  if (!fotos.length && (o.items||[]).some(_itemEhPolaroid)) {
    try {
      const { GET } = await import('../services/api.js');
      const full = await GET('/orders/' + String(orderId));
      if (full && Array.isArray(full.items)) {
        // Atualiza S.orders com os itens completos (cacheia as fotos)
        const i = (S.orders||[]).findIndex(x => String(x._id||x.id||'') === String(orderId));
        if (i >= 0) S.orders[i] = { ...S.orders[i], items: full.items };
        o = S.orders[i] || full;
        fotos = (full.items || []).flatMap(it =>
          _fotosDoItem(it).map(src => ({ src, item: it.name || it.productName || '' })));
      }
    } catch (e) {
      toast('⚠️ Não consegui carregar as fotos do pedido: ' + (e.message||'erro'), true);
      return [];
    }
  }
  const num = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
  const rec = o.recipient || o.destinatario || o.recipientName || '';
  return fotos.map(f => ({
    id: Date.now()+'_'+Math.random().toString(36).slice(2,7),
    src: f.src,
    legenda: rec || ('#'+num),
    copias: 1,
    pedido: num,
  }));
}

// ── BIND EVENTS ──────────────────────────────────────────────
export function bindPolaroidsEvents() {
  _initState();
  const render = () => import('../main.js').then(m => m.render()).catch(()=>{});

  // Tabs
  document.querySelectorAll('[data-pol-tab]').forEach(b => {
    b.onclick = () => { S._polTab = b.dataset.polTab; render(); };
  });
  // Formato
  document.querySelectorAll('[data-pol-formato]').forEach(b => {
    b.onclick = () => { S._polFormato = b.dataset.polFormato; render(); };
  });
  // Fotos por trilho
  document.querySelectorAll('[data-pol-trilho-qtd]').forEach(b => {
    b.onclick = () => { S._polTrilhoQtd = Number(b.dataset.polTrilhoQtd)||4; render(); };
  });

  // Upload manual (multiplo)
  const fileAdd = document.getElementById('pol-file-add');
  if (fileAdd) {
    fileAdd.onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      toast(`⏳ Processando ${files.length} foto(s)...`);
      for (const file of files) {
        if (file.size > 15 * 1024 * 1024) { toast(`❌ ${file.name}: maior que 15MB`, true); continue; }
        try {
          const src = await _compressImg(file);
          S._polFotos.push({ id: Date.now()+'_'+Math.random().toString(36).slice(2,7), src, legenda:'', copias:1 });
        } catch (err) { toast('❌ '+(err.message||'erro na imagem'), true); }
      }
      toast(`✅ ${files.length} foto(s) adicionada(s)`);
      render();
    };
  }

  // Legenda / copias / remover (aba manual)
  document.querySelectorAll('[data-pol-legenda]').forEach(el => {
    el.oninput = () => { const i = Number(el.dataset.polLegenda); if (S._polFotos[i]) S._polFotos[i].legenda = el.value; };
  });
  document.querySelectorAll('[data-pol-copias]').forEach(el => {
    el.onchange = () => { const i = Number(el.dataset.polCopias); if (S._polFotos[i]) S._polFotos[i].copias = Math.max(1, Math.min(50, Number(el.value)||1)); render(); };
  });
  document.querySelectorAll('[data-pol-rm]').forEach(b => {
    b.onclick = () => { const i = Number(b.dataset.polRm); S._polFotos.splice(i, 1); render(); };
  });
  document.getElementById('pol-clear-all')?.addEventListener('click', () => {
    if (!confirm('Remover todas as fotos da fila?')) return;
    S._polFotos = []; render();
  });

  // Imprimir
  document.getElementById('pol-imprimir')?.addEventListener('click', () => {
    try { imprimirPolaroids(); } catch (e) { console.error('[polaroids] imprimir', e); toast('❌ Erro ao imprimir: '+(e.message||''), true); }
  });

  // ── Aba pedidos ──
  const buscaEl = document.getElementById('pol-ped-busca');
  if (buscaEl) {
    buscaEl.oninput = () => { S._polPedBusca = buscaEl.value; };
    buscaEl.onchange = () => render();
    // Re-render com debounce leve pra filtrar enquanto digita
    let t; buscaEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 300); });
  }
  document.querySelectorAll('[data-pol-add-ped]').forEach(b => {
    b.onclick = async () => {
      b.disabled = true; b.textContent = '⏳ carregando...';
      const novas = await _coletarFotosPedido(b.dataset.polAddPed);
      if (!novas.length) { toast('❌ Esse pedido não tem fotos anexadas', true); render(); return; }
      S._polFotos.push(...novas);
      toast(`✅ ${novas.length} foto(s) adicionada(s) à fila`);
      render();
    };
  });
  document.getElementById('pol-go-manual')?.addEventListener('click', () => { S._polTab = 'manual'; render(); });

  // ── Aba config ──
  document.querySelectorAll('[data-pol-cfg]').forEach(el => {
    const key = el.dataset.polCfg;
    const handler = () => {
      if (!S._polCfgBuffer) S._polCfgBuffer = _getCfg();
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range') v = Number(el.value)||0;
      else v = el.value;
      S._polCfgBuffer[key] = v;
      _updateCfgPreview();
      // Atualiza o label dos ranges ao vivo
      if (key === 'capSize') {
        const lbl = el.closest('label'); if (lbl) lbl.childNodes[0].nodeValue = `Tamanho da legenda (${v}pt) `;
      }
      if (key === 'shadowOpacity') {
        const lbl = el.closest('label'); if (lbl) lbl.childNodes[0].nodeValue = `Opacidade da sombra (${v}%) `;
      }
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
  document.getElementById('pol-cfg-save')?.addEventListener('click', () => {
    _saveCfg(S._polCfgBuffer || _getCfg());
    toast('💾 Aparência salva');
    render();
  });
}

function _updateCfgPreview() {
  const cont = document.getElementById('pol-cfg-preview');
  if (!cont) return;
  const cfg = S._polCfgBuffer || _getCfg();
  const formato = POL_FORMATOS.find(f => f.id === S._polFormato) || POL_FORMATOS[0];
  cont.innerHTML = formato.tipo === 'trilho'
    ? _previewTrilhoHtml(_fotosDemo(S._polTrilhoQtd), formato, cfg, 120)
    : _previewUnidadeHtml('', formato, cfg, 200, 'Maria 💛');
}
