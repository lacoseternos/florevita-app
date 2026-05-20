// ── CAIXA ─────────────────────────────────────────────────────
import { S } from '../state.js';
import { $c, $d, fmtOrderNum } from '../utils/formatters.js';
import { GET, POST } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { can, findColab } from '../services/auth.js';

// ── DATA — migrado de localStorage para API ──────────────────

export async function getCaixaRegistros() {
  try { return await GET('/caixa'); }
  catch { return JSON.parse(localStorage.getItem('fv_caixa') || '[]'); }
}

export async function saveCaixaRegistro(registro) {
  try { return await POST('/caixa', registro); }
  catch {
    // fallback localStorage
    const registros = JSON.parse(localStorage.getItem('fv_caixa') || '[]');
    const idx = registros.findIndex(r => r.id === registro.id);
    if (idx >= 0) registros[idx] = registro; else registros.push(registro);
    localStorage.setItem('fv_caixa', JSON.stringify(registros));
  }
}

// sync version for backward compat
export function getCaixaRegistrosSync() {
  return JSON.parse(localStorage.getItem('fv_caixa') || '[]');
}
export function saveCaixaRegistrosSync(r) {
  localStorage.setItem('fv_caixa', JSON.stringify(r));
}

// ── SYNC: backend é fonte de verdade. localStorage = cache para paint rápido ──
let _syncing = false;
let _pollTimer = null;
let _lastSyncAt = 0;
let _lastSyncHash = '';

export async function syncCaixaFromBackend({ silent = true, force = false } = {}) {
  if (_syncing) return;
  if (!force && (Date.now() - _lastSyncAt) < 8000) return; // throttle
  _syncing = true;
  try {
    const remote = await GET('/caixa');
    _lastSyncAt = Date.now();
    if (Array.isArray(remote)) {
      const norm = remote.map(r => ({ ...r, id: r.id || (r._id ? String(r._id) : '') }));
      const map = new Map();
      norm.forEach(r => {
        const k = `${r.date}|${r.unit}`;
        const prev = map.get(k);
        if (!prev) { map.set(k, r); return; }
        const tPrev = new Date(prev.updatedAt || prev.createdAt || 0).getTime();
        const tCur  = new Date(r.updatedAt    || r.createdAt    || 0).getTime();
        if (tCur >= tPrev) map.set(k, r);
      });
      const merged = Array.from(map.values());
      // Hash conteúdo — só re-renderiza se mudou (evita loop e evita matar clique do usuário)
      const hash = JSON.stringify(merged.map(r => [r.date, r.unit, r.updatedAt || r.createdAt, (r.movimentos||[]).length, !!r.fechamento]));
      if (hash !== _lastSyncHash) {
        _lastSyncHash = hash;
        localStorage.setItem('fv_caixa', JSON.stringify(merged));
        try {
          if (S._page === 'caixa' && !S._modal) {
            const m = await import('../main.js');
            m.render?.();
          }
        } catch {}
      }
    }
  } catch (e) {
    if (!silent) toast('⚠️ Sem conexão com servidor (caixa em modo local)', true);
  } finally {
    _syncing = false;
  }
}

export function startCaixaPolling() {
  stopCaixaPolling();
  _pollTimer = setInterval(() => {
    if (S._page === 'caixa') {
      if (!S._modal) syncCaixaFromBackend({ silent: true });
    } else stopCaixaPolling();
  }, 20000);
}
export function stopCaixaPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ── RENDER ───────────────────────────────────────────────────

