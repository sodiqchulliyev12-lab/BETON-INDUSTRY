/**
 * Ombor: xomashyo qoldig'i, kirim, chiqim, ishlab chiqarishga berish, omborlar aro ko'chirish,
 * inventarizatsiya, ta'minotchilar, tarix va hisobot. Qoldiq harakatlar yig'indisidan hisoblanadi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { bindPeriod, rangeBar } from '../period.js';
import { todayISO } from '../../validators.js';
import { meter } from '../charts.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, icon, loadingHtml, localErrors, numberOrNull,
  phoneLink, toast,
} from '../components.js';
import { attachPhoneMask } from '../../validators.js';

export const CATEGORY = {
  cement: 'Sement', sand: 'Qum', gravel: 'Shag‘al', crushed_stone: 'Chaqiqtosh', water: 'Suv', additive: 'Kimyoviy qo‘shimchalar', other: 'Boshqa',
};
const UNIT = { ton: 'tonna', kg: 'kg', m3: 'm³', liter: 'litr' };
const UNIT_SHORT = { ton: 't', kg: 'kg', m3: 'm³', liter: 'l' };
const STATUS = { ok: 'Normal', low: 'Kam qoldiq', out: 'Tugagan', no_limit: 'Chegara yo‘q', inactive: 'Nofaol' };
const KIND = {
  opening: 'Boshlang‘ich qoldiq', in: 'Kirim', out: 'Chiqim', production: 'Ishlab chiqarishga', transfer_in: 'Ko‘chirish (kirdi)',
  transfer_out: 'Ko‘chirish (chiqdi)', adjust: 'Inventarizatsiya',
};
const nf = (v, d = 3) => formatNumber(v || 0, Number.isInteger(+v) ? 0 : d);
const unitOf = (u) => UNIT_SHORT[u] || u;
const badge = (s) => `<span class="status status--${escapeHtml(s)}">${escapeHtml(STATUS[s] || s)}</span>`;

const PAGES = {
  warehouse: { title: 'Ombor boshqaruvi' },
  materials: { title: 'Xomashyo' },
  finished: { title: 'Tayyor mahsulot' },
  input: { title: 'Kirim', kind: 'input', add: 'in' },
  output: { title: 'Chiqim', kind: 'output', add: 'out' },
  release: { title: 'Ishlab chiqarishga berish', kind: 'release', add: 'production' },
  transfers: { title: 'Omborlar aro harakat', kind: 'transfer' },
  inventory: { title: 'Inventarizatsiya' },
  suppliers: { title: 'Ta’minotchilar' },
  history: { title: 'Material tarixi' },
  'wh-report': { title: 'Ombor hisobotlari' },
  warehouses: { title: 'Omborlar' },
};

function stat({ label, value, hint = '', tone = '' }) {
  return `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;
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

const monthStart = () => `${todayISO().slice(0, 8)}01`;
const warehouseOptions = (list, all = true) => (all ? [{ value: '', label: 'Barcha omborlar' }] : []).concat(list.filter((w) => w.is_active).map((w) => ({ value: w.id, label: w.name })));
const categoryOptions = (all = true) => (all ? [{ value: '', label: 'Barcha turlar' }] : []).concat(Object.entries(CATEGORY).map(([value, label]) => ({ value, label })));

export async function render(ctx) {
  const route = ctx.meta.route;
  const key = route.startsWith('materials') ? 'materials' : route;
  ctx.setTitle(PAGES[key]?.title || 'Ombor');
  ctx.root.innerHTML = '<div id="pageBody"></div>';
  const holder = ctx.root.querySelector('#pageBody');
  const handlers = {
    warehouse: dashboard, materials: materialsPage, finished, input: movementsPage, output: movementsPage, release: movementsPage,
    transfers: movementsPage, history: movementsPage, inventory, suppliers, 'wh-report': reportPage, warehouses,
  };
  return handlers[key](ctx, holder, key);
}

/* ------------------------------------------------------------ Xomashyo jadvali (dashboard va turlar) */

