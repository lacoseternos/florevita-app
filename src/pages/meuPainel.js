// ── MEU PAINEL ────────────────────────────────────────────────
// Pagina pessoal de cada colaborador (Atendimento) — somente leitura.
// Mostra:
//   1. Historico de Pontos (entrada, saida almoco, volta, saida)
//   2. Comissões / vendas atribuídas no mes
import { S } from '../state.js';
import { $c, esc } from '../utils/formatters.js';
import { GET } from '../services/api.js';
import { termometroHTML, checarSubidaNivel } from '../utils/termometroMeta.js';
import { renderDetalheMissaoAvulso, ajusteForm, ajusteLinha } from './campanha.js';
import { minutosTrabalhados, fmtHorasPonto } from '../utils/ponto.js';

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

// ── COMISSÕES — FONTE ÚNICA (servidor) ───────────────────────
// Marcia (28/jun/2026): em vez de recalcular no navegador (que divergia do
// RH por causa de dados/sessão/percentual diferentes), o painel agora PUXA o
// número PRONTO do servidor (GET /comissoes/me). O backend usa as MESMAS
// regras, com TODOS os pedidos e o % oficial do banco — então bate 100% com
// o RH. Impossível divergir.
let _comissoesCache = null;     // array de meses, ou null = ainda não carregou
let _comissoesLoading = false;
let _metasVendaCache = null;    // metas individuais de venda (dia/mês + achievements)
let _campanhaCache = null;      // Programa Estrelas (progresso semanal), ou {ativa:false}
let _campanhaLoading = false;
// Meta recalculada do mês (Metas por canal, out/2026) — só se ela estiver
// vinculada à meta. { meta: {...} | null }. Vem PRONTA do backend.
let _minhaMetaCache = null;
let _painelAtualizadoEm = 0;     // última atualização de meta/missões (Meu Painel)
let _minhaMetaLoading = false;
async function loadComissoes(retry = 0) {
  _comissoesLoading = true;
  try {
    const r = await GET('/comissoes/me');
    const meses = Array.isArray(r?.meses) ? r.meses : (Array.isArray(r) ? r : null);
    if (meses === null) throw new Error('resposta inesperada');
    _comissoesCache = meses;
    _metasVendaCache = r?.metasVenda || null;
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

// ── METAS INDIVIDUAIS DE VENDA (Marcia out/2026) ──────────────
function _statusInfo(s) {
  return ({
    estrela:  { emoji:'⭐', txt:'ESTRELA DO DIA!', cor:'#B45309', bg:'linear-gradient(135deg,#FEF9C3,#FDE68A)', borda:'#F59E0B' },
    verde:    { emoji:'🟢', txt:'META BATIDA!',    cor:'#15803D', bg:'linear-gradient(135deg,#DCFCE7,#BBF7D0)', borda:'#22C55E' },
    amarelo:  { emoji:'🟡', txt:'QUASE LÁ!',       cor:'#92400E', bg:'linear-gradient(135deg,#FEF3C7,#FDE68A)', borda:'#F59E0B' },
    vermelho: { emoji:'🔴', txt:'BORA PRA CIMA!',  cor:'#991B1B', bg:'linear-gradient(135deg,#FEE2E2,#FECACA)', borda:'#EF4444' },
  })[s] || null;
}
function _barraMeta(atual, meta, cor) {
  if (!meta || meta <= 0) return '';
  const pct = Math.min(100, Math.round((Number(atual) / Number(meta)) * 100));
  return `<div style="background:#E5E7EB;border-radius:999px;height:9px;overflow:hidden;margin-top:4px;">
    <div style="width:${pct}%;height:100%;background:${cor};border-radius:999px;transition:width .5s;"></div>
  </div>`;
}
function _blocoMeta(titulo, b, ticketAlvo) {
  if (!b || (!(b.realista > 0) && !(b.agressiva > 0))) return '';
  const si = _statusInfo(b.status);
  const falta = (meta) => (meta > 0 && b.faturamento < meta) ? `faltam ${$c(meta - b.faturamento)}` : '✓ batida';
  const ticketCor = b.ticket >= (ticketAlvo || 180) ? '#15803D' : '#B45309';
  return `
  <div style="border:1.5px solid ${si?si.borda:'#E2E8F0'};border-radius:12px;padding:12px 14px;background:${si?si.bg:'#fff'};">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="font-size:12px;font-weight:800;color:#334155;">${titulo}</div>
      ${si?`<div style="font-size:12px;font-weight:900;color:${si.cor};white-space:nowrap;">${si.emoji} ${si.txt}</div>`:''}
    </div>
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:2px;">
      <span style="font-size:22px;font-weight:900;color:#0F172A;">${$c(b.faturamento)}</span>
      <span style="font-size:11px;color:#64748B;">${b.pedidos} venda${b.pedidos===1?'':'s'} · ticket <b style="color:${ticketCor}">${$c(b.ticket)}</b></span>
    </div>
    ${b.realista>0?`<div style="margin-top:7px;"><div style="display:flex;justify-content:space-between;font-size:10.5px;color:#475569;font-weight:600;"><span>🎯 Realista: ${$c(b.realista)}</span><span>${falta(b.realista)}</span></div>${_barraMeta(b.faturamento,b.realista,'#16A34A')}</div>`:''}
    ${b.agressiva>0?`<div style="margin-top:6px;"><div style="display:flex;justify-content:space-between;font-size:10.5px;color:#475569;font-weight:600;"><span>🔥 Agressiva: ${$c(b.agressiva)}</span><span>${falta(b.agressiva)}</span></div>${_barraMeta(b.faturamento,b.agressiva,'#F59E0B')}</div>`:''}
  </div>`;
}
// ── PROGRAMA ESTRELAS (campanha) — painel da colaboradora ─────
// ── PROGRAMA ESTRELAS no Meu Painel (out/2026) ───────────────────────────
// Missões da semana (seg→dom) do setor dela, agrupadas por nível, com o que
// já cumpriu, o progresso de hoje e o caminho até o próximo bônus. Para o
// atendimento, antes: hoje × mesmo dia da semana passada (vendido, meta do
// dia, semana e ticket médio). Tudo vem pronto de /campanha/me.
const _NIVEL = {
  facil: { l: 'Fácil', i: '🟢', c: '#16A34A', bg: '#F0FDF4' },
  media: { l: 'Média', i: '🟡', c: '#CA8A04', bg: '#FEFCE8' },
  dificil: { l: 'Difícil', i: '🔴', c: '#DC2626', bg: '#FEF2F2' },
  epica: { l: 'Épica', i: '🟣', c: '#7C3AED', bg: '#F5F3FF' },
  ciclo: { l: 'Do ciclo (semana)', i: '🔁', c: '#0369A1', bg: '#F0F9FF' },
};
const _cc = (c) => $c((Number(c) || 0) / 100);
function _varTxt(atual, antes) {
  if (!antes) return atual ? '<span style="color:#15803D;font-weight:800;">novo ▲</span>' : '';
  const p = (atual - antes) / antes;
  const cor = p >= 0 ? '#15803D' : '#B91C1C';
  return `<span style="color:${cor};font-weight:800;">${p >= 0 ? '▲' : '▼'} ${Math.abs(p * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>`;
}
function _barra(v, max, cor) {
  const p = max > 0 ? Math.min(100, Math.round(v / max * 100)) : 0;
  return `<div style="height:7px;border-radius:999px;background:#E5E7EB;overflow:hidden;margin-top:5px;"><div style="width:${p}%;height:100%;background:${cor};border-radius:999px;"></div></div>`;
}


function renderComparativoAtendimento(k) {
  if (!k) return '';
  const dSem = k.diaSemanaPassada ? k.diaSemanaPassada.split('-').reverse().slice(0, 2).join('/') : '';
  const tile = (titulo, atual, antes, extra = '') => `<div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:12px;">
    <div style="font-size:10px;font-weight:800;color:#64748B;text-transform:uppercase;letter-spacing:.4px;">${titulo}</div>
    <div style="font-size:21px;font-weight:900;color:#0F172A;margin-top:2px;">${atual}</div>
    ${extra}
    <div style="font-size:11px;color:#64748B;margin-top:4px;">${antes}</div>
  </div>`;
  const metaDia = k.metaDia ? k.metaDia * 100 : 0, metaSem = k.metaSemana ? k.metaSemana * 100 : 0;
  return `<div class="card" style="margin-bottom:14px;">
    <div class="card-title">📊 Hoje × mesmo dia da semana passada <span style="font-size:11px;color:var(--muted);font-weight:400;">(${dSem})</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">
      ${tile('Vendido hoje', _cc(k.hoje.faturamento), `semana passada: ${_cc(k.mesmoDiaSemanaPassada.faturamento)} ${_varTxt(k.hoje.faturamento, k.mesmoDiaSemanaPassada.faturamento)}`,
        metaDia ? `<div style="font-size:11px;color:#9D174D;font-weight:700;margin-top:2px;">meta do dia ${_cc(metaDia)}</div>${_barra(k.hoje.faturamento, metaDia, '#EC4899')}` : '')}
      ${tile('Semana até hoje', _cc(k.semana.faturamento), `semana passada até ${dSem}: ${_cc(k.semanaPassadaAteHoje.faturamento)} ${_varTxt(k.semana.faturamento, k.semanaPassadaAteHoje.faturamento)}`,
        metaSem ? `<div style="font-size:11px;color:#15803D;font-weight:700;margin-top:2px;">meta da semana ${_cc(metaSem)}</div>${_barra(k.semana.faturamento, metaSem, '#22C55E')}` : '')}
      ${tile('Ticket médio hoje', _cc(k.hoje.ticket), `semana passada: ${_cc(k.mesmoDiaSemanaPassada.ticket)} ${_varTxt(k.hoje.ticket, k.mesmoDiaSemanaPassada.ticket)}`,
        `<div style="font-size:11px;color:#64748B;margin-top:2px;">${k.hoje.pedidos} pedido(s) hoje · ${k.mesmoDiaSemanaPassada.pedidos} na semana passada</div>`)}
    </div>
  </div>`;
}

// ⭐ Quadro de Estrelas só (sem a meta do mês) — usado no app do entregador,
// que não tem o Meu Painel (Marcia 28/out). Busca /campanha/me sob demanda.
export function renderEstrelasDoColab() {
  if (_campanhaCache === null && !_campanhaLoading) {
    _campanhaLoading = true;
    GET('/campanha/me').then(r => { _campanhaCache = r || { ativa: false }; }).catch(() => { _campanhaCache = { ativa: false }; })
      .finally(() => { _campanhaLoading = false; _painelAtualizadoEm = Date.now(); import('../main.js').then(m => m.render()).catch(() => {}); });
  } else if (_campanhaCache !== null && !_campanhaLoading && Date.now() - _painelAtualizadoEm > 180000) {
    _campanhaLoading = true; _painelAtualizadoEm = Date.now();
    GET('/campanha/me').then(r => { _campanhaCache = r || { ativa: false }; }).catch(() => {})
      .finally(() => { _campanhaLoading = false; import('../main.js').then(m => m.render()).catch(() => {}); });
  }
  return renderCampanhaColab(_campanhaCache);
}

function renderCampanhaColab(c) {
  if (!c || !c.ativa || !c.progresso) return '';
  const p = c.progresso;
  const possiveis = p.estrelasPossiveis || 0;
  const faixas = (p.faixas || []).slice().sort((a, b) => a.estrelas - b.estrelas);
  const teto = Math.max(possiveis, faixas.length ? faixas[faixas.length - 1].estrelas : 0, p.estrelas, 1);
  const faltaProx = p.proximaFaixa ? Math.max(0, p.proximaFaixa.estrelas - p.estrelas) : 0;
  const marcadores = faixas.map(f => `<div title="${f.estrelas} ⭐ = ${$c(f.bonus)}" style="position:absolute;left:${Math.min(100, f.estrelas / teto * 100)}%;top:-3px;width:2px;height:16px;background:${p.estrelas >= f.estrelas ? '#15803D' : '#94A3B8'};"></div>`).join('');

  const missao = (m) => {
    const nv = _NIVEL[m.nivel] || _NIVEL.facil;
    const pontos = m.limite > 1 ? `<span style="letter-spacing:2px;color:${nv.c};">${'●'.repeat(m.vezes || 0)}${'○'.repeat(Math.max(0, m.limite - (m.vezes || 0)))}</span>` : (m.vezes ? '✅' : '');
    let prog = '';
    if (m.manual) prog = '<span style="color:#64748B;">a gerência confirma quando você cumprir</span>';
    else if (m.semMeta) prog = '<span style="color:#B45309;">sem meta do mês para você ainda</span>';
    else if (m.alvo > 0) {
      const v = m.money ? $c(m.progresso) : m.pct ? m.progresso + '%' : m.progresso, a = m.money ? $c(m.alvo) : m.pct ? m.alvo + '%' : m.alvo;
      prog = `${m.tipo === 'semana' ? 'na semana' : 'hoje'}: <strong>${v}</strong> de ${a}${_barra(m.progresso, m.alvo, nv.c)}`;
    }
    // Missão da semana: só conta a partir do 5º dia trabalhado dela.
    // Ticket médio: só vale no dia com pelo menos 80% da meta realista.
    if (m.exigeMeta80) prog += m.metaMinima80 == null
      ? `<div style="color:#B45309;font-size:10.5px;margin-top:2px;">🎯 vale no dia com 80% da sua meta realista (sem meta do mês pra você ainda)</div>`
      : `<div style="color:${m.faltaMeta80 ? '#B45309' : '#15803D'};font-size:10.5px;font-weight:700;margin-top:2px;">🎯 vale com 80% da meta realista: ${$c(m.metaMinima80)} — hoje ${$c(m.vendidoHoje || 0)}${m.faltaMeta80 ? '' : ' ✓'}</div>`;
    // "Todos os pedidos do dia" / % no prazo / ticket do dia: só conta com o dia fechado.
    if (m.aguardaFimDia) prog += `<div style="color:#B45309;font-weight:700;margin-top:3px;">⏳ No caminho! Conta no fim do dia, se continuar assim</div>`;
    else if (m.soFimDoDia) prog += `<div style="color:#64748B;font-size:10.5px;margin-top:2px;">🌙 conta no fim do dia (vale o dia inteiro)</div>`;
    // Meta compartilhada: o dia só vale com o ponto de entrada batido (Marcia 20/out).
    if (m.aguardaPonto) prog += `<div style="color:#B45309;font-weight:700;margin-top:3px;">⏳ Bateu! Conta quando você bater a entrada no ponto</div>`;
    if (m.tipo === 'semana' && m.aguardaCiclo) prog += `<div style="color:#7C3AED;font-weight:700;margin-top:3px;">⏳ conta a partir do ${m.diaCicloMin || 5}º dia trabalhado da semana (você está no ${m.diaCiclo || 0}º)</div>`;
    const feito = m.vezes >= m.limite;
    return `<div style="border:1.5px solid ${feito ? '#86EFAC' : '#E2E8F0'};background:${feito ? '#F0FDF4' : '#fff'};border-radius:12px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start;">
      <div style="font-size:22px;line-height:1;">${m.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12.5px;font-weight:800;color:#1E293B;line-height:1.25;">${m.label}${m.origem || m.compartilhada ? ' <span style="font-size:10px;color:#0E7490;font-weight:800;">👥 compartilhada</span>' : ''}${m.outroSetor ? ' <span style="font-size:10px;color:#047857;font-weight:800;">🌈 de ' + esc(m.outroSetorLabel || m.outroSetor) + '</span>' : ''}</div>
        <div style="font-size:11px;color:#475569;margin-top:3px;">${prog}</div>
      </div>
      <div style="text-align:right;white-space:nowrap;">
        <div style="font-size:12px;font-weight:900;color:#B45309;">${m.ganhas}/${m.estrelasMax ?? m.estrelasUnit} ⭐</div>
        <div style="font-size:11px;margin-top:2px;">${pontos}</div>
        ${m.feitoHoje && !feito ? '<div style="font-size:10px;color:#15803D;font-weight:800;">✓ hoje</div>' : ''}
        ${_acompModo && !m.manual && p.colabId ? `<button type="button" class="es-btn" style="margin-top:4px;" title="Ver os pedidos desta missão" onclick="esDetalhe('${esc(p.colabId)}','${esc(m.id)}')">🔍 detalhes</button>` : ''}
      </div>
    </div>`;
  };
  // Missões de OUTROS setores que ela cumpriu (só aparecem depois de cumpridas).
  const deOutros = (p.missoes || []).filter(m => m.outroSetor);
  const grupoOutros = deOutros.length ? `<div style="background:#ECFDF5;border-radius:14px;padding:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:900;color:#047857;margin-bottom:8px;"><span>🌈 Bônus de outros setores</span><span>+${deOutros.reduce((s, m) => s + (m.ganhas || 0), 0)} ⭐</span></div>
      <div style="display:grid;gap:8px;">${deOutros.map(missao).join('')}</div>
    </div>` : '';
  const grupos = Object.keys(_NIVEL).map(nk => {
    const ms = (p.missoes || []).filter(m => !m.outroSetor && (m.nivel || 'facil') === nk);
    if (!ms.length) return '';
    const nv = _NIVEL[nk];
    const ganho = ms.reduce((s, m) => s + (m.ganhas || 0), 0), max = ms.reduce((s, m) => s + (m.estrelasMax ?? m.estrelasUnit ?? 0), 0);
    return `<div style="background:${nv.bg};border-radius:14px;padding:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:900;color:${nv.c};margin-bottom:8px;"><span>${nv.i} ${nv.l}</span><span>${ganho}/${max} ⭐</span></div>
      <div style="display:grid;gap:8px;">${ms.map(missao).join('')}</div>
    </div>`;
  }).join('');
  const semana = p.startISO ? `${p.startISO.split('-').reverse().slice(0, 2).join('/')} a ${p.endISO.split('-').reverse().slice(0, 2).join('/')}` : '';
  const perto = _missoesPerto(3);
  const qtd = (p.missoes || []).length;
  return `
  <div class="card" style="margin-bottom:14px;background:linear-gradient(135deg,#FFFBEB,#FEF3C7);border:1.5px solid #F59E0B;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div><div style="font-size:15px;font-weight:900;color:#92400E;">⭐ Estrelas da semana</div>
        <div style="font-size:11px;color:#B45309;">${semana} · fecha no domingo</div></div>
      <div style="text-align:right;">
        <div style="font-size:26px;font-weight:900;color:#B45309;line-height:1;">${p.estrelas}<span style="font-size:13px;color:#D97706;">${possiveis ? '/' + possiveis : ''}</span> ⭐</div>
        ${(p.bonus || 0) > 0 ? `<div style="font-size:11px;color:#15803D;font-weight:800;">bônus ${$c(p.bonus)}</div>` : ''}
      </div>
    </div>
    ${faixas.length ? `<div style="position:relative;margin:14px 2px 4px;"><div style="height:10px;border-radius:999px;background:#FDE68A;overflow:hidden;"><div style="width:${Math.min(100, p.estrelas / teto * 100)}%;height:100%;background:linear-gradient(90deg,#F59E0B,#EA580C);"></div></div>${marcadores}</div>
      <div style="font-size:11.5px;color:#92400E;margin-top:4px;">${p.proximaFaixa ? `Faltam <b>${faltaProx} ⭐</b> para ganhar ${$c(p.proximaFaixa.bonus)}! 💪` : 'Você chegou na faixa máxima! 🏆'}</div>` : ''}
    ${[...(p.extras || []), ...(p.penalidades || [])].length ? `<div style="margin-top:6px;display:grid;gap:3px;">${[...(p.extras || []), ...(p.penalidades || [])].sort((a, b) => String(a.data).localeCompare(String(b.data))).map(x => `<div style="font-size:11px;font-weight:700;color:${x.tipo === 'extra' ? '#15803D' : '#B91C1C'};">${x.tipo === 'extra' ? '⭐ +' + x.estrelas + ' ⭐' : Number(x.estrelas) ? '⚠️ −' + x.estrelas + ' ⭐' : '📝 Ocorrência'} · ${String(x.data || '').split('-').reverse().slice(0, 2).join('/')} · ${esc(x.tipo === 'extra' ? 'Estrela extra' : x.tipo === 'atraso' ? 'Atraso' : x.tipo === 'falta' ? 'Falta' : x.tipo === 'advertencia' ? 'Advertência' : x.tipo === 'dano' ? 'Dano no transporte' : x.tipo === 'erroEntrega' ? 'Erro de entrega' : 'Desconto')}${x.motivo ? ' — ' + esc(x.motivo) : ''}</div>`).join('')}</div>` : ''}
    ${perto.length ? `<div style="font-size:11px;font-weight:800;color:#92400E;margin:12px 0 6px;">🎯 Mais perto de completar</div>
      <div style="display:grid;gap:6px;">${perto.map(({ m: x, f }) => {
        const v = x.money ? $c(x.progresso) : x.pct ? x.progresso + '%' : x.progresso;
        const a = x.money ? $c(x.alvo) : x.pct ? x.alvo + '%' : x.alvo;
        return `<div style="background:#fff;border-radius:10px;padding:8px 10px;">
          <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;"><span style="font-weight:700;color:#1E293B;min-width:0;">${x.icon || '🎯'} ${x.label}</span><span style="white-space:nowrap;font-weight:800;color:#B45309;">+${x.estrelasUnit} ⭐</span></div>
          <div style="font-size:11px;color:#475569;">${x.tipo === 'semana' ? 'semana' : 'hoje'}: <b>${v}</b> de ${a}</div>${_barra(Math.round(f * 100), 100, '#F59E0B')}${_porqueNaoContou(x)}</div>`;
      }).join('')}</div>` : ''}
    <details class="mp-det" open style="margin-top:10px;">
      <summary style="cursor:pointer;font-size:12.5px;font-weight:800;color:#92400E;padding:6px 0;">Ver todas as missões (${qtd}) ▾</summary>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:10px;margin-top:8px;">
        ${grupos || '<div style="font-size:12px;color:var(--muted);">Nenhuma missão para você nesta semana.</div>'}
        ${grupoOutros}
      </div>
    </details>
  </div>`;
}

// Alvo atingido mas ainda não contou: diz o porquê (ponto, 80% da meta, 5º dia).
function _porqueNaoContou(x) {
  if (!((Number(x.progresso) || 0) >= (Number(x.alvo) || 0) && x.alvo > 0)) return '';
  const msg = x.aguardaFimDia ? '⏳ conta no fim do dia, se continuar assim'
    : x.aguardaPonto ? '⏳ conta quando você bater a entrada no ponto'
    : (x.exigeMeta80 && x.faltaMeta80 && x.metaMinima80 != null) ? `🎯 conta quando ${_minhaMetaCache?.meta?.compartilhada ? 'a loja' : 'você'} chegar a ${$c(x.metaMinima80)} hoje (80% da meta)`
    : (x.tipo === 'semana' && x.aguardaCiclo) ? `⏳ conta a partir do ${x.diaCicloMin || 5}º dia trabalhado`
    : '';
  return msg ? `<div style="font-size:10.5px;color:#B45309;font-weight:700;margin-top:3px;">${msg}</div>` : '';
}

// Meta do dia FIXA (planejamento do mês; não muda com o que já vendeu). Valores do backend:
// metaDiaria/metaSemanal/superSemanal/parte em reais inteiros; o resto em centavos.
// Missões do Programa Estrelas mais perto de completar (pro painel da meta).
function _missoesPerto(n = 3) {
  const ms = _campanhaCache?.ativa ? (_campanhaCache.progresso?.missoes || []) : [];
  return ms
    .filter(m => !m.manual && !m.semMeta && m.alvo > 0 && (m.vezes || 0) < (m.limite || 1) && !m.feitoHoje)
    .map(m => ({ m, f: Math.min(0.999, (Number(m.progresso) || 0) / m.alvo) }))
    .sort((a, b) => b.f - a.f || (b.m.estrelasUnit || 0) - (a.m.estrelasUnit || 0))
    .slice(0, n);
}

// Card único "Hoje": quanto vendeu × meta do dia (grande); semana, ticket,
// mês da equipe e semana passada em linhas pequenas.
function renderMinhaMeta(m, nome = '') {
  const cc = (c) => $c((Number(c) || 0) / 100);
  const si = _statusInfo(m.hoje?.status);
  const vendHoje = m.hoje?.faturamento || 0, metaHoje = m.hoje?.meta || 0;
  const pctHoje = metaHoje ? Math.round(vendHoje / metaHoje * 100) : 0;
  const falta = Math.max(0, metaHoje - vendHoje);
  const vendSem = m.semana?.faturamento || 0, metaSem = m.semana?.meta || 0;
  const pctSem = metaSem ? Math.round(vendSem / metaSem * 100) : 0;
  const tk = m.hoje?.ticket || 0, tkOk = tk >= (m.ticketMeta || 0);
  const mc = m.mesCanal;
  const k = _campanhaCache?.comparativo;
  const semPassada = k && k.mesmoDiaSemanaPassada && k.mesmoDiaSemanaPassada.faturamento > 0 ? ` · mesmo dia da semana passada: ${_cc(k.mesmoDiaSemanaPassada.faturamento)} ${_varTxt(k.hoje.faturamento, k.mesmoDiaSemanaPassada.faturamento)}` : '';
  const loja = m.compartilhada;
  const mini = (titulo, valor, sub, barra = '') => `<div style="background:#F8FAFC;border-radius:10px;padding:9px 10px;">
      <div style="font-size:10px;color:var(--muted);text-transform:uppercase;font-weight:800;letter-spacing:.3px;">${titulo}</div>
      <div style="font-size:15px;font-weight:900;color:#0F172A;margin-top:1px;">${valor}</div>
      <div style="font-size:10.5px;color:#64748B;">${sub}</div>${barra}</div>`;
  return `<div class="card" style="margin-bottom:14px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:#9F1239;">${_acompModo ? 'Painel da ' + esc(String(nome).split(' ')[0] || '') : 'Olá, ' + esc(String(nome).split(' ')[0] || '') + ' 🌹'}</div>
      ${si ? `<div style="font-size:11px;font-weight:900;color:${si.cor};white-space:nowrap;">${si.emoji} ${si.txt}</div>` : ''}
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.3px;">${loja ? '🏪 A loja vendeu hoje' + (m.equipe?.length ? ' (com ' + m.equipe.map(esc).join(', ') + ')' : '') : '💰 Você vendeu hoje'}</div>
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;">
      <span style="font-size:28px;font-weight:900;color:#0F172A;">${cc(vendHoje)}</span>
      <span style="font-size:13px;color:#64748B;">de ${cc(metaHoje)}</span>
    </div>
    <div style="background:#E5E7EB;border-radius:999px;height:12px;overflow:hidden;margin-top:6px;">
      <div style="width:${Math.min(100, pctHoje)}%;height:100%;background:${pctHoje >= 100 ? '#16A34A' : '#DB2777'};border-radius:999px;transition:width .5s;"></div></div>
    <div style="font-size:12px;font-weight:700;margin-top:4px;color:${falta > 0 ? '#9D174D' : '#15803D'};">${falta > 0 ? `faltam ${cc(falta)} (${pctHoje}%)` : `✓ meta do dia batida (${pctHoje}%)`}</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px;">
      ${mini(loja ? 'Loja na semana' : 'Semana', cc(vendSem), `de ${cc(metaSem)} · ${pctSem}% · super ${'R$ ' + Number(m.superSemanal || 0).toLocaleString('pt-BR')}`, _barraMeta(vendSem, metaSem, '#22C55E'))}
      ${mini('Ticket médio hoje', `<span style="color:${tkOk ? '#15803D' : '#B45309'};">${cc(tk)}</span>`, `meta ${cc(m.ticketMeta)} ${tkOk ? '✓' : ''} · ${m.hoje?.pedidos || 0} pedidos`)}
    </div>
    <div style="font-size:11px;color:#64748B;margin-top:10px;line-height:1.5;">
      ${mc ? `👥 Equipe no mês: <b>${String(mc.pctFeito).replace('.', ',')}%</b> da meta${m.batida || mc.pctFalta <= 0 ? ' 🎉' : ''}` : ''}${semPassada}
    </div>
  </div>`;
}

function renderMetasVenda(mv) {
  if (!mv) return '';
  const temDia = mv.dia && (mv.dia.realista > 0 || mv.dia.agressiva > 0);
  const temSem = mv.semana && (mv.semana.realista > 0 || mv.semana.agressiva > 0);
  const temMes = mv.mes && (mv.mes.realista > 0 || mv.mes.agressiva > 0);
  const achs = Array.isArray(mv.achievements) ? mv.achievements : [];
  if (!temDia && !temSem && !temMes && !achs.length) return '';
  const blocoDia = _blocoMeta(`📅 Hoje${mv.fds?' (fim de semana)':''}`, mv.dia, mv.ticketAlvo);
  const blocoSem = _blocoMeta('📆 Esta semana', mv.semana, mv.ticketAlvo);
  const blocoMes = _blocoMeta('🗓️ Este mês', mv.mes, mv.ticketAlvo);
  const achHTML = achs.length ? `
    <div style="margin-top:12px;">
      <div style="font-size:11px;font-weight:800;color:#334155;margin-bottom:7px;">🏅 Conquistas de hoje</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:7px;">
        ${achs.map(a => {
          const alvoTxt = a.money ? $c(a.alvo) : a.alvo;
          const atualTxt = a.money ? $c(a.atual) : a.atual;
          return `<div style="border:1.5px solid ${a.done?'#22C55E':'#E2E8F0'};background:${a.done?'#DCFCE7':'#F8FAFC'};border-radius:10px;padding:8px 10px;${a.done?'':'opacity:.75;'}">
            <div style="font-size:16px;line-height:1;margin-bottom:3px;">${a.icon} ${a.done?'<span style="font-size:11px;color:#15803D;font-weight:900;">CONQUISTADO!</span>':''}</div>
            <div style="font-size:11px;font-weight:700;color:#334155;line-height:1.2;">${a.label}</div>
            <div style="font-size:10px;color:#64748B;margin-top:2px;">${atualTxt} / ${alvoTxt}</div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';
  return `
  <div class="card" style="margin-bottom:14px;">
    <div class="card-title">🎯 Minhas Metas de Venda <span style="font-size:11px;color:var(--muted);font-weight:400;">· vendas lançadas com o seu nome</span></div>
    <div class="g2" style="gap:12px;">
      ${blocoDia}
      ${blocoSem}
      ${blocoMes}
    </div>
    ${achHTML}
    <div style="font-size:10px;color:var(--muted);margin-top:10px;font-style:italic;">⭐ Estrela = 17%+ acima da agressiva · 🟢 bateu a agressiva (ou a realista com ticket R$ 180+) · 🟡 perto da realista · 🔴 abaixo. Bora! 💪</div>
  </div>`;
}

function fmtData(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { timeZone: 'America/Manaus', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
  } catch { return iso; }
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
      if (!grupos[data]) grupos[data] = { data, entrada:'', saidaAlmoco:'', voltaAlmoco:'', saidaIntervalo:'', voltaIntervalo:'', saida:'' };
      const t = String(r.type||'').toLowerCase();
      const hora = r.time || '';
      if (t.includes('entrada') || t === 'chegada') grupos[data].entrada = hora;
      else if (t.includes('saida_almoco') || t.includes('saidaalmoco') || (t === 'almoco' && !grupos[data].saidaAlmoco)) grupos[data].saidaAlmoco = hora;
      else if (t.includes('volta_almoco') || t.includes('voltaalmoco') || t === 'volta') grupos[data].voltaAlmoco = hora;
      // Intervalo/lanche ANTES do 'saida' genérico (senão saida_intervalo virava saída final).
      else if (t.includes('saida_intervalo') || t.includes('saidaintervalo')) grupos[data].saidaIntervalo = hora;
      else if (t.includes('volta_intervalo') || t.includes('voltaintervalo')) grupos[data].voltaIntervalo = hora;
      else if (t.includes('saida')) grupos[data].saida = hora;
    }
    // Mescla com consolidados (consolidado ganha se tiver os dois)
    for (const [data, g] of Object.entries(grupos)) {
      const ja = out.find(p => p.data === data);
      if (ja) {
        ja.entrada     = ja.entrada     || g.entrada;
        ja.saidaAlmoco = ja.saidaAlmoco || g.saidaAlmoco;
        ja.voltaAlmoco = ja.voltaAlmoco || g.voltaAlmoco;
        ja.saidaIntervalo = ja.saidaIntervalo || g.saidaIntervalo;
        ja.voltaIntervalo = ja.voltaIntervalo || g.voltaIntervalo;
        ja.saida       = ja.saida       || g.saida;
      } else out.push(g);
    }
  }

  return out.sort((a,b) => (b.data||'').localeCompare(a.data||''));
}

