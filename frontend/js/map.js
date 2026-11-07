/**
 * Xarita (Leaflet + OpenStreetMap). Leaflet loyihaning o'zida turadi (assets/vendor/leaflet) va
 * faqat xarita kerak bo'lganda yuklanadi — boshqa sahifalar tezligiga ta'sir qilmaydi.
 */
import { CONFIG } from './config.js';
import { api } from './api.js';
import { escapeHtml, icon, toast } from './ui.js';

const LEAFLET_BASE = new URL('../assets/vendor/leaflet/', import.meta.url).pathname;
let leafletPromise = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${LEAFLET_BASE}leaflet.css`;
      document.head.appendChild(css);

      const script = document.createElement('script');
      script.src = `${LEAFLET_BASE}leaflet.js`;
      script.onload = () => {
        window.L.Icon.Default.imagePath = `${LEAFLET_BASE}images/`;
        resolve(window.L);
      };
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error('Xarita kutubxonasi yuklanmadi.'));
      };
      document.head.appendChild(script);
    });
  }
  return leafletPromise;
}

/** Sozlamalardagi qiymatdan nuqta: {lat, lon} yoki null */
export function toPoint(lat, lon) {
  const a = Number(lat);
  const b = Number(lon);
  if (lat === null || lat === undefined || lat === '' || lon === null || lon === undefined || lon === '') return null;
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lon: b } : null;
}

export function osmLink(point) {
  return `https://www.openstreetmap.org/?mlat=${point.lat.toFixed(6)}&mlon=${point.lon.toFixed(6)}#map=17/${point.lat.toFixed(6)}/${point.lon.toFixed(6)}`;
}

export function directionsLink(point) {
  return `https://www.openstreetmap.org/directions?to=${point.lat.toFixed(6)}%2C${point.lon.toFixed(6)}`;
}

