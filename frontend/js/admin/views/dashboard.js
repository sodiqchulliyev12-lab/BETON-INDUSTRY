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
      </section>`
    : `<div class="box coming-soon coming-soon--wide">
        ${icon('i-dashboard')}
        <h2>Hali buyurtmalar yo‘q</h2>
        <p class="text-muted">Grafik va statistikalar birinchi buyurtma kelgandan keyin paydo bo‘ladi.
          Soxta ma’lumot ko‘rsatilmaydi.</p>
        ${session.can(PERM.CATALOG_MANAGE) ? '<a class="btn btn--primary" href="#/products">Beton markalarini qo‘shish</a>' : ''}
      </div>`}`;
}