// Busca meta do mês + missões (1ª vez) e atualiza a cada 3 min por trás.
// Usado pelo Meu Painel e pelo resumo no topo do Dashboard.
function _garantirMetaECampanha() {
  // Página aberta muito tempo: atualiza meta e missões a cada 3 min, por trás
  // (mantém o que já está na tela até chegar o novo — sem piscar).
  if (_minhaMetaCache !== null && _campanhaCache !== null && Date.now() - _painelAtualizadoEm > 180000 && !_minhaMetaLoading && !_campanhaLoading) {
    _painelAtualizadoEm = Date.now();
    _minhaMetaLoading = _campanhaLoading = true;
    Promise.all([
      GET('/metas/minha').then(r => { _minhaMetaCache = r || { meta: null }; }).catch(() => {}),
      GET('/campanha/me').then(r => { _campanhaCache = r || { ativa: false }; }).catch(() => {}),
    ]).finally(() => { _minhaMetaLoading = _campanhaLoading = false; import('../main.js').then(m => m.render()).catch(()=>{}); });
  }
  // Meta recalculada do mês (se ela participa da meta por canal).
  if (_minhaMetaCache === null && !_minhaMetaLoading) {
    _painelAtualizadoEm = Date.now();
    _minhaMetaLoading = true;
    GET('/metas/minha').then(r => { _minhaMetaCache = r || { meta: null }; })
      .catch(() => { _minhaMetaCache = { meta: null }; })
      .finally(() => { _minhaMetaLoading = false; import('../main.js').then(m => m.render()).catch(()=>{}); });
  }
  // Programa Estrelas (só aparece se ativo pelo admin).
  if (_campanhaCache === null && !_campanhaLoading) {
    _campanhaLoading = true;
    GET('/campanha/me').then(r => { _campanhaCache = r || { ativa: false }; _campanhaLoading = false; import('../main.js').then(m => m.render()).catch(()=>{}); })
      .catch(() => { _campanhaCache = { ativa: false }; _campanhaLoading = false; });
  }
}

