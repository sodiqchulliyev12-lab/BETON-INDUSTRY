/** Haydovchilar. Soni kodda belgilanmagan — hammasi shu yerdan kiritiladi. */
import { http } from '../http.js';
import { session } from '../auth.js';
import { attachPhoneMask, validatePhone } from '../../validators.js';
import {
  EMPLOYMENT, PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, formModal, icon, loadingHtml,
  localErrors, phoneLink, toast,
} from '../components.js';

export async function render(ctx) {
  const { root, isCurrent } = ctx;
  const canManage = session.can(PERM.FLEET_MANAGE);
  root.innerHTML = `
    <div class="page-actions">
      <p class="text-muted">Shtatdagi va shartnoma asosida ishlaydigan haydovchilar. Transportga doimiy haydovchi
        biriktirilsa, qatnov yaratilganda u avtomatik tanlanadi.</p>
      <span class="page-actions__spacer"></span>
      ${canManage ? `<button type="button" class="btn btn--primary" data-create>${icon('i-plus')} Yangi haydovchi</button>` : ''}
    </div>
    <section class="box" id="driversBox">${loadingHtml()}</section>`;
  root.querySelector('[data-create]')?.addEventListener('click', () => driverForm(null, () => render(ctx)));

  const box = root.querySelector('#driversBox');
  let drivers;
  try {
    drivers = await http('/admin/drivers');
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  box.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Ism</th><th>Telefon</th><th>Guvohnoma</th><th>Turi</th><th>Holat</th><th class="num">Qatnovlar</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${drivers.length ? drivers.map((d) => `
        <tr data-id="${d.id}">
          <td class="strong">${escapeHtml(d.full_name)}${d.notes ? `<br><span class="muted">${escapeHtml(d.notes)}</span>` : ''}</td>
          <td class="nowrap">${phoneLink(d.phone)}</td>
          <td>${escapeHtml(d.license_number || '—')}</td>
          <td>${escapeHtml(EMPLOYMENT[d.employment])}</td>
          <td>${d.is_active ? '<span class="status status--delivered">Faol</span>' : '<span class="status status--cancelled">Nofaol</span>'}</td>
          <td class="num">${d.trips_count}</td>
          ${canManage ? `<td class="num nowrap">
            <button type="button" class="icon-btn" data-edit aria-label="Tahrirlash" title="Tahrirlash">${icon('i-edit')}</button>
            ${d.trips_count === 0 ? `<button type="button" class="icon-btn" data-delete aria-label="O‘chirish" title="O‘chirish">${icon('i-trash')}</button>` : ''}
          </td>` : ''}
        </tr>`).join('') : emptyRow(canManage ? 7 : 6, 'Haydovchilar hali kiritilmagan.')}
      </tbody></table></div>`;

  box.querySelectorAll('tr[data-id]').forEach((row) => {
    const driver = drivers.find((d) => d.id === Number(row.dataset.id));
    row.querySelector('[data-edit]')?.addEventListener('click', () => driverForm(driver, () => render(ctx)));
    row.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Haydovchini o‘chirish', text: `«${driver.full_name}» o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/drivers/${driver.id}`, { method: 'DELETE' });
        toast('Haydovchi o‘chirildi.', 'success');
        render(ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function driverForm(driver, onSaved) {
  const d = driver || { full_name: '', phone: '', license_number: '', employment: 'staff', is_active: true, notes: '' };
  formModal({
    title: driver ? 'Haydovchini tahrirlash' : 'Yangi haydovchi',
    body: `
      ${field({ name: 'full_name', label: 'Ism-familiya', value: d.full_name, required: true, attrs: 'maxlength="150"' })}
      <div class="form-row">
        ${field({ name: 'phone', label: 'Telefon', type: 'tel', value: d.phone, required: true, attrs: 'inputmode="tel" placeholder="+998 (90) 123-45-67"' })}
        ${field({ name: 'license_number', label: 'Haydovchilik guvohnomasi', value: d.license_number, attrs: 'maxlength="30"' })}
      </div>
      ${field({ name: 'employment', label: 'Ishlash turi', options: Object.entries(EMPLOYMENT).map(([value, label]) => ({ value, label })), value: d.employment })}
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, value: d.notes, attrs: 'maxlength="1000"' })}
      ${field({ name: 'is_active', label: 'Faol (qatnovga biriktirish mumkin)', type: 'checkbox', value: d.is_active })}`,
    onOpen: (form) => attachPhoneMask(form.elements.phone),
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, {
        full_name: f.full_name.value.trim().length >= 2 ? null : 'Ismni kiriting.',
        phone: validatePhone(f.phone.value),
      });
      const body = {
        full_name: f.full_name.value.trim(),
        phone: f.phone.value,
        license_number: f.license_number.value.trim() || null,
        employment: f.employment.value,
        notes: f.notes.value.trim() || null,
        is_active: f.is_active.checked,
      };
      if (driver) await http(`/admin/drivers/${driver.id}`, { method: 'PUT', body });
      else await http('/admin/drivers', { method: 'POST', body });
      toast('Haydovchi saqlandi.', 'success');
      onSaved();
    },
  });
}