export function renderCaixa() {
  const unit = S.user.unit;
  const unitOk = ['Loja Novo Aleixo', 'Loja Allegro Mall'].includes(unit) || (S.user.role === 'Administrador');
  if (!unitOk) return `<div class="empty card"><div class="empty-icon">\uD83D\uDEAB</div><p>Modulo Caixa disponivel apenas para Loja Novo Aleixo e Loja Allegro Mall.</p></div>`;

  const registros = getCaixaRegistrosSync();
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
  const caixaHoje = registros.find(r => r.date === hoje && r.unit === (unit === 'Todas' ? S._caixaUnit || 'Loja Novo Aleixo' : unit));
  const unidadeSel = unit === 'Todas' ? (S._caixaUnit || 'Loja Novo Aleixo') : unit;
  const historico = registros.filter(r => r.unit === unidadeSel).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);

  const PAGOS_CX = ['Pago','Aprovado','Pago na Entrega'];
  const pedidosHoje = S.orders.filter(o => {
    const d = new Date(o.createdAt).toLocaleDateString('en-CA',{timeZone:'America/Manaus'});
    return d === hoje && o.unit === unidadeSel && o.status !== 'Cancelado' && PAGOS_CX.includes(o.paymentStatus);
  });
  const totalVendas = pedidosHoje.reduce((s, o) => s + (o.total || 0), 0);

  // ── DINHEIRO RECEBIDO POR ENTREGADORES (Pago na Entrega + Dinheiro) ──
  const entregasDinheiroHoje = S.orders.filter(o => {
    const d = new Date(o.updatedAt||o.createdAt).toLocaleDateString('en-CA',{timeZone:'America/Manaus'});
    return d === hoje && o.unit === unidadeSel &&
           o.status === 'Entregue' &&
           o.payment === 'Pagar na Entrega' &&
           o.paymentOnDelivery === 'Dinheiro' &&
           o.paymentStatus === 'Pago na Entrega';
  });
  // Agrupa por entregador
  const dinheiroPorEntregador = {};
  entregasDinheiroHoje.forEach(o => {
    const driver = o.driverName || 'Sem entregador';
    if(!dinheiroPorEntregador[driver]) dinheiroPorEntregador[driver] = { total:0, pedidos:[] };
    dinheiroPorEntregador[driver].total += (o.total||0);
    dinheiroPorEntregador[driver].pedidos.push(o);
  });
  const totalDinheiroEntregadores = Object.values(dinheiroPorEntregador).reduce((s,d) => s + d.total, 0);

  const statusCaixa = !caixaHoje ? 'fechado' : !caixaHoje.fechamento ? 'aberto' : 'encerrado';

  return `
${S.user.role === 'Administrador' ? `
<div style="display:flex;gap:8px;margin-bottom:14px;align-items:center;">
  <label class="fl" style="margin:0">Unidade:</label>
  <select class="fi" id="caixa-unit-sel" style="width:auto;">
    <option value="Loja Novo Aleixo" ${unidadeSel === 'Loja Novo Aleixo' ? 'selected' : ''}>Loja Novo Aleixo</option>
    <option value="Loja Allegro Mall" ${unidadeSel === 'Loja Allegro Mall' ? 'selected' : ''}>Loja Allegro Mall</option>
  </select>
</div>` : ''}

<!-- Status do Caixa -->
<div class="card" style="margin-bottom:16px;border-left:4px solid ${statusCaixa === 'aberto' ? 'var(--leaf)' : statusCaixa === 'encerrado' ? 'var(--muted)' : 'var(--gold)'};">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
    <div>
      <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${unidadeSel} \u2014 ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</div>
      <div style="font-size:20px;font-weight:700;color:${statusCaixa === 'aberto' ? 'var(--leaf)' : statusCaixa === 'encerrado' ? 'var(--muted)' : 'var(--gold)'};">
        ${statusCaixa === 'aberto' ? '\uD83D\uDFE2 Caixa Aberto' : statusCaixa === 'encerrado' ? '\uD83D\uDD12 Caixa Encerrado' : '\uD83D\uDD34 Caixa Fechado'}
      </div>
      ${caixaHoje ? `<div style="font-size:11px;color:var(--muted);margin-top:4px">
        ${caixaHoje.abertura ? 'Aberto as ' + caixaHoje.abertura.hora + ' por ' + caixaHoje.abertura.usuario : ''}
        ${caixaHoje.fechamento ? ' \u00B7 Fechado as ' + caixaHoje.fechamento.hora : ''}
      </div>` : ''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      ${statusCaixa === 'fechado' ? `<button class="btn btn-green" id="btn-abrir-caixa">\uD83D\uDCB5 Abrir Caixa</button>` : ''}
      ${statusCaixa === 'aberto' ? `
        <button class="btn btn-outline btn-sm" id="btn-sangria">\uD83D\uDCE4 Sangria</button>
        <button class="btn btn-outline btn-sm" id="btn-suprimento">\uD83D\uDCE5 Suprimento</button>
        <button class="btn btn-red" id="btn-fechar-caixa">\uD83D\uDD12 Fechar Caixa</button>
      ` : ''}
      ${statusCaixa === 'encerrado' ? `<button class="btn btn-ghost btn-sm" id="btn-reimprimir-caixa">\uD83D\uDDA8\uFE0F Reimprimir Fechamento</button>` : ''}
    </div>
  </div>
</div>

<!-- Metricas do dia -->
${caixaHoje ? `
<div class="g4" style="margin-bottom:16px;">
  <div class="mc leaf"><div class="mc-label">Saldo Abertura</div><div class="mc-val">${$c(caixaHoje.abertura?.saldo || 0)}</div></div>
  <div class="mc rose"><div class="mc-label">Vendas PDV (Pago)</div><div class="mc-val">${$c(totalVendas)}</div></div>
  <div class="mc gold"><div class="mc-label">Sangrias</div><div class="mc-val">${$c((caixaHoje.movimentos || []).filter(m => m.tipo === 'Sangria').reduce((s, m) => s + m.valor, 0))}</div></div>
  <div class="mc blue"><div class="mc-label">Saldo Atual Estimado</div><div class="mc-val">${$c(
    (caixaHoje.abertura?.saldo || 0) + totalVendas
    - (caixaHoje.movimentos || []).filter(m => m.tipo === 'Sangria').reduce((s, m) => s + m.valor, 0)
    + (caixaHoje.movimentos || []).filter(m => m.tipo === 'Suprimento').reduce((s, m) => s + m.valor, 0)
  )}</div></div>
