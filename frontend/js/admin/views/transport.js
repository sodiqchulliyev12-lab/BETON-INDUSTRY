/**
 * Transport bo'limi: umumiy panel, logistika rejalashtirish, xarajatlar va hisobot.
 * Hamma raqam bazadagi haqiqiy yozuvlardan; ma'lumot bo'lmasa bo'sh holat ko'rsatiladi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { bindPeriod, dayBar, periodFromQuery, rangeBar } from '../period.js';
import { todayISO } from '../../validators.js';
import { donut, groupedBars, lineChart, ring } from '../charts.js';
import {
  EXPENSE_LABEL, FUEL, FUEL_UNIT, KIND_PHOTO, KIND_ROUTE, OWNERSHIP, PERM, TRIP_STATUS, VEHICLE_KIND_TITLE, ownLabel, VEHICLE_STATUS, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal,
  icon, loadingHtml, localErrors, money, numberOrNull, statusBadge, toast, volume,
} from '../components.js';

const KIND = { mixer: 'Mikser', pump: 'Beton nasosi', other: 'Yuk avtomobili', car: 'Yengil avtomobil' };
const EXPENSE = EXPENSE_LABEL;
const nf = (v, d = 0) => formatNumber(v || 0, d);

function stat({ label, value, hint = '', tone = '' }) {
  return `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span>
    <span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;
}

async function load(ctx, holder, loader, draw) {
  holder.innerHTML = loadingHtml();
  let data;
  try {
    data = await loader();
  } catch (err) {
    holder.innerHTML = errorHtml(err);
    holder.querySelector('[data-retry]')?.addEventListener('click', () => load(ctx, holder, loader, draw));
    return;
  }
  if (!ctx.isCurrent()) return;
  draw(data);
}

export async function render(ctx) {
  const route = ctx.meta.route;
  ctx.root.innerHTML = '<div id="pageBody"></div>';
  const holder = ctx.root.querySelector('#pageBody');
  if (route === 'trips') return trips(ctx, holder);
  if (route === 'fuel') return fuelReport(ctx, holder);
  if (route === 'expenses') return expenses(ctx, holder);
  if (route === 'fleet-report') return report(ctx, holder);
  return overview(ctx, holder, false);
}

/* ---------------------------------------------------------------- Transport dashboard */

const OWN_ROWS = [['own', 'O‘zimizniki'], ['rented', 'Arenda'], ['per_trip', 'Reys bay']];
const TILE_KINDS = ['mixer', 'pump', 'other', 'car'];
const sel = (id, opts, val) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(val) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;

