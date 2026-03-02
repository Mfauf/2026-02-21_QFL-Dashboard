/**
 * projects.js — Projects module (CRUDS)
 *
 * Operations:
 *  C — Create  : openAddModal()
 *  R — Read    : loadProjects() → renderTable()
 *  U — Update  : openEditModal(id)
 *  D — Delete  : confirmDelete(id)
 *  S — Search  : live search by name/client/category + status filter
 *
 * Each project can be linked to a client (clientId).
 * Client names are resolved at render time from the cached clients list.
 */

import { addRecord, getAllRecords, updateRecord, deleteRecord } from '../db.js';
import { toast, openModal, openConfirm }                       from '../ui.js';
import { formatDate, formatQAR, escapeHtml, matchesSearch, debounce } from '../utils.js';

/* ── Module state ───────────────────────────────────────────────────────── */
let _projects  = [];   // all projects from DB
let _clients   = [];   // all clients from DB (for dropdown + name resolution)
let _filter    = 'all';
let _searchQ   = '';
let _container = null;

/* ── Project status config ──────────────────────────────────────────────── */
const STATUSES = [
  { value: 'in-progress', label: 'In Progress', badge: 'badge-progress'  },
  { value: 'complete',    label: 'Complete',    badge: 'badge-complete'   },
  { value: 'on-hold',     label: 'On Hold',     badge: 'badge-on-hold'    },
  { value: 'cancelled',   label: 'Cancelled',   badge: 'badge-cancelled'  },
];

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container) {
  _container = container;
  _filter    = 'all';
  _searchQ   = '';

  container.innerHTML = shellHTML();
  bindListeners();
  await loadProjects();
}

export function unmount() {
  _container = null;
}

/* ── Load data from DB ──────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    // Load both in parallel
    [_projects, _clients] = await Promise.all([
      getAllRecords('projects'),
      getAllRecords('clients'),
    ]);
    renderStats();
    renderTable(applyFilters());
  } catch (err) {
    console.error('[Projects] Load error:', err);
    toast('Failed to load projects.', 'error');
  }
}

/* ── Resolve client name from id ────────────────────────────────────────── */
function clientName(clientId) {
  if (!clientId) return '—';
  return _clients.find(c => c.id === Number(clientId))?.name ?? '—';
}

/* ── Apply search + status filters ─────────────────────────────────────── */
function applyFilters() {
  let list = _projects;

  if (_filter !== 'all') {
    list = list.filter(p => p.status === _filter);
  }

  if (_searchQ.trim()) {
    list = list.filter(p => {
      // Include resolved client name in search scope
      const withClient = { ...p, clientName: clientName(p.clientId) };
      return matchesSearch(withClient, ['name', 'category', 'clientName', 'notes'], _searchQ);
    });
  }

  return list;
}

/* ── Render: stats row ──────────────────────────────────────────────────── */
function renderStats() {
  const el = _container?.querySelector('#projects-stats');
  if (!el) return;

  const total      = _projects.length;
  const inProgress = _projects.filter(p => p.status === 'in-progress').length;
  const complete   = _projects.filter(p => p.status === 'complete').length;
  const totalValue = _projects.reduce((s, p) => s + Number(p.amount || 0), 0);

  el.innerHTML = `
    ${miniStat('Total',       total,                         'blue')}
    ${miniStat('In Progress', inProgress,                    'yellow')}
    ${miniStat('Complete',    complete,                      'emerald')}
    ${miniStat('Total Value', formatQAR(totalValue, true),   'violet')}`;
}

function miniStat(label, value, color) {
  const map = {
    blue:    { bg: 'var(--clr-primary-dim)',  text: 'var(--clr-primary-light)', border: 'var(--clr-primary-ring)' },
    emerald: { bg: 'var(--clr-success-bg)',   text: 'var(--clr-success)',        border: 'var(--clr-success-ring)' },
    yellow:  { bg: 'var(--clr-warning-bg)',   text: 'var(--clr-warning)',        border: 'var(--clr-warning-ring)' },
    violet:  { bg: 'var(--clr-info-bg)',      text: 'var(--clr-info)',           border: 'var(--clr-info-ring)'    },
  };
  const c = map[color];
  return `
    <div class="card flex items-center gap-4 px-5 py-4" style="border-color:${c.border}; background:${c.bg}">
      <span class="text-2xl font-bold" style="color:${c.text}">${value}</span>
      <span class="text-xs font-semibold uppercase tracking-wider text-[var(--clr-text-muted)]">${label}</span>
    </div>`;
}

