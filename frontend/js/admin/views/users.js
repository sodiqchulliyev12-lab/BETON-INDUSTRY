/** Foydalanuvchilar (faqat administrator). */
import { http } from '../http.js';
import { session } from '../auth.js';
import { ROLES, emptyRow, errorHtml, escapeHtml, field, fmtDateTime, formModal, icon, loadingHtml, localErrors, toast } from '../components.js';

const ROLE_HINTS = {
  admin: 'Barcha bo‘limlar, foydalanuvchilar va sozlamalar',
  manager: 'Buyurtmalar, narxlar, markalar, mijozlar',
  dispatcher: 'Buyurtmalarni ko‘rish, rejalashtirish, yuklash va yetkazish holatlari',
  production: 'Buyurtmalarni ko‘rish, ishlab chiqarish va sifat nazorati holatlari',
  viewer: 'Faqat ko‘rish',
};

const roleOptions = Object.entries(ROLES).map(([value, label]) => ({ value, label: `${label} — ${ROLE_HINTS[value]}` }));

function passwordProblems(value) {
  const problems = [];
  if (value.length < 10) problems.push('kamida 10 ta belgi');
  if (!/\p{L}/u.test(value)) problems.push('kamida bitta harf');
  if (!/\d/.test(value)) problems.push('kamida bitta raqam');
  return problems.length ? `Parol: ${problems.join(', ')}.` : null;
}

export async function render(ctx) {
  const { root, isCurrent } = ctx;
  root.innerHTML = `
    <div class="page-actions">
      <p class="text-muted">Har bir xodim o‘z login va paroli bilan kiradi. Parollar bazada shifrlangan (hash) holda saqlanadi.</p>
      <span class="page-actions__spacer"></span>
      <button type="button" class="btn btn--primary" data-create>${icon('i-plus')} Yangi foydalanuvchi</button>
    </div>
    <section class="box" id="usersBox">${loadingHtml()}</section>`;
  root.querySelector('[data-create]').addEventListener('click', () => createForm(() => render(ctx)));

  const box = root.querySelector('#usersBox');
  let users;
  try {
    users = await http('/admin/users');
  } catch (err) {
    box.innerHTML = errorHtml(err);
    box.querySelector('[data-retry]').addEventListener('click', () => render(ctx));
    return;
  }
  if (!isCurrent()) return;

  box.innerHTML = `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Ism</th><th>Login</th><th>Rol</th><th>Holat</th><th>Oxirgi kirish</th><th></th></tr></thead>
      <tbody>${users.length ? users.map((u) => `
        <tr data-id="${u.id}">
          <td class="strong">${escapeHtml(u.full_name)}${u.id === session.user.id ? ' <span class="badge">Siz</span>' : ''}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(ROLES[u.role] || u.role)}</td>
          <td>${u.is_active ? '<span class="status status--delivered">Faol</span>' : '<span class="status status--cancelled">Bloklangan</span>'}</td>
          <td class="muted nowrap">${u.last_login_at ? fmtDateTime(u.last_login_at) : 'Hali kirmagan'}</td>
          <td class="num nowrap">
            <button type="button" class="icon-btn" data-edit title="Tahrirlash" aria-label="Tahrirlash">${icon('i-edit')}</button>
            <button type="button" class="icon-btn" data-password title="Parolni almashtirish" aria-label="Parolni almashtirish">${icon('i-key')}</button>
          </td>
        </tr>`).join('') : emptyRow(6, 'Foydalanuvchilar yo‘q.')}
      </tbody></table></div>`;

  box.querySelectorAll('tr[data-id]').forEach((row) => {
    const user = users.find((u) => u.id === Number(row.dataset.id));
    row.querySelector('[data-edit]').addEventListener('click', () => editForm(user, () => render(ctx)));
    row.querySelector('[data-password]').addEventListener('click', () => passwordForm(user));
  });
}

function createForm(onSaved) {
  formModal({
    title: 'Yangi foydalanuvchi',
    body: `
      ${field({ name: 'full_name', label: 'Ism-familiya', required: true, attrs: 'maxlength="150"' })}
      ${field({ name: 'username', label: 'Login', required: true, attrs: 'maxlength="50" autocapitalize="off" spellcheck="false" autocomplete="off"', hint: 'Lotin kichik harflari, raqamlar, "_" yoki "."' })}
      ${field({ name: 'role', label: 'Rol', options: roleOptions, value: 'manager', required: true })}
      ${field({ name: 'password', label: 'Boshlang‘ich parol', type: 'password', required: true, attrs: 'autocomplete="new-password"', hint: 'Kamida 10 belgi, harf va raqam. Xodimga xavfsiz yo‘l bilan yetkazing.' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, {
        full_name: f.full_name.value.trim().length >= 2 ? null : 'Ismni kiriting.',
        username: /^[a-z0-9_.]{3,50}$/.test(f.username.value.trim().toLowerCase()) ? null : 'Login 3–50 belgi: lotin harflari, raqam, "_" yoki ".".',
        password: passwordProblems(f.password.value),
      });
      await http('/admin/users', {
        method: 'POST',
        body: { full_name: f.full_name.value.trim(), username: f.username.value.trim().toLowerCase(), role: f.role.value, password: f.password.value },
      });
      toast('Foydalanuvchi yaratildi.', 'success');
      onSaved();
    },
  });
}

function editForm(user, onSaved) {
  formModal({
    title: `${user.full_name} — tahrirlash`,
    body: `
      ${field({ name: 'full_name', label: 'Ism-familiya', value: user.full_name, required: true, attrs: 'maxlength="150"' })}
      ${field({ name: 'role', label: 'Rol', options: roleOptions, value: user.role, required: true })}
      ${field({ name: 'is_active', label: 'Faol (tizimga kira oladi)', type: 'checkbox', value: user.is_active, hint: 'Bloklansa yoki roli o‘zgarsa, barcha ochiq sessiyalari darhol tugaydi.' })}`,
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, { full_name: f.full_name.value.trim().length >= 2 ? null : 'Ismni kiriting.' });
      await http(`/admin/users/${user.id}`, {
        method: 'PATCH',
        body: { full_name: f.full_name.value.trim(), role: f.role.value, is_active: f.is_active.checked },
      });
      toast('Saqlandi.', 'success');
      onSaved();
    },
  });
}

function passwordForm(user) {
  formModal({
    title: `${user.full_name} — yangi parol`,
    submitLabel: 'Parolni almashtirish',
    body: `
      ${field({ name: 'password', label: 'Yangi parol', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}
      ${field({ name: 'password2', label: 'Parolni takrorlang', type: 'password', required: true, attrs: 'autocomplete="new-password"' })}
      <p class="text-muted">Parol almashtirilgach, foydalanuvchining barcha qurilmalardagi sessiyalari tugaydi.</p>`,
    onSubmit: async (form) => {
      const f = form.elements;
      localErrors(form, {
        password: passwordProblems(f.password.value),
        password2: f.password.value === f.password2.value ? null : 'Parollar mos kelmadi.',
      });
      await http(`/admin/users/${user.id}/password`, { method: 'POST', body: { password: f.password.value } });
      toast('Parol almashtirildi.', 'success');
    },
  });
}
