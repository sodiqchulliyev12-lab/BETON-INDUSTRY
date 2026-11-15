/**
 * Sotuvchilar hisoboti va KPI (faqat admin). Haydovchi bonusi — «Haydovchilar» bo'limida.
 *  - Sotuvchilar hisoboti: sotuvchi → mijoz bo'yicha hajm, summa, tushgan pul va bonus. Bonus foizi mijozdan pul necha kun ichida
 *    tushganiga bog'liq (10 / 20 / 30 / 30+ kun); foizlar har oy mijoz bo'yicha belgilanib tasdiqlanadi.
 * Hamma raqam bazadagi yozuvlardan; kiritilmagan narsa taxmin qilinmaydi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { setQuery } from '../app.js';
import { bindPeriod, periodFromQuery, rangeBar } from '../period.js';
import { todayISO } from '../../validators.js';
import { downloadCsv } from './transport.js';
import {
  confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, loadingHtml, localErrors, numberOrNull, toast,
} from '../components.js';

const nf = (v, d = 0) => formatNumber(v || 0, d);
const sel = (id, opts, val) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${escapeHtml(v)}" ${String(v) === String(val) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;
const stat = ({ label, value, hint = '', tone = '' }) => `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;
const som = (v) => `${nf(v)}<span class="stat__unit">so‘m</span>`;

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
  ctx.root.innerHTML = '<div id="pageBody"></div>';
  const holder = ctx.root.querySelector('#pageBody');
  return sales(ctx, holder);
}

/* ---------------------------------------------------------------- Sotuvchilar */

const openRows = new Set(); // ochilgan mijoz qatorlari (qayta chizilganda saqlanadi)
const TIER_LABEL = ['10 kun', '20 kun', '30 kun', '30+ kun'];
const TIER_KEY = ['pct_10', 'pct_20', 'pct_30', 'pct_over'];
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const rateSource = (rt) => ({ month: rt.approved ? '✔ oy foizi (tasdiqlangan)' : 'oy foizi (tasdiqlanmagan)', customer: 'mijoz foizi', default: 'standart foiz' }[rt.source] || '');
function monthBanner(ms) {
  const ok = ms.customers > 0 && ms.approved === ms.customers;
  return `<div class="${ok ? 'kpi-note' : 'kpi-warn'} kpi-month"><span><b>${escapeHtml(monthName(ms.month))}</b> foizlari: ${ok ? `tasdiqlangan${ms.approved_at ? ` (${escapeHtml(fmtDate(ms.approved_at.slice(0, 10)))})` : ''}` : 'hali tasdiqlanmagan'}.</span>
    ${ok ? '<button class="btn btn--outline btn--sm" data-unapprove>Tasdiqni bekor qilish</button>' : '<button class="btn btn--primary btn--sm" data-approve>Oy foizlarini tasdiqlash</button>'}</div>`;
}
const pctText = (v) => `${String(v).replace('.', ',')}%`;

