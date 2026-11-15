/**
 * Admin panel: kirish, menyu va hash-router (#/orders, #/orders/15, #/customers?tab=callbacks).
 * Har bir bo'lim views/ papkasidagi alohida modul va faqat kerak bo'lganda yuklanadi.
 */
import { escapeHtml, icon, toast } from '../ui.js';
import { login, logout, restoreSession, session, clearSession } from './auth.js';
import { onUnauthorized } from './http.js';
import { PERM, ROLES, errorHtml } from './components.js';

const WH_CATEGORIES = [
  ['cement', 'Sement'], ['sand', 'Qum'], ['gravel', 'Shag‘al'], ['crushed_stone', 'Chaqiqtosh'], ['water', 'Suv'],
  ['additive', 'Kimyoviy qo‘shimchalar'], ['other', 'Boshqa xomashyo'],
];

/**
 * Menyu. `children` bor bo'lsa — ochiladigan bo'lim: sahifa (`route`) o'zi ham ochiladi, ichidagi bo'limlar
 * `route` (hash: #/route) bilan ochiladi. `view` — qaysi modul chizadi (bo'lmasa route nomi), `level: 2` — ichma-ich.
 */
const NAV = [
  { group: 'Asosiy', items: [
    { route: 'dashboard', label: 'Dashboard', icon: 'i-dashboard', perm: PERM.DASHBOARD },
    { route: 'orders', label: 'Buyurtmalar', icon: 'i-box', perm: PERM.ORDERS_READ },
    { route: 'analysis', label: 'Analiz', icon: 'i-chart', perm: PERM.DASHBOARD },
  ] },
  { group: 'Katalog', items: [
    { route: 'products', label: 'Beton markalari', icon: 'i-layers', perm: PERM.ORDERS_READ },
    { route: 'prices', label: 'Narxlar', icon: 'i-calc', perm: PERM.ORDERS_READ },
    { route: 'customers', label: 'Mijozlar', icon: 'i-user', perm: PERM.CUSTOMERS_READ },
  ] },
  { group: 'Operatsiyalar', items: [
    { route: 'transport', label: 'Transport', icon: 'i-truck', perm: PERM.FLEET_READ, children: [
      { route: 'vehicles', label: 'Transport analizi', view: 'transport' },
      { route: 'mixers', label: 'Mikserlar', view: 'fleet-kind', kind: 'mixer' },
      { route: 'pumps', label: 'Beton nasoslari', view: 'fleet-kind', kind: 'pump' },
      { route: 'others', label: 'Yuk avtomobillari', view: 'fleet-kind', kind: 'other' },
      { route: 'cars', label: 'Yengil avtomobillar', view: 'fleet-kind', kind: 'car' },
      { route: 'trips', label: 'Qatnovlar (haydovchi / mashina)', view: 'transport' },
      { route: 'expenses', label: 'Xarajatlar' },
      { route: 'fuel', label: 'Yoqilg‘i hisoboti', view: 'transport' },
      { route: 'drivers', label: 'Haydovchilar' },
      { route: 'fleet-report', label: 'Hisobotlar' },
    ] },
    { route: 'warehouse', label: 'Ombor', icon: 'i-warehouse', perm: PERM.WAREHOUSE_READ, children: [
      { route: 'materials', label: 'Xomashyo', view: 'warehouse' },
      ...WH_CATEGORIES.map(([key, label]) => ({ route: `materials/${key}`, label, view: 'warehouse', level: 2, hidden: true })),
      { route: 'input', label: 'Kirim', view: 'warehouse' },
      { route: 'output', label: 'Chiqim', view: 'warehouse' },
      { route: 'transfers', label: 'Omborlar aro harakat', view: 'warehouse' },
      { route: 'inventory', label: 'Inventarizatsiya', view: 'warehouse' },
      { route: 'suppliers', label: 'Ta’minotchilar', view: 'warehouse' },
      { route: 'history', label: 'Material tarixi', view: 'warehouse' },
      { route: 'wh-report', label: 'Ombor hisobotlari', view: 'warehouse' },
      { route: 'warehouses', label: 'Omborlar', view: 'warehouse' },
    ] },
    { route: 'production-panel', label: 'Ishlab chiqarish', icon: 'i-factory', perm: PERM.PRODUCTION_READ, children: [
      { route: 'production', label: 'Reja va yozuvlar' },
    ] },
    { route: 'lab', label: 'Laboratoriya', icon: 'i-flask', perm: PERM.LAB_READ },
    { route: 'sales', label: 'Sotuv', icon: 'i-calc', perm: PERM.ORDERS_READ, children: [
      { route: 'sales-overview', label: 'Ishlab chiqarish → sotuv', view: 'sales' },
      { route: 'kpi-sales', label: 'Sotuvchilar hisoboti', view: 'kpi', perm: PERM.KPI_MANAGE },
    ] },
    { route: 'projects', label: 'Loyihalar va galereya', icon: 'i-image', perm: PERM.PROJECTS_MANAGE },
  ] },
  { group: 'Tizim', items: [
    { route: 'telegram', label: 'Telegram sozlamalari', icon: 'i-telegram', perm: PERM.SETTINGS_READ },
    { route: 'inbox', label: 'Guruhlar va Sheets', icon: 'i-chat', perm: PERM.SETTINGS_WRITE },
    { route: 'users', label: 'Foydalanuvchilar', icon: 'i-shield', perm: PERM.USERS_MANAGE },
    { route: 'settings', label: 'Tizim sozlamalari', icon: 'i-settings', perm: PERM.SETTINGS_READ },
  ] },
];