function materialTable(items, canManage) {
  return `<section class="box"><div class="table-wrap"><table class="table">
    <thead><tr><th>Kod (SKU)</th><th>Nomi</th><th>Turi</th><th>Birlik</th><th class="num">Boshlang‘ich</th><th class="num">Kirim</th><th class="num">Chiqim</th><th class="num">Joriy qoldiq</th><th>Holat</th>${canManage ? '<th></th>' : ''}</tr></thead>
    <tbody>${items.length ? items.map((m) => `<tr data-id="${m.id}" class="${m.is_active ? '' : 'muted'}"><td class="nowrap strong">${escapeHtml(m.sku)}</td><td>${escapeHtml(m.name)}</td>
      <td>${escapeHtml(CATEGORY[m.category])}</td><td>${escapeHtml(unitOf(m.unit))}</td><td class="num">${nf(m.initial)}</td><td class="num">${nf(m.incoming)}</td><td class="num">${nf(m.outgoing)}</td>
      <td class="num strong">${nf(m.stock)}</td><td>${badge(m.status)}${m.min_stock !== null ? `<br><span class="muted">min: ${nf(m.min_stock)}</span>` : ''}</td>
      ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 10 : 9, 'Xomashyo hali kiritilmagan. «Xomashyo qo‘shish» tugmasi orqali sement, qum, shag‘al va boshqalarni kiriting.')}</tbody></table></div></section>`;
}

function filterBar({ warehouses, wid, category, from, to, showCategory = true, extra = '' }) {
  const sel = (id, opts, val) => `<select class="select" id="${id}">${opts.map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(val || '') ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  return `<div class="page-actions">${sel('fWh', warehouseOptions(warehouses), wid)}${showCategory ? sel('fCat', categoryOptions(), category) : ''}
    ${rangeBar({ from, to })}${extra}</div>`;
}

function bindFilters(holder) {
  const go = () => setQuery({
    wid: holder.querySelector('#fWh')?.value, cat: holder.querySelector('#fCat')?.value,
  });
  holder.querySelectorAll('#fWh, #fCat').forEach((el) => el.addEventListener('change', go));
  bindPeriod(holder);
}

async function dashboard(ctx, holder) {
  const wid = ctx.query.get('wid') || '';
  const cat = ctx.query.get('cat') || '';
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || todayISO();
  const canManage = session.can(PERM.WAREHOUSE_MANAGE);
  await load(ctx, holder, () => Promise.all([
    http(`/admin/warehouse/summary${qs({ warehouse_id: wid, date_from: from, date_to: to })}`),
    http(`/admin/warehouse/materials${qs({ warehouse_id: wid, category: cat, date_from: from, date_to: to })}`),
    http('/admin/warehouse/warehouses'),
  ]), ([sum, mats, warehouses]) => {
    const catRows = Object.entries(sum.categories);
    const warn = sum.low.length + sum.out.length;
    holder.innerHTML = `${filterBar({ warehouses, wid, category: cat, from, to, extra: `<span class="page-actions__spacer"></span>${canManage ? `<button class="btn btn--primary" data-add-material>${icon('i-plus')} Xomashyo qo‘shish</button>` : ''}` })}
      <div class="stats">
        ${stat({ label: 'Xomashyo turlari', value: sum.materials, hint: `${catRows.length} ta toifa`, tone: 'accent' })}
        ${catRows.map(([k, c]) => stat({ label: `${CATEGORY[k]} qoldig‘i`, value: Object.entries(c.stock).map(([u, v]) => `${nf(v)}<span class="stat__unit">${unitOf(u)}</span>`).join(' + '), hint: `${c.materials} ta material` })).join('')}
        ${stat({ label: 'Minimal qoldiqdan past', value: `${warn} ta ${warn ? '⚠' : ''}`, hint: warn ? [...sum.out, ...sum.low].map((m) => escapeHtml(m.name)).slice(0, 3).join(', ') : (sum.no_limit ? `${sum.no_limit} tasida chegara belgilanmagan` : 'Hammasi normal'), tone: warn ? 'info' : 'success' })}
        ${stat({ label: 'Ombor qiymati', value: sum.value === null ? '<span class="stat__value--muted">—</span>' : `${nf(sum.value, 0)}<span class="stat__unit">so‘m</span>`, hint: sum.value === null ? 'Kirimda narx kiritilmagan' : `${sum.value_priced}/${sum.value_total} ta materialning narxi ma’lum` })}
        ${stat({ label: 'Davrdagi harakatlar', value: Object.values(sum.movements).reduce((a, b) => a + b, 0), hint: `Kirim: ${(sum.movements.in || 0) + (sum.movements.opening || 0)} · chiqim: ${(sum.movements.out || 0) + (sum.movements.production || 0)}` })}
      </div>${materialTable(mats.items, canManage)}`;
    bindFilters(holder);
    bindMaterialActions(holder, mats.items, () => dashboard(ctx, holder), canManage);
  });
}

async function materialsPage(ctx, holder) {
  const cat = ctx.meta.route.split('/')[1] || ctx.query.get('cat') || '';
  const wid = ctx.query.get('wid') || '';
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || todayISO();
  const canManage = session.can(PERM.WAREHOUSE_MANAGE);
  if (cat) ctx.setTitle(CATEGORY[cat] || 'Xomashyo');
  await load(ctx, holder, () => Promise.all([
    http(`/admin/warehouse/materials${qs({ warehouse_id: wid, category: cat, date_from: from, date_to: to })}`), http('/admin/warehouse/warehouses'),
  ]), ([mats, warehouses]) => {
    holder.innerHTML = `${filterBar({ warehouses, wid, category: cat, from, to, showCategory: false, extra: `<span class="page-actions__spacer"></span>${canManage ? `<button class="btn btn--primary" data-add-material>${icon('i-plus')} ${cat ? `${escapeHtml(CATEGORY[cat])} qo‘shish` : 'Xomashyo qo‘shish'}</button>` : ''}` })}${materialTable(mats.items, canManage)}`;
    bindFilters(holder);
    bindMaterialActions(holder, mats.items, () => materialsPage(ctx, holder), canManage, cat);
  });
}

