// ── MODULO CARTÕES ───────────────────────────────────────────
// Gera e imprime cartoes personalizados em 3 FORMATOS:
//   A) Horizontal  10.8 x 7.2 cm  — A4 PORTRAIT, 3 por folha (1x3)
//   B) Vertical     6.5 x 9.7 cm  — A4 PORTRAIT, 6 por folha (3x2)
//   C) A4 inteiro  20.0 x 28.7 cm — 1 por folha (premium / eventos)
//
// TODAS as folhas A4 PORTRAIT, margem 5mm.
//
// Cada formato tem configuracoes 100% customizaveis (branding, fundo,
// marca d'agua, tipografia, espacamento, bordas, de/para) — persistidas
// em localStorage.fv_cartoes_config_<formato>. A aba "Configuracoes"
// aparece SOMENTE para admin (S.user.role==='Administrador' OU
// S.user.cargo==='admin').
//
// Mensagem suporta MARKDOWN SIMPLES:
//   - *negrito*  → <strong>
//   - _italico_  → <em>
//   - \n         → <br/>
//
// Campos opcionais "Para:" e "De:" destacam-se no topo da mensagem.
//
// Exports PRESERVADOS (consumidos por main.js / relatorios.js):
//   - renderCartoes()
//   - bindCartoesEvents()
//   - imprimirCartoes(lista, opts)
//   - imprimirCartoesDePedidos(pedidos, origemLabel)
//
// Refinado em 29/mai/2026 a pedido da Marcia (5 melhorias).

import { S } from '../state.js';
import { toast } from '../utils/helpers.js';

// ── FORMATOS (substituem os antigos "templates") ─────────────
// TODOS em A4 PORTRAIT (210x297mm), margem 5mm => util 200x287mm.
// Marcia (30/mai/2026): novo layout solicitado:
//   Horizontal: 2 colunas x 4 linhas = 8 por pagina A4 retrato.
//   Vertical:   3 colunas x 3 linhas = 9 por pagina A4 retrato.
//   A4:         1 por pagina (inalterado).
// Dimensoes ajustadas pra caber em A4 (210x297mm, margem 5mm = util 200x287mm).
//   Horizontal: 95x67mm (2x95=190 <200; 4x67+3*2=274 <287) com gap 2mm.
//   Vertical:   62x90mm (3x62+2*2=190 <200; 3x90+2*2=274 <287) com gap 2mm.
export const CARTAO_FORMATOS = [
  { id:'horizontal', nome:'Horizontal (9.5 × 6.7 cm)', emoji:'▭',
    w:95, h:67,  cols:2, rows:4, orientacao:'portrait',
    folhaW:210, folhaH:297, margemFolha:5, gap:2,
    desc:'8 por folha A4 retrato — 2 colunas x 4 linhas' },
  { id:'vertical',   nome:'Vertical (6.2 × 9.0 cm)',   emoji:'▯',
    w:62,  h:90,  cols:3, rows:3, orientacao:'portrait',
    folhaW:210, folhaH:297, margemFolha:5, gap:2,
    desc:'9 por folha A4 retrato — 3 colunas x 3 linhas' },
  { id:'a4',         nome:'A4 inteiro (1 por folha)',   emoji:'▮',
    w:200, h:287, cols:1, rows:1, orientacao:'portrait',
    folhaW:210, folhaH:297, margemFolha:5, gap:0,
    desc:'1 por folha A4 — premium / eventos especiais' },
  // Marcia (09/jun/2026): formato dedicado pra impressao em massa do
  // Chao de Datas Comemorativas. Mesmas dimensoes do horizontal (mesmo
  // papel), mas com TEMPLATE INDEPENDENTE — pode ter fonte/cor/borda/
  // margem diferentes do template padrao. Configurado em
  // Configuracoes > Cartoes selecionando este formato.
  { id:'chaoDatas',  nome:'🌹 Chão de Datas (9.5 × 6.7 cm)', emoji:'🌹',
    w:95, h:67,  cols:2, rows:4, orientacao:'portrait',
    // Marcia (09/jun/2026): margemFolha 0.3mm — quase encostando na borda
    // do A4 pra aproveitar ao maximo o papel na producao em massa.
    folhaW:210, folhaH:297, margemFolha:0.3, gap:2,
    desc:'Template SEPARADO so para impressao em massa em datas comemorativas. Mesmo papel do horizontal, mas com personalizacao propria.' },
];

export const CARTAO_FORMATO_DEFAULT = 'horizontal';

// ── COMPAT com versao anterior ───────────────────────────────
export const CARTAO_W_MM     = 95; // legacy (horizontal)
export const CARTAO_H_MM     = 67;
export const CARTAO_COLS     = 2;
export const CARTAO_ROWS     = 4;
export const CARTAO_GAP_MM   = 2;
export const CARTAO_POR_FOLHA= 8;
export const CARTAO_TEMPLATES = CARTAO_FORMATOS; // alias antigo

const INSTAGRAM_DEFAULT  = '@floriculturalacoseternos';
const RAZAO_SOCIAL_DEFAULT = 'Floricultura Laços Eternos';

// ── PERMISSAO ────────────────────────────────────────────────
function _isAdmin() {
  const role  = String(S.user?.role  || '').toLowerCase();
  const cargo = String(S.user?.cargo || '').toLowerCase();
  return role === 'administrador' || cargo === 'admin';
}

// Espelha o backend/utils/unidadeRules.js — minimal pra cartoes nao
// ter que importar outras dependencias.
function _normalizeUnidadeSimple(u) {
  if (!u) return '';
  const s = String(u).toLowerCase().trim();
  if (!s) return '';
  if (s.includes('novo') && s.includes('aleixo')) return 'novo_aleixo';
  if (s.includes('allegro')) return 'allegro';
  if (s.includes('cdle') || (s.includes('centro') && s.includes('distribui'))) return 'cdle';
  if (['novo_aleixo','allegro','cdle','todas'].includes(s)) return s;
  return s.replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}

// ── LOCAL STORAGE ────────────────────────────────────────────
const LS_FORMATO_PADRAO = 'fv_cartoes_formato_padrao';
const LS_CONFIG_PREFIX  = 'fv_cartoes_config_'; // + formato.id
const LS_HIST_KEY       = 'fv_cartoes_hist';

function _getFormatoPadrao() {
  try {
    const v = localStorage.getItem(LS_FORMATO_PADRAO);
    if (v && CARTAO_FORMATOS.find(f => f.id === v)) return v;
  } catch (_) {}
  return CARTAO_FORMATO_DEFAULT;
}
function _saveFormatoPadrao(id) {
  try { localStorage.setItem(LS_FORMATO_PADRAO, id); } catch (_) {}
}
function _getHistorico() {
  try { return JSON.parse(localStorage.getItem(LS_HIST_KEY) || '[]'); }
  catch { return []; }
}
function _saveHistorico(arr) {
  try { localStorage.setItem(LS_HIST_KEY, JSON.stringify(arr.slice(0, 50))); } catch (_) {}
}
function _addHistorico(entry) {
  const hist = _getHistorico();
  hist.unshift({
    ...entry,
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    criadoEm: new Date().toISOString(),
    usuario: (S.user?.name || S.user?.email || '—'),
  });
  _saveHistorico(hist);
}

// ── BRANDING DO SISTEMA (fallback) ───────────────────────────
export function _getBranding() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('fv_config') || '{}'); } catch (_) {}
  let ec = {};
  try { ec = JSON.parse(localStorage.getItem('fv_ecommerce_config') || '{}'); } catch (_) {}
  const logo  = ec.siteLogo || cfg.siteLogo || cfg.loginLogo || cfg.logo || '';
  const insta = (ec.social && ec.social.instagram) || INSTAGRAM_DEFAULT;
  return { logo, instagram: insta };
}

// ── CONFIGURACOES POR FORMATO ────────────────────────────────
function _getDefaultConfig(formatoId) {
  const branding = _getBranding();
  const base = {
    // branding
    logo: branding.logo || '',
    logoPos: 'topo-centro',
    logoSize: 35,
    instagram: branding.instagram || INSTAGRAM_DEFAULT,
    razaoSocial: RAZAO_SOCIAL_DEFAULT,
    showInstagram: true,
    showRazao: true,
    razaoPos: 'topo-centro',
    // fundo
    bgImage: '',
    bgImageOpacity: 100,
    // Marcia (09/jun/2026): bgImageFit controla como a imagem se ajusta
    // ao cartao. 'contain' = inteira aparece (com bordas se nao bater
    // o aspect ratio); 'cover' = preenche tudo cortando o excesso.
    // Default 'contain' pra nunca cortar info da imagem.
    bgImageFit: 'contain',
    bgColor: '#FFFFFF',
    gradientOn: false,
    gradientFrom: '#FFFFFF',
    gradientTo: '#FAE8E6',
    // marca dagua — pode ser TEXTO ou IMAGEM (upload). Se houver imagem,
    // renderiza imagem; se nao, renderiza texto. Permite os dois desligados.
    wmText: '',
    wmColor: '#E5E7EB',
    wmSize: 36,
    wmRotation: -20,
    wmOpacity: 18,
    wmImage: '',     // data-URL da imagem (upload). Vazio = sem imagem.
    wmImageSize: 60, // % do tamanho do cartao (largura)
    // tipografia mensagem
    fontFamily: 'Cormorant Garamond',
    fontSize: 14,
    fontColor: '#1a1a1a',
    italic: true,
    align: 'center',
    letterSpacing: 0,
    lineHeight: 1.3,
    // padding (mm)
    padTop: 5, padBottom: 5, padLeft: 6, padRight: 6,
    // Marcia (02/jun/2026): margens da caixa de mensagem em relacao
    // a logo (topo) e instagram (rodape). Admin ajusta por formato.
    marginTopMsg: 4,
    marginBottomMsg: 4,
    // Marcia (09/jun/2026): margens LATERAIS da mensagem — evita que o
    // texto encoste na moldura/borda do cartao. Admin ajusta por formato.
    marginLeftMsg:  3,
    marginRightMsg: 3,
    // Marcia (09/jun/2026): controla se o autofit pode CRESCER a fonte
    // (default true para compat). Quando false, o tamanho da fonte do
    // template eh respeitado como MAXIMO — autofit so encolhe se passar.
    autofitGrow: true,
    // borda
    borderOn: false,
    borderColor: '#C8736A',
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 4,
    // ── NOVO: Estilo do De:/Para: ──
    showDePara: true,                // exibir blocos de:/para: no cartao
    deParaEstilo: 'negrito',         // negrito | italico | sublinhado | cor
    deParaSize: 12,                  // pt
    deParaColor: '#9F1239',
    deParaEspacamento: 4,            // mm (espaco abaixo)
    // ── NOVO (06/jun/2026): Codigo do pedido no canto ──
    // Aparece SO em impressao em massa de pedidos (renderUmCartao com
    // opts.orderCode). Permite que a equipe da expedicao localize
    // rapidamente qual cartao vai com qual pedido.
    showOrderCode: true,             // ligar/desligar o codigo
    orderCodePos: 'rodape-dir',      // topo-esq | topo-dir | rodape-esq | rodape-dir
    orderCodeSize: 7,                // pt
    orderCodeColor: '#94A3B8',       // cinza discreto
    orderCodePrefix: '#',            // ex: '#', 'Ped ', '' (sem prefixo)
    // Marcia (09/jun/2026): espacamento do codigo em relacao ao canto.
    // Antes era hardcoded 1.5mm — agora admin ajusta por formato.
    orderCodeMargin: 1.5,            // mm de distancia do canto
  };

  if (formatoId === 'horizontal') {
    return { ...base,
      logoPos:'topo-esq', logoSize:30,
      razaoPos:'topo-centro',
      fontSize:14, italic:true,
      deParaSize:11,
    };
  }
  if (formatoId === 'chaoDatas') {
    // Mesmas dimensoes do horizontal mas com showDePara desligado por
    // padrao (na producao em massa nao se mostra De/Para no cartao).
    return { ...base,
      logoPos:'topo-esq', logoSize:30,
      razaoPos:'topo-centro',
      fontSize:14, italic:true,
      deParaSize:11,
      showDePara: false,           // <- so a mensagem aparece
      showOrderCode: true,         // codigo do pedido ajuda a equipe
      // Marcia (09/jun/2026): chao de datas tem padroes mais seguros —
      // margens laterais maiores e SEM grow (respeita tamanho do template).
      marginLeftMsg:  4,
      marginRightMsg: 4,
      autofitGrow: false,
    };
  }
  if (formatoId === 'vertical') {
    return { ...base,
      logoPos:'topo-centro', logoSize:25,
      razaoPos:'topo-centro',
      fontSize:13, italic:true,
      padTop:6, padBottom:6, padLeft:5, padRight:5,
      deParaSize:10, deParaEspacamento:3,
    };
  }
  if (formatoId === 'a4') {
    return { ...base,
      logoPos:'topo-centro', logoSize:18,
      razaoPos:'topo-centro',
      fontSize:28, italic:true,
      padTop:30, padBottom:30, padLeft:20, padRight:20,
      borderOn:true, borderColor:'#C8736A', borderWidth:1.5, borderRadius:6,
      deParaSize:18, deParaEspacamento:8,
      marginTopMsg: 10, marginBottomMsg: 10, // A4 maior → respiro maior
    };
  }
  return base;
}

