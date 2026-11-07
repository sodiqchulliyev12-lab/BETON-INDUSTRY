/**
 * Loyihalar va galereya. Ma'lumotlar admin panel → "Loyihalar va galereya" bo'limidan keladi.
 */
import { api } from '../api.js';
import {
  errorStateFor,
  escapeHtml,
  formatDate,
  formatVolume,
  icon,
  openModal,
  renderSkeletons,
  renderState,
  safeUrl,
} from '../ui.js';

const grid = document.getElementById('projectsGrid');
const demoNotice = document.getElementById('demoNotice');

let projects = [];

function imageList(project) {
  const list = Array.isArray(project.images) ? project.images : [];
  return list
    .map((img) => (typeof img === 'string' ? { url: img, caption: '' } : img))
    .filter((img) => img && safeUrl(img.url));
}

function meta(project) {
  const items = [];
  if (project.location) items.push(`<span>${icon('i-pin')} ${escapeHtml(project.location)}</span>`);
  if (project.volume_m3) items.push(`<span>${icon('i-box')} ${escapeHtml(formatVolume(project.volume_m3))}</span>`);
  if (project.completed_at) items.push(`<span>${icon('i-calendar')} ${escapeHtml(formatDate(project.completed_at))}</span>`);
  return items.join('');
}

function renderCard(project, index) {
  const cover = safeUrl(project.cover_image);
  const media = cover
    ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">`
    : `<div class="project-card__placeholder">${icon('i-image')}</div>`;

  return `
    <button type="button" class="project-card" data-index="${index}" aria-label="${escapeHtml(project.title)} — batafsil">
      <div class="project-card__media">
        ${media}
        ${project.is_demo ? '<span class="badge badge--demo">Demo</span>' : ''}
      </div>
      <div class="project-card__body">
        <h3 class="project-card__title">${escapeHtml(project.title)}</h3>
        <div class="project-card__meta">${meta(project)}</div>
      </div>
    </button>`;
}

function openProject(project) {
  const cover = safeUrl(project.cover_image);
  const gallery = imageList(project);

  const content = `
    ${project.is_demo ? `<div class="notice notice--demo mb-5">${icon('i-info')}<div>Bu demo loyiha — haqiqiy obyekt emas.</div></div>` : ''}
    ${cover ? `<img class="project-detail__image" src="${escapeHtml(cover)}" alt="${escapeHtml(project.title)}">` : ''}
    <div class="project-card__meta mb-5">${meta(project)}</div>
    ${project.description ? `<p class="pre-line">${escapeHtml(project.description)}</p>` : '<p class="text-muted">Tavsif kiritilmagan.</p>'}
    ${gallery.length
      ? `<div class="project-detail__gallery">${gallery
          .map((img) => `<img src="${escapeHtml(safeUrl(img.url))}" alt="${escapeHtml(img.caption || project.title)}" loading="lazy">`)
          .join('')}</div>`
      : ''}`;

  openModal({ title: project.title, content });
}

grid.addEventListener('click', (event) => {
  const card = event.target.closest('.project-card');
  if (!card) return;
  const project = projects[Number(card.dataset.index)];
  if (project) openProject(project);
});

async function load() {
  renderSkeletons(grid, 3);
  try {
    projects = (await api.getProjects()).filter((p) => p && p.title);
    grid.removeAttribute('aria-busy');

    if (!projects.length) {
      renderState(grid, {
        type: 'empty',
        title: 'Loyihalar hali qo‘shilmagan',
        text: 'Bajarilgan obyektlar va fotosuratlar admin panel orqali qo‘shiladi.',
      });
      return;
    }

    demoNotice.hidden = !projects.some((p) => p.is_demo);
    grid.innerHTML = projects.map(renderCard).join('');
  } catch (err) {
    grid.removeAttribute('aria-busy');
    renderState(grid, { ...errorStateFor(err, 'Loyihalar'), onRetry: load });
  }
}

load();
