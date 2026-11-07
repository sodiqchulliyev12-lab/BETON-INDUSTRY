/**
 * Buyurtmalar: ro'yxat (#/orders) va tafsilot (#/orders/:id).
 * Holat o'zgartirish tugmalari server qaytargan allowed_statuses asosida chiziladi —
 * foydalanuvchi roli ruxsat bermagan holat tugmasi umuman ko'rinmaydi.
 */
import { debounce } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { createPicker, osmLink, showRouteMap, toPoint } from '../../map.js';
import {
  ORDER_STATUS, OWNERSHIP, PERM, TRIP_STATUS, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate,
  fmtDateTime, fmtTime, formModal, icon, loadingHtml, localErrors, money, numberOrNull, paginationHtml, phoneLink,
  statusBadge, toast, volume,
} from '../components.js';

export async function render(ctx) {
  if (ctx.parts[1]) return renderDetail(ctx, Number(ctx.parts[1]));
  return renderList(ctx);
}

/* ==========================================================================
   Ro'yxat
   ========================================================================== */

async function renderList({ root, query, isCurrent }) {
  const filters = {
    q: query.get('q') || '',
    status: query.get('status') || '',
    date_from: query.get('date_from') || '',
    date_to: query.get('date_to') || '',
    page: Number(query.get('page')) || 1,
  };

  root.innerHTML = `
    <div class="page-actions">
      <input class="input search" type="search" name="q" placeholder="Raqam, ism yoki telefon" value="${escapeHtml(filters.q)}" aria-label="Qidirish">
      <select class="select" name="status" aria-label="Holat">
        <option value="">Barcha holatlar</option>
        ${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${filters.status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <label class="text-muted">Sana:</label>
      <input class="input" type="date" name="date_from" value="${escapeHtml(filters.date_from)}" aria-label="Yetkazish sanasi (dan)">
      <input class="input" type="date" name="date_to" value="${escapeHtml(filters.date_to)}" aria-label="Yetkazish sanasi (gacha)">
      ${filters.q || filters.status || filters.date_from || filters.date_to ? '<button type="button" class="btn btn--outline btn--sm" data-reset>Tozalash</button>' : ''}
    </div>
    <section class="box" id="ordersBox">${loadingHtml()}</section>`;

  const bar = root.querySelector('.page-actions');
  bar.querySelector('[name=q]').addEventListener('input', debounce((e) => setQuery({ q: e.target.value.trim(), page: '' }), 400));
  bar.querySelectorAll('select, input[type=date]').forEach((input) => {
    input.addEventListener('change', () => setQuery({ [input.name]: input.value, page: '' }));
  });
  bar.querySelector('[data-reset]')?.addEventListener('click', () => setQuery({ q: '', status: '', date_from: '', date_to: '', page: '' }));

  const box = root.querySelector('#ordersBox');
  let page;
  try {
    page = await http(`/admin/orders${qs({ ...filters, page_size: 20 })}`);
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => renderList({ root, query, isCurrent }));
    return;
  }
  if (!isCurrent()) return;

  const anyFilter = filters.q || filters.status || filters.date_from || filters.date_to;
  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Raqam</th><th>Holat</th><th>Mijoz</th><th>Marka</th><th class="num">Hajm</th>
          <th>Yetkazish</th><th class="num">Summa</th><th>Yaratilgan</th>
        </tr></thead>
        <tbody>
          ${page.items.length ? page.items.map((o) => `
            <tr class="is-link" data-href="#/orders/${o.id}" tabindex="0">
              <td class="strong nowrap"><a href="#/orders/${o.id}">${escapeHtml(o.order_number)}</a></td>
              <td>${statusBadge(o.status)}</td>
              <td>${escapeHtml(o.customer_name)}<br><span class="muted">${escapeHtml(o.customer_phone)}</span></td>
              <td>${escapeHtml(o.products)}</td>
              <td class="num">${volume(o.volume_m3)}</td>
              <td class="nowrap">${fmtDate(o.delivery_date)} ${escapeHtml(fmtTime(o.delivery_time))}<br>
                <span class="muted">${o.delivery_required ? 'Yetkazib berish' : 'O‘zi olib ketadi'}</span></td>
              <td class="num">${o.grand_total !== null ? money(o.grand_total, o.currency)
                : o.concrete_total !== null ? `${money(o.concrete_total, o.currency)}<br><span class="muted">+ yetkazish</span>` : money(null)}</td>
              <td class="nowrap muted">${fmtDateTime(o.created_at)}</td>
            </tr>`).join('') : emptyRow(8, anyFilter ? 'Filtr bo‘yicha buyurtma topilmadi.' : 'Hali buyurtmalar yo‘q. Saytdan kelgan buyurtmalar shu yerda ko‘rinadi.')}
        </tbody>
      </table>
    </div>
    ${paginationHtml(page)}`;

  box.querySelectorAll('tr[data-href]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (!e.target.closest('a')) location.hash = row.dataset.href;
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') location.hash = row.dataset.href;
    });
  });
  box.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => setQuery({ page: btn.dataset.page })));
}

/* ==========================================================================
   Tafsilot
   ========================================================================== */

async function renderDetail(ctx, orderId) {
  const { root, isCurrent, setTitle } = ctx;
  root.innerHTML = loadingHtml();
  let order;
  try {
    order = await http(`/admin/orders/${orderId}`);
  } catch (err) {
    if (!isCurrent()) return;
    root.innerHTML = `<a class="back-link" href="#/orders">← Buyurtmalar</a>${errorHtml(err)}`;
    root.querySelector('[data-retry]').addEventListener('click', () => renderDetail(ctx, orderId));
    return;
  }
  if (!isCurrent()) return;
  setTitle(`Buyurtma ${order.order_number}`);
  draw(ctx, order);
}

/* ==========================================================================
   Transport va qatnovlar, hajmlar
   ========================================================================== */

function miniStat(label, value, warn = false) {
  return `<div class="mini-stat${warn ? ' mini-stat--warn' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(volume(value))}</strong></div>`;
}

