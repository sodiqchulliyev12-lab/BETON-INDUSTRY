/**
 * Aloqa sahifasi. Kontaktlar main.js orqali admin sozlamalaridan to'ldiriladi.
 * Bu yerda: xabar formasi va zavod joylashuvi xaritasi (koordinatalar admin paneldan kiritiladi).
 */
import { api } from '../api.js';
import { initCallbackForm } from '../callback.js';
import { directionsLink, osmLink, showFactoryMap, toPoint } from '../map.js';

initCallbackForm(document.getElementById('contactForm'));

async function initFactoryMap() {
  const wrap = document.getElementById('factoryMapWrap');
  const empty = document.getElementById('factoryMapEmpty');
  let settings;
  try {
    settings = await api.getSettings();
  } catch {
    return; // server javob bermasa — "kiritilmagan" bloki qoladi
  }
  const point = toPoint(settings['company.latitude'], settings['company.longitude']);
  if (!point) return;

  wrap.hidden = false;
  empty.hidden = true;
  document.getElementById('factoryDirections').href = directionsLink(point);
  document.getElementById('factoryOsm').href = osmLink(point);
  try {
    await showFactoryMap(document.getElementById('factoryMap'), point, {
      title: settings['company.name'] || 'BETON INDUSTRY',
      address: settings['company.address'] || '',
    });
  } catch {
    document.getElementById('factoryMap').hidden = true; // kutubxona yuklanmasa ham havolalar ishlaydi
  }
}

initFactoryMap();