function bindMaterialActions(holder, items, reload, canManage, defaultCat = '') {
  holder.querySelector('[data-add-material]')?.addEventListener('click', () => materialForm(null, reload, defaultCat));
  if (!canManage) return;
  holder.querySelectorAll('tr[data-id]').forEach((row) => {
    const m = items.find((i) => i.id === Number(row.dataset.id));
    row.querySelector('[data-edit]')?.addEventListener('click', () => materialForm(m, reload));
  });
}

function materialForm(m, onSaved, defaultCat = '') {
  const v = m || { name: '', category: defaultCat || 'cement', unit: defaultCat === 'water' ? 'm3' : (defaultCat === 'sand' || defaultCat === 'gravel' || defaultCat === 'crushed_stone' ? 'ton' : 'ton'), sku: '', min_stock: '', norm_per_m3: '', is_active: true, notes: '' };
  const close = formModal({
    title: m ? `${m.name} — tahrirlash` : 'Yangi xomashyo',
    body: `<div class="form-row">${field({ name: 'name', label: 'Nomi', value: v.name, required: true, attrs: 'maxlength="150" placeholder="Portlandsement M400"' })}
      ${field({ name: 'sku', label: 'Kod (SKU)', value: m ? v.sku : '', attrs: 'maxlength="30" placeholder="Avtomatik"', hint: 'Bo‘sh qoldirsangiz o‘zi beriladi (CEM-001).' })}</div>
      <div class="form-row">${field({ name: 'category', label: 'Turi', value: v.category, options: categoryOptions(false) })}
      ${field({ name: 'unit', label: 'O‘lchov birligi', value: v.unit, options: Object.entries(UNIT).map(([value, label]) => ({ value, label })) })}</div>
      <div class="form-row">${field({ name: 'min_stock', label: 'Minimal qoldiq', value: v.min_stock ?? '', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Undan kam bo‘lsa «Kam qoldiq» deb belgilanadi. Bo‘sh — chegara yo‘q.' })}
      ${field({ name: 'norm_per_m3', label: '1 m³ beton uchun me’yor', value: v.norm_per_m3 ?? '', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Shu birlikda (masalan sement: 0,3 tonna). Sarf nazorati uchun; bo‘sh qoldirish mumkin.' })}</div>
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, value: v.notes || '', attrs: 'maxlength="500"' })}
      ${field({ name: 'is_active', label: 'Faol', type: 'checkbox', value: v.is_active })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const min = numberOrNull(f.min_stock.value);
      const norm = numberOrNull(f.norm_per_m3.value);
      localErrors(form, {
        name: f.name.value.trim().length >= 2 ? null : 'Nomini kiriting.',
        min_stock: Number.isNaN(min) || (min !== null && min < 0) ? 'Manfiy bo‘lmagan son kiriting.' : null,
        norm_per_m3: Number.isNaN(norm) || (norm !== null && norm < 0) ? 'Manfiy bo‘lmagan son kiriting.' : null,
      });
      const body = { name: f.name.value.trim(), category: f.category.value, unit: f.unit.value, sku: f.sku.value.trim() || null, min_stock: min, norm_per_m3: norm, is_active: f.is_active.checked, notes: f.notes.value.trim() || null };
      if (m) await http(`/admin/warehouse/materials/${m.id}`, { method: 'PUT', body });
      else await http('/admin/warehouse/materials', { method: 'POST', body });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
  if (m) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--outline btn--sm';
    del.textContent = 'O‘chirish';
    del.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Materialni o‘chirish', text: `${m.name} o‘chiriladi (faqat harakatlari bo‘lmasa).`, confirmLabel: 'O‘chirish' }))) return;
      try { await http(`/admin/warehouse/materials/${m.id}`, { method: 'DELETE' }); close(); toast('O‘chirildi.', 'success'); onSaved(); } catch (err) { toast(err.message, 'error'); }
    });
    close.element.querySelector('.modal__actions').prepend(del);
  }
}

/* ------------------------------------------------------------ Tayyor mahsulot */

async function finished(ctx, holder) {
  await load(ctx, holder, () => http('/admin/warehouse/finished'), ({ items }) => {
    holder.innerHTML = `<section class="box"><div class="box__body"><p class="text-muted">Tayyor beton omborda saqlanmaydi — u buyurtmaga ishlab chiqariladi va yetkaziladi. Quyida markalar bo‘yicha ishlab chiqarilgan va yetkazilgan hajm.</p></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Marka</th><th class="num">Ishlab chiqarilgan</th><th class="num">Sifatdan o‘tgan</th><th class="num">Yetkazilgan</th><th class="num">Ochiq buyurtmalar</th></tr></thead>
      <tbody>${items.length ? items.map((r) => `<tr><td><strong>${escapeHtml(r.name)}</strong> <span class="muted">${escapeHtml(r.grade_class)}</span>${r.is_demo ? ' <span class="badge">DEMO</span>' : ''}</td>
        <td class="num">${nf(r.produced_m3, 2)} m³</td><td class="num">${nf(r.qc_passed_m3, 2)} m³</td><td class="num">${nf(r.delivered_m3, 2)} m³</td><td class="num">${nf(r.open_orders_m3, 2)} m³</td></tr>`).join('')
    : emptyRow(5, 'Hali ishlab chiqarish yoki buyurtma yo‘q.')}</tbody></table></div></section>`;
  });
}

/* ------------------------------------------------------------ Harakatlar (kirim, chiqim, ...) */

async function lookups() {
  const [materials, warehouses, suppliers] = await Promise.all([
    http('/admin/warehouse/materials'), http('/admin/warehouse/warehouses'), http('/admin/warehouse/suppliers'),
  ]);
  return { materials: materials.items.filter((m) => m.is_active), warehouses, suppliers: suppliers.filter((s) => s.is_active) };
}

async function movementsPage(ctx, holder, key) {
  const page = PAGES[key];
  const canManage = session.can(PERM.WAREHOUSE_MANAGE);
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || todayISO();
  const wid = ctx.query.get('wid') || '';
  const mid = ctx.query.get('mid') || '';
  const kind = page.kind || ctx.query.get('kind') || '';
  await load(ctx, holder, async () => {
    const [moves, lk] = await Promise.all([
      http(`/admin/warehouse/movements${qs({ kind, material_id: mid, warehouse_id: wid, date_from: from, date_to: to })}`), lookups(),
    ]);
    return { moves: moves.items, lk };
  }, ({ moves, lk }) => {
    const reload = () => movementsPage(ctx, holder, key);
    const addBtn = canManage
      ? (key === 'transfers' ? `<button class="btn btn--primary" data-transfer>${icon('i-plus')} Ko‘chirish</button>`
        : (page.add ? `<button class="btn btn--primary" data-add>${icon('i-plus')} ${escapeHtml(page.title)} qo‘shish</button>`
          : `<button class="btn btn--outline" data-add-any>${icon('i-plus')} Harakat qo‘shish</button>`)) : '';
    const matOpts = [{ value: '', label: 'Barcha materiallar' }].concat(lk.materials.map((m) => ({ value: m.id, label: m.name })));
    const kindSel = key === 'history' ? `<select class="select" id="fKind">${[['', 'Barcha turlar'], ...Object.entries(KIND)].map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>` : '';
    holder.innerHTML = `<div class="page-actions"><select class="select" id="fWh">${warehouseOptions(lk.warehouses).map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === wid ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
      <select class="select" id="fMat">${matOpts.map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === mid ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>${kindSel}
      ${rangeBar({ from, to })}
      <span class="page-actions__spacer"></span>${addBtn}</div>
      <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Sana</th><th>Material</th><th>Turi</th><th>Ombor</th><th class="num">Miqdor</th><th>Ta’minotchi / hujjat</th><th>Izoh</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${moves.length ? moves.map((x) => `<tr data-id="${x.id}"><td class="nowrap">${fmtDate(x.movement_date)}</td><td class="strong">${escapeHtml(x.material)}</td><td>${escapeHtml(KIND[x.kind] || x.kind)}</td><td>${escapeHtml(x.warehouse)}</td>
        <td class="num ${x.quantity < 0 ? 'text-danger' : 'text-success'}">${x.quantity > 0 ? '+' : ''}${nf(x.quantity)} ${escapeHtml(unitOf(x.unit))}</td>
        <td>${escapeHtml(x.supplier || '')}${x.document_no ? `<br><span class="muted">${escapeHtml(x.document_no)}</span>` : ''}${x.unit_price !== null ? `<br><span class="muted">${nf(x.unit_price, 0)} so‘m/${escapeHtml(unitOf(x.unit))}</span>` : ''}</td>
        <td>${escapeHtml(x.note || '')}</td>${canManage ? `<td class="num"><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 8 : 7, 'Bu davrda harakat yo‘q.')}</tbody></table></div></section>`;
    const go = () => setQuery({ wid: holder.querySelector('#fWh').value, mid: holder.querySelector('#fMat').value, kind: holder.querySelector('#fKind')?.value });
    holder.querySelectorAll('#fWh, #fMat, #fKind').forEach((el) => el.addEventListener('change', go));
    bindPeriod(holder);
    holder.querySelector('[data-add]')?.addEventListener('click', () => movementForm(page.add, lk, reload));
    holder.querySelector('[data-add-any]')?.addEventListener('click', () => movementForm('in', lk, reload, true));
    holder.querySelector('[data-transfer]')?.addEventListener('click', () => transferForm(lk, reload));
    holder.querySelectorAll('tr[data-id]').forEach((row) => row.querySelector('[data-del]')?.addEventListener('click', async () => {
      const x = moves.find((m) => m.id === Number(row.dataset.id));
      if (!(await confirmAction({ title: 'Yozuvni o‘chirish', text: `${x.material}: ${x.quantity > 0 ? '+' : ''}${x.quantity} ${unitOf(x.unit)} (${fmtDate(x.movement_date)})${x.transfer_group ? ' — ko‘chirishning ikkala yozuvi ham o‘chadi.' : '.'}`, confirmLabel: 'O‘chirish' }))) return;
      try { await http(`/admin/warehouse/movements/${x.id}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
    }));
  });
}

