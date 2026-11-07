/** Mijozlar (#/customers, #/customers/:id) va qayta qo'ng'iroq so'rovlari (#/customers?tab=callbacks). */
import { debounce } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import {
  CALLBACK_STATUS, PERM, emptyRow, errorHtml, escapeHtml, field, fmtDate, fmtDateTime, formModal, icon,
  loadingHtml, localErrors, money, paginationHtml, phoneLink, statusBadge, toast, volume,
} from '../components.js';
import { attachPhoneMask, validatePhone } from '../../validators.js';

export async function render(ctx) {
  if (ctx.parts[1]) return renderDetail(ctx, Number(ctx.parts[1]));
  return ctx.query.get('tab') === 'callbacks' && session.can(PERM.CALLBACKS_MANAGE) ? renderCallbacks(ctx) : renderList(ctx);
}

function tabs(active) {
  if (!session.can(PERM.CALLBACKS_MANAGE)) return '';
  return `<nav class="tabs">
    <a href="#/customers" class="${active === 'list' ? 'is-active' : ''}">Mijozlar</a>
    <a href="#/customers?tab=callbacks" class="${active === 'callbacks' ? 'is-active' : ''}">Qo‘ng‘iroq so‘rovlari</a>
  </nav>`;
}

/* --- Ro'yxat --- */

async function renderList(ctx) {
  const { root, query, isCurrent } = ctx;
  const q = query.get('q') || '';
  const page = Number(query.get('page')) || 1;
  const canManage = session.can(PERM.CUSTOMERS_MANAGE);

  root.innerHTML = `${tabs('list')}
    <div class="page-actions">
      <input class="input search" type="search" placeholder="Ism, kompaniya yoki telefon" value="${escapeHtml(q)}" aria-label="Qidirish">
      <span class="page-actions__spacer"></span>
      ${canManage ? `<button type="button" class="btn btn--primary" data-create>${icon('i-plus')} Yangi mijoz</button>` : ''}
    </div>
    <section class="box" id="customersBox">${loadingHtml()}</section>`;

  root.querySelector('.search').addEventListener('input', debounce((e) => setQuery({ q: e.target.value.trim(), page: '' }), 400));
  root.querySelector('[data-create]')?.addEventListener('click', () => customerForm(null, (c) => { location.hash = `#/customers/${c.id}`; }));

  const box = root.querySelector('#customersBox');
  let data;
  try {
    data = await http(`/admin/customers${qs({ q, page, page_size: 20 })}`);
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => renderList(ctx));
    return;
  }
  if (!isCurrent()) return;

  box.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Mijoz</th><th>Telefon</th><th class="num">Buyurtmalar</th><th class="num">Jami hajm</th><th>Oxirgi buyurtma</th></tr></thead>
      <tbody>${data.items.length ? data.items.map((c) => `
        <tr class="is-link" data-href="#/customers/${c.id}" tabindex="0">
          <td><a href="#/customers/${c.id}" class="strong">${escapeHtml(c.full_name)}</a>${c.company_name ? `<br><span class="muted">${escapeHtml(c.company_name)}</span>` : ''}</td>
          <td class="nowrap">${phoneLink(c.phone)}</td>
          <td class="num">${c.orders_count}</td>
          <td class="num">${volume(c.total_volume_m3)}</td>
          <td class="muted nowrap">${c.last_order_at ? fmtDateTime(c.last_order_at) : '—'}</td>
        </tr>`).join('') : emptyRow(5, q ? 'Hech kim topilmadi.' : 'Mijozlar hali yo‘q. Birinchi buyurtma kelganda mijoz avtomatik qo‘shiladi.')}
      </tbody></table></div>
    ${paginationHtml(data)}`;

  box.querySelectorAll('tr[data-href]').forEach((row) => {
    row.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = row.dataset.href; });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = row.dataset.href; });
  });
  box.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => setQuery({ page: b.dataset.page })));
}

/* --- Tafsilot --- */

async function renderDetail(ctx, id) {
  const { root, isCurrent, setTitle } = ctx;
  root.innerHTML = loadingHtml();
  let customer;
  let orders;
  try {
    [customer, orders] = await Promise.all([
      http(`/admin/customers/${id}`),
      session.can(PERM.ORDERS_READ) ? http(`/admin/orders${qs({ customer_id: id, page_size: 50 })}`) : Promise.resolve(null),
    ]);
  } catch (err) {
    if (!isCurrent()) return;
    root.innerHTML = `<a class="back-link" href="#/customers">← Mijozlar</a>${errorHtml(err)}`;
    root.querySelector('[data-retry]').addEventListener('click', () => renderDetail(ctx, id));
    return;
  }
  if (!isCurrent()) return;
  setTitle(customer.full_name);

  root.innerHTML = `
    <a class="back-link" href="#/customers">← Mijozlar</a>
    <div class="detail-head">
      <h2>${escapeHtml(customer.full_name)}</h2>
      <span class="page-actions__spacer"></span>
      ${session.can(PERM.CUSTOMERS_MANAGE) ? `<button type="button" class="btn btn--outline btn--sm" data-edit>${icon('i-edit')} Tahrirlash</button>` : ''}
    </div>
    <div class="admin-grid admin-grid--main">
      <section class="box">
        <div class="box__head"><h3 class="box__title">Buyurtmalar</h3></div>
        ${orders ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Raqam</th><th>Holat</th><th>Marka</th><th class="num">Hajm</th><th>Sana</th><th class="num">Summa</th></tr></thead>
          <tbody>${orders.items.length ? orders.items.map((o) => `
            <tr class="is-link" data-href="#/orders/${o.id}">
              <td class="strong"><a href="#/orders/${o.id}">${escapeHtml(o.order_number)}</a></td>
              <td>${statusBadge(o.status)}</td>
              <td>${escapeHtml(o.products)}</td>
              <td class="num">${volume(o.volume_m3)}</td>
              <td class="nowrap">${fmtDate(o.delivery_date)}</td>
              <td class="num">${money(o.grand_total, o.currency)}</td>
            </tr>`).join('') : emptyRow(6, 'Bu mijozda buyurtmalar yo‘q.')}
          </tbody></table></div>` : '<div class="box__body text-muted">Buyurtmalarni ko‘rish uchun ruxsat yo‘q.</div>'}
      </section>
      <section class="box">
        <div class="box__head"><h3 class="box__title">Ma’lumotlar</h3></div>
        <div class="box__body">
          <dl class="dl">
            <dt>Telefon</dt><dd>${phoneLink(customer.phone)}</dd>
            <dt>Kompaniya</dt><dd>${escapeHtml(customer.company_name || '—')}</dd>
            <dt>Izoh</dt><dd class="pre-line">${escapeHtml(customer.notes || '—')}</dd>
            <dt>Qo‘shilgan</dt><dd>${fmtDateTime(customer.created_at)}</dd>
          </dl>
        </div>
      </section>
    </div>`;

  root.querySelectorAll('tr[data-href]').forEach((row) => row.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.hash = row.dataset.href;
  }));
  root.querySelector('[data-edit]')?.addEventListener('click', () => customerForm(customer, () => renderDetail(ctx, id)));
}

