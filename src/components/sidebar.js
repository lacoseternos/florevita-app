import { S } from '../state.js';
import { can } from '../services/auth.js';
import { ini } from '../utils/formatters.js';

export function renderSidebar(navExterno){
  // Se o main.js já passou um nav filtrado, usa ele (fonte única de verdade).
  // Caso contrário, cai no fallback antigo (retrocompatibilidade).
  const nav = Array.isArray(navExterno) ? navExterno : [
    {k:'dashboard',l:'Dashboard',i:'📊',m:'dashboard',s:'Principal'},
    {k:'pdv',l:'PDV (Vendas)',i:'🛒',m:'pdv',s:'Principal'},
    {k:'caixa',l:'Caixa',i:'💵',m:'caixa',s:'Principal'},
    {k:'pedidos',l:'Pedidos',i:'📋',m:'orders',s:'Principal'},
    {k:'clientes',l:'Clientes',i:'👥',m:'clients',s:'Gestão'},
    {k:'produtos',l:'Produtos',i:'🌹',m:'products',s:'Gestão'},
    {k:'categorias',l:'Categorias',i:'🏷️',m:'products',s:'Gestão'},
    {k:'estoque',l:'Estoque',i:'📦',m:'stock',s:'Gestão'},
    {k:'producao',l:'Produção',i:'🌿',m:'production',s:'Operação'},
    {k:'expedicao',l:'Expedição',i:'📤',m:'delivery',s:'Operação',hide:['Entregador']},
    {k:'ponto',l:'Ponto Eletrônico',i:'🕐',m:'ponto',s:'Operação'},
    {k:'financeiro',l:'Financeiro',i:'💰',m:'financial',s:'Financeiro'},
    {k:'notasFiscais',l:'Notas Fiscais',i:'🧾',m:'financial',s:'Financeiro'},
    {k:'relatorios',l:'Relatórios',i:'📈',m:'reports',s:'Financeiro'},
    {k:'alertas',l:'Notificações',i:'🔔',m:'__public__',s:'Sistema'},
    {k:'whatsapp',l:'WhatsApp',i:'💬',m:'whatsapp',s:'Sistema'},
    {k:'usuarios',l:'Usuários',i:'👤',m:'users',s:'Config'},
    {k:'colaboradores',l:'Colaboradores',i:'👥',m:'users',s:'Config'},
    {k:'impressao',l:'Impressão',i:'🖨️',m:'impressao',s:'Config'},
    {k:'backup',l:'Backup',i:'💾',m:'backup',s:'Config'},
    {k:'config',l:'Configurações',i:'⚙️',m:'config',s:'Config'},
    {k:'ecommerce',l:'E-commerce',i:'🛒',m:'ecommerce',s:'E-commerce'},
    {k:'etiquetas',l:'Etiquetas',i:'🏷️',m:'etiquetas',s:'Gestão'},
  ].filter(n => (n.m === '__public__' || can(n.m)) && !(n.hide||[]).includes(S.user?.role));

  let lastS='';
  const navHtml = nav.map(n=>{
    let sh='';
    if(n.s!==lastS){lastS=n.s;sh=`<div class="sb-sec">${n.s}</div>`;}
    return `${sh}<div class="sb-item ${S.page===n.k?'active':''}" data-page="${n.k}"><span class="sb-icon">${n.i}</span><span class="sb-label">${n.l}</span></div>`;
  }).join('');

  return`
${S.sidebarOpen?`<div style="position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99" id="sb-overlay"></div>`:''}
<div class="sb always-open ${S.sidebarOpen?'open':''} ${S.sidebarCollapsed?'collapsed':''}">
  <button id="btn-sidebar-toggle" title="${S.sidebarCollapsed?'Expandir':'Recolher'}" style="position:absolute;top:10px;right:-12px;width:24px;height:24px;border-radius:50%;border:1px solid rgba(232,145,122,.4);background:#0D0D0D;color:#E8917A;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:101;padding:0;line-height:1;">${S.sidebarCollapsed?'▶':'◀'}</button>
  <div class="sb-logo">
    <div style="display:flex;align-items:center;gap:10px;">
<img src="/logo-sidebar.jpg" alt="Laços Eternos" style="width:80px;height:80px;object-fit:contain;border-radius:50%;"/>
      <div>
        <div class="unit-badge" style="margin-top:2px">${S.user.unit||'—'}</div>
      </div>
    </div>
  </div>
  <div class="sb-nav-scroll" style="flex:1;overflow-y:auto;overflow-x:hidden;padding-bottom:8px;scrollbar-width:none;-ms-overflow-style:none;">${navHtml}</div>
  <div class="sb-foot">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <div class="av">${ini(S.user.name)}</div>
      <div><div style="font-size:12px;color:#F5C0B5;font-weight:500">${S.user.name?.split(' ')[0]}</div><div style="font-size:10px;color:rgba(232,145,122,.5)">${S.user.role}</div></div>
    </div>
    ${(S.user?.role==='Administrador' || String(S.user?.cargo||'').toLowerCase()==='admin') ? `<button id="btn-change-pass" style="width:100%;justify-content:center;background:rgba(232,145,122,.05);color:#F5C0B5;border:1px solid rgba(232,145,122,.2);border-radius:8px;padding:7px;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif;margin-bottom:6px;">🔒 Alterar minha senha</button>` : ''}
    <!-- Marcia (12/jun/2026): botao Sair + botao Sair de TODOS dispositivos
         lado a lado. Pequeno e discreto. Disponivel admin + gerente. -->
    ${(() => {
      const cargo = String(S.user?.cargo||'').toLowerCase();
      const role = String(S.user?.role||'').toLowerCase();
      const podeLogoutAll = cargo === 'admin' || cargo === 'gerente'
        || role === 'administrador' || role === 'gerente';
      if (podeLogoutAll) {
        return `<div style="display:flex;gap:4px;">
          <button id="btn-logout" style="flex:1;justify-content:center;background:rgba(232,145,122,.1);color:#E8917A;border:1px solid rgba(232,145,122,.3);border-radius:8px;padding:8px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Sair →</button>
          <button id="btn-logout-all" title="Desconectar de TODOS dispositivos (precisa logar novamente em todos eles)" style="background:rgba(232,145,122,.05);color:#E8917A;border:1px solid rgba(232,145,122,.3);border-radius:8px;padding:8px 10px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;" aria-label="Sair de todos dispositivos">🔐</button>
        </div>`;
      }
      return `<button id="btn-logout" style="width:100%;justify-content:center;background:rgba(232,145,122,.1);color:#E8917A;border:1px solid rgba(232,145,122,.3);border-radius:8px;padding:8px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;">Sair →</button>`;
    })()}
  </div>
</div>`;
}