/** Barcha marshrutlar (bosh bo'lim ham, ichidagilar ham): ichidagilar ota-onaning ruxsatini oladi */
const ROUTES = {};
NAV.flatMap((g) => g.items).forEach((item) => {
  ROUTES[item.route] = { ...item, parent: null };
  (item.children || []).forEach((child) => {
    ROUTES[child.route] = { icon: item.icon, perm: item.perm, ...child, parent: item.route };
  });
});

const VIEWS = {
  dashboard: () => import('./views/dashboard.js'),
  orders: () => import('./views/orders.js'),
  products: () => import('./views/products.js'),
  prices: () => import('./views/prices.js'),
  customers: () => import('./views/customers.js'),
  users: () => import('./views/users.js'),
  settings: () => import('./views/settings.js'),
  vehicles: () => import('./views/vehicles.js'),
  transport: () => import('./views/transport.js'),
  'fleet-kind': () => import('./views/fleet-kind.js'),
  expenses: () => import('./views/transport.js'),
  'fleet-report': () => import('./views/transport.js'),
  drivers: () => import('./views/drivers.js'),
  warehouse: () => import('./views/warehouse.js'),
  'production-panel': () => import('./views/production-panel.js'),
  production: () => import('./views/production.js'),
  lab: () => import('./views/lab.js'),
  kpi: () => import('./views/kpi.js'),
  sales: () => import('./views/sales.js'),
  analysis: () => import('./views/analysis.js'),
  projects: () => import('./views/projects.js'),
  telegram: () => import('./views/telegram.js'),
  inbox: () => import('./views/inbox.js'),
};

const el = {
  boot: document.getElementById('bootView'),
  login: document.getElementById('loginView'),
  app: document.getElementById('appView'),
  loginForm: document.getElementById('loginForm'),
  loginError: document.getElementById('loginError'),
  nav: document.getElementById('adminNav'),
  subnav: document.getElementById('adminSubnav'),
  view: document.getElementById('view'),
  title: document.getElementById('pageTitle'),
  tools: document.getElementById('pageTools'),
  userName: document.getElementById('userName'),
  userRole: document.getElementById('userRole'),
  logout: document.getElementById('logoutBtn'),
  toggle: document.getElementById('sidebarToggle'),
  backdrop: document.getElementById('sidebarBackdrop'),
};

let renderToken = 0;

