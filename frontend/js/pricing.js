/**
 * Taxminiy hisob-kitob (kalkulyator va buyurtma sahifasi uchun).
 *
 *   Beton qiymati = Beton hajmi (m³) × 1 m³ narxi
 *
 * Yetkazib berish narxi bu yerda HECH QACHON 0 deb olinmaydi: u menejer
 * tomonidan tasdiqlanadi. Yakuniy summani backend buyurtma yaratilganda
 * o'zi qayta hisoblaydi — frontenddagi hisob faqat ko'rsatish uchun.
 */
import { escapeHtml, formatMoney, formatVolume, icon } from './ui.js';
import { getUnitPrice, productLabel } from './product-card.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @returns {{
 *   unitPrice: number|null, currency: string, volume: number|null,
 *   concreteTotal: number|null, deliveryStatus: 'pending'|'not_required',
 *   grandTotal: number|null, isDemo: boolean, hasPrice: boolean
 * }}
 */
export function calculateEstimate({ product, volume, deliveryRequired }) {
  const price = getUnitPrice(product);
  const vol = Number(volume);
  const validVolume = Number.isFinite(vol) && vol > 0;
  const concreteTotal = price && validVolume ? round2(vol * price.amount) : null;
  const deliveryStatus = deliveryRequired ? 'pending' : 'not_required';

  return {
    unitPrice: price ? price.amount : null,
    currency: price ? price.currency : 'UZS',
    volume: validVolume ? vol : null,
    concreteTotal,
    deliveryStatus,
    grandTotal: concreteTotal !== null && deliveryStatus === 'not_required' ? concreteTotal : null,
    isDemo: Boolean(product && product.is_demo),
    hasPrice: Boolean(price),
  };
}

function totalBlock(product, est) {
  if (!product) {
    return { value: '—', note: 'Hisoblash uchun beton markasini tanlang.' };
  }
  if (!est.hasPrice) {
    return { value: 'Narx belgilanmagan', note: 'Bu marka narxini menejer aytadi. Buyurtma qoldirishingiz mumkin.' };
  }
  if (est.volume === null) {
    return { value: '—', note: 'Beton hajmini kiriting.' };
  }
  if (est.deliveryStatus === 'pending') {
    return {
      value: formatMoney(est.concreteTotal, est.currency),
      note: '+ yetkazib berish narxi (menejer tasdiqlaydi)',
    };
  }
  return { value: formatMoney(est.grandTotal, est.currency), note: 'Yetkazib berishsiz (o‘zi olib ketish).' };
}

/** Hisob-kitob natijasini kartaga chizadi */
export function renderSummary(container, product, est) {
  if (!container) return;

  const deliveryText = est.deliveryStatus === 'pending'
    ? '<dd class="is-pending">Menejer tasdiqlaydi</dd>'
    : '<dd>Kerak emas</dd>';

  const total = totalBlock(product, est);

  const demoNotice = est.isDemo
    ? `<div class="notice notice--demo">${icon('i-info')}<div>Bu <strong>demo</strong> marka va namuna narx.
       Zavodning haqiqiy narxi emas — aniq narxni menejer tasdiqlaydi.</div></div>`
    : '';

  container.innerHTML = `
    <dl class="summary__list">
      <div><dt>Beton markasi</dt><dd>${product ? escapeHtml(productLabel(product)) : '—'}</dd></div>
      <div><dt>1 m³ narxi</dt><dd>${est.hasPrice ? escapeHtml(formatMoney(est.unitPrice, est.currency)) : '—'}</dd></div>
      <div><dt>Hajm</dt><dd>${escapeHtml(formatVolume(est.volume))}</dd></div>
      <div><dt>Beton qiymati</dt><dd>${est.concreteTotal !== null ? escapeHtml(formatMoney(est.concreteTotal, est.currency)) : '—'}</dd></div>
      <div><dt>Yetkazib berish</dt>${deliveryText}</div>
    </dl>
    <div class="summary__total" aria-live="polite">
      <span>Taxminiy summa</span>
      <strong>${escapeHtml(total.value)}</strong>
      <small>${escapeHtml(total.note)}</small>
    </div>
    ${demoNotice}
    <p class="summary__formula">Beton qiymati = hajm (m³) × 1 m³ narxi. Yakuniy summa buyurtma
      tasdiqlanganda aniqlanadi.</p>`;
}
