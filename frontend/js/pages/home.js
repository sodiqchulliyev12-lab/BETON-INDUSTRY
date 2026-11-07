/**
 * Bosh sahifa: mahsulotlar qisqa ro'yxati va qayta qo'ng'iroq formasi.
 */
import { api } from '../api.js';
import { renderSkeletons, renderState, errorStateFor } from '../ui.js';
import { renderProductCard } from '../product-card.js';
import { initCallbackForm } from '../callback.js';

const PREVIEW_COUNT = 4;

async function loadProducts() {
  const grid = document.getElementById('homeProducts');
  const demoNotice = document.getElementById('demoNotice');
  if (!grid) return;

  renderSkeletons(grid, PREVIEW_COUNT);

  try {
    const products = await api.getProducts();
    grid.removeAttribute('aria-busy');

    if (!products.length) {
      renderState(grid, {
        type: 'empty',
        title: 'Beton markalari hali kiritilmagan',
        text: 'Mahsulotlar admin panel orqali qo‘shiladi. Hozircha menejer bilan bog‘lanib, kerakli markani aniqlashingiz mumkin.',
        actionLabel: 'Bog‘lanish',
        actionHref: 'contact.html',
      });
      return;
    }

    const preview = products.slice(0, PREVIEW_COUNT);
    grid.innerHTML = preview.map((p) => renderProductCard(p, { maxSpecs: 3 })).join('');
    if (demoNotice) demoNotice.hidden = !preview.some((p) => p.is_demo);
  } catch (err) {
    grid.removeAttribute('aria-busy');
    renderState(grid, { ...errorStateFor(err, 'Mahsulotlar'), onRetry: loadProducts });
  }
}

loadProducts();
initCallbackForm(document.getElementById('callbackForm'));
