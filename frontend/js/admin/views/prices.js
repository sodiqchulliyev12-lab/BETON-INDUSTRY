/**
 * Narxlar. Yangi narx kiritilganda eskisi o'chmaydi — tarixda yopilgan holda qoladi.
 * Eski buyurtmalar o'z narxini saqlaydi (buyurtma paytidagi narx).
 */
import { formatMoney } from '../../ui.js';
import { http, qs } from '../http.js';
import { setQuery } from '../app.js';
import { session } from '../auth.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, fmtDateTime, formModal, icon, loadingHtml,
  localErrors, money, numberOrNull, toast,
} from '../components.js';
import { openModal } from '../../ui.js';

/** Oyna sarlavhasi uchun: «Beton M100 · B7.5» */
const productTitle = (p) => (p.name ? `${p.name} · ${p.grade_class}` : p.grade_class);

export async function render(ctx) {
  const tab = ctx.query.get('tab') || 'missing';
  if (tab === 'missing' || tab === 'set') return orderPrices(ctx, tab);
  return catalog(ctx);
}

const tabs = (tab, counts) => `<div class="price-tabs">
  <button type="button" class="status-chip status-chip--warn${tab === 'missing' ? ' is-active' : ''}" data-tab="missing">Narx kiritilmagan buyurtmalar <b>${counts ? counts.unpriced : '…'}</b></button>
  <button type="button" class="status-chip${tab === 'set' ? ' is-active' : ''}" data-tab="set">Narx kiritilgan buyurtmalar <b>${counts ? counts.priced : '…'}</b></button>
  <button type="button" class="status-chip${tab === 'catalog' ? ' is-active' : ''}" data-tab="catalog">Katalog narxlari (1 m³)</button></div>`;
const bindTabs = (root) => root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setQuery({ tab: b.dataset.tab, page: '' })));

