// ── FONTE ÚNICA do cálculo de horas do ponto eletrônico ──────────────
// Usada por Ponto, RH (Relatório de Horas), Relatórios e Meu Painel para
// garantir que o número de HORAS TRABALHADAS seja idêntico nas 4 telas
// (proibido divergir — regra da Marcia).
//
// REGRA: só valem as horas efetivamente trabalhadas. Descontam-se AS DUAS
// pausas do dia:
//   1. Almoço          (saidaAlmoco  → voltaAlmoco)
//   2. Intervalo/lanche (saidaIntervalo → voltaIntervalo) — tarde, seg-sex
// Cada pausa só é descontada quando as DUAS batidas existem (saída e volta).
//
// Aceita tanto `entrada` quanto `chegada` como campo de início (os módulos
// usam nomes diferentes pro mesmo dado).

export function toMinPonto(hm) {
  if (!hm) return 0;
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Minutos LÍQUIDOS trabalhados no dia (0 se não tem entrada+saída).
export function minutosTrabalhados(r) {
  if (!r) return 0;
  const ent = r.entrada || r.chegada || '';
  const sai = r.saida || '';
  if (!ent || !sai) return 0;
  const total = toMinPonto(sai) - toMinPonto(ent);
  const almoco = (r.saidaAlmoco && r.voltaAlmoco)
    ? (toMinPonto(r.voltaAlmoco) - toMinPonto(r.saidaAlmoco)) : 0;
  const intervalo = (r.saidaIntervalo && r.voltaIntervalo)
    ? (toMinPonto(r.voltaIntervalo) - toMinPonto(r.saidaIntervalo)) : 0;
  const liq = total - almoco - intervalo;
  return liq > 0 ? liq : 0;
}

// Formata minutos como "8h05".
export function fmtHorasPonto(mins) {
  if (!mins || mins <= 0) return '0h00';
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}
