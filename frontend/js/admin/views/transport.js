/**
 * Transport bo'limi: umumiy panel, logistika rejalashtirish, xarajatlar va hisobot.
 * Hamma raqam bazadagi haqiqiy yozuvlardan; ma'lumot bo'lmasa bo'sh holat ko'rsatiladi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { todayISO } from '../../validators.js';
import { donut, groupedBars, lineChart, ring } from '../charts.js';
import {
  OWNERSHIP, PERM, TRIP_STATUS, VEHICLE_STATUS, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal,
  icon, loadingHtml, localErrors, money, numberOrNull, statusBadge, toast, volume,
} from '../components.js';

const KIND = { mixer: 'Mikser', pump: 'Beton nasosi', other: 'Boshqa' };
const EXPENSE = { fuel: 'Yoqilg‘i', repair: 'Ta’mir', tires: 'Shina', insurance: 'Sug‘urta', other: 'Boshqa' };
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
  if (route === 'planning') return planning(ctx, holder);
  if (route === 'expenses') return expenses(ctx, holder);
  if (route === 'fleet-report') return report(ctx, holder);
  return overview(ctx, holder, route === 'vehicles');
}

/* ---------------------------------------------------------------- Transport dashboard */

const OWN_ROWS = [['own', 'O‘zimizniki'], ['rented', 'Arenda'], ['per_trip', 'Reys bay']];
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
    const groups = [['mixer_own', 'Mikserlar (o‘zimizniki)', 'c0'], ['mixer_hired', 'Mikserlar (arenda / reys bay)', 'c6'], ['pump_own', 'Nasoslar (o‘zimizniki)', 'c4'], ['pump_hired', 'Nasoslar (arenda / reys bay)', 'c1']];
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
    const kindOpts = [['', 'Transport turi (hammasi)'], ['mixer', 'Mikserlar'], ['pump', 'Beton nasoslari'], ['other', 'Boshqa']];
    const ownOpts = [['', 'Egalik turi (hammasi)'], ...OWN_ROWS];
    const vsOpts = [['', 'Holati (hammasi)'], ['free', 'Bo‘sh'], ['busy', 'Band'], ['repair', 'Ta’mirda']];
    const drvOpts = [['', 'Haydovchi (hammasi)']].concat(drivers.filter((d) => d.is_active).map((d) => [d.id, d.full_name]));

    holder.innerHTML = `
      <div class="page-actions">
        <input class="input" type="date" id="fDate" value="${escapeHtml(f.date)}" aria-label="Sana">
        ${sel('fKind', kindOpts, f.kind)}${sel('fOwn', ownOpts, f.own)}${sel('fVs', vsOpts, f.vs)}${sel('fDriver', drvOpts, f.driver)}
        <span class="page-actions__spacer"></span><a class="btn btn--primary" href="#/planning">${icon('i-plus')} Yangi reys</a>
      </div>
      <div class="stats">
        ${stat({ label: 'Jami transport', value: nf(s.total), hint: `Mikser ${s.by_kind.mixer} · nasos ${s.by_kind.pump} · boshqa ${s.by_kind.other}`, tone: 'accent' })}
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
              <td class="nowrap">${escapeHtml(t.plate_number)}</td><td>${escapeHtml(KIND[t.kind] || t.kind)} <span class="muted">(${escapeHtml(OWNERSHIP[t.ownership])})</span></td><td>${escapeHtml(t.driver || '—')}</td>
              <td>${escapeHtml(t.customer || '—')}${t.address ? `<br><span class="muted">${escapeHtml(t.address)}</span>` : ''}</td><td class="num">${volume(t.volume_m3)}</td><td>${statusBadge(t.status, TRIP_STATUS)}</td></tr>`).join('')
    : emptyRow(7, 'Tanlangan sana va filtrlar bo‘yicha qatnovlar yo‘q.')}</tbody></table></div>
            <div class="pagination"><span>${mon.total ? `${(mon.page - 1) * mon.page_size + 1}–${Math.min(mon.total, mon.page * mon.page_size)} / ${mon.total} ta natija` : '0 ta natija'}</span>
              <div class="btn-row"><button class="btn btn--outline btn--sm" data-page="${f.page - 1}" ${f.page <= 1 ? 'disabled' : ''}>← Oldingi</button><button class="btn btn--outline btn--sm" data-page="${f.page + 1}" ${f.page >= pages ? 'disabled' : ''}>Keyingi →</button></div></div></section>
        </div>
        <section class="box"><div class="box__head"><h2 class="box__title">Mikser va nasoslar (egalik bo‘yicha)</h2></div>
          <div class="box__body fleet-card">
            <div class="fleet-card__row"><div><img class="fleet-card__img" src="../assets/img/mixer-static.svg?v=1" alt="" width="360" height="170"><span class="fleet-card__cap">Beton mikser</span></div>
              <div class="own-list">${OWN_ROWS.map(([o, l]) => `<div><span>${l}</span><span><b>${cnt('mixer', o)}</b> ta ${cnt('mixer', o) ? `<span class="tag">${activePct('mixer', o)}% faol</span>` : ''}</span></div>`).join('')}</div></div>
            <div class="fleet-card__row"><div><img class="fleet-card__img" src="../assets/img/pump-truck.svg?v=1" alt="" width="360" height="170"><span class="fleet-card__cap">Beton nasosi</span></div>
              <div class="own-list">${OWN_ROWS.map(([o, l]) => `<div><span>${l}</span><span><b>${cnt('pump', o)}</b> ta ${cnt('pump', o) ? `<span class="tag">${activePct('pump', o)}% faol</span>` : ''}</span></div>`).join('')}</div></div>
            <h3 class="an-sub">Yoqilg‘i va reyslar (${s.daily.length} kun)</h3>
            ${totalTrips || totalFuel ? lineChart(fuelSeries, s.daily.map((_, i) => i), { height: 150, xLabel: (i) => fmtDate(s.daily[i].date).slice(0, 5) }) : '<p class="muted">Reys yoki yoqilg‘i xarajati kiritilmagan.</p>'}
            ${totalTrips || totalFuel ? `<p class="text-muted">Jami: ${nf(totalTrips)} reys, yoqilg‘i ${nf(totalFuel)} so‘m (har chiziq o‘z maksimumiga nisbatan).</p>` : ''}
          </div></section>
      </div>
      ${withList ? '<div id="vehicleList" class="mt-5"></div>' : ''}`;

    const go = (extra = {}) => setQuery({
      date: holder.querySelector('#fDate').value, kind: holder.querySelector('#fKind').value, own: holder.querySelector('#fOwn').value,
      vs: holder.querySelector('#fVs').value, driver: holder.querySelector('#fDriver').value, page: '', ...extra,
    });
    holder.querySelectorAll('#fDate, #fKind, #fOwn, #fVs, #fDriver').forEach((el) => el.addEventListener('change', () => go()));
    holder.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => go({ page: b.dataset.page })));
    holder.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = r.dataset.href; }));
    if (withList) import('./vehicles.js').then((m) => m.render({ ...ctx, root: holder.querySelector('#vehicleList'), meta: { route: 'vehicles' } }));
  });
}

/* ---------------------------------------------------------------- Logistika rejalashtirish */

async function planning(ctx, holder) {
  const day = ctx.query.get('date') || todayISO();
  await load(ctx, holder, () => http(`/admin/fleet/planning${qs({ date: day })}`), (p) => {
    const free = p.vehicles.filter((v) => v.status !== 'repair');
    holder.innerHTML = `
      <div class="page-actions"><label class="text-muted" for="planDate">Sana:</label>
        <input class="input" type="date" id="planDate" value="${escapeHtml(day)}">
        <span class="text-muted">${p.orders.length} ta buyurtma · biriktirilmagan: <strong>${volume(p.unassigned_total_m3)}</strong></span></div>
      <div class="admin-grid admin-grid--main">
        <section class="box"><div class="box__head"><h2 class="box__title">Buyurtmalar</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Buyurtma</th><th>Vaqt</th><th>Manzil</th><th class="num">Buyurtma</th><th class="num">Biriktirilgan</th><th class="num">Qolgan</th><th>Qatnovlar</th></tr></thead>
          <tbody>${p.orders.length ? p.orders.map((o) => `<tr class="is-link" data-href="#/orders/${o.id}">
            <td class="strong"><a href="#/orders/${o.id}">${escapeHtml(o.order_number)}</a><br><span class="muted">${escapeHtml(o.customer || '')}</span></td>
            <td class="nowrap">${escapeHtml(o.delivery_time || '—')}</td><td>${o.delivery_required ? escapeHtml(o.address || '—') : '<span class="muted">O‘zi olib ketadi</span>'}</td>
            <td class="num">${volume(o.ordered_m3)}</td><td class="num">${volume(o.assigned_m3)}</td>
            <td class="num ${o.unassigned_m3 > 0 ? 'strong text-danger' : ''}">${o.unassigned_m3 > 0 ? volume(o.unassigned_m3) : '✓'}</td>
            <td>${o.trips.length ? o.trips.map((t) => `<span class="badge">${escapeHtml(t.plate_number)} · ${nf(t.volume_m3, 1)}</span>`).join(' ') : '<span class="muted">—</span>'}</td></tr>`).join('')
    : emptyRow(7, `${fmtDate(day)} uchun buyurtmalar yo‘q.`)}</tbody></table></div></section>
        <section class="box"><div class="box__head"><h2 class="box__title">Transport (${free.length})</h2></div>
          <div class="table-wrap"><table class="table"><thead><tr><th>Raqam</th><th>Bo‘lim</th><th>Holat</th><th class="num">Reys</th></tr></thead>
          <tbody>${free.length ? free.map((v) => `<tr><td class="nowrap strong">${escapeHtml(v.plate_number)}<br><span class="muted">${escapeHtml(OWNERSHIP[v.ownership])}${v.capacity_m3 ? ` · ${nf(v.capacity_m3, 1)} m³` : ''}</span></td>
            <td>${escapeHtml(KIND[v.kind] || v.kind)}</td><td>${statusBadge(v.status, VEHICLE_STATUS)}</td><td class="num">${v.trips_that_day}</td></tr>`).join('') : emptyRow(4, 'Faol transport yo‘q.')}</tbody></table></div></section>
      </div>
      <p class="text-muted mt-5">Qatnov buyurtma sahifasidan biriktiriladi: buyurtmani oching → «Qatnovlar».</p>`;
    holder.querySelector('#planDate').addEventListener('change', (e) => setQuery({ date: e.target.value }));
    holder.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = r.dataset.href; }));
  });
}

/* ---------------------------------------------------------------- Xarajatlar */

function periodBar({ from, to, extra = '' }) {
  return `<div class="page-actions"><label class="text-muted">Dan:</label><input class="input" type="date" id="pFrom" value="${escapeHtml(from)}">
    <label class="text-muted">Gacha:</label><input class="input" type="date" id="pTo" value="${escapeHtml(to)}">${extra}</div>`;
}

function bindPeriod(holder) {
  const go = () => setQuery({ from: holder.querySelector('#pFrom').value, to: holder.querySelector('#pTo').value });
  holder.querySelector('#pFrom').addEventListener('change', go);
  holder.querySelector('#pTo').addEventListener('change', go);
}

const monthStart = () => `${todayISO().slice(0, 8)}01`;

async function expenses(ctx, holder) {
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || todayISO();
  const canManage = session.can(PERM.FLEET_MANAGE);
  await load(ctx, holder, () => Promise.all([
    http(`/admin/fleet/expenses${qs({ date_from: from, date_to: to })}`), http('/admin/vehicles'),
  ]), ([data, vehicles]) => {
    holder.innerHTML = `${periodBar({ from, to, extra: `<span class="page-actions__spacer"></span>${canManage ? `<button class="btn btn--primary" data-add>${icon('i-plus')} Xarajat qo‘shish</button>` : ''}` })}
      <div class="stats">${stat({ label: 'Jami xarajat', value: `${nf(data.total)}<span class="stat__unit">so‘m</span>`, tone: 'accent' })}
        ${Object.entries(data.by_category).map(([k, v]) => stat({ label: EXPENSE[k] || k, value: `${nf(v)}<span class="stat__unit">so‘m</span>` })).join('')}</div>
      <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th>Transport</th><th>Turi</th><th class="num">Summa</th><th>Izoh</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${data.items.length ? data.items.map((e) => `<tr data-id="${e.id}"><td class="nowrap">${fmtDate(e.expense_date)}</td><td class="strong nowrap">${escapeHtml(e.plate_number)}</td>
        <td>${escapeHtml(EXPENSE[e.category] || e.category)}</td><td class="num">${money(e.amount)}</td><td>${escapeHtml(e.note || '')}</td>
        ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 6 : 5, 'Bu davrda xarajat kiritilmagan.')}</tbody></table></div></section>
      <p class="text-muted mt-5">Arenda va reys bay transport uchun <strong>qatnov narxi</strong> buyurtmadagi qatnovda kiritiladi va «Hisobotlar»da shu xarajatlarga qo‘shib hisoblanadi.</p>`;
    bindPeriod(holder);
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

function expenseForm(item, vehicles, onSaved) {
  const e = item || { vehicle_id: '', expense_date: todayISO(), category: 'fuel', amount: '', note: '' };
  formModal({
    title: item ? 'Xarajatni tahrirlash' : 'Yangi xarajat',
    body: `${field({ name: 'vehicle_id', label: 'Transport', required: true, value: e.vehicle_id, options: [{ value: '', label: '— tanlang —' }].concat(vehicles.filter((v) => v.is_active || v.id === e.vehicle_id).map((v) => ({ value: v.id, label: `${v.plate_number} · ${v.vehicle_type}` }))) })}
      <div class="form-row">${field({ name: 'expense_date', label: 'Sana', type: 'date', value: e.expense_date, required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'category', label: 'Turi', value: e.category, options: Object.entries(EXPENSE).map(([value, label]) => ({ value, label })) })}</div>
      ${field({ name: 'amount', label: 'Summa (so‘m)', value: e.amount, required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'note', label: 'Izoh', type: 'textarea', rows: 2, value: e.note || '', attrs: 'maxlength="500"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.amount.value);
      localErrors(form, {
        vehicle_id: f.vehicle_id.value ? null : 'Transportni tanlang.',
        amount: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Musbat summa kiriting.' : null,
      });
      const body = { vehicle_id: Number(f.vehicle_id.value), expense_date: f.expense_date.value, category: f.category.value, amount, note: f.note.value.trim() || null };
      if (item) await http(`/admin/fleet/expenses/${item.id}`, { method: 'PUT', body });
      else await http('/admin/fleet/expenses', { method: 'POST', body });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}

/* ---------------------------------------------------------------- Hisobotlar */

function downloadCsv(name, rows) {
  const text = rows.map((r) => r.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n');
  const blob = new Blob([`﻿${text}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function report(ctx, holder) {
  const to = ctx.query.get('to') || todayISO();
  const from = ctx.query.get('from') || new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
  await load(ctx, holder, () => http(`/admin/fleet/report${qs({ date_from: from, date_to: to })}`), (r) => {
    const t = r.totals;
    const costParts = Object.entries(r.rows.reduce((acc, row) => {
      Object.entries(row.expenses).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; });
      return acc;
    }, {})).map(([k, v]) => ({ label: EXPENSE[k] || k, value: v }));
    if (t.rental_cost) costParts.push({ label: 'Arenda / reys bay', value: t.rental_cost });
    holder.innerHTML = `${periodBar({ from, to, extra: '<span class="page-actions__spacer"></span><button class="btn btn--outline" data-csv>Eksport (CSV)</button>' })}
      <div class="stats">${stat({ label: 'Qatnovlar', value: nf(t.trips), hint: `Yetkazildi: ${nf(t.delivered_trips)}`, tone: 'accent' })}
        ${stat({ label: 'Hajm', value: `${nf(t.volume_m3, 1)}<span class="stat__unit">m³</span>`, hint: `Yetkazilgan: ${nf(t.delivered_m3, 1)} m³` })}
        ${stat({ label: 'Arenda / reys bay', value: `${nf(t.rental_cost)}<span class="stat__unit">so‘m</span>` })}
        ${stat({ label: 'Boshqa xarajatlar', value: `${nf(t.expenses_total)}<span class="stat__unit">so‘m</span>` })}
        ${stat({ label: 'Jami transport xarajati', value: `${nf(t.cost_total)}<span class="stat__unit">so‘m</span>`, tone: 'info' })}</div>
      <div class="admin-grid admin-grid--main">
        <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Transport</th><th>Bo‘lim</th><th>Egasi</th><th class="num">Reys</th><th class="num">Hajm</th><th class="num">Arenda</th><th class="num">Xarajat</th><th class="num">Jami</th></tr></thead>
        <tbody>${r.rows.length ? r.rows.map((x) => `<tr><td class="strong nowrap">${escapeHtml(x.plate_number)}<br><span class="muted">${escapeHtml(x.vehicle_type)}</span></td><td>${escapeHtml(KIND[x.kind] || x.kind)}</td><td>${escapeHtml(OWNERSHIP[x.ownership])}</td>
          <td class="num">${x.trips}</td><td class="num">${nf(x.volume_m3, 1)}</td><td class="num">${nf(x.rental_cost)}</td><td class="num">${nf(x.expenses_total)}</td><td class="num strong">${nf(x.cost_total)}</td></tr>`).join('')
    : emptyRow(8, 'Transport yoki ma’lumot yo‘q.')}</tbody></table></div></section>
        <section class="box"><div class="box__head"><h2 class="box__title">Xarajat tarkibi</h2></div><div class="box__body">${donut(costParts, { unit: 'so‘m' })}</div></section>
      </div>`;
    bindPeriod(holder);
    holder.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(`transport-hisobot-${from}_${to}.csv`,
      [['Davlat raqami', 'Turi', 'Bo‘lim', 'Egasi', 'Reys', 'Hajm m3', 'Arenda', 'Xarajat', 'Jami']].concat(
        r.rows.map((x) => [x.plate_number, x.vehicle_type, KIND[x.kind], OWNERSHIP[x.ownership], x.trips, x.volume_m3, x.rental_cost, x.expenses_total, x.cost_total]))));
  });
}