async function sales(ctx, holder) {
  const { from, to } = periodFromQuery(ctx.query);
  const manager = ctx.query.get('seller') || '';
  await load(ctx, holder, () => Promise.all([
    http(`/admin/kpi/sales${qs({ date_from: from, date_to: to, manager_id: manager && manager !== 'none' ? manager : '', unassigned: manager === 'none' ? 'true' : '' })}`),
    http('/admin/users'),
  ]), ([r, users]) => {
    const staff = users.filter((u) => u.is_active);
    const t = r.totals;
    const rows = r.rows;
    holder.innerHTML = `<div data-root>
      <div class="page-actions">${rangeBar({ from, to })}
        ${sel('sSeller', [['', 'Sotuvchi (hammasi)'], ['none', 'Sotuvchi biriktirilmagan'], ...staff.map((u) => [u.id, u.full_name])], manager)}
        <span class="page-actions__spacer"></span><button class="btn btn--outline" data-csv>Eksport (CSV)</button></div>
      <div class="stats">
        ${stat({ label: 'Sotilgan beton', value: `${nf(t.volume_m3, 1)}<span class="stat__unit">m³</span>`, hint: `${t.orders} ta buyurtma`, tone: 'accent' })}
        ${stat({ label: 'Summasi', value: som(t.amount), tone: 'info' })}
        ${stat({ label: 'Pul tushumi', value: som(t.paid), hint: `To‘lanmagan: <b>${nf(t.unpaid)}</b> so‘m`, tone: 'success' })}
        ${stat({ label: 'Jami bonus', value: som(t.bonus) })}
      </div>
      ${monthBanner(r.month_status)}
      ${t.unassigned_orders ? `<div class="kpi-warn"><b>${t.unassigned_orders}</b> ta buyurtmada sotuvchi belgilanmagan. Jadvalda mijoz qatorini oching va har bir buyurtmaga sotuvchini tanlang.</div>` : ''}
      ${t.no_price_orders ? `<div class="kpi-warn"><b>${t.no_price_orders}</b> ta buyurtma narxi belgilanmagan — summasi hisoblanmaydi (tushgan pul bo‘yicha bonus esa hisoblanadi).</div>` : ''}
      ${r.managers.length > 1 || (r.managers[0] && r.managers[0].manager_id) ? `<section class="box"><div class="box__head"><h2 class="box__title">Sotuvchilar bo‘yicha</h2></div>
        <div class="table-wrap"><table class="table kpi-table"><thead><tr><th>Sotuvchi</th><th class="num">Mijozlar</th><th class="num">Hajm / m³</th><th class="num">Summasi</th><th class="num">Pul tushumi</th><th class="num">Bonus</th></tr></thead>
        <tbody>${r.managers.map((m) => `<tr><td class="strong">${escapeHtml(m.manager || 'Sotuvchi biriktirilmagan')}</td><td class="num">${m.clients}</td><td class="num">${nf(m.volume_m3, 1)}</td><td class="num">${nf(m.amount)}</td><td class="num">${nf(m.paid)}</td><td class="num strong">${nf(m.bonus)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <section class="box mt-5"><div class="box__head"><h2 class="box__title">Sotuvchilar bo‘yicha hisobot · ${escapeHtml(fmtDate(r.date_from))} – ${escapeHtml(fmtDate(r.date_to))}</h2></div>
        <div class="table-wrap"><table class="table kpi-table"><thead><tr><th>№</th><th>Sotuv menejeri</th><th>Mijoz</th><th>Marka</th><th class="num">Miqdori / m³</th><th class="num">Narxi</th><th class="num">Summasi</th><th class="num">Pul tushumi</th>
          ${TIER_LABEL.map((l) => `<th class="num">${l}</th>`).join('')}<th class="num">Itogo bonus</th></tr></thead>
        <tbody>${rows.length ? rows.map((g, i) => {
    const key = `${g.manager_id || 0}-${g.customer_id}`;
    return `<tr class="is-link" data-row="${key}"><td>${i + 1}</td><td>${escapeHtml(g.manager || '—')}</td><td class="strong">${escapeHtml(g.customer)}<span class="pct">${rateSource(g.rates)}</span></td><td>${escapeHtml(g.grades.join(', '))}</td>
        <td class="num">${nf(g.volume_m3, 1)}</td><td class="num">${g.price_avg === null ? '—' : nf(g.price_avg)}</td><td class="num">${nf(g.amount)}</td><td class="num">${nf(g.paid)}${g.unpaid ? `<span class="pct">qoldi ${nf(g.unpaid)}</span>` : ''}</td>
        ${g.tiers.map((v, k) => `<td class="num">${v ? nf(v) : '—'}<span class="pct">${pctText(g.rates[TIER_KEY[k]])}</span></td>`).join('')}<td class="num strong">${nf(g.bonus)}</td></tr>
      <tr class="kpi-detail" data-detail="${key}" ${openRows.has(key) ? '' : 'hidden'}><td colspan="13">${detail(g, staff)}</td></tr>`;
  }).join('') : emptyRow(13, 'Bu davrda yetkazilgan buyurtma yo‘q.')}</tbody>
        ${rows.length ? `<tfoot><tr><td colspan="4">Итого:</td><td class="num">${nf(t.volume_m3, 1)}</td><td></td><td class="num">${nf(t.amount)}</td><td class="num">${nf(t.paid)}</td><td colspan="4"></td><td class="num">${nf(t.bonus)}</td></tr></tfoot>` : ''}</table></div></section>
      <div class="kpi-note"><p><b>Bonus qanday hisoblanadi.</b> Mijozdan tushgan pul yetkazib berilgan kundan necha kun o‘tib kelganiga qarab foiz olinadi: 10 kun ichida (oldindan to‘langan ham shu yerga kiradi), 11–20 kun, 21–30 kun, 30 kundan keyin. Foizlar har oy mijoz (sotuvchi) bilan kelishilib, oy boshida «Oy foizlarini tasdiqlash» tugmasi bilan tasdiqlanadi — tasdiqlangan oy hisobi keyin o‘zgarmaydi. Kelishilmagan mijozda standart: ${TIER_KEY.map((k, i) => `${TIER_LABEL[i]} — ${pctText(r.default_rates[k])}`).join(', ')}.</p>
        <p>Hisobga yetkazilgan buyurtmalar kiradi (yetkazish sanasi shu davrda). Pul keyinroq tushsa bonus ham o‘sha vaqtda to‘ldiriladi. Qatorni bossangiz — buyurtmalar, to‘lovlarni kiritish, sotuvchini tanlash va mijoz foizlarini o‘zgartirish ochiladi.</p></div></div>`;
    const root = holder.querySelector('[data-root]');
    bindPeriod(holder, { page: '' });
    root.querySelector('#sSeller').addEventListener('change', (e) => setQuery({ seller: e.target.value }));
    const rerender = () => sales(ctx, holder);
    root.querySelectorAll('tr[data-row]').forEach((tr) => tr.addEventListener('click', () => {
      const d = root.querySelector(`tr[data-detail="${tr.dataset.row}"]`);
      d.hidden = !d.hidden;
      if (d.hidden) openRows.delete(tr.dataset.row); else openRows.add(tr.dataset.row);
    }));
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const g = rows.find((x) => `${x.manager_id || 0}-${x.customer_id}` === b.closest('tr.kpi-detail')?.dataset.detail);
      if (!g) return;
      if (b.dataset.act === 'pay') paymentForm(g.orders.find((o) => String(o.id) === b.dataset.order), rerender);
      if (b.dataset.act === 'rates') ratesForm(g, r.default_rates, r.month_status.month, rerender);
      if (b.dataset.act === 'unpay' && await confirmAction({ title: 'To‘lovni o‘chirish', text: 'Bu to‘lov o‘chiriladi va bonus qayta hisoblanadi.', confirmLabel: 'O‘chirish' })) {
        await http(`/admin/kpi/payments/${b.dataset.id}`, { method: 'DELETE' });
        toast('O‘chirildi.', 'success');
        rerender();
      }
    });
    root.addEventListener('change', async (e) => {
      const s = e.target.closest('select[data-manager]');
      if (!s) return;
      try {
        await http(`/admin/kpi/orders/${s.dataset.manager}/manager`, { method: 'PUT', body: { manager_id: s.value ? Number(s.value) : null } });
        toast('Sotuvchi saqlandi.', 'success');
        rerender();
      } catch (err) {
        toast(err.message || 'Saqlanmadi.', 'error');
      }
    });
    root.querySelector('[data-approve]')?.addEventListener('click', async () => {
      const m = r.month_status.month;
      if (!(await confirmAction({ title: 'Oy foizlarini tasdiqlash', text: `${m} oyi uchun hamma mijozlarning amaldagi foizlari qotiriladi. Keyin ularni o‘zgartirib bo‘lmaydi (tasdiqni bekor qilmaguncha).`, confirmLabel: 'Tasdiqlash' }))) return;
      await http('/admin/kpi/rates/approve', { method: 'POST', body: { month: m } });
      toast('Oy foizlari tasdiqlandi.', 'success');
      rerender();
    });
    root.querySelector('[data-unapprove]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Tasdiqni bekor qilish', text: 'Oy foizlarini yana o‘zgartirish mumkin bo‘ladi.', confirmLabel: 'Bekor qilish' }))) return;
      await http(`/admin/kpi/rates/approve/${r.month_status.month}`, { method: 'DELETE' });
      toast('Tasdiq bekor qilindi.', 'success');
      rerender();
    });
    root.querySelector('[data-csv]').addEventListener('click', () => downloadCsv(`sotuvchilar-kpi-${from}_${to}.csv`,
      [['№', 'Sotuv menejeri', 'Mijoz', 'Marka', 'Miqdori m3', 'Narxi', 'Summasi', 'Pul tushumi', ...TIER_LABEL.map((l) => `${l} (so‘m)`), ...TIER_LABEL.map((l) => `${l} %`), 'Itogo bonus']].concat(
        rows.map((g, i) => [i + 1, g.manager || '', g.customer, g.grades.join(', '), g.volume_m3, g.price_avg ?? '', g.amount, g.paid, ...g.tiers, ...TIER_KEY.map((k) => g.rates[k]), g.bonus]),
        [['', 'Итого', '', '', t.volume_m3, '', t.amount, t.paid, '', '', '', '', '', '', '', '', t.bonus]])));
  });
}