</div>

<!-- Dinheiro recebido por entregadores -->
${Object.keys(dinheiroPorEntregador).length > 0 ? `
<div class="card" style="margin-bottom:16px;border-left:4px solid #F97316;background:linear-gradient(135deg,#FFF7ED,#fff);">
  <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
    <span>💵 Dinheiro recebido por entregadores</span>
    <span style="background:#F97316;color:#fff;padding:3px 10px;border-radius:12px;font-size:13px;font-weight:800;">${$c(totalDinheiroEntregadores)}</span>
  </div>
  <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">
    Valores recebidos em dinheiro nas entregas de hoje (precisam ser devolvidos ao caixa)
  </div>
  ${Object.entries(dinheiroPorEntregador).sort((a,b)=>b[1].total-a[1].total).map(([driver, info]) => `
  <div style="background:#fff;border:1px solid #FED7AA;border-radius:10px;padding:12px 14px;margin-bottom:8px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div style="font-weight:700;font-size:14px;color:#7C2D12;">🚚 ${driver}</div>
      <div style="font-weight:800;font-size:16px;color:#F97316;">${$c(info.total)}</div>
    </div>
    <div style="font-size:11px;color:var(--muted);">
      ${info.pedidos.length} entrega(s): ${info.pedidos.map(p => fmtOrderNum(p)).join(', ')}
    </div>
  </div>`).join('')}
</div>` : ''}

