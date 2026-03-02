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
let _dateRange   = 'all';  // 'all' | 'last-month' | 'last-year'
let _sel         = new Set(); // selected client IDs for bulk actions

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container) {
  _container = container;
  _filter      = 'all';
  _searchQuery = '';
  _dateRange   = 'all';
  _sel         = new Set();

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

  if (_dateRange !== 'all') {
    const now    = new Date();
    const cutoff = _dateRange === 'last-month'
      ? new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    list = list.filter(c => {
      const d = new Date(c.createdAt ?? '');
      return !isNaN(d) && d >= cutoff;
    });
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

/* ── Bulk selection bar ──────────────────────────────────────────────────────── */
function updateBulkBar() {
  const bar = _container?.querySelector('#clients-bulk-bar');
  const cnt = _container?.querySelector('#clients-sel-count');
  if (!bar) return;
  bar.classList.toggle('active', _sel.size > 0);
  if (cnt) cnt.textContent = `${_sel.size} selected`;
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
        <td colspan="8">
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

  // Quick status — clicking the badge toggles active ↔ inactive directly
  tbody.querySelectorAll('[data-action="status-btn"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id     = Number(btn.dataset.id);
      const client = _allClients.find(c => c.id === id);
      if (!client) return;
      const newStatus = client.status === 'active' ? 'inactive' : 'active';
      try {
        await updateRecord('clients', id, { status: newStatus });
        client.status = newStatus;
        renderStats();
        renderTable(applyFilters());
        toast(`Status changed to ${ newStatus === 'active' ? 'Active' : 'Inactive' }.`, 'success');
      } catch (err) {
        console.error('[Clients] Status update error:', err);
        toast('Failed to update status.', 'error');
      }
    });
  });

  // ── Bulk-select checkboxes ─────────────────────────────────────────────────
  const allBoxes = tbody.querySelectorAll('[data-row-check]');
  const master   = _container?.querySelector('#clients-master-check');

  allBoxes.forEach(cb => {
    cb.checked = _sel.has(Number(cb.dataset.rowCheck));
    cb.addEventListener('change', () => {
      cb.checked ? _sel.add(Number(cb.dataset.rowCheck)) : _sel.delete(Number(cb.dataset.rowCheck));
      updateBulkBar();
      if (master) {
        master.indeterminate = _sel.size > 0 && _sel.size < allBoxes.length;
        master.checked       = allBoxes.length > 0 && _sel.size === allBoxes.length;
      }
    });
  });

  if (master) {
    master.indeterminate = _sel.size > 0 && _sel.size < allBoxes.length;
    master.checked       = allBoxes.length > 0 && _sel.size === allBoxes.length;
    master.onchange = () => {
      allBoxes.forEach(cb => {
        cb.checked = master.checked;
        master.checked ? _sel.add(Number(cb.dataset.rowCheck)) : _sel.delete(Number(cb.dataset.rowCheck));
      });
      updateBulkBar();
      master.indeterminate = false;
    };
  }

  updateBulkBar();
} ───────────────────────────────────────────────────────────── */
function rowHTML(c) {
  const bg  = avatarColor(c.name);
  const ini = initials(c.name);
  const badgeCls = c.status === 'active' ? 'badge-active' : 'badge-inactive';
  const statusLabel = c.status === 'active' ? 'Active' : 'Inactive';

  return `
    <tr data-id="${c.id}"
        class="border-b border-[var(--clr-border)] last:border-0 hover:bg-[var(--clr-surface-2)]/50 transition-colors duration-150">

      <!-- Checkbox -->
      <td class="td-cell w-8">
        <input type="checkbox" data-row-check="${c.id}" class="row-check"/>
      </td>

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

      <!-- Status — clickable badge opens floating fixed-position menu -->
      <td class="td-cell text-center">
        <button class="badge ${badgeCls} cursor-pointer"
                data-action="status-btn" data-id="${c.id}"
                title="Change status">
          ${statusLabel}
        </button>
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

  _container.querySelectorAll('[data-daterange]').forEach(btn => {
    btn.addEventListener('click', () => {
      _dateRange = btn.dataset.daterange;
      _container.querySelectorAll('[data-daterange]').forEach(b =>
        b.classList.toggle('filter-active', b.dataset.daterange === _dateRange)
      );
      renderTable(applyFilters());
    });
  });

  // ── Bulk bar actions ─────────────────────────────────────────────────────
  _container.querySelector('#clients-bulk-status')?.addEventListener('change', async (e) => {
    const newStatus = e.target.value;
    if (!newStatus || !_sel.size) { e.target.value = ''; return; }
    await Promise.all([..._sel].map(id => updateRecord('clients', id, { status: newStatus })));
    toast(`${_sel.size} client(s) updated to ${newStatus}.`, 'success');
    _sel.clear();
    await loadClients();
    e.target.value = '';
  });

  _container.querySelector('#clients-bulk-delete')?.addEventListener('click', () => {
    if (!_sel.size) return;
    openConfirm({
      title: 'Delete Selected',
      message: `Delete ${_sel.size} selected client(s)? This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        await Promise.all([..._sel].map(id => deleteRecord('clients', id)));
        toast(`${_sel.size} client(s) deleted.`, 'info');
        _sel.clear();
        await loadClients();
      },
    });
  });

  _container.querySelector('#clients-bulk-cancel')?.addEventListener('click', () => {
    _sel.clear();
    updateBulkBar();
    renderTable(applyFilters());
  });
} ─────────────────────────────────────────────────────────── */
function shellHTML() {
  return `
    <!-- Page header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
      <div>
        <h2 class="text-xl font-semibold text-[var(--clr-text)]">Clients</h2>
        <p class="text-sm text-[var(--clr-text-faint)] mt-0.5">Manage your client directory</p>
      </div>
      <button id="btn-add-client" class="btn btn-primary w-full sm:w-auto" title="Add Client (N)">
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

      <!-- Bulk action bar -->
      <div id="clients-bulk-bar" class="bulk-bar flex-wrap px-4 py-3 gap-3
           border-b border-[var(--clr-border)]"
           style="background:var(--clr-primary-dim)">
        <span id="clients-sel-count" class="text-sm font-semibold"
              style="color:var(--clr-primary-light)">0 selected</span>
        <div class="flex-1"></div>
        <select id="clients-bulk-status" class="form-select text-xs" style="width:auto;padding:.3rem .75rem">
          <option value="">— Change status —</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button id="clients-bulk-delete" class="btn btn-danger text-xs" style="padding:.375rem .875rem">Delete selected</button>
        <button id="clients-bulk-cancel" class="btn btn-ghost text-xs" style="padding:.375rem .875rem">Cancel</button>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--clr-border)] bg-[var(--clr-surface-2)]/50">
              <th class="th-cell w-8">
                <input type="checkbox" id="clients-master-check" class="row-check"
                       aria-label="Select all clients"/>
              </th>
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
              <td colspan="8">
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
      <div class="px-5 py-3 border-t border-[var(--clr-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--clr-surface-2)]/30">
        <p id="clients-count" class="text-xs text-[var(--clr-text-faint)]">— clients</p>
        <div class="flex items-center gap-1">
          <button class="filter-btn filter-active py-0.5 px-2 text-[11px]" data-daterange="all">All time</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-month">Last month</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-year">Last year</button>
        </div>
        <p class="text-xs hidden sm:block text-[var(--clr-text-faint)]">QFL Dashboard · 2026</p>
      </div>
    </div>`;
}