/** Mijoz qatorining ichi: buyurtmalar, to'lovlar, sotuvchi tanlash, foizlar */
function detail(g, staff) {
  return `<div class="btn-row kpi-detail__bar"><button class="btn btn--outline btn--sm" data-act="rates">Mijoz foizlari: ${TIER_KEY.map((k) => pctText(g.rates[k])).join(' / ')} ✎</button></div>
    <table><thead><tr><th>Buyurtma</th><th>Yetkazilgan</th><th class="num">Hajm</th><th class="num">Summa</th><th class="num">To‘langan</th><th class="num">Bonus</th><th>Sotuvchi</th><th>To‘lovlar</th></tr></thead><tbody>
    ${g.orders.map((o) => `<tr><td><a href="#/orders/${o.id}">${escapeHtml(o.order_number)}</a></td><td>${escapeHtml(fmtDate(o.delivery_date))}</td><td class="num">${nf(o.volume_m3, 1)}</td><td class="num">${o.amount === null ? '—' : nf(o.amount)}</td><td class="num">${nf(o.paid)}</td><td class="num">${nf(o.bonus)}</td>
      <td><select class="select" data-manager="${o.id}"><option value="">— tanlanmagan —</option>${staff.map((u) => `<option value="${u.id}" ${u.id === o.manager_id ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`).join('')}</select></td>
      <td>${o.payments.map((p) => `<div>${escapeHtml(fmtDate(p.paid_on))} · <b>${nf(p.amount)}</b> so‘m <span class="muted">(${p.days <= 0 ? 'oldindan / shu kuni' : `${p.days} kun`})</span>${p.note ? ` · ${escapeHtml(p.note)}` : ''} <button class="btn btn--outline btn--sm" data-act="unpay" data-id="${p.id}" title="To‘lovni o‘chirish">✕</button></div>`).join('') || '<span class="muted">to‘lov yo‘q</span>'}
        <button class="btn btn--outline btn--sm" data-act="pay" data-order="${o.id}">+ To‘lov</button></td></tr>`).join('')}</tbody></table>`;
}

