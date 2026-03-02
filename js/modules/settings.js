/**
 * settings.js — Settings module
 *
 * Sections:
 *  1. Profile        — freelancer name, company, email, phone, tagline
 *  2. Invoice        — invoice number prefix, default payment terms
 *  3. Project cats   — add / remove project category suggestions
 *  4. Income cats    — add / remove income category suggestions
 *  5. Expense cats   — add / remove expense category suggestions
 *  6. Data           — export all IndexedDB data as JSON
 *
 * All settings persist in localStorage via settings-store.js.
 */

import { getSettings, saveSettings }  from '../settings-store.js';
import { getAllRecords }               from '../db.js';
import { toast }                      from '../ui.js';
import { escapeHtml }                 from '../utils.js';

/* ── Module state ───────────────────────────────────────────────────────── */
let _container = null;

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export function mount(container) {
  _container = container;
  container.innerHTML = shellHTML();
  populate();
  bindAll();
}

export function unmount() {
  _container = null;
}

/* ── Populate all fields from stored settings ───────────────────────────── */
function populate() {
  const s = getSettings();

  // Profile fields
  _v('sp-name',     s.profile.name);
  _v('sp-company',  s.profile.company);
  _v('sp-email',    s.profile.email);
  _v('sp-phone',    s.profile.phone);
  _v('sp-tagline',  s.profile.tagline);

  // Avatar preview
  renderAvatarPreview(s.profile.avatar, s.profile.name);

  // Invoice defaults
  _v('si-prefix',  s.invoice.prefix);
  _v('si-terms',   s.invoice.paymentTerms);

  // Category chip lists
  renderChips('cats-project', s.categories.project);
  renderChips('cats-income',  s.categories.income);
  renderChips('cats-expense', s.categories.expense);
}

/* ── Avatar preview renderer ────────────────────────────────────────────── */
function renderAvatarPreview(avatarDataUrl, name) {
  const el = _container?.querySelector('#sp-avatar-preview');
  if (!el) return;

  if (avatarDataUrl) {
    el.innerHTML = `<img src="${avatarDataUrl}" alt="profile picture"
      class="w-full h-full object-cover" style="border-radius:inherit"/>`;
  } else {
    // Show initials as fallback
    const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    el.textContent = initials;
    el.style.background = 'linear-gradient(135deg,#60a5fa,#3b82f6)';
  }
}

/** Set value on a form element by id */
function _v(id, value) {
  const el = _container?.querySelector(`#${id}`);
  if (el) el.value = value ?? '';
}

/* ── Chips renderer ─────────────────────────────────────────────────────── */
function renderChips(listId, cats) {
  const el = _container?.querySelector(`#${listId}`);
  if (!el) return;

  el.innerHTML = cats.length
    ? cats.map(cat => `
        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium
                     transition-colors"
              style="background:var(--clr-surface-3); color:var(--clr-text);">
          ${escapeHtml(cat)}
          <button type="button"
                  data-remove="${escapeHtml(cat)}"
                  data-list="${listId}"
                  class="ml-0.5 leading-none text-base font-bold transition-colors
                         hover:text-[var(--clr-danger)]"
                  aria-label="Remove ${escapeHtml(cat)}"
                  style="color:var(--clr-text-faint)">×</button>
        </span>`).join('')
    : `<p class="text-sm" style="color:var(--clr-text-faint)">No categories yet. Add one below.</p>`;

  // Rebind remove buttons inside this list
  el.querySelectorAll('[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => removeCategory(btn.dataset.list, btn.dataset.remove))
  );
}

/* ── Category helpers ───────────────────────────────────────────────────── */
const LIST_TO_KEY = {
  'cats-project': 'project',
  'cats-income':  'income',
  'cats-expense': 'expense',
};

function addCategory(listId, value) {
  const key  = LIST_TO_KEY[listId];
  const cats = getSettings().categories[key];
  const trimmed = value.trim();

  if (!trimmed) return;
  if (cats.map(c => c.toLowerCase()).includes(trimmed.toLowerCase())) {
    toast(`"${trimmed}" already exists.`, 'info');
    return;
  }

  saveSettings({ categories: { [key]: [...cats, trimmed] } });
  renderChips(listId, getSettings().categories[key]);
  toast(`Category "${trimmed}" added.`, 'success');
}

function removeCategory(listId, value) {
  const key  = LIST_TO_KEY[listId];
  const cats = getSettings().categories[key].filter(c => c !== value);
  saveSettings({ categories: { [key]: cats } });
  renderChips(listId, cats);
  toast(`Category "${value}" removed.`, 'info');
}

