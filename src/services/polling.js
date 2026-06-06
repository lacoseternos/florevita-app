// ── POLLING TEMPO REAL ────────────────────────────────────────
import { S } from '../state.js';
import { GET } from './api.js';
import { getHiddenUsers, mergeUserExtra } from './auth.js';
import { mergeDriverAssignments, saveCachedData } from './cache.js';
import { toast } from '../utils/helpers.js';
import { filtrarPedidosPorUnidade } from '../utils/unidadeRules.js';
import { checkAndRingIfoodOrders } from './ifoodRingtone.js';
import { checkAndAlertEcommerce, primeEcommerceSeen } from './ecommerceAlert.js';

let _pollTimer = null, _pollCount = 0;
const POLL_PAGES = ['producao','expedicao','entregador','rota','pedidos','dashboard','caixa','financeiro','colaboradores','relatorios'];

export async function pollData(){
  if(!S.user||!S.token||S.loading||S._modal||S._iaLoading) return;
  // OTIMIZACAO CRITICA: quando o usuario esta numa pagina que NAO depende de
  // dados em tempo real (categorias, produtos, configuracoes, RH, ecommerce,
  // catalogoCliente, etc), NAO faz fetch nenhum. Antes: rodava todo ciclo e
  // baixava 200-1000 registros a cada 3s mesmo sem usar — UI travava em
  // celulares e PCs mais fracos.
  if (!POLL_PAGES.includes(S.page)) {
    // Mantem o sync-dot animando suave pra dar sinal de vida
    return;
  }
  _pollCount++;

  // ENTREGADOR: poll otimizado — so pedidos, sem activities/products/etc.
  // FIX critico Marcia (29/mai/2026 - 2o report): pedido #01197 nao apareceu
  // no app da Jucy. CAUSA: limit=100 trunca pedidos antigos quando volume
  // alto. Se ha 100+ pedidos mais novos, o pedido em rota da Jucy fica
  // FORA do cache do app dela — invisivel.
  // FIX: 3 queries em paralelo cobrindo TODOS cenarios criticos:
  //   1) 'Saiu p/ entrega' (sem limite — todos em rota agora)
  //   2) 'Entregue' de hoje (pra estatisticas)
  //   3) Pedidos recentes (fallback se backend nao tem filtro status)
  const cargoLow = String(S.user?.cargo||'').toLowerCase();
  if (cargoLow === 'entregador' || cargoLow.includes('entregador')) {
    try {
      const _hojeP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
      // FIX Marcia (30/mai/2026): entregues ULTIMOS 7 DIAS pra alimentar
      // o filtro "Semana" do app do entregador. Antes baixava so hoje →
      // toggle Semana ficava vazio.
      const _seteAtrasP = new Date(); _seteAtrasP.setDate(_seteAtrasP.getDate() - 7);
      const _seteAtrasStr = _seteAtrasP.toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
      const [emRota, entregues, recentes] = await Promise.all([
        // 1) TODOS os "Saiu p/ entrega" — nao limita por data (pedido pode
        //    estar em rota desde ontem por logistica)
        GET('/orders?status=' + encodeURIComponent('Saiu p/ entrega') + '&limit=500').catch(() => null),
        // 2) Entregues nos ultimos 7 dias (pra stats Hoje + Semana)
        GET('/orders?status=' + encodeURIComponent('Entregue') + '&scheduledFrom=' + _seteAtrasStr + '&scheduledTo=' + _hojeP + '&limit=1000').catch(() => null),
        // 3) Fallback: pedidos recentes (caso backend nao suporte filtro status)
        GET('/orders?limit=300').catch(() => null),
      ]);
      // Dedup + merge das 3 fontes
      const byId = new Map();
      [emRota, entregues, recentes].forEach(list => {
        if (Array.isArray(list)) list.forEach(o => { if (o?._id) byId.set(String(o._id), o); });
      });
      if (byId.size === 0) return;
      const merged = mergeDriverAssignments([...byId.values()]);
      const curSig = merged.map(o => (o._id||o.id)+':'+(o.updatedAt||'')+':'+(o.status||'')).join('|');
      if (S._ordersSig !== curSig) {
        S.orders = merged;
        S._ordersSig = curSig;
        import('../main.js').then(m => m.render && m.render()).catch(()=>{});
      }
    } catch(_){}
    return;
  }

  try{
    // A cada ciclo: atualiza pedidos e atividades (sincroniza entre dispositivos)
    // FIX: adicionar limits — antes, /orders e /activities sem limit retornavam
    // listas inteiras a cada 3s (centenas de KB/req). 300 e suficiente.
    //
    // Marcia (27/mai/2026): 2a query em paralelo pra pegar pedidos agendados
    // dos proximos 14 dias (mesmo se criados ha muito tempo). Resolve bug
    // de pedido nao aparecer no dashboard no dia da entrega.
    const _hojeP = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
    const _futP = new Date(); _futP.setDate(_futP.getDate() + 14);
    const _futStr = _futP.toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });

    // Marcia (06/jun/2026 — pre Namorados): limit dos agendados
    // reduzido de 2000 -> 800 (cobre folga com 350 ped/dia × 14 dias
    // mesmo nos picos), e activities de 200 -> 100. Reducao de banda
    // por ciclo ~60% (Atlas M0 banda outbound era gargalo).
    const [orders, agendadosP, activities] = await Promise.all([
      GET('/orders?limit=300').catch(()=>null),
      GET(`/orders?scheduledFrom=${_hojeP}&scheduledTo=${_futStr}&limit=800`).catch(()=>null),
      GET('/activities?limit=100').catch(()=>null),
    ]);
    // Merge recentes + agendados, dedup por _id
    let ordersMerged = orders;
    if (Array.isArray(orders) && Array.isArray(agendadosP)) {
      const map = new Map();
      for (const o of orders) if (o?._id) map.set(String(o._id), o);
      for (const o of agendadosP) if (o?._id && !map.has(String(o._id))) map.set(String(o._id), o);
      ordersMerged = [...map.values()];
    } else if (Array.isArray(agendadosP) && !Array.isArray(orders)) {
      ordersMerged = agendadosP;
    }
    let changed = false;
    if(ordersMerged){
      // Marcia (02/jun/2026): MERGE com S.orders existente em vez de
      // substituir. Antes o polling apagava pedidos antigos buscados
      // por relatorios — usuario abria 'Mês Ant.' (5000 pedidos de
      // maio), polling rodava em ~5s, S.orders = ordersMerged (300
      // recentes) → maio sumia da tela depois de 5-15s.
      // Agora preservamos historicos ja carregados.
      const incoming = mergeDriverAssignments(ordersMerged);
      const map = new Map();
      // Comeca com o que ja temos (preserva carregamentos historicos
      // de relatorios — ranges grandes via /orders?from=...&to=...)
      for (const o of (S.orders || [])) {
        if (o?._id) map.set(String(o._id), o);
      }
      // Aplica novos (sobreescreve por _id — atualizacoes ganham)
      for (const o of incoming) {
        if (!o?._id) continue;
        const id = String(o._id);
        const prev = map.get(id);
        if (!prev) { map.set(id, o); continue; }
        // Se ambos tem updatedAt, mantem o mais novo
        const pU = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0;
        const nU = o.updatedAt ? new Date(o.updatedAt).getTime() : 0;
        map.set(id, nU >= pU ? o : prev);
      }
      const merged = [...map.values()];
      // Comparacao leve: length + hash dos _id+updatedAt (evita JSON.stringify
      // de 500 pedidos a cada 5s, que trava tablets)
      const curSig = merged.map(o => (o._id||o.id)+':'+(o.updatedAt||'')+':'+(o.status||'')).join('|');
      if (S._ordersSig !== curSig) {
        S.orders = merged;
        S._ordersSig = curSig;
        changed = true;
      }
      // Toca toque de telefone para pedidos iFood novos (ignora primeira carga)
      if(_pollCount > 1){
        try { checkAndRingIfoodOrders(merged); }
        catch(e){ console.warn('[iFood ring] erro:', e); }
        // Alerta de novo pedido do SITE/E-commerce (toast + beep + card)
        try { checkAndAlertEcommerce(merged); }
        catch(e){ console.warn('[ecommAlert] erro:', e); }
      } else {
        // Primeira carga: marca todos pedidos do site existentes como ja vistos
        // pra nao disparar alerta em massa
        try { primeEcommerceSeen(merged); } catch(_){}
        // Na primeira carga, marca todos os pedidos iFood existentes como "ja vistos"
        // para nao tocar quando o usuario abre o sistema pela primeira vez.
        try {
          const seen = new Set(JSON.parse(localStorage.getItem('fv_ifood_ringed_ids')||'[]'));
          merged.forEach(o => {
            const isIfood = (o.source === 'iFood') || (o.orderNumber||'').startsWith('IF');
            if(isIfood){
              const id = o._id || o.ifoodOrderId || o.orderNumber;
              if(id) seen.add(id);
            }
          });
          localStorage.setItem('fv_ifood_ringed_ids', JSON.stringify([...seen].slice(-500)));
        } catch(_){}
      }
    }
    // Mescla atividades remotas com cache local — leitores de fv_activities
    // (pedidos.js, expedicao.js, etc.) passam a ver atividades de todos os dispositivos.
    // Marcia (07/jun/2026): BUG que inflava o historico do pedido com dezenas
    // de duplicatas:
    //   1) Local cria activity com id 'timestamp_random'
    //   2) Backend grava e devolve com '_id' Mongo (id diferente)
    //   3) Dedup antigo usava 'a.id' (que era diferente) → MESMA atividade
    //      passa 2x na lista
    //   4) Cada novo poll re-mescla local (que ja tem as duplicatas) com
    //      remote (que traz a "versao backend") → duplicatas se acumulam
    //      polinomialmente.
    // Fix: chave de dedup NORMALIZADA independente de id —
    //   orderId | type | userEmail | janela30s
    // Prioriza a versao do BACKEND (mais autoritativa) quando colide.
    if(Array.isArray(activities)){
      try{
        const local = JSON.parse(localStorage.getItem('fv_activities')||'[]');
        // Normaliza pra forma comum
        const norm = (a, fonte) => ({
          id: a._id || a.id || '',
          userId: a.userId || '',
          userName: a.user || a.userName || '',
          userEmail: String(a.userEmail||'').toLowerCase(),
          userUnit: a.userUnit || '',
          colabId: a.colabId || '',
          type: a.type || '',
          orderId: a.orderId || '',
          orderNumber: a.orderNumber || '—',
          clientName: a.clientName || '',
          items: a.items || [],
          total: a.total || 0,
          meta: a.meta || null,
          date: a.date || a.createdAt,
          _fonte: fonte, // 'backend' tem prioridade sobre 'local'
        });
        const remote = activities.map(a => norm(a, 'backend'));
        const localN = local.map(a => norm(a, 'local'));
        // Dedup robusto: orderId | type | userEmail | bucket de 30s
        // Janela de 30s tolera latencia do POST + roundtrip do polling.
        const _bucket = (d) => {
          const t = new Date(d).getTime();
          return isNaN(t) ? '0' : String(Math.floor(t / 30000));
        };
        const _chave = (a) => `${a.orderId}|${a.type}|${a.userEmail}|${_bucket(a.date)}`;
        const mapa = new Map();
        // Primeiro local, depois backend (backend SOBRESCREVE se colidir
        // — versao autoritativa do servidor).
        for (const a of localN) {
          const k = _chave(a);
          if (!mapa.has(k)) mapa.set(k, a);
        }
        for (const a of remote) {
          const k = _chave(a);
          mapa.set(k, a); // sobrescreve sempre que vem do backend
        }
        // Mantem so as 500 mais recentes (anti-overflow do localStorage)
        const result = [...mapa.values()]
          .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 500);
        const newStr = JSON.stringify(result);
        if(newStr !== JSON.stringify(local)){
          try { localStorage.setItem('fv_activities', newStr); }
          catch(_) { /* quota — ignora */ }
          changed = true;
        }
      }catch(e){ /* ignora */ }
    }

    // A cada 2 ciclos (~16s): atualiza NOTAS FISCAIS (pra o botao rosa aparecer
    // em outros dispositivos logo apos a emissao)
    if(_pollCount%2===0 || _pollCount===1){
      const notas = await GET('/notas-fiscais?limit=200').catch(()=>null);
      if(Array.isArray(notas)){
        const newStr = JSON.stringify(notas);
        const oldStr = JSON.stringify(S._notasFiscais || []);
        if(newStr !== oldStr){
          S._notasFiscais = notas;
          changed = true;
        }
      }
    }

    // Hash leve por _id+updatedAt — evita JSON.stringify() de arrays
    // grandes contendo base64 (foto de produto). JSON.stringify de 200
    // produtos com base64 trava UI 200-500ms a cada 32s. Hash em ~1ms.
    const lightSig = (arr) => Array.isArray(arr)
      ? arr.map(x => `${x?._id||x?.id||''}:${x?.updatedAt||x?.modifiedAt||''}`).join('|')
      : '';

    // A cada 4 ciclos (~32s): atualiza produtos
    // Marcia (06/jun/2026 pre Namorados): adiciona limit=500 pra nao
    // baixar catalogo inteiro com base64. Antes: 5 admins × catalogo
    // ~3MB cada poll = 15MB outbound a cada 32s. Render free banda
    // estourava no pico.
    if(_pollCount%4===0 || (_pollCount===1 && S.products.length===0)){
      const [products, stock] = await Promise.all([
        GET('/products?limit=500').catch(()=>null),
        GET('/stock/moves?limit=500').catch(()=>null),
      ]);
      if(products && products.length > 0){
        if (lightSig(products) !== lightSig(S.products)) {
          S.products = products;
          changed = true;
        }
      }
      if(stock && lightSig(stock) !== lightSig(S.stockMoves)){ S.stockMoves=stock; changed=true; }
      // FINANCIAL ENTRIES: busca do BACKEND e MESCLA com locais (nao
      // pode dropar entradas que so existem em localStorage — ex: salvas
      // offline ou sem _id do backend).
      try {
        const beFe = await GET('/financial/entries').catch(()=>null);
        const localFe = JSON.parse(localStorage.getItem('fv_financial')||'[]');
        if (Array.isArray(beFe)) {
          // Mescla: chave = _id (backend) ou id (local)
          const mapa = new Map();
          // Primeiro local (preserva itens que nao chegaram ao backend)
          localFe.forEach(e => { const k = e._id || e.id; if (k) mapa.set(String(k), e); });
          // Depois backend (sobrepoe)
          beFe.forEach(e => { const k = e._id || e.id; if (k) mapa.set(String(k), e); });
          const merged = [...mapa.values()];
          // Persiste merged em localStorage (fonte da verdade local)
          localStorage.setItem('fv_financial', JSON.stringify(merged));
          if (lightSig(merged) !== lightSig(S.financialEntries)) {
            S.financialEntries = merged; changed = true;
          }
        } else {
          // Backend offline — usa local
          if (lightSig(localFe) !== lightSig(S.financialEntries)) {
            S.financialEntries = localFe; changed = true;
          }
        }
      } catch(_) {
        const localFe = JSON.parse(localStorage.getItem('fv_financial')||'[]');
        if (lightSig(localFe) !== lightSig(S.financialEntries)) {
          S.financialEntries = localFe; changed = true;
        }
      }
    }

    // A cada 8 ciclos (~64s): atualiza clientes (e usuários se admin)
    if(_pollCount%8===0){
      const isAdminUser = S.user && (
        S.user.role === 'Administrador' ||
        S.user.cargo === 'admin' ||
        S.user.cargo === 'Administrador' ||
        S.user.unidade === 'todas' ||
        S.user.unit === 'Todas'
      );
      const [clients, users] = await Promise.all([
        GET('/clients').catch(()=>null),
        isAdminUser ? GET('/users').catch(()=>null) : Promise.resolve(null),
      ]);
      if(clients && clients.length > 0 && lightSig(clients) !== lightSig(S.clients)){
        S.clients = clients; changed = true;
      }
      if(users && users.length > 0){
        const hidden=getHiddenUsers();
        const merged=(users||[]).filter(x=>!hidden.includes(x._id)).map(mergeUserExtra);
        if(lightSig(merged) !== lightSig(S.users)){ S.users=merged; changed=true; }
      }
    }

    // Detecta se a usuaria esta interagindo com um campo de formulario
    // ABERTO (digitando, com select aberto, etc). Re-renderizar nesse
    // momento destrui o input/select e ela perde o que estava fazendo.
    // Especificamente: select de entregador na Expedicao "some" porque
    // o dropdown aberto e re-criado a cada 3s.
    const ae = document.activeElement;
    const userInteracting = ae && (
      ae.tagName === 'INPUT' ||
      ae.tagName === 'SELECT' ||
      ae.tagName === 'TEXTAREA' ||
      ae.isContentEditable
    );

    if(changed && !S.loading && POLL_PAGES.includes(S.page) && !S._modal && !userInteracting){
      try{ const { render } = await import('../main.js'); render(); }catch(e){ console.error('pollData render:', e); }
      // Atualiza cache local com dados frescos
      saveCachedData();
      const ind=document.getElementById('sync-dot');
      if(ind){ind.style.background='#4ade80';setTimeout(()=>{if(ind)ind.style.background='rgba(255,255,255,.3)';},600);}
    } else if (changed && userInteracting) {
      // Usuaria interagindo: marca pendente e re-tenta no proximo ciclo.
      // Sync-dot pisca laranja para mostrar que tem dado novo aguardando.
      const ind=document.getElementById('sync-dot');
      if(ind){ind.style.background='#F59E0B';}
    }
    // Verifica datas especiais no primeiro poll do dia (só se modal não aberto)
    if(_pollCount===1 && !S._modal){
      try{
        const { checkDatasEspeciaisAlertas } = await import('../pages/clientes.js');
        const alertasDatas = checkDatasEspeciaisAlertas();
        if(alertasDatas.length > 0 && !S._datasAlertadas){
          S._datasAlertadas = true;
          alertasDatas.forEach(a=>{
            toast(`${a.icon||'🎂'} ${a.urgencia}: ${a.tipo} de ${a.pessoa} — Cliente ${a.client?.name||''}`, false);
          });
        }
      }catch(e){ console.warn('[poll] checkDatasEspeciaisAlertas não disponível:', e); }
    }

    // ── VARREDURA MP: pedidos com payment=Link em aberto ─────────
    // Roda a cada 2 polls (~6-10s) — confirma aprovacao MP rapidamente.
    // Marcia (06/jun/2026 pre Namorados): backend agora tem cron de
    // recovery (5min). Frontend so reforca pra UI atualizar rapido.
    // GUARD _mpScanRunning evita backlog: se o scan anterior nao
    // terminou (caso de 300 pendentes), pula o tick atual.
    if ((_pollCount === 1 || _pollCount % 2 === 1) && !S._mpScanRunning) {
      try {
        S._mpScanRunning = true;
        const PAID_STATUSES = new Set(['Aprovado','Pago','Pago na Entrega','Cancelado','Negado']);
        const isLinkPayment = (p) => {
          const s = String(p||'').toLowerCase();
          return s.includes('link') || s.includes('mercado pago') || s === 'mp' || s === 'pix' || s === 'cartão' || s === 'cartao';
        };
        // Agora limita a 60 pendentes mais recentes (cobre o pico
        // sem afogar — backend cron pega o resto a cada 5min).
        const todosPendentes = (S.orders || []).filter(o =>
          isLinkPayment(o.payment) && !PAID_STATUSES.has(o.paymentStatus)
        );
        todosPendentes.sort((a, b) => {
          const ta = new Date(a.createdAt || 0).getTime();
          const tb = new Date(b.createdAt || 0).getTime();
          return tb - ta;
        });
        const HEAD_LIMIT = 60;
        const fila = todosPendentes.slice(0, HEAD_LIMIT);
        const _checkOne = (o) => GET('/public/mp/payment-status?orderId=' + encodeURIComponent(o._id))
          .then(r => {
            if (r?.approved) {
              const atualizado = {
                ...o,
                paymentStatus: 'Aprovado',
                mpPaymentId: r.mpPaymentId || o.mpPaymentId,
                paymentApprovedAt: o.paymentApprovedAt || new Date(),
                updatedAt: new Date().toISOString(),
              };
              S.orders = S.orders.map(x => x._id === o._id ? atualizado : x);
              // Marcia (07/jun/2026): log detalhado de aprovacao automatica
              // pelo MP — antes nao aparecia no historico do pedido.
              try {
                import('../utils/helpers.js').then(({ logActivity }) => {
                  logActivity('mp_aprovado', atualizado, {
                    fonte: 'Mercado Pago (automatico)',
                    mpPaymentId: r.mpPaymentId || '',
                    metodoOriginal: o.payment || '',
                    valorAprovado: o.total || 0,
                  });
                }).catch(()=>{});
              } catch(_){}
              toast(`🎉 Pedido ${o.orderNumber || ''} pago no Mercado Pago — aprovado automaticamente!`);
              import('../main.js').then(m => m.render?.()).catch(()=>{});
              return true;
            }
            return false;
          }).catch(() => false);
        // Lotes de 10
        const BATCH = 10;
        (async () => {
          try {
            for (let i = 0; i < fila.length; i += BATCH) {
              const slice = fila.slice(i, i + BATCH);
              await Promise.all(slice.map(_checkOne));
            }
          } finally {
            S._mpScanRunning = false;
          }
        })().catch(() => { S._mpScanRunning = false; });
      } catch (_) { S._mpScanRunning = false; }
    }
  }catch(e){ console.warn('pollData erro:', e); }
}

