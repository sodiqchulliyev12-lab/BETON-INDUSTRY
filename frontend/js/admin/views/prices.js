/**
 * Narxlar. Yangi narx kiritilganda eskisi o'chmaydi — tarixda yopilgan holda qoladi.
 * Eski buyurtmalar o'z narxini saqlaydi (buyurtma paytidagi narx).
 */
import { formatMoney } from '../../ui.js';
import { http } from '../http.js';
import { session } from '../auth.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDateTime, formModal, icon, loadingHtml,
  localErrors, money, numberOrNull, toast,
} from '../components.js';
import { openModal } from '../../ui.js';

/** Oyna sarlavhasi uchun: «Beton M100 · B7.5» */
const productTitle = (p) => (p.name ? `${p.name} · ${p.grade_class}` : p.grade_class);

export async function render(ctx) {
  const { root, isCurrent } = ctx;
  const canManage = session.can(PERM.CATALOG_MANAGE);
  root.innerHTML = `
    <div class="notice mb-5">${icon('i-info')}<div>Narx 1 m³ beton uchun. Narx belgilanmagan marka saytda
      «Narx belgilanmagan» deb ko‘rinadi va hisob-kitobni menejer qiladi. Yetkazib berish narxi har bir buyurtmada alohida tasdiqlanadi.</div></div>
    <section class="box" id="pricesBox">${loadingHtml()}</section>`;

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