// ── ACOMPANHAMENTO (gerência) — Marcia 20/out ────────────────────────────
// A gerência escolhe uma pessoa e vê o MESMO painel dela (resumo do dia,
// meta, comparativo, Estrelas), com 🔍 nos pedidos de cada missão.
// Reusa os renderizadores do Meu Painel trocando os caches por um instante.
let _acompModo = false;
let _acompLista = null, _acompListaLoading = false;
let _acompId = null;
const _acompDados = {};   // id → { meta, camp, em, loading, erro }
const _rerender = () => import('../main.js').then(m => m.render()).catch(() => {});
function _acompCarregar(id, forcar = false) {
  const d = _acompDados[id];
  if (d && (d.loading || (!forcar && Date.now() - d.em < 180000))) return;
  _acompDados[id] = { ...(d || {}), loading: true };
  const q = '?colabId=' + encodeURIComponent(id);
  Promise.all([
    GET('/metas/minha' + q).catch(() => ({ meta: null })),
    GET('/campanha/me' + q).catch(() => ({ ativa: false })),
  ]).then(([meta, camp]) => { _acompDados[id] = { meta: meta || { meta: null }, camp: camp || { ativa: false }, em: Date.now() }; })
    .catch((e) => { _acompDados[id] = { erro: e.message || 'Erro', em: Date.now() }; })
    .finally(_rerender);
}
export function renderAcompanhamento() {
  if (_acompLista === null && !_acompListaLoading) {
    _acompListaLoading = true;
    GET('/campanha/ranking').then(r => { _acompLista = r?.ranking || []; })
      .catch(() => { _acompLista = []; })
      .finally(() => { _acompListaLoading = false; _rerender(); });
  }
  const lista = _acompLista || [];
  if (!_acompId && lista.length) _acompId = lista[0].colabId;
  if (_acompId) _acompCarregar(_acompId);
  // Nome curto; se dois começam igual (Ana Paula / Ana Maria), mostra os dois nomes.
  const curto = (n) => { const w = String(n || '').split(' '); return lista.filter(y => String(y.nome || '').split(' ')[0] === w[0]).length > 1 ? w.slice(0, 2).join(' ') : w[0]; };
  const chip = (x) => `<button type="button" onclick="acompVer('${esc(x.colabId)}')" style="border:1.5px solid ${x.colabId === _acompId ? '#DB2777' : '#E2E8F0'};background:${x.colabId === _acompId ? '#FDF2F8' : '#fff'};border-radius:999px;padding:6px 12px;font-size:12.5px;font-weight:800;color:#1E293B;cursor:pointer;white-space:nowrap;">${esc(curto(x.nome))} <span style="color:#B45309;">${x.estrelas || 0}⭐</span></button>`;
  const topo = `<div class="card" style="margin-bottom:14px;padding:12px;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="font-size:13px;font-weight:900;color:#334155;">👥 Escolha quem acompanhar</div>
      ${_acompId ? '<button type="button" class="btn btn-ghost btn-sm" onclick="acompAtualizar()">↻ Atualizar</button>' : ''}
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;">${_acompLista === null ? '<span style="font-size:12px;color:var(--muted);">⏳ Carregando a equipe…</span>' : lista.length ? lista.map(chip).join('') : '<span style="font-size:12px;color:var(--muted);">Ninguém nos setores das Estrelas nesta semana.</span>'}</div>
  </div>`;
  const d = _acompId ? _acompDados[_acompId] : null;
  if (!d || (d.loading && !d.camp)) return topo + (_acompId ? '<div class="card" style="text-align:center;padding:30px;color:var(--muted);">⏳ Carregando o painel dela…</div>' : '');
  if (d.erro) return topo + `<div class="card" style="color:#B91C1C;">⚠️ ${esc(d.erro)}</div>`;
  // Troca os caches pelos dela só durante o render (os renderizadores leem deles).
  const salvo = [_minhaMetaCache, _campanhaCache, _acompModo];
  _minhaMetaCache = d.meta; _campanhaCache = d.camp; _acompModo = true;
  try {
    const nome = lista.find(x => x.colabId === _acompId)?.nome || '';
    const m = d.meta?.meta;
    const corpo = (m ? renderMinhaMeta(m, nome) : `<div class="card" style="margin-bottom:14px;font-size:12.5px;color:var(--muted);">${esc(String(nome).split(' ')[0])} não está vinculada a uma meta do mês.</div>`)
      + renderComparativoAtendimento(d.camp?.ativa ? d.camp.comparativo : null)
      + renderCampanhaColab(d.camp);
    const ajustes = [...(d.camp?.progresso?.extras || []), ...(d.camp?.progresso?.penalidades || [])];
    const form = `<div class="card" style="margin-bottom:14px;"><div style="font-weight:800;font-size:14px;">⭐ Dar ou tirar estrelas — ${esc(String(nome).split(' ')[0])}</div>
      ${ajusteForm([{ id: _acompId, nome }], {}, _acompId)}
      ${ajustes.length ? `<table class="es-tab" style="margin-top:10px;width:100%;font-size:12px;"><tbody>${ajustes.map(ajusteLinha).join('')}</tbody></table>` : ''}</div>`;
    return topo + corpo + form + renderDetalheMissaoAvulso();
  } finally {
    [_minhaMetaCache, _campanhaCache, _acompModo] = salvo;
  }
}
// Lançou/apagou estrela: recarrega o painel de quem está aberto.
window.addEventListener?.('estrelas-ajuste', () => { if (_acompId) { _acompLista = null; _acompCarregar(_acompId, true); } });
window.acompVer = (id) => { _acompId = id; _rerender(); };
window.acompAtualizar = () => { _acompLista = null; if (_acompId) _acompCarregar(_acompId, true); _rerender(); };

