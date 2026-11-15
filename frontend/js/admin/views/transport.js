/**
 * Transport bo'limi: umumiy panel, logistika rejalashtirish, xarajatlar va hisobot.
 * Hamma raqam bazadagi haqiqiy yozuvlardan; ma'lumot bo'lmasa bo'sh holat ko'rsatiladi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { todayISO } from '../../validators.js';
import { donut, groupedBars } from '../charts.js';
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
  return overview(ctx, holder);
}

/* ---------------------------------------------------------------- Umumiy panel */

async function overview(ctx, holder) {
  await load(ctx, holder, () => Promise.all([
    http('/admin/fleet/summary'), http(`/admin/trips${qs({ date: todayISO() })}`),
  ]), ([s, trips]) => {
    const own = s.by_ownership;
    const row = (key, label) => `<tr><td>${label}</td><td class="num">${own.own[key]}</td><td class="num">${own.rented[key]}</td><td class="num">${own.per_trip[key]}</td><td class="num strong">${own.own[key] + own.rented[key] + own.per_trip[key]}</td></tr>`;
    const live = trips.filter((t) => t.status !== 'cancelled');
    holder.innerHTML = `
      <div class="stats">
        ${stat({ label: 'Jami transport', value: nf(s.total), hint: `Mikser: ${s.by_kind.mixer} · nasos: ${s.by_kind.pump} · boshqa: ${s.by_kind.other}`, tone: 'accent' })}
        ${stat({ label: 'Band', value: nf(s.busy), hint: s.busy_pct === null ? '' : `Bandlik: ${nf(s.busy_pct, 1)}%`, tone: 'info' })}
        ${stat({ label: 'Bo‘sh (erkin)', value: nf(s.free), tone: 'success' })}
        ${stat({ label: 'Reysda (yo‘lda)', value: nf(s.on_road), hint: `Faol qatnov: ${s.active_trips}` })}
        ${stat({ label: 'Ta’mirda', value: nf(s.repair) })}
        ${stat({ label: 'Bugungi reyslar', value: nf(s.trips_today), hint: volume(s.volume_today_m3), tone: 'accent' })}
      </div>
      <div class="admin-grid admin-grid--main">
        <section class="box"><div class="box__head"><h2 class="box__title">Oxirgi ${s.daily.length} kun: reyslar</h2></div>
          <div class="box__body">${s.daily.some((d) => d.trips) ? groupedBars(
    s.daily.map((d) => ({ label: fmtDate(d.date).slice(0, 5), trips: d.trips, delivered: d.delivered })),
    [{ key: 'trips', label: 'Jami reys', cls: 'c0' }, { key: 'delivered', label: 'Yetkazildi', cls: 'c2' }], { unit: 'ta', labelEvery: 2 },
  ) : '<p class="muted">Bu davrda qatnovlar yo‘q. Qatnov buyurtma sahifasidan qo‘shiladi.</p>'}</div></section>
        <section class="box"><div class="box__head"><h2 class="box__title">Egalik bo‘yicha</h2></div>
          <div class="box__body"><div class="table-wrap"><table class="table"><thead><tr><th></th><th class="num">${OWNERSHIP.own}</th><th class="num">${OWNERSHIP.rented}</th><th class="num">${OWNERSHIP.per_trip}</th><th class="num">Jami</th></tr></thead>
            <tbody>${row('mixer', 'Mikserlar')}${row('pump', 'Beton nasoslari')}${row('other', 'Boshqa')}</tbody></table></div></div></section>
      </div>
      <section class="box mt-5"><div class="box__head"><h2 class="box__title">Bugungi reyslar (joriy holat)</h2>
        <a class="btn btn--outline btn--sm" href="#/planning">Logistika rejalashtirish →</a></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Buyurtma</th><th>Transport</th><th>Haydovchi</th><th class="num">Hajm</th><th>Holat</th></tr></thead>
        <tbody>${live.length ? live.map((t) => `<tr class="is-link" data-href="#/orders/${t.order_id}"><td class="strong"><a href="#/orders/${t.order_id}">${escapeHtml(t.order_number)}</a> №${t.trip_no}</td>
          <td class="nowrap">${escapeHtml(t.plate_number)}<br><span class="muted">${escapeHtml(OWNERSHIP[t.ownership])}</span></td><td>${escapeHtml(t.driver_name || '—')}</td>
          <td class="num">${volume(t.volume_m3)}</td><td>${statusBadge(t.status, TRIP_STATUS)}</td></tr>`).join('') : emptyRow(5, 'Bugun qatnovlar yo‘q.')}</tbody></table></div></section>`;
    holder.querySelectorAll('tr[data-href]').forEach((r) => r.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = r.dataset.href; }));
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
