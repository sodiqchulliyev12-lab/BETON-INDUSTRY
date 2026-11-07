/**
 * Telegram xabarnomalari. Bot tokeni bu yerda kiritilmaydi — xavfsizlik uchun u serverdagi .env faylida.
 * Bu sahifada: qaysi chatlarga, qaysi hodisalar haqida xabar borishi va xabar shabloni.
 */
import { http } from '../http.js';
import { session } from '../auth.js';
import { setButtonLoading } from '../../ui.js';
import { clearFieldErrors } from '../../validators.js';
import {
  PERM, applyApiErrors, emptyRow, errorHtml, escapeHtml, field, fmtDateTime, icon, loadingHtml, showFormError, toast,
} from '../components.js';

const EVENTS = { new_order: 'Yangi buyurtma', status_change: 'Holat o‘zgardi', callback: 'Qo‘ng‘iroq so‘rovi', test: 'Sinov' };

export async function render(ctx) {
  const { root, isCurrent } = ctx;
  const canWrite = session.can(PERM.SETTINGS_WRITE);
  root.innerHTML = loadingHtml();
  let data;
  try {
    data = await http('/admin/telegram');
  } catch (err) {
    root.innerHTML = errorHtml(err);
    root.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;
  const disabled = canWrite ? '' : 'disabled';

  root.innerHTML = `
    ${data.token_configured
      ? `<div class="notice mb-5">${icon('i-check')}<div>Bot tokeni serverda sozlangan.
          ${canWrite ? '<button type="button" class="btn btn--outline btn--sm" data-bot-info>Botni tekshirish</button>' : ''}
          <span data-bot-name></span></div></div>`
      : `<div class="notice notice--danger mb-5">${icon('i-alert')}<div>
          <strong>Bot tokeni sozlanmagan.</strong> Xavfsizlik uchun token admin panelda emas, serverdagi
          <code>backend/.env</code> faylida saqlanadi:<br><code>TELEGRAM_BOT_TOKEN=123456789:AA...</code><br>
          Tokenni Telegram'da <strong>@BotFather</strong> → <em>/newbot</em> orqali oling, faylga yozing va serverni qayta ishga tushiring.
        </div></div>`}
    ${data.public_base_url ? '' : `<div class="notice mb-5">${icon('i-info')}<div>Xabarlarda «Admin panelda ochish» havolasi bo‘lishi uchun
      <code>.env</code> ga sayt manzilini yozing: <code>PUBLIC_BASE_URL=https://sizning-domen.uz</code></div></div>`}

    <div class="admin-grid admin-grid--main">
      <form class="form" id="tgForm" novalidate>
        <section class="box">
          <div class="box__head"><h2 class="box__title">Xabarnomalar</h2></div>
          <div class="box__body form">
            <label class="switch">
              <input type="checkbox" name="is_enabled" ${data.is_enabled ? 'checked' : ''} ${disabled}>
              <span class="switch__track" aria-hidden="true"></span>
              <span class="switch__text"><strong>Telegram xabarnomalari yoqilgan</strong>
                <span>O‘chirilsa, hech qanday xabar yuborilmaydi (sinov xabaridan tashqari)</span></span>
            </label>
            ${field({ name: 'chat_ids', label: 'Chat ID’lar (har birini yangi qatordan)', type: 'textarea', rows: 3,
              value: data.chat_ids.join('\n'), attrs: `${disabled} spellcheck="false" placeholder="-1001234567890\n@kanal_nomi"`,
              hint: 'Mas’ul xodim, guruh yoki kanal. Ko‘pi bilan 10 ta. Guruhga avval botni qo‘shing.' })}
            ${canWrite ? `<div><button type="button" class="btn btn--outline btn--sm" data-discover>${icon('i-search')} Chat ID’ni topish</button>
              <span class="field__hint">Avval botga yoki bot qo‘shilgan guruhga istalgan xabar yozing, so‘ng shu tugmani bosing.</span></div>
              <div data-chats></div>` : ''}
            <fieldset class="fieldset">
              <legend class="field__label">Qaysi hodisalar haqida xabar yuborilsin</legend>
              ${field({ name: 'notify_new_order', label: 'Yangi buyurtma', type: 'checkbox', value: data.notify_new_order, attrs: disabled })}
              ${field({ name: 'notify_status_change', label: 'Buyurtma holati o‘zgardi', type: 'checkbox', value: data.notify_status_change, attrs: disabled })}
              ${field({ name: 'notify_callback', label: 'Qayta qo‘ng‘iroq so‘rovi', type: 'checkbox', value: data.notify_callback, attrs: disabled })}
            </fieldset>
          </div>
        </section>

        <section class="box">
          <div class="box__head"><h2 class="box__title">Yangi buyurtma xabari shabloni</h2></div>
          <div class="box__body form">
            ${field({ name: 'message_template', label: 'Shablon (bo‘sh qoldirilsa — standart)', type: 'textarea', rows: 9,
              value: data.message_template || '', attrs: `${disabled} maxlength="2000" spellcheck="false" placeholder="${escapeHtml(data.default_template)}"`,
              hint: 'Telegram HTML teglari: <b>qalin</b>, <i>kursiv</i>. Shablon xato bo‘lsa, standart shablon ishlatiladi.' })}
            <div>
              <span class="field__label">O‘zgaruvchilar</span>
              <div class="chips">${Object.entries(data.template_fields).map(([k, v]) => `
                <button type="button" class="chip" data-var="${escapeHtml(k)}" title="${escapeHtml(v)}" ${disabled}>{${escapeHtml(k)}}</button>`).join('')}
              </div>
            </div>
          </div>
        </section>
        ${canWrite ? '<div class="btn-row"><button type="submit" class="btn btn--primary btn--lg">Saqlash</button></div>' : ''}
      </form>

      <div class="admin-grid">
        ${canWrite ? `<section class="box">
          <div class="box__head"><h2 class="box__title">Sinov xabari</h2></div>
          <div class="box__body">
            <p class="text-muted">Saqlangan barcha chatlarga sinov xabari yuboriladi. Xabarnomalar o‘chirilgan bo‘lsa ham ishlaydi.</p>
            <button type="button" class="btn btn--dark btn--block" data-test ${data.token_configured ? '' : 'disabled'}>${icon('i-telegram')} Sinov xabarini yuborish</button>
            <div data-test-result class="mt-5"></div>
          </div>
        </section>` : ''}
        <section class="box">
          <div class="box__head"><h2 class="box__title">Oxirgi xabarlar</h2></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Vaqt</th><th>Hodisa</th><th>Holat</th></tr></thead>
            <tbody>${data.logs.length ? data.logs.map((l) => `
              <tr>
                <td class="nowrap muted">${fmtDateTime(l.created_at)}</td>
                <td>${escapeHtml(EVENTS[l.event] || l.event)}${l.order_id ? `<br><a href="#/orders/${l.order_id}">buyurtma</a>` : ''}<br><span class="muted">${escapeHtml(l.recipient)}</span></td>
                <td>${l.status === 'sent' ? '<span class="status status--delivered">Yuborildi</span>'
                  : `<span class="status status--cancelled">Xato</span><br><span class="muted">${escapeHtml(l.error || '')}</span>`}</td>
              </tr>`).join('') : emptyRow(3, 'Hali xabar yuborilmagan.')}
            </tbody></table></div>
        </section>
      </div>
    </div>`;

  if (!canWrite) return;
  const form = root.querySelector('#tgForm');

  root.querySelectorAll('[data-var]').forEach((chip) => chip.addEventListener('click', () => {
    const area = form.elements.message_template;
    const token = `{${chip.dataset.var}}`;
    const start = area.selectionStart ?? area.value.length;
    area.value = area.value.slice(0, start) + token + area.value.slice(area.selectionEnd ?? start);
    area.focus();
    area.setSelectionRange(start + token.length, start + token.length);
  }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    showFormError(form, '');
    const f = form.elements;
    const body = {
      is_enabled: f.is_enabled.checked,
      chat_ids: f.chat_ids.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
      notify_new_order: f.notify_new_order.checked,
      notify_status_change: f.notify_status_change.checked,
      notify_callback: f.notify_callback.checked,
      message_template: f.message_template.value.trim() || null,
    };
    const button = form.querySelector('[type=submit]');
    setButtonLoading(button, true);
    try {
      await http('/admin/telegram', { method: 'PUT', body });
      toast('Telegram sozlamalari saqlandi.', 'success');
      render(ctx);
    } catch (err) {
      applyApiErrors(form, err);
    } finally {
      setButtonLoading(button, false);
    }
  });

  root.querySelector('[data-test]')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const box = root.querySelector('[data-test-result]');
    setButtonLoading(button, true);
    try {
      const results = await http('/admin/telegram/test', { method: 'POST', body: {} });
      box.innerHTML = results.map((r) => `<p>${r.ok ? '✅' : '❌'} <code>${escapeHtml(r.chat_id)}</code> ${r.ok ? 'yuborildi' : escapeHtml(r.error || '')}</p>`).join('');
      toast(results.every((r) => r.ok) ? 'Sinov xabari yuborildi.' : 'Ba’zi chatlarga yuborilmadi.', results.every((r) => r.ok) ? 'success' : 'warning');
    } catch (err) {
      box.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    } finally {
      setButtonLoading(button, false);
    }
  });

  root.querySelector('[data-bot-info]')?.addEventListener('click', async (e) => {
    const holder = root.querySelector('[data-bot-name]');
    setButtonLoading(e.currentTarget, true);
    try {
      const me = await http('/admin/telegram/bot-info', { method: 'POST', body: {} });
      holder.textContent = ` Bot: @${me.username}`;
    } catch (err) {
      holder.textContent = ` ${err.message}`;
    } finally {
      setButtonLoading(e.currentTarget, false);
    }
  });

  root.querySelector('[data-discover]')?.addEventListener('click', async (e) => {
    const holder = root.querySelector('[data-chats]');
    setButtonLoading(e.currentTarget, true);
    try {
      const chats = await http('/admin/telegram/discover-chats', { method: 'POST', body: {} });
      holder.innerHTML = chats.length
        ? `<p class="field__hint">Qo‘shish uchun bosing:</p><div class="chips">${chats.map((c) => `
            <button type="button" class="chip" data-add-chat="${escapeHtml(c.id)}">${escapeHtml(c.title || c.username || c.id)} · ${escapeHtml(c.id)}</button>`).join('')}</div>`
        : '<p class="field__hint">Chat topilmadi. Botga /start yozing yoki guruhda botni eslatib xabar yuboring, so‘ng qayta urinib ko‘ring.</p>';
      holder.querySelectorAll('[data-add-chat]').forEach((chip) => chip.addEventListener('click', () => {
        const area = form.elements.chat_ids;
        const ids = area.value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
        if (!ids.includes(chip.dataset.addChat)) area.value = [...ids, chip.dataset.addChat].join('\n');
        chip.classList.add('is-active');
        toast('Qo‘shildi. Saqlashni unutmang.', 'info', 2500);
      }));
    } catch (err) {
      holder.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    } finally {
      setButtonLoading(e.currentTarget, false);
    }
  });
}