function pin(L, kind) {
  return L.divIcon({ className: `map-pin map-pin--${kind}`, html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
}

/** Xarita yaratish. Sichqoncha g'ildiragi bilan masshtablash faqat xarita bosilgandan keyin yoqiladi. */
export async function createMap(element, { center = null, zoom = 15 } = {}) {
  const L = await loadLeaflet();
  const view = center ? { center: [center.lat, center.lon], zoom } : CONFIG.MAP.COUNTRY_VIEW;
  const map = L.map(element, { scrollWheelZoom: false }).setView(view.center, view.zoom);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.tileLayer(CONFIG.MAP.TILE_URL, { maxZoom: 19, attribution: CONFIG.MAP.ATTRIBUTION }).addTo(map);
  map.on('focus click', () => map.scrollWheelZoom.enable());
  map.on('blur', () => map.scrollWheelZoom.disable());
  return { L, map };
}

/** Matnli popup (HTML emas — XSS'dan himoya) */
function textPopup(lines) {
  const box = document.createElement('div');
  lines.filter(Boolean).forEach((line, i) => {
    const el = document.createElement(i === 0 ? 'strong' : 'div');
    el.textContent = line;
    box.appendChild(el);
  });
  return box;
}

/** Zavod joylashuvini ko'rsatuvchi xarita (Aloqa sahifasi) */
export async function showFactoryMap(element, point, { title = 'Zavod', address = '' } = {}) {
  const { L, map } = await createMap(element, { center: point, zoom: 15 });
  L.marker([point.lat, point.lon], { icon: pin(L, 'factory'), title, keyboard: false })
    .addTo(map)
    .bindPopup(textPopup([title, address]));
  return map;
}

/** Zavod va yetkazish nuqtasini birga ko'rsatish (admin buyurtma sahifasi) */
export async function showRouteMap(element, { factory, delivery }) {
  const { L, map } = await createMap(element, { center: delivery || factory, zoom: 13 });
  const points = [];
  if (factory) {
    L.marker([factory.lat, factory.lon], { icon: pin(L, 'factory') }).addTo(map).bindPopup(textPopup(['Zavod']));
    points.push([factory.lat, factory.lon]);
  }
  if (delivery) {
    L.marker([delivery.lat, delivery.lon], { icon: pin(L, 'delivery') }).addTo(map).bindPopup(textPopup(['Yetkazish nuqtasi']));
    points.push([delivery.lat, delivery.lon]);
  }
  if (points.length === 2) {
    L.polyline(points, { color: '#222B30', weight: 2, dashArray: '6 6', opacity: 0.7 }).addTo(map);
    map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }
  return map;
}

/**
 * Nuqta tanlash vositasi: manzil qidirish + xaritani bosib belgilash + markerni sudrash.
 * @param {HTMLElement} container
 * @param {{initial?: {lat,lon}|null, factory?: {lat,lon}|null, reverse?: boolean,
 *          onChange?: (point|null) => void, onAddress?: (text: string) => void}} options
 */
export async function createPicker(container, { initial = null, factory = null, reverse = true, onChange = () => {}, onAddress = () => {} } = {}) {
  container.classList.add('map-picker');
  container.innerHTML = `
    <div class="map-picker__search">
      <input class="input" type="search" placeholder="Manzilni qidirish: shahar, tuman, ko‘cha" aria-label="Manzilni qidirish" maxlength="200">
      <button type="button" class="btn btn--dark btn--sm" data-map-search>${icon('i-search')} Qidirish</button>
    </div>
    <ul class="map-picker__results" hidden></ul>
    <div class="map-box map-box--picker"></div>
    <div class="map-picker__bar">
      <span class="map-picker__hint">Xaritani bosing yoki belgini sudrab aniq joyni ko‘rsating.</span>
      <button type="button" class="btn btn--outline btn--sm" data-map-clear hidden>Nuqtani olib tashlash</button>
    </div>`;

  const input = container.querySelector('input');
  const results = container.querySelector('.map-picker__results');
  const hint = container.querySelector('.map-picker__hint');
  const clearBtn = container.querySelector('[data-map-clear]');
  const { L, map } = await createMap(container.querySelector('.map-box'), { center: initial || factory, zoom: initial ? 16 : 12 });

  if (factory) L.marker([factory.lat, factory.lon], { icon: pin(L, 'factory'), interactive: false }).addTo(map);

  let marker = null;
  let reverseToken = 0;

  async function describe(point) {
    if (!reverse) return;
    const token = ++reverseToken;
    try {
      const res = await api.reverseGeocode(point.lat.toFixed(6), point.lon.toFixed(6));
      if (token === reverseToken && res && res.display_name) onAddress(res.display_name);
    } catch {
      /* manzil topilmasa ham nuqta saqlanadi */
    }
  }

  function setPoint(point, { pan = false, lookup = true } = {}) {
    if (!point) {
      if (marker) marker.remove();
      marker = null;
      clearBtn.hidden = true;
      hint.textContent = 'Xaritani bosing yoki belgini sudrab aniq joyni ko‘rsating.';
      onChange(null);
      return;
    }
    const latlng = [point.lat, point.lon];
    if (!marker) {
      marker = L.marker(latlng, { icon: pin(L, 'delivery'), draggable: true, autoPan: true }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        setPoint({ lat: p.lat, lon: p.lng });
      });
    } else {
      marker.setLatLng(latlng);
    }
    if (pan) map.setView(latlng, Math.max(map.getZoom(), 16));
    clearBtn.hidden = false;
    hint.textContent = `Tanlangan nuqta: ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
    onChange({ lat: Number(point.lat.toFixed(6)), lon: Number(point.lon.toFixed(6)) });
    if (lookup) describe(point);
  }

  map.on('click', (e) => setPoint({ lat: e.latlng.lat, lon: e.latlng.lng }));
  clearBtn.addEventListener('click', () => setPoint(null));

  async function runSearch() {
    const q = input.value.trim();
    if (q.length < 3) {
      toast('Kamida 3 ta belgi kiriting.', 'warning', 2500);
      return;
    }
    const button = container.querySelector('[data-map-search]');
    button.disabled = true;
    results.hidden = false;
    results.innerHTML = '<li class="map-picker__empty">Qidirilmoqda…</li>';
    try {
      const items = await api.geocode(q);
      results.innerHTML = items.length
        ? items.map((item, i) => `<li><button type="button" data-result="${i}">${escapeHtml(item.display_name)}</button></li>`).join('')
        : '<li class="map-picker__empty">Hech narsa topilmadi. Boshqacha yozib ko‘ring yoki xaritada o‘zingiz belgilang.</li>';
      results.querySelectorAll('[data-result]').forEach((btn) => btn.addEventListener('click', () => {
        const item = items[Number(btn.dataset.result)];
        results.hidden = true;
        setPoint({ lat: item.lat, lon: item.lon }, { pan: true, lookup: false });
        onAddress(item.display_name);
      }));
    } catch (err) {
      results.innerHTML = `<li class="map-picker__empty">${escapeHtml(err.message || 'Qidiruv ishlamadi.')} Xaritada o‘zingiz belgilang.</li>`;
    } finally {
      button.disabled = false;
    }
  }

  container.querySelector('[data-map-search]').addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // forma yuborilib ketmasin
      runSearch();
    }
  });

  if (initial) setPoint(initial, { lookup: false });
  setTimeout(() => map.invalidateSize(), 50); // yashirin konteynerdan ochilganda o'lchamni yangilash

  return { map, setPoint, invalidate: () => map.invalidateSize() };
}
