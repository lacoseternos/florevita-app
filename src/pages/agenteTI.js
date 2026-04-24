// ── AGENTE DE TI — DIAGNOSTICO E SUGESTAO DE CORRECAO ─────
import { S } from '../state.js';
import { toast } from '../utils/helpers.js';

async function render(){ const { render:r } = await import('../main.js'); r(); }

// ── BASE DE CONHECIMENTO ─────────────────────────────────────
// Cada entrada tem: padroes (regex), titulo, passos de correcao,
// severidade e icone. Ao submeter descricao, avaliamos todas as
// entradas e mostramos a de maior score.
const KNOWLEDGE_BASE = [
  {
    id: 'produtos-nao-carregam',
    titulo: 'Produtos não aparecem / não carregam',
    patterns: [
      /produto.*n[aã]o.*carreg/i,
      /produto.*n[aã]o.*aparec/i,
      /cat[aá]logo.*vazio/i,
      /sem produto/i,
      /produto.*sum/i,
    ],
    icone: '🌹',
    severidade: 'media',
    passos: [
      '**1. Recarregue a página forçando limpar o cache:**\n   → Pressione **Ctrl+F5** (Windows) ou **Cmd+Shift+R** (Mac)',
      '**2. Verifique a conexão com a internet:**\n   → Olhe o ícone no canto superior direito (bolinha verde = OK)',
      '**3. Teste a conexão com o servidor:**\n   → Configurações → botão "Testar Conexão" deve mostrar ✅',
      '**4. Se persistir:** peça ao administrador para verificar o Cadastro de Produtos e os filtros de unidade',
    ],
  },
  {
    id: 'botao-nao-funciona',
    titulo: 'Botão não funciona / não responde ao clique',
    patterns: [
      /bot[aã]o.*n[aã]o.*funcion/i,
      /bot[aã]o.*n[aã]o.*clic/i,
      /n[aã]o.*abre.*bot/i,
      /clico.*n[aã]o.*aconte/i,
      /cadastrar.*n[aã]o/i,
      /salvar.*n[aã]o/i,
    ],
    icone: '🖱️',
    severidade: 'media',
    passos: [
      '**1. Atualize a página:** Pressione **Ctrl+F5** para pegar a última versão do sistema',
      '**2. Verifique se há algum campo obrigatório vazio** (marcado com asterisco \\*)',
      '**3. Abra o Console do navegador** (F12 → aba Console) para ver se aparece algum erro em vermelho',
      '**4. Tente em outro navegador:** Chrome, Edge ou Firefox',
      '**5. Se persistir:** me mande um print da tela + o que aparece no Console',
    ],
  },
  {
    id: 'pedido-nao-atualiza',
    titulo: 'Pedidos não atualizam / ficam desatualizados',
    patterns: [
      /pedido.*n[aã]o.*atualiz/i,
      /pedido.*desatualizad/i,
      /n[aã]o.*aparec.*pedido/i,
      /pedido.*sum/i,
      /n[aã]o.*vem.*pedido.*novo/i,
    ],
    icone: '📋',
    severidade: 'media',
    passos: [
      '**1. Clique no botão 🔄 Atualizar** no topo da tela de Pedidos',
      '**2. Força reload:** Ctrl+F5',
      '**3. Verifique a conexão:** bolinha verde = sincronizando automaticamente a cada 5s',
      '**4. Se você está em uma unidade específica** (ex: Allegro), só vê pedidos da sua unidade + deliveries. Outras unidades ficam ocultas.',
      '**5. Se persistir:** saia e entre novamente no sistema',
    ],
  },
  {
    id: 'login-senha',
    titulo: 'Não consigo entrar / senha não funciona',
    patterns: [
      /n[aã]o.*entr/i,
      /n[aã]o.*log/i,
      /senha.*erra/i,
      /acesso.*bloq/i,
      /n[aã]o.*aceita.*senha/i,
      /login.*n[aã]o/i,
    ],
    icone: '🔑',
    severidade: 'alta',
    passos: [
      '**1. Confira o e-mail** (com atenção aos espaços antes/depois)',
      '**2. Confira a senha:** caixa alta/baixa, símbolos',
      '**3. Após 5 tentativas erradas** o acesso é bloqueado por segurança',
      '**4. Se está bloqueada:** o administrador pode desbloquear em **Configurações → 🔒 Auditoria & Segurança**',
      '**5. Esqueceu a senha:** só o administrador pode resetar em **Colaboradores → editar seu cadastro → nova senha**',
    ],
  },
  {
    id: 'lentidao',
    titulo: 'Sistema lento / travando',
    patterns: [
      /lent/i,
      /demora/i,
      /travand/i,
      /travou/i,
      /n[aã]o.*carreg.*r[aá]pido/i,
      /est[aá].*pesado/i,
    ],
    icone: '🐢',
    severidade: 'baixa',
    passos: [
      '**1. Feche abas que não está usando** no navegador (libera memória)',
      '**2. Limpe o cache:** Ctrl+Shift+Del → marque "Imagens e arquivos em cache" → Limpar',
      '**3. Atualize a página:** Ctrl+F5',
      '**4. O servidor pode estar "acordando"** (plano grátis do Render). Aguarde 30s na primeira requisição do dia.',
      '**5. Verifique sua conexão de internet** — sistema precisa de conexão estável',
    ],
  },
  {
    id: 'impressao',
    titulo: 'Impressão de cartão/comanda não funciona',
    patterns: [
      /imprim.*n[aã]o/i,
      /impress[aã]o.*n[aã]o/i,
      /cart[aã]o.*n[aã]o.*sai/i,
      /comanda.*n[aã]o/i,
    ],
    icone: '🖨️',
    severidade: 'media',
    passos: [
      '**1. Permita popups** para este site (bloqueio de popup impede janela de impressão)',
      '**2. Verifique se impressora está ligada e conectada**',
      '**3. Ctrl+F5** para atualizar o sistema',
      '**4. Teste imprimir pelo atalho Ctrl+P** na página que abriu',
      '**5. Se persistir:** avise o admin para verificar as configurações de impressão no módulo Impressão',
    ],
  },
  {
    id: 'whatsapp',
    titulo: 'WhatsApp / notificação não abre',
    patterns: [
      /whatsapp.*n[aã]o/i,
      /wpp.*n[aã]o/i,
      /notifica.*n[aã]o/i,
      /mensagem.*n[aã]o.*envia/i,
    ],
    icone: '💬',
    severidade: 'baixa',
    passos: [
      '**1. Permita popups** para este site',
      '**2. Verifique se o WhatsApp Web está logado** em outra aba (navegador lembra da sessão)',
      '**3. O número do cliente está cadastrado?** Sem telefone, não abre WhatsApp',
      '**4. Tente no celular:** pode ser que o computador não tenha WhatsApp Desktop',
    ],
  },
  {
    id: 'nota-fiscal',
    titulo: 'Nota fiscal não emite / dá erro',
    patterns: [
      /nota.*n[aã]o.*emit/i,
      /nfc.*erro/i,
      /nf.*e.*erro/i,
      /sefaz/i,
      /fiscal.*n[aã]o/i,
    ],
    icone: '🧾',
    severidade: 'alta',
    passos: [
      '**1. Verifique se o pedido tem CPF ou CNPJ válido** (para NF-e é obrigatório CNPJ)',
      '**2. Confira o Ambiente** em Configurações → deve estar "Produção" para notas reais',
      '**3. O CSC está configurado?** (obrigatório para NFC-e)',
      '**4. Mensagem da SEFAZ:** se tem código específico, me avise (ex: Rejeição 724, 539...)',
      '**5. Aguarde alguns segundos:** às vezes a SEFAZ demora a responder',
    ],
  },
  {
    id: 'delivery',
    titulo: 'Delivery / entregador não vê entregas',
    patterns: [
      /entregador.*n[aã]o/i,
      /delivery.*n[aã]o.*aparec/i,
      /rota.*n[aã]o/i,
      /entrega.*n[aã]o.*aparec/i,
    ],
    icone: '🚚',
    severidade: 'media',
    passos: [
      '**1. Verifique se o pedido está com status "Saiu p/ entrega"** (só aparece no app do entregador nesse status)',
      '**2. Verifique se o pedido foi atribuído ao entregador correto** em Expedição',
      '**3. Entregador deve fazer login com o mesmo e-mail cadastrado em Colaboradores**',
      '**4. Clique em 🔄 no app do entregador** para forçar sincronização',
      '**5. Ctrl+F5 no navegador do entregador**',
    ],
  },
  {
    id: 'ponto',
    titulo: 'Ponto eletrônico não registra',
    patterns: [
      /ponto.*n[aã]o/i,
      /bater.*ponto/i,
      /sa[ií]da.*almo[cç]o.*n[aã]o/i,
      /entrada.*n[aã]o.*registr/i,
    ],
    icone: '🕐',
    severidade: 'media',
    passos: [
      '**1. Aguarde 1 segundo após clicar** — o sistema confirma a hora com o servidor',
      '**2. Se a hora registrada estiver errada**, o servidor corrige automaticamente (fuso de Manaus)',
      '**3. Verifique a sequência:** Entrada → Saída Almoço → Volta Almoço → Saída',
      '**4. Ctrl+F5** se a tela não atualizou',
      '**5. Se persistir:** me mostre o print do card do ponto',
    ],
  },
];