// ── RESUMO NO TOPO DO DASHBOARD (Marcia 19/out) ──────────────────────────
// Uma faixa curta com o dia dela: vendido × meta, semana, ticket e estrelas.
// O detalhe fica no Meu Painel. Só pra quem tem meta do mês ou Estrelas.
export function renderResumoTopo() {
  const u = S.user || {};
  const r = String(u.role || '').toLowerCase(), cg = String(u.cargo || '').toLowerCase();
  if (r === 'administrador' || cg === 'admin' || r === 'gerente' || cg === 'gerente' || r === 'entregador') return '';
  _garantirMetaECampanha();
  const m = _minhaMetaCache?.meta;
  const p = _campanhaCache?.ativa ? _campanhaCache.progresso : null;
  if (!m && !p) return '';
  const cc = (c) => $c((Number(c) || 0) / 100);
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const si = m ? _statusInfo(m.hoje?.status) : null;
  const caixa = (titulo, valor, sub, cor) => `<div style="flex:1 1 120px;min-width:0;background:#fff;border-radius:10px;padding:8px 10px;">
      <div style="font-size:9.5px;color:#64748B;text-transform:uppercase;font-weight:800;letter-spacing:.3px;">${titulo}</div>
      <div style="font-size:16px;font-weight:900;color:${cor || '#0F172A'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${valor}</div>
      <div style="font-size:10.5px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${sub}</div></div>`;
  const hojeV = m?.hoje?.faturamento || 0, hojeM = m?.hoje?.meta || 0;
  const semV = m?.semana?.faturamento || 0, semM = m?.semana?.meta || 0;
  const tk = m?.hoje?.ticket || 0, tkOk = m && tk >= (m.ticketMeta || 0);
  const perto = p ? _missoesPerto(1)[0] : null;
  return `<div class="card" style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#FDF2F8,#FFFBEB);border:1.5px solid #FBCFE8;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="font-size:13px;font-weight:900;color:#9D174D;">🎯 Seu dia${m?.compartilhada ? ' — meta da loja' : ''}${si ? ` · <span style="color:${si.cor};">${si.emoji} ${si.txt}</span>` : ''}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="setPage('meuPainel')" style="white-space:nowrap;">Meu painel →</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${m ? caixa(m.compartilhada ? 'Loja hoje' : 'Hoje', cc(hojeV), `de ${cc(hojeM)} · ${pct(hojeV, hojeM)}%`, pct(hojeV, hojeM) >= 100 ? '#15803D' : '#9D174D') : ''}
      ${m ? caixa('Semana', cc(semV), `de ${cc(semM)} · ${pct(semV, semM)}%`) : ''}
      ${m ? caixa('Ticket hoje', cc(tk), `meta ${cc(m.ticketMeta)}${tkOk ? ' ✓' : ''}`, tkOk ? '#15803D' : '#B45309') : ''}
      ${p ? caixa('Estrelas', `${p.estrelas}${p.estrelasPossiveis ? '/' + p.estrelasPossiveis : ''} ⭐`, p.proximaFaixa ? `faltam ${Math.max(0, p.proximaFaixa.estrelas - p.estrelas)} p/ ${$c(p.proximaFaixa.bonus)}` : 'faixa máxima 🏆', '#B45309') : ''}
    </div>
    ${perto ? `<div style="font-size:11px;color:#92400E;margin-top:8px;">⭐ Quase lá: <b>${perto.m.icon || ''} ${perto.m.label}</b> — ${perto.m.money ? $c(perto.m.progresso) : perto.m.pct ? perto.m.progresso + '%' : perto.m.progresso} de ${perto.m.money ? $c(perto.m.alvo) : perto.m.pct ? perto.m.alvo + '%' : perto.m.alvo}</div>` : ''}
  </div>`;
}

