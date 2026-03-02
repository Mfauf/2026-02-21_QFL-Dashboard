/**
 * settings.js — Settings module
 *
 * Sections:
 *  1. Profile        — freelancer name, company, email, phone, tagline
 *  2. Invoice        — invoice number prefix, default payment terms
 *  3. Project cats   — add / remove project category suggestions
 *  4. Income cats    — add / remove income category suggestions
 *  5. Expense cats   — add / remove expense category suggestions
 *  6. Data           — export JSON backup, import backup, delete all data + reset
 *
 * All settings persist in localStorage via settings-store.js.
 */

import { getSettings, saveSettings, DEFAULTS } from '../settings-store.js';
import { getAllRecords, clearStore, bulkAddRecords } from '../db.js';
import { toast, openConfirm }          from '../ui.js';
import { escapeHtml }                  from '../utils.js';
import { applyTheme }                  from '../theme.js';

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

  // Appearance
  updateThemeBtns(s.appearance?.theme ?? 'system');

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

/* ── Theme button active state ──────────────────────────────────────────── */
function updateThemeBtns(active) {
  _container?.querySelectorAll('[data-theme-btn]').forEach(btn => {
    const on = btn.dataset.themeBtn === active;
    btn.classList.toggle('filter-active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
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

/* ── Import data ────────────────────────────────────────────────────────── */
async function importData(file) {
  const btn = _container?.querySelector('#btn-import');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

  try {
    const text    = await file.text();
    const payload = JSON.parse(text);

    // Basic shape validation
    const STORES = ['clients', 'projects', 'transactions', 'invoices'];
    const missing = STORES.filter(s => !Array.isArray(payload[s]));
    if (missing.length) {
      throw new Error(`Invalid backup file — missing: ${missing.join(', ')}.`);
    }

    // Clear all stores then bulk-insert
    await Promise.all(STORES.map(s => clearStore(s)));
    await Promise.all(STORES.map(s => bulkAddRecords(s, payload[s])));

    // Restore settings if present (keep current avatar if backup has none)
    if (payload.settings && typeof payload.settings === 'object') {
      saveSettings(payload.settings);
      populate();                        // re-populate form fields
      window.refreshSidebarProfile?.();
    }

    const total = STORES.reduce((n, s) => n + (payload[s]?.length ?? 0), 0);
    toast(`Import complete — ${total} records restored.`, 'success');
  } catch (err) {
    console.error('[Settings] Import error:', err);
    toast(err.message || 'Import failed. Check the file and try again.', 'error');
  } finally {
    // Reset the file input so the same file can be re-selected
    const input = _container?.querySelector('#import-file-input');
    if (input) input.value = '';
    if (btn) { btn.disabled = false; btn.textContent = 'Import Backup'; }
  }
}

/* ── Reset / delete all data ────────────────────────────────────────────── */
function resetAllData() {
  openConfirm({
    title:        'Delete All Data',
    message:      'This will permanently erase ALL clients, projects, invoices, transactions and settings. This cannot be undone. Are you absolutely sure?',
    confirmLabel: 'Delete Everything',
    onConfirm: async () => {
      try {
        await Promise.all(
          ['clients', 'projects', 'transactions', 'invoices'].map(s => clearStore(s))
        );
        localStorage.removeItem('qfl_settings');
        window.refreshSidebarProfile?.();
        populate();   // reset form fields to defaults
        toast('All data deleted. App has been reset to defaults.', 'info');
      } catch (err) {
        console.error('[Settings] Reset error:', err);
        toast('Reset failed. Please try again.', 'error');
      }
    },
  });
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

  // ── Theme toggle
  _container.querySelectorAll('[data-theme-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.themeBtn;
      saveSettings({ appearance: { theme: pref } });
      applyTheme(pref);
      updateThemeBtns(pref);
      toast(`Theme set to ${pref}.`, 'success');
    });
  });

  // ── Export
  _container.querySelector('#btn-export')?.addEventListener('click', exportData);

  // ── Import: button opens hidden file picker
  _container.querySelector('#btn-import')?.addEventListener('click', () => {
    _container.querySelector('#import-file-input')?.click();
  });
  _container.querySelector('#import-file-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importData(file);
  });

  // ── Reset all data
  _container.querySelector('#btn-reset-all')?.addEventListener('click', resetAllData);
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
           SECTION 6 — Appearance
      ════════════════════════════════════════════════════════════ -->
      <div class="card p-6">
        <h3 class="text-base font-semibold text-[var(--clr-text)] mb-1">Appearance</h3>
        <p class="text-sm text-[var(--clr-text-faint)] mb-5">
          Choose how the dashboard looks.
          <em>System</em> automatically follows your device preference.
        </p>

        <div class="grid grid-cols-3 gap-3">

          <!-- System -->
          <button type="button" data-theme-btn="system"
                  class="filter-btn flex flex-col items-center gap-2 py-4 rounded-xl"
                  aria-pressed="false" aria-label="System theme">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0
                   012-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            <span class="text-xs font-medium">System</span>
          </button>

          <!-- Light -->
          <button type="button" data-theme-btn="light"
                  class="filter-btn flex flex-col items-center gap-2 py-4 rounded-xl"
                  aria-pressed="false" aria-label="Light theme">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707
                   M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707
                   M12 8a4 4 0 100 8 4 4 0 000-8z"/>
            </svg>
            <span class="text-xs font-medium">Light</span>
          </button>

          <!-- Dark -->
          <button type="button" data-theme-btn="dark"
                  class="filter-btn flex flex-col items-center gap-2 py-4 rounded-xl"
                  aria-pressed="false" aria-label="Dark theme">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003
                   9.003 0 008.354-5.646z"/>
            </svg>
            <span class="text-xs font-medium">Dark</span>
          </button>

        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════
           SECTION 7 — Data
      ════════════════════════════════════════════════════════════ -->
      <div class="card p-6">
        <h3 class="text-base font-semibold text-[var(--clr-text)] mb-1">Data</h3>
        <p class="text-sm text-[var(--clr-text-faint)] mb-6">
          Back up, restore, or permanently erase all your dashboard data.
        </p>

        <div class="space-y-5">

          <!-- Export -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3
                      p-4 rounded-xl" style="background:var(--clr-surface-2)">
            <div>
              <p class="text-sm font-medium text-[var(--clr-text)]">Export Backup</p>
              <p class="text-xs mt-0.5" style="color:var(--clr-text-faint)">
                Download all clients, projects, invoices, transactions and settings as a JSON file.
              </p>
            </div>
            <button id="btn-export" class="btn btn-ghost shrink-0 flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              Export Data
            </button>
          </div>

          <!-- Import -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3
                      p-4 rounded-xl" style="background:var(--clr-surface-2)">
            <div>
              <p class="text-sm font-medium text-[var(--clr-text)]">Import Backup</p>
              <p class="text-xs mt-0.5" style="color:var(--clr-text-faint)">
                Restore data from a previously exported JSON file.
                Existing data will be replaced.
              </p>
            </div>
            <!-- Hidden file input -->
            <input id="import-file-input" type="file" accept=".json,application/json" class="hidden"/>
            <button id="btn-import" class="btn btn-ghost shrink-0 flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4 4l4-4m0 0l4 4m-4-4v12"/>
              </svg>
              Import Backup
            </button>
          </div>

          <!-- Danger zone -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3
                      p-4 rounded-xl"
               style="background:var(--clr-danger-bg); border:1px solid var(--clr-danger-ring)">
            <div>
              <p class="text-sm font-semibold" style="color:var(--clr-danger)">Delete All Data</p>
              <p class="text-xs mt-0.5" style="color:var(--clr-text-faint)">
                Permanently erase every record and reset all settings.
                This action <strong style="color:var(--clr-danger)">cannot be undone</strong>.
              </p>
            </div>
            <button id="btn-reset-all" class="btn btn-danger shrink-0 flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0
                     01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0
                     00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
              Delete Everything
            </button>
          </div>

        </div>
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
