/** Admin sessiyasi: kirish, sessiyani tiklash, chiqish va ruxsatlarni tekshirish. */
import { http, refreshSession, setAccessToken } from './http.js';

let currentUser = null;

export const session = {
  get user() {
    return currentUser;
  },
  can(permission) {
    return Boolean(currentUser && currentUser.permissions.includes(permission));
  },
};

export async function login(username, password) {
  const data = await http('/auth/login', { method: 'POST', body: { username, password }, auth: false });
  setAccessToken(data.access_token);
  currentUser = data.user;
  return currentUser;
}

/** Sahifa yangilanganda: refresh cookie bo'lsa, qayta kirmasdan davom etadi. */
export async function restoreSession() {
  const data = await refreshSession();
  currentUser = data ? data.user : null;
  return currentUser;
}

export async function logout() {
  try {
    await http('/auth/logout', { method: 'POST', auth: false });
  } catch {
    /* server javob bermasa ham lokal sessiya tozalanadi */
  }
  setAccessToken(null);
  currentUser = null;
}

export function clearSession() {
  setAccessToken(null);
  currentUser = null;
}