/** Buyurtmalar narxi: narx hammaga bir xil emas — buyurtma kiritilganda yoki shu yerda kiritiladi */
async function orderPrices(ctx, tab) {
  const { root, isCurrent } = ctx;
  const canManage = session.can(PERM.ORDERS_MANAGE);
  root.innerHTML = `${tabs(tab, null)}<section class="box" id="opBox">${loadingHtml()}</section>`;
  bindTabs(root);
  let list;
  let counts;
  try {
    [list, counts] = await Promise.all([http(`/admin/orders${qs({ price: tab, page_size: 100 })}`), http('/admin/orders/counts')]);
  } catch (err) {
    root.querySelector('#opBox').innerHTML = errorHtml(err);
    return;
  }
  if (!isCurrent()) return;
  root.querySelector('.price-tabs').outerHTML = tabs(tab, counts);
  bindTabs(root);
  const box = root.querySelector('#opBox');
  box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Buyurtma</th><th>Mijoz</th><th>Marka</th><th class="num">Hajm</th><th>Sana</th><th class="num">Beton summasi</th><th class="num">Jami</th><th></th></tr></thead>
    <tbody>${list.items.length ? list.items.map((o) => `<tr data-id="${o.id}"><td class="strong"><a href="#/orders/${o.id}">${escapeHtml(o.order_number)}</a></td><td>${escapeHtml(o.customer_name)}<br><span class="muted">${escapeHtml(o.customer_phone)}</span></td>
      <td>${escapeHtml(o.products)}</td><td class="num">${o.volume_m3} m³</td><td class="nowrap">${escapeHtml(fmtDate(o.delivery_date))}</td>
      <td class="num">${o.concrete_total === null ? '<span class="muted">kiritilmagan</span>' : money(o.concrete_total, o.currency)}</td>
      <td class="num">${o.grand_total === null ? '<span class="muted">—</span>' : money(o.grand_total, o.currency)}</td>
      <td class="num nowrap">${canManage ? `<button type="button" class="btn btn--primary btn--sm" data-set>${o.concrete_total === null ? 'Narx kiritish' : 'O‘zgartirish'}</button>` : ''}</td></tr>`).join('')
    : emptyRow(8, tab === 'missing' ? 'Narxi kiritilmagan buyurtma yo‘q.' : 'Narxi kiritilgan buyurtma yo‘q.')}</tbody></table></div>`;
  box.querySelectorAll('tr[data-id]').forEach((row) => row.querySelector('[data-set]')?.addEventListener('click', () => orderPriceForm(Number(row.dataset.id), () => orderPrices(ctx, tab))));
}

async function orderPriceForm(orderId, onSaved) {
  let o;
  try {
    o = await http(`/admin/orders/${orderId}`);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  formModal({
    title: `${o.order_number} — narx`,
    body: `<p class="text-muted">${escapeHtml(o.customer.full_name)}. Narx shu buyurtma uchun alohida kiritiladi.</p>
      ${o.items.map((i) => field({ name: `p${i.id}`, label: `${i.product_name} · ${i.volume_m3} m³ — 1 m³ narxi (so‘m)`, value: i.unit_price === null ? '' : String(i.unit_price), required: true, attrs: 'inputmode="decimal" autocomplete="off"' })).join('')}
      ${o.delivery_required ? field({ name: 'delivery_price', label: 'Yetkazish narxi (so‘m)', value: o.delivery_price === null ? '' : String(o.delivery_price), attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Bo‘sh qoldirsangiz, buyurtmani tasdiqlashdan oldin kiritiladi.' }) : ''}`,
    onSubmit: async (form) => {
      const errors = {};
      const vals = o.items.map((i) => {
        const v = numberOrNull(form.elements[`p${i.id}`].value);
        errors[`p${i.id}`] = v === null || Number.isNaN(v) || v < 0 ? 'Narxni kiriting.' : null;
        return [i.id, v];
      });
      const dp = o.delivery_required ? numberOrNull(form.elements.delivery_price.value) : null;
      if (Number.isNaN(dp)) errors.delivery_price = 'Narxni to‘g‘ri kiriting.';
      localErrors(form, errors);
      for (const [id, v] of vals) await http(`/admin/orders/${orderId}/items/${id}`, { method: 'PATCH', body: { unit_price: v } });
      if (dp !== null) await http(`/admin/orders/${orderId}`, { method: 'PATCH', body: { delivery_price: dp } });
      toast('Narx saqlandi.', 'success');
      onSaved();
    },
  });
}

async function catalog(ctx) {
  const { root, isCurrent } = ctx;
  const canManage = session.can(PERM.CATALOG_MANAGE);
  root.innerHTML = `${tabs('catalog', null)}
    <div class="notice mb-5">${icon('i-info')}<div>Narx 1 m³ beton uchun. Narx belgilanmagan marka saytda
      «Narx belgilanmagan» deb ko‘rinadi va hisob-kitobni menejer qiladi. Yetkazib berish narxi har bir buyurtmada alohida tasdiqlanadi.</div></div>
    <section class="box" id="pricesBox">${loadingHtml()}</section>`;
  bindTabs(root);

  const box = root.querySelector('#pricesBox');
  let products;
  try {
    products = await http('/admin/products');
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Marka</th><th>Nomi</th><th class="num">Amaldagi narx (1 m³)</th><th>Kiritilgan</th><th></th></tr></thead>
        <tbody>
          ${products.length ? products.map((p) => `
            <tr data-id="${p.id}">
              <td class="strong">${escapeHtml(p.grade_class)}</td>
              <td>${escapeHtml(p.name)} ${p.is_demo ? '<span class="badge badge--demo">Demo</span>' : ''} ${p.is_active ? '' : '<span class="badge badge--muted">Nofaol</span>'}</td>
              <td class="num strong">${p.price ? money(p.price.price_per_m3, p.price.currency) : '<span class="muted">Belgilanmagan</span>'}</td>
              <td class="muted nowrap">${p.price_updated_at ? fmtDateTime(p.price_updated_at) : '—'}</td>
              <td class="num nowrap">
                ${canManage ? `<button type="button" class="btn btn--primary btn--sm" data-set>${p.price ? 'O‘zgartirish' : 'Narx kiritish'}</button>` : ''}
                <button type="button" class="icon-btn" data-history title="Narxlar tarixi" aria-label="Narxlar tarixi">${icon('i-history')}</button>
                ${canManage && p.price ? `<button type="button" class="icon-btn" data-clear title="Narxni olib tashlash" aria-label="Narxni olib tashlash">${icon('i-trash')}</button>` : ''}
              </td>
            </tr>`).join('') : emptyRow(5, 'Avval «Beton markalari» bo‘limida marka qo‘shing.')}
        </tbody>
      </table>
    </div>`;

  box.querySelectorAll('tr[data-id]').forEach((row) => {
    const product = products.find((p) => p.id === Number(row.dataset.id));
    row.querySelector('[data-set]')?.addEventListener('click', () => setPrice(product, () => render(ctx)));
    row.querySelector('[data-history]').addEventListener('click', () => showHistory(product));
    row.querySelector('[data-clear]')?.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Narxni olib tashlash',
        text: `«${product.name} (${product.grade_class})» uchun amaldagi narx yopiladi. Yangi buyurtmalarda summa «aniqlanmagan» bo‘ladi. Tarix saqlanib qoladi.`,
        confirmLabel: 'Olib tashlash',
      });
      if (!ok) return;
      try {
        await http(`/admin/products/${product.id}/prices/current`, { method: 'DELETE' });
        toast('Narx olib tashlandi.', 'success');
        render(ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function setPrice(product, onSaved) {
  formModal({
    title: `${productTitle(product)} — yangi narx`,
    body: `
      ${product.price ? `<p class="text-muted">Amaldagi narx: <strong>${escapeHtml(formatMoney(product.price.price_per_m3, product.price.currency))}</strong></p>` : ''}
      ${field({ name: 'price_per_m3', label: '1 m³ narxi (so‘m)', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'note', label: 'Izoh (ixtiyoriy)', attrs: 'maxlength="255" placeholder="Masalan: sement narxi oshdi"' })}
      <p class="text-muted">Narx ochiq saytda ko‘rsatilmaydi — faqat admin panelda va yangi buyurtmalar summasida ishlatiladi. Avval berilgan buyurtmalar narxi o‘zgarmaydi.</p>`,
    onSubmit: async (form) => {
      const price = numberOrNull(form.elements.price_per_m3.value);
      localErrors(form, { price_per_m3: price === null || Number.isNaN(price) || price < 0 ? 'Narxni to‘g‘ri kiriting.' : null });
      await http(`/admin/products/${product.id}/prices`, {
        method: 'POST',
        body: { price_per_m3: price, note: form.elements.note.value.trim() || null },
      });
      toast('Narx saqlandi.', 'success');
      onSaved();
    },
  });
}

async function showHistory(product) {
  const close = openModal({ title: `${productTitle(product)} — narxlar tarixi`, content: '<div data-history></div>' });
  const holder = close.element.querySelector('[data-history]');
  holder.innerHTML = '<p class="text-muted">Yuklanmoqda…</p>';
  try {
    const rows = await http(`/admin/products/${product.id}/prices`);
    holder.innerHTML = rows.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th class="num">Narx</th><th>Amal qilgan</th><th>Kiritgan</th><th>Izoh</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td class="num strong">${money(r.price_per_m3, r.currency)}</td>
            <td class="nowrap">${fmtDateTime(r.valid_from)} — ${r.valid_to ? fmtDateTime(r.valid_to) : '<strong>hozir</strong>'}</td>
            <td>${escapeHtml(r.created_by || '—')}</td>
            <td>${escapeHtml(r.note || '')}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<p class="text-muted">Bu marka uchun narx hali kiritilmagan.</p>';
  } catch (err) {
    holder.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}