function _getConfigFormato(formatoId) {
  // 1) Memoria (mais fresco — populado pelo sync)
  if (_memCache[formatoId]) {
    return { ..._getDefaultConfig(formatoId), ..._memCache[formatoId] };
  }
  // 2) localStorage (cache cross-session)
  try {
    const raw = localStorage.getItem(LS_CONFIG_PREFIX + formatoId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // merge com default pra novas propriedades futuras (compat)
    return { ..._getDefaultConfig(formatoId), ...parsed };
  } catch (_) {
    return null;
  }
}

// Marcia (02/jun/2026 v2 + 04/jun v3): config GLOBAL no backend (settings/cartoes_config).
// 3 niveis de cache: memoria (sessao) > localStorage (cross-session) > backend (cross-device).
// Sync periodico (throttle 5s) garante que TODOS os computadores convergem
// pra mesma config quando admin edita. Memoria evita flash de defaults.
const BACKEND_KEY = 'cartoes_config';
let _lastSyncAt = 0;          // timestamp do ultimo fetch
let _isSyncing = false;       // anti-corrida
let _lastSavedBuffer = null;  // pra ignorar o proprio echo logo apos save
const SYNC_THROTTLE_MS = 5 * 1000;  // 5s (antes 15s — propagacao mais rapida)
// Cache em memoria das configs do backend — populado pelo sync.
// Sobrevive entre re-renders mas zera ao recarregar a pagina.
const _memCache = {};         // { [formatoId]: cfg }
// Promise da PRIMEIRA sync (booting) — _getConfigFormato espera ela
// na primeira chamada pra evitar flash de defaults em novos dispositivos.
let _bootSyncPromise = null;

// Marcia (02/jun/2026 v3): se localStorage estiver cheio, tenta
// liberar espaço apagando caches descartaveis. Retorna bytes liberados.
function _freeLocalSpace() {
  let bytesFreed = 0;
  // Lista de prefixos descartaveis (re-baixados quando precisar).
  const safePrefixes = [
    LS_CONFIG_PREFIX,         // outros formatos de cartao
    'fv_pedidos_cache_',      // cache de pedidos
    'fv_produtos_cache_',
    'fv_clientes_cache_',
    'fv_orders_cache',
    'fv_cartoes_hist',        // historico de impressoes
  ];
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (safePrefixes.some(p => k.startsWith(p))) {
        const v = localStorage.getItem(k);
        bytesFreed += (k.length + (v||'').length) * 2;
        toDelete.push(k);
      }
    }
    toDelete.forEach(k => { try { localStorage.removeItem(k); } catch(_){} });
  } catch (_) {}
  return bytesFreed;
}

async function _saveConfigFormato(formatoId, cfg) {
  // Marcia (02/jun/2026 v3): backend PRIMEIRO (source of truth, 25MB de
  // limite). localStorage vira cache opcional — se nao couber, tudo bem,
  // backend tem e o sync vai re-popular nas proximas renders.
  // 04/jun: tambem mantem memCache pra render imediato.
  _memCache[formatoId] = cfg;
  let backendOk = false;
  if (_isAdmin()) {
    try {
      const { PUT, GET } = await import('../services/api.js');
      const atual = await GET('/settings/' + BACKEND_KEY).catch(() => null);
      const merged = (atual && atual.value && typeof atual.value === 'object') ? { ...atual.value } : {};
      merged[formatoId] = cfg;
      await PUT('/settings/' + BACKEND_KEY, { value: merged });
      _lastSavedBuffer = { formatoId, json: JSON.stringify(cfg), savedAt: Date.now() };
      backendOk = true;
    } catch (e) {
      const { toast } = await import('../utils/helpers.js');
      if (e && (e.status === 413 || /large|payload/i.test(e.message || ''))) {
        toast('❌ Imagem muito grande pro servidor. Use uma menor (max ~2MB).', true);
      } else if (e && e.status === 403) {
        toast('❌ Só admin pode salvar config do cartão.', true);
      } else {
        toast('⚠️ Falha ao salvar no servidor: ' + (e.message || 'erro'), true);
      }
      console.warn('[cartoes] backend save falhou:', e);
      throw e; // backend eh obrigatorio — propaga pro caller
    }
  }

  // localStorage como CACHE (best-effort). Se cheio, tenta liberar
  // outras coisas e tenta de novo. Se ainda nao couber, ignora —
  // backend tem a config e o sync vai trazer de volta.
  const json = JSON.stringify(cfg);
  try {
    localStorage.setItem(LS_CONFIG_PREFIX + formatoId, json);
  } catch (_e1) {
    const liberado = _freeLocalSpace();
    try {
      localStorage.setItem(LS_CONFIG_PREFIX + formatoId, json);
      const { toast } = await import('../utils/helpers.js');
      toast(`💾 Salvo (liberados ${Math.round(liberado/1024)}KB de cache)`);
    } catch (_e2) {
      // Ainda nao coube. Backend tem — entao registra warning silencioso
      // e segue. Proximas paginas vao puxar do backend via sync.
      console.warn('[cartoes] localStorage cheio mesmo apos limpeza — backend tem a config, sera resincronizada');
      if (backendOk) {
        const { toast } = await import('../utils/helpers.js');
        toast('✅ Salvo no servidor (cache local cheio — outras telas vão receber)', false);
      }
    }
  }
}

function _resetConfigFormato(formatoId) {
  try { localStorage.removeItem(LS_CONFIG_PREFIX + formatoId); } catch (_) {}
  if (!_isAdmin()) return;
  (async () => {
    try {
      const { PUT, GET } = await import('../services/api.js');
      const atual = await GET('/settings/' + BACKEND_KEY).catch(() => null);
      if (!atual || !atual.value || typeof atual.value !== 'object') return;
      const next = { ...atual.value };
      delete next[formatoId];
      await PUT('/settings/' + BACKEND_KEY, { value: next });
    } catch(_){}
  })();
}

