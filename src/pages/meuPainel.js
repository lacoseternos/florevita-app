// ── MEU PAINEL ────────────────────────────────────────────────
// Pagina pessoal de cada colaborador (Atendimento) — somente leitura.
// Mostra:
//   1. Historico de Pontos (entrada, saida almoco, volta, saida)
//   2. Comissões / vendas atribuídas no mes
import { S } from '../state.js';
import { $c } from '../utils/formatters.js';
import { GET } from '../services/api.js';
import { renderMetasParaAtendente } from './metas.js';

// Cache em memoria dos pontos do user (evita refetch a cada render)
// TTL curto (15s) para o ponto do dia atual aparecer rapido apos bater.
let _pontosCache = null;
let _pontosCacheAt = 0;

async function loadPontos(userId) {
  if (_pontosCache && (Date.now() - _pontosCacheAt) < 10_000) return _pontosCache;
  try {
    // Backend /ponto retorna TODOS os registros (ignora query). Filtramos
    // local por userId para nao misturar pontos de outras colaboradoras.
    // Aceita match por _id, id, colabId ou email para tolerar diferencas
    // de formato do user (uuid local vs ObjectId backend).
    const r = await GET('/ponto').catch(() => null);
    const all = Array.isArray(r) ? r : (r?.records || r?.data || []);
    const uid = String(userId||'');
    // Constroi conjunto de identificadores aceitos a partir do user logado
    const meusIds = new Set([uid, String(S.user?._id||''), String(S.user?.id||''), String(S.user?.colabId||'')].filter(Boolean));
    const meuEmail = String(S.user?.email||'').toLowerCase();
    _pontosCache = all.filter(rec => {
      const ridStr = String(rec.userId||rec.colabId||rec.user||'');
      if (ridStr && meusIds.has(ridStr)) return true;
      const remail = String(rec.userEmail||rec.email||'').toLowerCase();
      if (meuEmail && remail && remail === meuEmail) return true;
      return false;
    });
    _pontosCacheAt = Date.now();
    return _pontosCache;
  } catch { return []; }
}

// ── HISTORICO DE PEDIDOS DEDICADO (para acumular comissoes meses anteriores)
// S.orders e limitado a 300 mais recentes (cache global); para o Meu Painel
// precisamos de um historico maior para que colaboradoras com volume alto
// vejam comissoes de meses anteriores. Buscamos ate 2000 pedidos uma vez
// por sessao (cache 5min).
let _ordersHistCache = null;
let _ordersHistCacheAt = 0;
async function loadOrdersHistorico() {
  if (_ordersHistCache && (Date.now() - _ordersHistCacheAt) < 5*60_000) return _ordersHistCache;
  try {
    const r = await GET('/orders?limit=2000').catch(() => null);
    _ordersHistCache = Array.isArray(r) ? r : [];
    _ordersHistCacheAt = Date.now();
    return _ordersHistCache;
  } catch { return []; }
}

// ── COMISSÕES — FONTE ÚNICA (servidor) ───────────────────────
// Marcia (28/jun/2026): em vez de recalcular no navegador (que divergia do
// RH por causa de dados/sessão/percentual diferentes), o painel agora PUXA o
// número PRONTO do servidor (GET /comissoes/me). O backend usa as MESMAS
// regras, com TODOS os pedidos e o % oficial do banco — então bate 100% com
// o RH. Impossível divergir.
let _comissoesCache = null;     // array de meses, ou null = ainda não carregou
let _comissoesLoading = false;
async function loadComissoes(retry = 0) {
  _comissoesLoading = true;
  try {
    const r = await GET('/comissoes/me');
    const meses = Array.isArray(r?.meses) ? r.meses : (Array.isArray(r) ? r : null);
    if (meses === null) throw new Error('resposta inesperada');
    _comissoesCache = meses;
    _comissoesLoading = false;
    return meses;
  } catch (e) {
    // Backend hibernando (Render cold start) ou falha — NÃO mostra número
    // errado: retenta (backoff) até 4x e re-renderiza quando chegar.
    if (retry < 4) {
      setTimeout(() => {
        loadComissoes(retry + 1)
          .then(() => import('../main.js').then(m => m.render()).catch(()=>{}))
          .catch(()=>{});
      }, 3000 * (retry + 1));
    } else {
      _comissoesCache = []; // desiste após ~30s
      _comissoesLoading = false;
    }
    return _comissoesCache || [];
  }
}