/* ── Render: projects table ─────────────────────────────────────────────── */
function renderTable(projects) {
  const tbody = _container?.querySelector('#projects-tbody');
  const count = _container?.querySelector('#projects-count');
  if (!tbody) return;

  if (count) count.textContent = `${projects.length} project${projects.length !== 1 ? 's' : ''}`;

  if (!projects.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0
                 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
          </svg>
          <p class="font-medium text-[var(--clr-text-muted)]">No projects found</p>
          <p>${_searchQ || _filter !== 'all' ? 'Try adjusting your search or filter.' : 'Add your first project to get started.'}</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = projects.map(p => rowHTML(p)).join('');

  // Bind row action buttons
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)))
  );
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(Number(btn.dataset.id), btn.dataset.name))
  );
}

/* ── Row HTML ───────────────────────────────────────────────────────────── */
function rowHTML(p) {
  const status  = STATUSES.find(s => s.value === p.status) ?? STATUSES[0];
  const client  = escapeHtml(clientName(p.clientId));
  const due     = formatDate(p.endDate);
  const overdue = p.endDate && p.status !== 'complete' && p.status !== 'cancelled'
                  && new Date(p.endDate) < new Date();

  return `
    <tr class="border-b border-[var(--clr-border)] last:border-0 hover:bg-[var(--clr-surface-2)]/50 transition-colors duration-150">

      <!-- Project name -->
      <td class="td-cell">
        <p class="font-medium text-[var(--clr-text)]">${escapeHtml(p.name)}</p>
        ${p.category ? `<p class="text-xs text-[var(--clr-text-faint)] mt-0.5">${escapeHtml(p.category)}</p>` : ''}
      </td>

      <!-- Client -->
      <td class="td-cell hidden md:table-cell text-sm text-[var(--clr-text-muted)]">${client}</td>

      <!-- Amount -->
      <td class="td-cell hidden sm:table-cell text-sm font-medium text-[var(--clr-text)] text-right tabular-nums whitespace-nowrap">
        ${p.amount ? formatQAR(Number(p.amount)) : '—'}
      </td>

      <!-- Hours -->
      <td class="td-cell hidden lg:table-cell text-sm text-[var(--clr-text-muted)] text-right tabular-nums whitespace-nowrap">
        ${p.hours ? `${Number(p.hours).toLocaleString()} hrs` : '—'}
      </td>

      <!-- Start date -->
      <td class="td-cell hidden lg:table-cell text-xs text-[var(--clr-text-faint)] whitespace-nowrap">
        ${formatDate(p.startDate)}
      </td>

      <!-- Due date — red if overdue -->
      <td class="td-cell hidden md:table-cell text-xs whitespace-nowrap"
          style="color:${overdue ? 'var(--clr-danger)' : 'var(--clr-text-faint)'}">
        ${due}${overdue ? ' ⚠' : ''}
      </td>

      <!-- Status badge -->
      <td class="td-cell text-center">
        <span class="badge ${status.badge}">${status.label}</span>
      </td>

      <!-- Actions -->
      <td class="td-cell text-right">
        <div class="flex items-center justify-end gap-1">
          <button data-action="edit" data-id="${p.id}"
                  class="btn btn-icon" title="Edit project" aria-label="Edit ${escapeHtml(p.name)}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button data-action="delete" data-id="${p.id}" data-name="${escapeHtml(p.name)}"
                  class="btn btn-icon" title="Delete project" aria-label="Delete ${escapeHtml(p.name)}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                 style="color:var(--clr-danger)">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7
                   m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </td>
    </tr>`;
}