// Sync periodico — roda no render do modulo. Throttle 5s entre fetches.
// Re-renderiza se backend mudou (cobre o caso: admin salvou em A, B abre depois).
// 04/jun/2026: popula _memCache (camada 1) pra render imediato sem flash
// de defaults. _bootSyncPromise (primeira sync) e exposto pra callers
// que querem aguardar antes de renderizar.
export async function syncCartoesConfigFromBackend() {
  if (_isSyncing) return _bootSyncPromise || Promise.resolve();
  const now = Date.now();
  if ((now - _lastSyncAt) < SYNC_THROTTLE_MS) return _bootSyncPromise || Promise.resolve();
  _isSyncing = true;
  _lastSyncAt = now;
  const work = (async () => {
    try {
      const { GET } = await import('../services/api.js');
      const r = await GET('/settings/' + BACKEND_KEY).catch(() => null);
      if (r && r.value && typeof r.value === 'object') {
        let changed = false;
        for (const fid of Object.keys(r.value)) {
          const remoteCfg  = r.value[fid];
          const remoteJson = JSON.stringify(remoteCfg);
          const localJson  = localStorage.getItem(LS_CONFIG_PREFIX + fid) || '';
          // Se acabamos de salvar este formato e o backend ainda nao
          // replicou, PRESERVA o local + memoria (evita reverter ediscao
          // que acabou de acontecer).
          if (_lastSavedBuffer
              && _lastSavedBuffer.formatoId === fid
              && (now - _lastSavedBuffer.savedAt) < 5000
              && _lastSavedBuffer.json === localJson
              && remoteJson !== localJson) {
            continue;
          }
          // Atualiza camada 1 (memoria) — sempre, ate quando localStorage
          // esta cheio. _resolveConfig le memoria primeiro.
          const prevMem = JSON.stringify(_memCache[fid] || null);
          if (prevMem !== remoteJson) {
            _memCache[fid] = remoteCfg;
            changed = true;
          }
          // Atualiza camada 2 (localStorage) — best-effort
          if (localJson !== remoteJson) {
            try { localStorage.setItem(LS_CONFIG_PREFIX + fid, remoteJson); }
            catch(_) { /* quota — ignora, memoria ja tem */ }
          }
        }
        if (changed) {
          try { (await import('../main.js')).render?.(); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[cartoes] sync config backend:', e.message);
    } finally {
      _isSyncing = false;
    }
  })();
  if (!_bootSyncPromise) _bootSyncPromise = work;
  return work;
}

// Dispara a 1a sync imediatamente ao importar o modulo — assim, quando
// usuaria navega pro modulo de cartoes, a config ja esta carregada em
// memoria (sem flash de defaults).
try { syncCartoesConfigFromBackend(); } catch(_) {}

function _resolveConfig(formatoId, custom) {
  return custom || _getConfigFormato(formatoId) || _getDefaultConfig(formatoId);
}

// ── HELPERS HTML ─────────────────────────────────────────────
function _escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}

// ── MARKDOWN SIMPLES (negrito, italico, quebra de linha) ─────
// SEGURO: escapa HTML antes de aplicar regex (sem XSS).
export function parseMarkdownSimples(texto) {
  let html = String(texto || '');
  // 1) Escapa HTML primeiro (anti-XSS)
  html = html.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#39;');
  // 2) *negrito* → <strong>
  html = html.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  // 3) _italico_ → <em>
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  // 4) Quebras de linha → <br/>
  html = html.replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');
  return html;
}

function _posToFlex(pos) {
  const map = {
    'topo-esq':      { justify:'flex-start', order:0 },
    'topo-centro':   { justify:'center',     order:0 },
    'topo-dir':      { justify:'flex-end',   order:0 },
    'rodape-esq':    { justify:'flex-start', order:2 },
    'rodape-centro': { justify:'center',     order:2 },
    'rodape-dir':    { justify:'flex-end',   order:2 },
  };
  return map[pos] || map['topo-centro'];
}

// Familias Google Fonts disponiveis
export const CARTAO_FONTES = [
  'Cormorant Garamond','Playfair Display','Dancing Script','Great Vibes',
  'Allura','Sacramento','Pinyon Script','Parisienne','Inter',
];

function _googleFontsHref() {
  const families = CARTAO_FONTES.map(f =>
    'family=' + encodeURIComponent(f).replace(/%20/g,'+') + ':ital,wght@0,400;0,700;1,400;1,700'
  ).join('&');
  return 'https://fonts.googleapis.com/css2?' + families + '&display=swap';
}

// ── DE:/PARA: HTML ───────────────────────────────────────────
function _deParaHtml(cfg, para, de) {
  if (!cfg.showDePara) return '';
  const p = String(para || '').trim();
  const d = String(de || '').trim();
  if (!p && !d) return '';

  // Estilo CSS conforme escolha
  let extra = '';
  switch (cfg.deParaEstilo) {
    case 'italico':    extra = 'font-style:italic;font-weight:700;'; break;
    case 'sublinhado': extra = 'text-decoration:underline;font-weight:700;'; break;
    case 'cor':        extra = `color:${cfg.deParaColor};font-weight:700;`; break;
    case 'negrito':
    default:           extra = 'font-weight:800;'; break;
  }
  const baseStyle = `font-family:'${cfg.fontFamily}','Cormorant Garamond',Georgia,serif;
                     font-size:${cfg.deParaSize}pt;line-height:1.25;${extra}`;

  const linhas = [];
  if (p) linhas.push(`<div style="${baseStyle}">Para: ${_escapeHtml(p)}</div>`);
  if (d) linhas.push(`<div style="${baseStyle}">De: ${_escapeHtml(d)}</div>`);

  return `<div style="margin-bottom:${cfg.deParaEspacamento}mm;text-align:inherit;">${linhas.join('')}</div>`;
}

// ── RENDER DE UM CARTAO ──────────────────────────────────────
// opts: { config?, para?, de?, semBorda? }
// ── AUTOFIT bidirecional: encolhe SE NAO COUBER, cresce SE SOBRAR ──
// Marcia (02/jun/2026 v3): mensagem curta cresce ate ocupar bem o
// espaco; mensagem longa encolhe ate caber. Min 6pt, max 2.5x o
// tamanho do template (cap absoluto 60pt). Roda no preview e no print.
export function autoFitCartoes(scope) {
  const root = scope || document;
  const els = root.querySelectorAll('[data-cart-autofit]');
  els.forEach(el => {
    const wrap = el.closest('[data-cart-msg-wrap]');
    if (!wrap) return;
    const startPt = Number(el.getAttribute('data-autofit-from')) || 14;
    const minPt = 6;
    // Marcia (09/jun/2026): autofit-grow controla se a fonte pode crescer
    // alem do template. Default '1' (cresce ate 1.5x ou 24pt). Quando
    // '0' (chao de datas, ou admin desligou no template), o startPt eh
    // o teto — autofit so encolhe se passar.
    const allowGrow = el.getAttribute('data-autofit-grow') !== '0';
    const maxPt = allowGrow ? Math.min(24, startPt * 1.5) : startPt;

    // Marcia (04/jun/2026): BUG — antes comparava el.scrollHeight contra
    // wrap.clientHeight, ignorando o bloco DE/PARA que tambem mora dentro
    // do wrap. Resultado: autofit nao encolhia o suficiente e a impressao
    // cortava o fim da mensagem. Agora checa o wrap INTEIRO (DE/PARA +
    // mensagem juntos), que e exatamente o espaco disponivel no cartao.
    // Margem de seguranca de 2px pra cobrir arredondamentos do navegador.
    const overflows = () =>
      wrap.scrollHeight > wrap.clientHeight + 2 ||
      wrap.scrollWidth  > wrap.clientWidth  + 2;

    let pt = startPt;
    el.style.fontSize = pt + 'pt';

    if (overflows()) {
      // ENCOLHER ate caber (sempre)
      let guard = 100;
      while (guard-- > 0 && pt > minPt && overflows()) {
        pt = Math.max(minPt, pt - 0.5);
        el.style.fontSize = pt + 'pt';
      }
    } else if (allowGrow) {
      // CRESCER ate quase encostar — SO se o template permitir
      let guard = 120;
      while (guard-- > 0 && pt < maxPt) {
        const tryPt = Math.min(maxPt, pt + 0.5);
        el.style.fontSize = tryPt + 'pt';
        if (overflows()) {
          el.style.fontSize = pt + 'pt'; // volta o ultimo que coube
          break;
        }
        pt = tryPt;
        if (pt >= maxPt) break;
      }
    }
    // Quando !allowGrow e a mensagem ja cabe: deixa no startPt — nao mexe.
  });
}

export function renderUmCartao(msg, formatoId, opts = {}) {
  const formato = CARTAO_FORMATOS.find(f => f.id === formatoId) || CARTAO_FORMATOS[0];
  const cfg = _resolveConfig(formato.id, opts.config);
  const mensagem = String(msg || '').slice(0, 500);

  // ── BORDAS ──
  // Marcia (30/mai/2026): antes a borda configurada usava 'outline',
  // que MUITOS navegadores nao imprimem (sumia no PDF/papel). Agora
  // usa 'border' real — com box-sizing:border-box ja no cardStyle,
  // nao altera dimensoes. Se cfg.borderOn=true, ignora a guia tracejada.
  let bordaGuia = '';
  let bordaCustom = '';
  if (cfg.borderOn) {
    bordaCustom = `border:${cfg.borderWidth}px ${cfg.borderStyle} ${cfg.borderColor};`;
  } else if (!opts.semBorda) {
    // Borda-guia tracejada (apenas na tela; some no print via CSS @media print)
    bordaGuia = 'border:0.2mm dashed #CBD5E1;';
  }

  let bgStyle = `background:${cfg.bgColor};`;
  if (cfg.gradientOn) {
    bgStyle = `background:linear-gradient(135deg, ${cfg.gradientFrom}, ${cfg.gradientTo});`;
  }
  if (cfg.bgImage) {
    const op = (cfg.bgImageOpacity || 100) / 100;
    // Marcia (09/jun/2026): bgImageFit configuravel — 'contain' (default)
    // mostra a imagem inteira; 'cover' preenche cortando o excesso.
    const fit = (cfg.bgImageFit === 'cover') ? 'cover' : 'contain';
    bgStyle += `background-image:linear-gradient(rgba(255,255,255,${1-op}),rgba(255,255,255,${1-op})),url('${cfg.bgImage}');background-size:${fit};background-position:center;background-repeat:no-repeat;`;
  }

  const logoHeightMm = Math.max(2, Math.min(formato.h - 4, (formato.h * (cfg.logoSize||30)/100)));
  const logoHtml = cfg.logo
    ? `<img src="${cfg.logo}" alt="logo" style="height:${logoHeightMm.toFixed(1)}mm;max-width:80%;object-fit:contain;display:block;"/>`
    : '';

  const logoFlex = _posToFlex(cfg.logoPos);
  const razaoFlex = _posToFlex(cfg.razaoPos);

  const razaoHtml = (cfg.showRazao && cfg.razaoSocial)
    ? `<div style="font-family:'Playfair Display',serif;font-weight:700;font-size:${Math.max(7, cfg.fontSize*0.55)}pt;color:${cfg.fontColor};letter-spacing:.3pt;line-height:1.1;">${_escapeHtml(cfg.razaoSocial)}</div>`
    : '';

  const instaHtml = (cfg.showInstagram && cfg.instagram)
    ? `<div style="font-family:'Inter',Arial,sans-serif;font-weight:600;font-size:${Math.max(6, cfg.fontSize*0.42)}pt;color:${cfg.fontColor};opacity:.85;letter-spacing:.3pt;">${_escapeHtml(cfg.instagram)}</div>`
    : '';

  // Marca d'agua: prioriza IMAGEM (upload). Se nao houver, usa texto.
  const wmHtml = cfg.wmImage
    ? `<img src="${cfg.wmImage}" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(${cfg.wmRotation}deg);
          width:${cfg.wmImageSize||60}%;height:auto;max-height:80%;object-fit:contain;
          opacity:${(cfg.wmOpacity||18)/100};pointer-events:none;z-index:0;"/>`
    : (cfg.wmText && String(cfg.wmText).trim())
    ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(${cfg.wmRotation}deg);
          font-family:'${cfg.fontFamily}',serif;font-size:${cfg.wmSize}pt;color:${cfg.wmColor};
          opacity:${(cfg.wmOpacity||18)/100};white-space:nowrap;pointer-events:none;font-weight:700;letter-spacing:1pt;z-index:0;">
          ${_escapeHtml(cfg.wmText)}
        </div>`
    : '';

  const topoItens = [];
  const rodapeItens = [];

  if (logoHtml) {
    const item = `<div style="flex:1;display:flex;justify-content:${logoFlex.justify};align-items:center;">${logoHtml}</div>`;
    if (logoFlex.order === 0) topoItens.push(item); else rodapeItens.push(item);
  }
  if (razaoHtml) {
    const item = `<div style="flex:1;display:flex;justify-content:${razaoFlex.justify};align-items:center;text-align:${cfg.razaoPos.includes('esq')?'left':cfg.razaoPos.includes('dir')?'right':'center'};">${razaoHtml}</div>`;
    if (razaoFlex.order === 0) topoItens.push(item); else rodapeItens.push(item);
  }
  if (instaHtml) {
    rodapeItens.push(`<div style="flex:1;display:flex;justify-content:center;align-items:center;">${instaHtml}</div>`);
  }

  const topoHtml = topoItens.length
    ? `<div style="display:flex;align-items:center;gap:3mm;min-height:0;">${topoItens.join('')}</div>`
    : '';
  const rodapeHtml = rodapeItens.length
    ? `<div style="display:flex;align-items:center;gap:3mm;min-height:0;">${rodapeItens.join('')}</div>`
    : '';

  // ── Bloco DE:/PARA: (acima da mensagem)
  // Marcia (09/jun/2026): opts.hideDePara FORCA esconder o bloco de/para
  // (usado no fluxo Chao de Datas — la quem identifica o pedido eh o
  // codigo no canto + comanda, o cartao deve ter SO a mensagem).
  // Override por chamada — nao mexe no cfg salvo.
  const cfgPraDePara = opts.hideDePara ? { ...cfg, showDePara: false } : cfg;
  const deParaHtml = _deParaHtml(cfgPraDePara, opts.para, opts.de);

  // Marcia (02/jun/2026 v6): margens definidas no template (admin
  // ajusta por formato em ⚙️ Configurações). Caller pode sobrescrever
  // via opts. Fallback: 4mm pra formatos pequenos, 10mm pro A4.
  const _legacyGap = formato.id === 'a4' ? 10 : 4;
  const _cfgMt = (cfg.marginTopMsg    != null) ? Number(cfg.marginTopMsg)    : _legacyGap;
  const _cfgMb = (cfg.marginBottomMsg != null) ? Number(cfg.marginBottomMsg) : _legacyGap;
  const marginTop    = (opts.marginTop    != null) ? Number(opts.marginTop)    : _cfgMt;
  const marginBottom = (opts.marginBottom != null) ? Number(opts.marginBottom) : _cfgMb;
  // Marcia (09/jun/2026): margens LATERAIS da mensagem — evita que o
  // texto encoste na moldura/borda do cartao. Default 3mm (A4: maior).
  const _legacyGapH = formato.id === 'a4' ? 8 : 3;
  const marginLeft   = (cfg.marginLeftMsg  != null) ? Number(cfg.marginLeftMsg)  : _legacyGapH;
  const marginRight  = (cfg.marginRightMsg != null) ? Number(cfg.marginRightMsg) : _legacyGapH;

  // ── Mensagem central: markdown simples + quebra de linha
  // OBS: fonte INICIAL vem do template; o autofit no DOM encolhe se
  // estourar a caixa. data-autofit-from carrega o tamanho inicial pra
  // re-tentar do zero quando a mensagem muda.
  const msgStyle = `
    font-family:'${cfg.fontFamily}','Cormorant Garamond',Georgia,serif;
    font-size:${cfg.fontSize}pt;
    color:${cfg.fontColor};
    text-align:${cfg.align};
    font-style:${cfg.italic ? 'italic' : 'normal'};
    letter-spacing:${cfg.letterSpacing}px;
    line-height:${cfg.lineHeight};
    white-space:pre-wrap;
    word-wrap:break-word;
    width:100%;
  `;
  const msgRendered = mensagem
    ? parseMarkdownSimples(mensagem)
    : '<span style="color:#CBD5E1;">(mensagem)</span>';

  // Margens condicionais — soh quando os blocos vizinhos existem.
  const mt = (topoItens && topoItens.length    && marginTop    > 0) ? `margin-top:${marginTop}mm;`    : '';
  const mb = (rodapeItens && rodapeItens.length && marginBottom > 0) ? `margin-bottom:${marginBottom}mm;` : '';
  // Marcia (09/jun/2026): data-autofit-grow controla se o autofit pode
  // crescer a fonte alem do tamanho do template. '0' = nao, so encolhe.
  const allowGrowAttr = (cfg.autofitGrow === false) ? '0' : '1';
  const msgHtml = `
    <div data-cart-msg-wrap style="flex:1;display:flex;flex-direction:column;align-items:${cfg.align==='left'?'flex-start':cfg.align==='right'?'flex-end':'center'};justify-content:center;padding:1mm ${marginRight}mm 1mm ${marginLeft}mm;position:relative;z-index:1;text-align:${cfg.align};${mt}${mb}overflow:hidden;min-height:0;">
      ${deParaHtml}
      <div data-cart-autofit data-autofit-from="${cfg.fontSize}" data-autofit-grow="${allowGrowAttr}" style="${msgStyle}">${msgRendered}</div>
    </div>`;

  const cardStyle = `
    position:relative;
    width:${formato.w}mm;height:${formato.h}mm;
    box-sizing:border-box;
    page-break-inside:avoid;
    overflow:hidden;
    padding:${cfg.padTop}mm ${cfg.padRight}mm ${cfg.padBottom}mm ${cfg.padLeft}mm;
    display:flex;flex-direction:column;
    border-radius:${cfg.borderRadius}px;
    ${bgStyle}${bordaGuia}${bordaCustom}
  `;

  // ── Codigo do pedido no canto (06/jun/2026) ──
  // Aparece SO se opts.orderCode for passado (impressao em massa) E o
  // template tiver showOrderCode=true. Posicao absoluta nos cantos.
  let orderCodeHtml = '';
  if (opts.orderCode && cfg.showOrderCode !== false) {
    const pos = cfg.orderCodePos || 'rodape-dir';
    const sz  = Number(cfg.orderCodeSize) || 7;
    const col = cfg.orderCodeColor || '#94A3B8';
    const pref = (cfg.orderCodePrefix != null) ? cfg.orderCodePrefix : '#';
    const num = String(opts.orderCode).replace(/^PED-?/i,'').trim();
    // Marcia (09/jun/2026): margem configurada pelo template (default 1.5mm).
    const margemCanto = (cfg.orderCodeMargin != null) ? Number(cfg.orderCodeMargin) : 1.5;
    const isTop = pos.startsWith('topo');
    const isEsq = pos.endsWith('esq');
    const corner = `${isTop ? 'top' : 'bottom'}:${margemCanto}mm;${isEsq ? 'left' : 'right'}:${margemCanto}mm;`;
    orderCodeHtml = `<div style="position:absolute;${corner}font-family:'Inter',Arial,sans-serif;font-size:${sz}pt;color:${col};font-weight:700;letter-spacing:.3pt;opacity:.85;pointer-events:none;z-index:2;line-height:1;">${_escapeHtml(pref + num)}</div>`;
  }

  return `
    <div style="${cardStyle}">
      ${wmHtml}
      ${orderCodeHtml}
      ${topoHtml}
      ${msgHtml}
      ${rodapeHtml}
    </div>`;
}

// ── RENDER PRINCIPAL ─────────────────────────────────────────
export function renderCartoes() {
  // Marcia (30/mai/2026): puxa config global do backend (1x por sessao).
  // Re-render automatico se a config remota for diferente da local.
  syncCartoesConfigFromBackend();

  const tab = S._cartTab || 'imprimir';

  if (!S._cartFormato || !CARTAO_FORMATOS.find(f => f.id === S._cartFormato)) {
    S._cartFormato = _getFormatoPadrao();
  }
  if (typeof S._cartMsg !== 'string') S._cartMsg = '';
  if (typeof S._cartPara !== 'string') S._cartPara = '';
  if (typeof S._cartDe   !== 'string') S._cartDe   = '';
  if (typeof S._cartShowDePara !== 'boolean') S._cartShowDePara = true;
  if (typeof S._cartQty !== 'number') S._cartQty = 2;
  if (!Array.isArray(S._cartFila))    S._cartFila    = [];
  if (!Array.isArray(S._cartPedFila)) S._cartPedFila = [];
  if (typeof S._cartPedBusca !== 'string') S._cartPedBusca = '';
  if (!S._cartPedOverrides || typeof S._cartPedOverrides !== 'object') {
    S._cartPedOverrides = {}; // { [orderId]: { para, de } }
  }

  const admin = _isAdmin();
  if (tab === 'configs' && !admin) S._cartTab = 'imprimir';

  const tabBtn = (k, label, icon) => `
    <button data-cart-tab="${k}" class="tab ${tab===k?'active':''}" style="padding:10px 18px;font-size:13px;">${icon} ${label}</button>
  `;

  return `
<div style="max-width:1180px;margin:0 auto;">
  <div style="text-align:center;margin-bottom:20px;">
    <h1 style="font-family:'Playfair Display',serif;font-size:28px;color:#1E293B;margin:0 0 4px;">💌 Cartões Personalizados</h1>
    <p style="font-size:13px;color:var(--muted);margin:0;">3 formatos: Horizontal · Vertical · A4 inteiro — todos em A4 retrato</p>
  </div>

  <div style="display:flex;gap:8px;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:12px;padding:6px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);flex-wrap:wrap;">
    ${tabBtn('imprimir',  'Imprimir',   '✏️')}
    ${tabBtn('pedidos',   'Por Pedido', '📋')}
    ${tabBtn('formatos',  'Formatos',   '🎨')}
    ${tabBtn('historico', 'Histórico',  '📊')}
    ${admin ? tabBtn('configs', 'Configurações', '⚙️') : ''}
  </div>

  ${tab === 'imprimir'  ? renderTabImprimir() : ''}
  ${tab === 'pedidos'   ? renderTabPedidos()  : ''}
  ${tab === 'formatos'  ? renderTabFormatos() : ''}
  ${tab === 'historico' ? renderTabHistorico(): ''}
  ${tab === 'configs' && admin ? renderTabConfigs() : ''}
</div>
`;
}

// ── DICA DE MARKDOWN ─────────────────────────────────────────
function _dicaMarkdownHtml() {
  return `
    <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:11px;color:#78350F;line-height:1.5;">
      💡 Use <code style="background:#fff;padding:1px 4px;border-radius:3px;">*asteriscos*</code> para <strong>negrito</strong>,
      <code style="background:#fff;padding:1px 4px;border-radius:3px;">_underscore_</code> para <em>itálico</em>,
      e <kbd style="background:#fff;padding:1px 4px;border-radius:3px;">Enter</kbd> para quebrar linha.
    </div>
  `;
}

// ── ABA 1: IMPRIMIR ──────────────────────────────────────────
function renderTabImprimir() {
  const msg = S._cartMsg;
  const para = S._cartPara || '';
  const de   = S._cartDe   || '';
  const showDP = !!S._cartShowDePara;
  const formatoId = S._cartFormato;
  const formato = CARTAO_FORMATOS.find(f => f.id === formatoId) || CARTAO_FORMATOS[0];
  const maxPorFolha = formato.cols * formato.rows;
  const qty = Math.max(1, Math.min(maxPorFolha, Number(S._cartQty)||1));
  const fila = S._cartFila;
  // Marcia (02/jun/2026 v3): sem ajustes manuais. A fonte se adapta
  // sozinha — encolhe se nao couber, cresce se sobrar espaco.
  const previewHtml = renderUmCartao(msg || 'Sua mensagem aparece aqui...\nUse *negrito* e _italico_.', formatoId, {
    para: showDP ? para : '',
    de:   showDP ? de   : '',
  });
  const admin = _isAdmin();

  const previewMaxPx = 320;
  const naturalPx = formato.w * 3.78;
  const zoom = Math.min(1.2, Math.max(0.35, previewMaxPx / naturalPx));

  return `
<div style="display:grid;grid-template-columns:1fr 380px;gap:18px;">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">
        ✏️ Mensagem do Cartão
      </div>

      <!-- DE / PARA (opcionais) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
          <span>Para: <span style="color:#94A3B8;font-weight:400;">(opcional)</span></span>
          <input type="text" id="cart-para" value="${_escapeHtml(para)}" maxlength="60" placeholder="Ex: Maria"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;"/>
        </label>
        <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
          <span>De: <span style="color:#94A3B8;font-weight:400;">(opcional)</span></span>
          <input type="text" id="cart-de" value="${_escapeHtml(de)}" maxlength="60" placeholder="Ex: João"
            style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;"/>
        </label>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#475569;font-weight:600;margin-bottom:8px;cursor:pointer;">
        <input type="checkbox" id="cart-show-depara" ${showDP?'checked':''} style="cursor:pointer;"/>
        Mostrar 'De:' e 'Para:' no cartão
      </label>

      ${_dicaMarkdownHtml()}

      <textarea id="cart-msg" maxlength="500" rows="4" placeholder="Ex: Feliz aniversário! Que esse novo ciclo seja repleto de *amor* e _flores_ 🌸"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:8px;
               font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:14px;resize:vertical;line-height:1.4;white-space:pre-wrap;">${_escapeHtml(msg)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:11px;color:var(--muted);">
        <span>Use linhas curtas pro cartão ficar bonito (máx 500 caracteres)</span>
        <span><strong id="cart-msg-count">${msg.length}</strong>/500</span>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span>🎨 Escolha o Formato</span>
        ${admin ? `<button id="btn-cart-go-configs" style="background:#fff;color:#9F1239;border:1.5px solid #9F1239;padding:5px 11px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">⚙️ Personalizar</button>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
        ${CARTAO_FORMATOS.map(f => {
          const sel = f.id === formatoId;
          return `<button type="button" data-cart-formato="${f.id}"
            style="background:${sel?'linear-gradient(135deg,#9F1239,#C8736A)':'#fff'};color:${sel?'#fff':'#1E293B'};
                   border:2px solid ${sel?'#9F1239':'#E5E7EB'};border-radius:10px;padding:10px 12px;
                   cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;">
            <div style="font-weight:700;font-size:13px;line-height:1.2;margin-bottom:2px;">${f.emoji} ${f.nome}</div>
            <div style="font-size:10px;opacity:.85;line-height:1.3;">${f.desc}</div>
          </button>`;
        }).join('')}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;">🔢 Quantidade de cópias deste cartão</div>
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <input type="number" id="cart-qty" min="1" max="${maxPorFolha}" value="${qty}"
          style="width:90px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:18px;font-weight:700;text-align:center;"/>
        <div style="font-size:12px;color:var(--muted);">
          (máximo ${maxPorFolha} por folha A4)<br/>
          ${qty < maxPorFolha ? `Restante na folha: <strong>${maxPorFolha-qty}</strong> espaço(s)` : '<strong style="color:#9F1239;">Folha cheia ✓</strong>'}
        </div>
      </div>

      ${fila.length > 0 ? `
      <div style="margin-top:12px;background:#FAE8E6;border:1px dashed #FECDD3;border-radius:8px;padding:10px;">
        <div style="font-size:11px;font-weight:700;color:#9F1239;margin-bottom:6px;">
          📋 Fila de cartões com mensagens diferentes (${fila.reduce((s,f)=>s+f.qty,0)})
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${fila.map((f, i) => `
            <div style="display:flex;align-items:center;gap:8px;background:#fff;border-radius:6px;padding:6px 8px;font-size:11px;">
              <span style="background:#9F1239;color:#fff;border-radius:8px;padding:1px 6px;font-weight:700;">${f.qty}×</span>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic;color:#475569;">"${_escapeHtml(f.msg).slice(0,60)}${f.msg.length>60?'...':''}"</span>
              <span style="font-size:9px;color:var(--muted);">${(CARTAO_FORMATOS.find(x=>x.id===f.formatoId)||{}).nome||'—'}</span>
              <button data-cart-fila-del="${i}" style="background:#FEE2E2;color:#991B1B;border:none;width:22px;height:22px;border-radius:5px;cursor:pointer;font-size:11px;">🗑️</button>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>


    <div class="card">
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button type="button" id="btn-cart-add-fila"
          style="flex:1;min-width:200px;background:#fff;color:#9F1239;border:2px dashed #9F1239;padding:12px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;">
          ➕ Adicionar à fila (msg diferente)
        </button>
        <button type="button" id="btn-cart-imprimir"
          style="flex:2;min-width:200px;background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;border:none;padding:14px;border-radius:10px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.5px;">
          🖨️ Imprimir ${fila.length>0 ? fila.reduce((s,f)=>s+f.qty,0)+' cartões da fila' : qty+' cópia(s)'}
        </button>
      </div>
      <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:8px;line-height:1.5;">
        ${fila.length===0
          ? 'Vai imprimir <strong>'+qty+'</strong> cópia(s) no formato <strong>'+formato.nome+'</strong>.'
          : 'Imprime os cartões da fila + (se houver espaço) cópias do cartão atual.'}
      </div>
    </div>
  </div>

  <div>
    <div class="card" style="position:sticky;top:20px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span>👁️ Preview</span>
        <span style="background:#F1F5F9;color:#475569;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:600;">${formato.w}×${formato.h}mm</span>
      </div>
      <div style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:10px;padding:18px;display:flex;justify-content:center;align-items:center;min-height:200px;overflow:hidden;">
        <div style="transform:scale(${zoom.toFixed(2)});transform-origin:center;display:inline-block;">${previewHtml}</div>
      </div>
      <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:#78350F;line-height:1.5;">
        💡 <strong>Dica:</strong> Use folha A4 180g+ pra cartões mais firmes. Borda pontilhada some no print — corte com tesoura ou guilhotina.
      </div>
    </div>
  </div>
</div>
`;
}

// ── BUSCA: helpers de match e highlight ──────────────────────
function _normalizar(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function _highlight(texto, termo) {
  const txt = String(texto || '');
  if (!termo) return _escapeHtml(txt);
  const t = String(termo).trim();
  if (!t) return _escapeHtml(txt);
  // escapa regex
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, 'gi');
  // Trabalha em HTML-escapado
  const html = _escapeHtml(txt);
  // tem que aplicar o regex sobre versao "raw" pra pegar acentos — mas como
  // simplificacao usamos o termo cru sobre o html escapado.
  return html.replace(re, m => `<mark style="background:#FEF08A;color:#713F12;padding:0 2px;border-radius:2px;">${m}</mark>`);
}

// ── ABA 2: POR PEDIDO ────────────────────────────────────────
function renderTabPedidos() {
  const fila = S._cartPedFila || [];
  const hoje = new Date().toISOString().slice(0,10);
  const dataFiltro = S._cartPedData || hoje;
  const busca = S._cartPedBusca || '';
  const buscaNorm = _normalizar(busca);
  const formatoId = S._cartFormato;
  const formato = CARTAO_FORMATOS.find(f => f.id === formatoId) || CARTAO_FORMATOS[0];
  const maxPorFolha = formato.cols * formato.rows;

  // Marcia (02/jun/2026):
  // - Esconde Entregue e Cancelado (so o que ainda vai sair).
  // - Filtra por unidade(s) da colab: Novo Aleixo so ve retirada
  //   Novo Aleixo, etc. Admin ve tudo.
  const userUnidades = (() => {
    const arr = Array.isArray(S.user?.unidades) ? S.user.unidades : null;
    if (arr && arr.length) return new Set(arr.map(u => _normalizeUnidadeSimple(u)).filter(Boolean));
    const single = _normalizeUnidadeSimple(S.user?.unidade || S.user?.unit);
    return single ? new Set([single]) : new Set();
  })();
  const isAdminUser = _isAdmin() || _normalizeUnidadeSimple(S.user?.unidade) === 'todas';
  const matchUnidadeColab = (o) => {
    if (isAdminUser) return true;
    if (!userUnidades.size) return false;
    // Pra producao de cartoes, considera a unidade operacional do pedido
    // (quem vai montar/entregar). Delivery=CDLE, Retirada=loja escolhida.
    const oUni = _normalizeUnidadeSimple(o.unidade || o.unit || o.destino);
    return userUnidades.has(oUni);
  };

  // Filtro: se houver busca, ignora a data; caso contrario, filtra por data.
  let pedidos = (S.orders || []).filter(o => {
    if (!o.cardMessage || !String(o.cardMessage).trim()) return false;
    const st = String(o.status || '').trim();
    if (st === 'Entregue' || st === 'Cancelado') return false;
    if (!matchUnidadeColab(o)) return false;
    return true;
  });
  if (buscaNorm) {
    pedidos = pedidos.filter(o => {
      const num = _normalizar(o.orderNumber || o.numero || '');
      const cli = _normalizar(o.clientName || o.client?.name || '');
      const recv = _normalizar(o.recipient || o.destinatario || o.recipientName || '');
      const cm  = _normalizar(o.cardMessage || '');
      return num.includes(buscaNorm) || cli.includes(buscaNorm)
          || recv.includes(buscaNorm) || cm.includes(buscaNorm);
    });
  } else {
    pedidos = pedidos.filter(o => String(o.scheduledDate||'').slice(0,10) === dataFiltro);
  }
  // Ordena pelo turno e horario de entrega (mais cedo primeiro)
  const _turnOrd = { manh: 0, manhã: 0, tarde: 1, noite: 2 };
  pedidos.sort((a, b) => {
    const ta = String(a.scheduledPeriod||'').toLowerCase().slice(0,4);
    const tb = String(b.scheduledPeriod||'').toLowerCase().slice(0,4);
    return (_turnOrd[ta]||9) - (_turnOrd[tb]||9);
  });

  const totalFila = fila.length;
  const folhasPrev = Math.ceil(totalFila / maxPorFolha);

  return `
<div class="card" style="margin-bottom:14px;">
  <div style="font-weight:700;margin-bottom:8px;">🎨 Escolha o formato dos cartoes desta impressao</div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">A impressao usa o formato selecionado abaixo. Personalize cada formato na aba ⚙️ Configurações.</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
    ${CARTAO_FORMATOS.map(f => `
      <button data-cart-formato="${f.id}"
        style="background:${f.id===formatoId?'linear-gradient(135deg,#9F1239,#C8736A)':'#fff'};color:${f.id===formatoId?'#fff':'#1E293B'};border:2px solid ${f.id===formatoId?'#9F1239':'#E5E7EB'};padding:10px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;text-align:left;">
        <div style="font-size:18px;margin-bottom:3px;">${f.emoji}</div>
        <div>${f.nome}</div>
        <div style="font-size:10px;font-weight:500;opacity:.85;margin-top:2px;">${(f.cols*f.rows)} por folha</div>
      </button>
    `).join('')}
  </div>
</div>

<div class="card" style="margin-bottom:14px;">
  <!-- BUSCA -->
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
    <div style="position:relative;flex:1;min-width:240px;">
      <input type="text" id="cart-ped-busca" value="${_escapeHtml(busca)}"
        placeholder="🔍 Buscar pedido por número, cliente ou destinatário..."
        style="width:100%;box-sizing:border-box;padding:9px 36px 9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;"/>
      ${busca ? `<button id="btn-cart-ped-busca-clear" title="Limpar busca" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:#FEE2E2;color:#991B1B;border:none;width:24px;height:24px;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;">✕</button>` : ''}
    </div>
    <span style="background:#FAE8E6;color:#9F1239;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;">${pedidos.length} pedido(s) encontrado(s)</span>
  </div>

  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
    <div style="font-weight:700;">📋 Pedidos com cartão ${buscaNorm ? '(busca ativa — filtro de data ignorado)' : 'da data'}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <label style="font-size:12px;color:var(--muted);">Entrega em:</label>
      <input type="date" id="cart-ped-data" value="${dataFiltro}" ${buscaNorm?'disabled':''} style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;${buscaNorm?'opacity:.5;':''}"/>
    </div>
  </div>

  ${pedidos.length === 0 ? `
  <div style="text-align:center;padding:40px 20px;color:var(--muted);">
    <div style="font-size:48px;margin-bottom:10px;">📭</div>
    <p style="font-size:13px;font-weight:600;">${buscaNorm?'Nenhum pedido encontrado para a busca.':'Nenhum pedido com mensagem de cartão para esta data e sua unidade.'}</p>
    <p style="font-size:11px;color:var(--muted);margin-top:6px;">Filtros ativos: pedidos não entregues · destino: ${isAdminUser?'todas as unidades (admin)':[...userUnidades].map(u=>({novo_aleixo:'Novo Aleixo',allegro:'Allegro',cdle:'CDLE'}[u]||u)).join(', ')||'sua unidade'}</p>
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:10px;max-height:640px;overflow-y:auto;padding-right:4px;">
    ${pedidos.map(o => {
      const numRaw = (o.orderNumber||o.numero||'').toString().replace(/^PED-?/i,'');
      const cli = o.clientName || o.client?.name || '—';
      const recv = o.recipient || o.destinatario || o.recipientName || '';
      const naFila = fila.includes(String(o._id));
      const msgFull = String(o.cardMessage||'');
      const overrides = S._cartPedOverrides[String(o._id)] || {};
      const editadoDP = (overrides.para || overrides.de);
      const editandoMsg = S._cartPedEditMsg === String(o._id);
      const editandoDP  = S._cartPedEditDP  === String(o._id);

      // Produtos do pedido
      const itensTxt = (o.items||[])
        .map(it => `${it.qty||1}× ${it.name||it.productName||'?'}`)
        .filter(Boolean).join(' · ') || '—';

      // Localizacao + tipo de pedido
      const tipo = String(o.type||o.tipo||'').toLowerCase();
      const isRetirada = tipo.includes('retir') || tipo === 'pickup';
      const isDelivery = tipo.includes('deliv') || tipo === 'entrega';
      const bairro = o.deliveryNeighborhood || o.deliveryBairro || o.deliveryZone || '';
      const lojaPickup = isRetirada ? (o.retiradaLoja || o.pickupUnit || o.unidade || '') : '';
      const lojaLabel = { 'novo_aleixo':'Novo Aleixo', 'allegro':'Allegro Mall', 'cdle':'CDLE' }[_normalizeUnidadeSimple(lojaPickup)] || lojaPickup;
      const dataAg = String(o.scheduledDate||'').slice(0,10);
      const dataFmt = dataAg ? dataAg.split('-').reverse().join('/') : '';
      const turno = o.scheduledPeriod || '';
      const status = o.status || '';
      const statusColor = status === 'Pronto' ? '#15803D'
                       : status === 'Em produção' || status === 'Em producao' ? '#D97706'
                       : status === 'Saiu p/ entrega' ? '#0EA5E9'
                       : '#64748B';

      // Badge do destino (mostra "Retirada NA", "Retirada Allegro", "Delivery")
      const destinoBadge = isRetirada
        ? `<span style="background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">📍 Retirada ${lojaLabel||'?'}</span>`
        : isDelivery
        ? `<span style="background:#DBEAFE;color:#1E40AF;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">🚚 Delivery${bairro?' · '+_escapeHtml(bairro):''}</span>`
        : '';

      return `
      <div style="display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:${naFila?'#F0FDF4':'#fff'};border:1.5px solid ${naFila?'#15803D':'var(--border)'};border-radius:10px;">
        <!-- LINHA 1: Numero, status, cliente -->
        <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-size:13px;color:#7C3AED;font-weight:800;font-family:Monaco,monospace;">#${_highlight(numRaw, busca)}</span>
              ${status ? `<span style="background:${statusColor}20;color:${statusColor};padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;">${_escapeHtml(status)}</span>` : ''}
              ${destinoBadge}
              ${dataFmt ? `<span style="font-size:11px;color:var(--muted);">📅 ${dataFmt}${turno?' · '+turno:''}</span>` : ''}
            </div>
            <div style="font-size:12px;color:#1E293B;margin-top:3px;">
              <strong>${_highlight(cli, busca)}</strong>
              ${recv ? `<span style="color:#64748B;"> → ${_highlight(recv, busca)}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button data-cart-ped-edit-msg="${o._id}" title="Editar mensagem do cartão"
              style="background:${editandoMsg?'#1E40AF':'#fff'};color:${editandoMsg?'#fff':'#1E40AF'};border:1.5px solid #1E40AF;padding:5px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
              ✏️ Mensagem
            </button>
            <button data-cart-ped-edit-dp="${o._id}" title="Editar De:/Para:"
              style="background:${editadoDP?'#7C3AED':'#fff'};color:${editadoDP?'#fff':'#7C3AED'};border:1.5px solid #7C3AED;padding:5px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">
              ${editadoDP?'✓':'+'} De/Para
            </button>
            <button data-cart-ped-toggle="${o._id}"
              style="background:${naFila?'#15803D':'#9F1239'};color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;">
              ${naFila ? '✓ Na fila' : '+ Adicionar'}
            </button>
          </div>
        </div>

        <!-- LINHA 2: Produtos -->
        <div style="font-size:11.5px;color:#374151;background:#F8FAFC;border-radius:6px;padding:7px 9px;border-left:3px solid #9F1239;">
          <span style="font-weight:700;color:#9F1239;">🌸 Produtos:</span> ${_escapeHtml(itensTxt)}
        </div>

        <!-- LINHA 3: Mensagem completa (display ou editor) -->
        ${editandoMsg ? `
        <div style="background:#EFF6FF;border:1.5px solid #1E40AF;border-radius:6px;padding:8px;">
          <div style="font-size:10px;font-weight:800;color:#1E3A8A;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px;">✏️ Editando mensagem do cartão</div>
          <textarea data-ped-msg-input="${o._id}" maxlength="500" rows="4"
            style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #BFDBFE;border-radius:5px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:13px;line-height:1.5;resize:vertical;white-space:pre-wrap;">${_escapeHtml(msgFull)}</textarea>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;gap:6px;">
            <div style="font-size:10px;color:var(--muted);">Use *negrito*, _italico_ e Enter pra quebrar linha. Salva no pedido.</div>
            <div style="display:flex;gap:5px;">
              <button data-cart-ped-msg-cancel="${o._id}" style="background:#fff;color:#475569;border:1px solid var(--border);padding:5px 11px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">Cancelar</button>
              <button data-cart-ped-msg-save="${o._id}" style="background:#15803D;color:#fff;border:none;padding:5px 12px;border-radius:5px;font-size:11px;font-weight:800;cursor:pointer;">💾 Salvar</button>
            </div>
          </div>
        </div>` : `
        <div style="background:linear-gradient(135deg,#FAF7F5,#fff);border:1px solid #FAE8E4;border-radius:6px;padding:9px 11px;">
          <div style="font-size:10px;font-weight:700;color:#9A7548;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px;">💌 Mensagem do cartão</div>
          <div style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:13.5px;color:#1E293B;line-height:1.5;white-space:pre-wrap;">"${_highlight(msgFull, busca)}"</div>
        </div>`}

        <!-- LINHA 4: Editor De/Para (existente) -->
        ${editandoDP ? `
        <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;align-items:end;background:#F1F5F9;padding:8px;border-radius:6px;">
          <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:#475569;font-weight:700;">
            <span>Para:</span>
            <input type="text" data-ped-dp-para="${o._id}" value="${_escapeHtml(overrides.para||'')}" maxlength="60" placeholder="(opcional)" style="padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:#475569;font-weight:700;">
            <span>De:</span>
            <input type="text" data-ped-dp-de="${o._id}" value="${_escapeHtml(overrides.de||'')}" maxlength="60" placeholder="(opcional)" style="padding:6px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;"/>
          </label>
          <button data-cart-ped-dp-save="${o._id}" style="background:#15803D;color:#fff;border:none;padding:7px 10px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">✓ OK</button>
        </div>` : ''}
      </div>`;
    }).join('')}
  </div>`}
</div>

${totalFila > 0 ? `
<div class="card" style="background:linear-gradient(135deg,#FAE8E6,#FAF7F5);">
  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-weight:700;color:#9F1239;">🎯 Fila de impressão: ${totalFila} cartão(ões)</div>
      <div style="font-size:11px;color:var(--muted);">Vai gerar ${folhasPrev} folha(s) A4 — formato: <strong>${formato.nome}</strong></div>
    </div>
    <div style="display:flex;gap:8px;">
      <button id="btn-cart-ped-clear" style="background:#FEE2E2;color:#991B1B;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">✕ Limpar</button>
      <button id="btn-cart-ped-print" style="background:linear-gradient(135deg,#9F1239,#C8736A);color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;">🖨️ Imprimir (${folhasPrev} folha(s))</button>
    </div>
  </div>
</div>` : ''}
`;
}

// ── ABA 3: FORMATOS (visualizacao) ───────────────────────────
function renderTabFormatos() {
  const padrao = _getFormatoPadrao();
  const exemploMsg = 'Feliz Dia das Mães!\nTe *amamos* muito 🌹';
  const admin = _isAdmin();
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;">
    🎨 Formatos Disponíveis
    <span style="font-size:11px;color:var(--muted);font-weight:400;">— escolha o padrão usado em impressões automáticas</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">
    ${CARTAO_FORMATOS.map(f => {
      const ehPadrao = f.id === padrao;
      const preview = renderUmCartao(exemploMsg, f.id, { para:'Maria', de:'João' });
      const previewZoom = Math.min(0.9, 280 / (f.w * 3.78));
      return `
      <div style="background:#fff;border:2px solid ${ehPadrao?'#9F1239':'var(--border)'};border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;color:#1E293B;font-size:14px;">${f.emoji} ${f.nome}</div>
            <div style="font-size:11px;color:var(--muted);">${f.desc}</div>
          </div>
          ${ehPadrao ? '<span style="background:#15803D;color:#fff;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:700;">⭐ PADRÃO</span>' : ''}
        </div>
        <div style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:8px;padding:14px;display:flex;justify-content:center;align-items:center;min-height:200px;overflow:hidden;">
          <div style="transform:scale(${previewZoom.toFixed(2)});transform-origin:center;display:inline-block;">${preview}</div>
        </div>
        <div style="display:flex;gap:6px;">
          ${!ehPadrao ? `<button data-cart-set-padrao="${f.id}" style="flex:1;background:#fff;color:#9F1239;border:1.5px solid #9F1239;padding:8px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">⭐ Definir como padrão</button>` : ''}
          ${admin ? `<button data-cart-edit-formato="${f.id}" style="flex:1;background:#1E293B;color:#fff;border:none;padding:8px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">⚙️ Personalizar</button>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>
  <div style="background:#EFF6FF;border:1px solid #3B82F6;border-radius:8px;padding:12px;margin-top:14px;font-size:12px;color:#1E3A8A;line-height:1.5;">
    💡 <strong>Padrão:</strong> usado nas impressões em massa (datas comemorativas e pedidos do dia).
    ${admin ? 'Na aba "⚙️ Configurações" você pode personalizar cada formato.' : 'Peça pro admin personalizar cada formato.'}
  </div>
</div>
`;
}

// ── ABA 4: HISTORICO ─────────────────────────────────────────
function renderTabHistorico() {
  const hist = _getHistorico();
  return `
<div class="card">
  <div style="font-weight:700;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
    <span>📊 Histórico de Impressões</span>
    ${hist.length > 0 ? `<button id="btn-cart-clear-hist" style="background:#FEE2E2;color:#991B1B;border:none;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">🗑️ Limpar histórico</button>` : ''}
  </div>
  ${hist.length === 0 ? `
  <div style="text-align:center;padding:40px 20px;color:var(--muted);">
    <div style="font-size:48px;margin-bottom:10px;">📭</div>
    <p style="font-size:13px;font-weight:600;">Nenhuma impressão ainda</p>
    <p style="font-size:11px;margin-top:4px;">Aqui aparecerão suas últimas impressões de cartões.</p>
  </div>` : `
  <div style="display:flex;flex-direction:column;gap:8px;">
    ${hist.map(h => {
      const fmt = CARTAO_FORMATOS.find(x => x.id === (h.formatoId||h.templateId));
      return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#fff;border:1px solid var(--border);border-radius:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:#1E293B;">${_escapeHtml(h.origem||'Manual')} · ${fmt ? fmt.nome : (h.formatoId||h.templateId||'—')}</div>
          <div style="font-size:11px;color:var(--muted);">${h.totalCartoes||0} cartão(ões) · ${h.folhas||1} folha(s) A4 · por ${_escapeHtml(h.usuario||'—')}</div>
        </div>
        <div style="font-size:11px;color:var(--muted);text-align:right;">${new Date(h.criadoEm).toLocaleString('pt-BR')}</div>
      </div>`;
    }).join('')}
  </div>`}
</div>
`;
}

// ── ABA 5: CONFIGURACOES (ADMIN) ─────────────────────────────
function renderTabConfigs() {
  const formatoId = S._cartCfgFormato || _getFormatoPadrao();
  const formato = CARTAO_FORMATOS.find(f => f.id === formatoId) || CARTAO_FORMATOS[0];
  const cfg = _getConfigFormato(formatoId) || _getDefaultConfig(formatoId);
  const previewMsg = 'Feliz Dia das Mães!\nTe *amamos* muito 🌹';
  const previewHtml = renderUmCartao(previewMsg, formatoId, { config: cfg, para:'Maria', de:'João' });
  const previewMaxPx = 360;
  const naturalPx = formato.w * 3.78;
  const zoom = Math.min(1.2, Math.max(0.3, previewMaxPx / naturalPx));

  const slider = (id, label, min, max, val, step=1, suffix='') => `
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
      <span style="display:flex;justify-content:space-between;"><span>${label}</span><span style="font-weight:700;color:#9F1239;" id="${id}-val">${val}${suffix}</span></span>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" data-cart-cfg="${id}" style="width:100%;"/>
    </label>`;
  const color = (id, label, val) => `
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
      <span>${label}</span>
      <input type="color" id="${id}" value="${val||'#000000'}" data-cart-cfg="${id}" style="width:100%;height:32px;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer;"/>
    </label>`;
  const text = (id, label, val, placeholder='') => `
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
      <span>${label}</span>
      <input type="text" id="${id}" value="${_escapeHtml(val||'')}" placeholder="${_escapeHtml(placeholder)}" data-cart-cfg="${id}" style="padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:12px;"/>
    </label>`;
  const toggle = (id, label, val) => `
    <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;color:#475569;font-weight:600;cursor:pointer;padding:6px 10px;background:#F8FAFC;border-radius:6px;">
      <span>${label}</span>
      <input type="checkbox" id="${id}" ${val?'checked':''} data-cart-cfg="${id}" style="cursor:pointer;width:18px;height:18px;"/>
    </label>`;
  const select = (id, label, val, options) => `
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#475569;font-weight:600;">
      <span>${label}</span>
      <select id="${id}" data-cart-cfg="${id}" style="padding:7px 9px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:#fff;">
        ${options.map(([v, l]) => `<option value="${v}" ${v===val?'selected':''}>${l}</option>`).join('')}
      </select>
    </label>`;

  const posOpts = [
    ['topo-esq','Topo Esquerda'],['topo-centro','Topo Centro'],['topo-dir','Topo Direita'],
    ['rodape-esq','Rodapé Esquerda'],['rodape-centro','Rodapé Centro'],['rodape-dir','Rodapé Direita'],
  ];
  const alignOpts = [['left','Esquerda'],['center','Centro'],['right','Direita']];
  const borderStyleOpts = [['solid','Sólida'],['dashed','Tracejada'],['dotted','Pontilhada']];
  const fontOpts = CARTAO_FONTES.map(f => [f, f]);
  const deParaEstiloOpts = [
    ['negrito','Negrito'],['italico','Itálico'],['sublinhado','Sublinhado'],['cor','Cor destacada'],
  ];

  return `
<div style="display:grid;grid-template-columns:1fr 400px;gap:18px;align-items:start;">
  <div>
    <!-- Selector de formato -->
    <div class="card" style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px;">⚙️ Personalizar formato</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">
        ${CARTAO_FORMATOS.map(f => {
          const sel = f.id === formatoId;
          return `<button type="button" data-cart-cfg-formato="${f.id}"
            style="background:${sel?'linear-gradient(135deg,#1E293B,#475569)':'#fff'};color:${sel?'#fff':'#1E293B'};
                   border:2px solid ${sel?'#1E293B':'#E5E7EB'};border-radius:10px;padding:10px 12px;
                   cursor:pointer;text-align:left;transition:all .15s;font-family:inherit;">
            <div style="font-weight:700;font-size:13px;">${f.emoji} ${f.nome}</div>
            <div style="font-size:10px;opacity:.85;">${f.w}×${f.h}mm</div>
          </button>`;
        }).join('')}
      </div>
    </div>

    <!-- BRANDING -->
    <details open class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">🏷️ Branding</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        ${text('cfg-instagram','@ Instagram', cfg.instagram, INSTAGRAM_DEFAULT)}
        ${text('cfg-razaoSocial','Razão Social', cfg.razaoSocial, RAZAO_SOCIAL_DEFAULT)}
        ${toggle('cfg-showInstagram','Mostrar @ Instagram?', cfg.showInstagram)}
        ${toggle('cfg-showRazao','Mostrar Razão Social?', cfg.showRazao)}
        ${select('cfg-logoPos','Posição do logo', cfg.logoPos, posOpts)}
        ${select('cfg-razaoPos','Posição da razão social', cfg.razaoPos, posOpts)}
      </div>
      <div style="margin-top:10px;">
        ${slider('cfg-logoSize','Tamanho do logo (% da altura)', 10, 100, cfg.logoSize, 1, '%')}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;">
        ${text('cfg-logo','URL do logo (ou cole base64)', cfg.logo, 'https://...')}
        <label style="background:#9F1239;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">
          📤 Upload
          <input type="file" id="cfg-logo-file" accept="image/*" style="display:none;" data-cart-cfg-file="logo"/>
        </label>
      </div>
      ${cfg.logo ? `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;"><img src="${cfg.logo}" style="height:32px;border:1px solid var(--border);border-radius:4px;padding:4px;background:#fff;"/><button data-cart-cfg-clear="logo" style="background:#FEE2E2;color:#991B1B;border:none;padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;">✕ Remover logo</button></div>` : ''}
    </details>

    <!-- ── NOVO: DE / PARA ── -->
    <details open class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">💌 Estilo do "De:" e "Para:"</summary>
      <div style="margin-top:12px;">
        ${toggle('cfg-showDePara','Exibir "De:" e "Para:" no cartão?', cfg.showDePara)}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${select('cfg-deParaEstilo','Estilo', cfg.deParaEstilo, deParaEstiloOpts)}
        ${color('cfg-deParaColor','Cor (quando "destacada")', cfg.deParaColor)}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${slider('cfg-deParaSize','Tamanho (pt)', 8, 20, cfg.deParaSize, 1, 'pt')}
        ${slider('cfg-deParaEspacamento','Espaçamento abaixo (mm)', 2, 15, cfg.deParaEspacamento, 0.5, 'mm')}
      </div>
    </details>

    <!-- ── NOVO (06/jun/2026): CODIGO DO PEDIDO ── -->
    <details open class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">🔢 Código do pedido (canto do cartão)</summary>
      <div style="font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5;">
        Aparece SO em impressão em massa de pedidos (Cartões → Por Pedido ou Chão de Datas Comemorativas). Ajuda a equipe a localizar qual cartão vai com qual pedido.
      </div>
      <div style="margin-top:12px;">
        ${toggle('cfg-showOrderCode','Exibir código do pedido no cartão?', cfg.showOrderCode !== false)}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${select('cfg-orderCodePos','Posição', cfg.orderCodePos || 'rodape-dir', [
          ['topo-esq',   'Topo esquerdo'],
          ['topo-dir',   'Topo direito'],
          ['rodape-esq', 'Rodapé esquerdo'],
          ['rodape-dir', 'Rodapé direito'],
        ])}
        ${text('cfg-orderCodePrefix','Prefixo (ex: "#", "Ped ")', cfg.orderCodePrefix != null ? cfg.orderCodePrefix : '#', '#')}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${slider('cfg-orderCodeSize','Tamanho (pt)', 5, 14, cfg.orderCodeSize || 7, 0.5, 'pt')}
        ${color('cfg-orderCodeColor','Cor', cfg.orderCodeColor || '#94A3B8')}
      </div>
      <div style="margin-top:10px;">
        ${slider('cfg-orderCodeMargin','Espaçamento do canto (mm)', 0, 10, cfg.orderCodeMargin != null ? cfg.orderCodeMargin : 1.5, 0.1, 'mm')}
      </div>
    </details>

    <!-- FUNDO -->
    <details class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">🖼️ Imagem de fundo</summary>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-top:12px;">
        ${text('cfg-bgImage','URL da imagem de fundo', cfg.bgImage, 'https://...')}
        <label style="background:#9F1239;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">
          📤 Upload
          <input type="file" id="cfg-bg-file" accept="image/*" style="display:none;" data-cart-cfg-file="bgImage"/>
        </label>
      </div>
      ${cfg.bgImage ? `<div style="margin-top:8px;"><button data-cart-cfg-clear="bgImage" style="background:#FEE2E2;color:#991B1B;border:none;padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;">✕ Remover imagem de fundo</button></div>` : ''}
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${slider('cfg-bgImageOpacity','Opacidade da imagem', 10, 100, cfg.bgImageOpacity, 1, '%')}
        ${select('cfg-bgImageFit','Ajuste da imagem', cfg.bgImageFit || 'contain', [
          ['contain', '📐 Caber inteira (recomendado)'],
          ['cover',   '✂️ Cobrir tudo (pode cortar)'],
        ])}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        ${color('cfg-bgColor','Cor de fundo (sem imagem)', cfg.bgColor)}
        ${color('cfg-gradientFrom','Gradient — cor inicial', cfg.gradientFrom)}
        ${color('cfg-gradientTo','Gradient — cor final', cfg.gradientTo)}
      </div>
      <div style="margin-top:10px;">
        ${toggle('cfg-gradientOn','Aplicar gradient overlay?', cfg.gradientOn)}
      </div>
    </details>

    <!-- MARCA DAGUA — pode ser TEXTO ou IMAGEM (upload prevalece) -->
    <details class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">💧 Marca d'água</summary>

      <!-- Upload de imagem da marca dagua -->
      <div style="margin-top:12px;padding:10px;background:#FAF5F5;border-radius:6px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:700;">🖼️ Imagem (opcional — prevalece sobre texto)</div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;">
          <div style="font-size:11px;color:var(--muted);">
            ${cfg.wmImage ? '✅ Imagem anexada' : 'Nenhuma imagem anexada'}
          </div>
          <label style="background:#9F1239;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;">
            📤 Anexar arquivo
            <input type="file" id="cfg-wmImage-file" accept="image/*" style="display:none;" data-cart-cfg-file="wmImage"/>
          </label>
        </div>
        ${cfg.wmImage ? `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;"><img src="${cfg.wmImage}" style="height:42px;border:1px solid var(--border);border-radius:4px;padding:4px;background:#fff;"/><button data-cart-cfg-clear="wmImage" style="background:#FEE2E2;color:#991B1B;border:none;padding:4px 9px;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;">✕ Remover</button></div>` : ''}
        ${cfg.wmImage ? `<div style="margin-top:10px;">${slider('cfg-wmImageSize','Tamanho da imagem (% da largura do cartao)', 20, 100, cfg.wmImageSize||60, 1, '%')}</div>` : ''}
      </div>

      <!-- Texto (fallback se nao tiver imagem) -->
      <div style="margin-top:12px;">
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px;font-weight:700;">✏️ Texto (usado quando nao ha imagem)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${text('cfg-wmText','Texto da marca d\'água', cfg.wmText, '(vazio = sem marca)')}
          ${color('cfg-wmColor','Cor do texto', cfg.wmColor)}
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          ${slider('cfg-wmSize','Tamanho do texto (pt)', 12, 72, cfg.wmSize, 1, 'pt')}
          ${slider('cfg-wmRotation','Rotação (°)', -45, 45, cfg.wmRotation, 1, '°')}
        </div>
      </div>

      <!-- Opacidade (aplica nos dois) -->
      <div style="margin-top:10px;">
        ${slider('cfg-wmOpacity','Opacidade geral (%)', 5, 80, cfg.wmOpacity, 1, '%')}
      </div>
    </details>

    <!-- TIPOGRAFIA -->
    <details class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">🔤 Tipografia da mensagem</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        ${select('cfg-fontFamily','Fonte', cfg.fontFamily, fontOpts)}
        ${color('cfg-fontColor','Cor', cfg.fontColor)}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
        ${slider('cfg-fontSize','Tamanho (pt)', 10, 60, cfg.fontSize, 1, 'pt')}
        ${slider('cfg-letterSpacing','Letter-spacing (px)', 0, 3, cfg.letterSpacing, 0.1, 'px')}
        ${slider('cfg-lineHeight','Line-height', 1.0, 2.0, cfg.lineHeight, 0.05, '')}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${select('cfg-align','Alinhamento', cfg.align, alignOpts)}
        ${toggle('cfg-italic','Itálico?', cfg.italic)}
      </div>
    </details>

    <!-- PADDING -->
    <details class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">📐 Espaçamento interno</summary>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        ${slider('cfg-padTop','Padding top (mm)', 2, 40, cfg.padTop, 0.5, 'mm')}
        ${slider('cfg-padBottom','Padding bottom (mm)', 2, 40, cfg.padBottom, 0.5, 'mm')}
        ${slider('cfg-padLeft','Padding left (mm)', 2, 40, cfg.padLeft, 0.5, 'mm')}
        ${slider('cfg-padRight','Padding right (mm)', 2, 40, cfg.padRight, 0.5, 'mm')}
      </div>
    </details>

    <!-- MARGENS DA MENSAGEM (Marcia 02/jun/2026, lateral 09/jun/2026) -->
    <details open class="card" style="margin-bottom:12px;background:linear-gradient(135deg,#F0F9FF,#fff);border:1px solid #BFDBFE;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;color:#1E40AF;">📏 Margens da mensagem (texto ↔ moldura/blocos)</summary>
      <div style="font-size:11px;color:var(--muted);margin-top:8px;font-style:italic;">Espaço entre a caixa de texto e os 4 lados (topo, rodapé, esquerda, direita). Importante pra evitar que o texto encoste na moldura/borda.</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
        ${slider('cfg-marginTopMsg',   'Topo (da logo) (mm)',         0, 25, cfg.marginTopMsg    ?? 4, 0.5, 'mm')}
        ${slider('cfg-marginBottomMsg','Rodapé (do @instagram) (mm)', 0, 25, cfg.marginBottomMsg ?? 4, 0.5, 'mm')}
        ${slider('cfg-marginLeftMsg',  '← Esquerda (da borda) (mm)',  0, 25, cfg.marginLeftMsg   ?? 3, 0.5, 'mm')}
        ${slider('cfg-marginRightMsg', 'Direita → (da borda) (mm)',   0, 25, cfg.marginRightMsg  ?? 3, 0.5, 'mm')}
      </div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px dashed #BFDBFE;">
        ${toggle('cfg-autofitGrow', '✨ Crescer fonte automaticamente se sobrar espaço? (recomendado: DESLIGADO pra respeitar o tamanho configurado)', cfg.autofitGrow !== false)}
        <div style="font-size:10px;color:var(--muted);margin-top:6px;font-style:italic;">Quando ligado, mensagens curtas crescem até 1.5x o tamanho da fonte. Quando desligado, o tamanho do template é o teto.</div>
      </div>
    </details>

    <!-- BORDA -->
    <details class="card" style="margin-bottom:12px;">
      <summary style="font-weight:700;cursor:pointer;font-size:13px;">🟦 Bordas</summary>
      <div style="margin-top:12px;">
        ${toggle('cfg-borderOn','Mostrar borda?', cfg.borderOn)}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${color('cfg-borderColor','Cor da borda', cfg.borderColor)}
        ${select('cfg-borderStyle','Estilo', cfg.borderStyle, borderStyleOpts)}
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        ${slider('cfg-borderWidth','Espessura (px)', 0.5, 5, cfg.borderWidth, 0.5, 'px')}
        ${slider('cfg-borderRadius','Border radius (px)', 0, 30, cfg.borderRadius, 1, 'px')}
      </div>
    </details>

    <!-- AÇÕES -->
    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;">
        <button id="btn-cart-cfg-save" style="background:linear-gradient(135deg,#15803D,#22C55E);color:#fff;border:none;padding:11px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">💾 Salvar</button>
        <button id="btn-cart-cfg-reset" style="background:#fff;color:#9F1239;border:1.5px solid #9F1239;padding:11px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">🔄 Restaurar padrão</button>
        <button id="btn-cart-cfg-export" style="background:#1E293B;color:#fff;border:none;padding:11px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;">📥 Exportar JSON</button>
        <label style="background:#3B82F6;color:#fff;border:none;padding:11px;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;text-align:center;">
          📤 Importar JSON
          <input type="file" id="cfg-import-file" accept="application/json" style="display:none;"/>
        </label>
      </div>
    </div>
  </div>

  <!-- PREVIEW AO VIVO -->
  <div>
    <div class="card" style="position:sticky;top:20px;">
      <div style="font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
        <span>👁️ Preview ao vivo</span>
        <span style="background:#F1F5F9;color:#475569;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:600;">${formato.w}×${formato.h}mm</span>
      </div>
      <div id="cart-cfg-preview" style="background:linear-gradient(135deg,#F8FAFC,#fff);border:1px dashed #CBD5E1;border-radius:10px;padding:18px;display:flex;justify-content:center;align-items:center;min-height:240px;overflow:auto;">
        <div style="transform:scale(${zoom.toFixed(2)});transform-origin:center;display:inline-block;">${previewHtml}</div>
      </div>
      <div style="background:#FEF3C7;border:1px dashed #F59E0B;border-radius:8px;padding:10px;margin-top:12px;font-size:11px;color:#78350F;line-height:1.5;">
        💡 As alterações atualizam o preview em tempo real. Clique em <strong>💾 Salvar</strong> para persistir.
      </div>
    </div>
  </div>
</div>
`;
}

// ── BIND EVENTS ──────────────────────────────────────────────
export function bindCartoesEvents() {
  const render = () => import('../main.js').then(m => m.render?.());

  // Tabs
  document.querySelectorAll('[data-cart-tab]').forEach(b => {
    b.onclick = () => { S._cartTab = b.dataset.cartTab; render(); };
  });

  // Selector de formato (compartilhado entre Imprimir e Pedidos)
  document.querySelectorAll('[data-cart-formato]').forEach(b => {
    b.onclick = () => { S._cartFormato = b.dataset.cartFormato; render(); };
  });

  // ── ABA IMPRIMIR ──
  const msgEl = document.getElementById('cart-msg');
  if (msgEl) {
    msgEl.addEventListener('input', e => {
      S._cartMsg = e.target.value.slice(0, 500);
      const c = document.getElementById('cart-msg-count');
      if (c) c.textContent = S._cartMsg.length;
    });
  }
  document.getElementById('cart-para')?.addEventListener('input', e => {
    S._cartPara = e.target.value.slice(0, 60);
  });
  document.getElementById('cart-de')?.addEventListener('input', e => {
    S._cartDe = e.target.value.slice(0, 60);
  });
  document.getElementById('cart-show-depara')?.addEventListener('change', e => {
    S._cartShowDePara = !!e.target.checked;
    render();
  });

  const qtyEl = document.getElementById('cart-qty');
  if (qtyEl) {
    qtyEl.addEventListener('input', e => {
      const formato = CARTAO_FORMATOS.find(f => f.id === S._cartFormato) || CARTAO_FORMATOS[0];
      const max = formato.cols * formato.rows;
      S._cartQty = Math.max(1, Math.min(max, parseInt(e.target.value)||1));
      render();
    });
  }

  // Roda o autofit nas previews depois que o DOM atualizou.
  // 2 frames pra garantir que fontes + layout estabilizaram.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { autoFitCartoes(document); } catch(_) {}
  }));
  document.getElementById('btn-cart-go-configs')?.addEventListener('click', () => {
    if (!_isAdmin()) return toast('❌ Acesso restrito ao admin', true);
    S._cartCfgFormato = S._cartFormato;
    S._cartTab = 'configs';
    render();
  });
  document.getElementById('btn-cart-add-fila')?.addEventListener('click', () => {
    const msg = (S._cartMsg||'').trim();
    if (!msg) return toast('❌ Digite a mensagem antes de adicionar à fila', true);
    const formato = CARTAO_FORMATOS.find(f => f.id === S._cartFormato) || CARTAO_FORMATOS[0];
    const max = formato.cols * formato.rows;
    const qty = Math.max(1, Math.min(max, Number(S._cartQty)||1));
    const showDP = !!S._cartShowDePara;
    S._cartFila.push({
      msg, qty, formatoId: S._cartFormato,
      para: showDP ? (S._cartPara || '') : '',
      de:   showDP ? (S._cartDe   || '') : '',
    });
    S._cartMsg = '';
    S._cartPara = '';
    S._cartDe = '';
    toast(`✅ Adicionado à fila`);
    render();
  });
  document.querySelectorAll('[data-cart-fila-del]').forEach(b => {
    b.onclick = () => {
      const i = parseInt(b.dataset.cartFilaDel);
      S._cartFila.splice(i, 1);
      render();
    };
  });
  document.getElementById('btn-cart-imprimir')?.addEventListener('click', () => {
    const fila = S._cartFila;
    const lista = [];
    if (fila.length > 0) {
      fila.forEach(f => {
        for (let i=0;i<f.qty;i++) lista.push({
          msg:f.msg, formatoId:f.formatoId, para:f.para||'', de:f.de||'',
        });
      });
      const msg = (S._cartMsg||'').trim();
      if (msg) {
        const formato = CARTAO_FORMATOS.find(x => x.id === S._cartFormato) || CARTAO_FORMATOS[0];
        const max = formato.cols * formato.rows;
        const qty = Math.max(1, Math.min(max, Number(S._cartQty)||1));
        const showDP = !!S._cartShowDePara;
        for (let i=0;i<qty;i++) lista.push({
          msg, formatoId: S._cartFormato,
          para: showDP ? (S._cartPara||'') : '',
          de:   showDP ? (S._cartDe||'')   : '',
        });
      }
    } else {
      const msg = (S._cartMsg||'').trim();
      if (!msg) return toast('❌ Digite uma mensagem antes de imprimir', true);
      const formato = CARTAO_FORMATOS.find(x => x.id === S._cartFormato) || CARTAO_FORMATOS[0];
      const max = formato.cols * formato.rows;
      const qty = Math.max(1, Math.min(max, Number(S._cartQty)||1));
      const showDP = !!S._cartShowDePara;
      for (let i=0;i<qty;i++) lista.push({
        msg, formatoId: S._cartFormato,
        para: showDP ? (S._cartPara||'') : '',
        de:   showDP ? (S._cartDe||'')   : '',
      });
    }
    if (lista.length === 0) return toast('❌ Nada para imprimir', true);
    imprimirCartoes(lista, { origem: fila.length > 0 ? 'Fila manual' : 'Manual' });
    S._cartFila = [];
    render();
  });

  // ── ABA PEDIDOS ──
  document.getElementById('cart-ped-data')?.addEventListener('change', e => {
    S._cartPedData = e.target.value;
    render();
  });

  // Busca com debounce (200ms) — sem re-render full a cada tecla
  const buscaEl = document.getElementById('cart-ped-busca');
  if (buscaEl) {
    let buscaTimer = null;
    buscaEl.addEventListener('input', e => {
      const val = e.target.value;
      clearTimeout(buscaTimer);
      buscaTimer = setTimeout(() => {
        S._cartPedBusca = val;
        render();
      }, 200);
    });
    // mantem foco apos render: se valor diferente, posicionar cursor no fim
    if (S._cartPedBusca) {
      try {
        buscaEl.focus();
        const len = buscaEl.value.length;
        buscaEl.setSelectionRange(len, len);
      } catch(_) {}
    }
  }
  document.getElementById('btn-cart-ped-busca-clear')?.addEventListener('click', () => {
    S._cartPedBusca = '';
    render();
  });

  document.querySelectorAll('[data-cart-ped-toggle]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.cartPedToggle;
      const idx = S._cartPedFila.indexOf(id);
      if (idx >= 0) S._cartPedFila.splice(idx, 1);
      else S._cartPedFila.push(id);
      render();
    };
  });
  document.querySelectorAll('[data-cart-ped-edit-dp]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.cartPedEditDp;
      S._cartPedEditDP = (S._cartPedEditDP === id) ? null : id;
      render();
    };
  });
  document.querySelectorAll('[data-cart-ped-dp-save]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.cartPedDpSave;
      const para = document.querySelector(`[data-ped-dp-para="${id}"]`)?.value || '';
      const de   = document.querySelector(`[data-ped-dp-de="${id}"]`)?.value || '';
      S._cartPedOverrides[id] = { para: para.slice(0,60), de: de.slice(0,60) };
      S._cartPedEditDP = null;
      toast('✅ De:/Para: salvos');
      render();
    };
  });

  // ── Edicao inline da MENSAGEM do cartao ─────────────────────
  document.querySelectorAll('[data-cart-ped-edit-msg]').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.cartPedEditMsg;
      S._cartPedEditMsg = (S._cartPedEditMsg === id) ? null : id;
      // Fecha o editor De/Para se estiver aberto no mesmo pedido
      if (S._cartPedEditMsg && S._cartPedEditDP === id) S._cartPedEditDP = null;
      render();
    };
  });
  document.querySelectorAll('[data-cart-ped-msg-cancel]').forEach(b => {
    b.onclick = () => {
      S._cartPedEditMsg = null;
      render();
    };
  });
  document.querySelectorAll('[data-cart-ped-msg-save]').forEach(b => {
    b.onclick = async () => {
      const id = b.dataset.cartPedMsgSave;
      const ta = document.querySelector(`[data-ped-msg-input="${id}"]`);
      if (!ta) return;
      const novoTexto = String(ta.value || '').slice(0, 500);
      const order = (S.orders || []).find(x => String(x._id) === String(id));
      if (!order) return toast('❌ Pedido nao encontrado', true);
      const textoAntigo = order.cardMessage || '';
      if (novoTexto === textoAntigo) {
        S._cartPedEditMsg = null;
        render();
        return;
      }
      // Atualiza local imediato (otimista)
      order.cardMessage = novoTexto;
      S._cartPedEditMsg = null;
      render();
      // Persiste no backend
      try {
        const { PUT, PATCH } = await import('../services/api.js');
        await (PATCH ? PATCH('/orders/' + id, { cardMessage: novoTexto }) : PUT('/orders/' + id, { cardMessage: novoTexto }));
        toast('✅ Mensagem do cartão atualizada');
      } catch (e) {
        // Reverte se backend falhou
        order.cardMessage = textoAntigo;
        render();
        toast('❌ Erro ao salvar mensagem: ' + (e.message || ''), true);
      }
    };
  });
  document.getElementById('btn-cart-ped-clear')?.addEventListener('click', () => {
    S._cartPedFila = [];
    render();
  });
  document.getElementById('btn-cart-ped-print')?.addEventListener('click', () => {
    const ids = S._cartPedFila || [];
    const formatoId = S._cartFormato || _getFormatoPadrao();
    const lista = ids.map(id => {
      const o = (S.orders||[]).find(x => String(x._id) === String(id));
      if (!o) return null;
      const ovr = S._cartPedOverrides[String(id)] || {};
      return {
        msg: o.cardMessage || '',
        formatoId,
        pedido: (o.orderNumber||o.numero||''),
        para: ovr.para || '',
        de:   ovr.de   || '',
        // 06/jun/2026: codigo aparece no canto do cartao
        orderCode: o.orderNumber || o.numero || String(o._id||'').slice(-4),
      };
    }).filter(Boolean);
    if (!lista.length) return toast('❌ Nenhum pedido na fila', true);
    imprimirCartoes(lista, { origem: 'Pedidos do dia' });
    S._cartPedFila = [];
    render();
  });

  // ── ABA FORMATOS ──
  document.querySelectorAll('[data-cart-set-padrao]').forEach(b => {
    b.onclick = () => {
      _saveFormatoPadrao(b.dataset.cartSetPadrao);
      toast('✅ Formato padrão atualizado');
      render();
    };
  });
  document.querySelectorAll('[data-cart-edit-formato]').forEach(b => {
    b.onclick = () => {
      if (!_isAdmin()) return toast('❌ Acesso restrito ao admin', true);
      S._cartCfgFormato = b.dataset.cartEditFormato;
      S._cartTab = 'configs';
      render();
    };
  });

  // ── ABA HISTORICO ──
  document.getElementById('btn-cart-clear-hist')?.addEventListener('click', () => {
    if (!confirm('Limpar todo o histórico de impressões de cartões?')) return;
    _saveHistorico([]);
    render();
  });

  // ── ABA CONFIGURACOES ──
  bindConfigsEvents(render);
}

// ── BIND DA ABA CONFIGURACOES ────────────────────────────────
function bindConfigsEvents(render) {
  if (!_isAdmin()) return;

  document.querySelectorAll('[data-cart-cfg-formato]').forEach(b => {
    b.onclick = () => { S._cartCfgFormato = b.dataset.cartCfgFormato; render(); };
  });

  const formatoId = S._cartCfgFormato || _getFormatoPadrao();
  const current = _getConfigFormato(formatoId) || _getDefaultConfig(formatoId);
  S._cartCfgBuffer = { ...current };

  const updatePreview = () => {
    const cfg = S._cartCfgBuffer;
    const formato = CARTAO_FORMATOS.find(f => f.id === formatoId) || CARTAO_FORMATOS[0];
    const previewMsg = 'Feliz Dia das Mães!\nTe *amamos* muito 🌹';
    const html = renderUmCartao(previewMsg, formatoId, { config: cfg, para:'Maria', de:'João' });
    const cont = document.getElementById('cart-cfg-preview');
    if (cont) {
      const naturalPx = formato.w * 3.78;
      const zoom = Math.min(1.2, Math.max(0.3, 360 / naturalPx));
      cont.innerHTML = `<div style="transform:scale(${zoom.toFixed(2)});transform-origin:center;display:inline-block;">${html}</div>`;
    }
  };

  const numericFields = new Set([
    'logoSize','bgImageOpacity','wmSize','wmRotation','wmOpacity','wmImageSize',
    'fontSize','letterSpacing','lineHeight',
    'padTop','padBottom','padLeft','padRight',
    'marginTopMsg','marginBottomMsg',
    'marginLeftMsg','marginRightMsg',   // 09/jun/2026 — margens laterais
    'borderWidth','borderRadius',
    'deParaSize','deParaEspacamento',
    'orderCodeSize',  // 06/jun/2026 — codigo do pedido
    'orderCodeMargin', // 09/jun/2026 — espaco do canto
  ]);
  const boolFields = new Set([
    'showInstagram','showRazao','gradientOn','italic','borderOn',
    'showDePara',
    'showOrderCode',  // 06/jun/2026 — codigo do pedido
    'autofitGrow',    // 09/jun/2026 — controle de crescer fonte
  ]);

  document.querySelectorAll('[data-cart-cfg]').forEach(el => {
    const key = el.dataset.cartCfg.replace(/^cfg-/, '');
    const handler = () => {
      let val;
      if (boolFields.has(key)) val = el.checked;
      else if (numericFields.has(key)) val = parseFloat(el.value) || 0;
      else val = el.value;
      S._cartCfgBuffer[key] = val;
      const lbl = document.getElementById(el.id + '-val');
      if (lbl) {
        const cur = el.value;
        const suffix = lbl.textContent.replace(/^[\d.\-]+/, '');
        lbl.textContent = cur + suffix;
      }
      updatePreview();
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });

  // Marcia (02/jun/2026 v7): redimensiona mais agressivo. Foto de
  // celular 4MB vira ~150-300KB. Mantem PNG so se ficar < 400KB
  // (transparencia preservada pra logo/marca dagua). Caso contrario
  // JPEG q=0.75. Limite alvo: 500KB max.
  const _compressImage = (file) => new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Nao e imagem'));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 1000;
        const MAX_H = 1000;
        let { width, height } = img;
        if (width > MAX_W || height > MAX_H) {
          const ratio = Math.min(MAX_W / width, MAX_H / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        const dataPng = canvas.toDataURL('image/png');
        // PNG so se < 400KB (transparencia compensa o peso)
        if (dataPng.length < 400 * 1024) {
          return resolve(dataPng);
        }
        // JPEG q=0.75 — qualidade boa, peso menor
        const dataJpg = canvas.toDataURL('image/jpeg', 0.75);
        if (dataJpg.length < 500 * 1024) {
          return resolve(dataJpg);
        }
        // Ainda grande? Reduz pra 800x800 + q=0.65
        const cv2 = document.createElement('canvas');
        const r = Math.min(800 / width, 800 / height);
        cv2.width = Math.round(width * r);
        cv2.height = Math.round(height * r);
        const ctx2 = cv2.getContext('2d');
        ctx2.imageSmoothingEnabled = true;
        ctx2.imageSmoothingQuality = 'high';
        ctx2.drawImage(img, 0, 0, cv2.width, cv2.height);
        resolve(cv2.toDataURL('image/jpeg', 0.65));
      };
      img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });

  document.querySelectorAll('[data-cart-cfg-file]').forEach(el => {
    el.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const key = el.dataset.cartCfgFile;
      if (file.size > 10 * 1024 * 1024) {
        return toast('❌ Arquivo maior que 10MB — escolha imagem menor', true);
      }
      toast('⏳ Processando imagem...');
      let dataUrl;
      try {
        dataUrl = await _compressImage(file);
      } catch (err) {
        return toast('❌ Erro ao processar imagem: ' + (err.message || ''), true);
      }
      const sizeKB = Math.round(dataUrl.length / 1024);
      S._cartCfgBuffer[key] = dataUrl;
      const txt = document.getElementById('cfg-' + key);
      if (txt) txt.value = dataUrl;
      try {
        await _saveConfigFormato(formatoId, S._cartCfgBuffer);
        toast(`💾 Imagem anexada (${sizeKB}KB) — sincronizando pra todos`);
      } catch (err) {
        // Erro ja foi mostrado por _saveConfigFormato — soh nao rerendera
        return;
      }
      render();
    });
  });

  document.querySelectorAll('[data-cart-cfg-clear]').forEach(b => {
    b.onclick = async () => {
      const key = b.dataset.cartCfgClear;
      S._cartCfgBuffer[key] = '';
      const txt = document.getElementById('cfg-' + key);
      if (txt) txt.value = '';
      try {
        await _saveConfigFormato(formatoId, S._cartCfgBuffer);
        toast('🗑️ Imagem removida');
      } catch (_) {}
      render();
    };
  });

  document.getElementById('btn-cart-cfg-save')?.addEventListener('click', async () => {
    await _saveConfigFormato(formatoId, S._cartCfgBuffer);
    toast('💾 Configurações salvas — válidas pra todos os usuários');
    render();
  });

  document.getElementById('btn-cart-cfg-reset')?.addEventListener('click', () => {
    if (!confirm('Restaurar configurações padrão deste formato?')) return;
    _resetConfigFormato(formatoId);
    toast('🔄 Configurações restauradas');
    render();
  });

  document.getElementById('btn-cart-cfg-export')?.addEventListener('click', () => {
    const data = JSON.stringify({ formatoId, config: S._cartCfgBuffer }, null, 2);
    const blob = new Blob([data], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cartao-config-${formatoId}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('📥 Backup exportado');
  });

  document.getElementById('cfg-import-file')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const cfg = data.config || data;
        _saveConfigFormato(formatoId, { ..._getDefaultConfig(formatoId), ...cfg });
        toast('📤 Configurações importadas');
        render();
      } catch (err) {
        toast('❌ Arquivo JSON inválido', true);
      }
    };
    reader.readAsText(file);
  });
}

// ── IMPRESSAO ────────────────────────────────────────────────
// 'lista' = array de {msg, formatoId, pedido?, para?, de?}
// Agrupa por formatoId. TODAS as folhas saem A4 PORTRAIT, margem 5mm.
export function imprimirCartoes(lista, opts = {}) {
  if (!Array.isArray(lista) || lista.length === 0) {
    return toast('❌ Nada para imprimir', true);
  }
  // Marcia (06/jun/2026 — pre Namorados): warning ao gerar lote grande
  // antes que o browser comece a trabalhar (autofit em 600+ elementos
  // pode travar 30s-2min em maquinas modestas). Cliente decide se
  // quer continuar ou dividir em 2 jobs menores.
  if (lista.length > 100) {
    const folhas = Math.ceil(lista.length / 16);
    const ok = confirm(`Vai gerar ${lista.length} cartões (≈${folhas} folhas A4).\n\nPode demorar 30 segundos a 2 minutos pra montar a visualização.\n\nDica: se preferir, imprima em 2 lotes pra ir mais rápido.\n\nContinuar?`);
    if (!ok) return;
  }
  // Normaliza
  lista = lista.map(c => ({
    ...c,
    formatoId: c.formatoId || c.templateId || _getFormatoPadrao(),
  }));

  // Agrupa por formato (mantem ordem)
  const grupos = [];
  let atual = null;
  lista.forEach(c => {
    if (!atual || atual.formatoId !== c.formatoId) {
      atual = { formatoId: c.formatoId, items: [] };
      grupos.push(atual);
    }
    atual.items.push(c);
  });

  const folhasHtml = [];
  let totalFolhas = 0;

  grupos.forEach(grupo => {
    const formato = CARTAO_FORMATOS.find(f => f.id === grupo.formatoId) || CARTAO_FORMATOS[0];
    const porFolha = formato.cols * formato.rows;
    const totalGrupo = grupo.items.length;
    const folhasGrupo = Math.ceil(totalGrupo / porFolha);
    totalFolhas += folhasGrupo;

    for (let f = 0; f < folhasGrupo; f++) {
      const ini = f * porFolha;
      const lote = grupo.items.slice(ini, ini + porFolha);
      const cellsHtml = lote.map(c => renderUmCartao(c.msg, c.formatoId, {
        para: c.para||'',
        de: c.de||'',
        // 06/jun/2026: passa o codigo do pedido (se existir) — aparece
        // no canto configurado pelo admin via aba Configuracoes.
        orderCode: c.orderCode || c.orderNumber || c.numero || '',
        // 09/jun/2026: hideDePara forca esconder bloco De/Para nesta
        // impressao (Chao de Datas passa true).
        hideDePara: !!opts.hideDePara,
      })).join('');
      const vazios = porFolha - lote.length;
      const vaziosHtml = Array(vazios).fill(
        `<div style="width:${formato.w}mm;height:${formato.h}mm;"></div>`
      ).join('');
      folhasHtml.push(`
        <div class="cart-folha"
             style="width:${formato.folhaW}mm;height:${formato.folhaH}mm;padding:${formato.margemFolha}mm;box-sizing:border-box;page-break-after:always;">
          <div style="display:grid;grid-template-columns:repeat(${formato.cols},${formato.w}mm);grid-auto-rows:${formato.h}mm;gap:${formato.gap}mm;justify-content:center;align-content:center;height:100%;">
            ${cellsHtml}${vaziosHtml}
          </div>
        </div>
      `);
    }
  });

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return toast('❌ Pop-up bloqueado — habilite no navegador', true);

  const total = lista.length;
  const fontsHref = _googleFontsHref();

  w.document.open();
  w.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Cartões — ${total} cartão(ões) · ${totalFolhas} folha(s)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${fontsHref}" rel="stylesheet">
  <style>
    /* Marcia (09/jun/2026): @page margin 0 — aproveita TODA a area
       imprimivel do papel. O espacamento dos cartoes pra borda eh
       controlado pelo formato.margemFolha (chaoDatas=0.3mm).
       NOTA: algumas impressoras tem area nao-imprimivel de hardware
       (~3-5mm) que nao pode ser eliminada via CSS. */
    @page { size: A4 portrait; margin: 0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin:0; padding:0; font-family: Arial, sans-serif; background:#F1F5F9; }
    .cart-folha { background:#fff; margin:10px auto; box-shadow:0 2px 8px rgba(0,0,0,.1); }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      body { background:#fff; margin:0; padding:0; }
      .cart-folha { margin:0 !important; box-shadow:none; }
      .no-print { display:none !important; }
      /* Bordas-guia (dashed cinza) somem no print */
      .cart-folha div[style*="dashed #CBD5E1"] { border-color:transparent !important; }
    }
    .bar { background:#9F1239;color:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:10; }
    .bar h1 { margin:0;font-size:16px;font-weight:700; }
    .bar p { margin:0;font-size:12px;opacity:.85; }
    .bar button { background:#fff;color:#9F1239;border:none;padding:10px 22px;border-radius:8px;font-weight:800;cursor:pointer;font-size:13px; }
    .bar button:hover { background:#FAE8E6; }
  </style>
</head>
<body>
  <div class="bar no-print">
    <div>
      <h1>💌 ${total} cartão(ões) · ${totalFolhas} folha(s) A4 retrato</h1>
      <p>Formatos: ${[...new Set(grupos.map(g=>{const f=CARTAO_FORMATOS.find(x=>x.id===g.formatoId);return f?f.nome:g.formatoId;}))].join(' · ')}</p>
    </div>
    <button onclick="window.print()">🖨️ Imprimir</button>
  </div>
  ${folhasHtml.join('')}
  <script>
    // Autofit em CHUNKS de 30 elementos por frame (06/jun/2026 — pre
    // Namorados). Antes processava 608 elementos em loop sincrono x2
    // passes — travava o browser por minutos com 300 cartoes. Agora
    // libera a thread com requestAnimationFrame entre chunks.
    function _autoFitOne(el){
      var wrap = el.closest('[data-cart-msg-wrap]');
      if(!wrap) return;
      var startPt = Number(el.getAttribute('data-autofit-from')) || 14;
      var minPt = 6;
      // Marcia (09/jun/2026): respeita data-autofit-grow do template.
      // '0' = nao cresce (startPt eh o teto). Padrao = cresce.
      var allowGrow = el.getAttribute('data-autofit-grow') !== '0';
      var maxPt = allowGrow ? Math.min(24, startPt * 1.5) : startPt;
      var pt = startPt;
      el.style.fontSize = pt + 'pt';
      var ovStart = wrap.scrollHeight > wrap.clientHeight + 2 || wrap.scrollWidth > wrap.clientWidth + 2;
      if (ovStart) {
        var g1 = 100;
        while(g1-- > 0 && pt > minPt) {
          pt = Math.max(minPt, pt - 0.5);
          el.style.fontSize = pt + 'pt';
          if (!(wrap.scrollHeight > wrap.clientHeight + 2 || wrap.scrollWidth > wrap.clientWidth + 2)) break;
        }
      } else if (allowGrow) {
        var g2 = 120;
        while(g2-- > 0 && pt < maxPt){
          var tryPt = Math.min(maxPt, pt + 0.5);
          el.style.fontSize = tryPt + 'pt';
          if (wrap.scrollHeight > wrap.clientHeight + 2 || wrap.scrollWidth > wrap.clientWidth + 2) {
            el.style.fontSize = pt + 'pt';
            break;
          }
          pt = tryPt;
          if (pt >= maxPt) break;
        }
      }
      // Quando !allowGrow e ja cabe: deixa no startPt (nao cresce).
    }
    function _autoFitChunk(els, start, done){
      var end = Math.min(start + 30, els.length);
      for (var i = start; i < end; i++) _autoFitOne(els[i]);
      try {
        var pb = document.getElementById('fv-print-progress');
        if (pb) pb.textContent = 'Ajustando ' + Math.min(end, els.length) + ' / ' + els.length;
      } catch(_){}
      if (end < els.length) {
        requestAnimationFrame(function(){ _autoFitChunk(els, end, done); });
      } else {
        done && done();
      }
    }
    function _autoFit(done){
      var els = document.querySelectorAll('[data-cart-autofit]');
      if (!els.length) return done && done();
      _autoFitChunk(els, 0, done);
    }
    // Indicador visual de progresso (so na tela, nao imprime)
    document.body.insertAdjacentHTML('afterbegin', '<div id="fv-print-progress" class="no-print" style="position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#9F1239;color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:700;z-index:99;box-shadow:0 4px 12px rgba(0,0,0,.25);">Ajustando texto…</div>');
    function _readyToPrint(){
      _autoFit(function(){
        // 2o pass pra pegar fontes que carregaram tarde
        _autoFit(function(){
          try { var pb = document.getElementById('fv-print-progress'); if (pb) pb.remove(); } catch(_){}
          setTimeout(function(){ window.print(); }, 200);
        });
      });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(_readyToPrint);
    } else {
      setTimeout(_readyToPrint, 600);
    }
  <\/script>
</body>
</html>`);
  w.document.close();

  _addHistorico({
    origem: opts.origem || 'Manual',
    formatoId: lista[0]?.formatoId || _getFormatoPadrao(),
    templateId: lista[0]?.formatoId || _getFormatoPadrao(), // compat
    totalCartoes: total,
    folhas: totalFolhas,
  });

  toast(`🖨️ ${total} cartão(ões) gerados em ${totalFolhas} folha(s)!`);
}

// ── INTEGRACAO COM RELATORIOS (chao de datas comemorativas) ──
// Marcia (09/jun/2026): no Chao de Datas o cartao tem que ter SO a
// mensagem — o "De:/Para:" do template salvo NAO deve aparecer aqui
// (gera confusao com a mensagem). Por isso passa hideDePara:true,
// que faz o renderUmCartao ignorar cfg.showDePara so nesta impressao.
// O template salvo nao eh alterado.
export function imprimirCartoesDePedidos(pedidos, origemLabel = 'Datas Comemorativas') {
  const comMsg = (pedidos || []).filter(o => o.cardMessage && String(o.cardMessage).trim());
  if (comMsg.length === 0) {
    return toast('❌ Nenhum pedido com mensagem de cartão preenchida', true);
  }
  // Marcia (09/jun/2026): SEMPRE usa o formato/template dedicado
  // 'chaoDatas' — Marcia configura em Configuracoes > Cartoes > 🌹 Chao
  // de Datas. Nao mistura com o template padrao usado em outros lugares.
  const formatoId = 'chaoDatas';
  const lista = comMsg.map(o => ({
    msg: o.cardMessage,
    formatoId,
    pedido: o.orderNumber || o.numero || '',
    para: o.recipient || o.destinatario || o.recipientName || '',
    de:   o.clientName || o.client?.name || '',
    // 06/jun/2026: codigo do pedido pra aparecer no canto do cartao
    orderCode: o.orderNumber || o.numero || String(o._id||'').slice(-4),
  }));
  // 09/jun/2026 v2: nao forca mais hideDePara — agora o template
  // 'chaoDatas' tem showDePara=false como default, mas Marcia pode
  // ligar via Configuracoes se quiser. Template manda.
  imprimirCartoes(lista, { origem: origemLabel });
}
