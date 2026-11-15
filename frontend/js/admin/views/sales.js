/**
 * Sotuv: ishlab chiqarilgan beton = sotuv. Qancha ishlab chiqarildi, qancha sotildi, mijoz olmagan (qaytgan) beton
 * boshqa mijozga sotildimi yoki brak bo'ldimi. Narx ko'rsatilmaydi — faqat hajm. Sotuvchilar hisoboti — alohida sahifa (KPI).
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { bindPeriod, periodFromQuery, rangeBar } from '../period.js';
import { todayISO } from '../../validators.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, icon, loadingHtml, localErrors, numberOrNull, toast,
} from '../components.js';

const nf = (v, d = 1) => formatNumber(v || 0, d);
const OUTCOME = { pending: 'Kutilmoqda', resold: 'Boshqa mijozga sotildi', brak: 'Brak' };
const stat = ({ label, value, hint = '', tone = '' }) => `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;

export async function render(ctx) {
  const { root } = ctx;
  const { from, to } = periodFromQuery(ctx.query);
  const canManage = session.can(PERM.ORDERS_MANAGE);
  root.innerHTML = loadingHtml();
  let r;
  try {
    r = await http(`/admin/sales/overview${qs({ date_from: from, date_to: to })}`);
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(ctx));
    return;
  }
  if (!ctx.isCurrent()) return;
  const t = r.totals;
  const again = () => render(ctx);
  root.innerHTML = `
    <div class="page-actions">${rangeBar({ from, to })}
      ${canManage ? `<button class="btn btn--primary" data-add>${icon('i-plus')} Qaytgan / olinmagan beton</button>` : ''}</div>
    <div class="stats">
      ${stat({ label: 'Ishlab chiqarildi', value: `${nf(t.produced_m3)}<span class="stat__unit">m³</span>`, hint: t.qc_failed_m3 ? `Sifatdan o‘tmagan: ${nf(t.qc_failed_m3)} m³` : '', tone: 'accent' })}
      ${stat({ label: 'Sotildi (yetkazilgan)', value: `${nf(t.sold_m3)}<span class="stat__unit">m³</span>`, tone: 'success' })}
      ${stat({ label: 'Boshqa mijozga sotildi', value: `${nf(t.resold_m3)}<span class="stat__unit">m³</span>`, hint: 'Olinmagan, qayta sotilgan', tone: 'info' })}
      ${stat({ label: 'Brak', value: `${nf(t.brak_m3)}<span class="stat__unit">m³</span>`, tone: t.brak_m3 ? 'danger' : '' })}
      ${stat({ label: 'Kutilmoqda', value: `${nf(t.returned_pending_m3)}<span class="stat__unit">m³</span>`, hint: 'Olinmagan, hali hal bo‘lmagan' })}
    </div>
    <section class="box"><div class="box__head"><h2 class="box__title">Ishlab chiqarish → sotuv · ${escapeHtml(fmtDate(r.date_from))} – ${escapeHtml(fmtDate(r.date_to))}</h2></div>
      <div class="table-wrap"><table class="table kpi-table"><thead><tr><th>Marka</th><th class="num">Ishlab chiqarildi</th><th class="num">Sotildi</th><th class="num">Boshqaga sotildi</th><th class="num">Brak</th><th class="num">Kutilmoqda</th><th class="num">Farq</th></tr></thead>
      <tbody>${r.rows.length ? r.rows.map((x) => `<tr><td class="strong">${escapeHtml(x.name)} <span class="muted">${escapeHtml(x.grade)}</span></td><td class="num">${nf(x.produced_m3, 2)}</td><td class="num">${nf(x.sold_m3, 2)}</td><td class="num">${nf(x.resold_m3, 2)}</td><td class="num">${nf(x.brak_m3, 2)}</td><td class="num">${nf(x.returned_pending_m3, 2)}</td>
        <td class="num ${x.difference_m3 ? 'strong' : ''}">${nf(x.difference_m3, 2)}</td></tr>`).join('') : emptyRow(7, 'Bu davrda ishlab chiqarish yoki sotuv yo‘q.')}</tbody>
      ${r.rows.length ? `<tfoot><tr><td>Итого:</td><td class="num">${nf(t.produced_m3, 2)}</td><td class="num">${nf(t.sold_m3, 2)}</td><td class="num">${nf(t.resold_m3, 2)}</td><td class="num">${nf(t.brak_m3, 2)}</td><td class="num">${nf(t.returned_pending_m3, 2)}</td><td class="num">${nf(t.difference_m3, 2)}</td></tr></tfoot>` : ''}</table></div></section>
    <p class="kpi-note">Farq = ishlab chiqarildi − sotildi − brak − kutilayotgan. Nol bo‘lsa, ishlab chiqarilgan beton to‘liq hisobda. Mijoz olmagan beton boshqa mijozga sotilsa, «Boshqa mijozga sotildi» deb belgilang va qaysi buyurtmaga ketganini tanlang.</p>
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">Mijoz olmagan (qaytgan) beton</h2></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th>Mijoz / buyurtma</th><th>Marka</th><th class="num">Hajm / m³</th><th>Natija</th><th>Sabab</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${r.returns.length ? r.returns.map((x) => `<tr data-id="${x.id}"><td class="nowrap">${escapeHtml(fmtDate(x.returned_on))}</td><td>${x.customer ? `<span class="strong">${escapeHtml(x.customer)}</span>` : '—'}${x.order_number ? `<br><a href="#/orders/${x.order_id}">${escapeHtml(x.order_number)}</a>` : ''}</td>
        <td>${x.product ? `${escapeHtml(x.product)} <span class="muted">${escapeHtml(x.grade || '')}</span>` : '—'}</td><td class="num strong">${nf(x.volume_m3, 2)}</td>
        <td>${escapeHtml(OUTCOME[x.outcome])}${x.resold_order_number ? `<br><a href="#/orders/${x.resold_order_id}">${escapeHtml(x.resold_order_number)}</a>` : ''}</td><td>${escapeHtml(x.reason || '')}</td>
        ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 7 : 6, 'Bu davrda qaytgan yoki olinmagan beton qayd etilmagan.')}</tbody></table></div></section>`;

  bindPeriod(root);
  const orders = () => http('/admin/sales/delivered-orders');
  root.querySelector('[data-add]')?.addEventListener('click', async () => returnForm(null, await orders(), again));
  root.querySelectorAll('tr[data-id]').forEach((row) => {
    const item = r.returns.find((x) => x.id === Number(row.dataset.id));
    row.querySelector('[data-edit]')?.addEventListener('click', async () => returnForm(item, await orders(), again));
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Yozuvni o‘chirish', text: `${nf(item.volume_m3, 2)} m³ yozuvi o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/sales/returns/${item.id}`, { method: 'DELETE' });
        toast('O‘chirildi.', 'success');
        again();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function returnForm(item, orders, onSaved) {
  const opts = [{ value: '', label: '— tanlang —' }].concat(orders.map((o) => ({ value: o.id, label: `${o.order_number} · ${o.customer} · ${o.volume_m3} m³ (${fmtDate(o.delivery_date)})` })));
  const v = item || { returned_on: todayISO(), order_id: '', volume_m3: '', reason: '', outcome: 'pending', resold_order_id: '', note: '' };
  formModal({
    title: item ? 'Yozuvni tahrirlash' : 'Qaytgan / olinmagan beton',
    body: `${field({ name: 'order_id', label: 'Kim olmadi (buyurtma)', options: opts, value: v.order_id || '', required: true })}
      <div class="form-row">${field({ name: 'returned_on', label: 'Sana', type: 'date', value: v.returned_on, required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'volume_m3', label: 'Hajm (m³)', value: v.volume_m3 === '' ? '' : String(v.volume_m3), required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}</div>
      ${field({ name: 'outcome', label: 'Natija', options: Object.entries(OUTCOME).map(([value, label]) => ({ value, label })), value: v.outcome })}
      <div data-resold>${field({ name: 'resold_order_id', label: 'Qaysi buyurtmaga sotildi', options: opts, value: v.resold_order_id || '' })}</div>
      ${field({ name: 'reason', label: 'Sabab', attrs: 'maxlength="500"', value: v.reason || '' })}`,
    onOpen: (form) => {
      const sync = () => { form.querySelector('[data-resold]').hidden = form.elements.outcome.value !== 'resold'; };
      form.elements.outcome.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const vol = numberOrNull(f.volume_m3.value);
      const outcome = f.outcome.value;
      localErrors(form, {
        order_id: f.order_id.value ? null : 'Buyurtmani tanlang.',
        volume_m3: vol === null || Number.isNaN(vol) || vol <= 0 ? 'Musbat hajm kiriting.' : null,
        resold_order_id: outcome === 'resold' && !f.resold_order_id.value ? 'Qaysi buyurtmaga sotilganini tanlang.' : null,
      });
      const body = {
        returned_on: f.returned_on.value, order_id: Number(f.order_id.value), volume_m3: vol, outcome,
        resold_order_id: outcome === 'resold' ? Number(f.resold_order_id.value) : null, reason: f.reason.value.trim() || null,
      };
      if (item) await http(`/admin/sales/returns/${item.id}`, { method: 'PUT', body });
      else await http('/admin/sales/returns', { method: 'POST', body });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}
