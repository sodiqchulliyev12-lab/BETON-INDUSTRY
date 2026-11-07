/**
 * Tizim sozlamalari: kompaniya ma'lumotlari (saytda ko'rinadi) va ishlab chiqarish quvvati.
 * Bo'sh qoldirilgan maydon "kiritilmagan" hisoblanadi — saytda o'rniga shu yoziladi.
 */
import { http } from '../http.js';
import { session } from '../auth.js';
import { PERM, applyApiErrors, errorHtml, escapeHtml, field, icon, loadingHtml, showFormError, toast } from '../components.js';
import { setButtonLoading } from '../../ui.js';
import { clearFieldErrors } from '../../validators.js';
import { createPicker, showFactoryMap, toPoint } from '../../map.js';

const GROUPS = [
  {
    title: 'Kompaniya ma’lumotlari',
    note: 'Saytning header, footer va «Aloqa» sahifasida ko‘rinadi.',
    fields: [
      { key: 'company.name', label: 'Kompaniya nomi' },
      { key: 'company.phone', label: 'Asosiy telefon', placeholder: '+998 __ ___-__-__' },
      { key: 'company.phone_secondary', label: 'Qo‘shimcha telefon' },
      { key: 'company.email', label: 'Email', type: 'email' },
      { key: 'company.address', label: 'Manzil', type: 'textarea', rows: 2 },
      { key: 'company.work_hours', label: 'Ish vaqti', placeholder: 'Masalan: Du–Sha 08:00–18:00' },
      { key: 'company.telegram', label: 'Telegram', placeholder: '@username yoki https://t.me/...' },
      { key: 'company.instagram', label: 'Instagram', placeholder: '@username yoki havola' },
    ],
  },
  {
    title: 'Zavod joylashuvi',
    note: 'Aloqa sahifasidagi xarita va buyurtmagacha masofa uchun. Xaritani bosing yoki manzilni qidiring.',
    map: true,
    fields: [
      { key: 'company.latitude', label: 'Kenglik (latitude)', inputmode: 'decimal', placeholder: 'masalan 41.311081' },
      { key: 'company.longitude', label: 'Uzunlik (longitude)', inputmode: 'decimal', placeholder: 'masalan 69.240562' },
    ],
  },
  {
    title: 'Sayt matni',
    fields: [{ key: 'about.text', label: '«Biz haqimizda» sahifasi matni', type: 'textarea', rows: 8, max: 5000 }],
  },
  {
    title: 'Ishlab chiqarish',
    note: 'Saytda ko‘rinmaydi. Belgilanmagan bo‘lsa, tizim quvvatni taxmin qilmaydi.',
    fields: [{ key: 'production.capacity_m3_per_day', label: 'Kunlik ishlab chiqarish quvvati (m³)', inputmode: 'decimal' }],
  },
];

export async function render(ctx) {
  const { root, isCurrent } = ctx;
  const canWrite = session.can(PERM.SETTINGS_WRITE);
  root.innerHTML = loadingHtml();
  let settings;
  try {
    settings = await http('/admin/settings');
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;
  const values = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  root.innerHTML = `
    ${canWrite ? '' : `<div class="notice mb-5">${icon('i-info')}<div>Sozlamalarni faqat administrator o‘zgartira oladi.</div></div>`}
    <form class="form" id="settingsForm" novalidate>
      ${GROUPS.map((g) => `
        <section class="box settings-group">
          <div class="box__head"><h2 class="box__title">${escapeHtml(g.title)}</h2>${g.note ? `<span class="text-muted">${escapeHtml(g.note)}</span>` : ''}</div>
          <div class="box__body form">
            ${g.fields.map((f) => field({
              name: f.key,
              label: f.label,
              type: f.type || 'text',
              rows: f.rows || 3,
              value: values[f.key] ?? '',
              attrs: `${canWrite ? '' : 'disabled'} maxlength="${f.max || 300}" ${f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : ''} ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}`,
              hint: values[f.key] === null || values[f.key] === undefined ? 'Kiritilmagan' : '',
            })).join('')}
            ${g.map ? '<div data-factory-map></div>' : ''}
          </div>
        </section>`).join('')}
      ${canWrite ? '<div class="btn-row"><button type="submit" class="btn btn--primary btn--lg">Saqlash</button></div>' : ''}
    </form>`;

  const form = root.querySelector('#settingsForm');

  // Zavod joylashuvi xaritasi: bosilgan nuqta kenglik/uzunlik maydonlariga yoziladi
  const mapHolder = form.querySelector('[data-factory-map]');
  const latInput = form.elements.namedItem('company.latitude');
  const lonInput = form.elements.namedItem('company.longitude');
  const initial = toPoint(values['company.latitude'], values['company.longitude']);
  if (canWrite) {
    createPicker(mapHolder, {
      initial,
      reverse: false,
      onChange: (point) => {
        latInput.value = point ? point.lat.toFixed(6) : '';
        lonInput.value = point ? point.lon.toFixed(6) : '';
      },
    }).catch((err) => { mapHolder.textContent = err.message; });
  } else if (initial) {
    mapHolder.className = 'map-box';
    showFactoryMap(mapHolder, initial).catch(() => { mapHolder.hidden = true; });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    showFormError(form, '');
    const payload = {};
    GROUPS.flatMap((g) => g.fields).forEach((f) => {
      const raw = form.elements.namedItem(f.key).value.trim();
      payload[f.key] = raw === '' ? null : raw;
    });
    const button = form.querySelector('[type=submit]');
    setButtonLoading(button, true);
    try {
      await http('/admin/settings', { method: 'PUT', body: { values: payload } });
      try {
        sessionStorage.removeItem('beton.settings'); // saytdagi kesh yangilansin
      } catch {
        /* e'tiborsiz */
      }
      toast('Sozlamalar saqlandi. Saytda bir daqiqa ichida yangilanadi.', 'success');
      render(ctx);
    } catch (err) {
      applyApiErrors(form, err);
      form.querySelector('.has-error input, .has-error textarea, .form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      setButtonLoading(button, false);
    }
  });
}
