/**
 * Frontend konfiguratsiyasi.
 *
 * API manzili quyidagi tartibda aniqlanadi:
 *  1. window.BETON_API_BASE (sahifada qo'lda berilgan bo'lsa)
 *  2. <meta name="api-base" content="..."> tegi
 *  3. Lokal ishlab chiqishda (localhost, 8000 bo'lmagan port) → http://<host>:8000/api/v1
 *  4. Aks holda → shu domendagi /api/v1 (FastAPI frontendni o'zi tarqatganda)
 */

function resolveApiBase() {
  if (typeof window.BETON_API_BASE === 'string' && window.BETON_API_BASE) {
    return window.BETON_API_BASE.replace(/\/$/, '');
  }

  const meta = document.querySelector('meta[name="api-base"]');
  if (meta && meta.content) {
    return meta.content.replace(/\/$/, '');
  }

  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

  if (protocol === 'file:') {
    return 'http://localhost:8000/api/v1';
  }

  if (isLocalHost && port !== '8000') {
    return `${protocol}//${hostname}:8000/api/v1`;
  }

  return '/api/v1';
}

export const CONFIG = Object.freeze({
  API_BASE: resolveApiBase(),
  REQUEST_TIMEOUT_MS: 15000,
  SETTINGS_CACHE_TTL_MS: 5 * 60 * 1000,
  // Modul joylashuviga nisbatan — /admin/ ichidagi sahifalardan ham to'g'ri ishlaydi
  ICON_SPRITE: new URL('../assets/icons/sprite.svg', import.meta.url).pathname,
  DEFAULT_CURRENCY: 'UZS',

  /** Beton hajmi chegaralari (m³). Yakuniy tekshiruv backendda ham bo'ladi. */
  VOLUME: Object.freeze({
    MIN: 0.5,
    MAX: 1000,
    STEP: 0.5,
  }),

  /** Xarita. Plitka manzilini o'zgartirsangiz, backend/app/main.py dagi CSP img-src ni ham yangilang. */
  MAP: Object.freeze({
    TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ATTRIBUTION: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    // Zavod joylashuvi kiritilmaganda — butun O'zbekiston ko'rinadi (bu zavod manzili EMAS)
    COUNTRY_VIEW: Object.freeze({ center: [41.4, 64.6], zoom: 6 }),
  }),

  /** sessionStorage kalitlari */
  STORAGE: Object.freeze({
    SETTINGS: 'beton.settings',
    CALC: 'beton.calc',
  }),
});
