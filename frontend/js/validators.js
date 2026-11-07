/**
 * Forma tekshiruvlari va maydon xatolarini ko'rsatish.
 * Muhim: bu faqat qulaylik uchun. Haqiqiy tekshiruv backendda (Pydantic) takrorlanadi.
 */
import { CONFIG } from './config.js';
import { formatNumber } from './ui.js';

/* ==========================================================================
   Telefon raqami (+998 XX XXX-XX-XX)
   ========================================================================== */

/** Har qanday kiritilgan raqamni "+998XXXXXXXXX" ko'rinishiga keltiradi yoki null qaytaradi. */
export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  if (digits.length !== 9) return null;
  return `+998${digits}`;
}

/** Kiritish jarayonida ko'rinish: "+998 (90) 123-45-67" */
export function formatPhoneInput(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('998')) digits = digits.slice(3);
  digits = digits.slice(0, 9);

  let out = '+998';
  if (digits.length > 0) out += ` (${digits.slice(0, 2)}`;
  if (digits.length >= 2) out += ')';
  if (digits.length > 2) out += ` ${digits.slice(2, 5)}`;
  if (digits.length > 5) out += `-${digits.slice(5, 7)}`;
  if (digits.length > 7) out += `-${digits.slice(7, 9)}`;
  return out;
}

export function attachPhoneMask(input) {
  if (!input) return;

  input.addEventListener('focus', () => {
    if (!input.value) input.value = '+998 ';
  });

  input.addEventListener('input', () => {
    const atEnd = input.selectionStart === input.value.length;
    input.value = formatPhoneInput(input.value);
    if (atEnd) input.setSelectionRange(input.value.length, input.value.length);
  });

  input.addEventListener('blur', () => {
    if (input.value.replace(/\D/g, '') === '998') input.value = '';
  });
}

/* ==========================================================================
   Qiymat tekshiruvlari — xato matnini yoki null qaytaradi
   ========================================================================== */

export function validateName(value) {
  const name = String(value || '').trim();
  if (!name) return 'Ismingizni kiriting.';
  if (name.length < 2) return 'Ism kamida 2 ta belgidan iborat bo‘lishi kerak.';
  if (name.length > 100) return 'Ism juda uzun (ko‘pi bilan 100 ta belgi).';
  if (!/\p{L}/u.test(name)) return 'Ism harflardan iborat bo‘lishi kerak.';
  return null;
}

export function validatePhone(value) {
  if (!String(value || '').replace(/\D/g, '').replace(/^998/, '')) return 'Telefon raqamingizni kiriting.';
  if (!normalizePhone(value)) return 'Telefon raqami to‘liq emas. Namuna: +998 90 123-45-67';
  return null;
}

export function parseVolume(value) {
  const num = Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(num) ? num : NaN;
}

export function validateVolume(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Beton hajmini kiriting.';
  const num = parseVolume(raw);
  if (Number.isNaN(num)) return 'Hajm raqam bo‘lishi kerak.';
  if (num < CONFIG.VOLUME.MIN) return `Eng kam hajm — ${formatNumber(CONFIG.VOLUME.MIN)} m³.`;
  if (num > CONFIG.VOLUME.MAX) return `Bitta buyurtmada ko‘pi bilan ${formatNumber(CONFIG.VOLUME.MAX)} m³. Katta hajm uchun menejer bilan bog‘laning.`;
  if (Math.abs(Math.round(num * 10) - num * 10) > 1e-9) return 'Hajm 0,1 m³ aniqlikda bo‘lishi kerak.';
  return null;
}

/** Mahalliy vaqt bo'yicha bugungi sana: "YYYY-MM-DD" */
export function todayISO() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function validateDate(value) {
  if (!value) return 'Sanani tanlang.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Sana noto‘g‘ri formatda.';
  if (value < todayISO()) return 'O‘tib ketgan sanani tanlab bo‘lmaydi.';
  return null;
}

export function validateTime(value) {
  if (!value) return null; // ixtiyoriy
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 'Vaqt noto‘g‘ri formatda.';
  return null;
}

export function validateRequiredText(value, message, { min = 1, max = 1000 } = {}) {
  const text = String(value || '').trim();
  if (text.length < min) return message;
  if (text.length > max) return `Matn juda uzun (ko‘pi bilan ${max} ta belgi).`;
  return null;
}

/* ==========================================================================
   Maydon xatolarini ko'rsatish
   ========================================================================== */

function findField(form, name) {
  const control = form.elements.namedItem(name);
  if (!control) return { control: null, wrapper: null };
  const element = control instanceof RadioNodeList ? control[0] : control;
  return { control: element, wrapper: element.closest('.field') };
}

export function setFieldError(form, name, message) {
  const { control, wrapper } = findField(form, name);
  if (!control || !wrapper) return;

  wrapper.classList.add('has-error');
  control.setAttribute('aria-invalid', 'true');

  let errorEl = wrapper.querySelector('.field__error');
  if (!errorEl) {
    errorEl = document.createElement('p');
    errorEl.className = 'field__error';
    errorEl.id = `${form.id || 'form'}-${name}-error`;
    wrapper.appendChild(errorEl);
  }
  errorEl.textContent = message;

  const describedBy = new Set((control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
  describedBy.add(errorEl.id);
  control.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
}

export function clearFieldError(form, name) {
  const { control, wrapper } = findField(form, name);
  if (!control || !wrapper) return;
  wrapper.classList.remove('has-error');
  control.removeAttribute('aria-invalid');
  const errorEl = wrapper.querySelector('.field__error');
  if (errorEl) {
    const ids = (control.getAttribute('aria-describedby') || '').split(' ').filter((id) => id && id !== errorEl.id);
    if (ids.length) control.setAttribute('aria-describedby', ids.join(' '));
    else control.removeAttribute('aria-describedby');
    errorEl.remove();
  }
}

export function clearFieldErrors(form) {
  form.querySelectorAll('.field.has-error').forEach((wrapper) => {
    const control = wrapper.querySelector('[name]');
    if (control) clearFieldError(form, control.name);
  });
}

/**
 * Xatolarni ko'rsatadi va birinchi xatoli maydonga fokus beradi.
 * @param {HTMLFormElement} form
 * @param {Record<string, string|null>} errors
 * @returns {boolean} xato bormi
 */
export function applyErrors(form, errors) {
  let first = null;
  for (const [name, message] of Object.entries(errors)) {
    if (!message) continue;
    setFieldError(form, name, message);
    if (!first) first = name;
  }
  if (first) {
    const { control } = findField(form, first);
    if (control) control.focus({ preventScroll: false });
  }
  return Boolean(first);
}

/** Foydalanuvchi maydonni tuzata boshlaganda xato yo'qoladi. */
export function clearErrorsOnInput(form) {
  form.addEventListener('input', (event) => {
    if (event.target.name) clearFieldError(form, event.target.name);
  });
  form.addEventListener('change', (event) => {
    if (event.target.name) clearFieldError(form, event.target.name);
  });
}
