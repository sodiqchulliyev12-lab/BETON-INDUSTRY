/**
 * Barcha sahifalarda ishlaydigan umumiy skript:
 *  - header (scroll soyasi, mobil menyu)
 *  - joriy sahifani menyuda belgilash
 *  - kompaniya ma'lumotlarini (telefon, manzil...) admin sozlamalaridan to'ldirish
 *  - paydo bo'lish animatsiyasi
 */
import { api } from './api.js';

/* ==========================================================================
   Header va mobil menyu
   ========================================================================== */

function initHeader() {
  const header = document.querySelector('.site-header');
  const burger = document.querySelector('.burger');
  const nav = document.getElementById('mainNav');
  if (!header) return;

  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  if (!burger || !nav) return;

  const setOpen = (open) => {
    document.body.classList.toggle('nav-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Menyuni yopish' : 'Menyuni ochish');
  };

  burger.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
      setOpen(false);
      burger.focus();
    }
  });

  window.matchMedia('(min-width: 1201px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}

function markActiveNav() {
  const page = document.body.dataset.page;
  if (!page) return;
  document.querySelectorAll(`[data-nav="${page}"]`).forEach((link) => {
    link.classList.add('is-active');
    link.setAttribute('aria-current', 'page');
  });
}

/* ==========================================================================
   Kompaniya sozlamalarini sahifaga bog'lash
   --------------------------------------------------------------------------
   <a data-setting="company.phone" data-setting-href="tel" hidden>...</a>
     → qiymat bo'lsa ko'rinadi, bo'lmasa yashirin qoladi
   <span data-setting="company.address" data-setting-empty="Kiritilmagan">...</span>
     → qiymat bo'lmasa "Kiritilmagan" yoziladi
   <div data-setting-show="company.phone" hidden>...</div>
     → faqat qiymat bo'lsa ko'rinadi
   ========================================================================== */

function hasValue(settings, key) {
  const value = settings ? settings[key] : undefined;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function buildHref(type, value) {
  const text = String(value).trim();
  switch (type) {
    case 'tel':
      return `tel:${text.replace(/[^\d+]/g, '')}`;
    case 'mailto':
      return `mailto:${text}`;
    case 'telegram':
      return /^https:\/\/t\.me\//.test(text) ? text : `https://t.me/${text.replace(/^@/, '').replace(/[^\w]/g, '')}`;
    case 'instagram':
      return /^https:\/\/(www\.)?instagram\.com\//.test(text)
        ? text
        : `https://instagram.com/${text.replace(/^@/, '').replace(/[^\w.]/g, '')}`;
    default:
      return /^https?:\/\//.test(text) ? text : '';
  }
}

let cachedSettings = null;

// JS orqali keyin chizilgan bloklar (mahsulot kartalari, hisob-kitob) 'site:rendered' hodisasini yuboradi —
// sozlamalar (telefon) ularga qayta qo'llanadi. Import emas, hodisa: brauzer keshida eski main.js qolsa ham
// sahifa buzilmaydi.
document.addEventListener('site:rendered', () => {
  if (cachedSettings) applySettings(cachedSettings);
});

export function applySettings(settings) {
  cachedSettings = settings;
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const key = el.dataset.setting;
    const target = el.querySelector('[data-setting-value]') || el;

    if (hasValue(settings, key)) {
      const value = String(settings[key]).trim();
      target.textContent = value;
      el.classList.remove('is-empty');
      el.hidden = false;
      if (el.dataset.settingHref && el.tagName === 'A') {
        const href = buildHref(el.dataset.settingHref, value);
        if (href) el.href = href;
        if (/^https?:/.test(href)) {
          el.target = '_blank';
          el.rel = 'noopener noreferrer';
        }
      }
    } else if (el.hasAttribute('data-setting-empty')) {
      target.textContent = el.dataset.settingEmpty || 'Kiritilmagan';
      el.classList.add('is-empty');
      el.hidden = false;
      if (el.tagName === 'A') el.removeAttribute('href');
    } else {
      el.hidden = true;
    }
  });

  // <a data-setting-tel="company.phone"> — telefon bo'lsa tel: havola bo'lib ko'rinadi, ichidagi
  // [data-setting-value] raqam bilan to'ldiriladi; telefon kiritilmagan bo'lsa yashirin qoladi
  document.querySelectorAll('[data-setting-tel]').forEach((el) => {
    const key = el.dataset.settingTel;
    if (!hasValue(settings, key)) {
      el.hidden = true;
      return;
    }
    const value = String(settings[key]).trim();
    el.href = buildHref('tel', value);
    el.querySelectorAll('[data-setting-value]').forEach((t) => { t.textContent = value; });
    el.hidden = false;
  });

  document.querySelectorAll('[data-setting-show]').forEach((el) => {
    el.hidden = !hasValue(settings, el.dataset.settingShow);
  });

  document.querySelectorAll('[data-setting-hide]').forEach((el) => {
    el.hidden = hasValue(settings, el.dataset.settingHide);
  });
}

async function loadSettings() {
  try {
    applySettings(await api.getSettings());
  } catch {
    // Backend mavjud bo'lmasa — barcha maydonlar "Kiritilmagan" holatida qoladi
    applySettings({});
  }
}

/* ==========================================================================
   Paydo bo'lish animatsiyasi
   Faqat ekrandan pastda turgan elementlar yashiriladi — kontent "miltillamaydi".
   ========================================================================== */

function initReveal() {
  const items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('reveal-in');
        entry.target.classList.remove('reveal-pending');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  const viewportBottom = window.innerHeight;
  items.forEach((el) => {
    if (el.getBoundingClientRect().top > viewportBottom) {
      el.classList.add('reveal-pending');
      observer.observe(el);
    }
  });
}

function setYear() {
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
}

initHeader();
markActiveNav();
setYear();
initReveal();
loadSettings();