// Fallback quando nenhum padrao bate
const FALLBACK_GENERICO = {
  titulo: 'Diagnóstico geral',
  icone: '🔧',
  severidade: 'info',
  passos: [
    '**Passos gerais de troubleshooting:**',
    '**1. Atualize com Ctrl+F5** (limpa o cache desta página)',
    '**2. Verifique a conexão:** bolinha verde no topo direito',
    '**3. Feche e abra o navegador** novamente',
    '**4. Tente em outro navegador** (Chrome, Edge, Firefox)',
    '**5. Abra o Console (F12)** e veja se há erro em vermelho',
    '**6. Se persistir:** envie para o administrador:',
    '   • Descrição detalhada (o que você estava fazendo?)',
    '   • Print da tela',
    '   • Mensagem de erro (se houver)',
    '   • Hora aproximada em que aconteceu',
  ],
};

// ── AVALIADOR ────────────────────────────────────────────────
function diagnosticar(descricao) {
  if (!descricao || descricao.trim().length < 5) {
    return null;
  }
  const texto = descricao.trim();

  // Score cada entrada pela quantidade de patterns que batem
  const candidatos = KNOWLEDGE_BASE.map(entry => ({
    entry,
    score: entry.patterns.reduce((acc, rx) => acc + (rx.test(texto) ? 1 : 0), 0),
  })).filter(c => c.score > 0);

  if (candidatos.length === 0) return FALLBACK_GENERICO;

  // Retorna o de maior score
  candidatos.sort((a, b) => b.score - a.score);
  return candidatos[0].entry;
}

