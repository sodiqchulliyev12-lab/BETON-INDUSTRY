/**
 * Laboratoriya: beton namunalari, siqilishga sinov natijalari va sifat nazorati.
 * Qoidalar: kub 150 mm, MPa = kN / 22,5; «M300» = 300 kgf/sm² ≈ 29,4 MPa, «B25» = 25 MPa;
 * 28 kunlik sinovda maqsadga yetsa «O‘tdi». Boshqa yoshdagi sinovlar faqat ko‘rsatiladi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { session } from '../auth.js';
import { setQuery } from '../app.js';
import { todayISO } from '../../validators.js';
import { groupedBars } from '../charts.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, icon, loadingHtml, localErrors, numberOrNull, toast,
} from '../components.js';

const nf = (v, d = 1) => formatNumber(v || 0, d);
const RESULT = { pass: 'O‘tdi', fail: 'O‘tmadi', pending: 'Kutilmoqda', no_target: 'Me’yor yo‘q' };
const resultBadge = (r, overdue) => `<span class="status status--lab-${escapeHtml(r)}">${escapeHtml(RESULT[r] || r)}</span>${overdue ? ' <span class="badge badge--warn">muddati o‘tgan</span>' : ''}`;
const stat = ({ label, value, hint = '', tone = '' }) => `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;

/** Sinov mashinasi sxemasi (faqat illyustratsiya) */
const PRESS = `<svg class="press" viewBox="0 0 120 130" aria-hidden="true"><rect x="10" y="6" width="100" height="12" rx="2"/><rect x="10" y="112" width="100" height="12" rx="2"/>
  <rect x="18" y="18" width="6" height="94"/><rect x="96" y="18" width="6" height="94"/><rect class="press__cube" x="38" y="46" width="44" height="44" rx="2"/>
  <path d="M60 0v26M54 20l6 7 6-7" class="press__arrow"/><path d="M60 130v-26M54 110l6-7 6 7" class="press__arrow"/></svg>`;

