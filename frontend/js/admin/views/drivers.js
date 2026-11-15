/**
 * Haydovchilar: davr bo'yicha hisobot (reys, hajm, bonus) va haydovchilar ro'yxati.
 *  - Davr sarlavha qatorida tanlanadi (‹ › tugmalari bilan oldinga-orqaga).
 *  - Haydovchini bossangiz — o'sha davrda qaysi kuni qayerga (qaysi mijozga) qancha beton olib borgani chiqadi.
 *  - «KPI» tugmasi: bir reys uchun bonus summasi har oy uchun bir marta kiritiladi (oy oxirida: reys × summa).
 * Bonus va kassa ma'lumotlari faqat admin uchun; boshqa rollar faqat ro'yxatni ko'radi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { bindPeriod, periodFromQuery, rangeBar } from '../period.js';
import { attachPhoneMask, validatePhone } from '../../validators.js';
import { downloadCsv } from './transport.js';
import {
  EMPLOYMENT, PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, icon, loadingHtml,
  localErrors, numberOrNull, phoneLink, toast,
} from '../components.js';

const nf = (v, d = 0) => formatNumber(v || 0, d);
const KINDS = [['mixer', 'Mikserlar'], ['other', 'Yuk avtomobillari'], ['pump', 'Beton nasoslari'], ['car', 'Yengil avtomobillar'], ['all', 'Barcha transport']];
const sel = (id, opts, val) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(val) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
const stat = ({ label, value, hint = '', tone = '' }) => `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;
const tg = (v) => (v ? `<a href="${/^https?:/.test(v) ? escapeHtml(v) : `https://t.me/${escapeHtml(v.replace(/^@/, ''))}`}" target="_blank" rel="noopener">${escapeHtml(v)}</a>` : '<span class="muted">—</span>');

export async function render(ctx) {
  const { root } = ctx;
  const canFleet = session.can(PERM.FLEET_MANAGE);
  const isAdmin = session.can(PERM.KPI_MANAGE);
  root.innerHTML = `<div id="reportBox"></div><div id="listBox"></div>`;
  const tasks = [];
  if (isAdmin) tasks.push(report(ctx, root.querySelector('#reportBox')));
  tasks.push(directory(ctx, root.querySelector('#listBox'), canFleet, isAdmin));
  await Promise.all(tasks);
}

/* ---------------------------------------------------------------- Hisobot (admin) */

