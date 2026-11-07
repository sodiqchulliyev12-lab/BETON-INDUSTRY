/**
 * Admin API so'rovlari.
 *  - access token faqat xotirada (o'zgaruvchida) saqlanadi — localStorage'da emas
 *  - 401 kelsa, httpOnly cookie'dagi refresh token bilan bir marta yangilab, so'rov qaytariladi
 */
import { CONFIG } from '../config.js';
import { ApiError, extractMessage } from '../api.js';

let accessToken = null;
let refreshInFlight = null;
const unauthorizedListeners = new Set();

export function setAccessToken(token) {
  accessToken = token;
}

export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
}

async function rawFetch(path, { method = 'GET', body, formData, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  // FormData (fayl yuklash) uchun Content-Type'ni brauzer o'zi qo'yadi (boundary bilan)
  if (body !== undefined && !formData) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(CONFIG.API_BASE + path, {
      method,
      headers,
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
      credentials: 'include', // refresh cookie uchun
    });
  } catch {
    throw new ApiError('Server bilan aloqa o‘rnatilmadi.', { network: true });
  }

  let data = null;
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }
  return { response, data };
}

/** Refresh cookie orqali yangi access token olish. Bir vaqtda faqat bitta so'rov yuboriladi. */
export function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = rawFetch('/auth/refresh', { method: 'POST', auth: false })
      .then(({ response, data }) => {
        if (!response.ok || !data) {
          accessToken = null;
          return null;
        }
        accessToken = data.access_token;
        return data;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function http(path, options = {}) {
  let { response, data } = await rawFetch(path, options);

  if (response.status === 401 && options.auth !== false) {
    const refreshed = await refreshSession();
    if (refreshed) {
      ({ response, data } = await rawFetch(path, options));
    }
    if (response.status === 401) {
      unauthorizedListeners.forEach((listener) => listener());
      throw new ApiError('Sessiya tugagan. Qaytadan kiring.', { status: 401 });
    }
  }

  if (!response.ok) {
    throw new ApiError(extractMessage(data, response.status), { status: response.status, details: data });
  }
  return data;
}

/** {a: 1, b: '', c: null} → "?a=1" */
export function qs(params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}
