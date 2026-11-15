/**
 * Kichik SVG grafiklar (tashqi kutubxonasiz). CSP inline style'ni bloklagani uchun rang va o'lcham
 * faqat SVG atributlari va CSS sinflari (.c0–.c7) orqali beriladi.
 */
import { formatNumber } from '../ui.js';
import { escapeHtml } from './components.js';

const fmt = (v, d = 1) => formatNumber(v, d);

function niceMax(max) {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  const n = max / step;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * step;
}

/**
 * Guruhlangan ustunlar (masalan reja va haqiqat).
 * series: [{key, label, cls}]; rows: [{label, <key>: number}]
 */
export function groupedBars(rows, series, { unit = '', height = 220, labelEvery = 2 } = {}) {
  const W = 720;
  const pad = { top: 10, right: 8, bottom: 26, left: 44 };
  const innerW = W - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...rows.flatMap((r) => series.map((s) => r[s.key] || 0)), 0));
  const slot = innerW / Math.max(rows.length, 1);
  const barW = Math.max(2, (slot * 0.72) / series.length);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const y = pad.top + innerH * (1 - t);
    return `<line class="grid-line" x1="${pad.left}" x2="${W - pad.right}" y1="${y}" y2="${y}"/>
      <text x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${fmt(max * t, 0)}</text>`;
  }).join('');
  const bars = rows.map((r, i) => series.map((s, j) => {
    const v = r[s.key] || 0;
    const h = (v / max) * innerH;
    const x = pad.left + i * slot + (slot - barW * series.length) / 2 + j * barW;
    return `<rect class="gbar ${s.cls}" x="${x.toFixed(1)}" y="${(pad.top + innerH - h).toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${Math.max(h, v > 0 ? 2 : 0).toFixed(1)}" rx="2"><title>${escapeHtml(`${r.label}: ${s.label} ${fmt(v, 1)} ${unit}`)}</title></rect>`;
  }).join('')).join('');
  const labels = rows.map((r, i) => (i % labelEvery === 0 || i === rows.length - 1
    ? `<text x="${(pad.left + i * slot + slot / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${escapeHtml(r.label)}</text>` : '')).join('');
  const legend = series.map((s) => `<span class="legend__item"><i class="legend__dot ${s.cls}"></i>${escapeHtml(s.label)}</span>`).join('');
  return `<div class="legend">${legend}</div>
    <svg class="chart" viewBox="0 0 ${W} ${height}" role="img" aria-label="${escapeHtml(series.map((s) => s.label).join(' va '))}, ${escapeHtml(unit)}">${grid}${bars}${labels}</svg>`;
}

/** Aylana diagramma: items [{label, value}] */
export function donut(items, { unit = '', center = '' } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) return '<p class="muted">Ma’lumot yo‘q.</p>';
  let acc = 0;
  const segs = items.map((it, i) => {
    const pct = (it.value / total) * 100;
    const seg = `<circle class="donut__seg c${i % 8}" cx="21" cy="21" r="15.9155" pathLength="100" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}"><title>${escapeHtml(`${it.label}: ${fmt(it.value, 1)} ${unit} (${fmt(pct, 1)}%)`)}</title></circle>`;
    acc += pct;
    return seg;
  }).join('');
  const legend = items.map((it, i) => `<li><i class="legend__dot c${i % 8}"></i><span>${escapeHtml(it.label)}</span><strong>${fmt((it.value / total) * 100, 1)}%</strong></li>`).join('');
  return `<div class="donut">
    <svg viewBox="0 0 42 42" class="donut__svg" role="img" aria-label="Ulushlar"><circle class="donut__bg" cx="21" cy="21" r="15.9155"/>${segs}
      ${center ? `<text x="21" y="22.5" text-anchor="middle" class="donut__center">${escapeHtml(center)}</text>` : ''}</svg>
    <ul class="donut__legend">${legend}</ul></div>`;
}

/** Yarim doira ko'rsatkich (0–100%). tone: ok | warn | bad | none */
export function gauge(pct, { label = '', tone = '' } = {}) {
  const has = pct !== null && pct !== undefined;
  const v = has ? Math.min(100, Math.max(0, pct)) : 0;
  const cls = tone || (!has ? 'none' : pct >= 90 ? 'ok' : pct >= 70 ? 'warn' : 'bad');
  return `<div class="gauge gauge--${cls}">
    <svg viewBox="0 0 100 58" role="img" aria-label="${escapeHtml(label)}">
      <path class="gauge__track" d="M10 52 A40 40 0 0 1 90 52" pathLength="100"/>
      <path class="gauge__fill" d="M10 52 A40 40 0 0 1 90 52" pathLength="100" stroke-dasharray="${v.toFixed(1)} 100"/>
    </svg>
    <strong class="gauge__value">${has ? `${fmt(pct, 1)}%` : '—'}</strong>
    <span class="gauge__label">${escapeHtml(label)}</span></div>`;
}

/** Kichik chiziqli grafik (kartochka ichida) */
export function sparkline(values, { cls = 'spark' } = {}) {
  const w = 120;
  const h = 32;
  if (!values.length || Math.max(...values) <= 0) return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${h - 2}" y2="${h - 2}" class="spark__base"/></svg>`;
  const max = Math.max(...values);
  const step = w / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none"/></svg>`;
}

/** Gorizontal ulush chizig'i: value/max */
export function meter(value, max, { cls = '' } = {}) {
  const w = max > 0 ? Math.min(100, Math.max((value / max) * 100, value > 0 ? 1.5 : 0)) : 0;
  return `<svg class="meter ${cls}" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="meter__bg" width="100" height="8" rx="4"/><rect class="meter__fill" width="${w.toFixed(1)}" height="8" rx="4"/></svg>`;
}

/** Vertikal quvvat ko'rsatkichi (silos/ombor to'ldirilishi) */
export function tank(pct, { label = '', note = '' } = {}) {
  const has = pct !== null && pct !== undefined;
  const v = has ? Math.min(100, Math.max(0, pct)) : 0;
  const y = 44 - (v / 100) * 40;
  return `<div class="tank"><svg viewBox="0 0 30 48" aria-hidden="true"><rect class="tank__shell" x="3" y="3" width="24" height="42" rx="4"/>
      <rect class="tank__fill" x="4" y="${y.toFixed(1)}" width="22" height="${(44 - y).toFixed(1)}" rx="3"/></svg>
    <strong>${has ? `${fmt(pct, 0)}%` : '—'}</strong><span>${escapeHtml(label)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}
