import { APP_CONFIG } from '../config.js';

function parseSession(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    if (value.schemaVersion !== APP_CONFIG.schemaVersion) return null;
    if (!value.roomCode || !value.role || !value.seatToken) return null;
    return value;
  } catch {
    return null;
  }
}

export function makeSeatToken() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function loadSession() {
  return parseSession(window.localStorage.getItem(APP_CONFIG.sessionStorageKey));
}

export function saveSession(session) {
  const value = {
    schemaVersion: APP_CONFIG.schemaVersion,
    savedAt: Date.now(),
    ...session,
  };
  window.localStorage.setItem(APP_CONFIG.sessionStorageKey, JSON.stringify(value));
  return value;
}

export function clearSession() {
  window.localStorage.removeItem(APP_CONFIG.sessionStorageKey);
}
