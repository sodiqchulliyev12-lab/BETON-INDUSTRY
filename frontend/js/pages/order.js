/**
 * Buyurtma sahifasi.
 *
 * Yuborilgandan keyin (2-bosqichdagi backend):
 *  1. buyurtma PostgreSQL'ga yoziladi va unikal raqam oladi
 *  2. admin panelda ko'rinadi, Telegram orqali mas'ul xodimga xabar boradi
 *  3. bu sahifa mijozga buyurtma raqamini ko'rsatadi
 */
import { api, getFieldErrors } from '../api.js';
import { CONFIG } from '../config.js';
import { errorStateFor, escapeHtml, getQueryParam, icon, renderState, safeStorage, setButtonLoading, toast } from '../ui.js';
import { createPicker, toPoint } from '../map.js';
import { findProduct, isOrderable, productOptions } from '../product-card.js';
import { calculateEstimate, renderSummary } from '../pricing.js';
import {
  applyErrors,
  attachPhoneMask,
  clearErrorsOnInput,
  clearFieldErrors,
  normalizePhone,
  parseVolume,
  todayISO,
  validateDate,
  validateName,
  validatePhone,
  validateRequiredText,
  validateTime,
  validateVolume,
} from '../validators.js';

const form = document.getElementById('orderForm');
const layout = document.getElementById('orderLayout');
const statusBox = document.getElementById('orderStatus');
const successBox = document.getElementById('orderSuccess');
const submitBtn = document.getElementById('orderSubmit');
const summaryBox = document.getElementById('orderSummary');

const el = {
  name: document.getElementById('oName'),
  phone: document.getElementById('oPhone'),
  product: document.getElementById('oProduct'),
  volume: document.getElementById('oVolume'),
  delivery: document.getElementById('oDelivery'),
  addressField: document.getElementById('oAddressField'),
  address: document.getElementById('oAddress'),
  date: document.getElementById('oDate'),
  dateLabel: document.getElementById('oDateLabel'),
  time: document.getElementById('oTime'),
  timeLabel: document.getElementById('oTimeLabel'),
  comment: document.getElementById('oComment'),
  consent: document.getElementById('oConsent'),
};

let products = [];
let mapPoint = null; // xaritadan tanlangan nuqta {lat, lon} yoki null

/* --- Xaritadan nuqta tanlash (ixtiyoriy) --- */
const mapToggle = document.getElementById('oMapToggle');
const mapHolder = document.getElementById('oMapPicker');
const mapStatus = document.getElementById('oMapStatus');
const mapAddress = document.getElementById('oMapAddress');
let picker = null;

function suggestAddress(text) {
  if (!el.address.value.trim()) {
    el.address.value = text.slice(0, 500);
    clearFieldErrors(form);
    mapAddress.hidden = true;
    return;
  }
  if (el.address.value.trim() === text) return;
  mapAddress.hidden = false;
  mapAddress.innerHTML = `${icon('i-pin')}<div><span>Xaritadagi manzil: </span><strong></strong>
    <button type="button" class="btn btn--outline btn--sm">Manzil o‘rniga qo‘yish</button></div>`;
  mapAddress.querySelector('strong').textContent = text;
  mapAddress.querySelector('button').addEventListener('click', () => {
    el.address.value = text.slice(0, 500);
    mapAddress.hidden = true;
  });
}

mapToggle.addEventListener('click', async () => {
  const open = mapHolder.hidden;
  mapHolder.hidden = !open;
  mapToggle.setAttribute('aria-expanded', String(open));
  if (!open) return;
  if (picker) {
    picker.invalidate();
    return;
  }
  mapHolder.innerHTML = '<p class="text-muted">Xarita yuklanmoqda…</p>';
  try {
    let factory = null;
    try {
      const settings = await api.getSettings();
      factory = toPoint(settings['company.latitude'], settings['company.longitude']);
    } catch {
      /* zavod joylashuvisiz ham ishlaydi */
    }
    picker = await createPicker(mapHolder, {
      factory,
      onChange: (point) => {
        mapPoint = point;
        mapStatus.textContent = point ? 'Nuqta belgilandi ✓' : 'Aniq nuqta haydovchiga obyektni tez topishga yordam beradi.';
      },
      onAddress: suggestAddress,
    });
  } catch (err) {
    mapHolder.innerHTML = `<p class="field__error">${escapeHtml(err.message)}</p>`;
  }
});

function selectedProduct() {
  return products.find((p) => String(p.id) === el.product.value) || null;
}

