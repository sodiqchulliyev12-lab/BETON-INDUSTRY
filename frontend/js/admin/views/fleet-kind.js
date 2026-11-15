/**
 * Transport turi sahifasi (mikserlar, beton nasoslari, yuk avtomobillari, yengil avtomobillar).
 * Har bir tur uchun o'ziga tegishli ko'rsatkichlar tanlangan «davr» (katta raqam) va «kun» (kichik) bo'yicha:
 *  - mikser / yuk: reyslar, yoqilg'i, buzilishlar, zapchast va boshqa xarajatlar, texnik ko'rik;
 *  - nasos: ish soati (kompaniya / mijoz hisobidan), yoqilg'i, zapchast, ko'zda tutilmagan xarajatlar, texnik ko'rik;
 *  - yengil: texnik ko'rik, yoqilg'i, zapchast, boshqa xarajatlar, taksi (marta va so'm).
 * Hamma raqam bazadagi yozuvlardan; kiritilmagan bo'lsa «Kiritilmagan» yoki 0 ko'rsatiladi, taxmin qilinmaydi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { bindPeriod, monthEnd, monthStart, periodFromQuery, rangeBar } from '../period.js';
import { todayISO } from '../../validators.js';
import { groupedBars } from '../charts.js';
import {
  EXPENSE_LABEL, FUEL, FUEL_UNIT, INSPECTION, KIND_PHOTO, PERM, VEHICLE_KIND_TITLE, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate,
  formModal, icon, loadingHtml, localErrors, numberOrNull, ownLabel, statusBadge, toast, VEHICLE_STATUS,
} from '../components.js';
import { expenseForm } from './transport.js';
import { vehicleForm } from './vehicles.js';

const nf = (v, d = 0) => formatNumber(v || 0, d);
const som = (v) => `${nf(v)} so‘m`;
const DESC = {
  mixer: 'Beton mikserlar: reyslar, yoqilg‘i, buzilishlar, zapchast va boshqa xarajatlar, texnik ko‘rik.',
  other: 'Yuk tashish avtomobillari: reyslar, yoqilg‘i, buzilishlar, zapchast va boshqa xarajatlar, texnik ko‘rik.',
  pump: 'Beton nasoslar: ish soati (kompaniya va mijoz hisobidan), yoqilg‘i, zapchast, ko‘zda tutilmagan xarajatlar, texnik ko‘rik.',
  car: 'Yengil avtomobillar: texnik ko‘rik, yoqilg‘i, zapchast, boshqa xarajatlar va taksi sarfi.',
};

/** Katta raqam = davr, kichik = kun */
function kpi({ label, month, day, tone = '', unit = '' }) {
  return `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span>
    <span class="stat__value">${month}${unit ? `<span class="stat__unit">${unit}</span>` : ''}</span>
    <span class="stat__sub">Kun: <b>${day}${unit ? ` ${unit}` : ''}</b></span></div>`;
}

const inspBadge = (v) => `<span class="status status--insp-${v.inspection_status}">${escapeHtml(INSPECTION[v.inspection_status])}</span>`;
const dm = (r, key, fmt = nf) => `<span class="dm">${fmt(r.month[key])}<br><small>kun: ${fmt(r.day[key])}</small></span>`;