async function overview(ctx, holder, withList = false) {
  const q = ctx.query;
  const f = { date: q.get('date') || todayISO(), kind: q.get('kind') || '', own: q.get('own') || '', vs: q.get('vs') || '', driver: q.get('driver') || '', page: Number(q.get('page')) || 1 };
  await load(ctx, holder, () => Promise.all([
    http('/admin/fleet/summary'),
    http(`/admin/fleet/monitor${qs({ date: f.date, kind: f.kind, ownership: f.own, vehicle_status: f.vs, driver_id: f.driver, page: f.page, page_size: 10 })}`),
    http('/admin/drivers'),
  ]), ([s, mon, drivers]) => {
    const own = s.by_ownership;
    const ready = s.ready_by_ownership;
    const cnt = (k, o) => own[o][k];
    const activePct = (k, o) => (own[o][k] ? Math.round((ready[o][k] / own[o][k]) * 100) : null);
    const hourly = s.hourly || {};
    const hoursUsed = Object.values(hourly).flat().map((p) => p[0]);
    const h0 = Math.min(8, ...(hoursUsed.length ? hoursUsed : [8]));
    const h1 = Math.max(18, ...(hoursUsed.length ? hoursUsed : [18]));
    const xs = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    const groups = [['mixer_own', 'Mikserlar (o‘zimizniki)', 'c0'], ['mixer_hired', 'Mikserlar (arenda / reys bay)', 'c6'], ['pump_own', 'Nasoslar (o‘zimizniki)', 'c4'], ['pump_hired', 'Nasoslar (arenda / soatbay)', 'c1']];
    const hourlySeries = groups.map(([k, label, cls]) => ({ label, cls, points: hourly[k] || [] }));
    const totalTrips = s.daily.reduce((a, d) => a + d.trips, 0);
    const totalFuel = s.daily.reduce((a, d) => a + d.fuel_cost, 0);
    const maxTrips = Math.max(...s.daily.map((d) => d.trips), 1);
    const maxFuel = Math.max(...s.daily.map((d) => d.fuel_cost), 1);
    const fuelSeries = [
      { label: 'Reyslar', cls: 'c0', points: s.daily.map((d, i) => [i, (d.trips / maxTrips) * 100]) },
      { label: 'Yoqilg‘i xarajati', cls: 'c3', points: s.daily.map((d, i) => [i, (d.fuel_cost / maxFuel) * 100]) },
    ];
    const pages = Math.max(1, Math.ceil(mon.total / mon.page_size));
    const kindOpts = [['', 'Transport turi (hammasi)'], ['mixer', 'Mikserlar'], ['pump', 'Beton nasoslari'], ['other', 'Yuk avtomobillari'], ['car', 'Yengil avtomobillar']];
    const ownOpts = [['', 'Egalik turi (hammasi)'], ['own', 'O‘zimizniki'], ['rented', 'Arenda'], ['per_trip', 'Reys bay / soatbay']];
    const vsOpts = [['', 'Holati (hammasi)'], ['free', 'Bo‘sh'], ['busy', 'Band'], ['repair', 'Ta’mirda']];
    const drvOpts = [['', 'Haydovchi (hammasi)']].concat(drivers.filter((d) => d.is_active).map((d) => [d.id, d.full_name]));

    holder.innerHTML = `
      <div class="page-actions">
        ${dayBar({ date: f.date })}
        ${sel('fKind', kindOpts, f.kind)}${sel('fOwn', ownOpts, f.own)}${sel('fVs', vsOpts, f.vs)}${sel('fDriver', drvOpts, f.driver)}
      </div>
      <div class="stats stats--row">
        ${stat({ label: 'Jami transport', value: nf(s.total), hint: `Mikser ${s.by_kind.mixer} · nasos ${s.by_kind.pump} · yuk ${s.by_kind.other} · yengil ${s.by_kind.car}`, tone: 'accent' })}
        <div class="stat stat--info"><span class="stat__label">Ishlayotgan</span><div class="stat--row"><span class="stat__value">${nf(s.busy)}</span>${ring(s.busy_pct, 'bandlik')}</div></div>
        ${stat({ label: 'Bo‘sh (erkin)', value: nf(s.free), tone: 'success' })}
        ${stat({ label: 'Reysda', value: nf(s.on_road), hint: `Faol qatnov: ${s.active_trips}` })}
        <div class="stat${s.repair ? ' stat--danger' : ''}"><span class="stat__label">Ta’mirdagi</span><span class="stat__value">${nf(s.repair)}</span></div>
        ${stat({ label: 'Bugungi reyslar', value: nf(s.trips_today), hint: `${volume(s.volume_today_m3)} · maqsad belgilanmagan`, tone: 'accent' })}
      </div>
      <div class="admin-grid admin-grid--main">
        <div class="admin-grid">
          <section class="box"><div class="box__head"><h2 class="box__title">Transport vositalari bandligi (bugungi reyslar dinamikasi)</h2></div>
            <div class="box__body">${hoursUsed.length ? lineChart(hourlySeries, xs, { unit: 'reys', xLabel: (x) => `${String(x).padStart(2, '0')}:00` }) : '<p class="muted">Bugun qatnovlar yo‘q — reyslar buyurtmaga biriktirilgach soatlar bo‘yicha dinamika shu yerda chiziladi.</p>'}</div></section>
          <section class="box"><div class="box__head"><h2 class="box__title">Reyslar monitoringi (${escapeHtml(fmtDate(f.date))})</h2></div>
            <div class="table-wrap"><table class="table"><thead><tr><th>Reys</th><th>Transport</th><th>Turi</th><th>Haydovchi</th><th>Buyurtmachi / manzil</th><th class="num">Hajm</th><th>Holat</th></tr></thead>
            <tbody>${mon.items.length ? mon.items.map((t) => `<tr class="is-link" data-href="#/orders/${t.order_id}"><td class="strong nowrap"><a href="#/orders/${t.order_id}">${escapeHtml(t.order_number)}</a> №${t.trip_no}</td>
              <td class="nowrap">${escapeHtml(t.plate_number)}</td><td>${escapeHtml(KIND[t.kind] || t.kind)} <span class="muted">(${escapeHtml(ownLabel(t.kind, t.ownership))})</span></td><td>${escapeHtml(t.driver || '—')}</td>
              <td>${escapeHtml(t.customer || '—')}${t.address ? `<br><span class="muted">${escapeHtml(t.address)}</span>` : ''}</td><td class="num">${volume(t.volume_m3)}</td><td>${statusBadge(t.status, TRIP_STATUS)}</td></tr>`).join('')
    : emptyRow(7, 'Tanlangan sana va filtrlar bo‘yicha qatnovlar yo‘q.')}</tbody></table></div>
            <div class="pagination"><span>${mon.total ? `${(mon.page - 1) * mon.page_size + 1}–${Math.min(mon.total, mon.page * mon.page_size)} / ${mon.total} ta natija` : '0 ta natija'}</span>
              <div class="btn-row"><button class="btn btn--outline btn--sm" data-page="${f.page - 1}" ${f.page <= 1 ? 'disabled' : ''}>← Oldingi</button><button class="btn btn--outline btn--sm" data-page="${f.page + 1}" ${f.page >= pages ? 'disabled' : ''}>Keyingi →</button></div></div></section>
        </div>
        <section class="box"><div class="box__head"><h2 class="box__title">Transportlar (egalik bo‘yicha)</h2></div>
          <div class="box__body fleet-card">
            <p class="text-muted">Rasmni bossangiz, shu turdagi transport bo‘yicha batafsil ma’lumot ochiladi.</p>
            ${TILE_KINDS.map((k) => `<a class="fleet-tile" href="#/${KIND_ROUTE[k]}">
              <span class="fleet-tile__pic"><img src="${KIND_PHOTO[k]}" alt="${escapeHtml(VEHICLE_KIND_TITLE[k])}" loading="lazy"></span>
              <span class="fleet-tile__body"><strong>${escapeHtml(VEHICLE_KIND_TITLE[k])} <small>${s.by_kind[k]} ta</small></strong>
                <span class="own-list">${k === 'car'
    ? `<span><span>O‘zimizniki</span><span><b>${cnt(k, 'own')}</b> ta</span></span><span><span>Arenda</span><span><b>${cnt(k, 'rented')}</b> ta</span></span>
       <span><span>Taksi (shu oy)</span><span><b>${s.taxi_month.rides}</b> marta${s.taxi_month.amount ? ` · ${nf(s.taxi_month.amount)} so‘m` : ''}</span></span>`
    : OWN_ROWS.map(([o, l]) => `<span><span>${o === 'per_trip' && k === 'pump' ? 'Soatbay' : l}</span><span><b>${cnt(k, o)}</b> ta ${cnt(k, o) ? `<i class="tag">${activePct(k, o)}% faol</i>` : ''}</span></span>`).join('')}</span></span></a>`).join('')}
            <h3 class="an-sub">Yoqilg‘i va reyslar (${s.daily.length} kun)</h3>
            ${totalTrips || totalFuel ? lineChart(fuelSeries, s.daily.map((_, i) => i), { height: 150, xLabel: (i) => fmtDate(s.daily[i].date).slice(0, 5) }) : '<p class="muted">Reys yoki yoqilg‘i xarajati kiritilmagan.</p>'}
            ${totalTrips || totalFuel ? `<p class="text-muted">Jami: ${nf(totalTrips)} reys, yoqilg‘i ${nf(totalFuel)} so‘m (har chiziq o‘z maksimumiga nisbatan).</p>` : ''}
          </div></section>
      </div>
      ${withList ? '<div id="vehicleList" class="mt-5"></div>' : ''}`;

    const go = (extra = {}) => setQuery({
      kind: holder.querySelector('#fKind').value, own: holder.querySelector('#fOwn').value,
      vs: holder.querySelector('#fVs').value, driver: holder.querySelector('#fDriver').value, page: '', ...extra,
    });
    bindPeriod(holder);
    holder.querySelectorAll('#fKind, #fOwn, #fVs, #fDriver').forEach((el) => el.addEventListener('change', () => go()));
    holder.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => go({ page: b.dataset.page })));
    holder.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = r.dataset.href; }));
    if (withList) import('./vehicles.js').then((m) => m.render({ ...ctx, root: holder.querySelector('#vehicleList'), meta: { route: 'vehicles' } }));
  });
}