function paymentForm(order, onSaved) {
  formModal({
    title: `To‘lov kiritish — ${order.order_number}`,
    body: `<p class="text-muted">Buyurtma summasi: ${order.amount === null ? 'narx belgilanmagan' : `${nf(order.amount)} so‘m`}. Hozirgacha to‘langan: ${nf(order.paid)} so‘m. Yetkazilgan sana: ${escapeHtml(fmtDate(order.delivery_date))}.</p>
      ${field({ name: 'paid_on', label: 'To‘lov sanasi', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'amount', label: 'Summa (so‘m)', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'note', label: 'Izoh', attrs: 'maxlength="300"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.amount.value);
      localErrors(form, {
        paid_on: f.paid_on.value ? null : 'Sanani kiriting.',
        amount: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Musbat summa kiriting.' : null,
      });
      await http(`/admin/kpi/orders/${order.id}/payments`, { method: 'POST', body: { amount, paid_on: f.paid_on.value, note: f.note.value.trim() || null } });
      toast('To‘lov saqlandi.', 'success');
      onSaved();
    },
  });
}

function ratesForm(g, defaults, month, onSaved) {
  const locked = g.rates.source === 'month' && g.rates.approved;
  formModal({
    title: `Kelishilgan foizlar — ${g.customer}`,
    body: `<p class="text-muted">Mijozdan pul yetkazib berilgan kundan necha kun ichida tushishiga qarab sotuvchiga beriladigan foiz. Oldindan to‘langan pul — «10 kun» ga kiradi.</p>
      ${locked ? '<div class="kpi-warn">Bu oy foizlari tasdiqlangan. O‘zgartirish uchun sahifada «Tasdiqni bekor qilish» tugmasini bosing.</div>' : ''}
      ${field({ name: 'scope', label: 'Qaysi davr uchun', options: [{ value: 'month', label: `Faqat ${monthName(month)} oyi uchun` }, { value: 'always', label: 'Doimiy (barcha oylar, oy foizi bo‘lmasa)' }], value: 'month' })}
      <div class="form-row">${TIER_KEY.map((k, i) => field({ name: k, label: `${TIER_LABEL[i]} (%)`, value: String(g.rates[k]).replace('.', ','), required: true, attrs: 'inputmode="decimal" autocomplete="off"' })).join('')}</div>
      ${g.rates.custom && !locked ? '<button type="button" class="btn btn--outline btn--sm" data-reset>Standart foizga qaytarish</button>' : `<p class="muted">Standart foiz: ${TIER_KEY.map((k) => pctText(defaults[k])).join(' / ')}.</p>`}`,
    onOpen: (form) => {
      form.querySelector('[data-reset]')?.addEventListener('click', async () => {
        const scoped = g.rates.source === 'month';
        await http(`/admin/kpi/customers/${g.customer_id}/rates${scoped ? qs({ month }) : ''}`, { method: 'DELETE' });
        toast('Standart foizga qaytarildi.', 'success');
        form.querySelector('[data-close]')?.click();
        onSaved();
      });
    },
    onSubmit: async (form) => {
      const body = {};
      const errors = {};
      TIER_KEY.forEach((k) => {
        const v = numberOrNull(form.elements[k].value);
        body[k] = v;
        errors[k] = v === null || Number.isNaN(v) || v < 0 || v > 100 ? '0 dan 100 gacha son kiriting.' : null;
      });
      localErrors(form, errors);
      const scoped = form.elements.scope.value === 'month';
      await http(`/admin/kpi/customers/${g.customer_id}/rates${scoped ? qs({ month }) : ''}`, { method: 'PUT', body });
      toast('Foizlar saqlandi.', 'success');
      onSaved();
    },
  });
}