export function startPolling(ms=5000){
  stopPolling();
  _pollCount=0;
  // Intervalo dinamico baseado na pagina aberta:
  //   - Entregador: 2s (designacoes mudam rapido)
  //   - Producao/Expedicao/Dashboard: 3s (operacao em tempo real)
  //   - Demais paginas com polling (financeiro, pedidos, etc): 5s
  // pollData ja faz early-return cedo se a pagina nao precisa de
  // atualizacao em tempo real (POLL_PAGES), entao nao ha custo extra
  // de ficar com 3s default.
  const isDriver = S.user?.role === 'Entregador' || S.user?.cargo === 'entregador';
  const fastPages = ['producao','expedicao','dashboard','entregador'];
  const getInterval = () => {
    if (isDriver) return 2000;
    if (fastPages.includes(S.page)) return 3000;
    return ms;
  };
  // Re-cria o interval quando a pagina muda — assim producao/expedicao
  // ficam em 3s e financeiro em 5s, sem code review.
  let lastPage = S.page;
  const tick = () => {
    if (S.page !== lastPage) {
      // pagina mudou — re-inicia com novo intervalo se necessario
      lastPage = S.page;
      if (_pollTimer) clearInterval(_pollTimer);
      _pollTimer = setInterval(tick, getInterval());
    }
    pollData();
  };
  _pollTimer = setInterval(tick, getInterval());
  pollData();
  // Marcia (06/jun/2026 pre Namorados): limpa fv_driver_assignments
  // dos pedidos que nao existem mais no S.orders. Antes nunca era
  // chamado — quota localStorage estourava em pico (350 ped/dia ×
  // 7 dias = 2500 entries).
  try {
    import('./cache.js').then(m => {
      if (m.cleanOldAssignments) {
        setTimeout(() => { try { m.cleanOldAssignments(); } catch(_){} }, 5000);
      }
    }).catch(()=>{});
  } catch(_){}
}
export function stopPolling(){ if(_pollTimer){clearInterval(_pollTimer);_pollTimer=null;} }
