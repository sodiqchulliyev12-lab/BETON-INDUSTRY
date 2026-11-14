/**
 * Ishlab chiqarish: kunlik xulosa, reja va haqiqiy ishlab chiqarish yozuvlari, sifat nazorati.
 * Zavod quvvati belgilanmagan bo'lsa — "Belgilanmagan" yoziladi, foiz hisoblanmaydi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { todayISO } from '../../validators.js';
import {
  PERM, PLAN_STATUS, QC_STATUS, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, fmtDateTime,
  formModal, icon, loadingHtml, localErrors, numberOrNull, statusBadge, toast, volume,
} from '../components.js';

/** Marka nomi bilan: «Beton M100 · B7.5» (nom bo'lmasa — faqat sinf) */
const gradeText = (x) => (x.product_name ? `${x.product_name} · ${x.grade_class}` : x.grade_class);
const gradeHtml = (x) => (x.product_name
  ? `<strong>${escapeHtml(x.product_name)}</strong> <span class="muted">${escapeHtml(x.grade_class)}</span>`
  : `<strong>${escapeHtml(x.grade_class)}</strong>`);

const vol = (v) => `${formatNumber(v || 0, 2)}<span class="stat__unit">m³</span>`;

export async function render(ctx) {
  const { root, query, isCurrent } = ctx;
  const day = query.get('date') || todayISO();
  const canManage = session.can(PERM.PRODUCTION_MANAGE);

  root.innerHTML = `
    <div class="page-actions">
      <label class="text-muted" for="prodDate">Sana:</label>
      <input class="input" type="date" id="prodDate" value="${escapeHtml(day)}">
      ${day !== todayISO() ? '<button type="button" class="btn btn--outline btn--sm" data-today>Bugun</button>' : ''}
      <span class="page-actions__spacer"></span>
      ${canManage ? `<button type="button" class="btn btn--outline" data-add-plan>${icon('i-calendar')} Rejaga qo‘shish</button>
        <button type="button" class="btn btn--primary" data-add-record>${icon('i-plus')} Ishlab chiqarildi</button>` : ''}
    </div>
    <div id="prodView">${loadingHtml()}</div>`;
  root.querySelector('#prodDate').addEventListener('change', (e) => setQuery({ date: e.target.value }));
  root.querySelector('[data-today]')?.addEventListener('click', () => setQuery({ date: '' }));

  const holder = root.querySelector('#prodView');
  let summary;
  let plans;
  let records;
  let products;
  try {
    [summary, plans, records, products] = await Promise.all([
      http(`/admin/production/summary${qs({ date: day })}`),
      http(`/admin/production/plans${qs({ date_from: day, date_to: day })}`),
      http(`/admin/production/records${qs({ date: day })}`),
      http('/admin/products'),
    ]);
  } catch (err) {
    holder.innerHTML = errorHtml(err);
    holder.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  const reload = () => render(ctx);
  root.querySelector('[data-add-plan]')?.addEventListener('click', () => planForm(null, day, products, reload));
  root.querySelector('[data-add-record]')?.addEventListener('click', () => recordForm(day, plans, products, reload));

  const cap = summary.capacity_m3_per_day;
  const over = cap !== null && summary.planned_m3 > cap;
  holder.innerHTML = `
    <div class="stats">
      <div class="stat">
        <span class="stat__label">Kunlik quvvat</span>
        <span class="stat__value">${cap === null ? '<span class="stat__value--muted">Belgilanmagan</span>' : vol(cap)}</span>
        <span class="stat__hint">${cap === null ? (session.can(PERM.SETTINGS_WRITE) ? '<a href="#/settings">Sozlamalarda kiriting</a>' : 'Tizim taxmin qilmaydi') : ''}</span>
      </div>
      <div class="stat stat--info">
        <span class="stat__label">Reja</span>
        <span class="stat__value">${vol(summary.planned_m3)}</span>
        <span class="stat__hint">${summary.utilization_percent === null ? 'Quvvat belgilanmaganligi uchun foiz hisoblanmaydi' : `Quvvatdan ${formatNumber(summary.utilization_percent, 1)}%${over ? ' — quvvatdan oshib ketdi!' : ''}`}</span>
      </div>
      <div class="stat stat--accent"><span class="stat__label">Ishlab chiqarildi</span><span class="stat__value">${vol(summary.produced_m3)}</span>
        <span class="stat__hint">Sifat nazoratini kutmoqda: ${escapeHtml(volume(summary.qc_pending_m3))}</span></div>
      <div class="stat stat--success"><span class="stat__label">Sifatdan o‘tdi</span><span class="stat__value">${vol(summary.qc_passed_m3)}</span>
        <span class="stat__hint">O‘tmadi: ${escapeHtml(volume(summary.qc_failed_m3))}</span></div>
      <div class="stat"><span class="stat__label">Yuklandi</span><span class="stat__value">${vol(summary.loaded_m3)}</span></div>
      <div class="stat stat--success"><span class="stat__label">Yetkazildi</span><span class="stat__value">${vol(summary.delivered_m3)}</span></div>
      <div class="stat"><span class="stat__label">Ochiq buyurtmalar qoldig‘i</span><span class="stat__value">${vol(summary.open_orders_remaining_m3)}</span>
        <span class="stat__hint">${summary.open_orders} ta ochiq buyurtma</span></div>
    </div>

    ${summary.by_product.length ? `<section class="box mb-5">
      <div class="box__head"><h2 class="box__title">Beton markalari bo‘yicha (${escapeHtml(fmtDate(day))})</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Marka</th><th class="num">Reja</th><th class="num">Ishlab chiqarildi</th><th>Bajarilishi</th></tr></thead>
        <tbody>${summary.by_product.map((p) => `
          <tr><td>${gradeHtml(p)}</td>
            <td class="num">${volume(p.planned_m3)}</td><td class="num">${volume(p.produced_m3)}</td>
            <td>${p.planned_m3 > 0 ? `${formatNumber((p.produced_m3 / p.planned_m3) * 100, 0)}%` : '<span class="muted">rejasiz</span>'}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}

    <section class="box mb-5">
      <div class="box__head"><h2 class="box__title">Ishlab chiqarish rejasi</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Marka</th><th>Buyurtma</th><th class="num">Reja</th><th class="num">Bajarildi</th><th>Holat</th><th>Izoh</th>${canManage ? '<th></th>' : ''}</tr></thead>
        <tbody>${plans.length ? plans.map((p) => `
          <tr data-plan="${p.id}">
            <td>${gradeHtml(p)}</td>
            <td>${p.order_id ? `<a href="#/orders/${p.order_id}">${escapeHtml(p.order_number)}</a>` : '<span class="muted">Omborga / umumiy</span>'}</td>
            <td class="num">${volume(p.planned_volume_m3)}</td>
            <td class="num">${volume(p.produced_volume_m3)}</td>
            <td>${statusBadge(p.status, PLAN_STATUS)}</td>
            <td>${escapeHtml(p.notes || '')}</td>
            ${canManage ? `<td class="num nowrap">
              <button type="button" class="icon-btn" data-plan-edit aria-label="Tahrirlash" title="Tahrirlash">${icon('i-edit')}</button>
              <button type="button" class="icon-btn" data-plan-delete aria-label="O‘chirish" title="O‘chirish">${icon('i-trash')}</button></td>` : ''}
          </tr>`).join('') : emptyRow(canManage ? 7 : 6, 'Bu kun uchun reja kiritilmagan.')}
        </tbody></table></div>
    </section>

    <section class="box">
      <div class="box__head"><h2 class="box__title">Ishlab chiqarish yozuvlari va sifat nazorati</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Vaqt</th><th>Marka</th><th>Partiya</th><th>Buyurtma</th><th class="num">Hajm</th><th>Sifat nazorati</th><th>Kiritgan</th>${canManage ? '<th></th>' : ''}</tr></thead>
        <tbody>${records.length ? records.map((r) => `
          <tr data-record="${r.id}">
            <td class="nowrap">${fmtDateTime(r.produced_at).slice(11)}</td>
            <td>${gradeHtml(r)}</td>
            <td>${escapeHtml(r.batch_number || '—')}</td>
            <td>${r.order_id ? `<a href="#/orders/${r.order_id}">${escapeHtml(r.order_number)}</a>` : '—'}</td>
            <td class="num">${volume(r.produced_volume_m3)}</td>
            <td>${statusBadge(r.qc_status, QC_STATUS)}${r.qc_by ? `<br><span class="muted">${escapeHtml(r.qc_by)}, ${fmtDateTime(r.qc_at).slice(11)}</span>` : ''}
              ${r.qc_notes ? `<br><span class="muted">${escapeHtml(r.qc_notes)}</span>` : ''}</td>
            <td class="muted">${escapeHtml(r.created_by || '—')}</td>
            ${canManage ? `<td class="num nowrap">
              ${r.qc_status !== 'passed' ? '<button type="button" class="btn btn--primary btn--sm" data-qc="passed">O‘tdi</button>' : ''}
              ${r.qc_status !== 'failed' ? '<button type="button" class="btn btn--outline btn--sm" data-qc="failed">O‘tmadi</button>' : ''}
              ${r.qc_status === 'pending' ? `<button type="button" class="icon-btn" data-record-delete aria-label="O‘chirish" title="O‘chirish">${icon('i-trash')}</button>` : ''}
            </td>` : ''}
          </tr>`).join('') : emptyRow(canManage ? 8 : 7, 'Bu kun ishlab chiqarish yozuvlari yo‘q.')}
        </tbody></table></div>
    </section>`;

  holder.querySelectorAll('tr[data-plan]').forEach((row) => {
    const plan = plans.find((p) => p.id === Number(row.dataset.plan));
    row.querySelector('[data-plan-edit]')?.addEventListener('click', () => planForm(plan, day, products, reload));
    row.querySelector('[data-plan-delete]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Rejani o‘chirish', text: `${gradeText(plan)}, ${volume(plan.planned_volume_m3)} rejasi o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/production/plans/${plan.id}`, { method: 'DELETE' });
        toast('Reja o‘chirildi.', 'success');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  holder.querySelectorAll('tr[data-record]').forEach((row) => {
    const record = records.find((r) => r.id === Number(row.dataset.record));
    row.querySelectorAll('[data-qc]').forEach((btn) => btn.addEventListener('click', () => qcForm(record, btn.dataset.qc, reload)));
    row.querySelector('[data-record-delete]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Yozuvni o‘chirish', text: `${gradeText(record)}, ${volume(record.produced_volume_m3)} yozuvi o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try {
        await http(`/admin/production/records/${record.id}`, { method: 'DELETE' });
        toast('Yozuv o‘chirildi.', 'success');
        reload();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

async function openOrders() {
  try {
    const page = await http(`/admin/orders${qs({ open_only: true, page_size: 100 })}`);
    return page.items;
  } catch {
    return [];
  }
}

const productOptions = (products, selected) => products
  .filter((p) => p.is_active || p.id === selected)
  .map((p) => ({ value: p.id, label: `${p.name} · ${p.grade_class}` }));

async function planForm(plan, day, products, onSaved) {
  const orders = await openOrders();
  const p = plan || { plan_date: day, product_id: products[0]?.id, order_id: null, planned_volume_m3: '', status: 'planned', notes: '' };
  formModal({
    title: plan ? 'Rejani tahrirlash' : 'Ishlab chiqarish rejasi',
    body: `
      <div class="form-row">
        ${field({ name: 'plan_date', label: 'Sana', type: 'date', value: p.plan_date, required: true })}
        ${field({ name: 'planned_volume_m3', label: 'Rejadagi hajm (m³)', value: p.planned_volume_m3, required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      </div>
      ${field({ name: 'order_id', label: 'Buyurtma (ixtiyoriy)', value: p.order_id ?? '',
        options: [{ value: '', label: '— buyurtmaga bog‘lanmagan —' }].concat(orders.map((o) => ({ value: o.id, label: `${o.order_number} · ${o.products} · ${volume(o.volume_m3)} · ${fmtDate(o.delivery_date)}` }))) })}
      ${field({ name: 'product_id', label: 'Beton markasi', value: p.product_id, required: true, options: productOptions(products, p.product_id) })}
      ${plan ? field({ name: 'status', label: 'Holat', value: p.status, options: Object.entries(PLAN_STATUS).map(([value, label]) => ({ value, label })) }) : ''}
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, value: p.notes, attrs: 'maxlength="1000"' })}`,
    onOpen: (form) => {
      form.elements.order_id.addEventListener('change', () => {
        const order = orders.find((o) => o.id === Number(form.elements.order_id.value));
        if (!order) return;
        const product = products.find((x) => order.products.split(', ').includes(x.grade_class));
        if (product) form.elements.product_id.value = String(product.id);
        if (!form.elements.planned_volume_m3.value) form.elements.planned_volume_m3.value = String(order.volume_m3);
      });
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.planned_volume_m3.value);
      localErrors(form, {
        plan_date: f.plan_date.value ? null : 'Sanani tanlang.',
        planned_volume_m3: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Hajmni kiriting.' : null,
        product_id: f.product_id.value ? null : 'Markani tanlang.',
      });
      const body = {
        plan_date: f.plan_date.value,
        product_id: Number(f.product_id.value),
        order_id: f.order_id.value ? Number(f.order_id.value) : null,
        planned_volume_m3: amount,
        status: plan ? f.status.value : 'planned',
        notes: f.notes.value.trim() || null,
      };
      if (plan) await http(`/admin/production/plans/${plan.id}`, { method: 'PUT', body });
      else await http('/admin/production/plans', { method: 'POST', body });
      toast('Reja saqlandi.', 'success');
      onSaved();
    },
  });
}

async function recordForm(day, plans, products, onSaved) {
  const orders = await openOrders();
  const activePlans = plans.filter((p) => p.status !== 'cancelled' && p.status !== 'completed');
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const isToday = day === todayISO();
  const defaultTime = isToday ? `${pad(now.getHours())}:${pad(now.getMinutes())}` : '12:00';

  formModal({
    title: 'Ishlab chiqarilgan hajmni kiritish',
    body: `
      ${field({ name: 'plan_id', label: 'Reja', value: activePlans[0]?.id ?? '',
        options: [{ value: '', label: '— rejasiz —' }].concat(activePlans.map((p) => ({ value: p.id, label: `${gradeText(p)} · ${volume(p.planned_volume_m3)}${p.order_number ? ` · ${p.order_number}` : ''}` }))),
        hint: 'Reja tanlansa, marka va buyurtma rejadan olinadi.' })}
      <div data-free>
        ${field({ name: 'product_id', label: 'Beton markasi', value: products[0]?.id, options: productOptions(products) })}
        ${field({ name: 'order_id', label: 'Buyurtma (ixtiyoriy)', value: '',
          options: [{ value: '', label: '— bog‘lanmagan —' }].concat(orders.map((o) => ({ value: o.id, label: `${o.order_number} · ${o.products} · ${volume(o.volume_m3)}` }))) })}
      </div>
      <div class="form-row">
        ${field({ name: 'produced_volume_m3', label: 'Hajm (m³)', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
        ${field({ name: 'time', label: `Vaqt (${fmtDate(day)})`, type: 'time', value: defaultTime, required: true })}
      </div>
      ${field({ name: 'batch_number', label: 'Partiya raqami', attrs: 'maxlength="50"' })}
      <p class="text-muted">Yozuv «Sifat nazorati kutilmoqda» holatida yaratiladi.</p>`,
    onOpen: (form) => {
      const free = form.querySelector('[data-free]');
      const sync = () => { free.hidden = Boolean(form.elements.plan_id.value); };
      form.elements.plan_id.addEventListener('change', sync);
      sync();
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.produced_volume_m3.value);
      localErrors(form, {
        produced_volume_m3: amount === null || Number.isNaN(amount) || amount <= 0 ? 'Hajmni kiriting.' : null,
        time: f.time.value ? null : 'Vaqtni kiriting.',
      });
      const [hh, mm] = f.time.value.split(':').map(Number);
      const [y, m, d] = day.split('-').map(Number);
      const producedAt = new Date(y, m - 1, d, hh, mm); // brauzerning mahalliy vaqti
      const body = {
        plan_id: f.plan_id.value ? Number(f.plan_id.value) : null,
        product_id: f.plan_id.value ? null : Number(f.product_id.value),
        order_id: f.plan_id.value ? null : (f.order_id.value ? Number(f.order_id.value) : null),
        produced_volume_m3: amount,
        batch_number: f.batch_number.value.trim() || null,
        produced_at: producedAt.toISOString(),
      };
      await http('/admin/production/records', { method: 'POST', body });
      toast('Ishlab chiqarish yozuvi qo‘shildi.', 'success');
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
      <p>${escapeHtml(gradeText(record))} · ${escapeHtml(volume(record.produced_volume_m3))}${record.batch_number ? ` · partiya ${escapeHtml(record.batch_number)}` : ''}</p>
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
