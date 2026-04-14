// ── FORMATADORES ────────────────────────────────────────────
export const $c = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0);
export const $d = d => {
  if(!d) return '—';
  // Se for string YYYY-MM-DD, formata sem timezone (evita bug UTC em Manaus UTC-4)
  if(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)){
    const [y,m,day] = d.split('-');
    return `${day}/${m}/${y}`;
  }
  return new Date(d).toLocaleDateString('pt-BR');
};
export const ini = n => n ? n.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() : '?';

export const sc = s => ({
  'Entregue':        'tag-status tag-entregue',
  'Em preparo':      'tag-status tag-preparo',
  'Saiu p/ entrega': 'tag-status tag-rota',
  'Aguardando':      'tag-status tag-aguardando',
  'Cancelado':       'tag-status tag-cancelado',
  'Pago':            'tag-status tag-entregue',
  'Pendente':        'tag-status tag-preparo',
  'Pronto':          'tag-status tag-pronto',
  'Em Produção':     'tag-status tag-preparo',
  'Pagar na Entrega':'tag-status tag-rota',
}[s]||'tag-status tag-aguardando');

export const segc = s => ({'VIP':'t-rose','Recorrente':'t-green','Novo':'t-blue'}[s]||'t-gray');
export const rolec = r => ({'Administrador':'t-rose','Gerente':'t-purple','Atendimento':'t-blue','Producao':'t-green','Expedicao':'t-gold','Financeiro':'t-gray','Entregador':'t-blue'}[r]||'t-gray');
export const emoji = c => ({'Rosa':'🌹','Buquê':'💐','Orquídea':'🌸','Planta':'🌱','Kit':'🎁','Vaso':'🌿','Flor':'🌺','Coroa':'👑','Cesta':'🧺','Embalagem':'📦','Adicional':'✨'}[c]||'🌸');

// ── SANITIZAÇÃO ───────────────────────────────────────────────
export const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
