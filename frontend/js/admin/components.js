/**
 * Admin panel uchun umumiy komponentlar: o'zbekcha nomlar, formatlash, jadval sahifalash,
 * modal formalar va server xatolarini forma maydonlariga bog'lash.
 */
import { getFieldErrors } from '../api.js';
import { escapeHtml, formatMoney, formatNumber, icon, openModal, setButtonLoading, toast } from '../ui.js';
import { clearFieldErrors, setFieldError } from '../validators.js';

export const ORDER_STATUS = {
  new: 'Yangi',
  confirmed: 'Tasdiqlandi',
  scheduled: 'Rejalashtirildi',
  in_production: 'Ishlab chiqarilmoqda',
  quality_check: 'Sifat nazoratida',
  loaded: 'Yuklandi',
  in_transit: 'Yo‘lda',
  delivered: 'Yetkazib berildi',
  cancelled: 'Bekor qilindi',
};

export const ROLES = {
  admin: 'Administrator',
  manager: 'Menejer',
  dispatcher: 'Dispetcher',
  production: 'Ishlab chiqarish',
  viewer: 'Kuzatuvchi',
};

export const CALLBACK_STATUS = {
  new: 'Yangi',
  in_progress: 'Jarayonda',
  done: 'Bajarildi',
  spam: 'Spam',
};

export const PERM = {
  DASHBOARD: 'dashboard.read',
  ORDERS_READ: 'orders.read',
  ORDERS_MANAGE: 'orders.manage',
  ORDERS_STATUS: 'orders.status',
  CATALOG_MANAGE: 'catalog.manage',
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_MANAGE: 'customers.manage',
  CALLBACKS_MANAGE: 'callbacks.manage',
  USERS_MANAGE: 'users.manage',
  SETTINGS_READ: 'settings.read',
  SETTINGS_WRITE: 'settings.write',
  FLEET_READ: 'fleet.read',
  FLEET_MANAGE: 'fleet.manage',
  TRIPS_MANAGE: 'trips.manage',
  PRODUCTION_READ: 'production.read',
  PRODUCTION_MANAGE: 'production.manage',
  PROJECTS_MANAGE: 'projects.manage',
};

export const TRIP_STATUS = {
  planned: 'Rejalashtirilgan',
  loading: 'Yuklanmoqda',
  loaded: 'Yuklandi',
  en_route: 'Yo‘lda',
  delivered: 'Yetkazildi',
  cancelled: 'Bekor qilindi',
};

export const VEHICLE_STATUS = { free: 'Bo‘sh', busy: 'Band', repair: 'Ta’mirda' };
export const OWNERSHIP = { own: 'O‘zimizniki', rented: 'Ijaraga olingan' };
export const EMPLOYMENT = { staff: 'Shtatdagi', contractor: 'Shartnoma asosida' };
export const PLAN_STATUS = { planned: 'Rejalashtirilgan', in_progress: 'Jarayonda', completed: 'Bajarildi', cancelled: 'Bekor qilindi' };
export const QC_STATUS = { pending: 'Kutilmoqda', passed: 'O‘tdi', failed: 'O‘tmadi' };

/* --- Formatlash --- */

export function statusBadge(status, labels = ORDER_STATUS) {
  return `<span class="status status--${escapeHtml(status)}">${escapeHtml(labels[status] || status)}</span>`;
}

const pad = (n) => String(n).padStart(2, '0');

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  return d ? `${d}.${m}.${y}` : String(isoDate);
}

export function fmtTime(value) {
  return value ? String(value).slice(0, 5) : '';
}

export function money(value, currency = 'UZS', emptyText = 'Aniqlanmagan') {
  return value === null || value === undefined ? `<span class="muted">${escapeHtml(emptyText)}</span>` : escapeHtml(formatMoney(value, currency));
}

export function volume(value) {
  return `${formatNumber(value || 0, 2)} m³`;
}

export function phoneLink(phone) {
  if (!phone) return '—';
  const text = String(phone).replace(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/, '+998 $1 $2-$3-$4');
  return `<a href="tel:${escapeHtml(phone)}">${escapeHtml(text)}</a>`;
}

/* --- Holat bloklari --- */

export function loadingHtml(text = 'Yuklanmoqda…') {
  return `<div class="state state--loading" role="status"><span class="spinner" aria-hidden="true"></span><p class="state__title">${escapeHtml(text)}</p></div>`;
}

export function errorHtml(err) {
  return `<div class="state state--error" role="alert">${icon('i-alert', 'state__icon')}
    <p class="state__title">Ma’lumotni yuklab bo‘lmadi</p>
    <p class="state__text">${escapeHtml(err && err.message ? err.message : 'Noma’lum xatolik')}</p>
    <button type="button" class="btn btn--outline btn--sm" data-retry>Qayta urinish</button></div>`;
}

export function emptyRow(colspan, text) {
  return `<tr><td colspan="${colspan}" class="table-empty">${escapeHtml(text)}</td></tr>`;
}

/* --- Sahifalash --- */

export function paginationHtml(page) {
  const pages = Math.max(1, Math.ceil(page.total / page.page_size));
  if (page.total === 0) return '';
  const from = (page.page - 1) * page.page_size + 1;
  const to = Math.min(page.total, page.page * page.page_size);
  return `<div class="pagination">
    <span>${from}–${to} / ${page.total}</span>
    <div class="btn-row">
      <button type="button" class="btn btn--outline btn--sm" data-page="${page.page - 1}" ${page.page <= 1 ? 'disabled' : ''}>← Oldingi</button>
      <button type="button" class="btn btn--outline btn--sm" data-page="${page.page + 1}" ${page.page >= pages ? 'disabled' : ''}>Keyingi →</button>
    </div>
  </div>`;
}