function customerForm(customer, onSaved) {
  const c = customer || { full_name: '', phone: '', company_name: '', notes: '' };
  formModal({
    title: customer ? 'Mijozni tahrirlash' : 'Yangi mijoz',
    body: `
      ${field({ name: 'full_name', label: 'Ism-familiya', value: c.full_name, required: true, attrs: 'maxlength="150"' })}
      ${field({ name: 'phone', label: 'Telefon', type: 'tel', value: c.phone, required: true, attrs: 'inputmode="tel" placeholder="+998 (90) 123-45-67"' })}
      ${field({ name: 'company_name', label: 'Kompaniya', value: c.company_name, attrs: 'maxlength="200"' })}
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', value: c.notes, attrs: 'maxlength="2000"' })}`,
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
        company_name: f.company_name.value.trim() || null,
        notes: f.notes.value.trim() || null,
      };
      const saved = customer
        ? await http(`/admin/customers/${customer.id}`, { method: 'PUT', body })
        : await http('/admin/customers', { method: 'POST', body });
      toast('Mijoz saqlandi.', 'success');
      onSaved(saved);
    },
  });
}

/* --- Qayta qo'ng'iroq so'rovlari --- */

async function renderCallbacks(ctx) {
  const { root, query, isCurrent } = ctx;
  const status = query.get('status') || '';
  const page = Number(query.get('page')) || 1;

  root.innerHTML = `${tabs('callbacks')}
    <div class="page-actions">
      <select class="select" aria-label="Holat">
        <option value="">Barcha holatlar</option>
        ${Object.entries(CALLBACK_STATUS).map(([k, v]) => `<option value="${k}" ${status === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
    </div>
    <section class="box" id="callbacksBox">${loadingHtml()}</section>`;
  root.querySelector('.page-actions select').addEventListener('change', (e) => setQuery({ status: e.target.value, page: '' }));

  const box = root.querySelector('#callbacksBox');
  let data;
  try {
    data = await http(`/admin/callbacks${qs({ status, page, page_size: 20 })}`);
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => renderCallbacks(ctx));
    return;
  }
  if (!isCurrent()) return;

  box.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Sana</th><th>Ism</th><th>Telefon</th><th>Xabar</th><th>Holat</th></tr></thead>
      <tbody>${data.items.length ? data.items.map((c) => `
        <tr data-id="${c.id}">
          <td class="nowrap muted">${fmtDateTime(c.created_at)}</td>
          <td>${c.customer_id ? `<a href="#/customers/${c.customer_id}">${escapeHtml(c.name)}</a>` : escapeHtml(c.name)}</td>
          <td class="nowrap">${phoneLink(c.phone)}</td>
          <td class="pre-line">${escapeHtml(c.message || '—')}</td>
          <td><select class="select" aria-label="Holat">${Object.entries(CALLBACK_STATUS).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        </tr>`).join('') : emptyRow(5, 'So‘rovlar yo‘q.')}
      </tbody></table></div>
    ${paginationHtml(data)}`;

  box.querySelectorAll('tr[data-id] select').forEach((select) => {
    const previous = select.value;
    select.addEventListener('change', async () => {
      try {
        await http(`/admin/callbacks/${select.closest('tr').dataset.id}`, { method: 'PATCH', body: { status: select.value } });
        toast('Holat saqlandi.', 'success', 2500);
      } catch (err) {
        select.value = previous;
        toast(err.message, 'error');
      }
    });
  });
  box.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => setQuery({ page: b.dataset.page })));
}