function fmtMes(yyyymm) {
  const [y, m] = yyyymm.split('-');
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[Number(m)-1]} / ${y}`;
}

function fmtData(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Manaus', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return iso; }
}

function fmtHora(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Manaus', hour:'2-digit', minute:'2-digit' });
  } catch { return '—'; }
}

// Os registros do backend ja vem CONSOLIDADOS por dia — cada registro
// tem chegada/saidaAlmoco/voltaAlmoco/saida como CAMPOS DIRETOS.
// Antes este helper assumia 'type'+'time' (formato antigo de eventos),
// resultando em pontos vazios para TODAS as colaboradoras.
//
// Fallback: tambem aceita o formato antigo (event-based com r.type/r.time)
// para compatibilidade com registros legados.
function agruparPontosPorDia(records) {
  // Detecta formato: se tem chegada/saidaAlmoco direto, usa formato consolidado
  const consolidados = records.filter(r => r && (r.chegada || r.entrada || r.saidaAlmoco || r.voltaAlmoco || r.saida));
  const eventos     = records.filter(r => r && r.type && r.time && !(r.chegada || r.saidaAlmoco));

  // Formato consolidado: 1 record = 1 dia
  const out = consolidados.map(r => ({
    data: r.date || (r.createdAt||'').slice(0,10),
    entrada:     r.chegada     || r.entrada     || '',
    saidaAlmoco: r.saidaAlmoco || '',
    voltaAlmoco: r.voltaAlmoco || '',
    saidaIntervalo: r.saidaIntervalo || '',
    voltaIntervalo: r.voltaIntervalo || '',
    saida:       r.saida       || '',
  })).filter(p => p.data);

  // Formato antigo (event-based): agrupa por data
  if (eventos.length) {
    const grupos = {};
    for (const r of eventos) {
      const data = r.date || (r.createdAt ? r.createdAt.slice(0,10) : '');
      if (!data) continue;
      if (!grupos[data]) grupos[data] = { data, entrada:'', saidaAlmoco:'', voltaAlmoco:'', saida:'' };
      const t = String(r.type||'').toLowerCase();
      const hora = r.time || '';
      if (t.includes('entrada') || t === 'chegada') grupos[data].entrada = hora;
      else if (t.includes('saida_almoco') || t.includes('saidaalmoco') || (t === 'almoco' && !grupos[data].saidaAlmoco)) grupos[data].saidaAlmoco = hora;
      else if (t.includes('volta_almoco') || t.includes('voltaalmoco') || t === 'volta') grupos[data].voltaAlmoco = hora;
      else if (t.includes('saida')) grupos[data].saida = hora;
    }
    // Mescla com consolidados (consolidado ganha se tiver os dois)
    for (const [data, g] of Object.entries(grupos)) {
      const ja = out.find(p => p.data === data);
      if (ja) {
        ja.entrada     = ja.entrada     || g.entrada;
        ja.saidaAlmoco = ja.saidaAlmoco || g.saidaAlmoco;
        ja.voltaAlmoco = ja.voltaAlmoco || g.voltaAlmoco;
        ja.saida       = ja.saida       || g.saida;
      } else out.push(g);
    }
  }

  return out.sort((a,b) => (b.data||'').localeCompare(a.data||''));
}

export function renderMeuPainel() {
  const u = S.user || {};
  const nome = u.name || u.nome || 'Colaborador';
  const cargo = u.cargo || u.role || '';

  // Dispara carga assincrona dos pontos (re-render quando chega)
  if (!_pontosCache && u._id) {
    loadPontos(u._id).then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }
  // Dispara carga do historico (ate 2000 pedidos) — usado pelo bloco de Metas
  if (!_ordersHistCache) {
    loadOrdersHistorico().then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }
  // Dispara carga das COMISSÕES da fonte única do servidor (re-render ao chegar)
  if (_comissoesCache === null && !_comissoesLoading) {
    loadComissoes().then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }
  const pontosRaw = _pontosCache || [];
  const pontos = agruparPontosPorDia(pontosRaw);
  const comissoes = Array.isArray(_comissoesCache) ? _comissoesCache : [];
  // Bloco de Metas individuais (admin define) — usa historico do colab
  const metasHTML = renderMetasParaAtendente(u, _ordersHistCache);

  // Cards do TOPO mostram apenas o MÊS ATUAL — a tabela abaixo mostra todos
  // os meses. Mês em horário LOCAL — a chave bate com a quebra por mês que o
  // servidor manda (keys YYYY-MM, em fuso de Manaus).
  // Mês atual em fuso de Manaus (UTC-4), IGUAL ao manausMonthKey do servidor.
  const _nowManaus = new Date(Date.now() - 4 * 3600 * 1000);
  const _mesAtual = `${_nowManaus.getUTCFullYear()}-${String(_nowManaus.getUTCMonth()+1).padStart(2,'0')}`; // YYYY-MM
  const cMes = comissoes.find(c => c.mes === _mesAtual) || {
    vendaCount:0, vendaComissao:0, montagemComissao:0, expedicaoComissao:0, entregaComissao:0, total:0
  };
  const totalAcumulado = cMes.total;
  const totalVendaCom  = cMes.vendaComissao;
  const totalMontCom   = cMes.montagemComissao;
  const totalExpCom    = cMes.expedicaoComissao;
  const totalEntCom    = cMes.entregaComissao || 0;
  const qtdPedidos     = cMes.vendaCount;

  return `