export async function render(ctx) {
  const { root, query, meta, isCurrent } = ctx;
  const kind = meta.kind;
  const day = query.get('date') || todayISO();
  const defEnd = monthEnd(day) > todayISO() ? todayISO() : monthEnd(day);
  const { from, to } = periodFromQuery(query, { from: monthStart(day), to: defEnd });
  const canManage = session.can(PERM.FLEET_MANAGE);
  root.innerHTML = loadingHtml();
  let rep;
  let vehicles;
  let drivers;
  let extra = {};
  try {
    [rep, vehicles, drivers] = await Promise.all([http(`/admin/fleet/kind/${kind}${qs({ date: day, date_from: from, date_to: to })}`), http('/admin/vehicles'), http('/admin/drivers')]);
    if (kind === 'pump') extra.logs = (await http(`/admin/fleet/work-logs${qs({ date_from: from, date_to: to })}`)).items;
    extra.breakdowns = (await http(`/admin/fleet/breakdowns${qs({ date_from: from, date_to: to })}`)).items;
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;
  vehicles = vehicles.filter((v) => v.kind === kind);
  const byId = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  const ids = new Set(vehicles.map((v) => v.id));
  extra.breakdowns = extra.breakdowns.filter((b) => ids.has(b.vehicle_id));
  if (extra.logs) extra.logs = extra.logs.filter((l) => ids.has(l.vehicle_id));
  const t = rep.totals;
  const reload = () => render(ctx);
  const monthLabel = `${fmtDate(rep.period_from).slice(0, 5)}–${fmtDate(rep.period_to).slice(0, 5)}`;

  const cards = [];
  if (kind === 'mixer' || kind === 'other') {
    cards.push(kpi({ label: 'Reyslar (davr)', month: nf(t.month.trips), day: nf(t.day.trips), tone: 'accent' }));
    cards.push(kpi({ label: 'Tashilgan hajm', month: nf(t.month.volume_m3, 1), day: nf(t.day.volume_m3, 1), unit: 'm³' }));
  }
  if (kind === 'pump') {
    cards.push(kpi({ label: 'Ishlagan soat (davr)', month: nf(t.month.hours, 1), day: nf(t.day.hours, 1), unit: 'soat', tone: 'accent' }));
    cards.push(kpi({ label: 'Shundan bizning hisobdan', month: nf(t.month.hours_company, 1), day: nf(t.day.hours_company, 1), unit: 'soat', tone: 'info' }));
    cards.push(kpi({ label: 'Shundan mijoz hisobidan', month: nf(t.month.hours_client, 1), day: nf(t.day.hours_client, 1), unit: 'soat', tone: 'success' }));
  }
  cards.push(kpi({ label: 'Yoqilg‘i sarfi', month: nf(t.month.fuel), day: nf(t.day.fuel), unit: 'so‘m' }));
  cards.push(kpi({ label: 'Zapchast xarajati', month: nf(t.month.parts), day: nf(t.day.parts), unit: 'so‘m' }));
  cards.push(kpi({ label: kind === 'pump' ? 'Ko‘zda tutilmagan xarajat' : 'Boshqa xarajatlar', month: nf(t.month.other_costs), day: nf(t.day.other_costs), unit: 'so‘m' }));
  if (kind !== 'car') cards.push(kpi({ label: 'Buzilishlar', month: `${nf(t.month.breakdowns)}<span class="stat__unit">marta</span>`, day: `${nf(t.day.breakdowns)} marta`, tone: t.month.breakdowns ? 'info' : '' }));
  cards.push(kpi({ label: 'Jami xarajat', month: nf(t.month.expenses_total), day: nf(t.day.expenses_total), unit: 'so‘m', tone: 'accent' }));
  if (kind === 'car') cards.push(kpi({ label: 'Taksi', month: `${nf(rep.taxi.month.rides)}<span class="stat__unit">marta</span>`, day: `${nf(rep.taxi.day.rides)} marta · ${som(rep.taxi.day.amount)}`, tone: 'info' }));
  const insp = rep.inspection;
  const inspCard = `<div class="stat${insp.overdue ? ' stat--danger' : ''}"><span class="stat__label">Texnik ko‘rik</span>
    <span class="stat__value">${insp.overdue ? `<span class="text-danger">${insp.overdue}</span>` : '0'}<span class="stat__unit">muddati o‘tgan</span></span>
    <span class="stat__sub">Yaqinlashdi: <b>${insp.soon}</b> · muddati bor: <b>${insp.ok}</b> · kiritilmagan: <b>${insp.unknown}</b></span></div>`;

  const seriesKey = kind === 'pump' ? 'hours' : (kind === 'car' ? 'fuel' : 'trips');
  const seriesLabel = { hours: 'Ishlagan soat', fuel: 'Yoqilg‘i (so‘m)', trips: 'Reyslar' }[seriesKey];
  const hasSeries = rep.daily.some((d) => d[seriesKey]);

  const head = {
    mixer: ['Reyslar', 'Yoqilg‘i', 'Buzilish', 'Zapchast', 'Boshqa'], other: ['Reyslar', 'Yoqilg‘i', 'Buzilish', 'Zapchast', 'Boshqa'],
    pump: ['Soat (jami)', 'Bizning hisob', 'Mijoz hisobi', 'Yoqilg‘i', 'Zapchast', 'Ko‘zda tutilmagan'], car: ['Yoqilg‘i', 'Zapchast', 'Boshqa'],
  }[kind];
  const cells = (r) => ({
    mixer: [dm(r, 'trips'), dm(r, 'fuel'), dm(r, 'breakdowns'), dm(r, 'parts'), dm(r, 'other_costs')],
    pump: [dm(r, 'hours', (v) => nf(v, 1)), dm(r, 'hours_company', (v) => nf(v, 1)), dm(r, 'hours_client', (v) => nf(v, 1)), dm(r, 'fuel'), dm(r, 'parts'), dm(r, 'other_costs')],
    car: [dm(r, 'fuel'), dm(r, 'parts'), dm(r, 'other_costs')],
  }[kind === 'other' ? 'mixer' : kind]);
  const vById = Object.fromEntries(vehicles.map((v) => [v.id, v]));

  root.innerHTML = `
    <div class="kind-head"><img src="${KIND_PHOTO[kind]}" alt="${escapeHtml(VEHICLE_KIND_TITLE[kind])}">
      <div><h2>${escapeHtml(VEHICLE_KIND_TITLE[kind])}</h2><p class="text-muted">${escapeHtml(DESC[kind])}</p>
        <div class="page-actions">${rangeBar({ from, to })}</div>
        ${canManage ? `<div class="kind-head__actions">
          <button class="btn btn--primary" data-vehicle>${icon('i-plus')} Yangi transport</button>
          <button class="btn btn--outline" data-expense>${icon('i-plus')} Xarajat</button>
          <button class="btn btn--outline" data-breakdown>${icon('i-alert')} Buzilish</button>
          ${kind === 'pump' ? `<button class="btn btn--outline" data-hours>${icon('i-clock')} Ish soati</button>` : ''}
          ${kind === 'car' ? `<button class="btn btn--outline" data-taxi>${icon('i-plus')} Taksi</button>` : ''}</div>` : ''}</div></div>
    <div class="stats">${cards.join('')}${inspCard}</div>
    <div class="fuel-grid">${['gas', 'diesel', 'petrol'].concat(rep.fuel_types.period.unknown.cost || rep.fuel_types.day.unknown.cost ? ['unknown'] : []).map((k) => {
    const p = rep.fuel_types.period[k];
    const d = rep.fuel_types.day[k];
    return `<div class="fuel-card fuel-card--${k}"><h3>${escapeHtml(FUEL[k])}</h3><div class="fuel-card__big">${nf(p.cost)} <small>so‘m (davr)</small></div>
      <p>${p.qty ? `${nf(p.qty, 1)} ${FUEL_UNIT[k]}` : 'miqdor kiritilmagan'}</p><p><b>Kun:</b> ${nf(d.cost)} so‘m${d.qty ? ` · ${nf(d.qty, 1)} ${FUEL_UNIT[k]}` : ''}</p></div>`;
  }).join('')}</div>
    ${hasSeries ? `<section class="box"><div class="box__head"><h2 class="box__title">Oxirgi 30 kun: ${escapeHtml(seriesLabel.toLowerCase())}</h2></div><div class="box__body">${groupedBars(
    rep.daily.map((d) => ({ label: fmtDate(d.date).slice(0, 5), v: d[seriesKey] })), [{ key: 'v', label: seriesLabel, cls: 'c0' }], { unit: '', labelEvery: 3 })}</div></section>` : ''}
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">${escapeHtml(VEHICLE_KIND_TITLE[kind])} (${vehicles.length})</h2></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Davlat raqami</th><th>Egasi</th><th>Holat</th><th>Kim haydadi</th>${head.map((h) => `<th class="num">${h}</th>`).join('')}<th>Texnik ko‘rik</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${rep.vehicles.length ? rep.vehicles.map((r) => {
    const v = vById[r.id];
    return `<tr data-id="${r.id}" class="${r.is_active ? '' : 'muted'}"><td class="strong nowrap">${escapeHtml(r.plate_number)}<br><span class="muted">${escapeHtml(r.vehicle_type)}${r.capacity_m3 ? ` · ${nf(r.capacity_m3, 1)} m³` : ''}</span></td>
      <td>${escapeHtml(ownLabel(kind, r.ownership))}${v?.rental_company ? `<br><span class="muted">${escapeHtml(v.rental_company)}</span>` : ''}${r.fuel_type ? `<br><span class="muted">${escapeHtml(FUEL[r.fuel_type])}</span>` : ''}</td><td>${statusBadge(r.status, VEHICLE_STATUS)}</td>
      <td>${r.drivers.length ? r.drivers.map((d) => `<span class="drv-chip">${escapeHtml(d.name || 'belgilanmagan')}: ${d.trips_period ? `${d.trips_period} reys` : ''}${d.hours_period ? `${d.trips_period ? ', ' : ''}${nf(d.hours_period, 1)} soat` : ''}</span>`).join('') : `<span class="muted">${r.default_driver ? `odatda: ${escapeHtml(r.default_driver)}` : '—'}</span>`}</td>
      ${cells(r).map((c) => `<td class="num">${c}</td>`).join('')}
      <td>${inspBadge(r)}<br><span class="muted">${r.inspection_date ? `o‘tgan: ${fmtDate(r.inspection_date)}` : 'sana kiritilmagan'}${r.inspection_due ? `<br>keyingi: <strong>${fmtDate(r.inspection_due)}</strong>` : ''}</span></td>
      ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button>${v && v.trips_count === 0 ? `<button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button>` : ''}</td>` : ''}</tr>`;
  }).join('') : emptyRow(canManage ? 13 : 12, `${VEHICLE_KIND_TITLE[kind]} hali kiritilmagan. «Yangi transport» tugmasi orqali qo‘shing.`)}
      <tr class="total-row"><td colspan="4">Jami</td>${cells({ month: t.month, day: t.day }).map((c) => `<td class="num strong">${c}</td>`).join('')}<td></td>${canManage ? '<td></td>' : ''}</tr></tbody></table></div></section>
    ${kind === 'pump' ? `<section class="box mt-5"><div class="box__head"><h2 class="box__title">Ish soatlari (${escapeHtml(monthLabel)})</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th>Nasos</th><th>Operator</th><th class="num">Soat</th><th>Hisob</th><th>Izoh</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${extra.logs.length ? extra.logs.map((l) => `<tr data-log="${l.id}"><td class="nowrap">${fmtDate(l.work_date)}</td><td class="strong">${escapeHtml(l.plate_number)}</td><td>${escapeHtml(l.driver || '—')}</td><td class="num">${nf(l.hours, 2)}</td>
        <td>${l.billed_to === 'company' ? 'Bizning hisobdan' : 'Mijoz hisobidan'}</td><td>${escapeHtml(l.note || '')}</td>${canManage ? `<td class="num"><button class="icon-btn" data-del-log aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 7 : 6, 'Bu davrda ish soati kiritilmagan.')}</tbody></table></div></section>` : ''}
    ${kind === 'car' ? `<section class="box mt-5"><div class="box__head"><h2 class="box__title">Taksi (${escapeHtml(monthLabel)}): ${rep.taxi.month.rides} marta, ${som(rep.taxi.month.amount)}</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th class="num">Summa</th><th>Maqsad</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${rep.taxi.items.length ? rep.taxi.items.map((x) => `<tr data-taxi="${x.id}"><td class="nowrap">${fmtDate(x.ride_date)}</td><td class="num">${som(x.amount)}</td><td>${escapeHtml(x.purpose || '')}</td>${canManage ? `<td class="num"><button class="icon-btn" data-del-taxi aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 4 : 3, 'Bu davrda taksi ishlatilmagan.')}</tbody></table></div></section>` : ''}
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">Buzilishlar (${escapeHtml(monthLabel)}): ${extra.breakdowns.length} marta</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th>Transport</th><th>Nima bo‘ldi</th><th>Tuzatildi</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${extra.breakdowns.length ? extra.breakdowns.map((b) => `<tr data-bd="${b.id}"><td class="nowrap">${fmtDate(b.occurred_on)}</td><td class="strong">${escapeHtml(b.plate_number)}</td><td>${escapeHtml(b.description)}</td><td>${b.resolved_on ? fmtDate(b.resolved_on) : '<span class="muted">—</span>'}</td>
        ${canManage ? `<td class="num"><button class="icon-btn" data-del-bd aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('') : emptyRow(canManage ? 5 : 4, 'Bu davrda buzilish qayd etilmagan.')}</tbody></table></div></section>`;

  bindPeriod(root);
  const active = vehicles.filter((v) => v.is_active);
  const need = (fn) => (active.length ? fn() : toast(`Avval «Yangi transport» orqali ${VEHICLE_KIND_TITLE[kind].toLowerCase()} qo‘shing.`, 'warning'));
  root.querySelector('[data-vehicle]')?.addEventListener('click', () => vehicleForm(null, drivers, reload, kind));
  root.querySelector('[data-expense]')?.addEventListener('click', () => need(() => expenseForm(null, active, reload)));
  root.querySelector('[data-breakdown]')?.addEventListener('click', () => need(() => breakdownForm(active, reload)));
  root.querySelector('[data-hours]')?.addEventListener('click', () => need(() => hoursForm(active, drivers, reload)));
  root.querySelector('[data-taxi]')?.addEventListener('click', () => taxiForm(reload));
  const bindDelete = (rowSel, btnSel, key, url, title) => root.querySelectorAll(rowSel).forEach((row) => row.querySelector(btnSel)?.addEventListener('click', async () => {
    if (!(await confirmAction({ title, text: 'Yozuv o‘chiriladi.', confirmLabel: 'O‘chirish' }))) return;
    try { await http(`${url}/${row.dataset[key]}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
  }));
  root.querySelectorAll('tr[data-id]').forEach((row) => {
    const v = byId[Number(row.dataset.id)];
    row.querySelector('[data-edit]')?.addEventListener('click', () => vehicleForm(v, drivers, reload, kind));
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Transportni o‘chirish', text: `${v.plate_number} o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try { await http(`/admin/vehicles/${v.id}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
    });
  });
  bindDelete('tr[data-bd]', '[data-del-bd]', 'bd', '/admin/fleet/breakdowns', 'Buzilishni o‘chirish');
  bindDelete('tr[data-log]', '[data-del-log]', 'log', '/admin/fleet/work-logs', 'Ish soatini o‘chirish');
  bindDelete('tr[data-taxi]', '[data-del-taxi]', 'taxi', '/admin/fleet/taxi', 'Taksi yozuvini o‘chirish');
}

const vehicleOptions = (list) => [{ value: '', label: '— tanlang —' }].concat(list.map((v) => ({ value: v.id, label: `${v.plate_number} · ${v.vehicle_type}` })));

function breakdownForm(vehicles, onSaved) {
  formModal({
    title: 'Buzilishni qayd etish',
    body: `${field({ name: 'vehicle_id', label: 'Transport', required: true, options: vehicleOptions(vehicles) })}
      <div class="form-row">${field({ name: 'occurred_on', label: 'Buzilgan sana', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'resolved_on', label: 'Tuzatilgan sana', type: 'date', hint: 'Hali tuzatilmagan bo‘lsa bo‘sh qoldiring.' })}</div>
      ${field({ name: 'description', label: 'Nima bo‘ldi', type: 'textarea', rows: 2, required: true, attrs: 'maxlength="300" placeholder="Masalan: gidravlika shlangi yorildi"' })}
      <p class="text-muted">Ta’mir va zapchast narxini «Xarajat» tugmasi bilan alohida kiriting.</p>`,
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, { vehicle_id: f.vehicle_id.value ? null : 'Transportni tanlang.', description: f.description.value.trim().length >= 3 ? null : 'Kamida 3 ta belgi kiriting.' });
      await http('/admin/fleet/breakdowns', { method: 'POST', body: { vehicle_id: Number(f.vehicle_id.value), occurred_on: f.occurred_on.value, resolved_on: f.resolved_on.value || null, description: f.description.value.trim() } });
      toast('Buzilish qayd etildi.', 'success');
      onSaved();
    },
  });
}

function hoursForm(vehicles, drivers, onSaved) {
  formModal({
    title: 'Ish soatini kiritish',
    body: `${field({ name: 'vehicle_id', label: 'Nasos', required: true, options: vehicleOptions(vehicles) })}
      <div class="form-row">${field({ name: 'work_date', label: 'Sana', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'hours', label: 'Ishlagan soat', required: true, attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Bir kunda jami 24 soatdan oshmaydi.' })}</div>
      ${field({ name: 'driver_id', label: 'Operator / haydovchi', options: [{ value: '', label: '— belgilanmagan —' }].concat(drivers.filter((d) => d.is_active).map((d) => ({ value: d.id, label: d.full_name }))), hint: 'Nasosni kun davomida turli operatorlar boshqarishi mumkin — har bir yozuvga alohida tanlang.' })}
      ${field({ name: 'billed_to', label: 'Kimning hisobidan', options: [{ value: 'company', label: 'Bizning hisobdan' }, { value: 'client', label: 'Mijoz hisobidan' }] })}
      ${field({ name: 'note', label: 'Izoh (mijoz / obyekt)', attrs: 'maxlength="300"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const hours = numberOrNull(f.hours.value);
      localErrors(form, { vehicle_id: f.vehicle_id.value ? null : 'Nasosni tanlang.', hours: hours === null || Number.isNaN(hours) || hours <= 0 || hours > 24 ? '0 dan 24 gacha son kiriting.' : null });
      await http('/admin/fleet/work-logs', { method: 'POST', body: { vehicle_id: Number(f.vehicle_id.value), work_date: f.work_date.value, hours, billed_to: f.billed_to.value, driver_id: f.driver_id.value ? Number(f.driver_id.value) : null, note: f.note.value.trim() || null } });
      toast('Ish soati saqlandi.', 'success');
      onSaved();
    },
  });
}

function taxiForm(onSaved) {
  formModal({
    title: 'Taksi ishlatildi',
    body: `<div class="form-row">${field({ name: 'ride_date', label: 'Sana', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'amount', label: 'Summa (so‘m)', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}</div>
      ${field({ name: 'purpose', label: 'Maqsad / yo‘nalish', attrs: 'maxlength="300"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.amount.value);
      localErrors(form, { amount: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Musbat summa kiriting.' : null });
      await http('/admin/fleet/taxi', { method: 'POST', body: { ride_date: f.ride_date.value, amount, purpose: f.purpose.value.trim() || null } });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}