/**
 * Sahifadagi filtr va tugmalar paneli (.page-actions, .kind-head__actions) sarlavha qatoriga ko'tariladi.
 * Hodisa tinglovchilari ko'chirilganda saqlanadi; bo'lim qayta chizilsa, yangi panel eskisining o'rniga qo'yiladi.
 */
const TOOL_SELECTOR = ':scope .page-actions, :scope .kind-head__actions';
const nativeAll = Element.prototype.querySelectorAll;
const nativeOne = Element.prototype.querySelector;
function hoistTools() {
  const found = [...nativeAll.call(el.view, TOOL_SELECTOR)].filter((n) => !n.closest('.modal, dialog'));
  if (found.length) el.tools.replaceChildren(...found);
}
new MutationObserver(hoistTools).observe(el.view, { childList: true, subtree: true });
// Bo'limlar tugmalarni `root.querySelector(...)` bilan topadi: ko'tarilgan panel ham shu qidiruvga kiradi
el.view.querySelector = function viewQuery(selector) {
  return nativeOne.call(this, selector) || nativeOne.call(el.tools, selector);
};
el.view.querySelectorAll = function viewQueryAll(selector) {
  return [...nativeAll.call(this, selector), ...nativeAll.call(el.tools, selector)];
};

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

function navLink(item) {
  return `<a class="admin-nav__link${item.level === 2 ? ' admin-nav__link--sub2' : ''}" href="#/${item.route}" data-route="${item.route}">
      ${item.icon ? icon(item.icon) : ''}<span>${escapeHtml(item.label)}</span>
    </a>`;
}

function renderNav() {
  el.nav.innerHTML = NAV.map((group) => {
    const items = group.items.filter((item) => session.can(item.perm));
    if (!items.length) return '';
    return `<div class="admin-nav__group">${escapeHtml(group.group)}</div>${items.map((item) => navLink({ ...item, children: null })).join('')}`;
  }).join('');
}

/** 1C kabi: tanlangan bo'limning sahifalari yon menyuda emas, uning o'ng tomonidagi panelda ochiladi */
function renderSubnav(routeName) {
  const parent = ROUTES[routeName]?.parent || routeName;
  const section = ROUTES[parent];
  const children = (section?.children || []).filter((c) => !c.hidden && c.level !== 2 && session.can(c.perm || section.perm));
  el.subnav.hidden = children.length === 0;
  document.body.classList.toggle('has-subnav', children.length > 0);
  if (!children.length) {
    el.subnav.innerHTML = '';
    return;
  }
  el.subnav.innerHTML = `<div class="admin-subnav__title">${escapeHtml(section.label)}</div>${children.map((c) => {
    const active = c.route === routeName || (c.route === 'materials' && routeName.startsWith('materials/'));
    return `<a class="admin-subnav__link${active ? ' is-active' : ''}" href="#/${c.route}"${active ? ' aria-current="page"' : ''}>${escapeHtml(c.label)}</a>`;
  }).join('')}`;
}

function markNav(routeName) {
  const parent = ROUTES[routeName]?.parent || routeName;
  el.nav.querySelectorAll('[data-route]').forEach((link) => {
    const active = link.dataset.route === parent;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  renderSubnav(routeName);
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
  const pair = parts.length > 1 ? `${parts[0]}/${parts[1]}` : '';
  const name = pair && ROUTES[pair] ? pair : (parts[0] || 'dashboard');
  const meta = ROUTES[name];

  setSidebar(false);

  if (!meta) {
    navigate('dashboard', { replace: true });
    return;
  }
  if (!session.can(meta.perm)) {
    markNav(name);
    el.title.textContent = meta.label;
    el.view.innerHTML = `<div class="box coming-soon">${icon('i-shield')}<h2>Ruxsat yo‘q</h2>
      <p class="text-muted">Bu bo‘limni ko‘rish uchun huquqingiz yetarli emas. Administratorga murojaat qiling.</p></div>`;
    return;
  }

  markNav(name);
  el.tools.replaceChildren();
  el.title.textContent = meta.label;
  document.title = `${meta.label} — Admin — BETON INDUSTRY`;

  try {
    const module = await VIEWS[meta.view || name]();
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
