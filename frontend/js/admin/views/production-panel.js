/**
 * Ishlab chiqarish paneli: kunlik/oylik hajm, reja bajarilishi, reja va haqiqat grafigi, markalar ulushi,
 * jarayon bosqichlari va xomashyo sarfi. Hammasi bazadagi yozuvlardan; ma'lumot bo'lmasa "—".
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { setQuery } from '../app.js';
import { bindPeriod, dayBar } from '../period.js';
import { todayISO } from '../../validators.js';
import { donut, groupedBars } from '../charts.js';
import { emptyRow, errorHtml, escapeHtml, fmtDate, icon, loadingHtml } from '../components.js';

const nf = (v, d = 1) => formatNumber(v || 0, d);
const stat = ({ label, value, hint = '', tone = '' }) => `<div class="stat${tone ? ` stat--${tone}` : ''}"><span class="stat__label">${escapeHtml(label)}</span><span class="stat__value">${value}</span>${hint ? `<span class="stat__hint">${hint}</span>` : ''}</div>`;
const m3 = (v) => `${nf(v, 1)}<span class="stat__unit">m³</span>`;

export async function render(ctx) {
  const { root, isCurrent, query } = ctx;
  const day = query.get('date') || todayISO();
  const days = [7, 14, 30, 60, 90].includes(Number(query.get('days'))) ? Number(query.get('days')) : 14;
  root.innerHTML = loadingHtml();
  let p;
  try {
    p = await http(`/admin/production/panel${qs({ date: day, days })}`);
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  const hasDaily = p.daily.some((d) => d.planned_m3 || d.produced_m3);
  const pct = p.plan_pct_month;
  root.innerHTML = `
    <div class="page-actions">${dayBar({ date: day, label: 'Sana' })}
      <select class="select" id="pDays" aria-label="Grafik davri">${[7, 14, 30, 60, 90].map((n) => `<option value="${n}" ${n === days ? 'selected' : ''}>Grafik: oxirgi ${n} kun</option>`).join('')}</select><span class="page-actions__spacer"></span>
      <a class="btn btn--outline" href="#/production">Reja va yozuvlar →</a></div>
    <div class="stats">
      ${stat({ label: day === todayISO() ? 'Bugungi ishlab chiqarish' : `Ishlab chiqarish (${fmtDate(day).slice(0, 5)})`, value: m3(p.today_m3), hint: p.plan_today_m3 ? `Reja: ${nf(p.plan_today_m3)} m³` : 'Shu kunga reja yo‘q', tone: 'accent' })}
      ${stat({ label: `Oylik ishlab chiqarish (${fmtDate(day).slice(3)})`, value: m3(p.month_m3), tone: 'info' })}
      ${stat({ label: 'Reja bajarilishi (oy)', value: pct === null ? '<span class="stat__value--muted">—</span>' : `${nf(pct, 1)}<span class="stat__unit">%</span>`, hint: pct === null ? 'Reja kiritilmagan' : `Reja: ${nf(p.planned_month_m3)} m³`, tone: pct !== null && pct >= 95 ? 'success' : '' })}
      ${stat({ label: 'Zavod quvvati', value: p.capacity_m3_per_day === null ? '<span class="stat__value--muted">Belgilanmagan</span>' : `${nf(p.capacity_m3_per_day, 0)}<span class="stat__unit">m³/kun</span>`, hint: p.capacity_m3_per_day === null ? '<a href="#/settings">Sozlamalarda kiriting</a>' : '' })}
      ${stat({ label: 'Sifat nazorati', value: `${p.qc.passed} <span class="stat__unit">o‘tdi</span>`, hint: `Kutilmoqda: ${p.qc.pending} · o‘tmadi: ${p.qc.failed}` })}
    </div>
    <div class="admin-grid admin-grid--main">
      <section class="box"><div class="box__head"><h2 class="box__title">Sutkalik ishlab chiqarish: reja va haqiqat (m³), oxirgi ${days} kun</h2></div>
        <div class="box__body">${hasDaily ? groupedBars(p.daily.map((d) => ({ label: fmtDate(d.date).slice(0, 5), produced_m3: d.produced_m3, planned_m3: d.planned_m3 })),
    [{ key: 'produced_m3', label: 'Haqiqiy', cls: 'c0' }, { key: 'planned_m3', label: 'Reja', cls: 'c6' }], { unit: 'm³' })
    : '<p class="muted">Bu davrda reja yoki ishlab chiqarish yozuvlari yo‘q. «Reja va yozuvlar» bo‘limida kiriting.</p>'}</div></section>
      <section class="box"><div class="box__head"><h2 class="box__title">Beton markalari taqsimoti (30 kun)</h2></div>
        <div class="box__body">${donut(p.shares.map((s) => ({ label: `${s.grade_class}`, value: s.volume_m3 })), { unit: 'm³' })}</div></section>
    </div>
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">Ishlab chiqarish bosqichlari monitoringi</h2></div>
      <div class="box__body"><div class="stage-row">${p.stages.map((s, i) => `<div class="stage-card${s.orders ? ' is-active' : ''}">
        <span class="stage-card__n">${i + 1}</span><strong>${escapeHtml(s.label)}</strong><span class="stage-card__v">${s.orders} <small>ta buyurtma</small></span><span class="muted">${nf(s.volume_m3)} m³</span></div>${i < p.stages.length - 1 ? icon('i-arrow', 'stage-arrow') : ''}`).join('')}</div></div></section>
    <section class="box mt-5"><div class="box__head"><h2 class="box__title">Xomashyo sarfi tahlili (shu oy)</h2><a class="btn btn--outline btn--sm" href="#/warehouse">Ombor →</a></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>Material</th><th class="num">Me’yor (1 m³)</th><th class="num">Kutilgan</th><th class="num">Amalda</th><th class="num">Farq</th></tr></thead>
      <tbody>${p.consumption.length ? p.consumption.map((c) => `<tr><td class="strong">${escapeHtml(c.name)}</td><td class="num">${c.norm_per_m3 === null ? '—' : nf(c.norm_per_m3, 3)}</td><td class="num">${c.expected === null ? '—' : nf(c.expected, 2)}</td><td class="num">${nf(c.actual, 2)} ${escapeHtml(c.unit)}</td>
        <td class="num ${c.diff_pct > 3 ? 'text-danger strong' : ''}">${c.diff_pct === null ? '—' : `${c.diff_pct > 0 ? '+' : ''}${nf(c.diff_pct, 1)}%`}</td></tr>`).join('')
    : emptyRow(5, 'Sarf ma’lumoti yo‘q: omborda «Ishlab chiqarishga berish» yozing va materialga me’yor kiriting.')}</tbody></table></div></section>`;
  bindPeriod(root);
  root.querySelector('#pDays').addEventListener('change', (e) => setQuery({ days: e.target.value }));
}
