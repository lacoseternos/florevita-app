// ── STORE DE NOTIFICACOES (persistente) ──────────────────────
// Centraliza todas as notificacoes do sistema (pagamentos pendentes,
// alertas de pedidos, etc). Salva em localStorage para sobreviver a
// reload e pra alimentar a Central de Alertas (sino).
//
// Cada notificacao: {
//   id:       string  (unico — usado para dedup)
//   type:     string  (ex: 'payment-pending', 'late-order')
//   title:    string  (titulo curto)
//   body:     string  (texto completo, pode conter HTML simples)
//   ts:       number  (Date.now())
//   read:     boolean (false ate o usuario clicar 'marcar como lida')
//   dismissed:boolean (true = oculta de listagens; nao excluida do historico)
//   meta:     object  (qualquer dado extra: orderId, phone, link, etc)
//   actions:  array   (botoes inline: [{label, type:'whatsapp'|'open-order', payload}])
// }

const STORAGE_KEY = 'fv_notifications_v1';
const MAX_NOTIFS  = 200; // limite p/ nao explodir localStorage

let _cache = null;
const _listeners = new Set();

function load(){
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(_cache)) _cache = [];
  } catch(_) { _cache = []; }
  return _cache;
}

function persist(){
  if (!_cache) return;
  // Mantem so as MAX_NOTIFS mais recentes (corte por ts desc)
  if (_cache.length > MAX_NOTIFS) {
    _cache.sort((a,b) => (b.ts||0) - (a.ts||0));
    _cache = _cache.slice(0, MAX_NOTIFS);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache)); } catch(_){}
  _listeners.forEach(fn => { try { fn(); } catch(_){} });
}

// Adiciona uma nova notificacao (se ja existe pelo id, marca como nao-lida
// e atualiza ts — util para alertas recorrentes do mesmo pedido)
export function addNotification(n){
  if (!n || !n.id) return;
  const list = load();
  const idx = list.findIndex(x => x.id === n.id);
  const merged = {
    id: n.id,
    type: n.type || 'info',
    title: n.title || '',
    body: n.body || '',
    ts: n.ts || Date.now(),
    read: false,
    dismissed: false,
    meta: n.meta || {},
    actions: Array.isArray(n.actions) ? n.actions : [],
  };
  if (idx >= 0) {
    // Mantem 'read' se o usuario ja leu antes (evita re-marcar como nova
    // se a mesma notificacao for re-disparada). Mas atualiza ts.
    merged.read = list[idx].read;
    merged.dismissed = false; // se foi re-emitida, considera ativa
    list[idx] = merged;
  } else {
    list.push(merged);
  }
  persist();
}

// Lista todas as notificacoes (mais recentes primeiro)
// opts.includeDismissed = true para mostrar tambem as descartadas
export function getNotifications(opts = {}){
  const list = load();
  const filtered = opts.includeDismissed ? list : list.filter(n => !n.dismissed);
  return [...filtered].sort((a,b) => (b.ts||0) - (a.ts||0));
}

// Conta de nao-lidas (para o badge do sino)
export function getUnreadCount(){
  return load().filter(n => !n.dismissed && !n.read).length;
}

// Marca uma notificacao como lida
export function markAsRead(id){
  const list = load();
  const it = list.find(n => n.id === id);
  if (it && !it.read) { it.read = true; persist(); }
}

// Marca TODAS como lidas (sem descartar)
export function markAllAsRead(){
  const list = load();
  let changed = false;
  list.forEach(n => { if (!n.read) { n.read = true; changed = true; } });
  if (changed) persist();
}

// Descartar (oculta da listagem mas mantem no historico)
export function dismissNotification(id){
  const list = load();
  const it = list.find(n => n.id === id);
  if (it && !it.dismissed) { it.dismissed = true; it.read = true; persist(); }
}

// Limpar TODAS — esvazia o store
export function clearAllNotifications(){
  _cache = [];
  try { localStorage.removeItem(STORAGE_KEY); } catch(_){}
  _listeners.forEach(fn => { try { fn(); } catch(_){} });
}

// Subscribe (re-render quando o store muda)
export function onNotificationsChange(fn){
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
