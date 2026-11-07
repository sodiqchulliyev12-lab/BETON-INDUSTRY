/**
 * Admin panel: kirish, menyu va hash-router (#/orders, #/orders/15, #/customers?tab=callbacks).
 * Har bir bo'lim views/ papkasidagi alohida modul va faqat kerak bo'lganda yuklanadi.
 */
import { escapeHtml, icon, toast } from '../ui.js';
import { login, logout, restoreSession, session, clearSession } from './auth.js';
import { onUnauthorized } from './http.js';
import { PERM, ROLES, errorHtml } from './components.js';

const NAV = [
  { group: 'Asosiy', items: [
    { route: 'dashboard', label: 'Dashboard', icon: 'i-dashboard', perm: PERM.DASHBOARD },
    { route: 'orders', label: 'Buyurtmalar', icon: 'i-box', perm: PERM.ORDERS_READ },
  ] },
  { group: 'Katalog', items: [
    { route: 'products', label: 'Beton markalari', icon: 'i-layers', perm: PERM.ORDERS_READ },
    { route: 'prices', label: 'Narxlar', icon: 'i-calc', perm: PERM.ORDERS_READ },
    { route: 'customers', label: 'Mijozlar', icon: 'i-user', perm: PERM.CUSTOMERS_READ },
  ] },
  { group: 'Operatsiyalar', items: [
    { route: 'vehicles', label: 'Transport', icon: 'i-truck', perm: PERM.FLEET_READ },
    { route: 'drivers', label: 'Haydovchilar', icon: 'i-user', perm: PERM.FLEET_READ },
    { route: 'production', label: 'Ishlab chiqarish', icon: 'i-factory', perm: PERM.PRODUCTION_READ },
    { route: 'projects', label: 'Loyihalar va galereya', icon: 'i-image', perm: PERM.PROJECTS_MANAGE },
  ] },
  { group: 'Tizim', items: [
    { route: 'telegram', label: 'Telegram sozlamalari', icon: 'i-telegram', perm: PERM.SETTINGS_READ },
    { route: 'users', label: 'Foydalanuvchilar', icon: 'i-shield', perm: PERM.USERS_MANAGE },
    { route: 'settings', label: 'Tizim sozlamalari', icon: 'i-settings', perm: PERM.SETTINGS_READ },
  ] },
];

const ROUTES = Object.fromEntries(NAV.flatMap((g) => g.items).map((item) => [item.route, item]));

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  orders: () => import('./views/orders.js'),
  products: () => import('./views/products.js'),
  prices: () => import('./views/prices.js'),
  customers: () => import('./views/customers.js'),
  users: () => import('./views/users.js'),
  settings: () => import('./views/settings.js'),
  vehicles: () => import('./views/vehicles.js'),
  drivers: () => import('./views/drivers.js'),
  production: () => import('./views/production.js'),
  projects: () => import('./views/projects.js'),
  telegram: () => import('./views/telegram.js'),
  soon: () => import('./views/soon.js'),
};

const el = {
  boot: document.getElementById('bootView'),
  login: document.getElementById('loginView'),
  app: document.getElementById('appView'),
  loginForm: document.getElementById('loginForm'),
  loginError: document.getElementById('loginError'),
  nav: document.getElementById('adminNav'),
  view: document.getElementById('view'),
  title: document.getElementById('pageTitle'),
  userName: document.getElementById('userName'),
  userRole: document.getElementById('userRole'),
  logout: document.getElementById('logoutBtn'),
  toggle: document.getElementById('sidebarToggle'),
  backdrop: document.getElementById('sidebarBackdrop'),
};

let renderToken = 0;

/* ==========================================================================
   Ekranlar
   ========================================================================== */

function showScreen(name) {
  el.boot.hidden = name !== 'boot';
  el.login.hidden = name !== 'login';
  el.app.hidden = name !== 'app';
}

function showLogin(message = '') {
  showScreen('login');
  el.loginError.hidden = !message;
  el.loginError.textContent = message;
  setTimeout(() => el.loginForm.elements.username.focus(), 30);
}

function startApp() {
  const user = session.user;
  el.userName.textContent = user.full_name;
  el.userRole.textContent = ROLES[user.role] || user.role;
  renderNav();
  showScreen('app');
  if (!location.hash || location.hash === '#' || location.hash === '#/') location.replace('#/dashboard');
  else route();
}

