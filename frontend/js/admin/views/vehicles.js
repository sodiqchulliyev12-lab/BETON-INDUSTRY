/**
 * Transport: o'z va ijaraga olingan mashinalar + kunlik qatnovlar jadvali (dispetcher uchun).
 * Transport soni va sig'imi kodda belgilanmagan.
 */
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { attachPhoneMask } from '../../validators.js';
import { todayISO } from '../../validators.js';
import {
  OWNERSHIP, PERM, TRIP_STATUS, VEHICLE_STATUS, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate,
  fmtDateTime, formModal, icon, loadingHtml, localErrors, money, numberOrNull, phoneLink, statusBadge, toast, volume,
} from '../components.js';

export async function render(ctx) {
  const { root, query, isCurrent } = ctx;
  const canManage = session.can(PERM.FLEET_MANAGE);
  const tab = query.get('tab') === 'trips' ? 'trips' : 'list';

  root.innerHTML = `
    <nav class="tabs">
      <a href="#/vehicles" class="${tab === 'list' ? 'is-active' : ''}">Transport ro‘yxati</a>
      <a href="#/vehicles?tab=trips" class="${tab === 'trips' ? 'is-active' : ''}">Kunlik qatnovlar</a>
    </nav>
    <div id="vehiclesView">${loadingHtml()}</div>`;
  const holder = root.querySelector('#vehiclesView');
  if (tab === 'trips') return renderTrips(ctx, holder);

  let vehicles;
  let drivers = [];
  try {
    [vehicles, drivers] = await Promise.all([http('/admin/vehicles'), http('/admin/drivers')]);
  } catch (err) {
    holder.innerHTML = errorHtml(err);
    holder.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  const active = vehicles.filter((v) => v.is_active);
  const count = (fn) => active.filter(fn).length;
  holder.innerHTML = `
    <div class="page-actions">
      <span class="text-muted">Faol: <strong>${active.length}</strong> · bo‘sh: <strong>${count((v) => v.status === 'free')}</strong>
        · band: <strong>${count((v) => v.status === 'busy')}</strong> · ta’mirda: <strong>${count((v) => v.status === 'repair')}</strong>
        · ijarada: <strong>${count((v) => v.ownership === 'rented')}</strong></span>
      <span class="page-actions__spacer"></span>
      ${canManage ? `<button type="button" class="btn btn--primary" data-create>${icon('i-plus')} Yangi transport</button>` : ''}
    </div>
    <section class="box">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Davlat raqami</th><th>Turi</th><th>Egasi</th><th class="num">Sig‘imi</th><th>Haydovchi</th><th>Holat</th><th class="num">Qatnovlar</th>${canManage ? '<th></th>' : ''}</tr></thead>
        <tbody>${vehicles.length ? vehicles.map((v) => `
          <tr data-id="${v.id}" class="${v.is_active ? '' : 'muted'}">
            <td class="strong nowrap">${escapeHtml(v.plate_number)}${v.is_active ? '' : ' <span class="badge badge--muted">Nofaol</span>'}</td>
            <td>${escapeHtml(v.vehicle_type)}</td>
            <td>${escapeHtml(OWNERSHIP[v.ownership])}${v.rental_company ? `<br><span class="muted">${escapeHtml(v.rental_company)}</span>` : ''}</td>
            <td class="num">${v.capacity_m3 !== null ? volume(v.capacity_m3) : '<span class="muted">Noma’lum</span>'}</td>
            <td>${v.default_driver_name ? `${escapeHtml(v.default_driver_name)}<br>${phoneLink(v.default_driver_phone)}` : (v.contact_phone ? phoneLink(v.contact_phone) : '<span class="muted">—</span>')}</td>
            <td>${statusBadge(v.status, VEHICLE_STATUS)}${v.active_trips ? `<br><span class="muted">${v.active_trips} ta faol qatnov</span>` : ''}</td>
            <td class="num">${v.trips_count}</td>
            ${canManage ? `<td class="num nowrap">
              ${v.status === 'repair'
                ? '<button type="button" class="btn btn--outline btn--sm" data-repair="free">Ta’mirdan chiqarish</button>'
                : (v.status === 'free' ? '<button type="button" class="btn btn--outline btn--sm" data-repair="repair">Ta’mirga</button>' : '')}
              <button type="button" class="icon-btn" data-edit aria-label="Tahrirlash" title="Tahrirlash">${icon('i-edit')}</button>
              ${v.trips_count === 0 ? `<button type="button" class="icon-btn" data-delete aria-label="O‘chirish" title="O‘chirish">${icon('i-trash')}</button>` : ''}
            </td>` : ''}
          </tr>`).join('') : emptyRow(canManage ? 8 : 7, 'Transport hali kiritilmagan. «Yangi transport» orqali o‘zingizning va ijaraga olingan mashinalarni qo‘shing.')}
        </tbody></table></div>
    </section>`;

  holder.querySelector('[data-create]')?.addEventListener('click', () => vehicleForm(null, drivers, () => render(ctx)));
  holder.querySelectorAll('tr[data-id]').forEach((row) => {
    const vehicle = vehicles.find((v) => v.id === Number(row.dataset.id));
    row.querySelector('[data-edit]')?.addEventListener('click', () => vehicleForm(vehicle, drivers, () => render(ctx)));
    row.querySelector('[data-repair]')?.addEventListener('click', async (e) => {
      try {
        await http(`/admin/vehicles/${vehicle.id}/status`, { method: 'POST', body: { status: e.currentTarget.dataset.repair } });
        toast('Holat saqlandi.', 'success', 2500);
        render(ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    row.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Transportni o‘chirish', text: `${vehicle.plate_number} o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/vehicles/${vehicle.id}`, { method: 'DELETE' });
        toast('O‘chirildi.', 'success');
        render(ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function vehicleForm(vehicle, drivers, onSaved) {
  const v = vehicle || { plate_number: '', vehicle_type: 'Beton mikser', ownership: 'own', capacity_m3: null, default_driver_id: null, contact_phone: '', rental_company: '', status: 'free', is_active: true, notes: '' };
  const driverOptions = [{ value: '', label: '— tanlanmagan —' }].concat(
    drivers.filter((d) => d.is_active || d.id === v.default_driver_id).map((d) => ({ value: d.id, label: d.full_name })),
  );
  formModal({
    title: vehicle ? `${vehicle.plate_number} — tahrirlash` : 'Yangi transport',
    body: `
      <div class="form-row">
        ${field({ name: 'plate_number', label: 'Davlat raqami', value: v.plate_number, required: true, attrs: 'maxlength="20" placeholder="01 A 123 BC" autocapitalize="characters"' })}
        ${field({ name: 'vehicle_type', label: 'Transport turi', value: v.vehicle_type, required: true, attrs: 'maxlength="50" placeholder="Beton mikser"' })}
      </div>
      <div class="form-row">
        ${field({ name: 'ownership', label: 'Egasi', options: Object.entries(OWNERSHIP).map(([value, label]) => ({ value, label })), value: v.ownership })}
        ${field({ name: 'capacity_m3', label: 'Sig‘imi (m³)', value: v.capacity_m3 ?? '', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Noma’lum bo‘lsa bo‘sh qoldiring — tizim taxmin qilmaydi.' })}
      </div>
      <div data-rented>${field({ name: 'rental_company', label: 'Ijaraga beruvchi', value: v.rental_company, attrs: 'maxlength="200"' })}</div>
      <div class="form-row">
        ${field({ name: 'default_driver_id', label: 'Doimiy haydovchi', options: driverOptions, value: v.default_driver_id ?? '' })}
        ${field({ name: 'contact_phone', label: 'Aloqa telefoni', type: 'tel', value: v.contact_phone, attrs: 'inputmode="tel"', hint: 'Masalan, ijara kompaniyasi yoki mashina telefoni.' })}
      </div>
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, value: v.notes, attrs: 'maxlength="1000"' })}
      ${field({ name: 'is_active', label: 'Faol (qatnovga biriktirish mumkin)', type: 'checkbox', value: v.is_active })}`,
    onOpen: (form) => {
      attachPhoneMask(form.elements.contact_phone);
      const rented = form.querySelector('[data-rented]');
      const sync = () => { rented.hidden = form.elements.ownership.value !== 'rented'; };
      form.elements.ownership.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const capacity = numberOrNull(f.capacity_m3.value);
      localErrors(form, {
        plate_number: /^[A-Z0-9]{4,12}$/.test(f.plate_number.value.replace(/[\s-]/g, '').toUpperCase()) ? null : 'Davlat raqamini to‘g‘ri kiriting.',
        vehicle_type: f.vehicle_type.value.trim().length >= 2 ? null : 'Turini kiriting.',
        capacity_m3: Number.isNaN(capacity) || (capacity !== null && capacity <= 0) ? 'Musbat son kiriting yoki bo‘sh qoldiring.' : null,
      });
      const body = {
        plate_number: f.plate_number.value,
        vehicle_type: f.vehicle_type.value.trim(),
        ownership: f.ownership.value,
        capacity_m3: capacity,
        default_driver_id: f.default_driver_id.value ? Number(f.default_driver_id.value) : null,
        contact_phone: f.contact_phone.value.replace(/\D/g, '').length > 3 ? f.contact_phone.value : null,
        rental_company: f.ownership.value === 'rented' ? (f.rental_company.value.trim() || null) : null,
        status: v.status,
        is_active: f.is_active.checked,
        notes: f.notes.value.trim() || null,
      };
      if (vehicle) await http(`/admin/vehicles/${vehicle.id}`, { method: 'PUT', body });
      else await http('/admin/vehicles', { method: 'POST', body });
      toast('Transport saqlandi.', 'success');
      onSaved();
    },
  });
}

/* --- Kunlik qatnovlar --- */

async function renderTrips(ctx, holder) {
  const { query, isCurrent } = ctx;
  const day = query.get('date') || todayISO();
  let trips;
  try {
    trips = await http(`/admin/trips${qs({ date: day })}`);
  } catch (err) {
    holder.innerHTML = errorHtml(err);
    holder.querySelector('[data-retry]').addEventListener('click', () => renderTrips(ctx, holder));
    return;
  }
  if (!isCurrent()) return;

  const total = trips.filter((t) => t.status !== 'cancelled').reduce((s, t) => s + t.volume_m3, 0);
  holder.innerHTML = `
    <div class="page-actions">
      <label class="text-muted" for="tripsDate">Sana:</label>
      <input class="input" type="date" id="tripsDate" value="${escapeHtml(day)}">
      <span class="text-muted">${trips.length} ta qatnov · ${escapeHtml(volume(total))}</span>
    </div>
    <section class="box">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Buyurtma</th><th>№</th><th>Transport</th><th>Haydovchi</th><th class="num">Hajm</th><th>Holat</th><th>Yuklandi</th><th>Yetkazildi</th><th class="num">Ijara</th></tr></thead>
        <tbody>${trips.length ? trips.map((t) => `
          <tr class="is-link" data-href="#/orders/${t.order_id}">
            <td class="strong"><a href="#/orders/${t.order_id}">${escapeHtml(t.order_number)}</a></td>
            <td>${t.trip_no}</td>
            <td class="nowrap">${escapeHtml(t.plate_number)}<br><span class="muted">${escapeHtml(OWNERSHIP[t.ownership])}</span></td>
            <td>${t.driver_name ? `${escapeHtml(t.driver_name)}<br>${phoneLink(t.driver_phone)}` : '<span class="muted">—</span>'}</td>
            <td class="num">${volume(t.volume_m3)}</td>
            <td>${statusBadge(t.status, TRIP_STATUS)}</td>
            <td class="nowrap muted">${fmtDateTime(t.loaded_at)}</td>
            <td class="nowrap muted">${fmtDateTime(t.delivered_at)}</td>
            <td class="num">${t.rental_cost !== null ? money(t.rental_cost) : '—'}</td>
          </tr>`).join('') : emptyRow(9, `${fmtDate(day)} uchun qatnovlar yo‘q. Qatnov buyurtma sahifasidan qo‘shiladi.`)}
        </tbody></table></div>
    </section>`;

  holder.querySelector('#tripsDate').addEventListener('change', (e) => setQuery({ tab: 'trips', date: e.target.value }));
  holder.querySelectorAll('tr[data-href]').forEach((row) => row.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = row.dataset.href;
  }));
}
