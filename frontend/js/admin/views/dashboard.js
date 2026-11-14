/**
 * Dashboard. Faqat bazadagi haqiqiy ma'lumot ko'rsatiladi: buyurtma bo'lmasa grafiklar o'rniga
 * bo'sh holat chiqadi, ishlab chiqarish quvvati belgilanmagan bo'lsa "Belgilanmagan" yoziladi.
 */
import { formatNumber } from '../../ui.js';
import { http } from '../http.js';
import { session } from '../auth.js';
import { ORDER_STATUS, PERM, escapeHtml, fmtDate, icon, loadingHtml, statusBadge, volume } from '../components.js';

/** Katta raqam + kichik "m³" birligi */
function vol(value) {
  return `${formatNumber(value || 0, 2)}<span class="stat__unit">m³</span>`;
}

function stat({ label, value, hint = '', tone = '', href = '' }) {
  const tag = href ? 'a' : 'div';
  return `<${tag} class="stat${tone ? ` stat--${tone}` : ''}"${href ? ` href="${href}"` : ''}>
    <span class="stat__label">${escapeHtml(label)}</span>
    <span class="stat__value">${value}</span>
    ${hint ? `<span class="stat__hint">${hint}</span>` : ''}
  </${tag}>`;
}

/** Kunlik hajm ustunli grafigi (SVG, tashqi kutubxonasiz) */
function dailyChart(daily) {
  const W = 720;
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = Math.max(...daily.map((d) => d.volume_m3), 0);
  const niceMax = max <= 0 ? 1 : (() => {
    const step = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / step) * step;
  })();
  const slot = innerW / daily.length;
  const barW = Math.max(2, slot * 0.68);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = pad.top + innerH * (1 - t);
    return `<line class="grid-line" x1="${pad.left}" x2="${W - pad.right}" y1="${y}" y2="${y}"/>
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${formatNumber(niceMax * t, 1)}</text>`;
  }).join('');

  const bars = daily.map((d, i) => {
    const h = (d.volume_m3 / niceMax) * innerH;
    const x = pad.left + i * slot + (slot - barW) / 2;
    const y = pad.top + innerH - h;
    const label = `${fmtDate(d.date)}: ${d.orders} ta buyurtma, ${formatNumber(d.volume_m3, 2)} m³`;
    return `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, d.volume_m3 > 0 ? 2 : 0).toFixed(1)}" rx="2"><title>${escapeHtml(label)}</title></rect>`;
  }).join('');

  const labels = daily.map((d, i) => {
    if (i % 5 !== 0 && i !== daily.length - 1) return '';
    const x = pad.left + i * slot + slot / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle">${fmtDate(d.date).slice(0, 5)}</text>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Oxirgi ${daily.length} kundagi buyurtma hajmi, m³">${grid}${bars}${labels}</svg>`;
}

/** Gorizontal bar: CSP inline style'ni bloklagani uchun kenglik SVG atributi orqali beriladi */
function hbar(value, max) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1 : 0) : 0;
  return `<svg class="hbar__track" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
    <rect class="hbar__fill" width="${width.toFixed(2)}" height="10" rx="5"/></svg>`;
}

function productBars(rows) {
  const max = Math.max(...rows.map((r) => r.volume_m3), 1);
  return `<div class="hbars">${rows.map((r) => `
    <div>
      <div class="hbar__label"><span>${escapeHtml(r.grade_class)} — ${escapeHtml(r.product_name)}</span><span>${volume(r.volume_m3)}</span></div>
      ${hbar(r.volume_m3, max)}
    </div>`).join('')}</div>`;
}

function statusList(byStatus) {
  const max = Math.max(...Object.values(byStatus), 1);
  return `<div class="status-bars">${Object.keys(ORDER_STATUS).map((key) => `
    <a href="#/orders?status=${key}">
      ${statusBadge(key)}
      ${hbar(byStatus[key], max)}
      <span class="num">${byStatus[key]}</span>
    </a>`).join('')}</div>`;
}


// --- Qiymat oqimi xaritasi (Value Stream Map) -------------------------------

const STAGE_HINT = {
  new: 'Zayafka qabul qilindi',
  confirmed: 'Narx va shartlar kelishildi',
  scheduled: 'Ishlab chiqarish rejasiga qo‘yildi',
  in_production: 'Beton qorilmoqda',
  quality_check: 'Laboratoriya tekshiruvi',
  loaded: 'Miksyerga yuklandi',
  in_transit: 'Obyektga ketmoqda',
  delivered: 'Mijozga topshirildi',
};

/** Soatni o'qiladigan ko'rinishga: 0.5 → "30 daq", 30 → "1 kun 6 soat". null → "—" */
function dur(hours) {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} daq`;
  if (hours < 48) return `${formatNumber(hours, 1)} soat`;
  const d = Math.floor(hours / 24);
  const h = Math.round(hours - d * 24);
  return h ? `${d} kun ${h} soat` : `${d} kun`;
}

function vsmStage(s, bottleneck) {
  const isNeck = s.status === bottleneck;
  const kindLabel = s.kind === 'work' ? 'Ish' : s.kind === 'wait' ? 'Kutish' : 'Natija';
  return `<a class="vsm-stage vsm-stage--${s.kind}${isNeck ? ' vsm-stage--neck' : ''}" href="#/orders?status=${s.status}">
    <span class="vsm-stage__kind">${kindLabel}${isNeck ? ' · <b>Tor joy</b>' : ''}</span>
    <span class="vsm-stage__title">${escapeHtml(ORDER_STATUS[s.status])}</span>
    <span class="vsm-stage__hint">${escapeHtml(STAGE_HINT[s.status] || '')}</span>
    <dl class="vsm-stage__facts">
      ${s.kind !== 'done' ? `<div><dt>O‘rtacha vaqt</dt><dd>${dur(s.avg_hours)}</dd></div>` : ''}
      <div><dt>${s.kind === 'done' ? 'Jami' : 'Hozir navbatda'}</dt><dd>${s.wip_orders} ta · ${formatNumber(s.wip_volume_m3, 1)} m³</dd></div>
      ${s.cancelled_here ? `<div class="vsm-stage__loss"><dt>Bekor qilingan</dt><dd>${s.cancelled_here} ta</dd></div>` : ''}
    </dl>
    <span class="vsm-stage__n">${s.samples ? `${s.samples} ta o‘tishdan` : 'Hali o‘tish yo‘q'}</span>
  </a>`;
}

/** VSM pastidagi vaqt chizig'i: kutish — yuqorida, ish — pastda (klassik "zinapoya") */
function vsmTimeline(stages) {
  const rows = stages.filter((s) => s.kind !== 'done');
  const W = 960;
  const H = 96;
  const slot = W / rows.length;
  const yWait = 30;
  const yWork = 70;
  let path = '';
  const labels = rows.map((s, i) => {
    const y = s.kind === 'work' ? yWork : yWait;
    const x0 = i * slot;
    const x1 = x0 + slot;
    path += `${i === 0 ? 'M' : 'L'}${x0.toFixed(1)},${y} L${x1.toFixed(1)},${y} `;
    const ty = s.kind === 'work' ? yWork + 20 : yWait - 10;
    return `<text x="${(x0 + slot / 2).toFixed(1)}" y="${ty}" text-anchor="middle" class="vsm-tl__${s.kind}">${escapeHtml(dur(s.avg_hours))}</text>`;
  }).join('');
  return `<svg class="vsm-tl" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bosqichlar bo‘yicha o‘rtacha vaqt: kutish yuqorida, ish pastda">
    <path d="${path}" class="vsm-tl__line"/>${labels}</svg>`;
}

function avgDemand(data) {
  return data.daily.reduce((sum, d) => sum + d.volume_m3, 0) / data.daily.length;
}

function vsmInsights(vs, data) {
  const out = [];
  const stages = Object.fromEntries(vs.stages.map((s) => [s.status, s]));
  if (vs.bottleneck) {
    const s = stages[vs.bottleneck];
    out.push(`Eng uzoq turiladigan bosqich — <b>${escapeHtml(ORDER_STATUS[s.status])}</b>: o‘rtacha ${dur(s.avg_hours)}.`);
  }
  if (stages.new.wip_orders) {
    out.push(`<b>${stages.new.wip_orders} ta</b> zayafka hali tasdiqlanmagan (${formatNumber(stages.new.wip_volume_m3, 1)} m³).`);
  }
  const lossy = vs.stages.filter((s) => s.cancelled_here).sort((a, b) => b.cancelled_here - a.cancelled_here)[0];
  if (lossy) out.push(`Eng ko‘p bekor qilish <b>${escapeHtml(ORDER_STATUS[lossy.status])}</b> bosqichida: ${lossy.cancelled_here} ta.`);
  if (vs.efficiency_pct !== null && vs.efficiency_pct < 50) {
    out.push(`Umumiy vaqtning faqat <b>${formatNumber(vs.efficiency_pct, 1)}%</b> qismi ish, qolgani kutish — kutishni qisqartirish yetkazishni tezlashtiradi.`);
  }
  const capacity = Number(data.production_capacity_m3_per_day);
  const demand = avgDemand(data);
  if (capacity > 0 && demand > capacity) out.push(`O‘rtacha kunlik talab (${formatNumber(demand, 1)} m³) quvvatdan oshib ketgan.`);
  return out.length
    ? `<ul class="vsm-list">${out.map((t) => `<li>${t}</li>`).join('')}</ul>`
    : '<p class="text-muted">Xulosa uchun ma’lumot hali yetarli emas: buyurtmalar bosqichlardan o‘tgan sari shu yerda paydo bo‘ladi.</p>';
}

function valueStream(vs, data) {
  const days = data.daily.length;
  const capacity = data.production_capacity_m3_per_day;
  const losses = vs.stages.filter((s) => s.cancelled_here);
  return `<section class="box mt-5 vsm">
    <div class="box__head">
      <h2 class="box__title">Qiymat oqimi: zayafkadan yetkazishgacha</h2>
      <span class="text-muted">oxirgi ${vs.period_days} kun · holatlar tarixidan</span>
    </div>
    <div class="box__body">
      <div class="vsm-ends">
        <div class="vsm-end"><b>Mijoz talabi</b><span>${formatNumber(avgDemand(data), 1)} m³/kun</span><small>oxirgi ${days} kun o‘rtachasi</small></div>
        <div class="vsm-end vsm-end--plant"><b>Zavod quvvati</b><span>${capacity ? `${formatNumber(capacity, 1)} m³/kun` : 'Belgilanmagan'}</span><small>${capacity ? 'Sozlamalardan' : 'Tizim taxmin qilmaydi'}</small></div>
      </div>
      <div class="vsm-flow">${vs.stages.map((s) => vsmStage(s, vs.bottleneck)).join('<span class="vsm-arrow" aria-hidden="true"></span>')}</div>
      <div class="vsm-timeline">
        <div class="vsm-timeline__chart">
          <div class="vsm-timeline__legend"><span class="vsm-dot vsm-dot--wait"></span>Kutish <span class="vsm-dot vsm-dot--work"></span>Ish</div>
          ${vsmTimeline(vs.stages)}
        </div>
        <div class="vsm-totals">
          <div><span>Yetkazish vaqti</span><b>${dur(vs.lead_time_hours)}</b></div>
          <div><span>Ish vaqti</span><b>${dur(vs.work_time_hours)}</b></div>
          <div><span>Kutish</span><b>${dur(vs.wait_time_hours)}</b></div>
          <div class="vsm-totals__eff"><span>Samaradorlik</span><b>${vs.efficiency_pct === null ? '—' : `${formatNumber(vs.efficiency_pct, 1)}%`}</b></div>
        </div>
      </div>
      <p class="vsm-note text-muted">${vs.delivered_orders
        ? `Umumiy vaqtlar ${vs.delivered_orders} ta yetkazilgan buyurtma bo‘yicha.`
        : 'Hali birorta buyurtma oxirigacha yetkazilmagan, shuning uchun umumiy vaqtlar “—”.'} “—” — ma’lumot hali yo‘q degani, 0 emas.</p>
      <div class="admin-grid admin-grid--2 mt-5">
        <div class="vsm-panel vsm-panel--loss">
          <h3>Yo‘qotishlar</h3>
          ${losses.length
            ? `<ul class="vsm-list">${losses.map((s) => `<li>${escapeHtml(ORDER_STATUS[s.status])} bosqichida bekor qilindi: <b>${s.cancelled_here} ta</b></li>`).join('')}</ul>
              <p class="text-muted">Bekor qilingan buyurtmalar hajmi: ${formatNumber(vs.cancelled_volume_m3, 1)} m³</p>`
            : '<p class="text-muted">Bu davrda bekor qilingan buyurtma yo‘q.</p>'}
        </div>
        <div class="vsm-panel vsm-panel--tip">
          <h3>Yaxshilash nuqtalari</h3>
          ${vsmInsights(vs, data)}
        </div>
      </div>
    </div>
  </section>`;
}

export async function render({ root, isCurrent }) {
  root.innerHTML = loadingHtml();
  const data = await http('/admin/dashboard');
  if (!isCurrent()) return;

  const t = data.totals;
  const capacity = data.production_capacity_m3_per_day;
  const capacityHtml = capacity === null || capacity === undefined
    ? stat({
      label: 'Kunlik ishlab chiqarish quvvati',
      value: '<span class="stat__value--muted">Belgilanmagan</span>',
      hint: session.can(PERM.SETTINGS_WRITE) ? '<a href="#/settings">Sozlamalarda kiriting</a>' : 'Tizim taxmin qilmaydi',
    })
    : stat({ label: 'Kunlik ishlab chiqarish quvvati', value: vol(capacity), hint: `Bugun rejada: ${escapeHtml(volume(data.today.volume_m3))}` });

  root.innerHTML = `
    <div class="stats">
      ${stat({ label: 'Jami buyurtmalar', value: t.orders, href: '#/orders' })}
      ${stat({ label: 'Yangi', value: t.new, tone: 'accent', href: '#/orders?status=new', hint: 'Tasdiqlash kutilmoqda' })}
      ${stat({ label: 'Tasdiqlangan', value: t.confirmed, tone: 'info', hint: 'Tasdiqlandi + rejalashtirildi' })}
      ${stat({ label: 'Ishlab chiqarishda', value: t.in_production, tone: 'info', hint: 'Sifat nazorati bilan' })}
      ${stat({ label: 'Yetkazilgan', value: t.delivered, tone: 'success', href: '#/orders?status=delivered' })}
      ${stat({ label: 'Jami buyurtma hajmi', value: vol(t.volume_m3), hint: `Yetkazilgan: ${escapeHtml(volume(t.delivered_volume_m3))}` })}
      ${stat({ label: 'Bugungi yetkazishlar', value: data.today.orders, hint: escapeHtml(volume(data.today.volume_m3)) })}
      ${capacityHtml}
      ${data.callbacks_new ? stat({ label: 'Yangi qo‘ng‘iroq so‘rovlari', value: data.callbacks_new, tone: 'accent', href: '#/customers?tab=callbacks' }) : ''}
    </div>

    ${data.has_data ? `
      <div class="admin-grid admin-grid--main">
        <section class="box">
          <div class="box__head"><h2 class="box__title">Oxirgi 30 kun: buyurtma hajmi (m³)</h2></div>
          <div class="box__body">${dailyChart(data.daily)}</div>
        </section>
        <section class="box">
          <div class="box__head"><h2 class="box__title">Holatlar bo‘yicha</h2></div>
          <div class="box__body">${statusList(data.by_status)}</div>
        </section>
      </div>
      <section class="box mt-5">
        <div class="box__head"><h2 class="box__title">Beton markalari bo‘yicha hajm</h2><span class="text-muted">bekor qilinganlarsiz</span></div>
        <div class="box__body">${data.by_product.length ? productBars(data.by_product) : '<p class="text-muted">Ma’lumot yo‘q.</p>'}</div>
      </section>
      ${valueStream(data.value_stream, data)}`
    : `<div class="box coming-soon coming-soon--wide">
        ${icon('i-dashboard')}
        <h2>Hali buyurtmalar yo‘q</h2>
        <p class="text-muted">Grafik va statistikalar birinchi buyurtma kelgandan keyin paydo bo‘ladi.
          Soxta ma’lumot ko‘rsatilmaydi.</p>
        ${session.can(PERM.CATALOG_MANAGE) ? '<a class="btn btn--primary" href="#/products">Beton markalarini qo‘shish</a>' : ''}
      </div>`}`;
}
