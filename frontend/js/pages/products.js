/**
 * Mahsulotlar katalogi: qidiruv va "faqat mavjudlar" filtri.
 */
import { api } from '../api.js';
import { debounce, renderSkeletons, renderState, errorStateFor } from '../ui.js';
import { isOrderable, renderProductCard } from '../product-card.js';

const grid = document.getElementById('productsGrid');
const searchInput = document.getElementById('productSearch');
const onlyAvailable = document.getElementById('onlyAvailable');
const countEl = document.getElementById('productCount');
const demoNotice = document.getElementById('demoNotice');

let products = [];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[‘’ʻʼ`']/g, "'").trim();
}

function render() {
  const query = normalize(searchInput.value);
  const filtered = products.filter((p) => {
    if (onlyAvailable.checked && !isOrderable(p)) return false;
    if (!query) return true;
    return normalize(`${p.grade_class} ${p.name} ${p.description}`).includes(query);
  });

  countEl.textContent = products.length ? `${filtered.length} / ${products.length} ta marka` : '';

  if (!filtered.length) {
    renderState(grid, {
      type: 'empty',
      title: 'Hech narsa topilmadi',
      text: 'Qidiruv so‘zini o‘zgartiring yoki filtrni o‘chiring.',
    });
    return;
  }

  grid.innerHTML = filtered.map((p) => renderProductCard(p)).join('');
  document.dispatchEvent(new Event('site:rendered'));
}

async function load() {
  renderSkeletons(grid, 6);
  searchInput.disabled = true;
  onlyAvailable.disabled = true;

  try {
    products = await api.getProducts();
    grid.removeAttribute('aria-busy');

    if (!products.length) {
      countEl.textContent = '';
      renderState(grid, {
        type: 'empty',
        title: 'Beton markalari hali kiritilmagan',
        text: 'Katalog admin panel orqali to‘ldiriladi. Kerakli marka bo‘yicha menejer bilan bog‘laning.',
        actionLabel: 'Bog‘lanish',
        actionHref: 'contact.html',
      });
      return;
    }

    demoNotice.hidden = !products.some((p) => p.is_demo);
    searchInput.disabled = false;
    onlyAvailable.disabled = false;
    render();
  } catch (err) {
    grid.removeAttribute('aria-busy');
    renderState(grid, { ...errorStateFor(err, 'Mahsulotlar'), onRetry: load });
  }
}

searchInput.addEventListener('input', debounce(render, 200));
onlyAvailable.addEventListener('change', render);

load();