function update() {
  const delivery = el.delivery.checked;
  el.addressField.hidden = !delivery;
  el.address.required = delivery;
  el.dateLabel.textContent = delivery ? 'Yetkazib berish sanasi' : 'Olib ketish sanasi';
  el.timeLabel.textContent = delivery ? 'Yetkazib berish vaqti' : 'Olib ketish vaqti';

  const volume = validateVolume(el.volume.value) ? null : parseVolume(el.volume.value);
  renderSummary(summaryBox, selectedProduct(), calculateEstimate({
    product: selectedProduct(),
    volume,
    deliveryRequired: delivery,
  }));
}

function validate() {
  const product = selectedProduct();
  const delivery = el.delivery.checked;
  return {
    customer_name: validateName(el.name.value),
    phone: validatePhone(el.phone.value),
    product_id: !product ? 'Beton markasini tanlang.' : (!isOrderable(product) ? 'Bu marka hozir mavjud emas.' : null),
    volume_m3: validateVolume(el.volume.value),
    delivery_address: delivery
      ? validateRequiredText(el.address.value, 'Yetkazib berish manzilini kiriting.', { min: 5, max: 500 })
      : null,
    delivery_date: validateDate(el.date.value),
    delivery_time: validateTime(el.time.value),
    comment: el.comment.value.length > 1000 ? 'Izoh juda uzun (ko‘pi bilan 1000 ta belgi).' : null,
    consent: el.consent.checked ? null : 'Davom etish uchun roziligingizni belgilang.',
  };
}

function buildPayload() {
  const delivery = el.delivery.checked;
  return {
    customer_name: el.name.value.trim(),
    phone: normalizePhone(el.phone.value),
    product_id: Number(el.product.value),
    volume_m3: parseVolume(el.volume.value),
    delivery_required: delivery,
    delivery_address: delivery ? el.address.value.trim() : null,
    delivery_lat: delivery && mapPoint ? mapPoint.lat : null,
    delivery_lon: delivery && mapPoint ? mapPoint.lon : null,
    delivery_date: el.date.value,
    delivery_time: el.time.value || null,
    comment: el.comment.value.trim() || null,
    website: form.elements.namedItem('website').value, // honeypot
  };
}

function showSuccess(result) {
  const number = result && (result.order_number || result.number);
  document.getElementById('orderNumber').textContent = number || '—';
  layout.hidden = true;
  successBox.hidden = false;
  successBox.focus();
  window.scrollTo({ top: successBox.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' });
  toast('Buyurtma muvaffaqiyatli yuborildi.', 'success');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(form);
  if (applyErrors(form, validate())) {
    toast('Formada xatolar bor. Belgilangan maydonlarni tekshiring.', 'warning', 4000);
    return;
  }

  setButtonLoading(submitBtn, true);
  try {
    const result = await api.createOrder(buildPayload());
    safeStorage.remove(CONFIG.STORAGE.CALC);
    showSuccess(result);
  } catch (err) {
    const fieldErrors = getFieldErrors(err);
    if (Object.keys(fieldErrors).length) {
      applyErrors(form, fieldErrors);
      toast('Server ba’zi maydonlarni qabul qilmadi. Ularni tekshiring.', 'error');
    } else {
      toast(err.message || 'Buyurtmani yuborib bo‘lmadi.', 'error');
    }
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

form.addEventListener('input', update);
form.addEventListener('change', update);
clearErrorsOnInput(form);
attachPhoneMask(el.phone);

/** Kalkulyatordan yoki katalogdan kelgan tanlovni formaga qo'yish */
function prefill() {
  const fromCalc = safeStorage.getJSON(CONFIG.STORAGE.CALC);
  const key = getQueryParam('product') || (fromCalc && fromCalc.product_id);
  const product = findProduct(products, key);
  if (product && isOrderable(product)) el.product.value = String(product.id);

  if (fromCalc && product && String(fromCalc.product_id) === String(product.id)) {
    if (Number.isFinite(fromCalc.volume_m3)) el.volume.value = String(fromCalc.volume_m3);
    if (typeof fromCalc.delivery_required === 'boolean') el.delivery.checked = fromCalc.delivery_required;
    if (fromCalc.delivery_address) el.address.value = String(fromCalc.delivery_address).slice(0, 500);
  }
}

async function init() {
  el.date.min = todayISO();
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
      title: 'Onlayn buyurtma hali ochilmagan',
      text: 'Beton markalari admin panel orqali kiritilgandan so‘ng buyurtma berish mumkin bo‘ladi. Hozircha menejer bilan bog‘laning.',
      actionLabel: 'Bog‘lanish',
      actionHref: 'contact.html',
    });
    return;
  }

  el.product.innerHTML = productOptions(products);
  el.product.disabled = false;
  prefill();
  update();
}

init();
