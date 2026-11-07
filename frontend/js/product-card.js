/**
 * Beton markasi (mahsulot) bilan ishlash: narxni olish, xususiyatlarni tartiblash,
 * katalog kartasini chizish. Mahsulotlar faqat API'dan keladi — bu yerda hech
 * qanday marka yoki narx yozilmagan.
 */
import { escapeHtml, formatMoney } from './ui.js';

/** @returns {{amount: number, currency: string} | null} */
export function getUnitPrice(product) {
  if (!product) return null;
  const source = product.price;
  const amount = source && typeof source === 'object' ? source.price_per_m3 : product.price_per_m3;
  const currency = (source && typeof source === 'object' && source.currency) || product.currency || 'UZS';
  if (amount === null || amount === undefined || amount === '') return null;
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) return null;
  return { amount: num, currency };
}

/** specs: [{label, value}] yoki {label: value} → [{label, value}] */
export function normalizeSpecs(specs) {
  if (!specs) return [];
  if (Array.isArray(specs)) {
    return specs
      .filter((s) => s && s.label && s.value !== null && s.value !== undefined && s.value !== '')
      .map((s) => ({ label: String(s.label), value: String(s.value) }));
  }
  if (typeof specs === 'object') {
    return Object.entries(specs)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => ({ label: k, value: String(v) }));
  }
  return [];
}

export function isOrderable(product) {
  return Boolean(product) && product.is_available !== false;
}

/** URL parametri (slug yoki id) bo'yicha mahsulotni topish */
export function findProduct(products, key) {
  if (!key) return null;
  const k = String(key);
  return products.find((p) => p.slug === k || String(p.id) === k) || null;
}

export function productLabel(product) {
  if (!product) return '';
  const grade = product.grade_class ? `${product.grade_class} — ` : '';
  return `${grade}${product.name || ''}`.trim();
}

/** Select uchun <option> elementlari */
export function productOptions(products, { placeholder = 'Markani tanlang' } = {}) {
  const items = products.map((p) => {
    const flags = [];
    if (p.is_demo) flags.push('demo');
    if (!isOrderable(p)) flags.push('vaqtincha mavjud emas');
    else if (!getUnitPrice(p)) flags.push('narx belgilanmagan');
    const suffix = flags.length ? ` (${flags.join(', ')})` : '';
    return `<option value="${escapeHtml(p.id)}"${isOrderable(p) ? '' : ' disabled'}>${escapeHtml(productLabel(p) + suffix)}</option>`;
  });
  return `<option value="">${escapeHtml(placeholder)}</option>${items.join('')}`;
}

export function renderProductCard(product, { maxSpecs = 5 } = {}) {
  const price = getUnitPrice(product);
  const specs = normalizeSpecs(product.specs).slice(0, maxSpecs);
  const available = isOrderable(product);
  const key = encodeURIComponent(product.slug || product.id);

  const badges = [];
  if (product.is_demo) badges.push('<span class="badge badge--demo" title="Namuna ma’lumot — haqiqiy mahsulot emas">Demo</span>');
  if (!available) badges.push('<span class="badge badge--danger">Vaqtincha mavjud emas</span>');

  const specsHtml = specs.length
    ? `<dl class="spec-list">${specs
        .map((s) => `<div><dt>${escapeHtml(s.label)}</dt><dd>${escapeHtml(s.value)}</dd></div>`)
        .join('')}</dl>`
    : '';

  const priceHtml = price
    ? `<strong>${escapeHtml(formatMoney(price.amount, price.currency))}</strong>`
    : '<strong class="is-empty">Narx belgilanmagan</strong>';

  const actions = available
    ? `<a class="btn btn--outline btn--sm" href="calculator.html?product=${key}">Hisoblash</a>
       <a class="btn btn--primary btn--sm" href="order.html?product=${key}">Buyurtma</a>`
    : `<a class="btn btn--outline btn--sm" href="contact.html">Bog‘lanish</a>
       <button class="btn btn--primary btn--sm" type="button" disabled>Buyurtma</button>`;

  return `
    <article class="product-card${available ? '' : ' is-unavailable'}">
      <div class="product-card__head">
        <span class="product-card__grade">${escapeHtml(product.grade_class || '—')}</span>
        <div class="product-card__badges">${badges.join('')}</div>
      </div>
      <div class="product-card__body">
        <h3 class="product-card__title">${escapeHtml(product.name || '')}</h3>
        ${product.description ? `<p class="product-card__desc">${escapeHtml(product.description)}</p>` : ''}
        ${specsHtml}
      </div>
      <div class="product-card__footer">
        <div class="product-card__price"><span>1 m³ narxi</span>${priceHtml}</div>
        <div class="product-card__actions">${actions}</div>
      </div>
    </article>`;
}
