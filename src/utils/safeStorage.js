// ── SAFE LOCAL STORAGE ───────────────────────────────────────
// Helper que evita 'QuotaExceededError' quando o navegador enche
// (~5-10MB de limite). Estrategia:
//   1) Tenta o setItem normal
//   2) Se der quota, faz LIMPEZA AUTOMATICA de caches gordos
//      em ordem de prioridade (mais descartavel primeiro)
//   3) Tenta de novo
//   4) Se ainda falhar, loga o erro mas NAO propaga (evita quebrar a UI)
//
// Uso: safeSetItem('chave', valor) em vez de localStorage.setItem.
// Tambem expoe forceCleanup() pra limpar manualmente quando precisar.

// Lista de keys que podem ser descartadas com seguranca (ordem: do
// menos critico pro mais critico). Todas sao caches reconstrutavies
// a partir do backend.
const DISPOSABLE_KEYS = [
  'fv_notif_logs',       // logs de notificacao do PDV
  'fv_image_cache',      // cache de imagens (geralmente o maior)
  'fv_data_cache',       // cache geral (orders/products/etc)
  'fv_chat_messages',    // mensagens antigas do chat (vem do backend)
  'fv_search_history',   // historico de busca
  'fv_recent_views',     // produtos vistos recentemente
  'fv_printed_card',     // estado de impressao (so visual)
  'fv_printed_comanda',  // idem
  'fv_whats_hist',       // historico WhatsApp
];

// Keys que podem ser TRIMADAS (manter so ultimos N items) em vez de deletadas
const TRIMMABLE_KEYS = {
  'fv_activities': 50,   // mantem so ultimas 50 atividades
};

// Helper: retorna tamanho aproximado de uma key (em bytes UTF-8)
function _sizeOf(value) {
  try { return new Blob([value]).size; } catch { return (value||'').length * 2; }
}

// Lista keys gordas no localStorage atual (top N maiores)
function _topHeavyKeys(limit = 5) {
  const entries = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const v = localStorage.getItem(key) || '';
    entries.push({ key, size: _sizeOf(v) });
  }
  entries.sort((a, b) => b.size - a.size);
  return entries.slice(0, limit);
}

// Limpeza inteligente — descarta caches em camadas ate liberar espaco
export function emergencyCleanup() {
  const removed = [];
  const trimmed = [];
  // 1a camada: caches descartavies (remove inteiro)
  for (const k of DISPOSABLE_KEYS) {
    if (localStorage.getItem(k) !== null) {
      try { localStorage.removeItem(k); removed.push(k); } catch {}
    }
  }
  // 2a camada: trim de keys que armazenam listas (mantem ultimos N)
  for (const [k, limit] of Object.entries(TRIMMABLE_KEYS)) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > limit) {
        const trimmedArr = arr.slice(-limit);
        try {
          localStorage.setItem(k, JSON.stringify(trimmedArr));
          trimmed.push(k + ' (' + arr.length + '->' + limit + ')');
        } catch(_) {
          // Se ainda falhar, deleta
          try { localStorage.removeItem(k); removed.push(k); } catch {}
        }
      }
    } catch(_) {
      try { localStorage.removeItem(k); removed.push(k); } catch {}
    }
  }
  // 3a camada: se ainda nao liberou o suficiente, corta os MAIORES
  // (excluindo dados criticos como token e config)
  const KEEP = new Set(['fv2_token', 'fv_config', 'fv_versao', 'fv2_user', 'fv_ec_cfg']);
  const heavy = _topHeavyKeys(15).filter(e => !KEEP.has(e.key));
  for (const { key, size } of heavy.slice(0, 5)) {
    if (size > 50*1024 && localStorage.getItem(key) !== null) {
      try { localStorage.removeItem(key); removed.push(key + ' ('+Math.round(size/1024)+'KB)'); } catch {}
    }
  }
  console.warn('[safeStorage] limpeza — removido:', removed, '| trimmed:', trimmed);
  return { removed, trimmed };
}

// SET seguro: tenta + retry com cleanup se quota
export function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e && (e.name === 'QuotaExceededError' || e.code === 22 || /quota/i.test(e.message||''))) {
      console.warn('[safeStorage] QUOTA cheia ao salvar', key, '- fazendo limpeza...');
      emergencyCleanup();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e2) {
        // Ainda nao deu — chave eh muito grande. Loga e segue (nao bloqueia UI)
        console.error('[safeStorage] ainda sem espaco apos cleanup, key='+key+' size='+_sizeOf(value)+' bytes');
        return false;
      }
    }
    // Outro erro — propaga
    throw e;
  }
}

// Helper: limpa preemptivamente se localStorage estiver perto do limite
// (chama no boot do app pra evitar quota durante uso)
export function preemptiveCheck() {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      total += _sizeOf(localStorage.getItem(key) || '');
    }
    const MB = total / (1024*1024);
    if (MB > 4) {
      console.warn(`[safeStorage] uso atual ${MB.toFixed(1)}MB — fazendo cleanup preventivo`);
      emergencyCleanup();
    }
    return MB;
  } catch { return 0; }
}

// Expoe no window pra debug rapido pelo console (admin pode rodar:
// window._fvCleanup() pra liberar espaco manualmente)
if (typeof window !== 'undefined') {
  window._fvCleanup = emergencyCleanup;
  window._fvStorageUsage = () => {
    let total = 0;
    const breakdown = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const size = _sizeOf(localStorage.getItem(key) || '');
      total += size;
      breakdown.push({ key, sizeKB: (size/1024).toFixed(1) });
    }
    breakdown.sort((a, b) => parseFloat(b.sizeKB) - parseFloat(a.sizeKB));
    console.table(breakdown.slice(0, 20));
    console.log('Total:', (total/(1024*1024)).toFixed(2), 'MB');
    return { total, breakdown };
  };
}