/* ---------------------------------------------------------------- Xarajatlar */

const sel2 = (id, opts, val) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(val) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;

async function expenses(ctx, holder) {
  const { from, to } = periodFromQuery(ctx.query);
  const cat = ctx.query.get('cat') || '';
  const ft = ctx.query.get('ft') || '';
  const canManage = session.can(PERM.FLEET_MANAGE);
  await load(ctx, holder, () => Promise.all([
    http(`/admin/fleet/expenses${qs({ date_from: from, date_to: to, category: cat, fuel_type: ft })}`), http('/admin/vehicles'),
  ]), ([data, vehicles]) => {
    holder.innerHTML = `<div class="page-actions">${rangeBar({ from, to })}
        ${sel2('fCat', [['', 'Xarajat turi (hammasi)'], ...Object.entries(EXPENSE)], cat)}${sel2('fFt', [['', 'Yoqilg‘i turi (hammasi)'], ...Object.entries(FUEL)], ft)}
        <span class="page-actions__spacer"></span>${canManage ? `<button class="btn btn--primary" data-add>${icon('i-plus')} Xarajat qo‘shish</button>` : ''}</div>
      <div class="stats">${stat({ label: 'Jami xarajat', value: `${nf(data.total)}<span class="stat__unit">so‘m</span>`, tone: 'accent' })}
        ${Object.entries(data.by_category).map(([k, v]) => stat({ label: EXPENSE[k] || k, value: `${nf(v)}<span class="stat__unit">so‘m</span>` })).join('')}</div>
      <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th>Transport</th><th>Turi</th><th class="num">Miqdor</th><th class="num">Summa</th><th>Izoh</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${data.items.length ? data.items.map((e) => `<tr data-id="${e.id}"><td class="nowrap">${fmtDate(e.expense_date)}</td><td class="strong nowrap">${escapeHtml(e.plate_number)}</td>
        <td>${escapeHtml(EXPENSE[e.category] || e.category)}${e.category === 'fuel' ? `<br><span class="muted">${escapeHtml(FUEL[e.fuel_type] || FUEL.unknown)}</span>` : ''}</td>
        <td class="num">${e.quantity ? `${nf(e.quantity, 1)} ${FUEL_UNIT[e.fuel_type] || ''}` : '—'}</td><td class="num">${money(e.amount)}</td><td>${escapeHtml(e.note || '')}</td>
        ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 7 : 6, 'Bu davrda xarajat kiritilmagan.')}</tbody></table></div></section>
      <p class="text-muted mt-5">Yoqilg‘i xarajatida <strong>turi</strong> (gaz, solyarka, benzin) majburiy. Yoqilg‘i bo‘yicha batafsil — <a href="#/fuel">Yoqilg‘i hisoboti</a>. Arenda va reys bay narxi buyurtmadagi qatnovda kiritiladi.</p>`;
    bindPeriod(holder);
    holder.querySelector('#fCat').addEventListener('change', (e) => setQuery({ cat: e.target.value }));
    holder.querySelector('#fFt').addEventListener('change', (e) => setQuery({ ft: e.target.value }));
    const reload = () => expenses(ctx, holder);
    holder.querySelector('[data-add]')?.addEventListener('click', () => expenseForm(null, vehicles, reload));
    holder.querySelectorAll('tr[data-id]').forEach((row) => {
      const item = data.items.find((i) => i.id === Number(row.dataset.id));
      row.querySelector('[data-edit]')?.addEventListener('click', () => expenseForm(item, vehicles, reload));
      row.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmAction({ title: 'Xarajatni o‘chirish', text: `${item.plate_number} — ${nf(item.amount)} so‘m o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
        try { await http(`/admin/fleet/expenses/${item.id}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
      });
    });
  });
}

export function expenseForm(item, vehicles, onSaved, defaultCategory = 'fuel') {
  const e = item || { vehicle_id: '', expense_date: todayISO(), category: defaultCategory, amount: '', note: '', fuel_type: '', quantity: '' };
  formModal({
    title: item ? 'Xarajatni tahrirlash' : 'Yangi xarajat',
    body: `${field({ name: 'vehicle_id', label: 'Transport', required: true, value: e.vehicle_id, options: [{ value: '', label: '— tanlang —' }].concat(vehicles.filter((v) => v.is_active || v.id === e.vehicle_id).map((v) => ({ value: v.id, label: `${v.plate_number} · ${v.vehicle_type}` }))) })}
      <div class="form-row">${field({ name: 'expense_date', label: 'Sana', type: 'date', value: e.expense_date, required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'category', label: 'Turi', value: e.category, options: Object.entries(EXPENSE).map(([value, label]) => ({ value, label })) })}</div>
      <div data-fuel><div class="form-row">${field({ name: 'fuel_type', label: 'Yoqilg‘i turi', value: e.fuel_type || '', options: [{ value: '', label: '— tanlang —' }, ...Object.entries(FUEL).filter(([k]) => k !== 'unknown').map(([value, label]) => ({ value, label }))] })}
      ${field({ name: 'quantity', label: 'Miqdori', value: e.quantity ?? '', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Gaz — kub metr (m³), solyarka va benzin — litr. Ixtiyoriy.' })}</div></div>
      ${field({ name: 'amount', label: 'Summa (so‘m)', value: e.amount, required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'note', label: 'Izoh', type: 'textarea', rows: 2, value: e.note || '', attrs: 'maxlength="500"' })}`,
    onOpen: (form) => {
      const sync = () => { form.querySelector('[data-fuel]').hidden = form.elements.category.value !== 'fuel'; };
      form.elements.category.addEventListener('change', sync);
      // mashinaning odatdagi yoqilg'i turi avtomatik tanlanadi
      form.elements.vehicle_id.addEventListener('change', () => {
        const v = vehicles.find((x) => String(x.id) === form.elements.vehicle_id.value);
        if (v?.fuel_type && !form.elements.fuel_type.value) form.elements.fuel_type.value = v.fuel_type;
      });
      sync();
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.amount.value);
      const qty = numberOrNull(f.quantity.value);
      const isFuel = f.category.value === 'fuel';
      localErrors(form, {
        vehicle_id: f.vehicle_id.value ? null : 'Transportni tanlang.',
        fuel_type: isFuel && !f.fuel_type.value ? 'Yoqilg‘i turini tanlang.' : null,
        quantity: isFuel && qty !== null && (Number.isNaN(qty) || qty <= 0) ? 'Musbat son kiriting yoki bo‘sh qoldiring.' : null,
        amount: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Musbat summa kiriting.' : null,
      });
      const body = {
        vehicle_id: Number(f.vehicle_id.value), expense_date: f.expense_date.value, category: f.category.value, amount, note: f.note.value.trim() || null,
        fuel_type: isFuel ? f.fuel_type.value : null, quantity: isFuel ? qty : null,
      };
      if (item) await http(`/admin/fleet/expenses/${item.id}`, { method: 'PUT', body });
      else await http('/admin/fleet/expenses', { method: 'POST', body });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}

/* ---------------------------------------------------------------- Hisobotlar */

export function downloadCsv(name, rows) {
  const text = rows.map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function report(ctx, holder) {
  const { from, to } = periodFromQuery(ctx.query);
  await load(ctx, holder, () => http(`/admin/fleet/report${qs({ date_from: from, date_to: to })}`), (r) => {
    const t = r.totals;
    const costParts = Object.entries(r.rows.reduce((acc, row) => {
      Object.entries(row.expenses).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; });
      return acc;
    }, {})).map(([k, v]) => ({ label: EXPENSE[k] || k, value: v }));
    if (t.rental_cost) costParts.push({ label: 'Arenda / reys bay / soatbay', value: t.rental_cost });
    holder.innerHTML = `<div class="page-actions">${rangeBar({ from, to })}<span class="page-actions__spacer"></span><button class="btn btn--outline" data-csv>Eksport (CSV)</button></div>
      <div class="stats">${stat({ label: 'Qatnovlar', value: nf(t.trips), hint: `Yetkazildi: ${nf(t.delivered_trips)}`, tone: 'accent' })}
        ${stat({ label: 'Hajm', value: `${nf(t.volume_m3, 1)}<span class="stat__unit">m³</span>`, hint: `Yetkazilgan: ${nf(t.delivered_m3, 1)} m³` })}
        ${stat({ label: 'Arenda / reys bay / soatbay', value: `${nf(t.rental_cost)}<span class="stat__unit">so‘m</span>` })}
        ${stat({ label: 'Boshqa xarajatlar', value: `${nf(t.expenses_total)}<span class="stat__unit">so‘m</span>` })}
        ${stat({ label: 'Jami transport xarajati', value: `${nf(t.cost_total)}<span class="stat__unit">so‘m</span>`, tone: 'info' })}</div>
      ${TILE_KINDS.map((k) => {
    const list = r.rows.filter((x) => x.kind === k);
    const sum = (key) => list.reduce((acc, x) => acc + (x[key] || 0), 0);
    return `<section class="box kind-report mt-5"><div class="kind-report__head">
        <img class="kind-report__pic" src="${KIND_PHOTO[k]}" alt="${escapeHtml(VEHICLE_KIND_TITLE[k])}" loading="lazy">
        <div><h2 class="box__title">${escapeHtml(VEHICLE_KIND_TITLE[k])} <small>${list.length} ta</small></h2>
          <div class="kind-report__stats"><span>Reys: <b>${nf(sum('trips'))}</b></span><span>Hajm: <b>${nf(sum('volume_m3'), 1)} m³</b></span><span>Arenda: <b>${nf(sum('rental_cost'))}</b></span><span>Xarajat: <b>${nf(sum('expenses_total'))}</b></span><span>Jami: <b>${nf(sum('cost_total'))} so‘m</b></span></div></div></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Transport</th><th>Egasi</th><th class="num">Reys</th><th class="num">Hajm</th><th class="num">Arenda</th><th class="num">Xarajat</th><th class="num">Jami</th></tr></thead>
        <tbody>${list.length ? list.map((x) => `<tr><td class="strong nowrap">${escapeHtml(x.plate_number)}<br><span class="muted">${escapeHtml(x.vehicle_type)}</span></td><td>${escapeHtml(ownLabel(x.kind, x.ownership))}</td>
          <td class="num">${x.trips}</td><td class="num">${nf(x.volume_m3, 1)}</td><td class="num">${nf(x.rental_cost)}</td><td class="num">${nf(x.expenses_total)}</td><td class="num strong">${nf(x.cost_total)}</td></tr>`).join('')
    : emptyRow(7, `${VEHICLE_KIND_TITLE[k]} yoki ma’lumot yo‘q.`)}</tbody></table></div></section>`;
  }).join('')}
      <section class="box mt-5"><div class="box__head"><h2 class="box__title">Xarajat tarkibi</h2></div><div class="box__body">${donut(costParts, { unit: 'so‘m' })}</div></section>`;
    bindPeriod(holder);
    holder.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(`transport-hisobot-${from}_${to}.csv`,
      [['Davlat raqami', 'Turi', 'Bo‘lim', 'Egasi', 'Reys', 'Hajm m3', 'Arenda', 'Xarajat', 'Jami']].concat(
        r.rows.map((x) => [x.plate_number, x.vehicle_type, KIND[x.kind], ownLabel(x.kind, x.ownership), x.trips, x.volume_m3, x.rental_cost, x.expenses_total, x.cost_total]))));
  });
}

/* ---------------------------------------------------------------- Yoqilg'i hisoboti (gaz / solyarka / benzin) */

async function fuelReport(ctx, holder) {
  const day = ctx.query.get('date') || todayISO();
  const { from, to } = periodFromQuery(ctx.query);
  const kind = ctx.query.get('kind') || '';
  await load(ctx, holder, () => http(`/admin/fleet/fuel${qs({ date: day, date_from: from, date_to: to, kind })}`), (r) => {
    const keys = ['gas', 'diesel', 'petrol'];
    const cards = keys.concat(r.types.period.unknown.cost || r.types.day.unknown.cost ? ['unknown'] : []).map((k) => {
      const d = r.types.day[k];
      const p = r.types.period[k];
      return `<div class="fuel-card fuel-card--${k}"><h3>${escapeHtml(FUEL[k])}</h3>
        <div class="fuel-card__big">${nf(p.cost)} <small>so‘m (davr)</small></div><p>${p.qty ? `${nf(p.qty, 1)} ${FUEL_UNIT[k] || ''} · ` : ''}${p.count} marta</p>
        <p><b>Kun (${fmtDate(r.date).slice(0, 5)}):</b> ${nf(d.cost)} so‘m${d.qty ? ` · ${nf(d.qty, 1)} ${FUEL_UNIT[k] || ''}` : ''}</p></div>`;
    }).join('');
    holder.innerHTML = `<div class="page-actions">${rangeBar({ from, to })}
        ${sel2('fKind', [['', 'Barcha transport'], ['mixer', 'Mikserlar'], ['pump', 'Beton nasoslari'], ['other', 'Yuk avtomobillari'], ['car', 'Yengil avtomobillar']], kind)}
        <span class="page-actions__spacer"></span><button class="btn btn--outline" data-csv>Eksport (CSV)</button></div>
      <div class="stats">${stat({ label: 'Yoqilg‘i jami (davr)', value: `${nf(r.total.period)}<span class="stat__unit">so‘m</span>`, tone: 'accent' })}
        ${stat({ label: `Yoqilg‘i jami (${fmtDate(r.date).slice(0, 5)})`, value: `${nf(r.total.day)}<span class="stat__unit">so‘m</span>`, tone: 'info' })}</div>
      <div class="fuel-grid">${cards}</div>
      <section class="box"><div class="box__head"><h2 class="box__title">Kunlik yoqilg‘i xarajati turlar bo‘yicha (so‘m)</h2></div><div class="box__body">${r.daily.some((d) => d.gas || d.diesel || d.petrol || d.unknown)
    ? groupedBars(r.daily.map((d) => ({ label: fmtDate(d.date).slice(0, 5), gas: d.gas, diesel: d.diesel, petrol: d.petrol })),
      [{ key: 'gas', label: FUEL.gas, cls: 'c0' }, { key: 'diesel', label: FUEL.diesel, cls: 'c3' }, { key: 'petrol', label: FUEL.petrol, cls: 'c2' }], { unit: 'so‘m', labelEvery: Math.ceil(r.daily.length / 14) })
    : '<p class="muted">Bu davrda yoqilg‘i xarajati yo‘q.</p>'}</div></section>
      <section class="box mt-5"><div class="box__head"><h2 class="box__title">Transport bo‘yicha (davr)</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Transport</th>${keys.map((k) => `<th class="num">${escapeHtml(FUEL[k])}</th>`).join('')}<th class="num">Jami</th></tr></thead>
      <tbody>${r.vehicles.length ? r.vehicles.map((v) => `<tr><td class="strong nowrap">${escapeHtml(v.plate_number)}<br><span class="muted">${escapeHtml(v.vehicle_type)}${v.default_fuel ? ` · odatda: ${escapeHtml(FUEL[v.default_fuel])}` : ''}</span></td>
        ${keys.map((k) => `<td class="num">${v.by_type[k].cost ? `${nf(v.by_type[k].cost)}<br><span class="muted">${v.by_type[k].qty ? `${nf(v.by_type[k].qty, 1)} ${FUEL_UNIT[k]}` : ''}</span>` : '—'}</td>`).join('')}<td class="num strong">${nf(v.total)}</td></tr>`).join('')
    : emptyRow(5, 'Bu davrda yoqilg‘i xarajati kiritilmagan. «Xarajatlar» bo‘limida yoqilg‘i turini tanlab kiriting.')}</tbody></table></div></section>`;
    bindPeriod(holder);
    holder.querySelector('#fKind').addEventListener('change', (e) => setQuery({ kind: e.target.value }));
    holder.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(`yoqilgi-${from}_${to}.csv`,
      [['Davlat raqami', 'Turi', 'Gaz so‘m', 'Gaz m3', 'Solyarka so‘m', 'Solyarka litr', 'Benzin so‘m', 'Benzin litr', 'Jami so‘m']].concat(
        r.vehicles.map((v) => [v.plate_number, v.vehicle_type, v.by_type.gas.cost, v.by_type.gas.qty, v.by_type.diesel.cost, v.by_type.diesel.qty, v.by_type.petrol.cost, v.by_type.petrol.qty, v.total]))));
  });
}

/* ---------------------------------------------------------------- Qatnovlar: haydovchi va mashina bo'yicha */

async function trips(ctx, holder) {
  const day = ctx.query.get('date') || todayISO();
  const { from, to } = periodFromQuery(ctx.query);
  const driver = ctx.query.get('driver') || '';
  const vehicle = ctx.query.get('vehicle') || '';
  const kind = ctx.query.get('kind') || '';
  await load(ctx, holder, () => Promise.all([
    http(`/admin/fleet/usage${qs({ date: day, date_from: from, date_to: to, driver_id: driver, vehicle_id: vehicle, kind })}`),
    http('/admin/drivers'), http('/admin/vehicles'),
  ]), ([u, drivers, vehicles]) => {
    const who = [];
    if (driver) who.push(`haydovchi: ${drivers.find((d) => String(d.id) === driver)?.full_name || ''}`);
    if (vehicle) who.push(`mashina: ${vehicles.find((v) => String(v.id) === vehicle)?.plate_number || ''}`);
    const sh = (v) => (v ? `<small>${v}</small>` : '');
    holder.innerHTML = `
      <div class="page-actions">${rangeBar({ from, to })}</div>
      <div class="page-actions">
        ${sel2('fDriver', [['', 'Haydovchi (hammasi)'], ...drivers.filter((d) => d.is_active || String(d.id) === driver).map((d) => [d.id, d.full_name])], driver)}
        ${sel2('fVehicle', [['', 'Mashina raqami (hammasi)'], ...vehicles.filter((v) => v.is_active || String(v.id) === vehicle).map((v) => [v.id, `${v.plate_number} · ${v.vehicle_type}`])], vehicle)}
        ${sel2('fKind', [['', 'Barcha transport turlari'], ['mixer', 'Mikserlar'], ['pump', 'Beton nasoslari'], ['other', 'Yuk avtomobillari'], ['car', 'Yengil avtomobillar']], kind)}
        ${driver || vehicle || kind ? '<button class="btn btn--outline btn--sm" data-reset>Filtrni tozalash</button>' : ''}
      </div>
      <div class="kind-pick">${TILE_KINDS.map((k) => {
    const d = u.by_kind[k];
    return `<div class="kind-pick__tile${kind === k ? ' is-active' : ''}" data-kind="${k}" role="button" tabindex="0" aria-pressed="${kind === k}" title="Shu tur bo‘yicha filtrlash">
        <span class="kind-pick__pic"><img src="${KIND_PHOTO[k]}" alt="${escapeHtml(VEHICLE_KIND_TITLE[k])}" loading="lazy"></span>
        <strong>${escapeHtml(VEHICLE_KIND_TITLE[k])}</strong>
        <span class="kind-pick__row"><span>Kun · ${escapeHtml(fmtDate(u.date).slice(0, 5))}</span><b>${nf(d.trips_day)} reys</b></span>
        <span class="kind-pick__row"><span>Davr</span><b>${nf(d.trips_period)} reys · ${nf(d.volume_period, 1)} m³</b></span>
        <span class="kind-pick__row"><span>Mashina (davr)</span><b>${nf(d.vehicles)} ta</b></span>
        ${k === 'pump' ? `<span class="kind-pick__row"><span>Ish soati (kun / davr)</span><b>${nf(d.hours_day, 1)} / ${nf(d.hours_period, 1)}</b></span>` : ''}
        <a class="kind-pick__more" href="#/${KIND_ROUTE[k]}">Batafsil →</a></div>`;
  }).join('')}</div>
      <p class="text-muted">${who.length ? `<strong>${escapeHtml(who.join(' · '))}</strong> bo‘yicha. ` : ''}Bir mashinani bir necha haydovchi, bir haydovchi esa bir necha mashinani haydashi mumkin: har bir qatnov o‘z haydovchisi va mashinasi bilan hisoblanadi.</p>
      <div class="stats">
        ${stat({ label: 'Qatnovlar', value: nf(u.totals.period.trips), hint: `Kun: <b>${nf(u.totals.day.trips)}</b>`, tone: 'accent' })}
        ${stat({ label: 'Hajm', value: `${nf(u.totals.period.volume_m3, 1)}<span class="stat__unit">m³</span>`, hint: `Kun: <b>${nf(u.totals.day.volume_m3, 1)} m³</b>` })}
        ${stat({ label: 'Mashinalar', value: nf(u.vehicles_count.period), hint: `Kun: <b>${nf(u.vehicles_count.day)}</b>`, tone: 'info' })}
        ${stat({ label: 'Haydovchilar', value: nf(u.drivers_count.period), hint: `Kun: <b>${nf(u.drivers_count.day)}</b>`, tone: 'success' })}
        ${u.hours.period || u.hours.day ? stat({ label: 'Ish soati (nasos)', value: `${nf(u.hours.period, 1)}<span class="stat__unit">soat</span>`, hint: `Kun: <b>${nf(u.hours.day, 1)} soat</b>` }) : ''}
        ${u.fuel ? stat({ label: 'Yoqilg‘i xarajati', value: `${nf(u.fuel.period)}<span class="stat__unit">so‘m</span>`, hint: `Kun: <b>${nf(u.fuel.day)} so‘m</b>` }) : ''}
        ${u.totals.period.trip_pay ? stat({ label: 'Arenda / reys bay to‘lovi', value: `${nf(u.totals.period.trip_pay)}<span class="stat__unit">so‘m</span>`, hint: `Kun: <b>${nf(u.totals.day.trip_pay)}</b>` }) : ''}
      </div>
      ${u.daily.some((d) => d.trips) ? `<section class="box"><div class="box__head"><h2 class="box__title">Kunlik qatnovlar</h2></div><div class="box__body">${groupedBars(u.daily.map((d) => ({ label: fmtDate(d.date).slice(0, 5), trips: d.trips })), [{ key: 'trips', label: 'Qatnovlar', cls: 'c0' }], { unit: 'ta', labelEvery: Math.ceil(u.daily.length / 14) })}</div></section>` : ''}
      <div class="admin-grid admin-grid--2 mt-5">
        <section class="box"><div class="box__head"><h2 class="box__title">Haydovchilar bo‘yicha</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Haydovchi</th><th class="num">Reys (davr / kun)</th><th class="num">Hajm</th><th class="num">Ish kuni</th></tr></thead>
          <tbody>${u.by_driver.length ? u.by_driver.map((r) => `<tr ${r.id ? `class="is-link" data-driver="${r.id}"` : ''}><td class="strong">${escapeHtml(r.name || 'Haydovchi belgilanmagan')}</td><td class="num">${r.trips_period} ${sh(`/ ${r.trips_day}`)}</td><td class="num">${nf(r.volume_period, 1)} m³</td><td class="num">${r.days_worked}</td></tr>`).join('') : emptyRow(4, 'Bu davrda qatnov yo‘q.')}</tbody></table></div></section>
        <section class="box"><div class="box__head"><h2 class="box__title">Mashinalar bo‘yicha</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Mashina</th><th class="num">Reys (davr / kun)</th><th class="num">Hajm</th><th class="num">Ish kuni</th></tr></thead>
          <tbody>${u.by_vehicle.length ? u.by_vehicle.map((r) => `<tr class="is-link" data-vehicle="${r.id}"><td class="strong nowrap">${escapeHtml(r.plate_number)}<br><span class="muted">${escapeHtml(r.vehicle_type)} · ${escapeHtml(ownLabel(r.kind, r.ownership))}</span></td><td class="num">${r.trips_period} ${sh(`/ ${r.trips_day}`)}</td><td class="num">${nf(r.volume_period, 1)} m³</td><td class="num">${r.days_worked}</td></tr>`).join('') : emptyRow(4, 'Bu davrda qatnov yo‘q.')}</tbody></table></div></section>
      </div>
      <section class="box mt-5"><div class="box__head"><h2 class="box__title">${escapeHtml(fmtDate(u.date))} kungi qatnovlar</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Buyurtma</th><th>Transport</th><th>Haydovchi</th><th class="num">Hajm</th><th>Holat</th></tr></thead>
        <tbody>${u.trips_day.length ? u.trips_day.map((t) => `<tr class="is-link" data-href="#/orders/${t.order_id}"><td class="strong"><a href="#/orders/${t.order_id}">${escapeHtml(t.order_number)}</a> №${t.trip_no}</td><td class="nowrap">${escapeHtml(t.plate_number)}<br><span class="muted">${escapeHtml(ownLabel(t.kind, t.ownership))}</span></td>
          <td>${escapeHtml(t.driver || '—')}</td><td class="num">${volume(t.volume_m3)}</td><td>${statusBadge(t.status, TRIP_STATUS)}</td></tr>`).join('') : emptyRow(5, 'Bu kuni qatnov yo‘q.')}</tbody></table></div></section>`;
    bindPeriod(holder);
    const go = () => setQuery({ driver: holder.querySelector('#fDriver').value, vehicle: holder.querySelector('#fVehicle').value, kind: holder.querySelector('#fKind').value });
    holder.querySelectorAll('#fDriver, #fVehicle, #fKind').forEach((el) => el.addEventListener('change', go));
    holder.querySelector('[data-reset]')?.addEventListener('click', () => setQuery({ driver: '', vehicle: '', kind: '' }));
    holder.querySelectorAll('.kind-pick__tile').forEach((t) => {
      const pick = (e) => { if (!e.target.closest('a')) setQuery({ kind: kind === t.dataset.kind ? '' : t.dataset.kind }); };
      t.addEventListener('click', pick);
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e); } });
    });
    holder.querySelectorAll('tr[data-driver]').forEach((r) => r.addEventListener('click', () => setQuery({ driver: r.dataset.driver })));
    holder.querySelectorAll('tr[data-vehicle]').forEach((r) => r.addEventListener('click', () => setQuery({ vehicle: r.dataset.vehicle })));
    holder.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = r.dataset.href; }));
  });
}
