/**
 * Beton markasi (mahsulot) bilan ishlash: xususiyatlarni tartiblash,
 * katalog kartasini chizish. Mahsulotlar faqat API'dan keladi — bu yerda hech
 * qanday marka yozilmagan.
 *
 * Narx ochiq saytda ko'rsatilmaydi (raqobatchilar bilmasligi uchun): API narx qaytarmaydi,
 * kartada "Narx telefon orqali" va qo'ng'iroq tugmasi turadi.
 */
import { escapeHtml, icon } from './ui.js';

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
    const suffix = flags.length ? ` (${flags.join(', ')})` : '';
    return `<option value="${escapeHtml(p.id)}"${isOrderable(p) ? '' : ' disabled'}>${escapeHtml(productLabel(p) + suffix)}</option>`;
  });
  return `<option value="">${escapeHtml(placeholder)}</option>${items.join('')}`;
}

export function renderProductCard(product, { maxSpecs = 5 } = {}) {
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

  const priceHtml = `<a class="product-card__call" data-setting-tel="company.phone" hidden>${icon('i-phone')}<span>Telefon orqali</span></a>
    <strong class="is-empty" data-setting-hide="company.phone">Menejer aytadi</strong>`;

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
        <div class="product-card__price"><span>Narx</span>${priceHtml}</div>
        <div class="product-card__actions">${actions}</div>
      </div>
    </article>`;
}
