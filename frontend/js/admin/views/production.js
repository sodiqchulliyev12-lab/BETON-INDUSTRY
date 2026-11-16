/**
 * Ishlab chiqarish. Reja yo'q — buyurtmalar (zayavkalar) «Buyurtmalar» bo'limidan o'zi keladi:
 *  - Yopilmagan buyurtmalar: ishlab chiqarilishi kerak bo'lganlar; qatordan «Ishlab chiqarildi» bosiladi.
 *  - Yakunlangan buyurtmalar: yetkazib bo'lingan buyurtmalar.
 *  - Ishlab chiqarilganlar: davr bo'yicha yozuvlar; xato bo'lsa nakladnoyni tahrirlash yoki o'chirish mumkin.
 * «Ishlab chiqarildi» tugmasi shu bo'limning har bir sahifasida sarlavha qatorida turadi.
 * Saqlangach nakladnoy (yuk xati) o'zi ochiladi.
 */
import { formatNumber, openModal } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { bindPeriod, periodFromQuery, rangeBar } from '../period.js';
import { attachPhoneMask } from '../../validators.js';
import { driverForm } from './drivers.js';
import {
  PERM, QC_STATUS, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, fmtDateTime, formModal, icon, loadingHtml, localErrors,
  numberOrNull, statusBadge, toast, volume, ORDER_STATUS,
} from '../components.js';

const nf = (v, d = 1) => formatNumber(v || 0, d);
const addBtn = (canManage) => (canManage ? `<button type="button" class="btn btn--primary" data-add-record>${icon('i-plus')} Ishlab chiqarildi</button>` : '');

export async function render(ctx) {
  const canManage = session.can(PERM.PRODUCTION_MANAGE);
  if (ctx.meta.route === 'production-made') return made(ctx, canManage);
  return orders(ctx, canManage, ctx.meta.route === 'production-closed' ? 'closed' : 'open');
}

/* ---------------------------------------------------------------- Buyurtmalar (zayavkalar) */

async function orders(ctx, canManage, state) {
  const { root } = ctx;
  root.innerHTML = `<div class="page-actions">${addBtn(canManage)}</div><div id="prodBody">${loadingHtml()}</div>`;
  const reload = () => render(ctx);
  root.querySelector('[data-add-record]')?.addEventListener('click', () => openRecordForm({ onSaved: reload }));
  let list;
  try {
    list = await http(`/admin/production/orders${qs({ state })}`);
  } catch (err) {
    root.querySelector('#prodBody').innerHTML = errorHtml(err);
    return;
  }
  if (!ctx.isCurrent()) return;
  const body = root.querySelector('#prodBody');
  body.innerHTML = `<section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Buyurtma</th><th>Mijoz</th><th>Manzil</th><th>Sana</th><th>Marka va hajm</th><th class="num">Qoldi</th><th>Holat</th>${canManage && state === 'open' ? '<th></th>' : ''}</tr></thead>
    <tbody>${list.length ? list.map((o) => {
    const left = Math.max(o.volume_m3 - o.produced_m3, 0);
    return `<tr data-id="${o.id}"><td class="strong nowrap"><a href="#/orders/${o.id}">${escapeHtml(o.order_number)}</a></td>
      <td>${escapeHtml(o.customer)}<br><span class="muted">${escapeHtml(o.phone)}</span></td><td>${o.address ? escapeHtml(o.address) : '<span class="muted">o‘zi olib ketadi</span>'}</td>
      <td class="nowrap">${escapeHtml(fmtDate(o.delivery_date))}${o.delivery_time ? `<br><span class="muted">${escapeHtml(o.delivery_time)}</span>` : ''}</td>
      <td>${o.items.map((i) => `<div><strong>${escapeHtml(i.name)}</strong> · ${nf(i.volume_m3)} m³ <span class="muted">(ishlab chiqarildi ${nf(i.produced_m3)})</span></div>`).join('')}</td>
      <td class="num ${left ? 'strong' : ''}">${left ? `${nf(left)} m³` : '✓'}</td><td>${escapeHtml(ORDER_STATUS[o.status] || o.status)}</td>
      ${canManage && state === 'open' ? `<td class="num nowrap"><button type="button" class="btn btn--primary btn--sm" data-make>Ishlab chiqarildi</button></td>` : ''}</tr>`;
  }).join('') : emptyRow(canManage && state === 'open' ? 8 : 7, state === 'open' ? 'Yopilmagan buyurtma yo‘q. Buyurtmalar «Buyurtmalar» bo‘limida shakllantiriladi.' : 'Yakunlangan buyurtma yo‘q.')}</tbody></table></div></section>`;
  body.querySelectorAll('tr[data-id]').forEach((row) => row.querySelector('[data-make]')?.addEventListener('click', () => openRecordForm({ orderId: Number(row.dataset.id), onSaved: reload })));
}