async function report(ctx, box) {
  const { from, to } = periodFromQuery(ctx.query);
  const driver = ctx.query.get('driver') || '';
  const kind = ctx.query.get('kind') || 'mixer';
  box.innerHTML = loadingHtml();
  let r;
  let drv;
  try {
    [r, drv] = await Promise.all([
      http(`/admin/kpi/drivers${qs({ date_from: from, date_to: to, kind, driver_id: driver })}`),
      http('/admin/drivers'),
    ]);
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]')?.addEventListener('click', () => report(ctx, box));
    return;
  }
  if (!ctx.isCurrent()) return;
  const kindTitle = (KINDS.find(([k]) => k === kind) || [])[1] || '';
  const picked = drv.find((d) => String(d.id) === driver);
  const monthLabel = r.month;
  box.innerHTML = `
    <div class="page-actions">${rangeBar({ from, to })}
      ${sel('kKind', KINDS, kind)}
      ${sel('kDriver', [['', 'Haydovchi (hammasi)'], ...drv.filter((d) => d.is_active || String(d.id) === driver).map((d) => [d.id, d.full_name])], driver)}
      ${driver ? '<button class="btn btn--outline btn--sm" data-reset>Tozalash</button>' : ''}
      <button class="btn btn--primary" data-kpi title="Bir reys uchun bonus summasi (har oy uchun bir marta)">KPI: ${nf(r.bonus_per_trip)} so‘m / reys</button>
      <button class="btn btn--outline" data-csv>Eksport (CSV)</button>
    </div>
    <div class="stats">
      ${stat({ label: 'Reyslar (yetkazilgan)', value: nf(r.totals.trips), hint: escapeHtml(kindTitle), tone: 'accent' })}
      ${stat({ label: 'Hajm', value: `${nf(r.totals.volume_m3, 1)}<span class="stat__unit">m³</span>`, tone: 'info' })}
      ${stat({ label: 'Jami bonus', value: `${nf(r.totals.bonus)}<span class="stat__unit">so‘m</span>`, hint: `${nf(r.bonus_per_trip)} so‘m × reys`, tone: 'success' })}
    </div>
    ${r.pending_trips ? `<div class="kpi-warn">Shu davrda yakunlanmagan <b>${r.pending_trips}</b> ta qatnov bor — ular bonusga kirmaydi. Qatnov holatini «Yetkazildi» ga o‘tkazing.</div>` : ''}
    ${r.unassigned_trips ? `<div class="kpi-warn"><b>${r.unassigned_trips}</b> ta reysda haydovchi belgilanmagan — bunday reysga bonus yozilmaydi.</div>` : ''}
    <section class="box"><div class="box__head"><h2 class="box__title">${escapeHtml(kindTitle)} qatnovi bo‘yicha hisobot · ${escapeHtml(fmtDate(r.date_from))} – ${escapeHtml(fmtDate(r.date_to))}</h2></div>
      <div class="table-wrap"><table class="table kpi-table"><thead><tr><th>№</th><th>Haydovchi</th><th>Davlat raqami</th><th class="num">Reys soni</th><th class="num">Miqdori / m³</th><th class="num">Bonus</th><th class="num">Jami bonus</th></tr></thead>
      <tbody>${r.rows.length ? r.rows.map((x, i) => `<tr ${x.driver_id ? `class="is-link" data-driver="${x.driver_id}" title="Mijozlar bo‘yicha ko‘rish"` : ''}><td>${i + 1}</td><td class="strong">${escapeHtml(x.driver || 'Haydovchi belgilanmagan')}</td><td class="nowrap">${escapeHtml(x.plate_number)}</td>
        <td class="num">${x.trips}</td><td class="num">${nf(x.volume_m3, 1)}</td><td class="num">${x.driver_id ? (x.bonus_per_trip === null ? 'turlicha' : nf(x.bonus_per_trip)) : '—'}</td><td class="num strong">${x.driver_id ? nf(x.bonus) : '—'}</td></tr>`).join('')
    : emptyRow(7, 'Bu davrda yetkazilgan qatnov yo‘q.')}</tbody>
      ${r.rows.length ? `<tfoot><tr><td colspan="3">Итого:</td><td class="num">${nf(r.totals.trips)}</td><td class="num">${nf(r.totals.volume_m3, 1)}</td><td></td><td class="num">${nf(r.totals.bonus)}</td></tr></tfoot>` : ''}</table></div></section>
    ${driver ? detailHtml(r, picked) : '<p class="kpi-note">Haydovchini ustiga bossangiz, o‘sha davrda qaysi mijozga qancha beton olib borgani va qaysi kuni qayerga borgani chiqadi.</p>'}
    <p class="kpi-note">Bonus faqat «Yetkazildi» holatidagi reyslar uchun: reys soni × bir reys bonusi (kub metrga bog‘liq emas), oy oxirida to‘lanadi. Bonus summasi «KPI» tugmasi bilan har oy uchun bir marta kiritiladi (${escapeHtml(monthLabel)} oyi uchun hozir: ${nf(r.bonus_per_trip)} so‘m).</p>`;

  bindPeriod(box);
  const go = () => setQuery({ driver: box.querySelector('#kDriver').value, kind: box.querySelector('#kKind').value });
  box.querySelectorAll('#kDriver, #kKind').forEach((el) => el.addEventListener('change', go));
  box.querySelector('[data-reset]')?.addEventListener('click', () => setQuery({ driver: '' }));
  box.querySelectorAll('tr[data-driver]').forEach((row) => row.addEventListener('click', () => setQuery({ driver: row.dataset.driver })));
  box.querySelector('[data-kpi]').addEventListener('click', () => kpiForm(r.month, () => render(ctx)));
  box.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(`haydovchilar-${from}_${to}.csv`,
    [['№', 'Haydovchi', 'Davlat raqami', 'Reys soni', 'Miqdori m3', 'Bonus (1 reys)', 'Jami bonus']].concat(
      r.rows.map((x, i) => [i + 1, x.driver || 'Haydovchi belgilanmagan', x.plate_number, x.trips, x.volume_m3, x.driver_id ? (x.bonus_per_trip ?? '') : '', x.bonus]),
      [['', 'Итого', '', r.totals.trips, r.totals.volume_m3, '', r.totals.bonus]])));
}

