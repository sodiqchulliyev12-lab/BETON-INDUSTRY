/**
 * UI yordamchilari: formatlash, xavfsiz HTML, toast, modal, holat bloklari.
 */
import { CONFIG } from './config.js';

/* ==========================================================================
   Xavfsizlik
   ========================================================================== */

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Foydalanuvchi yoki API ma'lumotini HTML ichiga xavfsiz qo'yish. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** Faqat nisbiy yoki http(s) havolalarga ruxsat beradi (javascript: va h.k. bloklanadi). */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function icon(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="${CONFIG.ICON_SPRITE}#${name}"></use></svg>`;
}

/* ==========================================================================
   Formatlash
   ========================================================================== */

const NBSP = ' ';

/** 1234567.5 → "1 234 567,5" */
export function formatNumber(value, maxDigits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const fixed = num.toFixed(maxDigits);
  let [intPart, fracPart = ''] = fixed.split('.');
  const negative = intPart.startsWith('-');
  if (negative) intPart = intPart.slice(1);
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  fracPart = fracPart.replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${fracPart ? `,${fracPart}` : ''}`;
}

export function formatMoney(value, currency = CONFIG.DEFAULT_CURRENCY) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const text = formatNumber(Math.round(num), 0);
  return currency === 'UZS' ? `${text}${NBSP}so‘m` : `${text}${NBSP}${currency}`;
}

export function formatVolume(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `${formatNumber(value, 2)}${NBSP}m³`;
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** "2026-11-07" → "7-noyabr, 2026" */
export function formatDate(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const [, y, m, d] = match;
  const month = MONTHS[Number(m) - 1];
  return month ? `${Number(d)}-${month}, ${y}` : String(value);
}

/* ==========================================================================
   Xavfsiz brauzer xotirasi (shaxsiy rejimda xato bermasligi uchun)
   ========================================================================== */

export const safeStorage = {
  get(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* xotira mavjud emas — e'tiborsiz qoldiramiz */
    }
  },
  remove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* e'tiborsiz */
    }
  },
  getJSON(key) {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  setJSON(key, value) {
    try {
      this.set(key, JSON.stringify(value));
    } catch {
      /* e'tiborsiz */
    }
  },
};

/* ==========================================================================
   Toast xabarlari
   ========================================================================== */

let toastRegion = null;

function getToastRegion() {
  if (toastRegion && document.body.contains(toastRegion)) return toastRegion;
  toastRegion = document.createElement('div');
  toastRegion.className = 'toast-region';
  toastRegion.setAttribute('role', 'status');
  toastRegion.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastRegion);
  return toastRegion;
}

/**
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} type
 */
export function toast(message, type = 'info', timeout = 6000) {
  const region = getToastRegion();
  const item = document.createElement('div');
  item.className = `toast toast--${type}`;
  item.innerHTML = `<div class="toast__text"></div>
    <button type="button" class="toast__close" aria-label="Yopish">${icon('i-close')}</button>`;
  item.querySelector('.toast__text').textContent = message;

  const remove = () => {
    if (!item.isConnected) return;
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 220);
  };

  item.querySelector('.toast__close').addEventListener('click', remove);
  region.appendChild(item);
  if (timeout > 0) setTimeout(remove, timeout);
  return remove;
}

/* ==========================================================================
   Holat bloklari: yuklanmoqda / bo'sh / xato
   ========================================================================== */

/**
 * @param {HTMLElement} container
 * @param {{type?: 'loading'|'empty'|'error', title: string, text?: string,
 *          actionLabel?: string, actionHref?: string, onRetry?: Function}} options
 */
export function renderState(container, { type = 'empty', title, text = '', actionLabel = '', actionHref = '', onRetry = null } = {}) {
  if (!container) return;
  const iconName = type === 'error' ? 'i-alert' : 'i-box';
  const visual = type === 'loading'
    ? '<span class="spinner" aria-hidden="true"></span>'
    : icon(iconName, 'state__icon');
  const action = actionHref
    ? `<a class="btn btn--outline btn--sm" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>`
    : '';
  const retry = onRetry ? '<button type="button" class="btn btn--outline btn--sm" data-retry>Qayta urinish</button>' : '';

  container.innerHTML = `
    <div class="state state--${type}" role="${type === 'error' ? 'alert' : 'status'}">
      ${visual}
      <p class="state__title">${escapeHtml(title)}</p>
      ${text ? `<p class="state__text">${escapeHtml(text)}</p>` : ''}
      ${action}${retry}
    </div>`;

  if (onRetry) {
    container.querySelector('[data-retry]').addEventListener('click', onRetry);
  }
}

export function renderSkeletons(container, count = 3) {
  if (!container) return;
  container.innerHTML = Array.from({ length: count }, () => '<div class="skeleton" aria-hidden="true"></div>').join('');
  container.setAttribute('aria-busy', 'true');
}

/** API xatosi uchun standart matn: backend hali ishga tushmagan bo'lishi mumkin. */
export function errorStateFor(err, subject = 'Ma’lumotlar') {
  if (err && err.network) {
    return {
      type: 'error',
      title: `${subject}ni yuklab bo‘lmadi`,
      text: 'Server bilan aloqa o‘rnatilmadi. Birozdan so‘ng qayta urinib ko‘ring.',
    };
  }
  return {
    type: 'error',
    title: `${subject}ni yuklab bo‘lmadi`,
    text: (err && err.message) || 'Noma’lum xatolik.',
  };
}

/* ==========================================================================
   Tugma yuklanish holati
   ========================================================================== */

export function setButtonLoading(button, loading) {
  if (!button) return;
  button.classList.toggle('is-loading', loading);
  button.disabled = loading;
  if (loading) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

/* ==========================================================================
   Modal oyna
   ========================================================================== */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {{title: string, content: string}} options content — tayyor (xavfsiz qilingan) HTML
 * @returns {Function} modalni yopish funksiyasi
 */
export function openModal({ title, content }) {
  const previousFocus = document.activeElement;
  const wrapper = document.createElement('div');
  wrapper.className = 'modal';
  wrapper.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1">
      <button type="button" class="modal__close" data-close aria-label="Yopish">${icon('i-close')}</button>
      <h2 class="modal__title" id="modalTitle">${escapeHtml(title)}</h2>
      <div class="modal__body">${content}</div>
    </div>`;

  document.body.appendChild(wrapper);
  document.body.classList.add('modal-open');
  const dialog = wrapper.querySelector('.modal__dialog');

  requestAnimationFrame(() => {
    wrapper.classList.add('is-open');
    dialog.focus();
  });

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'Tab') {
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE));
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function close() {
    document.removeEventListener('keydown', onKeyDown);
    wrapper.classList.remove('is-open');
    document.body.classList.remove('modal-open');
    setTimeout(() => wrapper.remove(), 220);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  wrapper.addEventListener('click', (event) => {
    if (event.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKeyDown);

  close.element = wrapper; // modal ichidagi forma va tugmalarga hodisa ulash uchun
  return close;
}

/* ==========================================================================
   Boshqalar
   ========================================================================== */

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function getQueryParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}
