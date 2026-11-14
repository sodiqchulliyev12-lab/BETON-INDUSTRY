/**
 * Telegram guruhlari (ishlab chiqarish, kassa-bank, xomashyo) va Google Sheets.
 * 1-bosqich: har bir xabar o'zgartirilmasdan saqlanadi va jadvalning "Xom — ..." varag'iga yoziladi.
 */
import { http, qs } from '../http.js';
import { setQuery } from '../app.js';
import { setButtonLoading } from '../../ui.js';
import {
  emptyRow, errorHtml, escapeHtml, fmtDateTime, icon, loadingHtml, paginationHtml, showFormError, toast, applyApiErrors,
} from '../components.js';
import { clearFieldErrors } from '../../validators.js';

const SHEETS_STATUS = {
  sent: ['Jadvalda', 'delivered'],
  pending: ['Navbatda', 'pending'],
  failed: ['Xato', 'cancelled'],
  skipped: ['Vazifasi belgilanmagan', ''],
};

export async function render(ctx) {
  const { root, query, isCurrent } = ctx;
  root.innerHTML = loadingHtml();
  const chatFilter = query.get('chat') || '';
  const page = Number(query.get('page')) || 1;

  let webhook;
  let chats;
  let sheets;
  let messages;
  try {
    [webhook, chats, sheets, messages] = await Promise.all([
      http('/admin/telegram/webhook'),
      http('/admin/telegram/chats'),
      http('/admin/telegram/sheets'),
      http(`/admin/telegram/messages${qs({ chat_id: chatFilter, page, page_size: 30 })}`),
    ]);
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  const purposeOptions = (current) => `<option value="">— belgilanmagan —</option>${Object.entries(sheets.purpose_labels)
    .map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;

  root.innerHTML = `
    <div class="admin-grid admin-grid--main">
      <div class="admin-grid">
        <section class="box">
          <div class="box__head"><h2 class="box__title">Guruhlar</h2>
            <span class="text-muted">Bot qo‘shilgan guruh birinchi xabardan keyin shu yerda paydo bo‘ladi</span></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Guruh</th><th>Vazifasi (qaysi varaqqa yoziladi)</th><th class="num">Xabarlar</th><th class="num">Navbatda</th><th>Oxirgi xabar</th><th>Faol</th></tr></thead>
            <tbody>${chats.length ? chats.map((c) => `
              <tr data-chat="${c.chat_id}">
                <td><strong>${escapeHtml(c.title || '—')}</strong><br><span class="muted">${escapeHtml(String(c.chat_id))} · ${escapeHtml(c.chat_type)}</span></td>
                <td><select class="select" data-purpose aria-label="Guruh vazifasi">${purposeOptions(c.purpose)}</select></td>
                <td class="num"><a href="#/inbox?chat=${c.chat_id}">${c.messages_count}</a></td>
                <td class="num">${c.pending_count}</td>
                <td class="nowrap muted">${c.last_message_at ? fmtDateTime(c.last_message_at) : '—'}</td>
                <td><label class="toggle"><input type="checkbox" data-active ${c.is_active ? 'checked' : ''} aria-label="Faol"><span></span></label></td>
              </tr>`).join('') : emptyRow(6, 'Hali guruh yo‘q. Botni guruhga qo‘shing (administrator qilib) va guruhga istalgan xabar yozing — guruh shu yerda paydo bo‘ladi.')}
            </tbody></table></div>
        </section>

        <section class="box">
          <div class="box__head"><h2 class="box__title">Xabarlar jurnali</h2>
            <select class="select" data-filter aria-label="Guruh bo‘yicha filtr">
              <option value="">Barcha guruhlar</option>
              ${chats.map((c) => `<option value="${c.chat_id}" ${String(c.chat_id) === chatFilter ? 'selected' : ''}>${escapeHtml(c.title || String(c.chat_id))}</option>`).join('')}
            </select></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Vaqt</th><th>Guruh</th><th>Yozgan</th><th>Xabar</th><th>Google Sheets</th></tr></thead>
            <tbody>${messages.items.length ? messages.items.map((m) => {
              const [label, tone] = SHEETS_STATUS[m.sheets_status] || [m.sheets_status, ''];
              return `<tr>
                <td class="nowrap muted">${fmtDateTime(m.sent_at)}${m.edited_at ? '<br><span class="muted">tahrirlangan</span>' : ''}</td>
                <td>${escapeHtml(m.chat_title || '')}</td>
                <td>${escapeHtml(m.from_name || '—')}</td>
                <td class="pre-line">${m.text ? escapeHtml(m.text) : `<span class="muted">[${escapeHtml(m.content_type)}]</span>`}
                  ${m.link ? `<br><a href="${escapeHtml(m.link)}" target="_blank" rel="noopener">Telegram’da ochish ↗</a>` : ''}</td>
                <td><span class="status ${tone ? `status--${tone}` : ''}">${escapeHtml(label)}</span>${m.sheets_error ? `<br><span class="muted">${escapeHtml(m.sheets_error)}</span>` : ''}</td>
              </tr>`;
            }).join('') : emptyRow(5, 'Hali xabar yo‘q.')}
            </tbody></table></div>
          ${paginationHtml(messages)}
        </section>
      </div>

      <div class="admin-grid">
        <section class="box">
          <div class="box__head"><h2 class="box__title">Telegram ulanishi</h2>
            ${webhook.configured ? '<span class="status status--delivered">Ishlayapti</span>' : '<span class="status status--cancelled">Ulanmagan</span>'}</div>
          <div class="box__body">
            ${webhook.configured
              ? `<p class="text-muted">Guruh xabarlari serverga kelyapti.${webhook.pending_update_count ? ` Navbatda: ${webhook.pending_update_count}.` : ''}</p>`
              : `<p class="text-muted">${escapeHtml(webhook.reason || 'Webhook o‘rnatilmagan.')}</p>`}
            ${webhook.last_error_message ? `<p class="form-error">Telegram oxirgi xatosi: ${escapeHtml(webhook.last_error_message)}</p>` : ''}
            <button type="button" class="btn btn--outline btn--sm" data-webhook>${webhook.configured ? 'Qayta ulash' : 'Ulash'}</button>
            <button type="button" class="btn btn--dark btn--sm" data-diagnose>Botni guruhlarda tekshirish</button>
            <div data-diagnose-result class="mt-5"></div>
            <p class="field__hint mt-5">Bot guruhdagi oddiy xabarlarni ko‘rishi uchun: @BotFather → /setprivacy → Disable, va botni guruh administratori qiling.</p>
          </div>
        </section>

        <section class="box">
          <div class="box__head"><h2 class="box__title">Google Sheets</h2>
            ${sheets.url ? '<span class="status status--delivered">Ulangan</span>' : '<span class="status">Ulanmagan</span>'}</div>
          <div class="box__body">
            ${sheets.url ? `<p class="text-muted">Xabarlar jadvalga yozilmoqda. Navbatda: <strong>${sheets.pending}</strong></p>
              <button type="button" class="btn btn--outline btn--sm mb-5" data-resync ${sheets.pending ? '' : 'disabled'}>Navbatdagilarni yuborish</button>` : ''}
            <details ${sheets.url ? '' : 'open'}>
              <summary class="field__label">Ulash bo‘yicha yo‘riqnoma (3 daqiqa)</summary>
              <ol class="steps-list">
                <li>Yangi jadval oching: <a href="https://sheets.new" target="_blank" rel="noopener">sheets.new ↗</a></li>
                <li><strong>Kengaytmalar (Extensions) → Apps Script</strong></li>
                <li>Quyidagi kodni nusxalab, u yerdagi kod o‘rniga joylang va saqlang (Ctrl+S).
                  <button type="button" class="btn btn--dark btn--sm" data-copy>${icon('i-check')} Kodni nusxalash</button></li>
                <li><strong>Deploy → New deployment</strong> → turi <strong>Web app</strong>; Execute as: <em>Me</em>; Who has access: <em>Anyone</em> → Deploy → ruxsat bering.</li>
                <li>Chiqqan <strong>Web app URL</strong> ni pastga joylang va «Saqlash»ni bosing.</li>
              </ol>
              <textarea class="textarea code-area" readonly rows="6" data-script aria-label="Apps Script kodi">${escapeHtml(sheets.script)}</textarea>
              <p class="field__hint">Kod ichida maxfiy kalit bor — uni boshqalarga bermang. Varaqlar avtomatik yaratiladi:
                ${Object.values(sheets.sheet_names).map((n) => `«${escapeHtml(n)}»`).join(', ')}.</p>
            </details>
            <form class="form mt-5" data-sheets-form novalidate>
              <div class="field">
                <label class="field__label" for="sheetsUrl">Web app URL</label>
                <input class="input" id="sheetsUrl" name="url" type="url" value="${escapeHtml(sheets.url || '')}" placeholder="https://script.google.com/macros/s/.../exec" maxlength="300">
              </div>
              <button type="submit" class="btn btn--primary">Saqlash va tekshirish</button>
            </form>
          </div>
        </section>
      </div>
    </div>`;

  /* --- Hodisalar --- */
  root.querySelectorAll('tr[data-chat]').forEach((row) => {
    const chatId = row.dataset.chat;
    const patch = async (body, control, revert) => {
      control.disabled = true;
      try {
        await http(`/admin/telegram/chats/${chatId}`, { method: 'PATCH', body });
        toast('Saqlandi.', 'success', 2500);
        render(ctx);
      } catch (err) {
        revert();
        toast(err.message, 'error');
      } finally {
        control.disabled = false;
      }
    };
    const select = row.querySelector('[data-purpose]');
    const prev = select.value;
    select.addEventListener('change', () => patch({ purpose: select.value || null }, select, () => { select.value = prev; }));
    const active = row.querySelector('[data-active]');
    active.addEventListener('change', () => patch({ is_active: active.checked }, active, () => { active.checked = !active.checked; }));
  });

  root.querySelector('[data-filter]').addEventListener('change', (e) => setQuery({ chat: e.target.value, page: '' }));
  root.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => setQuery({ page: b.dataset.page })));

  root.querySelector('[data-webhook]').addEventListener('click', async (e) => {
    setButtonLoading(e.currentTarget, true);
    try {
      await http('/admin/telegram/webhook', { method: 'POST', body: {} });
      toast('Telegram ulandi.', 'success');
      render(ctx);
    } catch (err) {
      toast(err.message, 'error');
      setButtonLoading(e.currentTarget, false);
    }
  });

  root.querySelector('[data-diagnose]').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const box = root.querySelector('[data-diagnose-result]');
    setButtonLoading(button, true);
    try {
      const res = await http('/admin/telegram/diagnose');
      box.innerHTML = `
        <p class="text-muted">Bot: <strong>@${escapeHtml(res.bot.username || '?')}</strong> ·
          maxfiylik rejimi: ${res.bot.can_read_all_group_messages ? 'o‘chirilgan (hamma xabarni ko‘radi)' : '<strong>yoqilgan</strong> (faqat admin bo‘lgan guruhda ko‘radi)'}</p>
        <ul class="steps-list">${res.chats.map((c) => `
          <li><strong>${escapeHtml(c.title || String(c.chat_id))}</strong>:
            ${c.error ? `<span class="form-error">${escapeHtml(c.error)}</span>` : escapeHtml(c.label || '')}
            ${c.sees_messages ? ' — <span class="status status--delivered">xabarlarni ko‘radi</span>' : ' — <span class="status status--cancelled">xabarlarni ko‘rmaydi</span>'}</li>`).join('')}
        </ul>`;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  });

  root.querySelector('[data-copy]')?.addEventListener('click', async () => {
    const area = root.querySelector('[data-script]');
    try {
      await navigator.clipboard.writeText(area.value);
    } catch {
      area.select();
      document.execCommand('copy');
    }
    toast('Kod nusxalandi.', 'success', 2500);
  });

  root.querySelector('[data-resync]')?.addEventListener('click', async (e) => {
    setButtonLoading(e.currentTarget, true);
    try {
      const res = await http('/admin/telegram/sheets/resync', { method: 'POST', body: {} });
      toast(`Yuborildi: ${res.sent}${res.failed ? `, xato: ${res.failed}` : ''}`, res.failed ? 'warning' : 'success');
      render(ctx);
    } catch (err) {
      toast(err.message, 'error');
      setButtonLoading(e.currentTarget, false);
    }
  });

  const form = root.querySelector('[data-sheets-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    showFormError(form, '');
    const button = form.querySelector('[type=submit]');
    setButtonLoading(button, true);
    try {
      const res = await http('/admin/telegram/sheets', { method: 'PUT', body: { url: form.elements.url.value.trim() || null } });
      toast(form.elements.url.value.trim() ? `Jadval ulandi. Yuborilgan xabarlar: ${res.pushed.sent}` : 'Google Sheets uzildi.', 'success');
      render(ctx);
    } catch (err) {
      applyApiErrors(form, err);
    } finally {
      setButtonLoading(button, false);
    }
  });
}
