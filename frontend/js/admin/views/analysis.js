/**
 * Analiz: qiymat oqimi, samaradorlik, hozirgi holat xaritasi, kelajakdagi holat, 8 turdagi isrof,
 * yaxshilash choralari rejasi, jarayon belgilari, monitoring va rahbariyat xulosasi.
 * Hamma raqam bazadagi haqiqiy yozuvlardan hisoblanadi. Hisoblab bo'lmaydigan narsa (OEE, harakat isrofi…)
 * uchun "ma'lumot yig'ilmaydi" deb yoziladi — tizim hech narsani to'qimaydi.
 */
import { formatNumber } from '../../ui.js';
import { http, qs } from '../http.js';
import { addDays, bindPeriod, periodFromQuery, rangeBar } from '../period.js';
import { session } from '../auth.js';
import { gauge, meter } from '../charts.js';
import {
  PERM, confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, icon, loadingHtml, localErrors, toast,
} from '../components.js';
import { todayISO } from '../../validators.js';

const nf = (v, d = 1) => formatNumber(v || 0, d);
const STAGE_NAME = {
  new: 'Yangi', confirmed: 'Tasdiqlandi', scheduled: 'Rejalashtirildi', in_production: 'Ishlab chiqarish',
  quality_check: 'Sifat nazorati', loaded: 'Yuklash', in_transit: 'Yo‘lda', delivered: 'Yetkazildi',
};
const ACTION_STATUS = { planned: 'Rejalashtirilgan', in_progress: 'Bajarilmoqda', waiting: 'Kutilmoqda', done: 'Yakunlandi' };

