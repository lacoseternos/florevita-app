import { S, API } from '../state.js';

// ── API CALL — com timeout, rate-limit e renovação de sessão ──
const _apiCalls = {};

export async function api(method, path, body=null) {
  // Rate limit client-side: so aplica a GETs (que sao alta volume).
  // POST/PUT/PATCH/DELETE passam direto pra evitar bloquear acoes do usuario.
  if (method === 'GET') {
    const key = method+path;
    const now = Date.now();
    _apiCalls[key] = (_apiCalls[key]||[]).filter(t=>now-t<10000);
    if(_apiCalls[key].length >= 60) throw new Error('Muitas requisições. Aguarde um momento.');
    _apiCalls[key].push(now);
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(()=>ctrl.abort(), 90000);

  const effectiveToken = (S.user?.isLocalColab)
    ? (localStorage.getItem('fv_backend_token') || S.token)
    : S.token;

  const opts = {
    method,
    signal: ctrl.signal,
    headers:{
      'Content-Type':'application/json',
      ...(effectiveToken ? {'Authorization':'Bearer '+effectiveToken} : {})
    }
  };
  if(body) opts.body = JSON.stringify(body);

  try{
    const res = await fetch(API+path, opts);
    clearTimeout(timeout);
    let data;
    try { data = await res.json(); } catch(e) { data = {}; }

    if(res.status===401 && S.user && !S.user.isLocalColab){
      // 401 = token expirado/invalido. Antes: logout AUTOMATICO destruia
      // qualquer modal aberto (cadastro de produto, edicao de pedido, etc).
      // Agora: SO desloga se o usuario nao esta no meio de uma acao (sem
      // modal aberto). Senao, retorna erro amigavel para retentar.
      if (!S._modal) {
        const { logout } = await import('./auth.js');
        logout();
        throw new Error('SESSAO_EXPIRADA');
      }
      throw new Error('Sessão expirada. Saia e entre novamente para continuar.');
    }

    if(!res.ok) {
      // Erro detalhado: combina texto do backend com codigo HTTP pra o usuario saber o que aconteceu.
      const baseMsg = data.error || data.message || `Erro HTTP ${res.status}`;
      // Anexa detalhes uteis (campo duplicado, validacao, etc) que o backend manda
      const extras = [];
      if (data.field) extras.push(`campo: ${data.field}`);
      if (data.name && data.name !== 'Error') extras.push(`tipo: ${data.name}`);
      if (data.duplicate) extras.push('duplicado');
      if (data.available !== undefined) extras.push(`disponivel: ${data.available}`);
      const fullMsg = extras.length ? `${baseMsg} (${extras.join(', ')})` : baseMsg;
      const err = new Error(fullMsg);
      err.status = res.status;
      err.serverData = data;
      throw err;
    }
    return data;
  }catch(e){
    clearTimeout(timeout);
    if(e.name==='AbortError') throw new Error('🐌 Servidor demorando para responder. Verifique sua internet e tente novamente.');
    if(/Failed to fetch|NetworkError|net::/i.test(e.message)) {
      throw new Error('🌐 Sem conexão com o servidor. Verifique sua internet.');
    }
    throw e;
  }
}

export const GET    = p     => api('GET',p);
export const POST   = (p,b) => api('POST',p,b);
export const PUT    = (p,b) => api('PUT',p,b);
export const PATCH  = (p,b) => api('PATCH',p,b);
export const DELETE = p     => api('DELETE',p);