<!-- Movimentos do dia -->
<div class="card" style="margin-bottom:16px;">
  <div class="card-title">\uD83D\uDCCB Movimentos do Dia</div>
  ${pedidosHoje.length === 0 && (caixaHoje.movimentos || []).length === 0 ? `<div class="empty"><p>Nenhum movimento ainda</p></div>` : `
  <div class="tw"><table><thead><tr><th>Hora</th><th>Tipo</th><th>Descricao</th><th>Valor</th></tr></thead><tbody>
    <tr><td>${caixaHoje.abertura?.hora || '\u2014'}</td><td><span class="tag t-green">Abertura</span></td><td>Saldo inicial</td><td style="font-weight:600;color:var(--leaf)">${$c(caixaHoje.abertura?.saldo || 0)}</td></tr>
    ${(caixaHoje.movimentos || []).map(m => `<tr>
      <td>${m.hora}</td>
      <td><span class="tag ${m.tipo === 'Sangria' ? 't-red' : 't-blue'}">${m.tipo}</span></td>
      <td>${m.descricao}</td>
      <td style="font-weight:600;color:${m.tipo === 'Sangria' ? 'var(--red)' : 'var(--blue)'}">${m.tipo === 'Sangria' ? '\u2212' : '+'} ${$c(m.valor)}</td>
    </tr>`).join('')}
    ${pedidosHoje.map(o => `<tr>
      <td>${new Date(o.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
      <td><span class="tag t-rose">Venda</span></td>
      <td>${fmtOrderNum(o)} \u2014 ${o.client?.name || o.clientName || '\u2014'} (${o.payment})</td>
      <td style="font-weight:600;color:var(--rose)">+ ${$c(o.total)}</td>
    </tr>`).join('')}
    ${caixaHoje.fechamento ? `<tr style="background:var(--cream)">
      <td>${caixaHoje.fechamento.hora}</td><td><span class="tag t-gray">Fechamento</span></td>
      <td>Caixa encerrado por ${caixaHoje.fechamento.usuario}</td>
      <td style="font-weight:700">${$c(caixaHoje.fechamento.saldoFinal)}</td>
    </tr>` : ''}
  </tbody></table></div>`}
</div>` : ''}

<!-- Historico -->
<div class="card">
  <div class="card-title">\uD83D\uDCC5 Historico de Caixas</div>
  ${historico.length === 0 ? `<div class="empty"><p>Nenhum caixa registrado ainda</p></div>` : `
  <div class="tw"><table><thead><tr><th>Data</th><th>Unidade</th><th>Abertura</th><th>Fechamento</th><th>Saldo Abertura</th><th>Saldo Final</th><th>Status</th></tr></thead><tbody>
  ${historico.map(r => `<tr>
    <td>${new Date(r.date + 'T12:00').toLocaleDateString('pt-BR')}</td>
    <td style="font-size:11px">${r.unit}</td>
    <td>${r.abertura?.hora || '\u2014'}</td>
    <td>${r.fechamento?.hora || '\u2014'}</td>
    <td>${$c(r.abertura?.saldo || 0)}</td>
    <td style="font-weight:600">${r.fechamento ? $c(r.fechamento.saldoFinal) : '\u2014'}</td>
    <td><span class="tag ${r.fechamento ? 't-gray' : 't-green'}">${r.fechamento ? 'Encerrado' : 'Aberto'}</span></td>
  </tr>`).join('')}
  </tbody></table></div>`}
</div>`;
}

// ── BIND EVENTS ──────────────────────────────────────────────

export function bindCaixaEvents() {
  const render = () => import('../main.js').then(m => m.render()).catch(() => {});
  const unit = S.user.unit === 'Todas' ? (S._caixaUnit || 'Loja Novo Aleixo') : S.user.unit;
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });

  // 🔄 SYNC: ao entrar na página, busca do backend (fonte de verdade)
  //   e inicia polling enquanto estiver no módulo caixa.
  syncCaixaFromBackend({ silent: true });
  startCaixaPolling();

  // Selector unidade (admin)
  document.getElementById('caixa-unit-sel')?.addEventListener('change', e => {
    S._caixaUnit = e.target.value;
    render();
  });

  // Abrir Caixa
  {
    const _el = document.getElementById('btn-abrir-caixa');
    if (_el) _el.onclick = () => {
      S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:420px" onclick="event.stopPropagation()">
        <div class="mo-title">\uD83D\uDCB5 Abrir Caixa \u2014 ${unit}</div>
        <div class="alert al-info" style="margin-bottom:14px;">Informe o fundo de caixa (troco disponivel no inicio do dia).</div>
        <div class="fg"><label class="fl">Fundo de Caixa (R$) *</label>
          <input class="fi" id="cx-saldo" type="number" step="0.01" placeholder="0,00" value="0" style="font-size:20px;text-align:center;font-weight:700;"/>
        </div>
        <div class="mo-foot">
          <button class="btn btn-green" id="btn-cx-confirm" style="flex:1;justify-content:center;padding:11px">\u2705 Abrir Caixa</button>
          <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
        </div>
      </div></div>`;
      render();
      setTimeout(() => {
        document.getElementById('btn-mo-close')?.addEventListener('click', () => { S._modal = ''; render(); });
        document.getElementById('cx-saldo')?.focus();
        document.getElementById('btn-cx-confirm')?.addEventListener('click', async () => {
          // Validacao: nao permite 2 caixas abertos
          const { podeAbrirCaixa } = await import('../services/caixaGuard.js');
          const liberado = await podeAbrirCaixa(S.user, unit);
          if (!liberado) { S._modal = ''; render(); return; }

          // Sincroniza antes para evitar abrir 2x se outra colaboradora já abriu
          await syncCaixaFromBackend({ silent: true });

          const saldo = parseFloat(document.getElementById('cx-saldo')?.value) || 0;
          const registros = getCaixaRegistrosSync();
          const existente = registros.find(r => r.date === hoje && r.unit === unit);
          if (existente) { toast('\u26A0\uFE0F Caixa ja aberto hoje!'); S._modal = ''; render(); return; }
          const newReg = {
            id: Date.now() + '', date: hoje, unit,
            abertura: { hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), usuario: S.user.name, saldo },
            movimentos: [], fechamento: null
          };
          registros.push(newReg);
          saveCaixaRegistrosSync(registros);
          S._modal = '';
          render();
          try {
            await saveCaixaRegistro(newReg);
            toast('\u2705 Caixa aberto com fundo de ' + $c(saldo));
            await syncCaixaFromBackend({ silent: true });
          } catch (e) {
            toast('\u26a0\ufe0f Caixa aberto localmente, mas falha ao sincronizar com servidor. Verifique a conex\u00e3o.', true);
          }
        });
      }, 50);
    };
  }

  // Sangria \u2014 handlers inline (n\u00E3o dependem de timing nem de bindCaixaEvents)
  window._fvAbrirSangria = () => {
    const MOTIVOS = ['Recolhimento', 'Pagamento fornecedor', 'Despesa operacional', 'Troco', 'Combust\u00EDvel', 'Outro'];
    window._fvMotivoSel = (motivo) => {
      const inp = document.getElementById('cx-desc');
      if (inp) { inp.value = motivo === 'Outro' ? '' : motivo; try { inp.focus(); } catch(_){} }
      document.querySelectorAll('#cx-motivo-btns .cx-mt-btn').forEach(x => {
        x.style.background = '#fff'; x.style.borderColor = '#D1D5DB'; x.style.color = '#374151';
      });
      const btn = document.querySelector(`#cx-motivo-btns .cx-mt-btn[data-motivo="${motivo}"]`);
      if (btn) { btn.style.background = '#FEE2E2'; btn.style.borderColor = '#DC2626'; btn.style.color = '#991B1B'; }
    };
    window._fvCancelarSangria = () => { S._modal = ''; import('../main.js').then(m => m.render?.()); };
    window._fvConfirmarSangria = async () => {
      const valor = parseFloat(document.getElementById('cx-val')?.value) || 0;
      if (!valor || valor <= 0) return toast('\u274C Informe o valor da sangria');
      const desc = (document.getElementById('cx-desc')?.value || '').trim();
      if (!desc) return toast('\u274C Informe o motivo da sangria');
      await syncCaixaFromBackend({ silent: true });
      const registros = getCaixaRegistrosSync();
      const idx = registros.findIndex(r => r.date === hoje && r.unit === unit && !r.fechamento);
      if (idx < 0) return toast('\u274C Caixa n\u00E3o est\u00E1 aberto');
      registros[idx].movimentos = registros[idx].movimentos || [];
      registros[idx].movimentos.push({
        tipo: 'Sangria', valor, descricao: desc,
        hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        usuario: S.user.name
      });
      saveCaixaRegistrosSync(registros);
      S._modal = '';
      const m = await import('../main.js'); m.render?.();
      try {
        await saveCaixaRegistro(registros[idx]);
        toast('\uD83D\uDCE4 Sangria de ' + $c(valor) + ' registrada');
        await syncCaixaFromBackend({ silent: true, force: true });
      } catch (e) {
        toast('\u26A0\uFE0F Sangria registrada localmente, falha ao sincronizar.', true);
      }
    };

    S._modal = `<div class="mo" id="mo" onclick="if(event.target.id==='mo'){window._fvCancelarSangria();}"><div class="mo-box" style="max-width:460px" onclick="event.stopPropagation()">
      <div class="mo-title">\uD83D\uDCE4 Sangria de Caixa</div>
      <div class="alert al-info" style="margin-bottom:14px;font-size:12px;">Retirada de dinheiro do caixa. Informe o valor e o motivo.</div>

      <div class="fg"><label class="fl" style="font-weight:700;">Valor (R$) *</label>
        <input class="fi" id="cx-val" type="number" step="0.01" placeholder="0,00" value="" style="font-size:20px;text-align:center;font-weight:700;padding:12px;"/>
      </div>

      <div class="fg" style="margin-bottom:8px;">
        <label class="fl" style="display:block;margin-bottom:8px;font-weight:700;color:#7C2D12;font-size:14px;">Motivo da Sangria *</label>
        <div id="cx-motivo-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${MOTIVOS.map(m => `<button type="button" data-motivo="${m}" class="cx-mt-btn" onclick="window._fvMotivoSel('${m.replace(/'/g, "\\'")}')" style="background:#fff;border:2px solid #D1D5DB;border-radius:20px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;color:#374151;">${m}</button>`).join('')}
        </div>
        <input class="fi" id="cx-desc" type="text" placeholder="Descreva o motivo da sangria\u2026" autocomplete="off" style="width:100%;font-size:14px;padding:12px;border:2px solid #FCA5A5;background:#FFF7F7;"/>
        <div style="font-size:11px;color:#6B7280;margin-top:5px;">\uD83D\uDC46 Clique num motivo acima ou escreva livremente no campo.</div>
      </div>

      <div class="mo-foot">
        <button class="btn btn-red" onclick="window._fvConfirmarSangria()" style="flex:1;justify-content:center;padding:11px;font-weight:700;">\u2705 Registrar Sangria</button>
        <button class="btn btn-ghost" onclick="window._fvCancelarSangria()">Cancelar</button>
      </div>
    </div></div>`;
    import('../main.js').then(m => m.render?.());
  };

  {
    const _el = document.getElementById('btn-sangria');
    if (_el) _el.onclick = () => window._fvAbrirSangria();
  }

  // Suprimento
  // Suprimento \u2014 handlers inline
  window._fvAbrirSuprimento = () => {
    const MOTIVOS_S = ['Refor\u00E7o de caixa', 'Troco adicional', 'Devolu\u00E7\u00E3o entregador', 'Outro'];
    window._fvMotivoSelS = (motivo) => {
      const inp = document.getElementById('cx-desc');
      if (inp) { inp.value = motivo === 'Outro' ? '' : motivo; try { inp.focus(); } catch(_){} }
      document.querySelectorAll('#cx-motivo-btns .cx-mt-btn').forEach(x => {
        x.style.background = '#fff'; x.style.borderColor = '#D1D5DB'; x.style.color = '#374151';
      });
      const btn = document.querySelector(`#cx-motivo-btns .cx-mt-btn[data-motivo="${motivo}"]`);
      if (btn) { btn.style.background = '#DBEAFE'; btn.style.borderColor = '#1E40AF'; btn.style.color = '#1E3A8A'; }
    };
    window._fvCancelarSuprimento = () => { S._modal = ''; import('../main.js').then(m => m.render?.()); };
    window._fvConfirmarSuprimento = async () => {
      const valor = parseFloat(document.getElementById('cx-val')?.value) || 0;
      if (!valor || valor <= 0) return toast('\u274C Informe o valor do suprimento');
      const desc = (document.getElementById('cx-desc')?.value || '').trim() || 'Refor\u00E7o de caixa';
      await syncCaixaFromBackend({ silent: true });
      const registros = getCaixaRegistrosSync();
      const idx = registros.findIndex(r => r.date === hoje && r.unit === unit && !r.fechamento);
      if (idx < 0) return toast('\u274C Caixa n\u00E3o est\u00E1 aberto');
      registros[idx].movimentos = registros[idx].movimentos || [];
      registros[idx].movimentos.push({
        tipo: 'Suprimento', valor, descricao: desc,
        hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        usuario: S.user.name
      });
      saveCaixaRegistrosSync(registros);
      S._modal = '';
      const m = await import('../main.js'); m.render?.();
      try {
        await saveCaixaRegistro(registros[idx]);
        toast('\uD83D\uDCE5 Suprimento de ' + $c(valor) + ' registrado');
        await syncCaixaFromBackend({ silent: true, force: true });
      } catch (e) {
        toast('\u26A0\uFE0F Suprimento registrado localmente, falha ao sincronizar.', true);
      }
    };

    S._modal = `<div class="mo" id="mo" onclick="if(event.target.id==='mo'){window._fvCancelarSuprimento();}"><div class="mo-box" style="max-width:460px" onclick="event.stopPropagation()">
      <div class="mo-title">\uD83D\uDCE5 Suprimento de Caixa</div>
      <div class="alert al-info" style="margin-bottom:14px;font-size:12px;">Entrada de dinheiro no caixa. Informe o valor e o motivo.</div>

      <div class="fg"><label class="fl" style="font-weight:700;">Valor (R$) *</label>
        <input class="fi" id="cx-val" type="number" step="0.01" placeholder="0,00" value="" style="font-size:20px;text-align:center;font-weight:700;padding:12px;"/>
      </div>

      <div class="fg" style="margin-bottom:8px;">
        <label class="fl" style="display:block;margin-bottom:8px;font-weight:700;color:#1E40AF;font-size:14px;">Motivo do Suprimento *</label>
        <div id="cx-motivo-btns" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${MOTIVOS_S.map(m => `<button type="button" data-motivo="${m}" class="cx-mt-btn" onclick="window._fvMotivoSelS('${m.replace(/'/g, "\\'")}')" style="background:#fff;border:2px solid #D1D5DB;border-radius:20px;padding:8px 14px;font-size:13px;cursor:pointer;font-weight:600;color:#374151;">${m}</button>`).join('')}
        </div>
        <input class="fi" id="cx-desc" type="text" placeholder="Descreva o motivo do suprimento\u2026" autocomplete="off" style="width:100%;font-size:14px;padding:12px;border:2px solid #93C5FD;background:#F0F9FF;"/>
        <div style="font-size:11px;color:#6B7280;margin-top:5px;">\uD83D\uDC46 Clique num motivo acima ou escreva livremente no campo.</div>
      </div>

      <div class="mo-foot">
        <button class="btn btn-blue" onclick="window._fvConfirmarSuprimento()" style="flex:1;justify-content:center;padding:11px;font-weight:700;">\u2705 Registrar Suprimento</button>
        <button class="btn btn-ghost" onclick="window._fvCancelarSuprimento()">Cancelar</button>
      </div>
    </div></div>`;
    import('../main.js').then(m => m.render?.());
  };

  {
    const _el = document.getElementById('btn-suprimento');
    if (_el) _el.onclick = () => window._fvAbrirSuprimento();
  }

  // Fechar Caixa
  {
    const _el = document.getElementById('btn-fechar-caixa');
    if (_el) _el.onclick = async () => {
      const registros = getCaixaRegistrosSync();
      const reg = registros.find(r => r.date === hoje && r.unit === unit && !r.fechamento);
      // Validacao: so quem abriu pode fechar
      if (reg) {
        const { podeFecharCaixa } = await import('../services/caixaGuard.js');
        const liberado = await podeFecharCaixa(S.user, reg);
        if (!liberado) return;
      }
      const PAGOS_F = ['Pago','Aprovado','Pago na Entrega'];
      const hoje_vendas = S.orders.filter(o => {
        const d = new Date(o.createdAt).toLocaleDateString('en-CA',{timeZone:'America/Manaus'});
        return d === hoje && o.unit === unit && o.status !== 'Cancelado' && PAGOS_F.includes(o.paymentStatus);
      });
      const totalVendas = hoje_vendas.reduce((s, o) => s + (o.total || 0), 0);

      // Dinheiro recebido por entregadores (não está no caixa ainda)
      const entregasDin = S.orders.filter(o => {
        const d = new Date(o.updatedAt||o.createdAt).toLocaleDateString('en-CA',{timeZone:'America/Manaus'});
        return d === hoje && o.unit === unit && o.status === 'Entregue' &&
               o.payment === 'Pagar na Entrega' && o.paymentOnDelivery === 'Dinheiro' &&
               o.paymentStatus === 'Pago na Entrega';
      });
      const dinPorDriver = {};
      entregasDin.forEach(o => {
        const drv = o.driverName || 'Sem entregador';
        if(!dinPorDriver[drv]) dinPorDriver[drv] = 0;
        dinPorDriver[drv] += (o.total||0);
      });
      const totalDinEntreg = Object.values(dinPorDriver).reduce((s,v) => s+v, 0);

      const saldoFundo = reg?.abertura?.saldo || 0;
      const sangrias = (reg?.movimentos || []).filter(m => m.tipo === 'Sangria').reduce((s, m) => s + m.valor, 0);
      const suprimentos = (reg?.movimentos || []).filter(m => m.tipo === 'Suprimento').reduce((s, m) => s + m.valor, 0);
      const saldoEsperado = saldoFundo + totalVendas - sangrias + suprimentos;

      S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:500px" onclick="event.stopPropagation()">
        <div class="mo-title">\uD83D\uDD12 Fechar Caixa \u2014 ${unit}</div>
        <div style="background:var(--cream);border-radius:var(--r);padding:14px;margin-bottom:14px;">
          ${[['Fundo de abertura', $c(saldoFundo), 'var(--muted)'],
             ['Vendas PDV (pagas)', $c(totalVendas), 'var(--leaf)'],
             ['Sangrias', '\u2212 ' + $c(sangrias), 'var(--red)'],
             ['Suprimentos', '+ ' + $c(suprimentos), 'var(--blue)'],
             ['Saldo esperado', $c(saldoEsperado), 'var(--rose)'],
          ].map(([l, v, c]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
            <span style="color:var(--muted)">${l}</span><span style="font-weight:700;color:${c}">${v}</span>
          </div>`).join('')}
        </div>

        ${totalDinEntreg > 0 ? `
        <div style="background:linear-gradient(135deg,#FFF7ED,#fff);border:2px solid #F97316;border-radius:12px;padding:12px 14px;margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-weight:700;color:#7C2D12;font-size:13px;">💵 Dinheiro com entregadores</span>
            <span style="background:#F97316;color:#fff;padding:2px 10px;border-radius:10px;font-weight:800;font-size:13px;">${$c(totalDinEntreg)}</span>
          </div>
          <div style="font-size:11px;color:#7C2D12;margin-bottom:8px;">Valores a recolher dos entregadores ao final do dia:</div>
          ${Object.entries(dinPorDriver).sort((a,b)=>b[1]-a[1]).map(([drv, val]) => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;">
            <span style="color:#78350F;">🚚 ${drv}</span>
            <strong style="color:#F97316;">${$c(val)}</strong>
          </div>`).join('')}
        </div>` : ''}

        <div class="fg"><label class="fl">Saldo Fisico Contado (R$) *</label>
          <input class="fi" id="cx-saldo" type="number" step="0.01" placeholder="0,00" value="${saldoEsperado.toFixed(2)}" style="font-size:20px;text-align:center;font-weight:700;"/>
          <div id="cx-diff" style="font-size:12px;margin-top:4px;text-align:center;"></div>
        </div>
        <div class="mo-foot">
          <button class="btn btn-red" id="btn-cx-confirm" style="flex:1;justify-content:center;padding:11px">\uD83D\uDD12 Confirmar Fechamento</button>
          <button class="btn btn-ghost" id="btn-mo-close">Cancelar</button>
        </div>
      </div></div>`;
      render();
      setTimeout(() => {
        document.getElementById('btn-mo-close')?.addEventListener('click', () => { S._modal = ''; render(); });
        document.getElementById('cx-saldo')?.addEventListener('input', e => {
          const contado = parseFloat(e.target.value) || 0;
          const diff = contado - saldoEsperado;
          const el = document.getElementById('cx-diff');
          if (el) el.innerHTML = `Diferenca: <strong style="color:${Math.abs(diff) < 0.01 ? 'var(--leaf)' : diff < 0 ? 'var(--red)' : 'var(--gold)'}">${diff >= 0 ? '+' : ''}${$c(diff)}</strong>`;
        });
        document.getElementById('btn-cx-confirm')?.addEventListener('click', async () => {
          const saldoFinal = parseFloat(document.getElementById('cx-saldo')?.value) || 0;
          if (!reg) { toast('\u274C Caixa nao encontrado'); S._modal = ''; render(); return; }
          const idx = registros.indexOf(reg);
          registros[idx].fechamento = {
            hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            usuario: S.user.name,
            saldoFinal,
            saldoEsperado,
            diferenca: saldoFinal - saldoEsperado
          };
          saveCaixaRegistrosSync(registros);
          try {
            await saveCaixaRegistro(registros[idx]);
            await syncCaixaFromBackend({ silent: true });
          } catch (e) {
            toast('\u26A0\uFE0F Caixa fechado localmente, falha ao sincronizar.', true);
          }
          toast('\uD83D\uDD12 Caixa encerrado com sucesso!');
          // Mostra modal pos-fechamento com botao "Gerar Recibo"
          const regFechado = registros[idx];
          S._modal = `<div class="mo" id="mo"><div class="mo-box" style="max-width:480px;text-align:center;" onclick="event.stopPropagation()">
            <div style="font-size:56px;margin-bottom:10px;">\u2705</div>
            <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:800;color:#15803D;margin-bottom:6px;">Caixa Fechado com Sucesso!</div>
            <div style="font-size:13px;color:var(--muted);margin-bottom:18px;line-height:1.5;">
              Fechamento registrado \u00E0s <strong>${regFechado.fechamento.hora}</strong><br>
              Saldo final: <strong>${$c(saldoFinal)}</strong><br>
              Diferen\u00E7a: <strong style="color:${Math.abs(regFechado.fechamento.diferenca) < 0.01 ? 'var(--leaf)' : regFechado.fechamento.diferenca < 0 ? 'var(--red)' : 'var(--gold)'}">${regFechado.fechamento.diferenca >= 0 ? '+' : ''}${$c(regFechado.fechamento.diferenca)}</strong>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              <button class="btn btn-primary" id="btn-gerar-recibo" style="padding:13px;font-weight:800;">\uD83D\uDDA8\uFE0F Gerar Recibo de Fechamento</button>
              <button class="btn btn-ghost" id="btn-mo-close-final">Fechar</button>
            </div>
          </div></div>`;
          render();
          setTimeout(() => {
            document.getElementById('btn-mo-close-final')?.addEventListener('click', () => { S._modal = ''; render(); });
            document.getElementById('btn-gerar-recibo')?.addEventListener('click', async () => {
              try {
                // Reusa a mesma funcao do relatorio admin (gerarReciboCaixa).
                // Antes da chamada, garante que o registro esta em S._relCaixaRegs
                // pra o gerador encontrar (funcao busca por id ou date+unit).
                if (!Array.isArray(S._relCaixaRegs)) S._relCaixaRegs = [];
                const jaTem = S._relCaixaRegs.some(r => (r._id||r.id) === (regFechado._id||regFechado.id) || (r.date === regFechado.date && r.unit === regFechado.unit));
                if (!jaTem) S._relCaixaRegs.push(regFechado);
                const { gerarReciboCaixa } = await import('./relatorios.js');
                gerarReciboCaixa({
                  id: regFechado._id || regFechado.id || '',
                  date: regFechado.date,
                  unit: regFechado.unit,
                });
              } catch(e) {
                toast('\u274C Erro ao gerar recibo: ' + (e.message || ''), true);
              }
            });
          }, 50);
        });
      }, 50);
    };
  }

  // Reimprimir
  {
    const _el = document.getElementById('btn-reimprimir-caixa');
    if (_el) _el.onclick = () => window.print();
  }
}
