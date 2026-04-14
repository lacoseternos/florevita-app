// ── MASCARAS DE INPUT ─────────────────────────────────────────

// Telefone: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
export function maskPhone(value){
  const d = String(value||'').replace(/\D/g,'').slice(0,11);
  if(d.length <= 2) return d;
  if(d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if(d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

// CPF: XXX.XXX.XXX-XX
export function maskCPF(value){
  const d = String(value||'').replace(/\D/g,'').slice(0,11);
  if(d.length <= 3) return d;
  if(d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
  if(d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

// CEP: XXXXX-XXX
export function maskCEP(value){
  const d = String(value||'').replace(/\D/g,'').slice(0,8);
  if(d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

// Moeda: R$ X.XXX,XX
export function maskCurrency(value){
  // Remove tudo que nao e digito
  const d = String(value||'').replace(/\D/g,'');
  if(!d) return '';
  // Converte para centavos e formata
  const num = parseInt(d, 10) / 100;
  return num.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