/* --- Server xatolarini formaga bog'lash --- */

export function showFormError(form, message) {
  let box = form.querySelector('.form-error');
  if (!message) {
    if (box) box.remove();
    return;
  }
  if (!box) {
    box = document.createElement('p');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = message;
}

/** API xatosini maydonlarga taqsimlaydi; maydon topilmasa — forma tepasida ko'rsatadi. */
export function applyApiErrors(form, err) {
  const fieldErrors = getFieldErrors(err);
  const unmatched = [];
  Object.entries(fieldErrors).forEach(([name, message]) => {
    if (form.elements.namedItem(name)) setFieldError(form, name, message);
    else unmatched.push(message);
  });
  if (!Object.keys(fieldErrors).length) unmatched.push(err.message || 'Xatolik yuz berdi.');
  showFormError(form, unmatched.join(' '));
}

/**
 * Modal forma.
 * @param {{title: string, body: string, submitLabel?: string, danger?: boolean,
 *          onSubmit: (form: HTMLFormElement) => Promise<any>, onOpen?: (form: HTMLFormElement) => void}} options
 */
export function formModal({ title, body, submitLabel = 'Saqlash', danger = false, onSubmit, onOpen }) {
  const close = openModal({
    title,
    content: `<form class="form" novalidate>
      ${body}
      <div class="modal__actions">
        <button type="button" class="btn btn--outline" data-close>Bekor qilish</button>
        <button type="submit" class="btn ${danger ? 'btn--dark' : 'btn--primary'}">${escapeHtml(submitLabel)}</button>
      </div>
    </form>`,
  });
  const form = close.element.querySelector('form');
  const submit = form.querySelector('[type="submit"]');

  form.addEventListener('input', (event) => {
    const field = event.target.closest('.field');
    if (field && field.classList.contains('has-error') && event.target.name) {
      field.classList.remove('has-error');
      field.querySelector('.field__error')?.remove();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    showFormError(form, '');
    setButtonLoading(submit, true);
    try {
      const keepOpen = await onSubmit(form);
      if (keepOpen !== true) close();
    } catch (err) {
      if (err && err.validation) {
        // mahalliy tekshiruv xatolari allaqachon ko'rsatilgan
      } else {
        applyApiErrors(form, err);
      }
    } finally {
      setButtonLoading(submit, false);
    }
  });

  if (onOpen) onOpen(form);
  setTimeout(() => form.querySelector('input:not([type=hidden]):not([type=checkbox]), select, textarea')?.focus(), 50);
  return close;
}

/** Tasdiqlash oynasi. */
export function confirmAction({ title, text, confirmLabel = 'Tasdiqlash', danger = true }) {
  return new Promise((resolve) => {
    let resolved = false;
    const close = formModal({
      title,
      body: `<p>${escapeHtml(text)}</p>`,
      submitLabel: confirmLabel,
      danger,
      onSubmit: async () => {
        resolved = true;
        resolve(true);
      },
    });
    const observer = new MutationObserver(() => {
      if (!close.element.isConnected) {
        observer.disconnect();
        if (!resolved) resolve(false);
      }
    });
    observer.observe(document.body, { childList: true });
  });
}

/** Maydon HTML'i */
export function field({ name, label, type = 'text', value = '', required = false, hint = '', attrs = '', options = null, rows = 3 }) {
  const id = `f-${name.replace(/[^\w-]/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const req = required ? ' <span class="req">*</span>' : '';
  let control;
  if (options) {
    control = `<select class="select" id="${id}" name="${escapeHtml(name)}" ${required ? 'required' : ''} ${attrs}>
      ${options.map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  } else if (type === 'textarea') {
    control = `<textarea class="textarea" id="${id}" name="${escapeHtml(name)}" rows="${rows}" ${required ? 'required' : ''} ${attrs}>${escapeHtml(value ?? '')}</textarea>`;
  } else if (type === 'checkbox') {
    return `<div class="field"><label class="checkbox"><input type="checkbox" name="${escapeHtml(name)}" ${value ? 'checked' : ''} ${attrs}><span>${escapeHtml(label)}</span></label>${hint ? `<span class="field__hint">${escapeHtml(hint)}</span>` : ''}</div>`;
  } else {
    control = `<input class="input" id="${id}" name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value ?? '')}" ${required ? 'required' : ''} ${attrs}>`;
  }
  return `<div class="field">
    <label class="field__label" for="${id}">${escapeHtml(label)}${req}</label>
    ${control}
    ${hint ? `<span class="field__hint">${escapeHtml(hint)}</span>` : ''}
  </div>`;
}

/** Forma maydonidan son o'qish: bo'sh → null */
export function numberOrNull(value) {
  const text = String(value ?? '').replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : NaN;
}

/** Mahalliy tekshiruv xatosi (server so'roviz) */
export function localErrors(form, errors) {
  let has = false;
  Object.entries(errors).forEach(([name, message]) => {
    if (message) {
      setFieldError(form, name, message);
      has = true;
    }
  });
  if (has) {
    const err = new Error('validation');
    err.validation = true;
    throw err;
  }
}

export { escapeHtml, icon, toast };
