/**
 * Kalkulyator va buyurtma sahifasidagi "Hisob-kitob" bloki.
 *
 * Narx ochiq saytda KO'RSATILMAYDI: zavod narxlarini raqobatchilar bilmasligi kerak.
 * Sayt faqat kerakli beton HAJMINI hisoblaydi; narxni menejer mijoz bilan telefon orqali
 * aniq kelishadi. API ham narx qaytarmaydi.
 */
import { escapeHtml, formatVolume, icon } from './ui.js';
import { productLabel } from './product-card.js';

/**
 * @returns {{ volume: number|null, deliveryStatus: 'pending'|'not_required', isDemo: boolean }}
 */
export function calculateEstimate({ product, volume, deliveryRequired }) {
  const vol = Number(volume);
  return {
    volume: Number.isFinite(vol) && vol > 0 ? vol : null,
    deliveryStatus: deliveryRequired ? 'pending' : 'not_required',
    isDemo: Boolean(product && product.is_demo),
  };
}

/** Telefon tugmasi: raqam sozlamalarda bo'lsa ko'rinadi (main.js → data-setting-tel) */
export function callButton(extraClass = '') {
  return `<a class="btn btn--light btn--block call-btn ${extraClass}" data-setting-tel="company.phone" hidden>
    ${icon('i-phone')} <span>Narxni bilish: <b data-setting-value></b></span></a>`;
}

/** Hisob-kitob natijasini kartaga chizadi */
export function renderSummary(container, product, est) {
  if (!container) return;

  const volumeText = est.volume === null ? '—' : formatVolume(est.volume);
  const note = !product
    ? 'Beton markasini tanlang.'
    : est.volume === null
      ? 'Beton hajmini kiriting.'
      : 'Narxni menejer marka, hajm va manzilga qarab telefon orqali aniq kelishadi.';

  const demoNotice = est.isDemo
    ? `<div class="notice notice--demo">${icon('i-info')}<div>Bu <strong>demo</strong> marka — zavodning haqiqiy mahsuloti emas.</div></div>`
    : '';

  container.innerHTML = `
    <dl class="summary__list">
      <div><dt>Beton markasi</dt><dd>${product ? escapeHtml(productLabel(product)) : '—'}</dd></div>
      <div><dt>Hajm</dt><dd>${escapeHtml(volumeText)}</dd></div>
      <div><dt>Yetkazib berish</dt><dd>${est.deliveryStatus === 'pending' ? 'Kerak' : 'O‘zi olib ketadi'}</dd></div>
      <div><dt>Narx</dt><dd class="is-pending">Telefon orqali kelishiladi</dd></div>
    </dl>
    <div class="summary__total" aria-live="polite">
      <span>Kerakli beton hajmi</span>
      <strong>${escapeHtml(volumeText)}</strong>
      <small>${escapeHtml(note)}</small>
    </div>
    <div class="summary__call">${callButton()}</div>
    ${demoNotice}`;
  document.dispatchEvent(new Event('site:rendered'));
}