export async function render(ctx) {
  const { root, query, isCurrent } = ctx;
  const from = query.get('from') || new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const to = query.get('to') || todayISO();
  const product = query.get('product') || '';
  const result = query.get('result') || '';
  const canManage = session.can(PERM.LAB_MANAGE);
  root.innerHTML = loadingHtml();
  let sum;
  let samples;
  let products;
  try {
    [sum, samples, products] = await Promise.all([
      http(`/admin/lab/summary${qs({ date_from: from, date_to: to })}`),
      http(`/admin/lab/samples${qs({ date_from: from, date_to: to, product_id: product, result })}`),
      http('/admin/products'),
    ]);
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;
  const reload = () => render(ctx);
  const items = samples.items;
  const latest = sum.latest;

  root.innerHTML = `
    <div class="page-actions">
      <select class="select" id="lProduct"><option value="">Barcha markalar</option>${products.map((p) => `<option value="${p.id}" ${String(p.id) === product ? 'selected' : ''}>${escapeHtml(p.name ? `${p.name} · ${p.grade_class}` : p.grade_class)}</option>`).join('')}</select>
      <select class="select" id="lResult">${[['', 'Natija: barchasi'], ['pass', 'O‘tdi'], ['fail', 'O‘tmadi'], ['pending', 'Kutilmoqda'], ['overdue', 'Muddati o‘tgan']].map(([v, l]) => `<option value="${v}" ${v === result ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="text-muted">Dan:</label><input class="input" type="date" id="lFrom" value="${escapeHtml(from)}"><label class="text-muted">Gacha:</label><input class="input" type="date" id="lTo" value="${escapeHtml(to)}">
      <span class="page-actions__spacer"></span>${canManage ? `<button class="btn btn--primary" data-add>${icon('i-plus')} Yangi namuna</button>` : ''}</div>
    <div class="stats">
      ${stat({ label: 'Bugungi namunalar', value: sum.samples_today, hint: `Davrda: ${sum.samples_period}`, tone: 'accent' })}
      ${stat({ label: 'O‘tkazilgan sinovlar', value: sum.tests_done, hint: `28 kunlik: ${sum.control_tests}`, tone: 'info' })}
      ${stat({ label: 'Muvaffaqiyatli (28 kun)', value: sum.pass_pct === null ? '<span class="stat__value--muted">—</span>' : `${nf(sum.pass_pct, 1)}<span class="stat__unit">%</span>`, hint: sum.pass_pct === null ? 'Hali 28 kunlik sinov yo‘q' : '', tone: sum.pass_pct !== null && sum.pass_pct >= 95 ? 'success' : '' })}
      ${stat({ label: 'Me’yorga mos kelmagan', value: `<span class="${sum.failed ? 'text-danger' : ''}">${sum.failed}</span>` })}
      ${stat({ label: 'Kutilayotgan sinovlar', value: `<span class="${sum.pending ? 'text-warn' : ''}">${sum.pending}</span>`, hint: sum.overdue ? `Muddati o‘tgan: <strong>${sum.overdue}</strong>` : '' })}
    </div>
    <div class="admin-grid admin-grid--main">
      <section class="box"><div class="box__head"><h2 class="box__title">28 kunlik mustahkamlik: o‘rtacha va talab (MPa)</h2></div>
        <div class="box__body">${sum.by_grade.length ? groupedBars(sum.by_grade.map((g) => ({ label: g.grade_class, avg_mpa: g.avg_mpa, target_mpa: g.target_mpa || 0 })),
    [{ key: 'avg_mpa', label: 'Amalda (o‘rtacha)', cls: 'c0' }, { key: 'target_mpa', label: 'Talab', cls: 'c6' }], { unit: 'MPa', labelEvery: 1 })
    : '<p class="muted">Tanlangan davrda 28 kunlik sinov natijalari yo‘q.</p>'}</div></section>
      <section class="box"><div class="box__head"><h2 class="box__title">Siqilishga sinov (oxirgi)</h2></div><div class="box__body">${latest ? `
        <div class="press-wrap">${PRESS}<div><strong>${escapeHtml(latest.sample_no)}</strong><br><span class="muted">${escapeHtml(latest.grade_class)}${latest.target_mpa ? ` · talab ${nf(latest.target_mpa)} MPa` : ''}</span>
        <ul class="age-list">${latest.tests.map((t) => `<li><b>${t.age_days} kun</b><span>${nf(t.force_kn)} kN / ${nf(t.strength_mpa, 2)} MPa</span></li>`).join('')}</ul>${resultBadge(latest.result, false)}</div></div>`
    : `<div class="press-wrap">${PRESS}<p class="muted">Hali sinov natijasi kiritilmagan. Namunani tanlab «Sinov» tugmasi bilan kuch (kN) ni kiriting — MPa avtomatik hisoblanadi.</p></div>`}</div></section>
    </div>
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">Namunalarni ro‘yxatga olish</h2><span class="text-muted">${items.length} ta</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Namuna</th><th>Marka</th><th>Sana</th><th>Operator</th><th class="num">Cho‘kish, sm</th><th>Sinovlar (MPa)</th><th>Natija</th>${canManage ? '<th></th>' : ''}</tr></thead>
      <tbody>${items.length ? items.map((s) => `<tr data-id="${s.id}"><td class="nowrap strong">${escapeHtml(s.sample_no)}</td><td>${escapeHtml(s.grade_class)}${s.target_mpa ? `<br><span class="muted">talab ${nf(s.target_mpa)} MPa</span>` : ''}</td>
        <td class="nowrap">${fmtDate(s.sampled_on)}<br><span class="muted">28 kun: ${fmtDate(s.control_due)}</span></td><td>${escapeHtml(s.operator || '—')}</td><td class="num">${s.slump_cm === null ? '—' : nf(s.slump_cm)}</td>
        <td>${s.tests.length ? s.tests.map((t) => `<span class="badge${t.age_days === 28 ? ' badge--strong' : ''}">${t.age_days} k: ${nf(t.strength_mpa, 1)}</span>`).join(' ') : '<span class="muted">—</span>'}</td><td>${resultBadge(s.result, s.overdue)}</td>
        ${canManage ? `<td class="num nowrap"><button class="btn btn--outline btn--sm" data-test>Sinov</button><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 8 : 7, 'Namuna hali kiritilmagan. «Yangi namuna» tugmasi orqali qo‘shing.')}</tbody></table></div></section>
    <p class="text-muted mt-5">Natija qoidasi: namuna 28 kunlik sinovda talab qilingan mustahkamlikka yetsa «O‘tdi». 3, 7 va 14 kunlik natijalar faqat kuzatish uchun — ularga me’yor taxmin qilinmaydi.</p>`;

  const go = () => setQuery({ product: root.querySelector('#lProduct').value, result: root.querySelector('#lResult').value, from: root.querySelector('#lFrom').value, to: root.querySelector('#lTo').value });
  root.querySelectorAll('#lProduct, #lResult, #lFrom, #lTo').forEach((el) => el.addEventListener('change', go));
  root.querySelector('[data-add]')?.addEventListener('click', () => sampleForm(products, reload));
  root.querySelectorAll('tr[data-id]').forEach((row) => {
    const s = items.find((i) => i.id === Number(row.dataset.id));
    row.querySelector('[data-test]')?.addEventListener('click', () => testForm(s, reload));
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Namunani o‘chirish', text: `${s.sample_no} va uning sinov natijalari o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try { await http(`/admin/lab/samples/${s.id}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function sampleForm(products, onSaved) {
  if (!products.length) { toast('Avval «Beton markalari» bo‘limida marka qo‘shing.', 'warning'); return; }
  formModal({
    title: 'Yangi namuna',
    body: `${field({ name: 'product_id', label: 'Beton markasi', required: true, options: [{ value: '', label: '— tanlang —' }].concat(products.map((p) => ({ value: p.id, label: p.name ? `${p.name} · ${p.grade_class}` : p.grade_class }))) })}
      <div class="form-row">${field({ name: 'sampled_on', label: 'Namuna olingan sana', type: 'date', value: todayISO(), required: true, attrs: `max="${todayISO()}"` })}
      ${field({ name: 'slump_cm', label: 'Konus cho‘kishi (sm)', attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Ixtiyoriy.' })}</div>
      ${field({ name: 'operator', label: 'Operator (laborant)', attrs: 'maxlength="100"' })}
      ${field({ name: 'notes', label: 'Izoh', type: 'textarea', rows: 2, attrs: 'maxlength="500"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const slump = numberOrNull(f.slump_cm.value);
      localErrors(form, {
        product_id: f.product_id.value ? null : 'Markani tanlang.',
        slump_cm: Number.isNaN(slump) || (slump !== null && (slump < 0 || slump > 30)) ? '0 dan 30 gacha son kiriting.' : null,
      });
      await http('/admin/lab/samples', { method: 'POST', body: { product_id: Number(f.product_id.value), sampled_on: f.sampled_on.value, slump_cm: slump, operator: f.operator.value.trim() || null, notes: f.notes.value.trim() || null } });
      toast('Namuna qo‘shildi.', 'success');
      onSaved();
    },
  });
}

function testForm(sample, onSaved) {
  const done = new Set(sample.tests.map((t) => t.age_days));
  const ages = [3, 7, 14, 28].filter((a) => !done.has(a));
  formModal({
    title: `${sample.sample_no} — sinov natijasi`,
    body: `${sample.tests.length ? `<p class="text-muted">Kiritilgan: ${sample.tests.map((t) => `${t.age_days} k (${nf(t.strength_mpa, 1)} MPa)`).join(', ')}</p>` : ''}
      <div class="form-row">${field({ name: 'age_days', label: 'Namuna yoshi (kun)', required: true, value: ages[0] || 28, attrs: 'inputmode="numeric" autocomplete="off" list="ageList"', hint: 'Odatda 3, 7, 14, 28. Nazorat — 28 kun.' })}
      ${field({ name: 'tested_on', label: 'Sinov sanasi', type: 'date', value: todayISO(), required: true, attrs: `min="${sample.sampled_on}" max="${todayISO()}"` })}</div>
      <datalist id="ageList">${[3, 7, 14, 28].map((a) => `<option value="${a}">`).join('')}</datalist>
      ${field({ name: 'force_kn', label: 'Buzilish kuchi (kN)', required: true, attrs: 'inputmode="decimal" autocomplete="off"', hint: 'Mustahkamlik avtomatik: MPa = kN / 22,5 (kub 150×150×150 mm).' })}
      <p class="text-muted" data-live></p>${field({ name: 'operator', label: 'Operator', attrs: 'maxlength="100"' })}`,
    onOpen: (form) => {
      const live = form.querySelector('[data-live]');
      form.elements.force_kn.addEventListener('input', () => {
        const kn = numberOrNull(form.elements.force_kn.value);
        live.textContent = kn && kn > 0 ? `= ${nf(kn / 22.5, 2)} MPa${sample.target_mpa ? ` (talab: ${nf(sample.target_mpa)} MPa)` : ''}` : '';
      });
    },
    onSubmit: async (form) => {
      const f = form.elements;
      const age = numberOrNull(f.age_days.value);
      const kn = numberOrNull(f.force_kn.value);
      localErrors(form, {
        age_days: age === null || !Number.isInteger(age) || age < 1 || age > 365 ? '1 dan 365 gacha butun son kiriting.' : (done.has(age) ? `${age} kunlik sinov allaqachon kiritilgan.` : null),
        force_kn: kn === null || Number.isNaN(kn) || kn <= 0 ? 'Musbat son kiriting.' : null,
      });
      await http(`/admin/lab/samples/${sample.id}/tests`, { method: 'POST', body: { age_days: age, tested_on: f.tested_on.value, force_kn: kn, operator: f.operator.value.trim() || null } });
      toast('Sinov natijasi saqlandi.', 'success');
      onSaved();
    },
  });
}