/* ── Form HTML (shared by add + edit) ───────────────────────────────────── */
function formHTML(project = {}) {
  const v   = (k) => escapeHtml(project[k] ?? '');
  const sel = (val, opt) => String(val) === String(opt) ? 'selected' : '';

  // Build client options; include a blank "none" option
  const clientOptions = _clients
    .map(c => `<option value="${c.id}" ${sel(project.clientId, c.id)}>${escapeHtml(c.name)}${c.company ? ` — ${escapeHtml(c.company)}` : ''}</option>`)
    .join('');

  // Build status options
  const statusOptions = STATUSES
    .map(s => `<option value="${s.value}" ${sel(project.status ?? 'in-progress', s.value)}>${s.label}</option>`)
    .join('');

  return `
    <div class="p-6 space-y-5">

      <!-- Project name -->
      <div>
        <label class="form-label" for="pf-name">
          Project Name <span style="color:var(--clr-danger)">*</span>
        </label>
        <input id="pf-name" name="name" type="text" class="form-input"
               placeholder="e.g. E-Commerce Platform Redesign"
               value="${v('name')}" required autocomplete="off"/>
      </div>

      <!-- Client + Category -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="pf-client">Client</label>
          <select id="pf-client" name="clientId" class="form-select">
            <option value="">— No client —</option>
            ${clientOptions}
          </select>
        </div>
        <div>
          <label class="form-label" for="pf-category">Category</label>
          <input id="pf-category" name="category" type="text" class="form-input"
                 placeholder="e.g. Web Design, Mobile App…"
                 value="${v('category')}" autocomplete="off"/>
        </div>
      </div>

      <!-- Amount + Hours -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="pf-amount">Contract Amount (QAR)</label>
          <input id="pf-amount" name="amount" type="number" min="0" step="0.01" class="form-input"
                 placeholder="e.g. 15000" value="${v('amount')}" autocomplete="off"/>
        </div>
        <div>
          <label class="form-label" for="pf-hours">Estimated Hours</label>
          <input id="pf-hours" name="hours" type="number" min="0" step="0.5" class="form-input"
                 placeholder="e.g. 120" value="${v('hours')}" autocomplete="off"/>
        </div>
      </div>

      <!-- Start date + End date -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="pf-start">Start Date</label>
          <input id="pf-start" name="startDate" type="date" class="form-input"
                 value="${v('startDate')}"/>
        </div>
        <div>
          <label class="form-label" for="pf-end">Due Date</label>
          <input id="pf-end" name="endDate" type="date" class="form-input"
                 value="${v('endDate')}"/>
        </div>
      </div>

      <!-- Status -->
      <div>
        <label class="form-label" for="pf-status">Status</label>
        <select id="pf-status" name="status" class="form-select">
          ${statusOptions}
        </select>
      </div>

      <!-- Notes -->
      <div>
        <label class="form-label" for="pf-notes">Notes</label>
        <textarea id="pf-notes" name="notes" class="form-textarea"
                  placeholder="Any additional notes about this project…">${v('notes')}</textarea>
      </div>
    </div>`;
}

/* ── Add modal ──────────────────────────────────────────────────────────── */
function openAddModal() {
  openModal({
    title:       'Add New Project',
    bodyHTML:    formHTML(),
    submitLabel: 'Add Project',
    onSubmit: async (fd) => {
      const data = {
        name:      fd.get('name').trim(),
        clientId:  fd.get('clientId') ? Number(fd.get('clientId')) : null,
        category:  fd.get('category').trim(),
        amount:    fd.get('amount')    ? Number(fd.get('amount'))    : null,
        hours:     fd.get('hours')     ? Number(fd.get('hours'))     : null,
        startDate: fd.get('startDate') || null,
        endDate:   fd.get('endDate')   || null,
        status:    fd.get('status'),
        notes:     fd.get('notes').trim(),
      };

      if (!data.name) throw new Error('Project name is required');

      await addRecord('projects', data);
      toast(`Project "${data.name}" added.`, 'success');
      await loadProjects();
    },
  });
}