// 🌡️ Termômetro da meta geral (Marcia 29/out/2026): meta da loja do dia,
// atualiza a cada 1 min enquanto o Meu Painel está aberto e toca a
// musiquinha quando a luz sobe.
let _lojaTermo = null, _lojaTermoAt = 0, _lojaTermoIv = null;
function _carregarTermometro() {
  _lojaTermoAt = Date.now();
  return GET('/comissoes/resumo-dia').then(r => {
    const l = r?.loja || null;
    const mudou = JSON.stringify(l) !== JSON.stringify(_lojaTermo);
    _lojaTermo = l;
    if (l?.status) checarSubidaNivel(l.status);
    if (mudou && S.page === 'meuPainel') import('../main.js').then(m => m.render()).catch(() => {});
  }).catch(() => {});
}
function _garantirTermometro() {
  if (Date.now() - _lojaTermoAt > 60000) _carregarTermometro();
  if (!_lojaTermoIv) _lojaTermoIv = setInterval(() => { if (S.page === 'meuPainel') _carregarTermometro(); }, 60000);
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
  // Dispara carga das COMISSÕES da fonte única do servidor (re-render ao chegar)
  if (_comissoesCache === null && !_comissoesLoading) {
    loadComissoes().then(() => {
      import('../main.js').then(m => m.render()).catch(()=>{});
    });
  }
  _garantirMetaECampanha();
  _garantirTermometro();
  const pontosRaw = _pontosCache || [];
  const pontos = agruparPontosPorDia(pontosRaw);
  const comissoes = Array.isArray(_comissoesCache) ? _comissoesCache : [];
  // Bloco de Metas individuais (admin define) — usa historico do colab
  const metasHTML = ''; // metas avulsas antigas saíram (out/2026) — a meta agora é a do mês

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
${termometroHTML(_lojaTermo)}
${_minhaMetaCache?.meta ? renderMinhaMeta(_minhaMetaCache.meta, nome) : `<div class="card" style="margin-bottom:14px;"><div style="font-family:'Playfair Display',serif;font-size:18px;color:#9F1239;">Olá, ${nome.split(' ')[0]} 🌹</div><div style="font-size:12px;color:var(--muted);">${cargo}</div></div>${renderMetasVenda(_metasVendaCache)}`}
${renderComparativoAtendimento(_campanhaCache?.ativa ? _campanhaCache.comparativo : null)}
${renderCampanhaColab(_campanhaCache)}

<div style="display:grid;gap:10px;">
  <!-- COMISSOES (recolhida: uma linha com o total do mês) -->
  <details class="card mp-det" open style="margin:0;">
    <summary style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#0F172A;">
      <span>💰 Comissão do mês <span style="font-size:11px;color:var(--muted);font-weight:500;">(${fmtMes(_mesAtual)})</span></span>
      <span style="color:#15803D;">${$c(totalAcumulado)} ▾</span></summary>
    <div style="margin-top:12px;"></div>
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
  </details>

  <!-- PONTOS — apenas mes vigente -->
  ${(() => {
    // Filtra pontos so do mes atual (Manaus). Ao virar de mes, comeca zerado.
    const pontosMes = pontos.filter(p => (p.data||'').slice(0,7) === _mesAtual);
    // Dias sem saída (ou sem volta do almoço/intervalo) — não valem pras metas compartilhadas.
    const _hojeYmd = _nowManaus.toISOString().slice(0, 10);
    const incompletos = pontosMes.filter(p => p.data !== _hojeYmd && p.entrada && (!p.saida || (p.saidaAlmoco && !p.voltaAlmoco) || (p.saidaIntervalo && !p.voltaIntervalo))).length;
    return `
  <details class="card mp-det" open style="margin:0;">
    <summary style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;font-weight:800;color:#0F172A;">
      <span>⏰ Meus pontos <span style="font-size:11px;color:var(--muted);font-weight:500;">(${fmtMes(_mesAtual)})</span></span>
      <span style="font-size:12px;${incompletos ? 'color:#B45309;' : 'color:#64748B;'}">${pontosMes.length} dias${incompletos ? ` · ⚠️ ${incompletos} incompleto${incompletos > 1 ? 's' : ''}` : ''} ▾</span></summary>
    <div style="margin-top:12px;"></div>
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
          <th style="padding:10px 6px;text-align:right;font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;">Horas</th>
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
              <td style="text-align:right;padding:8px 6px;font-family:Monaco,monospace;color:#15803D;font-weight:700;">${(p.entrada && p.saida) ? fmtHorasPonto(minutosTrabalhados(p)) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    `}
  </details>`;
  })()}
</div>

${metasHTML}
`;
}

// ── 🛵 ESTRELAS DOS ENTREGADORES em Metas → ⭐ Programa Estrelas (gerência) — Marcia 28/out ────
// Ranking da semana só dos entregadores, com o detalhe das missões de cada um
// (toque no nome). Mesma fonte da aba 🛵 Entregadores (/campanha/ranking).
let _entRk = null, _entRkAt = 0, _entRkLoading = false, _entAberto = '';
export function renderEstrelasEntregadoresGer() {
  const u = S.user || {};
  const r = String(u.role || '').toLowerCase(), cg = String(u.cargo || '').toLowerCase();
  if (!(r === 'administrador' || cg === 'admin' || r === 'gerente' || cg === 'gerente')) return '';
  if (!_entRkLoading && (_entRk === null || Date.now() - _entRkAt > 180000)) {
    _entRkLoading = true;
    GET('/campanha/ranking').then(x => { _entRk = x || { ranking: [] }; }).catch(() => { if (_entRk === null) _entRk = { ranking: [] }; })
      .finally(() => { _entRkLoading = false; _entRkAt = Date.now(); _rerender(); });
  }
  if (!_entRk?.ativa) return '';
  const lista = (_entRk.ranking || []).filter(p => p.setor === 'entregas');
  if (!lista.length) return '';
  const val = (m) => m.pct ? `${m.progresso || 0}%` : m.money ? $c(m.progresso || 0) : (m.progresso ?? 0);
  return `<div class="card" style="margin-bottom:14px;padding:12px;background:linear-gradient(135deg,#ECFDF5,#F0F9FF);border:1.5px solid #A7F3D0;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="font-size:13px;font-weight:900;color:#065F46;">🛵 Estrelas dos entregadores — semana ${String(_entRk.weekKey || '').split('-').reverse().slice(0, 2).join('/')}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="entGerAbrirEstrelas()" style="white-space:nowrap;">Aba 🛵 Entregadores →</button>
    </div>
    ${lista.map((p, i) => {
      const ab = _entAberto === p.colabId;
      const ent = (p.missoes || []).find(m => m.metrica === 'entregas');
      return `<div style="border-top:1px solid #D1FAE5;padding:7px 0;">
        <div style="display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="entGerAbrir('${esc(p.colabId)}')">
          <div style="width:24px;text-align:center;font-weight:900;">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</div>
          <div style="flex:1;min-width:0;font-weight:800;font-size:13px;">${esc(p.nome)} <span style="font-size:11px;color:#64748B;font-weight:600;">${ent ? `· ${ent.progresso || 0} entregas na semana` : ''} ▾</span></div>
          <div style="text-align:right;white-space:nowrap;"><b style="color:#B45309;">${p.estrelas || 0} ⭐</b><span style="font-size:10px;color:#64748B;"> /${p.estrelasPossiveis || 0}</span>
            <div style="font-size:10.5px;color:#15803D;font-weight:800;">${$c(p.bonus || 0)}</div></div>
        </div>
        ${ab ? `<div style="margin:6px 0 0 32px;">${(p.missoes || []).map(m => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:11.5px;padding:3px 0;border-bottom:1px dashed #D1FAE5;">
            <span>${esc(m.icon || '🎯')} ${esc(m.label || m.nome)}${m.aguardaFimDia ? ' <em style="color:#B45309;">(confirma ao fechar)</em>' : ''}${m.tipo === 'semana' && m.aguardaCiclo ? ' <em style="color:#64748B;">(a partir do 5º dia com entrega)</em>' : ''}</span>
            <span style="white-space:nowrap;">${m.manual ? '' : `${m.tipo === 'semana' ? 'semana ' : 'hoje '}${val(m)} · `}${m.vezes || 0}/${m.limite} · <b style="color:${m.ganhas ? '#B45309' : '#94A3B8'};">${m.ganhas || 0} ⭐</b></span></div>`).join('')}
          ${(p.penalidades || []).filter(x => x.tipo === 'dano' || x.tipo === 'erroEntrega').map(x => `<div style="font-size:11px;color:#B91C1C;margin-top:3px;">📝 ${String(x.data || '').split('-').reverse().slice(0, 2).join('/')} · ${x.tipo === 'dano' ? 'Dano no transporte' : 'Erro de entrega'}${x.motivo ? ' — ' + esc(x.motivo) : ''}</div>`).join('')}
        </div>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}
window.entGerAbrir = (id) => { _entAberto = _entAberto === id ? '' : id; _rerender(); };
window.entGerAbrirEstrelas = () => { try { window.esTab?.('entregadores'); } catch (_) {} };
