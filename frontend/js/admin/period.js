/**
 * Davr tanlash: orqaga ‹ / oldinga › tugmalari, tayyor davrlar (bugun, kecha, 7 kun, bu oy, o'tgan oy…)
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

/** Bitta kun: ‹ [sana] › [Bugun] */
export function dayBar({ date, allowFuture = false, label = 'Sana', param = 'date' }) {
  const t = todayISO();
  return `<div class="pbar" data-pbar="day" data-param="${param}" data-future="${allowFuture ? 1 : 0}">
    <span class="pbar__label">${escapeHtml(label)}</span>
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-prev aria-label="Oldingi kun" title="Oldingi kun">‹</button>
    <input class="input pbar__date" type="date" value="${escapeHtml(date)}" ${allowFuture ? '' : `max="${t}"`} aria-label="${escapeHtml(label)}">
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-next aria-label="Keyingi kun" title="Keyingi kun" ${!allowFuture && date >= t ? 'disabled' : ''}>›</button>
    ${date !== t ? '<button type="button" class="btn btn--outline btn--sm" data-today>Bugun</button>' : ''}
  </div>`;
}

/** Davr: ‹ [dan] – [gacha] › [tayyor davrlar] */
export function rangeBar({ from, to, allowFuture = false, label = 'Davr' }) {
  const t = todayISO();
  const preset = PRESETS.find(([k]) => { const [a, b] = presetRange(k); return a === from && b === to; });
  return `<div class="pbar" data-pbar="range" data-future="${allowFuture ? 1 : 0}">
    <span class="pbar__label">${escapeHtml(label)}</span>
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-prev aria-label="Oldingi davr" title="Oldingi davr">‹</button>
    <input class="input pbar__date" type="date" value="${escapeHtml(from)}" data-from ${allowFuture ? '' : `max="${t}"`} aria-label="Boshlanish sanasi">
    <span class="pbar__dash">–</span>
    <input class="input pbar__date" type="date" value="${escapeHtml(to)}" data-to ${allowFuture ? '' : `max="${t}"`} aria-label="Tugash sanasi">
    <button type="button" class="btn btn--outline btn--sm pbar__btn" data-next aria-label="Keyingi davr" title="Keyingi davr" ${!allowFuture && to >= t ? 'disabled' : ''}>›</button>
    <select class="select pbar__preset" data-preset aria-label="Tayyor davrlar"><option value="">Tayyor davrlar…</option>${PRESETS.map(([k, l]) => `<option value="${k}" ${preset && preset[0] === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  </div>`;
}

/** Sahifadagi barcha davr panellarini ishga tushiradi. `extra` — davr o'zgarganda qo'shimcha query (masalan page: ''). */
export function bindPeriod(root, extra = { page: '' }) {
  const t = todayISO();
  root.querySelectorAll('.pbar').forEach((bar) => {
    const future = bar.dataset.future === '1';
    const clamp = (iso) => (future || iso <= t ? iso : t);
    if (bar.dataset.pbar === 'day') {
      const param = bar.dataset.param || 'date';
      const input = bar.querySelector('input');
      const go = (iso) => setQuery({ [param]: iso && iso !== t ? clamp(iso) : '', ...extra });
      input.addEventListener('change', () => go(input.value));
      bar.querySelector('[data-prev]').addEventListener('click', () => go(addDays(input.value || t, -1)));
      bar.querySelector('[data-next]').addEventListener('click', () => go(addDays(input.value || t, 1)));
      bar.querySelector('[data-today]')?.addEventListener('click', () => go(''));
      return;
    }
    const fromEl = bar.querySelector('[data-from]');
    const toEl = bar.querySelector('[data-to]');
    const go = (from, to) => {
      if (!from || !to) return;
      if (from > to) [from, to] = [to, from];
      setQuery({ from, to: clamp(to), ...extra });
    };
    fromEl.addEventListener('change', () => go(fromEl.value, toEl.value));
    toEl.addEventListener('change', () => go(fromEl.value, toEl.value));
    bar.querySelector('[data-preset]').addEventListener('change', (e) => {
      if (e.target.value) go(...presetRange(e.target.value));
    });
    const shift = (dir) => {
      const from = fromEl.value;
      const to = toEl.value;
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
  });
}
