/**
 * clients.js — Clients module (CRUDS)
 *
 * Operations:
 *  C — Create  : openAddModal()
 *  R — Read    : loadClients() → renderTable()
 *  U — Update  : openEditModal(id)
 *  D — Delete  : confirmDelete(id)
 *  S — Search  : live search + status filter
 */

import { addRecord, getAllRecords, updateRecord, deleteRecord, getByIndex } from '../db.js';
import { toast, openModal, openConfirm } from '../ui.js';
import { formatDate, initials, avatarColor, escapeHtml, matchesSearch, debounce } from '../utils.js';

/* ── Module state ───────────────────────────────────────────────────────── */
let _allClients  = [];
let _filter      = 'all';  // 'all' | 'active' | 'inactive'
let _searchQuery = '';
let _container   = null;   // root DOM element set by mount()

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container) {
  _container = container;
  _filter      = 'all';
  _searchQuery = '';

  container.innerHTML = shellHTML();
  bindListeners();
  await loadClients();
}

export function unmount() {
  _container = null;
}

/* ── Load all clients from DB ───────────────────────────────────────────── */
async function loadClients() {
  try {
    _allClients = await getAllRecords('clients');
    renderStats();
    renderTable(applyFilters());
  } catch (err) {
    console.error('[Clients] Load error:', err);
    toast('Failed to load clients.', 'error');
  }
}

/* ── Apply search + status filter ──────────────────────────────────────── */
function applyFilters() {
  let list = _allClients;

  if (_filter !== 'all') {
    list = list.filter(c => c.status === _filter);
  }

  if (_searchQuery.trim()) {
    list = list.filter(c =>
      matchesSearch(c, ['name', 'company', 'email', 'phone', 'city', 'country'], _searchQuery)
    );
  }

  return list;
}

/* ── Render: stats row ──────────────────────────────────────────────────── */
function renderStats() {
  const el = _container?.querySelector('#clients-stats');
  if (!el) return;

  const total    = _allClients.length;
  const active   = _allClients.filter(c => c.status === 'active').length;
  const inactive = _allClients.filter(c => c.status === 'inactive').length;

  el.innerHTML = `
    ${miniStat('Total Clients',    total,    'blue')}
    ${miniStat('Active',           active,   'emerald')}
    ${miniStat('Inactive',         inactive, 'red')}`;
}

function miniStat(label, value, color) {
  const colors = {
    blue:    { bg: 'var(--clr-primary-dim)',  text: 'var(--clr-primary-light)', border: 'var(--clr-primary-ring)' },
    emerald: { bg: 'var(--clr-success-bg)',   text: 'var(--clr-success)',        border: 'var(--clr-success-ring)' },
    red:     { bg: 'var(--clr-danger-bg)',    text: 'var(--clr-danger)',         border: 'var(--clr-danger-ring)'  },
  };
  const c = colors[color];
  return `
    <div class="card flex items-center gap-4 px-5 py-4" style="border-color:${c.border}; background:${c.bg}">
      <span class="text-2xl font-bold" style="color:${c.text}">${value}</span>
      <span class="text-xs font-semibold uppercase tracking-wider text-[var(--clr-text-muted)]">${label}</span>
    </div>`;
}

/* ── Render: clients table ──────────────────────────────────────────────── */
function renderTable(clients) {
  const tbody = _container?.querySelector('#clients-tbody');
  const count = _container?.querySelector('#clients-count');
  if (!tbody) return;

  if (count) {
    count.textContent = `${clients.length} client${clients.length !== 1 ? 's' : ''}`;
  }

  if (!clients.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857
                   M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0
                   019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <p class="font-medium text-[var(--clr-text-muted)]">No clients found</p>
            <p>${_searchQuery || _filter !== 'all' ? 'Try adjusting your search or filter.' : 'Add your first client to get started.'}</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = clients.map(c => rowHTML(c)).join('');

  // Attach row action listeners
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)));
  });
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => confirmDelete(Number(btn.dataset.id), btn.dataset.name));
  });

  // Quick status dropdown — toggle open/close
  tbody.querySelectorAll('[data-action="status-btn"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id   = btn.dataset.id;
      const menu = tbody.querySelector(`[data-status-menu="${id}"]`);
      // Close any other open menus first
      tbody.querySelectorAll('.status-menu').forEach(m => {
        if (m !== menu) m.classList.add('hidden');
      });
      menu?.classList.toggle('hidden');
    });
  });

  // Quick status — set new value
  tbody.querySelectorAll('[data-action="set-status"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id     = Number(btn.dataset.id);
      const status = btn.dataset.status;
      // Close the menu immediately for snappy UX
      btn.closest('.status-menu')?.classList.add('hidden');
      try {
        await updateRecord('clients', id, { status });
        // Patch the local cache so we don't reload the whole list
        const client = _allClients.find(c => c.id === id);
        if (client) client.status = status;
        renderStats();
        renderTable(applyFilters());
        toast(`Status updated to ${ status === 'active' ? 'Active' : 'Inactive' }.`, 'success');
      } catch (err) {
        console.error('[Clients] Status update error:', err);
        toast('Failed to update status.', 'error');
      }
    });
  });
}

