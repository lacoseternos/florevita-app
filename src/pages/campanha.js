// ── CAMPANHA DE ESTRELAS — configuração (admin/gerente) ───────
// Marcia (out/2026): configura missões por setor, faixas de bonificação
// SEMANAL, penalidades, e ATIVA/DESLIGA a campanha. Enquanto desligada, as
// colaboradoras NÃO veem nada. Também mostra o ranking semanal (preview).
import { GET, PUT, POST, DELETE } from '../services/api.js';
import { toast } from '../utils/helpers.js';
import { $c } from '../utils/formatters.js';

let _data = null;       // { config, catalogo, tiposPenalidade, colabs }
let _ranking = null;    // { ativa, ranking:[] }
let _loading = false;

async function _render() { const m = await import('../main.js'); m.render(); }

async function loadCampanha() {
  _loading = true;
  try {
    const [cfg, rk] = await Promise.all([
      GET('/campanha/config').catch(() => null),
      GET('/campanha/ranking').catch(() => null),
    ]);
    _data = cfg; _ranking = rk;
  } catch (_) { /* mantém */ }
  _loading = false;
}

const SETOR_LABEL = { vendas: '🛍️ Vendas', expedicao: '📦 Expedição', producao: '🌸 Produção' };

export function renderCampanha() {
  if (!_data && !_loading) { loadCampanha().then(() => _render()); }
  if (!_data) {
    return `<div class="card"><div class="card-title">🏆 Campanha de Estrelas</div>
      <div style="text-align:center;padding:30px;color:var(--muted);">⏳ Carregando…</div></div>`;
  }
  const cfg = _data.config || {};
  const cat = _data.catalogo || [];
  const pen = cfg.penalidades || { falta: 10, advertencia: 15, atraso: 2 };
  const faixas = [...(cfg.faixas || [])].sort((a, b) => a.estrelas - b.estrelas);

  const setores = ['vendas', 'expedicao', 'producao'];
  const missoesHTML = setores.map(s => {
    const linhas = cat.filter(m => m.setor === s).map(m => {
      const ov = (cfg.missoes || {})[m.key] || {};
      const ativa = ov.ativa === true;
      const alvo = ov.alvo != null ? ov.alvo : m.alvoPadrao;
      const estr = ov.estrelas != null ? ov.estrelas : m.estrelasPadrao;
      return `<tr data-mkey="${m.key}" style="border-bottom:1px solid #F1F5F9;">
        <td style="padding:7px 6px;"><label style="display:flex;align-items:center;gap:7px;cursor:pointer;">
          <input type="checkbox" class="cmp-m-ativa" ${ativa ? 'checked' : ''} style="width:16px;height:16px;accent-color:#059669;"/>
          <span style="font-size:12.5px;">${m.icon} ${m.label}</span>
          <span style="font-size:9px;color:#94A3B8;background:#F1F5F9;border-radius:5px;padding:1px 5px;">${m.freq === 'dia' ? 'por dia' : 'na semana'}</span>
        </label></td>
        <td style="padding:7px 6px;text-align:right;white-space:nowrap;">
          <input class="cmp-m-alvo fi" type="number" min="0" step="1" value="${alvo}" style="width:80px;text-align:right;display:inline-block;"/> ${m.money ? 'R$' : ''}
        </td>
        <td style="padding:7px 6px;text-align:right;white-space:nowrap;">
          <input class="cmp-m-estr fi" type="number" min="0" step="1" value="${estr}" style="width:60px;text-align:right;display:inline-block;"/> ⭐
        </td>
      </tr>`;
    }).join('');
    return `<div style="margin-bottom:14px;">
      <div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:4px;">${SETOR_LABEL[s]}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#FAFAFA;color:#94A3B8;font-size:10px;text-transform:uppercase;">
          <th style="text-align:left;padding:6px;">Missão</th><th style="text-align:right;padding:6px;">Alvo</th><th style="text-align:right;padding:6px;">Estrelas</th>
        </tr></thead><tbody>${linhas}</tbody>
      </table>
    </div>`;
  }).join('');

  const faixasHTML = faixas.map((f, i) => `<div class="cmp-faixa" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
    <input class="cmp-fx-estr fi" type="number" min="1" value="${f.estrelas}" style="width:90px;"/> <span style="font-size:12px;">⭐ =</span>
    <input class="cmp-fx-bonus fi" type="number" min="0" step="0.01" value="${f.bonus}" style="width:110px;"/> <span style="font-size:12px;">R$</span>
    <button type="button" onclick="this.closest('.cmp-faixa').remove()" style="background:#FEE2E2;color:#991B1B;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">✕</button>
  </div>`).join('');

  const rk = _ranking?.ranking || [];
  const rankingHTML = rk.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead><tr style="background:#FAFAFA;color:#94A3B8;font-size:10px;text-transform:uppercase;">
      <th style="text-align:left;padding:6px;">#</th><th style="text-align:left;padding:6px;">Colaboradora</th>
      <th style="text-align:right;padding:6px;">Estrelas</th><th style="text-align:right;padding:6px;">Penal.</th><th style="text-align:right;padding:6px;">Bônus projetado</th>
    </tr></thead><tbody>
    ${rk.map((p, i) => `<tr style="border-bottom:1px solid #F1F5F9;">
      <td style="padding:7px 6px;">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1)}</td>
      <td style="padding:7px 6px;font-weight:700;">${p.nome}</td>
      <td style="padding:7px 6px;text-align:right;font-weight:900;color:#B45309;">${p.estrelas} ⭐</td>
      <td style="padding:7px 6px;text-align:right;color:#B91C1C;">${p.penalidadeEstrelas ? '−' + p.penalidadeEstrelas : '—'}</td>
      <td style="padding:7px 6px;text-align:right;font-weight:800;color:#15803D;">${$c(p.bonus || 0)}</td>
    </tr>`).join('')}
  </tbody></table>` : `<div style="text-align:center;color:var(--muted);padding:18px;font-size:12px;">Sem estrelas nesta semana ainda (ou nenhuma missão ativada).</div>`;

  const ativa = cfg.ativa === true;

  return `
  <div class="card" style="margin-bottom:14px;background:${ativa ? 'linear-gradient(135deg,#FEF9C3,#FEF3C7)' : 'linear-gradient(135deg,#F1F5F9,#fff)'};border:1.5px solid ${ativa ? '#F59E0B' : '#CBD5E1'};">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
      <div>
        <div class="card-title" style="margin:0;">⭐ Programa Estrelas <span style="font-size:11px;color:var(--muted);font-weight:400;">· bonificação SEMANAL</span></div>
        <div style="font-size:12px;color:${ativa ? '#92400E' : '#64748B'};font-weight:700;margin-top:3px;">
          ${ativa ? '🟢 ATIVA — aparece para as colaboradoras' : '⚪ DESLIGADA — ninguém além de vocês vê (modo configuração)'}
        </div>
      </div>
      <button type="button" onclick="campanhaToggleAtiva()" style="background:${ativa ? '#DC2626' : '#059669'};color:#fff;border:none;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer;font-size:13px;white-space:nowrap;">
        ${ativa ? '⏸️ Desativar' : '▶️ Ativar'}
      </button>
    </div>
  </div>

  <div class="g2" style="gap:14px;align-items:start;">
    <div class="card">
      <div class="card-title">🎯 Missões por setor</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Marque as missões ativas, ajuste o alvo e quantas ⭐ cada uma vale.</div>
      ${missoesHTML}
    </div>

    <div>
      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">💰 Faixas de bonificação (semana)</div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Ao fim da semana, a soma de estrelas cai na maior faixa atingida.</div>
        <div id="cmp-faixas">${faixasHTML}</div>
        <button type="button" onclick="campanhaAddFaixa()" style="background:#F0FDF4;border:1.5px dashed #86EFAC;color:#166534;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;margin-top:4px;">+ faixa</button>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <div class="card-title">⚠️ Penalidades (estrelas perdidas)</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">Falta <span><input id="cmp-pen-falta" class="fi" type="number" min="0" value="${pen.falta}" style="width:80px;text-align:right;"/> ⭐</span></label>
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">Advertência <span><input id="cmp-pen-adv" class="fi" type="number" min="0" value="${pen.advertencia}" style="width:80px;text-align:right;"/> ⭐</span></label>
          <label style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">Atraso <span><input id="cmp-pen-atraso" class="fi" type="number" min="0" value="${pen.atraso}" style="width:80px;text-align:right;"/> ⭐</span></label>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:8px;">Registre as penalidades da semana embaixo (por enquanto no manual; depois ligo o automático do Ponto).</div>
      </div>

      <button type="button" onclick="campanhaSalvar()" class="btn btn-primary" style="width:100%;justify-content:center;padding:12px;font-size:14px;">💾 Salvar configuração</button>
    </div>
  </div>

  <div class="card" style="margin-top:14px;">
    <div class="card-title">🏅 Ranking da semana (preview) <span style="font-size:11px;color:var(--muted);font-weight:400;">· ${_ranking?.weekKey ? 'semana de ' + _ranking.weekKey.split('-').reverse().slice(0,2).join('/') : ''}</span></div>
    ${rankingHTML}
  </div>

  ${_renderPenalidades(cfg)}
  `;
}

function _renderPenalidades(cfg) {
  const colabs = _data?.colabs || [];
  const log = [...(cfg.penalidadesLog || [])].reverse().slice(0, 30);
  return `<div class="card" style="margin-top:14px;">
    <div class="card-title">⚠️ Lançar penalidade</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;">
      <div class="fg" style="margin:0;"><label class="fl">Colaboradora</label>
        <select class="fi" id="cmp-pen-colab">${colabs.map(c => `<option value="${c.id}" data-nome="${c.nome.replace(/"/g,'&quot;')}">${c.nome}</option>`).join('')}</select>
      </div>
      <div class="fg" style="margin:0;"><label class="fl">Tipo</label>
        <select class="fi" id="cmp-pen-tipo"><option value="falta">Falta</option><option value="advertencia">Advertência</option><option value="atraso">Atraso</option></select>
      </div>
      <div class="fg" style="margin:0;"><label class="fl">Data</label><input class="fi" type="date" id="cmp-pen-data"/></div>
      <div class="fg" style="margin:0;"><label class="fl">Motivo (opcional)</label><input class="fi" id="cmp-pen-motivo" placeholder="Ex.: faltou sem avisar"/></div>
      <button type="button" onclick="campanhaAddPenalidade()" class="btn btn-ghost" style="border:1.5px solid #DC2626;color:#991B1B;">− Descontar estrelas</button>
    </div>
    ${log.length ? `<table style="width:100%;border-collapse:collapse;font-size:12px;"><tbody>
      ${log.map(p => `<tr style="border-bottom:1px solid #F1F5F9;">
        <td style="padding:6px;">${(p.data || '').split('-').reverse().slice(0,2).join('/')}</td>
        <td style="padding:6px;font-weight:600;">${p.colabNome || ''}</td>
        <td style="padding:6px;">${({falta:'Falta',advertencia:'Advertência',atraso:'Atraso'})[p.tipo] || p.tipo}</td>
        <td style="padding:6px;color:#B91C1C;font-weight:700;">−${p.estrelas} ⭐</td>
        <td style="padding:6px;color:#94A3B8;">${p.motivo || ''}</td>
        <td style="padding:6px;text-align:right;"><button type="button" onclick="campanhaDelPenalidade('${p.id}')" style="background:none;border:none;color:#B91C1C;cursor:pointer;">✕</button></td>
      </tr>`).join('')}
    </tbody></table>` : '<div style="color:var(--muted);font-size:12px;padding:8px;">Nenhuma penalidade lançada nesta semana.</div>'}
  </div>`;
}

// Coleta a config atual da tela.
function _coletarConfig() {
  const missoes = {};
  document.querySelectorAll('tr[data-mkey]').forEach(tr => {
    missoes[tr.dataset.mkey] = {
      ativa: tr.querySelector('.cmp-m-ativa')?.checked === true,
      alvo: Number(tr.querySelector('.cmp-m-alvo')?.value) || 0,
      estrelas: Number(tr.querySelector('.cmp-m-estr')?.value) || 0,
    };
  });
  const faixas = [...document.querySelectorAll('.cmp-faixa')].map(d => ({
    estrelas: Number(d.querySelector('.cmp-fx-estr')?.value) || 0,
    bonus: Number(d.querySelector('.cmp-fx-bonus')?.value) || 0,
  })).filter(f => f.estrelas > 0);
  const penalidades = {
    falta: Number(document.getElementById('cmp-pen-falta')?.value) || 0,
    advertencia: Number(document.getElementById('cmp-pen-adv')?.value) || 0,
    atraso: Number(document.getElementById('cmp-pen-atraso')?.value) || 0,
  };
  return { missoes, faixas, penalidades };
}

async function _salvar(patch, msg) {
  try {
    const r = await PUT('/campanha/config', patch);
    if (r?.config) _data.config = r.config;
    toast(msg || '✅ Salvo!');
    await loadCampanha(); await _render();
  } catch (e) { toast('❌ Erro ao salvar: ' + (e.message || ''), true); }
}

window.campanhaSalvar = () => _salvar(_coletarConfig(), '💾 Configuração salva!');
window.campanhaToggleAtiva = async () => {
  const novo = !(_data?.config?.ativa === true);
  if (novo && !confirm('Ativar a campanha? A partir de agora ela VAI APARECER para as colaboradoras.')) return;
  await _salvar({ ..._coletarConfig(), ativa: novo }, novo ? '🟢 Campanha ativada!' : '⏸️ Campanha desligada.');
};
window.campanhaAddFaixa = () => {
  const box = document.getElementById('cmp-faixas');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'cmp-faixa';
  div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
  div.innerHTML = `<input class="cmp-fx-estr fi" type="number" min="1" value="0" style="width:90px;"/> <span style="font-size:12px;">⭐ =</span>
    <input class="cmp-fx-bonus fi" type="number" min="0" step="0.01" value="0" style="width:110px;"/> <span style="font-size:12px;">R$</span>
    <button type="button" onclick="this.closest('.cmp-faixa').remove()" style="background:#FEE2E2;color:#991B1B;border:none;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;">✕</button>`;
  box.appendChild(div);
};
window.campanhaAddPenalidade = async () => {
  const sel = document.getElementById('cmp-pen-colab');
  const colabId = sel?.value;
  const colabNome = sel?.selectedOptions?.[0]?.dataset?.nome || '';
  const tipo = document.getElementById('cmp-pen-tipo')?.value;
  const data = document.getElementById('cmp-pen-data')?.value || '';
  const motivo = document.getElementById('cmp-pen-motivo')?.value || '';
  if (!colabId) return toast('Escolha a colaboradora', true);
  try {
    await POST('/campanha/penalidade', { colabId, colabNome, tipo, data, motivo });
    toast('⚠️ Penalidade registrada.');
    await loadCampanha(); await _render();
  } catch (e) { toast('❌ ' + (e.message || 'erro'), true); }
};
window.campanhaDelPenalidade = async (id) => {
  try { await DELETE('/campanha/penalidade/' + id); await loadCampanha(); await _render(); toast('Removida.'); }
  catch (e) { toast('❌ ' + (e.message || 'erro'), true); }
};
