/**
 * Backend API bilan ishlash uchun yagona modul.
 * Barcha so'rovlar shu yerdan o'tadi: vaqt chegarasi, xatolarni o'zbek tilidagi
 * tushunarli xabarga aylantirish va FastAPI validatsiya xatolarini maydonlarga ajratish.
 */
import { CONFIG } from './config.js';
import { safeStorage } from './ui.js';

export class ApiError extends Error {
  constructor(message, { status = 0, details = null, network = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.network = network;
  }
}

export function extractMessage(data, status) {
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail) && data.detail.length) return 'Kiritilgan ma’lumotlarni tekshiring.';
    if (typeof data.message === 'string') return data.message;
  }
  if (status === 429) return 'Juda ko‘p so‘rov yuborildi. Bir necha daqiqadan so‘ng qayta urinib ko‘ring.';
  if (status === 404) return 'Ma’lumot topilmadi.';
  if (status >= 500) return 'Serverda xatolik yuz berdi. Birozdan so‘ng qayta urinib ko‘ring.';
  return 'So‘rovni bajarib bo‘lmadi.';
}

async function request(path, { method = 'GET', body, timeout = CONFIG.REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(CONFIG.API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    throw new ApiError(
      timedOut
        ? 'Server javob bermadi. Birozdan so‘ng qayta urinib ko‘ring.'
        : 'Server bilan aloqa o‘rnatilmadi. Internet aloqasini tekshiring.',
      { network: true },
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw new ApiError(extractMessage(data, response.status), { status: response.status, details: data });
  }

  return data;
}

/**
 * FastAPI 422 javobidan maydon xatolarini ajratib oladi.
 * @returns {Record<string, string>} { maydon_nomi: "xato matni" }
 */
export function getFieldErrors(error) {
  const result = {};
  const detail = error && error.details && error.details.detail;
  if (!Array.isArray(detail)) return result;

  for (const item of detail) {
    if (!item || !Array.isArray(item.loc)) continue;
    const field = item.loc[item.loc.length - 1];
    if (typeof field === 'string' && !result[field]) {
      result[field] = typeof item.msg === 'string' ? item.msg : 'Noto‘g‘ri qiymat';
    }
  }
  return result;
}

function toList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

/* --- Ommaviy sozlamalar (kesh bilan) --- */
let settingsPromise = null;

function getSettings() {
  if (settingsPromise) return settingsPromise;

  const cached = safeStorage.getJSON(CONFIG.STORAGE.SETTINGS);
  if (cached && cached.savedAt && Date.now() - cached.savedAt < CONFIG.SETTINGS_CACHE_TTL_MS) {
    settingsPromise = Promise.resolve(cached.data || {});
    return settingsPromise;
  }

  settingsPromise = request('/public/settings')
    .then((data) => {
      const settings = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      safeStorage.setJSON(CONFIG.STORAGE.SETTINGS, { savedAt: Date.now(), data: settings });
      return settings;
    })
    .catch((err) => {
      settingsPromise = null; // keyingi safar qayta urinib ko'radi
      throw err;
    });

  return settingsPromise;
}

export const api = {
  getSettings,
  getProducts: () => request('/public/products').then(toList),
  getProjects: () => request('/public/projects').then(toList),
  createOrder: (payload) => request('/public/orders', { method: 'POST', body: payload }),
  createCallback: (payload) => request('/public/callback-requests', { method: 'POST', body: payload }),
  geocode: (q) => request(`/public/geocode?q=${encodeURIComponent(q)}`),
  reverseGeocode: (lat, lon) => request(`/public/reverse-geocode?lat=${lat}&lon=${lon}`),
};