/* ── Edit modal ─────────────────────────────────────────────────────────── */
async function openEditModal(id) {
  const project = _projects.find(p => p.id === id);
  if (!project) { toast('Project not found.', 'error'); return; }

  openModal({
    title:       'Edit Project',
    bodyHTML:    formHTML(project),
    submitLabel: 'Save Changes',
    onSubmit: async (fd) => {
      const updates = {
        name:      fd.get('name').trim(),
        clientId:  fd.get('clientId') ? Number(fd.get('clientId')) : null,
        category:  fd.get('category').trim(),
        amount:    fd.get('amount')    ? Number(fd.get('amount'))    : null,
        hours:     fd.get('hours')     ? Number(fd.get('hours'))     : null,
        startDate: fd.get('startDate') || null,
        endDate:   fd.get('endDate')   || null,
        status:    fd.get('status'),
        notes:     fd.get('notes').trim(),
      };

      if (!updates.name) throw new Error('Project name is required');

      await updateRecord('projects', id, updates);
      toast(`Project "${updates.name}" updated.`, 'success');
      await loadProjects();
    },
  });
}

/* ── Delete ─────────────────────────────────────────────────────────────── */
function confirmDelete(id, name) {
  openConfirm({
    title:        'Delete Project',
    message:      `Are you sure you want to delete "${name}"? This action cannot be undone.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await deleteRecord('projects', id);
      toast(`Project "${name}" deleted.`, 'info');
      await loadProjects();
    },
  });
}

/* ── Bind UI listeners ──────────────────────────────────────────────────── */
function bindListeners() {
  _container.querySelector('#btn-add-project')?.addEventListener('click', openAddModal);

  // Debounced search
  const searchInput = _container.querySelector('#projects-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      _searchQ = searchInput.value;
      renderTable(applyFilters());
    }, 200));
  }

  // Status filter tabs
  _container.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter = btn.dataset.filter;
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
        <h2 class="text-xl font-semibold text-[var(--clr-text)]">Projects</h2>
        <p class="text-sm text-[var(--clr-text-faint)] mt-0.5">Manage your project portfolio</p>
      </div>
      <button id="btn-add-project" class="btn btn-primary w-full sm:w-auto">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        Add Project
      </button>
    </div>

    <!-- Stats row -->
    <div id="projects-stats" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      ${Array(4).fill('<div class="card-skeleton rounded-xl h-16"></div>').join('')}
    </div>

    <!-- Table card -->
    <div class="card overflow-hidden">

      <!-- Toolbar -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4 border-b border-[var(--clr-border)]">

        <!-- Search -->
        <div class="relative flex-1">
          <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
               fill="none" stroke="currentColor" viewBox="0 0 24 24"
               style="color:var(--clr-text-faint)">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input id="projects-search" type="search"
                 placeholder="Search by name, client, category…"
                 class="form-input pl-9 text-sm"
                 style="background:var(--clr-surface-2)"/>
        </div>

        <!-- Status filter pills -->
        <div class="flex items-center gap-2 flex-wrap shrink-0">
          <button class="filter-btn filter-active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="in-progress">In Progress</button>
          <button class="filter-btn" data-filter="complete">Complete</button>
          <button class="filter-btn" data-filter="on-hold">On Hold</button>
          <button class="filter-btn" data-filter="cancelled">Cancelled</button>
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--clr-border)] bg-[var(--clr-surface-2)]/50">
              <th class="th-cell text-left">Project</th>
              <th class="th-cell text-left hidden md:table-cell">Client</th>
              <th class="th-cell text-right hidden sm:table-cell">Amount</th>
              <th class="th-cell text-right hidden lg:table-cell">Hours</th>
              <th class="th-cell text-left hidden lg:table-cell">Start</th>
              <th class="th-cell text-left hidden md:table-cell">Due</th>
              <th class="th-cell text-center">Status</th>
              <th class="th-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="projects-tbody">
            <tr>
              <td colspan="8">
                <div class="empty-state">
                  <svg class="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24"
                       style="color:var(--clr-surface-3)">
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
        <p id="projects-count" class="text-xs" style="color:var(--clr-text-faint)">— projects</p>
        <p class="text-xs" style="color:var(--clr-text-faint)">QFL Dashboard · 2026</p>
      </div>
    </div>`;
}
