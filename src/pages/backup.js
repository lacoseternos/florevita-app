// ── BACKUP ───────────────────────────────────────────────────
import { S } from '../state.js';
import { $d } from '../utils/formatters.js';
import { toast } from '../utils/helpers.js';

// ── Helper: render() via dynamic import ───────────────────────
async function render(){
  const { render:r } = await import('../main.js');
  r();
}

// ── AUTO BACKUP TIMER ────────────────────────────────────────
let _backupTimer = null;

export function startAutoBackup(){
  stopAutoBackup();
  _backupTimer = setInterval(()=>doAutoBackup(), 2*60*60*1000); // 2 horas
}

export function stopAutoBackup(){
  if(_backupTimer){ clearInterval(_backupTimer); _backupTimer=null; }
}

export function doAutoBackup(){
  const data = {
    version:'1.0', timestamp:new Date().toISOString(), user:S.user?.name||'Sistema',
    fv_perms:       localStorage.getItem('fv_perms')||'{}',
    fv_user_extra:  localStorage.getItem('fv_user_extra')||'{}',
    fv_backend_enums:localStorage.getItem('fv_backend_enums')||'{}',
    fv_ponto:       localStorage.getItem('fv_ponto')||'[]',
    fv_caixa:       localStorage.getItem('fv_caixa')||'[]',
    fv_financial:   localStorage.getItem('fv_financial')||'[]',
    fv_activities:  localStorage.getItem('fv_activities')||'[]',
    fv_deliveries:  localStorage.getItem('fv_deliveries')||'{}',
    fv_config:      localStorage.getItem('fv_config')||'{}',
    fv_print_layout:localStorage.getItem('fv_print_layout')||'{}',
    fv_delivery_fees:localStorage.getItem('fv_delivery_fees')||'{}',
    fv_printed_card:localStorage.getItem('fv_printed_card')||'{}',
    fv_printed_comanda:localStorage.getItem('fv_printed_comanda')||'{}',
  };
  // Salva historico de backups
  const hist = JSON.parse(localStorage.getItem('fv_backup_hist')||'[]');
  hist.unshift({ts:data.timestamp, user:data.user, auto:true});
  if(hist.length>20) hist.length=20;
  localStorage.setItem('fv_backup_hist', JSON.stringify(hist));
  localStorage.setItem('fv_last_backup', JSON.stringify(data));
  return data;
}

export function downloadBackup(){
  const data = doAutoBackup();
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'lacos-eternos-backup-'+new Date().toISOString().slice(0,16).replace('T','_').replace(/:/g,'-')+'.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup baixado com sucesso!');
}

export function restoreBackup(json){
  try{
    const d = JSON.parse(json);
    if(!d.version) throw new Error('Arquivo invalido');
    Object.keys(d).forEach(k=>{
      if(k.startsWith('fv_')) localStorage.setItem(k, d[k]);
    });
    toast('Backup restaurado! Recarregue a pagina.');
    return true;
  }catch(e){
    toast('Erro ao restaurar: '+e.message);
    return false;
  }
}

export function renderBackup(){
  const hist = JSON.parse(localStorage.getItem('fv_backup_hist')||'[]');
  const lastBk = localStorage.getItem('fv_last_backup');
  const lastInfo = lastBk ? JSON.parse(lastBk) : null;
  return`
<div class="g2">
  <div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-title">Backup Automatico</div>
      <div class="alert al-info" style="margin-bottom:14px;">
        O sistema faz backup automatico a <strong>cada 2 horas</strong> enquanto estiver logado. O backup salva permissoes, ponto, caixa, configuracoes e movimentos.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div style="background:var(--cream);border-radius:var(--r);padding:14px;text-align:center;">
          <div style="font-size:28px;margin-bottom:6px;">&#128336;</div>
          <div style="font-size:11px;color:var(--muted)">Ultimo backup</div>
          <div style="font-size:13px;font-weight:700;margin-top:4px;">${lastInfo?new Date(lastInfo.timestamp).toLocaleString('pt-BR'):'Nenhum ainda'}</div>
        </div>
        <div style="background:var(--cream);border-radius:var(--r);padding:14px;text-align:center;">
          <div style="font-size:28px;margin-bottom:6px;">&#128230;</div>
          <div style="font-size:11px;color:var(--muted)">Total de backups</div>
          <div style="font-size:22px;font-weight:700;margin-top:4px;">${hist.length}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="btn-backup-now" style="flex:1;justify-content:center;">Fazer Backup Agora</button>
        <button class="btn btn-outline" id="btn-backup-download" style="flex:1;justify-content:center;">Baixar .JSON</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Restaurar Backup</div>
      <div class="alert al-warn" style="margin-bottom:12px;">Restaurar sobrescrevera todos os dados locais. Use somente em caso de perda de dados.</div>
      <div class="img-up" id="backup-drop" style="margin-bottom:10px;">
        <div style="font-size:28px;margin-bottom:8px">&#128194;</div>
        <div style="font-size:13px;font-weight:500">Clique para selecionar o arquivo .json de backup</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">Arquivo gerado por este sistema</div>
      </div>
      <input type="file" id="backup-file" accept=".json" style="display:none"/>
      <button class="btn btn-ghost btn-sm" id="btn-backup-restore" style="width:100%;justify-content:center;">Selecionar arquivo e restaurar</button>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Historico de Backups</div>
    ${hist.length===0?`<div class="empty"><div class="empty-icon">&#128203;</div><p>Nenhum backup realizado ainda</p></div>`:`
    <div class="tw"><table><thead><tr><th>Data / Hora</th><th>Usuario</th><th>Tipo</th></tr></thead><tbody>
    ${hist.map(h=>`<tr>
      <td>${new Date(h.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
      <td style="font-weight:500">${h.user}</td>
      <td><span class="tag ${h.auto?'t-blue':'t-green'}">${h.auto?'Auto':'Manual'}</span></td>
    </tr>`).join('')}
    </tbody></table></div>`}
</div>
</div>
<div class="card" style="border:2px solid var(--red);margin-top:14px;grid-column:1/-1;">
  <div class="card-title" style="color:var(--red)">Reset do Sistema</div>
  <p style="font-size:12px;color:var(--muted);margin-bottom:12px;">
    Apaga todos os dados (produtos, clientes, pedidos) e restaura o sistema ao estado inicial.<br>
    <strong>Apenas a administradora Marcia sera mantida.</strong>
  </p>
  <button class="btn" style="background:var(--red);color:#fff;border:none;cursor:pointer;" id="btn-show-reset">
    Resetar Sistema
  </button>
</div>
`;
}