function detailHtml(r, picked) {
  const name = picked?.full_name || '';
  return `<section class="box mt-5"><div class="box__head"><h2 class="box__title">Qaysi mijozga qancha beton olib borgan${name ? ` — ${escapeHtml(name)}` : ''}</h2></div>
    <div class="table-wrap"><table class="table kpi-table"><thead><tr><th>№</th><th>Mijoz</th><th>Aloqa</th><th class="num">Buyurtma</th><th class="num">Reys</th><th class="num">Hajm / m³</th></tr></thead>
    <tbody>${r.clients.length ? r.clients.map((c, i) => `<tr><td>${i + 1}</td><td class="strong">${escapeHtml(c.name)}</td><td>${escapeHtml(c.contact)}<br><span class="muted">${escapeHtml(c.phone)}</span></td><td class="num">${c.orders}</td><td class="num">${c.trips}</td><td class="num strong">${nf(c.volume_m3, 1)}</td></tr>`).join('')
    : emptyRow(6, 'Bu davrda mijozga yetkazilgan beton yo‘q.')}</tbody>
    ${r.clients.length ? `<tfoot><tr><td colspan="3">Итого:</td><td class="num">${r.clients.reduce((a, c) => a + c.orders, 0)}</td><td class="num">${r.clients.reduce((a, c) => a + c.trips, 0)}</td><td class="num">${nf(r.clients.reduce((a, c) => a + c.volume_m3, 0), 1)}</td></tr></tfoot>` : ''}</table></div></section>
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">Kunlar bo‘yicha: qaysi kuni qayerga qancha beton${name ? ` — ${escapeHtml(name)}` : ''}</h2></div>
    <div class="table-wrap"><table class="table kpi-table"><thead><tr><th>Sana</th><th>Buyurtma</th><th>Mijoz</th><th>Manzil</th><th>Marka</th><th>Mashina</th><th class="num">Hajm / m³</th></tr></thead>
    <tbody>${r.details.length ? r.details.map((d) => `<tr><td class="nowrap">${escapeHtml(fmtDate(d.date))}</td><td><a href="#/orders/${d.order_id}">${escapeHtml(d.order_number)}</a></td><td class="strong">${escapeHtml(d.customer)}</td><td>${d.address ? escapeHtml(d.address) : '<span class="muted">—</span>'}</td><td>${escapeHtml(d.grade)}</td><td class="nowrap">${escapeHtml(d.plate_number)}</td><td class="num">${nf(d.volume_m3, 1)}</td></tr>`).join('')
    : emptyRow(7, 'Bu davrda reys yo‘q.')}</tbody></table></div></section>`;
}