function movementForm(kind, lk, onSaved, chooseKind = false) {
  const title = { in: 'Kirim', out: 'Chiqim', production: 'Ishlab chiqarishga berish', opening: 'Boshlang‘ich qoldiq', adjust: 'Tuzatish' };
  if (!lk.materials.length) { toast('Avval xomashyo qo‘shing.', 'warning'); return; }
  formModal({
    title: chooseKind ? 'Harakat qo‘shish' : title[kind],
    body: `${chooseKind || kind === 'in' ? field({ name: 'kind', label: 'Harakat turi', value: kind, options: [['in', 'Kirim'], ['opening', 'Boshlang‘ich qoldiq'], ['out', 'Chiqim'], ['production', 'Ishlab chiqarishga berish']].map(([value, label]) => ({ value, label })) }) : `<input type="hidden" name="kind" value="${kind}">`}
      ${field({ name: 'material_id', label: 'Material', required: true, options: [{ value: '', label: '— tanlang —' }].concat(lk.materials.map((m) => ({ value: m.id, label: `${m.name} (${unitOf(m.unit)})` }))) })}
      <div class="form-row">${field({ name: 'warehouse_id', label: 'Ombor', required: true, options: warehouseOptions(lk.warehouses, false), value: lk.warehouses.find((w) => w.is_active)?.id })}
      ${field({ name: 'movement_date', label: 'Sana', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}</div>
      <div class="form-row">${field({ name: 'quantity', label: 'Miqdor', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      <div data-price>${field({ name: 'unit_price', label: 'Narxi (so‘m / birlik)', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Ixtiyoriy. Ombor qiymati uchun.' })}</div></div>
      <div class="form-row"><div data-supplier>${field({ name: 'supplier_id', label: 'Ta’minotchi', options: [{ value: '', label: '— yo‘q —' }].concat(lk.suppliers.map((s) => ({ value: s.id, label: s.name }))) })}</div>
      ${field({ name: 'document_no', label: 'Hujjat raqami', attrs: 'maxlength="50"' })}</div>
      ${field({ name: 'note', label: 'Izoh', type: 'textarea', rows: 2, attrs: 'maxlength="500"' })}`,
    onOpen: (form) => {
      const sync = () => {
        const k = form.elements.kind.value;
        form.querySelector('[data-price]').hidden = k !== 'in';
        form.querySelector('[data-supplier]').hidden = !(k === 'in' || k === 'opening');
      };
      form.elements.kind.addEventListener?.('change', sync);
      sync();
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const qty = numberOrNull(f.quantity.value);
      const price = numberOrNull(f.unit_price.value);
      localErrors(form, {
        material_id: f.material_id.value ? null : 'Materialni tanlang.',
        quantity: qty === null || Number.isNaN(qty) || qty <= 0 ? 'Musbat miqdor kiriting.' : null,
        unit_price: Number.isNaN(price) || (price !== null && price < 0) ? 'Manfiy bo‘lmagan son kiriting.' : null,
      });
      const k = f.kind.value;
      await http('/admin/warehouse/movements', { method: 'POST', body: {
        kind: k, material_id: Number(f.material_id.value), warehouse_id: Number(f.warehouse_id.value), quantity: qty, movement_date: f.movement_date.value,
        supplier_id: (k === 'in' || k === 'opening') && f.supplier_id.value ? Number(f.supplier_id.value) : null,
        unit_price: k === 'in' ? price : null, document_no: f.document_no.value.trim() || null, note: f.note.value.trim() || null,
      } });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}

function transferForm(lk, onSaved) {
  const active = lk.warehouses.filter((w) => w.is_active);
  if (active.length < 2) { toast('Ko‘chirish uchun kamida 2 ta ombor kerak. «Omborlar» bo‘limida qo‘shing.', 'warning'); return; }
  if (!lk.materials.length) { toast('Avval xomashyo qo‘shing.', 'warning'); return; }
  formModal({
    title: 'Omborlar aro ko‘chirish',
    body: `${field({ name: 'material_id', label: 'Material', required: true, options: [{ value: '', label: '— tanlang —' }].concat(lk.materials.map((m) => ({ value: m.id, label: `${m.name} (${unitOf(m.unit)})` }))) })}
      <div class="form-row">${field({ name: 'from_warehouse_id', label: 'Qaysi ombordan', options: warehouseOptions(lk.warehouses, false), value: active[0].id })}
      ${field({ name: 'to_warehouse_id', label: 'Qaysi omborga', options: warehouseOptions(lk.warehouses, false), value: active[1].id })}</div>
      <div class="form-row">${field({ name: 'quantity', label: 'Miqdor', required: true, attrs: 'inputmode="decimal" autocomplete="off"' })}
      ${field({ name: 'movement_date', label: 'Sana', type: 'date', value: todayISO(), attrs: `max="${todayISO()}"` })}</div>
      ${field({ name: 'note', label: 'Izoh', type: 'textarea', rows: 2, attrs: 'maxlength="500"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const qty = numberOrNull(f.quantity.value);
      localErrors(form, {
        material_id: f.material_id.value ? null : 'Materialni tanlang.',
        quantity: qty === null || Number.isNaN(qty) || qty <= 0 ? 'Musbat miqdor kiriting.' : null,
        to_warehouse_id: f.to_warehouse_id.value === f.from_warehouse_id.value ? 'Turli omborlarni tanlang.' : null,
      });
      await http('/admin/warehouse/transfers', { method: 'POST', body: {
        material_id: Number(f.material_id.value), from_warehouse_id: Number(f.from_warehouse_id.value), to_warehouse_id: Number(f.to_warehouse_id.value),
        quantity: qty, movement_date: f.movement_date.value, note: f.note.value.trim() || null,
      } });
      toast('Ko‘chirildi.', 'success');
      onSaved();
    },
  });
}

/* ------------------------------------------------------------ Inventarizatsiya */

async function inventory(ctx, holder) {
  const canManage = session.can(PERM.WAREHOUSE_MANAGE);
  const warehouses = await http('/admin/warehouse/warehouses').catch(() => []);
  const active = warehouses.filter((w) => w.is_active);
  const wid = ctx.query.get('wid') || (active[0] ? String(active[0].id) : '');
  if (!wid) { holder.innerHTML = '<div class="box coming-soon"><p class="text-muted">Avval «Omborlar» bo‘limida ombor qo‘shing.</p></div>'; return; }
  await load(ctx, holder, () => http(`/admin/warehouse/stock${qs({ warehouse_id: wid })}`), (rows) => {
    holder.innerHTML = `<div class="page-actions"><label class="text-muted" for="fWh">Ombor:</label>
      <select class="select" id="fWh">${warehouseOptions(warehouses, false).map((o) => `<option value="${o.value}" ${String(o.value) === wid ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select>
      <label class="text-muted">Sana:</label><input class="input" type="date" id="invDate" value="${todayISO()}" max="${todayISO()}"></div>
      <section class="box"><div class="box__body"><p class="text-muted">Haqiqatda sanalgan miqdorni kiriting. Farq avtomatik «Inventarizatsiya» tuzatishi sifatida yoziladi. Bo‘sh qoldirilgan qatorlar o‘zgarmaydi.</p></div>
      <form id="invForm"><div class="table-wrap"><table class="table"><thead><tr><th>Kod</th><th>Material</th><th class="num">Hisobda</th><th class="num">Sanaldi</th><th class="num">Farq</th></tr></thead>
      <tbody>${rows.length ? rows.map((r) => `<tr data-mid="${r.material_id}" data-book="${r.book}"><td class="nowrap">${escapeHtml(r.sku)}</td><td>${escapeHtml(r.name)}</td><td class="num">${nf(r.book)} ${escapeHtml(unitOf(r.unit))}</td>
        <td class="num"><input class="input input--sm" name="c${r.material_id}" inputmode="decimal" autocomplete="off" aria-label="${escapeHtml(r.name)}"></td><td class="num" data-diff>—</td></tr>`).join('') : emptyRow(5, 'Xomashyo yo‘q.')}</tbody></table></div>
      ${canManage && rows.length ? '<div class="box__body"><button class="btn btn--primary" type="submit">Tuzatishlarni saqlash</button></div>' : ''}</form></section>`;
    holder.querySelector('#fWh').addEventListener('change', (e) => setQuery({ wid: e.target.value }));
    const form = holder.querySelector('#invForm');
    form.addEventListener('input', (e) => {
      const row = e.target.closest('tr');
      const c = numberOrNull(e.target.value);
      const cell = row.querySelector('[data-diff]');
      if (c === null || Number.isNaN(c)) { cell.textContent = '—'; return; }
      const d = Math.round((c - Number(row.dataset.book)) * 1000) / 1000;
      cell.textContent = `${d > 0 ? '+' : ''}${d}`;
      cell.className = `num ${d < 0 ? 'text-danger' : (d > 0 ? 'text-success' : '')}`;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lines = [...form.querySelectorAll('tr[data-mid]')].map((row) => ({ material_id: Number(row.dataset.mid), counted: numberOrNull(row.querySelector('input').value) }))
        .filter((l) => l.counted !== null);
      if (lines.some((l) => Number.isNaN(l.counted) || l.counted < 0)) { toast('Sanalgan miqdor manfiy bo‘lmagan son bo‘lishi kerak.', 'error'); return; }
      if (!lines.length) { toast('Hech bir qatorga qiymat kiritilmadi.', 'warning'); return; }
      try {
        const r = await http('/admin/warehouse/inventory', { method: 'POST', body: { warehouse_id: Number(wid), movement_date: holder.querySelector('#invDate').value, lines } });
        toast(`${r.adjusted} ta tuzatish yozildi.`, 'success');
        inventory(ctx, holder);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

/* ------------------------------------------------------------ Ta'minotchilar va omborlar */

async function suppliers(ctx, holder) {
  const canManage = session.can(PERM.WAREHOUSE_MANAGE);
  await load(ctx, holder, () => http('/admin/warehouse/suppliers'), (items) => {
    holder.innerHTML = `<div class="page-actions"><span class="text-muted">${items.length} ta ta’minotchi</span><span class="page-actions__spacer"></span>
      ${canManage ? `<button class="btn btn--primary" data-add>${icon('i-plus')} Ta’minotchi qo‘shish</button>` : ''}</div>
      <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Nomi</th><th>Telefon</th><th class="num">Yetkazib berishlar</th><th>Izoh</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${items.length ? items.map((s) => `<tr data-id="${s.id}" class="${s.is_active ? '' : 'muted'}"><td class="strong">${escapeHtml(s.name)}${s.is_active ? '' : ' <span class="badge badge--muted">Nofaol</span>'}</td><td>${phoneLink(s.phone)}</td><td class="num">${s.deliveries}</td><td>${escapeHtml(s.notes || '')}</td>
        ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('') : emptyRow(canManage ? 5 : 4, 'Ta’minotchi hali kiritilmagan.')}</tbody></table></div></section>`;
    const reload = () => suppliers(ctx, holder);
    holder.querySelector('[data-add]')?.addEventListener('click', () => supplierForm(null, reload));
    holder.querySelectorAll('tr[data-id]').forEach((row) => {
      const s = items.find((i) => i.id === Number(row.dataset.id));
      row.querySelector('[data-edit]')?.addEventListener('click', () => supplierForm(s, reload));
      row.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmAction({ title: 'Ta’minotchini o‘chirish', text: `${s.name} o‘chiriladi. Kirim tarixi saqlanadi.`, confirmLabel: 'O‘chirish' }))) return;
        try { await http(`/admin/warehouse/suppliers/${s.id}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
      });
    });
  });
}

function supplierForm(s, onSaved) {
  const v = s || { name: '', phone: '', notes: '', is_active: true };
  formModal({
    title: s ? `${s.name} — tahrirlash` : 'Yangi ta’minotchi',
    body: `${field({ name: 'name', label: 'Nomi', value: v.name, required: true, attrs: 'maxlength="150"' })}
      ${field({ name: 'phone', label: 'Telefon', type: 'tel', value: v.phone || '', attrs: 'inputmode="tel"' })}
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, value: v.notes || '', attrs: 'maxlength="500"' })}${field({ name: 'is_active', label: 'Faol', type: 'checkbox', value: v.is_active })}`,
    onOpen: (form) => attachPhoneMask(form.elements.phone),
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, { name: f.name.value.trim().length >= 2 ? null : 'Nomini kiriting.' });
      const body = { name: f.name.value.trim(), phone: f.phone.value.replace(/\D/g, '').length > 3 ? f.phone.value : null, notes: f.notes.value.trim() || null, is_active: f.is_active.checked };
      if (s) await http(`/admin/warehouse/suppliers/${s.id}`, { method: 'PUT', body });
      else await http('/admin/warehouse/suppliers', { method: 'POST', body });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}

async function warehouses(ctx, holder) {
  const canManage = session.can(PERM.WAREHOUSE_MANAGE);
  await load(ctx, holder, () => http('/admin/warehouse/warehouses'), (items) => {
    holder.innerHTML = `<div class="page-actions"><span class="text-muted">${items.length} ta ombor</span><span class="page-actions__spacer"></span>
      ${canManage ? `<button class="btn btn--primary" data-add>${icon('i-plus')} Ombor qo‘shish</button>` : ''}</div>
      <section class="box"><div class="table-wrap"><table class="table"><thead><tr><th>Nomi</th><th>Izoh</th><th>Holat</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${items.map((w) => `<tr data-id="${w.id}"><td class="strong">${escapeHtml(w.name)}</td><td>${escapeHtml(w.notes || '')}</td><td>${w.is_active ? 'Faol' : '<span class="muted">Nofaol</span>'}</td>
        ${canManage ? `<td class="num"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button></td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
    const reload = () => warehouses(ctx, holder);
    const form = (w) => formModal({
      title: w ? `${w.name} — tahrirlash` : 'Yangi ombor',
      body: `${field({ name: 'name', label: 'Nomi', value: w?.name || '', required: true, attrs: 'maxlength="100" placeholder="Silos A, Yard 1, Kimyo xonasi…"' })}${field({ name: 'notes', label: 'Izoh', value: w?.notes || '', attrs: 'maxlength="500"' })}${field({ name: 'is_active', label: 'Faol', type: 'checkbox', value: w ? w.is_active : true })}`,
      onSubmit: async (f0) => {
        const f = f0.elements;
        localErrors(f0, { name: f.name.value.trim().length >= 2 ? null : 'Nomini kiriting.' });
        const body = { name: f.name.value.trim(), notes: f.notes.value.trim() || null, is_active: f.is_active.checked };
        if (w) await http(`/admin/warehouse/warehouses/${w.id}`, { method: 'PUT', body });
        else await http('/admin/warehouse/warehouses', { method: 'POST', body });
        toast('Saqlandi.', 'success');
        reload();
      },
    });
    holder.querySelector('[data-add]')?.addEventListener('click', () => form(null));
    holder.querySelectorAll('tr[data-id]').forEach((row) => row.querySelector('[data-edit]')?.addEventListener('click', () => form(items.find((i) => i.id === Number(row.dataset.id)))));
  });
}

/* ------------------------------------------------------------ Hisobot */

async function reportPage(ctx, holder) {
  const from = ctx.query.get('from') || monthStart();
  const to = ctx.query.get('to') || todayISO();
  const wid = ctx.query.get('wid') || '';
  await load(ctx, holder, () => Promise.all([http(`/admin/warehouse/report${qs({ date_from: from, date_to: to, warehouse_id: wid })}`), http('/admin/warehouse/warehouses')]), ([r, warehouses]) => {
    holder.innerHTML = `${filterBar({ warehouses, wid, from, to, showCategory: false })}
      <section class="box"><div class="box__head"><h2 class="box__title">Material bo‘yicha harakat</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Material</th><th class="num">Boshida</th><th class="num">Kirim</th><th class="num">Chiqim</th><th class="num">Ishlab chiqarishga</th><th class="num">Oxirida</th></tr></thead>
      <tbody>${r.items.filter((m) => m.is_active || m.incoming || m.outgoing).length ? r.items.filter((m) => m.is_active || m.incoming || m.outgoing).map((m) => `<tr><td class="strong">${escapeHtml(m.name)} <span class="muted">${escapeHtml(unitOf(m.unit))}</span></td>
        <td class="num">${nf(m.initial)}</td><td class="num">${nf(m.incoming)}</td><td class="num">${nf(m.outgoing)}</td><td class="num">${nf(m.by_kind.production || 0)}</td><td class="num strong">${nf(m.stock)}</td></tr>`).join('') : emptyRow(6, 'Xomashyo kiritilmagan.')}</tbody></table></div></section>
      <section class="box mt-5"><div class="box__head"><h2 class="box__title">Sarf nazorati: me’yor va haqiqat</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Material</th><th class="num">1 m³ ga me’yor</th><th class="num">Kutilgan sarf</th><th class="num">Haqiqiy sarf</th><th class="num">Farq</th><th></th></tr></thead>
      <tbody>${r.consumption.length ? r.consumption.map((c) => `<tr><td class="strong">${escapeHtml(c.name)}</td><td class="num">${c.norm_per_m3 === null ? '—' : nf(c.norm_per_m3)}</td><td class="num">${c.expected === null ? '—' : nf(c.expected)}</td><td class="num">${nf(c.actual)} ${escapeHtml(unitOf(c.unit))}</td>
        <td class="num ${c.diff_pct > 3 ? 'text-danger strong' : ''}">${c.diff_pct === null ? '—' : `${c.diff_pct > 0 ? '+' : ''}${nf(c.diff_pct, 1)}%`}</td><td class="meter-cell">${c.expected ? meter(c.actual, Math.max(c.actual, c.expected)) : ''}</td></tr>`).join('')
    : emptyRow(6, 'Sarf nazorati uchun: materialga «1 m³ ga me’yor» kiriting, «Ishlab chiqarishga berish»ni yozing va ishlab chiqarishni kiriting.')}</tbody></table></div>
      <div class="box__body"><p class="text-muted">Kutilgan sarf = davrda ishlab chiqarilgan hajm (sifatdan o‘tmaganlarsiz) × me’yor. Me’yor kiritilmagan material uchun taxmin qilinmaydi.</p></div></section>`;
    bindFilters(holder);
  });
}