<div class="card" style="background:linear-gradient(135deg,#FAE8E6,#FAF7F5);border:1px solid #FECDD3;margin-bottom:14px;">
  <div style="display:flex;align-items:center;gap:14px;">
    <div style="width:60px;height:60px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;">
      ${nome.charAt(0).toUpperCase()}
    </div>
    <div style="flex:1;">
      <div style="font-family:'Playfair Display',serif;font-size:20px;color:#9F1239;">Olá, ${nome.split(' ')[0]} 🌹</div>
      <div style="font-size:12px;color:var(--muted);">${cargo}</div>
    </div>
  </div>
</div>

<div class="g2" style="gap:14px;">
  <!-- COMISSOES -->
  <div class="card">
    <div class="card-title">💰 Minhas Vendas e Comissões <span style="font-size:11px;color:var(--muted);font-weight:400;">· Cards = mês atual (${fmtMes(_mesAtual)})</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;margin-bottom:14px;">
      <div style="background:#DCFCE7;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#15803D;font-weight:700;text-transform:uppercase;">💰 Vendas (%)</div>
        <div style="font-size:14px;font-weight:900;color:#15803D;">${$c(totalVendaCom)}</div>
        <div style="font-size:9px;color:#15803D;opacity:.7;">${qtdPedidos} pedidos</div>
      </div>
      <div style="background:#FEF3C7;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#92400E;font-weight:700;text-transform:uppercase;">🌸 Montagem (R$)</div>
        <div style="font-size:14px;font-weight:900;color:#92400E;">${$c(totalMontCom)}</div>
        <div style="font-size:9px;color:#92400E;opacity:.7;">por produto</div>
      </div>
      <div style="background:#DBEAFE;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#1E40AF;font-weight:700;text-transform:uppercase;">📦 Expedição (R$)</div>
        <div style="font-size:14px;font-weight:900;color:#1E40AF;">${$c(totalExpCom)}</div>
        <div style="font-size:9px;color:#1E40AF;opacity:.7;">por pedido</div>
      </div>
      ${totalEntCom > 0 ? `
      <div style="background:#F3E8FF;border-radius:8px;padding:10px;text-align:center;">
        <div style="font-size:9px;color:#6B21A8;font-weight:700;text-transform:uppercase;">🛵 Entrega (R$)</div>
        <div style="font-size:14px;font-weight:900;color:#6B21A8;">${$c(totalEntCom)}</div>
        <div style="font-size:9px;color:#6B21A8;opacity:.7;">por entrega</div>
      </div>` : ''}
    </div>
    ${comissoes.length === 0 ? `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
        ${(_comissoesCache === null || _comissoesLoading) ? '⏳ Carregando comissões…' : 'Nenhuma comissão registrada ainda neste período.'}
      </div>
    ` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
          <th style="padding:10px 6px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Mês</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#15803D;text-transform:uppercase;letter-spacing:.5px;" title="Vendas como vendedor (id, e-mail ou nome) com pagamento aprovado — inclui Pago na Entrega/Recebido">💰 Venda</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#92400E;text-transform:uppercase;letter-spacing:.5px;">🌸 Montagem</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#1E40AF;text-transform:uppercase;letter-spacing:.5px;">📦 Expedição</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#6B21A8;text-transform:uppercase;letter-spacing:.5px;">🛵 Entrega</th>
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Total</th>
        </tr></thead>
        <tbody>
          ${comissoes.map(c => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:10px 6px;font-weight:600;">${fmtMes(c.mes)}</td>
              <td style="text-align:right;padding:10px 6px;color:#15803D;">${$c(c.vendaComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.vendaCount} vendas</span></td>
              <td style="text-align:right;padding:10px 6px;color:#92400E;">${$c(c.montagemComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.montagemCount} produtos</span></td>
              <td style="text-align:right;padding:10px 6px;color:#1E40AF;">${$c(c.expedicaoComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.expedicaoCount} pedidos</span></td>
              <td style="text-align:right;padding:10px 6px;color:#6B21A8;">${$c(c.entregaComissao)}<br/><span style="font-size:9px;color:var(--muted);">${c.entregaCount} entregas</span></td>
              <td style="text-align:right;padding:10px 6px;font-weight:900;color:#15803D;">${$c(c.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `}
    <div style="font-size:10px;color:var(--muted);margin-top:10px;text-align:center;font-style:italic;">
      🔒 Apenas leitura. Comissões calculadas sobre pedidos com pagamento aprovado.
    </div>
  </div>

  <!-- PONTOS — apenas mes vigente -->
  ${(() => {
    // Filtra pontos so do mes atual (Manaus). Ao virar de mes, comeca zerado.
    const pontosMes = pontos.filter(p => (p.data||'').slice(0,7) === _mesAtual);
    return `
  <div class="card">
    <div class="card-title">⏰ Meus Pontos (${fmtMes(_mesAtual)})</div>
    ${pontosMes.length === 0 ? `
      <div style="text-align:center;padding:24px;color:var(--muted);font-size:12px;">
        ${pontosRaw.length === 0 ? 'Carregando registros de ponto...' : 'Nenhum ponto registrado neste mês ainda.'}
      </div>
    ` : `
    <div style="overflow-x:auto;">
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead><tr style="background:#FAFAFA;border-bottom:1px solid var(--border);">
          <th style="padding:10px 6px;text-align:left;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Data</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Entrada</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Almoço</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Retorno</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">S.Interv</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">V.Interv</th>
          <th style="padding:10px 6px;text-align:center;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Saída</th>
        </tr></thead>
        <tbody>
          ${pontosMes.map(p => `
            <tr style="border-bottom:1px solid #F1F5F9;">
              <td style="padding:8px 6px;font-weight:600;font-size:11px;">${(p.data||'').split('-').reverse().join('/')}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#15803D;font-weight:600;">${p.entrada || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#D97706;">${p.saidaAlmoco || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#D97706;">${p.voltaAlmoco || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#B45309;">${p.saidaIntervalo || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#B45309;">${p.voltaIntervalo || '—'}</td>
              <td style="text-align:center;padding:8px 6px;font-family:Monaco,monospace;color:#DC2626;font-weight:600;">${p.saida || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `}
  </div>`;
  })()}
</div>

${metasHTML}
`;
}
