// ── 📷 FOTO DA ENTREGA → servidor (Marcia 26/out/2026) ──────────────────────
// Antes a foto e o "quem recebeu" ficavam só no celular do entregador
// (localStorage 'fv_deliveries') e ninguém via. Agora sobem pro servidor
// (POST /orders/:id/foto-entrega). Sem internet / erro: fica numa fila no
// aparelho ('fv_fotos_pendentes') e é reenviada depois, sozinha.
import { POST } from '../services/api.js';

const FILA = 'fv_fotos_pendentes';
const lerFila = () => { try { return JSON.parse(localStorage.getItem(FILA) || '[]') || []; } catch (_) { return []; } };
const gravarFila = (f) => { try { localStorage.setItem(FILA, JSON.stringify(f.slice(-20))); } catch (_) { /* aparelho cheio */ } };

// Miniatura (galeria) a partir da foto já reduzida.
export function gerarMiniatura(dataUrl, max = 320) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > h && w > max) { h = Math.round(h * max / w); w = max; } else if (h >= w && h > max) { w = Math.round(w * max / h); h = max; }
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.6));
        } catch (_) { resolve(''); }
      };
      img.onerror = () => resolve('');
      img.src = dataUrl;
    } catch (_) { resolve(''); }
  });
}

// Envia; se falhar, guarda na fila. Devolve true se subiu agora.
export async function enviarFotoEntrega(orderId, { foto = '', miniatura = '', recebidoPor = '' } = {}) {
  if (!orderId || (!foto && !recebidoPor)) return true;
  try {
    await POST('/orders/' + orderId + '/foto-entrega', { foto: foto || undefined, miniatura: miniatura || undefined, recebidoPor });
    return true;
  } catch (e) {
    console.warn('[fotoEntrega] envio falhou, vai pra fila:', e?.message);
    const f = lerFila().filter(x => x.orderId !== orderId);
    f.push({ orderId, foto, miniatura, recebidoPor, em: Date.now() });
    gravarFila(f);
    return false;
  }
}

// Tenta reenviar o que ficou na fila (chamado ao abrir telas do entregador/expedição).
let _reenviando = false;
export async function reenviarFotosPendentes() {
  if (_reenviando) return;
  const f = lerFila();
  if (!f.length) return;
  _reenviando = true;
  const resto = [];
  for (const x of f) {
    try { await POST('/orders/' + x.orderId + '/foto-entrega', { foto: x.foto || undefined, miniatura: x.miniatura || undefined, recebidoPor: x.recebidoPor }); }
    catch (e) {
      // Pedido apagado / foto recusada: não adianta tentar pra sempre.
      if (!/404|400|413|não encontrado|inválida|grande/i.test(String(e?.message || '')) && Date.now() - (x.em || 0) < 7 * 864e5) resto.push(x);
    }
  }
  gravarFila(resto);
  _reenviando = false;
}