/* ── Row HTML ───────────────────────────────────────────────────────────── */
function rowHTML(c) {
  const bg  = avatarColor(c.name);
  const ini = initials(c.name);
  const badgeCls = c.status === 'active' ? 'badge-active' : 'badge-inactive';
  const statusLabel = c.status === 'active' ? 'Active' : 'Inactive';

  return `
    <tr class="border-b border-[var(--clr-border)] last:border-0 hover:bg-[var(--clr-surface-2)]/50 transition-colors duration-150">

      <!-- Name + Avatar -->
      <td class="td-cell">
        <div class="flex items-center gap-3">
          <div class="avatar w-9 h-9 text-white shrink-0" style="background:${bg}">${escapeHtml(ini)}</div>
          <div class="min-w-0">
            <p class="font-medium text-[var(--clr-text)] truncate">${escapeHtml(c.name)}</p>
            <p class="text-xs truncate" style="color:var(--clr-text-faint)">${c.company ? escapeHtml(c.company) : '<em>Individual</em>'}</p>
          </div>
        </div>
      </td>

      <!-- Email -->
      <td class="td-cell hidden md:table-cell">
        <a href="mailto:${escapeHtml(c.email)}"
           class="text-sm text-[var(--clr-text-muted)] hover:text-[var(--clr-primary-light)] transition-colors truncate block max-w-[14rem]">
          ${escapeHtml(c.email || '—')}
        </a>
      </td>

      <!-- Phone -->
      <td class="td-cell hidden lg:table-cell text-sm text-[var(--clr-text-muted)]">
        ${escapeHtml(c.phone || '—')}
      </td>

      <!-- Location -->
      <td class="td-cell hidden lg:table-cell text-sm text-[var(--clr-text-muted)]">
        ${[c.city, c.country].filter(Boolean).map(escapeHtml).join(', ') || '—'}
      </td>

      <!-- Status — clickable badge opens quick-change dropdown -->
      <td class="td-cell">
        <div class="relative inline-block">
          <button class="badge ${badgeCls} flex items-center gap-1 cursor-pointer"
                  data-action="status-btn" data-id="${c.id}"
                  title="Change status">
            ${statusLabel}
            <svg class="w-3 h-3 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          <div class="status-menu hidden absolute left-0 top-full mt-1 z-20 rounded-lg shadow-lg overflow-hidden"
               style="min-width:7rem; background:var(--clr-surface-2); border:1px solid var(--clr-border)"
               data-status-menu="${c.id}">
            <button class="w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2
                           transition-colors hover:bg-[var(--clr-surface-3)]"
                    data-action="set-status" data-id="${c.id}" data-status="active">
              <span class="badge badge-active pointer-events-none">Active</span>
            </button>
            <button class="w-full text-left px-3 py-2 text-xs font-medium flex items-center gap-2
                           transition-colors hover:bg-[var(--clr-surface-3)]"
                    data-action="set-status" data-id="${c.id}" data-status="inactive">
              <span class="badge badge-inactive pointer-events-none">Inactive</span>
            </button>
          </div>
        </div>
      </td>

      <!-- Added -->
      <td class="td-cell hidden md:table-cell text-xs text-[var(--clr-text-faint)] whitespace-nowrap">
        ${formatDate(c.createdAt)}
      </td>

      <!-- Actions -->
      <td class="td-cell text-right">
        <div class="flex items-center justify-end gap-1">
          <button data-action="edit" data-id="${c.id}"
                  class="btn btn-icon" title="Edit client" aria-label="Edit ${escapeHtml(c.name)}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0
                   112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button data-action="delete" data-id="${c.id}" data-name="${escapeHtml(c.name)}"
                  class="btn btn-icon" title="Delete client" aria-label="Delete ${escapeHtml(c.name)}">
            <svg class="w-4 h-4 text-[var(--clr-danger)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;
}

/* ── Form HTML (shared by add + edit) ───────────────────────────────────── */
function formHTML(client = {}) {
  const v = (k) => escapeHtml(client[k] ?? '');
  const sel = (val, opt) => val === opt ? 'selected' : '';
  return `
    <div class="p-6 space-y-5">
      <!-- Row 1: Name + Company -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="cf-name">Full Name <span class="text-[var(--clr-danger)]">*</span></label>
          <input id="cf-name" name="name" type="text" class="form-input"
                 placeholder="e.g. Ahmed Al-Mansoori" value="${v('name')}" required autocomplete="off"/>
        </div>
        <div>
          <label class="form-label" for="cf-company">Company / Organisation</label>
          <input id="cf-company" name="company" type="text" class="form-input"
                 placeholder="e.g. Qatar Tech Solutions" value="${v('company')}" autocomplete="off"/>
        </div>
      </div>

      <!-- Row 2: Email + Phone -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="cf-email">Email Address</label>
          <input id="cf-email" name="email" type="email" class="form-input"
                 placeholder="email@example.com" value="${v('email')}" autocomplete="off"/>
        </div>
        <div>
          <label class="form-label" for="cf-phone">Phone Number</label>
          <input id="cf-phone" name="phone" type="tel" class="form-input"
                 placeholder="+974 5555 0000" value="${v('phone')}" autocomplete="off"/>
        </div>
      </div>

      <!-- Row 3: City + Country -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="cf-city">City</label>
          <input id="cf-city" name="city" type="text" class="form-input"
                 placeholder="e.g. Doha" value="${v('city')}" autocomplete="off"/>
        </div>
        <div>
          <label class="form-label" for="cf-country">Country</label>
          <input id="cf-country" name="country" type="text" class="form-input"
                 placeholder="e.g. Qatar" value="${v('country')}" autocomplete="off"/>
        </div>
      </div>

      <!-- Row 4: Status -->
      <div>
        <label class="form-label" for="cf-status">Status</label>
        <select id="cf-status" name="status" class="form-select">
          <option value="active"   ${sel(client.status ?? 'active', 'active')}>Active</option>
          <option value="inactive" ${sel(client.status, 'inactive')}>Inactive</option>
        </select>
      </div>

      <!-- Row 5: Notes -->
      <div>
        <label class="form-label" for="cf-notes">Notes</label>
        <textarea id="cf-notes" name="notes" class="form-textarea"
                  placeholder="Any additional notes about this client…">${v('notes')}</textarea>
      </div>
    </div>`;
}

/* ── Add modal ──────────────────────────────────────────────────────────── */
function openAddModal() {
  openModal({
    title: 'Add New Client',
    bodyHTML: formHTML(),
    submitLabel: 'Add Client',
    onSubmit: async (fd) => {
      const data = {
        name:    fd.get('name').trim(),
        company: fd.get('company').trim(),
        email:   fd.get('email').trim(),
        phone:   fd.get('phone').trim(),
        city:    fd.get('city').trim(),
        country: fd.get('country').trim(),
        status:  fd.get('status'),
        notes:   fd.get('notes').trim(),
      };

      if (!data.name) throw new Error('Name is required');

      await addRecord('clients', data);
      toast(`Client "${data.name}" added successfully.`, 'success');
      await loadClients();
    },
  });
}

/* ── Edit modal ─────────────────────────────────────────────────────────── */
async function openEditModal(id) {
  const client = _allClients.find(c => c.id === id);
  if (!client) { toast('Client not found.', 'error'); return; }

  openModal({
    title: 'Edit Client',
    bodyHTML: formHTML(client),
    submitLabel: 'Save Changes',
    onSubmit: async (fd) => {
      const updates = {
        name:    fd.get('name').trim(),
        company: fd.get('company').trim(),
        email:   fd.get('email').trim(),
        phone:   fd.get('phone').trim(),
        city:    fd.get('city').trim(),
        country: fd.get('country').trim(),
        status:  fd.get('status'),
        notes:   fd.get('notes').trim(),
      };

      if (!updates.name) throw new Error('Name is required');

      await updateRecord('clients', id, updates);
      toast(`Client "${updates.name}" updated.`, 'success');
      await loadClients();
    },
  });
}

/* ── Delete ─────────────────────────────────────────────────────────────── */
function confirmDelete(id, name) {
  openConfirm({
    title:        'Delete Client',
    message:      `Are you sure you want to delete "${name}"? This action cannot be undone.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await deleteRecord('clients', id);
      toast(`Client "${name}" deleted.`, 'info');
      await loadClients();
    },
  });
}