/* ── Export data ────────────────────────────────────────────────────────── */
async function exportData() {
  const btn = _container?.querySelector('#btn-export');
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }

  try {
    const [clients, projects, transactions, invoices] = await Promise.all([
      getAllRecords('clients'),
      getAllRecords('projects'),
      getAllRecords('transactions'),
      getAllRecords('invoices'),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      settings:   getSettings(),
      clients,
      projects,
      transactions,
      invoices,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `qfl-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast('Data exported successfully.', 'success');
  } catch (err) {
    console.error('[Settings] Export error:', err);
    toast('Export failed. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Export Data'; }
  }
}

/* ── Bind all listeners ─────────────────────────────────────────────────── */
function bindAll() {
  // ── Avatar: clicking the preview triggers the hidden file input
  _container.querySelector('#sp-avatar-preview')?.addEventListener('click', () => {
    _container.querySelector('#sp-avatar-input')?.click();
  });

  // ── Avatar file picker
  _container.querySelector('#sp-avatar-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please select an image file.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024)    { toast('Image must be under 2 MB.',     'error'); return; }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      saveSettings({ profile: { avatar: dataUrl } });
      renderAvatarPreview(dataUrl, getSettings().profile.name);
      window.refreshSidebarProfile?.();
      toast('Profile picture updated.', 'success');
    };
    reader.readAsDataURL(file);
  });

  // ── Remove avatar
  _container.querySelector('#sp-avatar-remove')?.addEventListener('click', () => {
    saveSettings({ profile: { avatar: '' } });
    renderAvatarPreview('', getSettings().profile.name);
    window.refreshSidebarProfile?.();
    toast('Profile picture removed.', 'info');
  });

  // ── Profile save
  _container.querySelector('#form-profile')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    // Preserve existing avatar (file input not in FormData when unchanged)
    const currentAvatar = getSettings().profile.avatar;
    saveSettings({
      profile: {
        avatar:  currentAvatar,
        name:    fd.get('name')?.trim()    || '',
        company: fd.get('company')?.trim() || '',
        email:   fd.get('email')?.trim()   || '',
        phone:   fd.get('phone')?.trim()   || '',
        tagline: fd.get('tagline')?.trim() || '',
      },
    });
    window.refreshSidebarProfile?.();  // reflect in sidebar immediately
    toast('Profile saved.', 'success');
  });

  // ── Invoice defaults save
  _container.querySelector('#form-invoice')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    saveSettings({
      invoice: {
        prefix:       fd.get('prefix')?.trim()       || 'INV-',
        paymentTerms: fd.get('paymentTerms')?.trim() || '',
      },
    });
    toast('Invoice defaults saved.', 'success');
  });

  // ── Category add buttons
  ['project', 'income', 'expense'].forEach(type => {
    const listId = `cats-${type}`;
    const input  = _container.querySelector(`#cat-${type}-input`);
    const btnAdd = _container.querySelector(`#cat-${type}-add`);

    const doAdd = () => {
      if (!input?.value.trim()) return;
      addCategory(listId, input.value);
      input.value = '';
    };

    btnAdd?.addEventListener('click', doAdd);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  });

  // ── Export
  _container.querySelector('#btn-export')?.addEventListener('click', exportData);
}