function progress(done, total) {
  const pct = total > 0 ? Math.min((done / total) * 100, 100) : 0;
  return `<svg class="progress" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect width="${pct.toFixed(1)}" height="8" rx="4"/></svg>`;
}

async function loadLogistics(box, order) {
  box.innerHTML = loadingHtml('Qatnovlar yuklanmoqda…');
  try {
    const data = await http(`/admin/orders/${order.id}/logistics`);
    drawLogistics(box, order, data);
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => loadLogistics(box, order));
  }
}

function drawLogistics(box, order, data) {
  const v = data.volumes;
  const canTrips = session.can(PERM.TRIPS_MANAGE) && order.delivery_required && !['delivered', 'cancelled'].includes(order.status);
  const redraw = (next) => drawLogistics(box, order, next);

  box.innerHTML = `
    <div class="box__head">
      <h3 class="box__title">Ishlab chiqarish va yetkazish</h3>
      ${canTrips && v.unassigned > 0 ? `<button type="button" class="btn btn--primary btn--sm" data-add-trip>${icon('i-plus')} Qatnov qo‘shish</button>` : ''}
    </div>
    <div class="mini-stats">
      ${miniStat('Buyurtma', v.ordered)}
      ${miniStat('Ishlab chiqarilgan', v.produced)}
      ${miniStat('Sifatdan o‘tgan', v.qc_passed)}
      ${order.delivery_required ? miniStat('Qatnovga biriktirilmagan', v.unassigned, v.unassigned > 0) : ''}
      ${miniStat('Yuklangan', v.loaded)}
      ${miniStat('Yetkazilgan', v.delivered)}
      ${miniStat('Qolgan', v.remaining, v.remaining > 0)}
    </div>
    <div class="box__body">
      <span class="text-muted">Yetkazish jarayoni: ${escapeHtml(volume(v.delivered))} / ${escapeHtml(volume(v.ordered))}</span>
      ${progress(v.delivered, v.ordered)}
      ${v.rental_cost_total > 0 ? `<p class="text-muted mt-5">Ijara transporti xarajati: <strong>${money(v.rental_cost_total)}</strong></p>` : ''}
    </div>
    ${order.delivery_required ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>№</th><th>Transport</th><th>Haydovchi</th><th class="num">Hajm</th><th>Holat</th><th class="num">Ijara</th>${canTrips ? '<th></th>' : ''}</tr></thead>
        <tbody>${data.trips.length ? data.trips.map((t) => `
          <tr data-trip="${t.id}">
            <td>${t.trip_no}</td>
            <td class="nowrap"><strong>${escapeHtml(t.plate_number)}</strong><br><span class="muted">${escapeHtml(OWNERSHIP[t.ownership])}</span></td>
            <td>${t.driver_name ? `${escapeHtml(t.driver_name)}<br>${phoneLink(t.driver_phone)}` : '<span class="muted">—</span>'}</td>
            <td class="num">${volume(t.volume_m3)}</td>
            <td>${statusBadge(t.status, TRIP_STATUS)}${t.delivered_at ? `<br><span class="muted">${fmtDateTime(t.delivered_at)}</span>` : ''}</td>
            <td class="num">${t.rental_cost !== null ? money(t.rental_cost) : '—'}</td>
            ${canTrips ? `<td class="num nowrap">
              ${t.allowed_statuses.filter((s) => s !== 'cancelled').map((s) => `<button type="button" class="btn btn--outline btn--sm" data-trip-status="${s}">${escapeHtml(TRIP_STATUS[s])}</button>`).join(' ')}
              ${['delivered', 'cancelled'].includes(t.status) ? '' : `<button type="button" class="icon-btn" data-trip-edit title="Tahrirlash" aria-label="Qatnovni tahrirlash">${icon('i-edit')}</button>`}
              ${t.status === 'planned' ? `<button type="button" class="icon-btn" data-trip-delete title="O‘chirish" aria-label="Qatnovni o‘chirish">${icon('i-trash')}</button>`
                : t.allowed_statuses.includes('cancelled') ? `<button type="button" class="icon-btn" data-trip-status="cancelled" title="Bekor qilish" aria-label="Qatnovni bekor qilish">${icon('i-close')}</button>` : ''}
            </td>` : ''}
          </tr>`).join('') : emptyRow(canTrips ? 7 : 6, 'Qatnovlar hali biriktirilmagan.')}
        </tbody></table></div>` : '<div class="box__body text-muted">Mijoz betonni o‘zi olib ketadi — qatnov kerak emas.</div>'}`;

  box.querySelector('[data-add-trip]')?.addEventListener('click', () => tripForm(order, null, v, redraw));
  box.querySelectorAll('tr[data-trip]').forEach((row) => {
    const trip = data.trips.find((t) => t.id === Number(row.dataset.trip));
    row.querySelectorAll('[data-trip-status]').forEach((btn) => btn.addEventListener('click', async () => {
      const status = btn.dataset.tripStatus;
      if (status === 'cancelled' && !(await confirmAction({ title: 'Qatnovni bekor qilish', text: `${trip.trip_no}-qatnov (${trip.plate_number}) bekor qilinadi.`, confirmLabel: 'Bekor qilish' }))) return;
      btn.disabled = true;
      try {
        redraw(await http(`/admin/trips/${trip.id}/status`, { method: 'POST', body: { status } }));
        toast(`Qatnov: ${TRIP_STATUS[status]}`, 'success', 2500);
      } catch (err) {
        btn.disabled = false;
        toast(err.message, 'error');
      }
    }));
    row.querySelector('[data-trip-edit]')?.addEventListener('click', () => tripForm(order, trip, v, redraw));
    row.querySelector('[data-trip-delete]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Qatnovni o‘chirish', text: `${trip.trip_no}-qatnov o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/trips/${trip.id}`, { method: 'DELETE' });
        toast('Qatnov o‘chirildi.', 'success');
        loadLogistics(box, order);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

async function tripForm(order, trip, volumes, redraw) {
  let vehicles;
  let drivers;
  try {
    [vehicles, drivers] = await Promise.all([http('/admin/vehicles'), http('/admin/drivers')]);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  const usable = vehicles.filter((v) => (v.is_active && v.status !== 'repair') || (trip && v.id === trip.vehicle_id));
  if (!usable.length) {
    toast('Faol transport yo‘q. Avval «Transport» bo‘limida mashina qo‘shing.', 'warning');
    return;
  }
  const available = volumes.unassigned + (trip ? trip.volume_m3 : 0);
  const vehicleLabel = (v) => `${v.plate_number} — ${v.vehicle_type}, ${OWNERSHIP[v.ownership].toLowerCase()}${v.capacity_m3 !== null ? `, ${v.capacity_m3} m³` : ''}${v.status === 'busy' ? ' (band)' : ''}`;
  const defaultVehicle = trip ? trip.vehicle_id : usable[0].id;
  const defaultVolume = trip ? trip.volume_m3 : (() => {
    const cap = usable[0].capacity_m3;
    return cap !== null ? Math.min(cap, available) : available;
  })();

  formModal({
    title: trip ? `${trip.trip_no}-qatnovni tahrirlash` : 'Yangi qatnov',
    body: `
      <p class="text-muted">Biriktirish mumkin bo‘lgan hajm: <strong>${escapeHtml(volume(available))}</strong></p>
      ${field({ name: 'vehicle_id', label: 'Transport', required: true, value: defaultVehicle,
        options: usable.map((v) => ({ value: v.id, label: vehicleLabel(v) })),
        attrs: trip && trip.status !== 'planned' ? 'disabled' : '' })}
      ${field({ name: 'driver_id', label: 'Haydovchi', value: trip ? (trip.driver_id ?? '') : '',
        options: [{ value: '', label: trip ? '— tanlanmagan —' : 'Mashinaning doimiy haydovchisi' }].concat(drivers.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.full_name }))) })}
      ${field({ name: 'volume_m3', label: 'Hajm (m³)', value: defaultVolume, required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      <div data-rental>${field({ name: 'rental_cost', label: 'Ijara xarajati (so‘m)', value: trip?.rental_cost ?? '', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Ijaraga olingan transport uchun shu qatnov narxi.' })}</div>
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, value: trip?.notes ?? '', attrs: 'maxlength="500"' })}`,
    onOpen: (form) => {
      const rental = form.querySelector('[data-rental]');
      const sync = () => {
        const v = vehicles.find((x) => x.id === Number(form.elements.vehicle_id.value));
        rental.hidden = !v || v.ownership !== 'rented';
      };
      form.elements.vehicle_id.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const vol = numberOrNull(f.volume_m3.value);
      const vehicle = vehicles.find((x) => x.id === Number(f.vehicle_id.value));
      const rental = vehicle && vehicle.ownership === 'rented' ? numberOrNull(f.rental_cost.value) : null;
      localErrors(form, {
        volume_m3: vol === null || Number.isNaN(vol) || vol <= 0 ? 'Hajmni kiriting.'
          : vol > available + 1e-9 ? `Ko‘pi bilan ${volume(available)}.`
            : vehicle && vehicle.capacity_m3 !== null && vol > vehicle.capacity_m3 ? `Mashina sig‘imi ${vehicle.capacity_m3} m³.` : null,
        rental_cost: Number.isNaN(rental) || (rental !== null && rental < 0) ? 'Musbat son kiriting.' : null,
      });
      const body = {
        driver_id: f.driver_id.value ? Number(f.driver_id.value) : null,
        volume_m3: vol,
        rental_cost: rental,
        notes: f.notes.value.trim() || null,
      };
      if (!trip || trip.status === 'planned') body.vehicle_id = Number(f.vehicle_id.value);
      const data = trip
        ? await http(`/admin/trips/${trip.id}`, { method: 'PATCH', body })
        : await http(`/admin/orders/${order.id}/trips`, { method: 'POST', body });
      toast(trip ? 'Qatnov saqlandi.' : 'Qatnov qo‘shildi.', 'success');
      redraw(data);
    },
  });
}

function draw(ctx, order) {
  const { root } = ctx;
  const canManage = session.can(PERM.ORDERS_MANAGE);
  const locked = order.status === 'delivered' || order.status === 'cancelled';
  const editable = canManage && !locked;
  const redraw = (updated) => draw(ctx, updated);

  const deliveryPrice = !order.delivery_required
    ? '<span class="muted">Kerak emas</span>'
    : order.delivery_price_status === 'pending'
      ? '<span class="is-pending">Menejer tasdiqlashi kerak</span>'
      : money(order.delivery_price, order.currency);

  root.innerHTML = `
    <a class="back-link" href="#/orders">← Buyurtmalar</a>
    <div class="detail-head">
      <h2>${escapeHtml(order.order_number)}</h2>
      ${statusBadge(order.status)}
      <span class="page-actions__spacer"></span>
      ${editable ? `<button type="button" class="btn btn--outline btn--sm" data-action="edit">${icon('i-edit')} Tahrirlash</button>` : ''}
    </div>

    <div class="admin-grid admin-grid--main">
      <div class="admin-grid">
        <section class="box">
          <div class="box__head"><h3 class="box__title">Buyurtma ma’lumotlari</h3></div>
          <div class="box__body">
            <dl class="dl">
              <dt>Mijoz</dt><dd><a href="#/customers/${order.customer.id}">${escapeHtml(order.customer.full_name)}</a>${order.customer.company_name ? ` · ${escapeHtml(order.customer.company_name)}` : ''}</dd>
              <dt>Telefon</dt><dd>${phoneLink(order.customer.phone)}</dd>
              <dt>Turi</dt><dd>${order.delivery_required ? 'Yetkazib berish' : 'O‘zi olib ketadi'}</dd>
              ${order.delivery_required ? `<dt>Manzil</dt><dd class="pre-line">${escapeHtml(order.delivery_address || '—')}</dd>` : ''}
              <dt>${order.delivery_required ? 'Yetkazish' : 'Olib ketish'}</dt><dd>${fmtDate(order.delivery_date)} ${escapeHtml(fmtTime(order.delivery_time)) || '<span class="muted">(vaqt ko‘rsatilmagan)</span>'}</dd>
              <dt>Izoh</dt><dd class="pre-line">${order.comment ? escapeHtml(order.comment) : '<span class="muted">—</span>'}</dd>
              <dt>Manba</dt><dd>${order.source === 'website' ? 'Sayt' : 'Admin panel'}</dd>
              <dt>Yaratilgan</dt><dd>${fmtDateTime(order.created_at)}</dd>
              ${order.cancel_reason ? `<dt>Bekor qilish sababi</dt><dd class="pre-line">${escapeHtml(order.cancel_reason)}</dd>` : ''}
            </dl>
          </div>
        </section>

        <section class="box">
          <div class="box__head"><h3 class="box__title">Tarkibi va summa</h3></div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Marka</th><th class="num">Hajm</th><th class="num">1 m³ narxi</th><th class="num">Qiymati</th>${editable ? '<th></th>' : ''}</tr></thead>
              <tbody>${order.items.map((i) => `
                <tr>
                  <td><strong>${escapeHtml(i.grade_class)}</strong> — ${escapeHtml(i.product_name)}</td>
                  <td class="num">${volume(i.volume_m3)}</td>
                  <td class="num">${money(i.unit_price, order.currency, 'Belgilanmagan')}</td>
                  <td class="num">${money(i.line_total, order.currency)}</td>
                  ${editable ? `<td class="num"><button type="button" class="icon-btn" data-item="${i.id}" title="Narx va hajmni o‘zgartirish" aria-label="Qatorni tahrirlash">${icon('i-edit')}</button></td>` : ''}
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="box__body">
            <dl class="dl">
              <dt>Beton qiymati</dt><dd>${money(order.concrete_total, order.currency)}</dd>
              <dt>Yetkazib berish</dt><dd>${deliveryPrice}
                ${editable && order.delivery_required ? `<button type="button" class="btn btn--outline btn--sm" data-action="delivery">${order.delivery_price_status === 'pending' ? 'Narxni kiritish' : 'O‘zgartirish'}</button>` : ''}</dd>
            </dl>
            <div class="total-row"><span>Umumiy summa</span><strong>${money(order.grand_total, order.currency)}</strong></div>
            ${order.grand_total === null ? '<p class="text-muted">Umumiy summa beton narxi va yetkazib berish narxi tasdiqlangandan keyin aniqlanadi.</p>' : ''}
          </div>
        </section>

        <section class="box" id="logisticsBox"></section>
      </div>

      <div class="admin-grid">
        <section class="box">
          <div class="box__head"><h3 class="box__title">Holat</h3>${statusBadge(order.status)}</div>
          <div class="box__body">
            ${order.allowed_statuses.length ? `<p class="text-muted">Keyingi holatga o‘tkazish:</p>
              <div class="btn-row">${order.allowed_statuses.map((s) => `
                <button type="button" class="btn ${s === 'cancelled' ? 'btn--outline' : 'btn--primary'} btn--sm" data-status="${s}">${escapeHtml(ORDER_STATUS[s])}</button>`).join('')}
              </div>` : `<p class="text-muted">${locked ? 'Buyurtma yakunlangan.' : 'Holatni o‘zgartirish uchun ruxsatingiz yo‘q.'}</p>`}
          </div>
        </section>
        ${order.delivery_required ? `<section class="box">
          <div class="box__head"><h3 class="box__title">Xarita</h3>
            ${editable ? `<button type="button" class="btn btn--outline btn--sm" data-action="point">${order.delivery_lat !== null ? 'Nuqtani o‘zgartirish' : 'Nuqta belgilash'}</button>` : ''}</div>
          <div class="box__body">${mapSummary(order)}</div>
        </section>` : ''}
        <section class="box">
          <div class="box__head"><h3 class="box__title">Holatlar tarixi</h3></div>
          <div class="box__body">
            <ol class="timeline">${order.history.map((h) => `
              <li>${statusBadge(h.to_status)}
                <small>${fmtDateTime(h.created_at)} · ${escapeHtml(h.changed_by || 'Sayt')}</small>
                ${h.note ? `<div class="pre-line">${escapeHtml(h.note)}</div>` : ''}
              </li>`).join('')}
            </ol>
          </div>
        </section>
      </div>
    </div>`;

  loadLogistics(root.querySelector('#logisticsBox'), order);
  const routeBox = root.querySelector('[data-route-map]');
  if (routeBox) {
    showRouteMap(routeBox, {
      factory: toPoint(order.factory_lat, order.factory_lon),
      delivery: toPoint(order.delivery_lat, order.delivery_lon),
    }).catch(() => { routeBox.hidden = true; });
  }
  root.querySelector('[data-action=point]')?.addEventListener('click', () => editPoint(order, redraw));
  root.querySelector('[data-action=edit]')?.addEventListener('click', () => editOrder(order, redraw));
  root.querySelector('[data-action=delivery]')?.addEventListener('click', () => editDelivery(order, redraw));
  root.querySelectorAll('[data-item]').forEach((btn) => btn.addEventListener('click', () => {
    editItem(order, order.items.find((i) => i.id === Number(btn.dataset.item)), redraw);
  }));
  root.querySelectorAll('[data-status]').forEach((btn) => btn.addEventListener('click', () => changeStatus(order, btn.dataset.status, redraw)));
}

/* --- Xarita --- */

function mapSummary(order) {
  const delivery = toPoint(order.delivery_lat, order.delivery_lon);
  const factory = toPoint(order.factory_lat, order.factory_lon);
  if (!delivery && !factory) {
    return '<p class="text-muted">Mijoz xaritada nuqta belgilamagan. Zavod joylashuvi ham kiritilmagan (Tizim sozlamalari).</p>';
  }
  return `
    <div class="map-box" data-route-map></div>
    ${delivery ? '' : '<p class="text-muted mt-5">Mijoz xaritada nuqta belgilamagan — manzil matni bo‘yicha aniqlang.</p>'}
    ${order.distance_km !== null ? `<p class="mt-5"><strong>≈ ${escapeHtml(String(order.distance_km).replace('.', ','))} km</strong>
      <span class="text-muted">— zavoddan to‘g‘ri chiziq bo‘yicha. Yo‘l masofasi uzunroq bo‘ladi; yetkazib berish narxini menejer belgilaydi.</span></p>` : ''}
    ${delivery && !factory ? '<p class="text-muted">Masofani ko‘rish uchun Tizim sozlamalarida zavod joylashuvini kiriting.</p>' : ''}
    ${delivery ? `<div class="map-links">
      <a href="${escapeHtml(osmLink(delivery))}" target="_blank" rel="noopener">Nuqtani OpenStreetMap’da ochish ↗</a>
      ${factory ? `<a href="https://www.openstreetmap.org/directions?from=${factory.lat}%2C${factory.lon}&amp;to=${delivery.lat}%2C${delivery.lon}" target="_blank" rel="noopener">Yo‘nalish ↗</a>` : ''}
    </div>` : ''}`;
}

function editPoint(order, redraw) {
  let point = toPoint(order.delivery_lat, order.delivery_lon);
  formModal({
    title: 'Yetkazish nuqtasi',
    submitLabel: 'Saqlash',
    body: `<p class="text-muted">Manzil: ${escapeHtml(order.delivery_address || '—')}</p><div data-picker></div>`,
    onOpen: (form) => {
      createPicker(form.querySelector('[data-picker]'), {
        initial: point,
        factory: toPoint(order.factory_lat, order.factory_lon),
        reverse: false,
        onChange: (p) => { point = p; },
      }).catch((err) => { form.querySelector('[data-picker]').textContent = err.message; });
    },
    onSubmit: async () => {
      const updated = await http(`/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { delivery_lat: point ? point.lat : null, delivery_lon: point ? point.lon : null },
      });
      toast(point ? 'Nuqta saqlandi.' : 'Nuqta olib tashlandi.', 'success');
      redraw(updated);
    },
  });
}

/* --- Amallar --- */

function changeStatus(order, status, redraw) {
  const cancelling = status === 'cancelled';
  formModal({
    title: `«${ORDER_STATUS[status]}» holatiga o‘tkazish`,
    submitLabel: cancelling ? 'Bekor qilish' : 'Tasdiqlash',
    danger: cancelling,
    body: `
      <p>Buyurtma <strong>${escapeHtml(order.order_number)}</strong>: ${escapeHtml(ORDER_STATUS[order.status])} → <strong>${escapeHtml(ORDER_STATUS[status])}</strong></p>
      ${cancelling ? field({ name: 'cancel_reason', label: 'Bekor qilish sababi', type: 'textarea', required: true, attrs: 'maxlength="500"' }) : ''}
      ${field({ name: 'note', label: 'Izoh (ixtiyoriy)', type: 'textarea', rows: 2, attrs: 'maxlength="500"' })}`,
    onSubmit: async (form) => {
      const reason = form.elements.cancel_reason?.value.trim();
      if (cancelling) localErrors(form, { cancel_reason: reason ? null : 'Sababni yozing.' });
      const updated = await http(`/admin/orders/${order.id}/status`, {
        method: 'POST',
        body: { status, note: form.elements.note.value.trim() || null, cancel_reason: cancelling ? reason : null },
      });
      toast(`Holat o‘zgartirildi: ${ORDER_STATUS[status]}`, 'success');
      redraw(updated);
    },
  });
}

function editDelivery(order, redraw) {
  formModal({
    title: 'Yetkazib berish narxi',
    body: `
      ${field({ name: 'delivery_price', label: 'Narx (so‘m)', type: 'text', value: order.delivery_price ?? '', required: true, attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Bepul bo‘lsa 0 kiriting. Bo‘sh qoldirsangiz — "menejer tasdiqlaydi" holatiga qaytadi.' })}
      <p class="text-muted">Manzil: ${escapeHtml(order.delivery_address || '—')}</p>`,
    onSubmit: async (form) => {
      const price = numberOrNull(form.elements.delivery_price.value);
      localErrors(form, { delivery_price: Number.isNaN(price) || (price !== null && price < 0) ? 'Musbat son kiriting.' : null });
      const updated = await http(`/admin/orders/${order.id}`, { method: 'PATCH', body: { delivery_price: price } });
      toast('Yetkazib berish narxi saqlandi.', 'success');
      redraw(updated);
    },
  });
}

function editItem(order, item, redraw) {
  formModal({
    title: `${item.grade_class} — narx va hajm`,
    body: `
      ${field({ name: 'unit_price', label: '1 m³ narxi (so‘m)', value: item.unit_price ?? '', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Buyurtma uchun kelishilgan narx. Katalogdagi narx o‘zgarmaydi.' })}
      ${field({ name: 'volume_m3', label: 'Hajm (m³)', value: item.volume_m3, required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}`,
    onSubmit: async (form) => {
      const unitPrice = numberOrNull(form.elements.unit_price.value);
      const vol = numberOrNull(form.elements.volume_m3.value);
      localErrors(form, {
        unit_price: Number.isNaN(unitPrice) || (unitPrice !== null && unitPrice < 0) ? 'Musbat son kiriting.' : null,
        volume_m3: vol === null || Number.isNaN(vol) || vol <= 0 ? 'Hajmni kiriting.' : null,
      });
      const updated = await http(`/admin/orders/${order.id}/items/${item.id}`, {
        method: 'PATCH',
        body: { unit_price: unitPrice, volume_m3: vol },
      });
      toast('Buyurtma qatori yangilandi.', 'success');
      redraw(updated);
    },
  });
}

function editOrder(order, redraw) {
  formModal({
    title: 'Buyurtmani tahrirlash',
    body: `
      ${order.delivery_required ? field({ name: 'delivery_address', label: 'Yetkazib berish manzili', type: 'textarea', value: order.delivery_address, required: true, rows: 2, attrs: 'maxlength="500"' }) : ''}
      <div class="form-row">
        ${field({ name: 'delivery_date', label: 'Sana', type: 'date', value: order.delivery_date, required: true })}
        ${field({ name: 'delivery_time', label: 'Vaqt', type: 'time', value: fmtTime(order.delivery_time) })}
      </div>
      ${field({ name: 'comment', label: 'Izoh', type: 'textarea', value: order.comment, attrs: 'maxlength="1000"' })}`,
    onSubmit: async (form) => {
      const body = {
        delivery_date: form.elements.delivery_date.value || null,
        delivery_time: form.elements.delivery_time.value || null,
        comment: form.elements.comment.value.trim() || null,
      };
      if (order.delivery_required) body.delivery_address = form.elements.delivery_address.value.trim() || null;
      localErrors(form, {
        delivery_date: body.delivery_date ? null : 'Sanani kiriting.',
        delivery_address: order.delivery_required && !body.delivery_address ? 'Manzilni kiriting.' : null,
      });
      const updated = await http(`/admin/orders/${order.id}`, { method: 'PATCH', body });
      toast('Buyurtma saqlandi.', 'success');
      redraw(updated);
    },
  });
}
