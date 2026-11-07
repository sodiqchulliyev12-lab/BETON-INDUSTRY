/** Loyihalar va galereya: saytdagi «Loyihalarimiz» bo'limi shu yerdan boshqariladi. */
import { http } from '../http.js';
import { getFieldErrors } from '../../api.js';
import { safeUrl } from '../../ui.js';
import {
  confirmAction, emptyRow, errorHtml, escapeHtml, field, fmtDate, formModal, icon, loadingHtml, localErrors,
  numberOrNull, toast, volume,
} from '../components.js';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export async function render(ctx) {
  if (ctx.parts[1]) return renderDetail(ctx, Number(ctx.parts[1]));
  const { root, isCurrent } = ctx;
  root.innerHTML = `
    <div class="page-actions">
      <p class="text-muted">Faqat «Nashr etilgan» loyihalar saytda ko‘rinadi. Demo belgisi qo‘yilgan loyihalar saytda «DEMO» deb chiqadi.</p>
      <span class="page-actions__spacer"></span>
      <button type="button" class="btn btn--primary" data-create>${icon('i-plus')} Yangi loyiha</button>
    </div>
    <section class="box" id="projectsBox">${loadingHtml()}</section>`;
  root.querySelector('[data-create]').addEventListener('click', () => projectForm(null, (p) => { location.hash = `#/projects/${p.id}`; }));

  const box = root.querySelector('#projectsBox');
  let projects;
  try {
    projects = await http('/admin/projects');
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  box.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>Loyiha</th><th>Joylashuv</th><th class="num">Hajm</th><th>Tugallangan</th><th class="num">Rasmlar</th><th>Saytda</th></tr></thead>
      <tbody>${projects.length ? projects.map((p) => `
        <tr class="is-link" data-href="#/projects/${p.id}" tabindex="0">
          <td>${safeUrl(p.cover_image) ? `<img class="project-thumb" src="${escapeHtml(safeUrl(p.cover_image))}" alt="" loading="lazy">` : `<span class="project-thumb">${''}</span>`}</td>
          <td><a href="#/projects/${p.id}" class="strong">${escapeHtml(p.title)}</a> ${p.is_demo ? '<span class="badge badge--demo">Demo</span>' : ''}</td>
          <td>${escapeHtml(p.location || '—')}</td>
          <td class="num">${p.volume_m3 !== null ? volume(p.volume_m3) : '—'}</td>
          <td class="nowrap">${p.completed_at ? fmtDate(p.completed_at) : '—'}</td>
          <td class="num">${p.images.length}</td>
          <td>${p.is_published ? '<span class="status status--delivered">Nashr etilgan</span>' : '<span class="status">Qoralama</span>'}</td>
        </tr>`).join('') : emptyRow(7, 'Loyihalar hali qo‘shilmagan.')}
      </tbody></table></div>`;
  box.querySelectorAll('tr[data-href]').forEach((row) => {
    row.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = row.dataset.href; });
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = row.dataset.href; });
  });
}

function projectForm(project, onSaved) {
  const p = project || { title: '', slug: '', description: '', location: '', volume_m3: null, completed_at: null, is_published: false, is_demo: false, sort_order: 0 };
  formModal({
    title: project ? 'Loyihani tahrirlash' : 'Yangi loyiha',
    body: `
      ${field({ name: 'title', label: 'Nomi', value: p.title, required: true, attrs: 'maxlength="200"' })}
      ${field({ name: 'description', label: 'Tavsif', type: 'textarea', rows: 4, value: p.description, attrs: 'maxlength="5000"' })}
      <div class="form-row">
        ${field({ name: 'location', label: 'Joylashuv', value: p.location, attrs: 'maxlength="255"' })}
        ${field({ name: 'volume_m3', label: 'Ishlatilgan beton (m³)', value: p.volume_m3 ?? '', attrs: 'inputmode="decimal" autocomplete="off"' })}
      </div>
      <div class="form-row">
        ${field({ name: 'completed_at', label: 'Tugallangan sana', type: 'date', value: p.completed_at ?? '' })}
        ${field({ name: 'sort_order', label: 'Tartib raqami', type: 'number', value: p.sort_order, attrs: 'min="0" max="10000"' })}
      </div>
      ${field({ name: 'slug', label: 'URL nomi (slug)', value: p.slug, attrs: 'maxlength="220" placeholder="avtomatik"' })}
      ${field({ name: 'is_published', label: 'Saytda nashr etilsin', type: 'checkbox', value: p.is_published })}
      ${field({ name: 'is_demo', label: 'Demo yozuv (saytda «DEMO» belgisi bilan)', type: 'checkbox', value: p.is_demo })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      const amount = numberOrNull(f.volume_m3.value);
      localErrors(form, {
        title: f.title.value.trim().length >= 2 ? null : 'Nomini kiriting.',
        volume_m3: Number.isNaN(amount) || (amount !== null && amount <= 0) ? 'Musbat son kiriting yoki bo‘sh qoldiring.' : null,
      });
      const body = {
        title: f.title.value.trim(),
        description: f.description.value.trim() || null,
        location: f.location.value.trim() || null,
        volume_m3: amount,
        completed_at: f.completed_at.value || null,
        sort_order: Number(f.sort_order.value) || 0,
        slug: f.slug.value.trim() || null,
        is_published: f.is_published.checked,
        is_demo: f.is_demo.checked,
      };
      const saved = project
        ? await http(`/admin/projects/${project.id}`, { method: 'PUT', body })
        : await http('/admin/projects', { method: 'POST', body });
      toast('Loyiha saqlandi.', 'success');
      onSaved(saved);
    },
  });
}