// ── HISTORICO LOCAL DE TICKETS ─────────────────────────────
// Salva as ultimas 20 consultas no localStorage para o admin revisar
const TK_KEY = 'fv_ti_tickets';

function getTickets() {
  try { return JSON.parse(localStorage.getItem(TK_KEY) || '[]'); }
  catch { return []; }
}

function saveTicket(descricao, diag) {
  try {
    const tickets = getTickets();
    tickets.unshift({
      id: Date.now() + '_' + Math.random().toString(36).slice(2,7),
      userId: S.user?._id || '',
      userName: S.user?.name || 'Anônimo',
      userRole: S.user?.role || '',
      descricao,
      diagnostico: diag?.titulo || 'Sem diagnóstico',
      severidade: diag?.severidade || 'info',
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(TK_KEY, JSON.stringify(tickets.slice(0, 20)));
  } catch(_){}
}

// ── RENDER ──────────────────────────────────────────────────
export function renderAgenteTI() {
  const ultimaDesc = S._tiDesc || '';
  const ultimoDiag = S._tiDiag;
  const isAdmin = S.user?.role === 'Administrador' || S.user?.cargo === 'admin';
  const tickets = isAdmin ? getTickets() : [];

  const sevColors = {
    baixa: { bg:'#DBEAFE', color:'#1E40AF', label:'🔵 Baixa' },
    media: { bg:'#FEF3C7', color:'#92400E', label:'🟡 Média' },
    alta:  { bg:'#FEE2E2', color:'#991B1B', label:'🔴 Alta' },
    info:  { bg:'#F3F4F6', color:'#374151', label:'ℹ️ Info' },
  };

  return `
<div class="card" style="background:linear-gradient(135deg,#EEF2FF,#fff);margin-bottom:14px;border-left:5px solid #4F46E5;">
  <div class="card-title" style="display:flex;align-items:center;gap:10px;">
    <span style="font-size:28px;">🤖</span>
    <div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;color:#4F46E5;">Agente de TI</div>
      <div style="font-size:11px;color:var(--muted);font-weight:normal;">Descreva o problema e receba instruções de correção imediatamente</div>
    </div>
  </div>
</div>

<div class="card" style="margin-bottom:14px;">
  <div class="card-title">📝 Descreva o problema</div>
  <textarea id="ti-desc" class="fi" rows="4" placeholder="Exemplos:
• Produtos não estão carregando
• Botão cadastrar cliente não funciona
• Pedidos não atualizam
• Não consigo imprimir cartão
• Sistema está muito lento..."
    style="width:100%;resize:vertical;font-family:inherit;padding:12px;border:2px solid var(--border);border-radius:10px;font-size:13px;min-height:100px;">${ultimaDesc}</textarea>

  <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:12px;flex-wrap:wrap;">
    <div style="font-size:11px;color:var(--muted);">
      💡 <strong>Dica:</strong> seja específico — "botão X não funciona" é melhor que "sistema quebrado"
    </div>
    <div style="display:flex;gap:6px;">
      <button class="btn btn-ghost btn-sm" id="btn-ti-clear">✕ Limpar</button>
      <button class="btn btn-primary" id="btn-ti-analyze" style="background:linear-gradient(135deg,#4F46E5,#7C3AED);padding:10px 20px;font-weight:700;">
        🔍 Analisar e Corrigir
      </button>
    </div>
  </div>
</div>

${ultimoDiag ? `
<div class="card" style="margin-bottom:14px;border-left:5px solid ${sevColors[ultimoDiag.severidade]?.color || '#4F46E5'};background:${sevColors[ultimoDiag.severidade]?.bg || '#F3F4F6'};">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
    <span style="font-size:32px;">${ultimoDiag.icone}</span>
    <div style="flex:1;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${sevColors[ultimoDiag.severidade]?.color};">Diagnóstico · ${sevColors[ultimoDiag.severidade]?.label || 'Info'}</div>
      <div style="font-size:16px;font-weight:800;color:var(--ink);">${ultimoDiag.titulo}</div>
    </div>
  </div>

  <div style="background:#fff;border-radius:10px;padding:16px;">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">✅ Passos de correção</div>
    ${ultimoDiag.passos.map(p => `
      <div style="padding:10px 12px;background:#F8FAFC;border-left:3px solid #4F46E5;border-radius:6px;margin-bottom:6px;font-size:12px;line-height:1.6;white-space:pre-line;">${p.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`(.+?)`/g,'<code style="background:#EDE9FE;padding:1px 5px;border-radius:3px;">$1</code>')}</div>
    `).join('')}
  </div>

  <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;flex-wrap:wrap;">
    <button class="btn btn-ghost btn-sm" id="btn-ti-reload">🔄 Recarregar sistema (Ctrl+F5)</button>
    <button class="btn btn-ghost btn-sm" id="btn-ti-new">✍️ Nova consulta</button>
    ${!isAdmin ? '<button class="btn btn-ghost btn-sm" id="btn-ti-whatsapp" style="color:#10B981;border-color:#10B981;">💬 Contactar Admin</button>' : ''}
  </div>
</div>
` : ''}

${isAdmin && tickets.length > 0 ? `
<div class="card">
  <div class="card-title">📋 Últimas consultas <span class="notif">${tickets.length}</span></div>
  <div style="display:flex;flex-direction:column;gap:8px;">
    ${tickets.slice(0, 10).map(t => `
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--cream);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:12px;">${t.userName} <span style="color:var(--muted);font-weight:normal;">· ${t.userRole}</span></div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px;">"${t.descricao.slice(0,120)}${t.descricao.length>120?'...':''}"</div>
          </div>
          <div style="text-align:right;font-size:10px;">
            <div style="color:var(--muted);">${new Date(t.createdAt).toLocaleString('pt-BR')}</div>
            <div style="margin-top:3px;color:${sevColors[t.severidade]?.color||'#374151'};font-weight:700;">${t.diagnostico}</div>
          </div>
        </div>
      </div>
    `).join('')}
  </div>
</div>
` : ''}
  `;
}

// ── BIND EVENTS ─────────────────────────────────────────────
export function bindAgenteTIEvents() {
  const textarea = document.getElementById('ti-desc');
  if (textarea) textarea.addEventListener('input', e => { S._tiDesc = e.target.value; });

  document.getElementById('btn-ti-analyze')?.addEventListener('click', () => {
    const desc = document.getElementById('ti-desc')?.value?.trim() || '';
    if (desc.length < 5) {
      toast('❌ Descreva o problema com mais detalhes (mínimo 5 caracteres)');
      return;
    }
    const diag = diagnosticar(desc);
    S._tiDesc = desc;
    S._tiDiag = diag;
    saveTicket(desc, diag);
    render();
    // Scroll suave para o resultado
    setTimeout(() => {
      const resultado = document.querySelector('.card[style*="border-left:5px solid"]:not(:first-child)');
      resultado?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  });

  document.getElementById('btn-ti-clear')?.addEventListener('click', () => {
    S._tiDesc = '';
    S._tiDiag = null;
    render();
  });

  document.getElementById('btn-ti-new')?.addEventListener('click', () => {
    S._tiDesc = '';
    S._tiDiag = null;
    render();
    setTimeout(() => document.getElementById('ti-desc')?.focus(), 100);
  });

  document.getElementById('btn-ti-reload')?.addEventListener('click', () => {
    toast('🔄 Recarregando...');
    setTimeout(() => window.location.reload(), 500);
  });

  document.getElementById('btn-ti-whatsapp')?.addEventListener('click', () => {
    const desc = S._tiDesc || '';
    const diag = S._tiDiag?.titulo || '';
    const msg = encodeURIComponent(
      `Olá! Preciso de ajuda no sistema Florevita:\n\n` +
      `📝 Problema: ${desc}\n` +
      `🔍 Diagnóstico do Agente: ${diag}\n\n` +
      `Usuário: ${S.user?.name || ''}\n` +
      `Horário: ${new Date().toLocaleString('pt-BR')}`
    );
    // Numero da administradora (configurar)
    const numero = '5592993002433'; // Marcia
    window.open(`https://wa.me/${numero}?text=${msg}`, '_blank');
  });
}