/* ── Shell HTML ─────────────────────────────────────────────────────────── */
function shellHTML() {
  return `
    <!-- Page header -->
    <div class="mb-8">
      <h2 class="text-xl font-semibold text-[var(--clr-text)]">Settings</h2>
      <p class="text-sm text-[var(--clr-text-faint)] mt-0.5">Manage your profile, preferences and category lists</p>
    </div>

    <div class="space-y-8 w-full">

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 1 — Profile
      ════════════════════════════════════════════════════════════ -->
      <div class="card p-6">
        <h3 class="text-base font-semibold text-[var(--clr-text)] mb-1">Profile</h3>
        <p class="text-sm text-[var(--clr-text-faint)] mb-5">Your name and contact info shown on invoices and the dashboard.</p>

        <form id="form-profile" novalidate class="space-y-4">

          <!-- Avatar upload -->
          <div class="flex items-center gap-5 pb-2">
            <!-- Clickable avatar circle -->
            <div id="sp-avatar-preview"
                 class="avatar w-16 h-16 text-lg text-white shrink-0 cursor-pointer
                        overflow-hidden ring-2 ring-offset-2 transition-opacity hover:opacity-80"
                 style="ring-color:var(--clr-primary); ring-offset-color:var(--clr-surface)"
                 title="Click to upload a profile picture"></div>

            <!-- Hidden file input -->
            <input id="sp-avatar-input" type="file" accept="image/*" class="hidden"/>

            <div>
              <p class="text-sm font-medium text-[var(--clr-text)] mb-1">Profile Picture</p>
              <p class="text-xs text-[var(--clr-text-faint)] mb-2">Click the avatar to upload. JPG, PNG or WebP · max 2 MB.</p>
              <button id="sp-avatar-remove" type="button"
                      class="text-xs font-medium transition-colors hover:underline"
                      style="color:var(--clr-danger)">Remove photo</button>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="form-label" for="sp-name">Full Name</label>
              <input id="sp-name" name="name" type="text" class="form-input"
                     placeholder="e.g. Mohammed Al-Fauzi" autocomplete="name"/>
            </div>
            <div>
              <label class="form-label" for="sp-company">Company / Brand</label>
              <input id="sp-company" name="company" type="text" class="form-input"
                     placeholder="e.g. QFL Studio" autocomplete="organization"/>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="form-label" for="sp-email">Email</label>
              <input id="sp-email" name="email" type="email" class="form-input"
                     placeholder="you@example.com" autocomplete="email"/>
            </div>
            <div>
              <label class="form-label" for="sp-phone">Phone</label>
              <input id="sp-phone" name="phone" type="tel" class="form-input"
                     placeholder="+974 5555 0000" autocomplete="tel"/>
            </div>
          </div>

          <div>
            <label class="form-label" for="sp-tagline">Tagline / Bio</label>
            <input id="sp-tagline" name="tagline" type="text" class="form-input"
                   placeholder="e.g. Freelance designer based in Doha, Qatar"/>
          </div>

          <div class="flex justify-end pt-1">
            <button type="submit" class="btn btn-primary">Save Profile</button>
          </div>
        </form>
      </div>

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 2 — Invoice Defaults
      ════════════════════════════════════════════════════════════ -->
      <div class="card p-6">
        <h3 class="text-base font-semibold text-[var(--clr-text)] mb-1">Invoice Defaults</h3>
        <p class="text-sm text-[var(--clr-text-faint)] mb-5">Defaults applied when creating new invoices.</p>

        <form id="form-invoice" novalidate class="space-y-4">
          <div>
            <label class="form-label" for="si-prefix">Invoice Number Prefix</label>
            <input id="si-prefix" name="prefix" type="text" class="form-input"
                   placeholder="INV-" maxlength="10" autocomplete="off"/>
            <p class="text-xs mt-1.5" style="color:var(--clr-text-faint)">
              The prefix used when auto-generating invoice numbers (e.g. <code class="font-mono">INV-0001</code>).
            </p>
          </div>

          <div>
            <label class="form-label" for="si-terms">Default Payment Terms</label>
            <textarea id="si-terms" name="paymentTerms" class="form-textarea"
                      placeholder="Payment is due within 30 days of the invoice date."></textarea>
          </div>

          <div class="flex justify-end pt-1">
            <button type="submit" class="btn btn-primary">Save Defaults</button>
          </div>
        </form>
      </div>

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 3 — Project Categories
      ════════════════════════════════════════════════════════════ -->
      ${categorySection({
        id:          'project',
        title:       'Project Categories',
        description: 'Suggested categories shown when creating or editing projects.',
        placeholder: 'e.g. Motion Graphics',
      })}

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 4 — Income Categories
      ════════════════════════════════════════════════════════════ -->
      ${categorySection({
        id:          'income',
        title:       'Income Categories',
        description: 'Suggested categories for income transactions.',
        placeholder: 'e.g. License Fee',
      })}

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 5 — Expense Categories
      ════════════════════════════════════════════════════════════ -->
      ${categorySection({
        id:          'expense',
        title:       'Expense Categories',
        description: 'Suggested categories for expense transactions.',
        placeholder: 'e.g. Legal Fees',
      })}

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 6 — Data
      ════════════════════════════════════════════════════════════ -->
      <div class="card p-6">
        <h3 class="text-base font-semibold text-[var(--clr-text)] mb-1">Data</h3>
        <p class="text-sm text-[var(--clr-text-faint)] mb-5">
          Export all your data from IndexedDB as a JSON backup file.
        </p>
        <button id="btn-export" class="btn btn-ghost flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          Export Data
        </button>
      </div>

    </div>`;
}

/* ── Category section partial ───────────────────────────────────────────── */
function categorySection({ id, title, description, placeholder }) {
  return `
    <div class="card p-6">
      <h3 class="text-base font-semibold text-[var(--clr-text)] mb-1">${title}</h3>
      <p class="text-sm text-[var(--clr-text-faint)] mb-4">${description}</p>

      <!-- Chips -->
      <div id="cats-${id}" class="flex flex-wrap gap-2 mb-4 min-h-[2rem]"></div>

      <!-- Add input -->
      <div class="flex gap-2">
        <input id="cat-${id}-input" type="text" class="form-input flex-1"
               placeholder="${placeholder}" autocomplete="off" maxlength="40"/>
        <button id="cat-${id}-add" type="button" class="btn btn-primary shrink-0">
          Add
        </button>
      </div>
    </div>`;
}
