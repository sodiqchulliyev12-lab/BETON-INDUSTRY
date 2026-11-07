/**
 * "Qayta qo'ng'iroq" formasi (bosh sahifa va Aloqa sahifasida).
 * Forma ichida quyidagi maydonlar bo'lishi kerak: name, phone, [message], website (honeypot).
 */
import { api, getFieldErrors } from './api.js';
import { icon, setButtonLoading, toast } from './ui.js';
import {
  applyErrors,
  attachPhoneMask,
  clearErrorsOnInput,
  clearFieldErrors,
  normalizePhone,
  validateName,
  validatePhone,
} from './validators.js';

export function initCallbackForm(form) {
  if (!form) return;

  attachPhoneMask(form.elements.namedItem('phone'));
  clearErrorsOnInput(form);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);

    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const phone = String(data.get('phone') || '');
    const message = String(data.get('message') || '').trim();

    const errors = {
      name: validateName(name),
      phone: validatePhone(phone),
      message: message.length > 1000 ? 'Xabar juda uzun (ko‘pi bilan 1000 ta belgi).' : null,
    };
    if (applyErrors(form, errors)) return;

    const button = form.querySelector('[type="submit"]');
    setButtonLoading(button, true);

    try {
      await api.createCallback({
        name,
        phone: normalizePhone(phone),
        message: message || null,
        source_page: document.body.dataset.page || null,
        website: String(data.get('website') || ''), // honeypot: odam uchun doim bo'sh
      });
      showSuccess(form);
    } catch (err) {
      const fieldErrors = getFieldErrors(err);
      if (Object.keys(fieldErrors).length) {
        applyErrors(form, fieldErrors);
      } else {
        toast(err.message || 'So‘rovni yuborib bo‘lmadi.', 'error');
      }
    } finally {
      setButtonLoading(button, false);
    }
  });
}

function showSuccess(form) {
  const box = document.createElement('div');
  box.className = 'form-success';
  box.setAttribute('role', 'status');
  box.innerHTML = `
    <span class="form-success__icon">${icon('i-check')}</span>
    <h3>So‘rovingiz qabul qilindi</h3>
    <p class="text-muted">Menejerimiz tez orada siz bilan bog‘lanadi.</p>
    <button type="button" class="btn btn--outline btn--sm">Yana so‘rov yuborish</button>`;

  box.querySelector('button').addEventListener('click', () => {
    form.reset();
    box.remove();
    form.hidden = false;
    const first = form.querySelector('input:not(.hp-field input)');
    if (first) first.focus();
  });

  form.hidden = true;
  form.after(box);
  toast('So‘rovingiz yuborildi.', 'success');
}
