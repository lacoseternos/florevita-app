// ── CHAT CLIENT (Socket.IO) ──────────────────────────────────
// Camada que conecta no backend via WebSocket e expoe API simples
// pra o componente do chat (chatPanel.js).
import { io } from 'socket.io-client';
import { S } from '../state.js';

let socket = null;
const listeners = new Map(); // event -> Set<callback>

const API_BASE = (import.meta.env?.VITE_API_URL ||
                  localStorage.getItem('fv2_api_base') ||
                  'https://florevita-backend-2-0.onrender.com').replace(/\/api$/, '');

export function connectChat() {
  if (socket?.connected) return socket;
  if (!S.token) return null;
  socket = io(API_BASE, {
    auth: { token: S.token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
  });
  socket.on('connect', () => {
    console.log('[chat] conectado:', socket.id);
    _emit('connected', { id: socket.id });
  });
  socket.on('disconnect', (reason) => {
    console.log('[chat] desconectado:', reason);
    _emit('disconnected', { reason });
  });
  socket.on('connect_error', (err) => {
    console.warn('[chat] connect_error:', err.message);
    _emit('connect-error', { error: err.message });
  });
  // Forward de todos os eventos do backend pra os listeners locais
  ['chat:message','chat:read','chat:typing','chat:resolved','chat:unresolved',
   'chat:deleted','chat:pinned','chat:presence','chat:online-list','chat:joined',
   'chat:error'].forEach(ev => {
    socket.on(ev, (data) => _emit(ev, data));
  });
  return socket;
}

export function disconnectChat() {
  if (socket) { socket.disconnect(); socket = null; listeners.clear(); }
}

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}
function _emit(event, data) {
  listeners.get(event)?.forEach(cb => { try { cb(data); } catch(e){ console.warn(e); } });
}

// API
export function joinRoom(roomId) {
  socket?.emit('chat:join-room', { roomId });
}
export function leaveRoom(roomId) {
  socket?.emit('chat:leave-room', { roomId });
}
export function sendMessage({ roomId, text, urgent, replyTo, attachments }) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Não conectado'));
    socket.emit('chat:send', { roomId, text, urgent, replyTo, attachments }, (resp) => {
      if (resp?.error) reject(new Error(resp.error));
      else resolve(resp?.message);
    });
  });
}
export function markRead(messageIds) {
  if (!socket?.connected || !messageIds?.length) return;
  socket.emit('chat:read', { messageIds });
}
export function typing(roomId, isTyping) {
  if (!socket?.connected) return;
  socket.emit('chat:typing', { roomId, typing: isTyping });
}
export function isConnected() {
  return socket?.connected || false;
}