/* ── Bind UI listeners ──────────────────────────────────────────────────── */
function bindListeners() {
  // Add client button
  _container.querySelector('#btn-add-client')?.addEventListener('click', openAddModal);
  // Close any open status dropdowns when clicking outside the table
  document.addEventListener('click', () => {
    _container?.querySelectorAll('.status-menu').forEach(m => m.classList.add('hidden'));
  }, { capture: false });
  // Search input (debounced)
  const searchInput = _container.querySelector('#clients-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      _searchQuery = searchInput.value;
      renderTable(applyFilters());
    }, 200));
  }

  // Status filter buttons
  _container.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter = btn.dataset.filter;
      // Update active state
      _container.querySelectorAll('[data-filter]').forEach(b =>
        b.classList.toggle('filter-active', b.dataset.filter === _filter)
      );
      renderTable(applyFilters());
    });
  });
}

/* ── Shell HTML ─────────────────────────────────────────────────────────── */
function shellHTML() {
  return `
    <!-- Page header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-xl font-semibold text-[var(--clr-text)]">Clients</h2>
        <p class="text-sm text-[var(--clr-text-faint)] mt-0.5">Manage your client directory</p>
      </div>
      <button id="btn-add-client" class="btn btn-primary w-full sm:w-auto">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        Add Client
      </button>
    </div>

    <!-- Stats row -->
    <div id="clients-stats" class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
      <div class="card-skeleton rounded-xl h-16"></div>
      <div class="card-skeleton rounded-xl h-16"></div>
      <div class="card-skeleton rounded-xl h-16"></div>
    </div>

    <!-- Table card -->
    <div class="card overflow-hidden">

      <!-- Toolbar: search + filter -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4 border-b border-[var(--clr-border)]">

        <!-- Search -->
        <div class="relative flex-1">
          <svg class="w-4 h-4 text-[var(--clr-text-faint)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
               fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input id="clients-search" type="search" placeholder="Search by name, company, email…"
                 class="form-input pl-9 text-sm"
                 style="background:var(--clr-surface-2)"/>
        </div>

        <!-- Filter pills -->
        <div class="flex items-center gap-2 shrink-0">
          <button class="filter-btn filter-active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="active">Active</button>
          <button class="filter-btn" data-filter="inactive">Inactive</button>
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--clr-border)] bg-[var(--clr-surface-2)]/50">
              <th class="th-cell text-left">Client</th>
              <th class="th-cell text-left hidden md:table-cell">Email</th>
              <th class="th-cell text-left hidden lg:table-cell">Phone</th>
              <th class="th-cell text-left hidden lg:table-cell">Location</th>
              <th class="th-cell text-center">Status</th>
              <th class="th-cell text-left hidden md:table-cell">Added</th>
              <th class="th-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="clients-tbody">
            <tr>
              <td colspan="7">
                <div class="empty-state">
                  <svg class="w-8 h-8 animate-spin text-[var(--clr-surface-3)]" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Footer -->
      <div class="px-5 py-3 border-t border-[var(--clr-border)] flex items-center justify-between bg-[var(--clr-surface-2)]/30">
        <p id="clients-count" class="text-xs text-[var(--clr-text-faint)]">— clients</p>
        <p class="text-xs text-[var(--clr-text-faint)]">QFL Dashboard · 2026</p>
      </div>
    </div>`;
}
