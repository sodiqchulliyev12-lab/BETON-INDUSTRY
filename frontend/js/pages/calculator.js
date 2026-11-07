/**
 * Beton kalkulyatori.
 *  - markalar va narxlar API'dan olinadi (kodda hech qanday narx yo'q)
 *  - Beton qiymati = hajm × 1 m³ narxi
 *  - yetkazib berish narxi 0 deb olinmaydi — "menejer tasdiqlaydi"
 *  - "Buyurtma berish" bosilganda tanlovlar buyurtma sahifasiga o'tkaziladi
 */
import { api } from '../api.js';
import { CONFIG } from '../config.js';
import { errorStateFor, formatNumber, getQueryParam, renderState, safeStorage, toast } from '../ui.js';
import { findProduct, isOrderable, productOptions } from '../product-card.js';
import { calculateEstimate, renderSummary } from '../pricing.js';
import { applyErrors, clearErrorsOnInput, clearFieldError, parseVolume, validateVolume } from '../validators.js';

const form = document.getElementById('calcForm');
const layout = document.getElementById('calcLayout');
const statusBox = document.getElementById('calcStatus');
const productSelect = document.getElementById('calcProduct');
const volumeInput = document.getElementById('calcVolume');
const deliveryInput = document.getElementById('calcDelivery');
const addressField = document.getElementById('calcAddressField');
const addressInput = document.getElementById('calcAddress');
const summaryBox = document.getElementById('calcSummary');
const toOrderBtn = document.getElementById('calcToOrder');

let products = [];

function selectedProduct() {
  return products.find((p) => String(p.id) === productSelect.value) || null;
}

function roundToStep(value) {
  return Math.round(value * 10) / 10;
}

function update() {
  const product = selectedProduct();
  const volumeError = validateVolume(volumeInput.value);
  const volume = volumeError ? null : parseVolume(volumeInput.value);

  addressField.hidden = !deliveryInput.checked;

  document.querySelectorAll('[data-volume]').forEach((chip) => {
    chip.classList.toggle('is-active', Number(chip.dataset.volume) === volume);
  });

  renderSummary(summaryBox, product, calculateEstimate({
    product,
    volume,
    deliveryRequired: deliveryInput.checked,
  }));
}

/* --- Hajm: − / + tugmalari va tezkor tanlov --- */
function setVolume(value) {
  const clamped = Math.min(CONFIG.VOLUME.MAX, Math.max(CONFIG.VOLUME.MIN, roundToStep(value)));
  volumeInput.value = String(clamped);
  clearFieldError(form, 'volume_m3');
  update();
}

form.querySelectorAll('[data-step]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const current = parseVolume(volumeInput.value);
    const base = Number.isNaN(current) ? 0 : current;
    setVolume(base + Number(btn.dataset.step) * CONFIG.VOLUME.STEP);
  });
});

form.querySelectorAll('[data-volume]').forEach((chip) => {
  chip.addEventListener('click', () => setVolume(Number(chip.dataset.volume)));
});

/* --- O'lchamlardan hajm hisoblash yordamchisi --- */
const hLength = document.getElementById('hLength');
const hWidth = document.getElementById('hWidth');
const hThickness = document.getElementById('hThickness');
const helperResult = document.getElementById('helperResult');
const helperApply = document.getElementById('helperApply');
let helperVolume = null;

function updateHelper() {
  const length = parseVolume(hLength.value);
  const width = parseVolume(hWidth.value);
  const thicknessCm = parseVolume(hThickness.value);
  const valid = [length, width, thicknessCm].every((n) => Number.isFinite(n) && n > 0);

  if (!valid) {
    helperVolume = null;
    helperResult.textContent = 'O‘lchamlarni kiriting';
    helperApply.disabled = true;
    return;
  }

  const raw = length * width * (thicknessCm / 100);
  helperVolume = Math.ceil(raw * 10) / 10; // 0,1 m³ gacha yuqoriga yaxlitlash
  helperResult.innerHTML = '';
  const strong = document.createElement('strong');
  strong.textContent = `≈ ${formatNumber(helperVolume)} m³`;
  helperResult.append('Hajm: ', strong);
  helperApply.disabled = helperVolume < CONFIG.VOLUME.MIN || helperVolume > CONFIG.VOLUME.MAX;
}

[hLength, hWidth, hThickness].forEach((input) => input.addEventListener('input', updateHelper));

helperApply.addEventListener('click', () => {
  if (helperVolume === null) return;
  setVolume(helperVolume);
  volumeInput.focus();
  toast(`Hajm ${formatNumber(helperVolume)} m³ qilib belgilandi.`, 'success', 3000);
});

/* --- Asosiy hodisalar --- */
form.addEventListener('input', (event) => {
  if (!event.target.closest('#volumeHelper')) update();
});
form.addEventListener('change', update);
form.addEventListener('submit', (event) => event.preventDefault());
clearErrorsOnInput(form);

toOrderBtn.addEventListener('click', () => {
  const product = selectedProduct();
  const errors = {
    product_id: !product ? 'Beton markasini tanlang.' : (!isOrderable(product) ? 'Bu marka hozir mavjud emas.' : null),
    volume_m3: validateVolume(volumeInput.value),
  };
  if (applyErrors(form, errors)) return;

  safeStorage.setJSON(CONFIG.STORAGE.CALC, {
    product_id: product.id,
    volume_m3: parseVolume(volumeInput.value),
    delivery_required: deliveryInput.checked,
    delivery_address: addressInput.value.trim(),
  });
  window.location.href = `order.html?product=${encodeURIComponent(product.slug || product.id)}`;
});

/* --- Yuklash --- */
async function init() {
  statusBox.innerHTML = '';
  layout.hidden = false;
  update();

  try {
    products = await api.getProducts();
  } catch (err) {
    layout.hidden = true;
    renderState(statusBox, { ...errorStateFor(err, 'Beton markalari'), onRetry: init });
    return;
  }

  if (!products.length) {
    layout.hidden = true;
    renderState(statusBox, {
      type: 'empty',
      title: 'Narxlar hali kiritilmagan',
      text: 'Beton markalari va narxlar admin panel orqali qo‘shilgandan so‘ng kalkulyator ishlaydi. Hozircha menejer bilan bog‘laning.',
      actionLabel: 'Bog‘lanish',
      actionHref: 'contact.html',
    });
    return;
  }

  productSelect.innerHTML = productOptions(products);
  productSelect.disabled = false;

  const preselected = findProduct(products, getQueryParam('product'));
  if (preselected && isOrderable(preselected)) {
    productSelect.value = String(preselected.id);
  } else {
    const firstAvailable = products.find(isOrderable);
    if (firstAvailable && products.length === 1) productSelect.value = String(firstAvailable.id);
  }

  update();
}

init();