function hours(h) {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} daq`;
  if (h < 48) return `${nf(h, 1)} soat`;
  return `${nf(h / 24, 1)} kun`;
}

const section = (n, title, body, extra = '') => `<section class="box an-section"><div class="box__head"><h2 class="box__title"><span class="an-n">${n}</span> ${escapeHtml(title)}</h2>${extra}</div><div class="box__body">${body}</div></section>`;

export async function render(ctx) {
  const { root, isCurrent, query } = ctx;
  const { from, to } = periodFromQuery(query, { from: addDays(todayISO(), -29), to: todayISO() });
  root.innerHTML = loadingHtml();
  let ov;
  let actions;
  try {
    [ov, actions] = await Promise.all([http(`/admin/analysis/overview${qs({ date_from: from, date_to: to })}`), http('/admin/analysis/actions')]);
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;
  const reload = () => render(ctx);
  const canManage = session.can(PERM.ANALYSIS_MANAGE);
  const v = ov.vsm;
  const stages = v.stages;
  const timed = stages.filter((s) => s.avg_hours !== null && s.status !== 'delivered');
  const neck = stages.find((s) => s.status === v.bottleneck);

  /* 01 Qiymat oqimi */
  const s01 = v.has_data ? `
    <div class="an-flow">${stages.map((s, i) => `<div class="an-node an-node--${s.kind}${s.status === v.bottleneck ? ' is-neck' : ''}"><span class="an-node__k">${s.kind === 'work' ? 'Ish' : (s.kind === 'done' ? 'Natija' : 'Kutish')}</span>
      <strong>${escapeHtml(STAGE_NAME[s.status])}</strong><span>${hours(s.avg_hours)}</span><small>${s.wip_orders} ta · ${nf(s.wip_volume_m3, 0)} m³</small></div>${i < stages.length - 1 ? icon('i-arrow', 'an-arrow') : ''}`).join('')}</div>
    <div class="an-kpis"><div><span>Yetkazish vaqti</span><strong>${hours(v.lead_time_hours)}</strong></div><div><span>Ish vaqti</span><strong>${hours(v.work_time_hours)}</strong></div>
      <div><span>Kutish</span><strong>${hours(v.wait_time_hours)}</strong></div><div><span>Samaradorlik</span><strong>${v.efficiency_pct === null ? '—' : `${nf(v.efficiency_pct)}%`}</strong></div></div>
    <p class="text-muted">Oxirgi ${v.period_days} kun, ${v.delivered_orders} ta yetkazilgan buyurtma bo‘yicha. Batafsil xarita — <a href="#/dashboard">Dashboard</a>.</p>`
    : '<p class="muted">Buyurtmalar holati tarixi hali yo‘q — oqim xaritasi buyurtmalar o‘tgach shakllanadi.</p>';

  /* 02 Samaradorlik */
  const quality = ov.lab_pass_pct ?? (ov.qc_fail_pct === null ? null : 100 - ov.qc_fail_pct);
  const s02 = `<div class="gauges">
    ${gauge(ov.plan_pct, { label: 'Reja bajarilishi' })}
    ${gauge(ov.on_time_pct, { label: `O‘z vaqtida yetkazish${ov.on_time_n ? ` (${ov.on_time_n} ta)` : ''}` })}
    ${gauge(quality, { label: ov.lab_pass_pct !== null ? `Sifat: laboratoriya (${ov.lab_control_tests} ta)` : 'Sifat: nazoratdan o‘tish' })}
    ${gauge(ov.vehicles.busy_pct, { label: 'Transport bandligi', tone: ov.vehicles.busy_pct === null ? 'none' : 'info' })}
    ${gauge(ov.cancel_pct === null ? null : 100 - ov.cancel_pct, { label: `Bekor qilinmagan buyurtmalar${ov.cancel_pct === null ? '' : ` (bekor: ${nf(ov.cancel_pct)}%)`}` })}
    <div class="gauge gauge--none"><div class="gauge__na">OEE</div><strong class="gauge__value">—</strong><span class="gauge__label">Hisoblanmaydi: uskunaning to‘xtab qolish vaqti yig‘ilmaydi</span></div></div>`;

  /* 03 Hozirgi holat xaritasi */
  const s03 = `<div class="an-map">${stages.filter((s) => s.status !== 'delivered').map((s) => `<div class="an-map__cell${s.status === v.bottleneck ? ' is-neck' : ''}">
      <div class="an-map__box an-node--${s.kind}"><strong>${escapeHtml(STAGE_NAME[s.status])}</strong><span class="an-map__n">${s.wip_orders}</span><small>${nf(s.wip_volume_m3, 0)} m³ navbatda</small></div>
      <div class="an-map__t">${hours(s.avg_hours)}${s.status === v.bottleneck ? ' <span class="badge badge--warn">tor joy</span>' : ''}</div></div>`).join('')}
    <div class="an-map__cell"><div class="an-map__box an-node--done"><strong>Yetkazildi</strong><span class="an-map__n">${stages.at(-1).wip_orders}</span></div></div></div>
    <p class="text-muted">Quti ichidagi son — hozir shu bosqichda turgan buyurtmalar; pastda — buyurtmaning bosqichda o‘rtacha turish vaqti.</p>`;

  /* 05 Kelajakdagi holat (hisob-kitob) */
  let s05 = '<p class="muted">Kelajakdagi holatni hisoblash uchun kamida ikkita bosqichda vaqt ma’lumoti kerak.</p>';
  if (timed.length >= 2) {
    const sorted = [...timed].sort((a, b) => b.avg_hours - a.avg_hours);
    const saving = sorted[0].avg_hours - sorted[1].avg_hours;
    s05 = `<div class="an-future"><div class="an-future__box"><span class="muted">Hozir</span><strong>${hours(v.lead_time_hours)}</strong><small>yetkazish vaqti</small></div>${icon('i-arrow', 'an-arrow')}
      <div class="an-future__box an-future__box--goal"><span class="muted">Tor joy «${escapeHtml(STAGE_NAME[sorted[0].status])}» «${escapeHtml(STAGE_NAME[sorted[1].status])}» darajasiga tushsa</span>
      <strong>${v.lead_time_hours === null ? '—' : hours(Math.max(v.lead_time_hours - saving, 0))}</strong><small>${hours(saving)} tejaladi</small></div></div>
      <p class="text-muted">Bu hisob-kitob: eng uzoq bosqich (${hours(sorted[0].avg_hours)}) ikkinchi eng uzoq bosqich (${hours(sorted[1].avg_hours)}) darajasiga tushirilsa nima bo‘lishini ko‘rsatadi. Maqsadni «Yaxshilash choralari»ga yozing.</p>`;
  }

  /* 06 Isrofning 8 turi */
  const waitShare = v.efficiency_pct === null ? null : 100 - v.efficiency_pct;
  const waste = [
    { name: 'Ortiqcha ishlab chiqarish', icon: 'i-factory', note: ov.plan_pct === null ? null : `Reja bajarilishi ${nf(ov.plan_pct)}%`, tone: ov.plan_pct === null ? 'none' : (ov.plan_pct > 110 ? 'warn' : 'ok') },
    { name: 'Kutish', icon: 'i-clock', note: waitShare === null ? null : `Vaqtning ${nf(waitShare)}% — kutish`, tone: waitShare === null ? 'none' : (waitShare > 60 ? 'bad' : (waitShare > 35 ? 'warn' : 'ok')) },
    { name: 'Transport', icon: 'i-truck', note: ov.vehicles.total ? `Yo‘lda: ${ov.vehicles.on_road} · ta’mirda: ${ov.vehicles.repair}` : null, tone: ov.vehicles.total ? (ov.vehicles.repair > ov.vehicles.total / 4 ? 'warn' : 'ok') : 'none' },
    { name: 'Ortiqcha ishlov', icon: 'i-settings', note: null, tone: 'none' },
    { name: 'Zaxira va navbat', icon: 'i-layers', note: ov.stock.materials ? `Kam/tugagan xomashyo: ${ov.stock.low + ov.stock.out}` : null, tone: ov.stock.materials ? (ov.stock.out ? 'bad' : (ov.stock.low ? 'warn' : 'ok')) : 'none' },
    { name: 'Harakat', icon: 'i-route', note: null, tone: 'none' },
    { name: 'Yaroqsiz mahsulot', icon: 'i-alert', note: ov.qc_fail_pct === null && ov.cancel_pct === null ? null : `Sifatdan o‘tmagan: ${ov.qc_fail_pct === null ? '—' : `${nf(ov.qc_fail_pct)}%`} · bekor: ${ov.cancel_pct === null ? '—' : `${nf(ov.cancel_pct)}%`}`, tone: (ov.qc_fail_pct || 0) > 5 || (ov.cancel_pct || 0) > 10 ? 'bad' : ((ov.qc_fail_pct === null && ov.cancel_pct === null) ? 'none' : 'ok') },
    { name: 'Xodimlar salohiyati', icon: 'i-user', note: null, tone: 'none' },
  ];
  const TONE = { ok: 'Normal', warn: 'Diqqat', bad: 'Xavf', none: 'Ma’lumot yo‘q' };
  const s06 = `<div class="waste">${waste.map((w) => `<div class="waste__card waste__card--${w.tone}">${icon(w.icon)}<strong>${escapeHtml(w.name)}</strong>
    <span class="waste__note">${escapeHtml(w.note || 'Bu ko‘rsatkich uchun ma’lumot yig‘ilmaydi')}</span><span class="waste__tag">${TONE[w.tone]}</span></div>`).join('')}</div>`;

  /* 07 Harakatlar rejasi */
  const s07 = `<div class="table-wrap"><table class="table"><thead><tr><th>Chora</th><th>Mas’ul</th><th>Muddat</th><th>Holat</th>${canManage ? '<th></th>' : ''}</tr></thead>
    <tbody>${actions.items.length ? actions.items.map((a) => `<tr data-id="${a.id}"><td class="strong">${escapeHtml(a.title)}${a.note ? `<br><span class="muted">${escapeHtml(a.note)}</span>` : ''}</td><td>${escapeHtml(a.assignee || '—')}</td>
      <td class="nowrap ${a.overdue ? 'text-danger strong' : ''}">${a.due_date ? fmtDate(a.due_date) : '—'}${a.overdue ? ' ⚠' : ''}</td><td><span class="status status--act-${a.status}">${ACTION_STATUS[a.status]}</span></td>
      ${canManage ? `<td class="num nowrap"><button class="icon-btn" data-edit aria-label="Tahrirlash">${icon('i-edit')}</button><button class="icon-btn" data-del aria-label="O‘chirish">${icon('i-trash')}</button></td>` : ''}</tr>`).join('')
    : emptyRow(canManage ? 5 : 4, 'Hali chora kiritilmagan. Tahlildan chiqqan xulosalarni shu yerga yozib boring.')}</tbody></table></div>`;

  /* 08 Belgilar */
  const s08 = `<div class="legend-grid">
    <div><i class="lg lg--wait"></i><strong>Kutish bosqichi</strong><span>Buyurtma navbatda, ish bajarilmayapti (tasdiqlash, rejalashtirish).</span></div>
    <div><i class="lg lg--work"></i><strong>Ish bosqichi</strong><span>Qiymat qo‘shiladigan jarayon (ishlab chiqarish, sifat, yuklash, yo‘l).</span></div>
    <div><i class="lg lg--neck"></i><strong>Tor joy</strong><span>Eng uzoq turadigan bosqich — oqimni sekinlashtiradi.</span></div>
    <div><i class="lg lg--wip"></i><strong>Navbat (WIP)</strong><span>Hozir shu bosqichda turgan buyurtmalar soni va hajmi.</span></div>
    <div><i class="lg lg--done"></i><strong>Natija</strong><span>Yetkazib berilgan buyurtma.</span></div>
    <div><i class="lg lg--loss"></i><strong>Yo‘qotish</strong><span>Bosqichda bekor qilingan buyurtmalar.</span></div></div>`;

  /* 09 Nazorat va monitoring */
  const s09 = `<div class="mon-grid"><div class="mon-card">${icon('i-truck')}<strong>${ov.vehicles.on_road}</strong><span>reysda (yo‘lda)</span><small>band: ${ov.vehicles.busy} / ${ov.vehicles.total}</small></div>
    <div class="mon-card">${icon('i-flask')}<strong>${ov.pending_samples}</strong><span>kutilayotgan laboratoriya sinovi</span></div>
    <div class="mon-card">${icon('i-box')}<strong>${(ov.wip.in_production?.orders || 0) + (ov.wip.quality_check?.orders || 0)}</strong><span>ishlab chiqarishda / sifat nazoratida</span></div></div>
    <h3 class="an-sub">Asosiy xomashyo qoldig‘i</h3>${ov.stock.gauges.length ? `<div class="mon-stock">${ov.stock.gauges.map((g) => `<div><div class="hbar__label"><span>${escapeHtml(g.name)}</span><span>${nf(g.stock, 1)} ${escapeHtml(g.unit)}${g.min_stock !== null ? ` · min ${nf(g.min_stock, 1)}` : ''}</span></div>
      ${meter(g.stock, Math.max(g.stock, g.min_stock || g.stock, 1), { cls: g.status === 'low' || g.status === 'out' ? 'meter--bad' : '' })}</div>`).join('')}</div>` : '<p class="muted">Omborda sement, qum, shag‘al yoki chaqiqtosh hali kiritilmagan. <a href="#/warehouse">Ombor →</a></p>'}`;

  /* 10 Rahbariyat xulosasi */
  const facts = [];
  if (v.lead_time_hours !== null) facts.push(`Zayafkadan yetkazishgacha o‘rtacha <strong>${hours(v.lead_time_hours)}</strong>; shundan faqat <strong>${v.efficiency_pct === null ? '—' : `${nf(v.efficiency_pct)}%`}</strong> ish, qolgani kutish.`);
  if (neck) facts.push(`Eng uzoq turadigan bosqich: <strong>${escapeHtml(STAGE_NAME[neck.status])}</strong> (o‘rtacha ${hours(neck.avg_hours)}).`);
  if (ov.plan_pct !== null) facts.push(`Reja bajarilishi: <strong>${nf(ov.plan_pct)}%</strong> (${nf(ov.produced_m3, 0)} / ${nf(ov.plan_m3, 0)} m³).`);
  if (ov.on_time_pct !== null) facts.push(`O‘z vaqtida yetkazilgan buyurtmalar: <strong>${nf(ov.on_time_pct)}%</strong>.`);
  if (ov.lab_pass_pct !== null) facts.push(`Laboratoriya (28 kun) bo‘yicha me’yorga mos: <strong>${nf(ov.lab_pass_pct)}%</strong>.`);
  if (ov.cancel_pct !== null) facts.push(`Tanlangan davrda buyurtmalarning <strong>${nf(ov.cancel_pct)}%</strong> bekor qilingan.`);
  if (ov.stock.low + ov.stock.out > 0) facts.push(`<strong>${ov.stock.low + ov.stock.out} ta</strong> xomashyo minimal qoldiqdan past yoki tugagan.`);
  const overdue = actions.items.filter((a) => a.overdue).length;
  if (overdue) facts.push(`<strong>${overdue} ta</strong> yaxshilash chorasining muddati o‘tgan.`);
  const s10 = facts.length ? `<ul class="facts">${facts.map((f) => `<li>${f}</li>`).join('')}</ul><p class="text-muted">Xulosa avtomatik: faqat bazadagi haqiqiy ma’lumotdan tuziladi. Umumiy «ball» hisoblanmaydi — uni berish uchun asos (maqsad va me’yorlar) hali belgilanmagan.</p>`
    : '<p class="muted">Xulosa uchun hali ma’lumot yo‘q. Buyurtmalar, ishlab chiqarish va laboratoriya yozuvlari kiritilgach bu yerda avtomatik paydo bo‘ladi.</p>';

  root.innerHTML = `<div class="page-actions">${rangeBar({ from, to })}</div><p class="text-muted">Barcha ko‘rsatkichlar shu davr bo‘yicha; navbat (WIP) — hozirgi holat.</p><div class="an">
    ${section('01', 'Qiymat oqimi sharhi', s01)}${section('02', 'Samaradorlik ko‘rsatkichlari', s02)}${section('03', 'Hozirgi holat xaritasi', s03)}
    ${section('05', 'Kelajakdagi holat xaritasi', s05)}${section('06', 'Isrofning 8 turi', s06)}
    ${section('07', 'Takomillashtirish harakatlar rejasi', s07, canManage ? `<button class="btn btn--primary btn--sm" data-add>${icon('i-plus')} Chora qo‘shish</button>` : '')}
    ${section('08', 'Jarayon xaritasi belgilari', s08)}${section('09', 'Nazorat va monitoring', s09)}${section('10', 'Rahbariyat uchun xulosa', s10)}</div>`;

  bindPeriod(root);
  root.querySelector('[data-add]')?.addEventListener('click', () => actionForm(null, reload));
  root.querySelectorAll('tr[data-id]').forEach((row) => {
    const a = actions.items.find((i) => i.id === Number(row.dataset.id));
    row.querySelector('[data-edit]')?.addEventListener('click', () => actionForm(a, reload));
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Chorani o‘chirish', text: `«${a.title}» o‘chiriladi.`, confirmLabel: 'O‘chirish' }))) return;
      try { await http(`/admin/analysis/actions/${a.id}`, { method: 'DELETE' }); toast('O‘chirildi.', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function actionForm(a, onSaved) {
  const v = a || { title: '', assignee: '', status: 'planned', due_date: '', note: '' };
  formModal({
    title: a ? 'Chorani tahrirlash' : 'Yangi chora',
    body: `${field({ name: 'title', label: 'Chora', value: v.title, required: true, attrs: 'maxlength="200" placeholder="Masalan: tasdiqlash vaqtini qisqartirish"' })}
      <div class="form-row">${field({ name: 'assignee', label: 'Mas’ul', value: v.assignee || '', attrs: 'maxlength="100"' })}
      ${field({ name: 'due_date', label: 'Muddat', type: 'date', value: v.due_date || '', attrs: `min="${a ? '' : todayISO()}"` })}</div>
      ${field({ name: 'status', label: 'Holat', value: v.status, options: Object.entries(ACTION_STATUS).map(([value, label]) => ({ value, label })) })}
      ${field({ name: 'note', label: 'Izoh', type: 'textarea', rows: 2, value: v.note || '', attrs: 'maxlength="500"' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, { title: f.title.value.trim().length >= 3 ? null : 'Kamida 3 ta belgi kiriting.' });
      const body = { title: f.title.value.trim(), assignee: f.assignee.value.trim() || null, status: f.status.value, due_date: f.due_date.value || null, note: f.note.value.trim() || null };
      if (a) await http(`/admin/analysis/actions/${a.id}`, { method: 'PUT', body });
      else await http('/admin/analysis/actions', { method: 'POST', body });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}