async function renderDetail(ctx, id) {
  const { root, isCurrent, setTitle } = ctx;
  root.innerHTML = loadingHtml();
  let project;
  try {
    project = await http(`/admin/projects/${id}`);
  } catch (err) {
    if (!isCurrent()) return;
    root.innerHTML = `<a class="back-link" href="#/projects">← Loyihalar</a>${errorHtml(err)}`;
    root.querySelector('[data-retry]').addEventListener('click', () => renderDetail(ctx, id));
    return;
  }
  if (!isCurrent()) return;
  setTitle(project.title);
  drawDetail(ctx, project);
}

function drawDetail(ctx, project) {
  const { root } = ctx;
  const redraw = (p) => drawDetail(ctx, p);
  root.innerHTML = `
    <a class="back-link" href="#/projects">← Loyihalar</a>
    <div class="detail-head">
      <h2>${escapeHtml(project.title)}</h2>
      ${project.is_published ? '<span class="status status--delivered">Nashr etilgan</span>' : '<span class="status">Qoralama</span>'}
      ${project.is_demo ? '<span class="badge badge--demo">Demo</span>' : ''}
      <span class="page-actions__spacer"></span>
      <button type="button" class="btn btn--outline btn--sm" data-edit>${icon('i-edit')} Tahrirlash</button>
      <button type="button" class="btn btn--outline btn--sm" data-delete>${icon('i-trash')} O‘chirish</button>
    </div>

    <div class="admin-grid admin-grid--main">
      <section class="box">
        <div class="box__head"><h3 class="box__title">Fotosuratlar (${project.images.length}/30)</h3><span class="text-muted">Sariq ramka — muqova</span></div>
        <div class="box__body">
          <label class="upload-zone mb-5" data-drop>
            ${icon('i-image')}
            <strong>Rasm yuklash</strong>
            <span>JPG, PNG yoki WebP, har biri 5 MB gacha. Bir nechtasini birdan tanlash yoki shu yerga tashlash mumkin.</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-file>
          </label>
          <div class="gallery">${project.images.map((img) => `
            <figure class="gallery__item${project.cover_image === img.file_path ? ' is-cover' : ''}" data-image="${img.id}">
              <img src="${escapeHtml(safeUrl(img.file_path))}" alt="${escapeHtml(img.caption || project.title)}" loading="lazy">
              <figcaption class="gallery__meta">
                <input class="input" data-caption value="${escapeHtml(img.caption || '')}" placeholder="Izoh" maxlength="255" aria-label="Rasm izohi">
                <div class="gallery__actions">
                  ${project.cover_image === img.file_path ? '<span class="badge badge--demo">Muqova</span>' : '<button type="button" class="btn btn--outline btn--sm" data-cover>Muqova qilish</button>'}
                  <button type="button" class="icon-btn" data-remove aria-label="Rasmni o‘chirish" title="O‘chirish">${icon('i-trash')}</button>
                </div>
              </figcaption>
            </figure>`).join('')}
          </div>
          ${project.images.length ? '' : '<p class="text-muted">Hali rasm yuklanmagan.</p>'}
        </div>
      </section>
      <section class="box">
        <div class="box__head"><h3 class="box__title">Ma’lumotlar</h3></div>
        <div class="box__body">
          <dl class="dl">
            <dt>Joylashuv</dt><dd>${escapeHtml(project.location || '—')}</dd>
            <dt>Beton hajmi</dt><dd>${project.volume_m3 !== null ? escapeHtml(volume(project.volume_m3)) : '—'}</dd>
            <dt>Tugallangan</dt><dd>${project.completed_at ? fmtDate(project.completed_at) : '—'}</dd>
            <dt>URL</dt><dd>/${escapeHtml(project.slug)}</dd>
            <dt>Tavsif</dt><dd class="pre-line">${escapeHtml(project.description || '—')}</dd>
          </dl>
        </div>
      </section>
    </div>`;

  root.querySelector('[data-edit]').addEventListener('click', () => projectForm(project, redraw));
  root.querySelector('[data-delete]').addEventListener('click', async () => {
    if (!(await confirmAction({ title: 'Loyihani o‘chirish', text: `«${project.title}» va uning barcha rasmlari o‘chiriladi. Bu amalni qaytarib bo‘lmaydi.`, confirmLabel: 'O‘chirish' }))) return;
    try {
      await http(`/admin/projects/${project.id}`, { method: 'DELETE' });
      toast('Loyiha o‘chirildi.', 'success');
      location.hash = '#/projects';
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const zone = root.querySelector('[data-drop]');
  const input = root.querySelector('[data-file]');
  input.addEventListener('change', () => upload(project, Array.from(input.files), redraw));
  ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add('is-drag'); }));
  ['dragleave', 'drop'].forEach((type) => zone.addEventListener(type, () => zone.classList.remove('is-drag')));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    upload(project, Array.from(e.dataTransfer.files), redraw);
  });

  root.querySelectorAll('[data-image]').forEach((item) => {
    const imageId = Number(item.dataset.image);
    const caption = item.querySelector('[data-caption]');
    caption.addEventListener('change', async () => {
      try {
        await http(`/admin/projects/${project.id}/images/${imageId}`, { method: 'PATCH', body: { caption: caption.value.trim() || null } });
        toast('Izoh saqlandi.', 'success', 2000);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    item.querySelector('[data-cover]')?.addEventListener('click', async () => {
      try {
        redraw(await http(`/admin/projects/${project.id}/cover`, { method: 'POST', body: { image_id: imageId } }));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    item.querySelector('[data-remove]').addEventListener('click', async () => {
      if (!(await confirmAction({ title: 'Rasmni o‘chirish', text: 'Rasm serverdan butunlay o‘chiriladi.', confirmLabel: 'O‘chirish' }))) return;
      try {
        redraw(await http(`/admin/projects/${project.id}/images/${imageId}`, { method: 'DELETE' }));
        toast('Rasm o‘chirildi.', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

async function upload(project, files, redraw) {
  if (!files.length) return;
  let latest = null;
  let ok = 0;
  for (const file of files) {
    if (!ALLOWED.includes(file.type)) {
      toast(`${file.name}: faqat JPG, PNG yoki WebP.`, 'error');
      continue;
    }
    if (file.size > MAX_BYTES) {
      toast(`${file.name}: hajmi 5 MB dan katta.`, 'error');
      continue;
    }
    const data = new FormData();
    data.append('file', file);
    try {
      latest = await http(`/admin/projects/${project.id}/images`, { method: 'POST', formData: data, body: true });
      ok += 1;
    } catch (err) {
      const reason = getFieldErrors(err).file || err.message; // server aniq sababni "file" maydonida qaytaradi
      toast(`${file.name}: ${reason}`, 'error');
    }
  }
  if (ok) toast(`${ok} ta rasm yuklandi.`, 'success');
  if (latest) redraw(latest);
}