/* ---------------------------------------------------------------- Ishlab chiqarilganlar */

async function made(ctx, canManage) {
  const { root } = ctx;
  const { from, to } = periodFromQuery(ctx.query);
  root.innerHTML = `<div class="page-actions">${rangeBar({ from, to })}${addBtn(canManage)}</div><div id="prodBody">${loadingHtml()}</div>`;
  bindPeriod(root);
  const reload = () => render(ctx);
  root.querySelector('[data-add-record]')?.addEventListener('click', () => openRecordForm({ onSaved: reload }));
  let rows;
  try {
    rows = await http(`/admin/production/records${qs({ date_from: from, date_to: to })}`);
  } catch (err) {
    root.querySelector('#prodBody').innerHTML = errorHtml(err);
    return;
  }
  if (!ctx.isCurrent()) return;
  const total = rows.reduce((a, r) => a + Number(r.produced_volume_m3), 0);
  const body = root.querySelector('#prodBody');
  body.innerHTML = `<div class="stats"><div class="stat stat--accent"><span class="stat__label">Ishlab chiqarildi</span><span class="stat__value">${nf(total, 2)}<span class="stat__unit">m³</span></span><span class="stat__hint">${rows.length} ta yozuv</span></div></div>
    <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Vaqt</th><th>Buyurtma</th><th>Mijoz</th><th>Marka</th><th class="num">Hajm</th><th>Mikser</th><th>Haydovchi</th><th>Nakladnoy</th><th>Sifat nazorati</th>${canManage ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr data-record="${r.id}"><td class="nowrap">${escapeHtml(fmtDateTime(r.produced_at))}</td>
      <td>${r.order_id ? `<a href="#/orders/${r.order_id}">${escapeHtml(r.order_number)}</a>` : '—'}</td><td>${r.customer_name ? escapeHtml(r.customer_name) : '—'}</td><td><strong>${escapeHtml(r.product_name || r.grade_class)}</strong></td>
      <td class="num">${volume(r.produced_volume_m3)}</td><td class="nowrap">${r.plate_number ? escapeHtml(r.plate_number) : '—'}</td><td>${r.driver_name ? escapeHtml(r.driver_name) : '—'}</td>
      <td class="nowrap"><button type="button" class="btn btn--outline btn--sm" data-waybill>${escapeHtml(r.waybill_no || 'Nakladnoy')}</button></td>
      <td>${statusBadge(r.qc_status, QC_STATUS)}${r.qc_notes ? `<br><span class="muted">${escapeHtml(r.qc_notes)}</span>` : ''}</td>
      ${canManage ? `<td class="num nowrap">
        ${r.qc_status === 'pending' ? `<button type="button" class="icon-btn" data-edit aria-label="Tahrirlash" title="Xatoni tuzatish">${icon('i-edit')}</button><button type="button" class="icon-btn" data-del aria-label="O‘chirish" title="O‘chirish">${icon('i-trash')}</button>` : ''}
        ${r.qc_status !== 'passed' ? '<button type="button" class="btn btn--primary btn--sm" data-qc="passed">O‘tdi</button>' : ''}
        ${r.qc_status !== 'failed' ? '<button type="button" class="btn btn--outline btn--sm" data-qc="failed">O‘tmadi</button>' : ''}</td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 10 : 9, 'Bu davrda ishlab chiqarish yozuvi yo‘q.')}</tbody></table></div></section>
    <p class="kpi-note">Xato kiritilgan yozuvni sifat nazoratidan oldin tuzatish yoki o‘chirish mumkin; ombordan avtomat chiqim ham shunga qarab qayta hisoblanadi.</p>`;
  body.querySelectorAll('tr[data-record]').forEach((row) => {
    const rec = rows.find((r) => r.id === Number(row.dataset.record));
    row.querySelector('[data-waybill]').addEventListener('click', () => waybillView(rec.id, reload));
    row.querySelector('[data-edit]')?.addEventListener('click', () => editForm(rec, () => { reload(); waybillView(rec.id, reload); }));
    row.querySelectorAll('[data-qc]').forEach((b) => b.addEventListener('click', () => qcForm(rec, b.dataset.qc, reload)));
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Yozuvni o‘chirish', text: `${rec.product_name || rec.grade_class}, ${volume(rec.produced_volume_m3)} yozuvi o‘chiriladi, xomashyo chiqimi qaytariladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/production/records/${rec.id}`, { method: 'DELETE' });
        toast('Yozuv o‘chirildi.', 'success');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ---------------------------------------------------------------- Ishlab chiqarildi formasi */

const vehicleLabel = (v) => `${v.plate_number} · ${v.vehicle_type}${v.capacity_m3 ? ` · ${v.capacity_m3} m³` : ''}`;
const driverOptions = (list) => [{ value: '', label: '— tanlang —' }].concat(list.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.full_name })));

/** Ochiq buyurtma → marka → miqdor → mikser → haydovchi. Saqlangach nakladnoy o'zi ochiladi. */
export async function openRecordForm({ orderId = null, onSaved = () => {} }) {
  let list;
  let vehicles;
  let drivers;
  try {
    [list, vehicles, drivers] = await Promise.all([
      http('/admin/production/orders?state=open'),
      http('/admin/vehicles').then((v) => v.filter((x) => x.kind === 'mixer' && x.is_active)),
      http('/admin/drivers'),
    ]);
  } catch (err) {
    toast(err.message || 'Ma’lumot yuklanmadi.', 'error');
    return;
  }
  if (!list.length) {
    toast('Yopilmagan buyurtma yo‘q. Avval «Buyurtmalar» bo‘limida buyurtma shakllantiring.', 'warning');
    return;
  }
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  formModal({
    title: 'Ishlab chiqarildi',
    submitLabel: 'Saqlash va nakladnoy',
    body: `${field({ name: 'order_id', label: 'Buyurtma (zayavka)', required: true, value: orderId ?? '', options: [{ value: '', label: '— tanlang —' }].concat(list.map((o) => ({ value: o.id, label: `${o.order_number} · ${o.customer} · ${fmtDate(o.delivery_date)}` }))) })}
      <p class="text-muted" data-customer>Mijoz: —</p>
      ${field({ name: 'product_id', label: 'Beton markasi', required: true, options: [{ value: '', label: '— avval buyurtmani tanlang —' }] })}
      <div class="form-row">${field({ name: 'produced_volume_m3', label: 'Miqdori (m³)', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      <div class="field"><span class="field__label">Ortish vaqti</span><div class="input" aria-readonly="true">${hhmm} (avtomat)</div></div></div>
      ${field({ name: 'vehicle_id', label: 'Tashuvchi mikser raqami', required: true, options: [{ value: '', label: '— tanlang —' }].concat(vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))) })}
      <div class="form-row">${field({ name: 'driver_id', label: 'Haydovchi', required: true, options: driverOptions(drivers) })}
      <div class="field"><span class="field__label">&nbsp;</span><button type="button" class="btn btn--outline" data-add-driver>${icon('i-plus')} Haydovchi qo‘shish</button></div></div>
      <div class="form-row">${field({ name: 'operator_name', label: 'Operator', value: session.user?.full_name || '', attrs: 'maxlength="150"' })}
      ${field({ name: 'operator_phone', label: 'Operator telefoni', attrs: 'inputmode="tel" placeholder="+998 (90) 123-45-67"' })}</div>
      ${field({ name: 'notes', label: 'Nakladnoyga qo‘shimcha yozuv', attrs: 'maxlength="1000"' })}`,
    onOpen: (form) => {
      attachPhoneMask(form.elements.operator_phone);
      const f = form.elements;
      const current = () => list.find((o) => o.id === Number(f.order_id.value));
      const syncOrder = () => {
        const o = current();
        form.querySelector('[data-customer]').textContent = o ? `Mijoz: ${o.customer}${o.address ? ` · ${o.address}` : ''}` : 'Mijoz: —';
        f.product_id.innerHTML = o ? o.items.map((i) => `<option value="${i.product_id}">${escapeHtml(i.name)} — qoldi ${nf(Math.max(i.volume_m3 - i.produced_m3, 0))} m³</option>`).join('') : '<option value="">— avval buyurtmani tanlang —</option>';
        syncVolume();
      };
      const syncVolume = () => {
        const i = current()?.items.find((x) => x.product_id === Number(f.product_id.value));
        f.produced_volume_m3.value = i ? String(Math.max(i.volume_m3 - i.produced_m3, 0) || i.volume_m3) : '';
      };
      f.order_id.addEventListener('change', syncOrder);
      f.product_id.addEventListener('change', syncVolume);
      syncOrder();
      form.querySelector('[data-add-driver]').addEventListener('click', () => driverForm(null, async () => {
        const fresh = await http('/admin/drivers');
        const newest = fresh.reduce((a, b) => (b.id > a.id ? b : a), fresh[0]);
        f.driver_id.innerHTML = driverOptions(fresh).map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('');
        f.driver_id.value = String(newest.id);
      }));
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.produced_volume_m3.value);
      localErrors(form, {
        order_id: f.order_id.value ? null : 'Buyurtmani tanlang.',
        product_id: f.product_id.value ? null : 'Markani tanlang.',
        produced_volume_m3: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Miqdorni kiriting.' : null,
        vehicle_id: f.vehicle_id.value ? null : 'Mikserni tanlang.',
        driver_id: f.driver_id.value ? null : 'Haydovchini tanlang yoki qo‘shing.',
      });
      const rec = await http('/admin/production/records', { method: 'POST', body: {
        order_id: Number(f.order_id.value), product_id: Number(f.product_id.value), produced_volume_m3: amount,
        vehicle_id: Number(f.vehicle_id.value), driver_id: Number(f.driver_id.value),
        operator_name: f.operator_name.value.trim() || null, operator_phone: f.operator_phone.value.trim() || null, notes: f.notes.value.trim() || null,
      } });
      toast('Saqlandi, xomashyo ombordan chiqim qilindi.', 'success');
      onSaved();
      setTimeout(() => waybillView(rec.id, onSaved), 150);
    },
  });
}

/* ---------------------------------------------------------------- Nakladnoy */

async function waybillView(recordId, onChanged = () => {}) {
  let w;
  try {
    w = await http(`/admin/production/records/${recordId}/waybill`);
  } catch (err) {
    toast(err.message || 'Nakladnoy ochilmadi.', 'error');
    return;
  }
  const row = (k, v) => `<tr><th>${k}</th><td>${v ? escapeHtml(v) : '—'}</td></tr>`;
  const canManage = session.can(PERM.PRODUCTION_MANAGE);
  const close = openModal({
    title: `Nakladnoy ${w.number}`,
    content: `<div class="waybill">
      <h3 class="waybill__title">YUK XATI (NAKLADNOY) № ${escapeHtml(w.number)}</h3>
      <p class="waybill__sub">BETON INDUSTRY · ${escapeHtml(fmtDate(w.date))} · ortish vaqti ${escapeHtml(w.time)}</p>
      <table class="waybill__table"><tbody>
        ${row('Buyurtmachi (mijoz)', w.customer)}${row('Mijoz telefoni', w.customer_phone)}${row('Buyurtma №', w.order_number)}${row('Yetkazish manzili', w.address)}
        ${row('Beton markasi', w.product)}${row('Miqdori', `${formatNumber(w.volume_m3, 2)} m³`)}
        ${row('Tashuvchi mikser', w.vehicle ? `${w.vehicle}${w.vehicle_type ? ` (${w.vehicle_type})` : ''}` : null)}${row('Haydovchi', w.driver)}${row('Haydovchi telefoni', w.driver_phone)}
        ${row('Operator', w.operator)}${row('Operator telefoni', w.operator_phone)}${row('Qo‘shimcha yozuv', w.notes)}
      </tbody></table>
      ${w.materials.length ? `<p class="waybill__sub"><b>Sarflangan xomashyo (me’yor bo‘yicha):</b></p><table class="waybill__table"><tbody>${w.materials.map((m) => `<tr><th>${escapeHtml(m.name)}</th><td>${formatNumber(m.quantity, 3)} ${escapeHtml(m.unit)}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="waybill__sign"><span>Topshirdi (operator): ____________</span><span>Haydovchi: ____________</span><span>Qabul qildi: ____________</span></div>
    </div>
    <div class="modal__actions"><button type="button" class="btn btn--outline" data-close>Yopish</button>
      ${canManage ? '<button type="button" class="btn btn--outline" data-edit-waybill>Tahrirlash</button>' : ''}
      <button type="button" class="btn btn--primary" data-print>Chop etish</button></div>`,
  });
  close.element.querySelector('[data-print]').addEventListener('click', () => window.print());
  close.element.querySelector('[data-edit-waybill]')?.addEventListener('click', async () => {
    const all = await http(`/admin/production/records${qs({ date_from: w.date, date_to: w.date })}`);
    const rec = all.find((r) => r.waybill_no === w.number);
    if (!rec) return;
    close();
    editForm(rec, () => { onChanged(); waybillView(recordId, onChanged); });
  });
}

async function editForm(rec, onSaved) {
  const [vehicles, drivers] = await Promise.all([
    http('/admin/vehicles').then((v) => v.filter((x) => x.kind === 'mixer' && x.is_active)),
    http('/admin/drivers'),
  ]);
  formModal({
    title: `Tuzatish — ${rec.waybill_no || 'yozuv'}`,
    body: `<p class="text-muted">${escapeHtml(rec.customer_name || '')} · ${escapeHtml(rec.product_name || rec.grade_class)}. Sifat nazoratidan oldin tuzatish mumkin.</p>
      ${field({ name: 'produced_volume_m3', label: 'Miqdori (m³)', value: String(rec.produced_volume_m3), required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'vehicle_id', label: 'Tashuvchi mikser raqami', value: rec.vehicle_id ?? '', required: true, options: [{ value: '', label: '— tanlang —' }].concat(vehicles.map((v) => ({ value: v.id, label: vehicleLabel(v) }))) })}
      ${field({ name: 'driver_id', label: 'Haydovchi', value: rec.driver_id ?? '', required: true, options: driverOptions(drivers) })}
      <div class="form-row">${field({ name: 'operator_name', label: 'Operator', value: rec.operator_name || '', attrs: 'maxlength="150"' })}
      ${field({ name: 'operator_phone', label: 'Operator telefoni', value: rec.operator_phone || '', attrs: 'inputmode="tel"' })}</div>
      ${field({ name: 'notes', label: 'Nakladnoyga qo‘shimcha yozuv', value: rec.notes || '', attrs: 'maxlength="1000"' })}`,
    onOpen: (form) => attachPhoneMask(form.elements.operator_phone),
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.produced_volume_m3.value);
      localErrors(form, {
        produced_volume_m3: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Miqdorni kiriting.' : null,
        vehicle_id: f.vehicle_id.value ? null : 'Mikserni tanlang.',
        driver_id: f.driver_id.value ? null : 'Haydovchini tanlang.',
      });
      await http(`/admin/production/records/${rec.id}`, { method: 'PUT', body: {
        produced_volume_m3: amount, vehicle_id: Number(f.vehicle_id.value), driver_id: Number(f.driver_id.value),
        operator_name: f.operator_name.value.trim() || null, operator_phone: f.operator_phone.value.trim() || null, notes: f.notes.value.trim() || null,
      } });
      toast('Tuzatildi.', 'success');
      onSaved();
    },
  });
}

function qcForm(record, status, onSaved) {
  const failed = status === 'failed';
  formModal({
    title: failed ? 'Sifat nazoratidan o‘tmadi' : 'Sifat nazoratidan o‘tdi',
    submitLabel: 'Saqlash',
    danger: failed,
    body: `
      <p>${escapeHtml(record.product_name || record.grade_class)} · ${escapeHtml(volume(record.produced_volume_m3))}</p>
      ${field({ name: 'qc_notes', label: failed ? 'Sababi' : 'Izoh (ixtiyoriy)', type: 'textarea', rows: 3, required: failed, value: record.qc_notes || '', attrs: 'maxlength="1000"', hint: failed ? 'Masalan: konus cho‘kishi, harorat, namuna natijasi.' : '' })}`,
    onSubmit: async (form) => {
      const notes = form.elements.qc_notes.value.trim();
      localErrors(form, { qc_notes: failed && !notes ? 'Sababini yozing.' : null });
      await http(`/admin/production/records/${record.id}/qc`, { method: 'POST', body: { qc_status: status, qc_notes: notes || null } });
      toast('Sifat nazorati natijasi saqlandi.', 'success');
      onSaved();
    },
  });
}
