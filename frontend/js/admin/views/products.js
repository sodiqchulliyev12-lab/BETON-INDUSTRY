/** Beton markalari: qo'shish, tahrirlash, faol/nofaol va sotuvda/sotuvda emas holatlari. */
import { http } from '../http.js';
import { session } from '../auth.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, formModal, icon, loadingHtml, localErrors, money, toast,
} from '../components.js';

export async function render(ctx) {
  const { root, isCurrent } = ctx;
  const canManage = session.can(PERM.CATALOG_MANAGE);
  root.innerHTML = `
    <div class="page-actions">
      <p class="text-muted">Saytdagi katalog shu ro‘yxatdan olinadi. Nofaol markalar saytda ko‘rinmaydi;
        "sotuvda emas" markalar ko‘rinadi, lekin buyurtma qilib bo‘lmaydi.</p>
      <span class="page-actions__spacer"></span>
      ${canManage ? `<button type="button" class="btn btn--primary" data-action="create">${icon('i-plus')} Yangi marka</button>` : ''}
    </div>
    <section class="box" id="productsBox">${loadingHtml()}</section>`;

  root.querySelector('[data-action=create]')?.addEventListener('click', () => productForm(null, () => render(ctx)));

  const box = root.querySelector('#productsBox');
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
        <thead><tr>
          <th>Marka</th><th>Nomi</th><th class="num">1 m³ narxi</th><th>Saytda faol</th><th>Sotuvda</th>
          <th class="num">Buyurtmalar</th>${canManage ? '<th></th>' : ''}
        </tr></thead>
        <tbody>
          ${products.length ? products.map((p) => `
            <tr data-id="${p.id}">
              <td class="strong nowrap">${escapeHtml(p.grade_class)}</td>
              <td>${escapeHtml(p.name)} ${p.is_demo ? '<span class="badge badge--demo">Demo</span>' : ''}
                <br><span class="muted">/${escapeHtml(p.slug)}</span></td>
              <td class="num">${p.price ? money(p.price.price_per_m3, p.price.currency) : '<a href="#/prices">Belgilanmagan</a>'}</td>
              <td>${toggle('is_active', p.is_active, canManage, 'Saytda faol')}</td>
              <td>${toggle('is_available', p.is_available, canManage, 'Sotuvda')}</td>
              <td class="num">${p.orders_count}</td>
              ${canManage ? `<td class="num nowrap">
                <button type="button" class="icon-btn" data-edit title="Tahrirlash" aria-label="Tahrirlash">${icon('i-edit')}</button>
                ${p.orders_count === 0 ? `<button type="button" class="icon-btn" data-delete title="O‘chirish" aria-label="O‘chirish">${icon('i-trash')}</button>` : ''}
              </td>` : ''}
            </tr>`).join('') : emptyRow(canManage ? 7 : 6, 'Beton markalari hali kiritilmagan. "Yangi marka" tugmasi orqali qo‘shing.')}
        </tbody>
      </table>
    </div>`;

  box.querySelectorAll('tr[data-id]').forEach((row) => {
    const product = products.find((p) => p.id === Number(row.dataset.id));
    row.querySelectorAll('input[data-flag]').forEach((input) => {
      input.addEventListener('change', async () => {
        input.disabled = true;
        try {
          await http(`/admin/products/${product.id}`, { method: 'PATCH', body: { [input.dataset.flag]: input.checked } });
          product[input.dataset.flag] = input.checked;
          toast('Saqlandi.', 'success', 2500);
        } catch (err) {
          input.checked = !input.checked;
          toast(err.message, 'error');
        } finally {
          input.disabled = false;
        }
      });
    });
    row.querySelector('[data-edit]')?.addEventListener('click', () => productForm(product, () => render(ctx)));
    row.querySelector('[data-delete]')?.addEventListener('click', async () => {
      const ok = await confirmAction({
        title: 'Markani o‘chirish',
        text: `«${product.grade_class} — ${product.name}» va uning narxlar tarixi o‘chiriladi. Bu amalni qaytarib bo‘lmaydi.`,
        confirmLabel: 'O‘chirish',
      });
      if (!ok) return;
      try {
        await http(`/admin/products/${product.id}`, { method: 'DELETE' });
        toast('Marka o‘chirildi.', 'success');
        render(ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function toggle(flag, checked, enabled, label) {
  return `<label class="toggle" title="${escapeHtml(label)}"><input type="checkbox" data-flag="${flag}" ${checked ? 'checked' : ''} ${enabled ? '' : 'disabled'} aria-label="${escapeHtml(label)}"><span></span></label>`;
}

function specRow(spec = { label: '', value: '' }) {
  return `<div class="spec-row">
    <input class="input" name="spec_label" placeholder="Xususiyat (masalan: Harakatchanlik)" value="${escapeHtml(spec.label)}" maxlength="80" aria-label="Xususiyat nomi">
    <input class="input" name="spec_value" placeholder="Qiymat (masalan: P3)" value="${escapeHtml(spec.value)}" maxlength="120" aria-label="Xususiyat qiymati">
    <button type="button" class="icon-btn" data-remove-spec aria-label="Qatorni o‘chirish">${icon('i-close')}</button>
  </div>`;
}

function productForm(product, onSaved) {
  const p = product || { name: '', grade_class: '', slug: '', description: '', specs: [], is_active: true, is_available: true, is_demo: false, sort_order: 0 };
  formModal({
    title: product ? `${p.grade_class} — tahrirlash` : 'Yangi beton markasi',
    body: `
      <div class="form-row">
        ${field({ name: 'grade_class', label: 'Marka / sinf', value: p.grade_class, required: true, attrs: 'maxlength="20" placeholder="B25"' })}
        ${field({ name: 'name', label: 'Nomi', value: p.name, required: true, attrs: 'maxlength="150" placeholder="Beton B25 (M350)"' })}
      </div>
      ${field({ name: 'description', label: 'Tavsif', type: 'textarea', value: p.description, attrs: 'maxlength="2000"', hint: 'Qayerda ishlatiladi, xususiyatlari — saytdagi kartada ko‘rinadi.' })}
      <div class="field">
        <span class="field__label">Texnik xususiyatlar</span>
        <div class="spec-rows" data-specs>${(p.specs.length ? p.specs : [{ label: '', value: '' }]).map(specRow).join('')}</div>
        <button type="button" class="btn btn--outline btn--sm" data-add-spec>${icon('i-plus')} Xususiyat qo‘shish</button>
      </div>
      <div class="form-row">
        ${field({ name: 'slug', label: 'URL nomi (slug)', value: p.slug, attrs: 'maxlength="160" placeholder="avtomatik"', hint: 'Bo‘sh qoldirsangiz avtomatik yaratiladi.' })}
        ${field({ name: 'sort_order', label: 'Tartib raqami', type: 'number', value: p.sort_order, attrs: 'min="0" max="10000"', hint: 'Kichik raqam — ro‘yxatda yuqorida.' })}
      </div>
      ${field({ name: 'is_active', label: 'Saytda faol (katalogda ko‘rinadi)', type: 'checkbox', value: p.is_active })}
      ${field({ name: 'is_available', label: 'Sotuvda (buyurtma qilish mumkin)', type: 'checkbox', value: p.is_available })}
      ${field({ name: 'is_demo', label: 'Demo yozuv (saytda "DEMO" belgisi bilan chiqadi)', type: 'checkbox', value: p.is_demo })}
      ${product ? '' : '<p class="text-muted">Narx marka yaratilgandan keyin «Narxlar» bo‘limida kiritiladi.</p>'}`,
    onOpen: (form) => {
      const rows = form.querySelector('[data-specs]');
      form.querySelector('[data-add-spec]').addEventListener('click', () => {
        rows.insertAdjacentHTML('beforeend', specRow());
        rows.lastElementChild.querySelector('input').focus();
      });
      rows.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-remove-spec]');
        if (btn) btn.closest('.spec-row').remove();
      });
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const specs = Array.from(form.querySelectorAll('.spec-row'))
        .map((row) => ({ label: row.querySelector('[name=spec_label]').value.trim(), value: row.querySelector('[name=spec_value]').value.trim() }))
        .filter((s) => s.label || s.value);
      const incomplete = specs.some((s) => !s.label || !s.value);
      localErrors(form, {
        grade_class: f.grade_class.value.trim() ? null : 'Markani kiriting.',
        name: f.name.value.trim().length >= 2 ? null : 'Nomini kiriting.',
        sort_order: Number(f.sort_order.value) >= 0 ? null : 'Musbat son kiriting.',
      });
      if (incomplete) {
        toast('Har bir xususiyatning nomi va qiymati to‘ldirilishi kerak.', 'warning');
        const err = new Error('validation');
        err.validation = true;
        throw err;
      }
      const body = {
        grade_class: f.grade_class.value.trim(),
        name: f.name.value.trim(),
        description: f.description.value.trim() || null,
        specs,
        slug: f.slug.value.trim() || null,
        sort_order: Number(f.sort_order.value) || 0,
        is_active: f.is_active.checked,
        is_available: f.is_available.checked,
        is_demo: f.is_demo.checked,
      };
      if (product) await http(`/admin/products/${product.id}`, { method: 'PATCH', body });
      else await http('/admin/products', { method: 'POST', body });
      toast(product ? 'Marka saqlandi.' : 'Marka qo‘shildi. Endi narxini kiriting.', 'success');
      onSaved();
    },
  });
}