function kpiForm(month, onSaved) {
  formModal({
    title: 'KPI: bir reys uchun bonus',
    body: `${field({ name: 'month', label: 'Oy', type: 'month', value: month, required: true })}
      ${field({ name: 'rate', label: 'Bir reys uchun bonus (so‘m)', required: true, attrs: 'inputmode="decimal" autocomplete="off" placeholder="10000"', hint: 'Masalan 10 000. Bu oy uchun bir marta kiritiladi; oy oxirida hisob: reys soni × shu summa.' })}
      <p class="text-muted" data-current></p>`,
    onOpen: (form) => {
      const load = async () => {
        const m = form.elements.month.value;
        if (!m) return;
        try {
          const c = await http(`/admin/kpi/config${qs({ month: m })}`);
          form.elements.rate.value = String(c.driver_bonus_per_trip);
          form.querySelector('[data-current]').textContent = c.month_is_set ? 'Bu oy uchun summa avval kiritilgan.' : 'Bu oy uchun hali kiritilmagan (umumiy/standart summa ko‘rsatilmoqda).';
        } catch { /* qiymat qo'lda kiritiladi */ }
      };
      form.elements.month.addEventListener('change', load);
      load();
    },
    onSubmit: async (form) => {
      const v = numberOrNull(form.elements.rate.value);
      localErrors(form, { rate: v === null || Number.isNaN(v) || v <= 0 ? 'Musbat summa kiriting.' : null, month: form.elements.month.value ? null : 'Oyni tanlang.' });
      await http('/admin/kpi/config', { method: 'PUT', body: { driver_bonus_per_trip: v, month: form.elements.month.value } });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}

/* ---------------------------------------------------------------- Ro'yxat */

async function directory(ctx, box, canManage, isAdmin) {
  box.innerHTML = `<section class="box mt-5" id="driversBox">${loadingHtml()}</section>`;
  const holder = box.querySelector('#driversBox');
  let drivers;
  try {
    drivers = await http('/admin/drivers');
  } catch (err) {
    holder.innerHTML = errorHtml(err);
    holder.querySelector('[data-retry]')?.addEventListener('click', () => directory(ctx, box, canManage, isAdmin));
    return;
  }
  if (!ctx.isCurrent()) return;
  const again = () => render(ctx);
  holder.innerHTML = `
    <div class="box__head"><h2 class="box__title">Haydovchilar ro‘yxati (${drivers.length})</h2>
      ${canManage ? `<button type="button" class="btn btn--outline btn--sm" data-create>${icon('i-plus')} Haydovchi qo‘shish</button>` : ''}</div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Ism</th><th>Telefon</th><th>Telegram manzili</th><th>Turi</th><th>Holat</th><th class="num">Qatnovlar</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${drivers.length ? drivers.map((d) => `
        <tr data-id="${d.id}">
          <td class="strong">${escapeHtml(d.full_name)}${d.notes ? `<br><span class="muted">${escapeHtml(d.notes)}</span>` : ''}</td>
          <td class="nowrap">${phoneLink(d.phone)}</td>
          <td>${tg(d.telegram)}</td>
          <td>${escapeHtml(EMPLOYMENT[d.employment])}</td>
          <td>${d.is_active ? '<span class="status status--delivered">Faol</span>' : '<span class="status status--cancelled">Nofaol</span>'}</td>
          <td class="num">${d.trips_count}</td>
          ${canManage ? `<td class="num nowrap">
            <button type="button" class="icon-btn" data-edit aria-label="Tahrirlash" title="Tahrirlash">${icon('i-edit')}</button>
            ${d.trips_count === 0 ? `<button type="button" class="icon-btn" data-delete aria-label="O‘chirish" title="O‘chirish">${icon('i-trash')}</button>` : ''}
          </td>` : ''}
        </tr>`).join('') : emptyRow(canManage ? 7 : 6, 'Haydovchilar hali kiritilmagan.')}
      </tbody></table></div>`;
  holder.querySelector('[data-create]')?.addEventListener('click', () => driverForm(null, again));
  holder.querySelectorAll('tr[data-id]').forEach((row) => {
    const driver = drivers.find((d) => d.id === Number(row.dataset.id));
    row.querySelector('[data-edit]')?.addEventListener('click', () => driverForm(driver, again));
    row.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Haydovchini o‘chirish', text: `«${driver.full_name}» o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/drivers/${driver.id}`, { method: 'DELETE' });
        toast('Haydovchi o‘chirildi.', 'success');
        again();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function driverForm(driver, onSaved) {
  const d = driver || { full_name: '', phone: '', telegram: '', employment: 'staff', is_active: true, notes: '' };
  formModal({
    title: driver ? 'Haydovchini tahrirlash' : 'Yangi haydovchi',
    body: `
      ${field({ name: 'full_name', label: 'Ism-familiya', value: d.full_name, required: true, attrs: 'maxlength="150"' })}
      <div class="form-row">
        ${field({ name: 'phone', label: 'Telefon', type: 'tel', value: d.phone, required: true, attrs: 'inputmode="tel" placeholder="+998 (90) 123-45-67"' })}
        ${field({ name: 'telegram', label: 'Telegram manzili', value: d.telegram || '', attrs: 'maxlength="64" placeholder="@username"' })}
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
        license_number: driver?.license_number || null,
        telegram: f.telegram.value.trim() || null,
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
