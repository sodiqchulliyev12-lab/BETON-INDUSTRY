/** Keyingi bosqichlarda qo'shiladigan bo'limlar uchun vaqtinchalik sahifa. */
import { escapeHtml, icon } from '../components.js';

const DESCRIPTIONS = {
  vehicles: 'Beton mikserlar va ijaraga olingan transport: davlat raqami, sig‘imi, holati (bo‘sh / band / ta’mirda), ijara xarajatlari.',
  drivers: 'Haydovchilar ro‘yxati, telefonlari va transportga biriktirilishi.',
  production: 'Ishlab chiqarish rejasi, haqiqiy hajm, sifat nazorati, yuklangan va yetkazilgan hajm.',
  projects: 'Saytdagi «Loyihalarimiz» bo‘limi: loyihalar, fotosuratlar va galereya.',
  telegram: 'Yangi buyurtma va holat o‘zgarishlari haqida mas’ul xodimlarga Telegram xabarnomalari.',
};

export async function render({ root, meta }) {
  root.innerHTML = `
    <div class="box coming-soon">
      ${icon(meta.icon)}
      <h2>${escapeHtml(meta.label)}</h2>
      <p class="text-muted">${escapeHtml(DESCRIPTIONS[meta.route] || '')}</p>
      <p><span class="badge">${meta.soon}-bosqichda qo‘shiladi</span></p>
      <p class="text-muted">Ma’lumotlar bazasidagi jadvallar allaqachon tayyor.</p>
    </div>`;
}