/* ==========================================================================
   Menyu
   ========================================================================== */

function renderNav() {
  el.nav.innerHTML = NAV.map((group) => {
    const items = group.items.filter((item) => item.soon || session.can(item.perm));
    if (!items.length) return '';
    return `<div class="admin-nav__group">${escapeHtml(group.group)}</div>${items
      .map((item) => `<a class="admin-nav__link${item.soon ? ' is-soon' : ''}" href="#/${item.route}" data-route="${item.route}">
          ${icon(item.icon)}<span>${escapeHtml(item.label)}</span>
          ${item.soon ? `<span class="admin-nav__soon" title="${item.soon}-bosqichda qo‘shiladi">${item.soon}-bosqich</span>` : ''}
        </a>`)
      .join('')}`;
  }).join('');
}

function markNav(routeName) {
  el.nav.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === routeName;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function setSidebar(open) {
  document.body.classList.toggle('sidebar-open', open);
  el.toggle.setAttribute('aria-expanded', String(open));
}

/* ==========================================================================
   Router
   ========================================================================== */

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(search) };
}

export function navigate(path, { replace = false } = {}) {
  const hash = `#/${path.replace(/^\/?#?\/?/, '')}`;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

/** Joriy sahifaning query parametrlarini yangilash (filtrlar) */
export function setQuery(params) {
  const { parts, query } = parseHash();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') query.delete(key);
    else query.set(key, String(value));
  });
  const search = query.toString();
  location.hash = `#/${parts.join('/')}${search ? `?${search}` : ''}`;
}

async function route() {
  if (!session.user) return;
  const token = ++renderToken;
  const { parts, query } = parseHash();
  const name = parts[0] || 'dashboard';
  const meta = ROUTES[name];

  setSidebar(false);

  if (!meta) {
    navigate('dashboard', { replace: true });
    return;
  }
  if (!meta.soon && !session.can(meta.perm)) {
    markNav(name);
    el.title.textContent = meta.label;
    el.view.innerHTML = `<div class="box coming-soon">${icon('i-shield')}<h2>Ruxsat yo‘q</h2>
      <p class="text-muted">Bu bo‘limni ko‘rish uchun huquqingiz yetarli emas. Administratorga murojaat qiling.</p></div>`;
    return;
  }

  markNav(name);
  el.title.textContent = meta.label;
  document.title = `${meta.label} — Admin — BETON INDUSTRY`;

  try {
    const module = await VIEWS[meta.soon ? 'soon' : name]();
    if (token !== renderToken) return; // foydalanuvchi boshqa sahifaga o'tib ketgan
    el.view.innerHTML = '';
    await module.render({
      root: el.view,
      parts,
      query,
      meta,
      isCurrent: () => token === renderToken,
      setTitle: (text) => {
        el.title.textContent = text;
      },
    });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    el.view.innerHTML = errorHtml(err);
    el.view.querySelector('[data-retry]')?.addEventListener('click', route);
  }
}

/* ==========================================================================
   Hodisalar
   ========================================================================== */

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;
  if (!username || !password) {
    showLogin('Login va parolni kiriting.');
    return;
  }
  const button = form.querySelector('[type="submit"]');
  button.classList.add('is-loading');
  button.disabled = true;
  try {
    await login(username, password);
    form.reset();
    el.loginError.hidden = true;
    startApp();
  } catch (err) {
    showLogin(err.message || 'Kirib bo‘lmadi.');
    form.elements.password.select();
  } finally {
    button.classList.remove('is-loading');
    button.disabled = false;
  }
});

el.logout.addEventListener('click', async () => {
  await logout();
  el.view.innerHTML = '';
  showLogin();
});

el.toggle.addEventListener('click', () => setSidebar(!document.body.classList.contains('sidebar-open')));
el.backdrop.addEventListener('click', () => setSidebar(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) setSidebar(false);
});

window.addEventListener('hashchange', route);

onUnauthorized(() => {
  if (!session.user) return;
  clearSession();
  el.view.innerHTML = '';
  showLogin('Sessiya tugadi. Qaytadan kiring.');
  toast('Sessiya tugadi. Qaytadan kiring.', 'warning');
});

/* ==========================================================================
   Boshlash
   ========================================================================== */

(async function boot() {
  showScreen('boot');
  const user = await restoreSession();
  if (user) startApp();
  else showLogin();
})();
