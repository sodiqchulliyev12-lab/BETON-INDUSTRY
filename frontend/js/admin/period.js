/**
 * Davr tanlash: orqaga ‹ / oldinga › tugmalari, YIL va OY tanlash, tayyor davrlar (bugun, kecha, 7 kun, bu oy…)
 * va qo'lda sana tanlash. Holat URL (hash) query'sida saqlanadi: ?date=… yoki ?from=…&to=…
 * Boshqa filtrlar (ombor, marka, haydovchi…) davr o'zgarganda saqlanib qoladi.
 */
import { setQuery } from './app.js';
import { escapeHtml } from './components.js';
import { todayISO } from '../validators.js';

const DAY = 864e5;
const parse = (iso) => new Date(`${iso}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => fmt(new Date(parse(iso).getTime() + n * DAY));
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
export const monthEnd = (iso) => {
  const d = parse(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return fmt(new Date(d.getTime() - DAY));
};
const addMonths = (iso, n) => {
  const d = parse(monthStart(iso));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fmt(d);
};
const spanDays = (from, to) => Math.round((parse(to) - parse(from)) / DAY) + 1;
const pad2 = (n) => String(n).padStart(2, '0');

const PRESETS = [
  ['today', 'Bugun'], ['yesterday', 'Kecha'], ['7d', 'Oxirgi 7 kun'], ['30d', 'Oxirgi 30 kun'], ['month', 'Bu oy'],
  ['prev-month', 'O‘tgan oy'], ['90d', 'Oxirgi 90 kun'], ['year', 'Bu yil'],
];

function presetRange(key) {
  const t = todayISO();
  switch (key) {
    case 'today': return [t, t];
    case 'yesterday': return [addDays(t, -1), addDays(t, -1)];
    case '7d': return [addDays(t, -6), t];
    case '30d': return [addDays(t, -29), t];
    case '90d': return [addDays(t, -89), t];
    case 'month': return [monthStart(t), t];
    case 'prev-month': { const p = addMonths(t, -1); return [p, monthEnd(p)]; }
    case 'year': return [`${t.slice(0, 4)}-01-01`, t];
    default: return [monthStart(t), t];
  }
}

/** Davrni URL'dan o'qiydi: berilmasa — joriy oyning boshidan bugungacha */
export function periodFromQuery(query, defaults = {}) {
  const t = todayISO();
  const from = query.get('from') || defaults.from || monthStart(t);
  const to = query.get('to') || defaults.to || t;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Bitta kun: ‹ [sana] › */
export function dayBar({ date, allowFuture = false, label = 'Sana', param = 'date' }) {
  const t = todayISO();
  return `<div class="pbar" data-pbar="day" data-param="${param}" data-future="${allowFuture ? 1 : 0}">
    <span class="pbar__label">${escapeHtml(label)}</span>
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-prev aria-label="Oldingi kun" title="Oldingi kun">‹</button>
    <input class="input pbar__date" type="date" value="${escapeHtml(date)}" ${allowFuture ? '' : `max="${t}"`} aria-label="${escapeHtml(label)}">
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-next aria-label="Keyingi kun" title="Keyingi kun" ${!allowFuture && date >= t ? 'disabled' : ''}>›</button>
  </div>`;
}

/** Davr: ‹ [dan] – [gacha] ›. fromParam/toParam — URL nomlari; empty — bo'sh davr ruxsat */
export function rangeBar({ from, to, allowFuture = false, label = 'Davr', fromParam = 'from', toParam = 'to' }) {
  const t = todayISO();
  return `<div class="pbar" data-pbar="range" data-future="${allowFuture ? 1 : 0}" data-fp="${fromParam}" data-tp="${toParam}">
    <span class="pbar__label">${escapeHtml(label)}</span>
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-prev aria-label="Oldingi davr" title="Oldingi davr">‹</button>
    <input class="input pbar__date" type="date" value="${escapeHtml(from || '')}" data-from ${allowFuture ? '' : `max="${t}"`} aria-label="Boshlanish sanasi">
    <span class="pbar__dash">–</span>
    <input class="input pbar__date" type="date" value="${escapeHtml(to || '')}" data-to ${allowFuture ? '' : `max="${t}"`} aria-label="Tugash sanasi">
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-next aria-label="Keyingi davr" title="Keyingi davr" ${!allowFuture && to && to >= t ? 'disabled' : ''}>›</button>
  </div>`;
}

/** Sahifadagi barcha davr panellarini ishga tushiradi. `extra` — davr o'zgarganda qo'shimcha query (masalan page: ''). */
export function bindPeriod(root, extra = { page: '' }) {
  const t = todayISO();
  root.querySelectorAll('.pbar').forEach((bar) => {
    const future = bar.dataset.future === '1';
    const clamp = (iso) => (future || iso <= t ? iso : t);
    const yearEl = bar.querySelector('[data-year]');
    const monthEl = bar.querySelector('[data-month]');

    if (bar.dataset.pbar === 'day') {
      const param = bar.dataset.param || 'date';
      const input = bar.querySelector('input');
      const go = (iso) => setQuery({ [param]: iso && iso !== t ? clamp(iso) : '', ...extra });
      input.addEventListener('change', () => go(input.value));
      bar.querySelector('[data-prev]').addEventListener('click', () => go(addDays(input.value || t, -1)));
      bar.querySelector('[data-next]').addEventListener('click', () => go(addDays(input.value || t, 1)));
      bar.querySelector('[data-today]')?.addEventListener('click', () => go(''));
      const ym = () => {
        if (!yearEl || !monthEl) return;
        const base = input.value || t;
        const y = yearEl.value || base.slice(0, 4);
        const m = monthEl.value && monthEl.value !== 'all' ? monthEl.value : String(Number(base.slice(5, 7)));
        const last = Number(monthEnd(`${y}-${pad2(m)}-01`).slice(8));
        go(`${y}-${pad2(m)}-${pad2(Math.min(Number(base.slice(8, 10)), last))}`);
      };
      yearEl?.addEventListener('change', ym);
      monthEl?.addEventListener('change', ym);
      return;
    }

    const fp = bar.dataset.fp || 'from';
    const tp = bar.dataset.tp || 'to';
    const fromEl = bar.querySelector('[data-from]');
    const toEl = bar.querySelector('[data-to]');
    const go = (from, to) => {
      if (!from || !to) return;
      if (from > to) [from, to] = [to, from];
      setQuery({ [fp]: from, [tp]: clamp(to), ...extra });
    };
    fromEl.addEventListener('change', () => go(fromEl.value, toEl.value));
    toEl.addEventListener('change', () => go(fromEl.value, toEl.value));
    bar.querySelector('[data-preset]')?.addEventListener('change', (e) => {
      if (e.target.value) go(...presetRange(e.target.value));
    });
    const shift = (dir) => {
      const from = fromEl.value || monthStart(t);
      const to = toEl.value || t;
      const wholeMonth = from === monthStart(from) && (to === monthEnd(from) || (to === t && monthStart(t) === from));
      if (wholeMonth) {
        const nf = addMonths(from, dir);
        go(nf, monthEnd(nf));
      } else {
        const n = spanDays(from, to) * dir;
        go(addDays(from, n), addDays(to, n));
      }
    };
    bar.querySelector('[data-prev]').addEventListener('click', () => shift(-1));
    bar.querySelector('[data-next]').addEventListener('click', () => shift(1));
    // yil / oy: oy tanlanmasa yoki «Butun yil» bo'lsa — butun yil
    const ym = () => {
      if (!yearEl || !monthEl) return;
      const y = yearEl.value || (fromEl.value || t).slice(0, 4);
      const m = monthEl.value;
      if (!m || m === 'all') {
        go(`${y}-01-01`, `${y}-12-31`);
      } else {
        const s = `${y}-${pad2(m)}-01`;
        go(s, monthEnd(s));
      }
    };
    yearEl?.addEventListener('change', ym);
    monthEl?.addEventListener('change', ym);
  });
}
