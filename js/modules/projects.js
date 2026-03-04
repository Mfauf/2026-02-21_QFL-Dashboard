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

import { addRecord, getAllRecords, getByIndex, updateRecord, deleteRecord } from '../db.js';
import { toast, openModal, closeModal, openConfirm }            from '../ui.js';
import { formatDate, formatQAR, escapeHtml, matchesSearch, debounce } from '../utils.js';
import { getSettings }                                         from '../settings-store.js';
import { navigate }                                            from '../router.js';
import { printBlueprint }                                      from '../blueprint-pdf.js';

/* ── Module state ───────────────────────────────────────────────────────── */
let _projects          = [];   // all projects from DB
let _clients           = [];   // all clients from DB (for dropdown + name resolution)
let _filter            = 'all';
let _searchQ           = '';
let _container         = null;
let _dateRange         = 'all';    // 'all' | 'last-month' | 'last-year'
let _currentProjectId  = null;     // id of the project whose detail view is open
let _milestones        = [];       // milestones for the current project
let _sessions          = [];       // time-tracking sessions for the current project
// Map<projectId, { status, startedAt, accumulatedMs, intervalId, projectName }>
let _timerStates         = new Map();
let _collapsedMilestones = new Set(); // string milestone IDs whose sessions panel is collapsed
let _blueprintFeatures   = [];        // blueprint features for the current project
let _currentView         = 'list';    // 'list' | 'detail' | 'blueprint'
let _projectEnrichments  = new Map(); // projectId → { bpAmount, trackedHours } for list view

/* ── Timer event helper
   Plays a slide-in animation on the container element between sub-views.
───────────────────────────────────────────────────────────────*/
function animateIn(el) {
  if (!el) return;
  el.classList.remove('qfl-slide-in');
  void el.offsetWidth; // reflow
  el.classList.add('qfl-slide-in');
  el.addEventListener('animationend', () => el.classList.remove('qfl-slide-in'), { once: true });
}

/* ── Timer helpers ────────────────────────────────────────────────── */
function getTimerState(pid) {
  if (!_timerStates.has(pid)) {
    _timerStates.set(pid, { status: 'idle', startedAt: null, accumulatedMs: 0, intervalId: null, projectName: '' });
  }
  return _timerStates.get(pid);
}

function getElapsedMs(pid) {
  const t = _timerStates.get(pid);
  if (!t) return 0;
  if (t.status === 'running' && t.startedAt) {
    return t.accumulatedMs + (Date.now() - t.startedAt.getTime());
  }
  return t.accumulatedMs;
}

function allActiveTimers() {
  const result = [];
  for (const [pid, t] of _timerStates) {
    if (t.status !== 'idle') {
      result.push({ projectId: pid, projectName: t.projectName, status: t.status, elapsed: getElapsedMs(pid) });
    }
  }
  return result;
}

function dispatchTimerEvent(eventName) {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { allTimers: allActiveTimers() } }));
}

/* ── Project status config ──────────────────────────────────────────────── */
const STATUSES = [
  { value: 'in-progress', label: 'In Progress', badge: 'badge-progress'  },
  { value: 'complete',    label: 'Complete',    badge: 'badge-complete'   },
  { value: 'on-hold',     label: 'On Hold',     badge: 'badge-on-hold'    },
  { value: 'cancelled',   label: 'Cancelled',   badge: 'badge-cancelled'  },
];

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container, params = {}) {
  _container = container;

  if (params.id) {
    // Arrived via a direct URL route: #project/:id  or  #project/:id/blueprint
    const id = Number(params.id);
    _currentProjectId = id;
    _currentView      = params.blueprint ? 'blueprint' : 'detail';
    _collapsedMilestones.clear();
    _filter    = 'all';
    _searchQ   = '';
    _dateRange = 'all';
    await loadProjects();
    return;
  }

  // ── List view ─────────────────────────────────────────────────────────
  _currentProjectId = null;
  _milestones       = [];
  _sessions         = [];
  _currentView      = 'list';
  _collapsedMilestones.clear();
  _filter    = 'all';
  _searchQ   = '';
  _dateRange = 'all';

  container.innerHTML = shellHTML();
  bindListeners();
  await loadProjects();
}

export function unmount() {
  // Keep ALL timer intervals alive — they'll keep firing qfl:timer-tick for the notif panel.
  // The display-update path is null-safe when _container is null.
  _container = null;
}

/* ── Load data from DB ──────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    [_projects, _clients] = await Promise.all([
      getAllRecords('projects'),
      getAllRecords('clients'),
    ]);

    // If a detail or blueprint view is active, re-render it; fall back to list if deleted
    if (_currentProjectId !== null) {
      const project = _projects.find(p => p.id === _currentProjectId);
      if (project) {
        const titleEl = document.getElementById('page-title');
        if (_currentView === 'blueprint') {
          _blueprintFeatures = await loadBlueprintFeatures(_currentProjectId);
          const bpClient = _clients.find(c => c.id === Number(project.clientId)) ?? null;
          const terms    = getSettings().blueprint?.terms ?? '';
          _container.innerHTML = blueprintViewHTML(project, bpClient?.name ?? '\u2014', terms);
          renderBlueprintFeatures();
          bindBlueprintListeners(_container, project, bpClient);
          if (titleEl) titleEl.textContent = 'Blueprint';
        } else {
          _milestones         = await loadMilestones(_currentProjectId);
          _sessions           = await loadSessions(_currentProjectId);
          _blueprintFeatures  = await loadBlueprintFeatures(_currentProjectId);
          _container.innerHTML = detailHTML(project);
          renderMilestones();
          bindDetailListeners();
          animateIn(_container);
          if (titleEl) titleEl.textContent = project.name;
        }
        return;
      }
      // Project was deleted — fall back to list
      _currentProjectId = null;
      _milestones       = [];
      _sessions         = [];
      _currentView      = 'list';
      // Leave any running timers intact — they belong to other projects.
      const titleEl2 = document.getElementById('page-title');
      if (titleEl2) titleEl2.textContent = 'Projects';
      _container.innerHTML = shellHTML();
      bindListeners();
    }
    renderStats();
    // Pre-compute blueprint amount + tracked hours for every project so rowHTML can show fallbacks
    try {
      const [allFeatures, allSessions] = await Promise.all([
        getAllRecords('blueprintFeatures'),
        getAllRecords('sessions'),
      ]);
      const hourlyRate = Number(getSettings().blueprint?.amountPerHour || 0);
      _projectEnrichments.clear();
      for (const p of _projects) {
        const bpTotal      = allFeatures
          .filter(f => f.projectId === p.id)
          .reduce((s, f) => s + Number(f.price || 0), 0);
        const trackedSecs  = allSessions
          .filter(s => s.projectId === p.id)
          .reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
        const trackedHours = trackedSecs > 0 ? trackedSecs / 3600 : null;
        const effHours     = Number(p.hours) || trackedHours || null;
        const hourlyAmount = (!Number(p.amount) && bpTotal === 0 && hourlyRate > 0 && effHours)
          ? hourlyRate * effHours : null;
        _projectEnrichments.set(p.id, {
          bpAmount:      bpTotal > 0 ? bpTotal : null,
          trackedHours,
          hourlyAmount,
        });
      }
    } catch (_) { /* enrichment is best-effort */ }
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

  if (_dateRange !== 'all') {
    const now    = new Date();
    const cutoff = _dateRange === 'last-month'
      ? new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    list = list.filter(p => {
      const d = new Date(p.createdAt ?? p.startDate ?? '');
      return !isNaN(d) && d >= cutoff;
    });
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
  tbody.querySelectorAll('[data-action="create-invoice"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = _projects.find(pr => pr.id === Number(btn.dataset.id));
      if (!p) return;
      let amount = p.amount ?? '';
      let notes  = p.notes  ?? '';
      try {
        const features = await getByIndex('blueprintFeatures', 'projectId', p.id);
        if (features && features.length) {
          const total = features.reduce((s, f) => s + Number(f.price || 0), 0);
          if (total) amount = total;
        }
      } catch (_) { /* fall through to project defaults */ }
      sessionStorage.setItem('qfl_invoice_prefill', JSON.stringify({
        clientId:  p.clientId ?? null,
        projectId: p.id,
        amount,
        notes,
        dueAt:     p.endDate ?? '',
      }));
      navigate('invoices');
    });
  });
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)))
  );
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(Number(btn.dataset.id), btn.dataset.name))
  );

  // Cycle status on badge click
  tbody.querySelectorAll('[data-action="status-btn"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id      = Number(btn.dataset.id);
      const project = _projects.find(p => p.id === id);
      if (!project) return;
      const idx    = STATUSES.findIndex(s => s.value === project.status);
      const next   = STATUSES[(idx + 1) % STATUSES.length];
      try {
        await updateRecord('projects', id, { status: next.value });
        project.status = next.value;
        renderStats();
        renderTable(applyFilters());
        toast(`Status changed to ${next.label}.`, 'success');
      } catch (err) {
        console.error('[Projects] Status update error:', err);
        toast('Failed to update status.', 'error');
      }
    });
  });

  // Whole-row click → open detail view (skip clicks on action buttons)
  tbody.querySelectorAll('tr[data-project-id]').forEach(tr =>
    tr.addEventListener('click', e => {
      if (e.target.closest('[data-action]')) return;
      openDetailView(Number(tr.dataset.projectId));
    })
  );
}

/* ── Row HTML ───────────────────────────────────────────────────────────── */
function rowHTML(p) {
  const status  = STATUSES.find(s => s.value === p.status) ?? STATUSES[0];
  const client  = escapeHtml(clientName(p.clientId));
  const due     = formatDate(p.endDate);
  const overdue = p.endDate && p.status !== 'complete' && p.status !== 'cancelled'
                  && new Date(p.endDate) < new Date();

  const enrich       = _projectEnrichments.get(p.id) ?? {};
  const hasAmount    = Number(p.amount) > 0;
  const hasHours     = Number(p.hours)  > 0;
  const effAmount    = hasAmount ? Number(p.amount) : (enrich.bpAmount ?? enrich.hourlyAmount ?? null);
  const effHours     = hasHours ? Number(p.hours)   : (enrich.trackedHours ?? null);
  const amountFromBP     = !hasAmount && enrich.bpAmount      != null;
  const amountFromHourly = !hasAmount && enrich.bpAmount      == null && enrich.hourlyAmount != null;
  const hoursTracked     = !hasHours  && enrich.trackedHours  != null;

  const amountCell = effAmount != null
    ? `<span>${formatQAR(effAmount)}</span>${amountFromBP ? '<br><span style="font-size:.65rem;opacity:.65">(blueprint)</span>' : amountFromHourly ? '<br><span style="font-size:.65rem;opacity:.65">(hourly rate)</span>' : ''}`
    : '—';
  const hoursCell  = effHours != null
    ? `<span>${effHours % 1 === 0 ? effHours.toLocaleString() : effHours.toFixed(1)} hrs</span>${hoursTracked ? '<br><span style="font-size:.65rem;opacity:.65">(tracked)</span>' : ''}`
    : '—';

  return `
    <tr class="border-b border-[var(--clr-border)] last:border-0 transition-colors duration-150 cursor-pointer group"
        data-project-id="${p.id}"
        onmouseenter="this.style.background='var(--clr-surface-2)';this.style.boxShadow='inset 3px 0 0 var(--clr-primary)'"
        onmouseleave="this.style.background='';this.style.boxShadow=''">

      <!-- Project name -->
      <td class="td-cell">
        <div>
          <p class="font-medium transition-colors duration-150 group-hover:text-[var(--clr-primary)]">${escapeHtml(p.name)}</p>
          ${p.category ? `<p class="text-xs mt-0.5 transition-colors duration-150" style="color:var(--clr-text-faint)">${escapeHtml(p.category)}</p>` : ''}
        </div>
      </td>

      <!-- Client -->
      <td class="td-cell hidden md:table-cell text-sm text-[var(--clr-text-muted)]">${client}</td>

      <!-- Amount -->
      <td class="td-cell hidden sm:table-cell text-sm font-medium text-right tabular-nums whitespace-nowrap leading-tight"
          style="color:${amountFromBP ? 'var(--clr-primary-light)' : 'var(--clr-text)'}">
        ${amountCell}
      </td>

      <!-- Hours -->
      <td class="td-cell hidden lg:table-cell text-sm text-right tabular-nums whitespace-nowrap leading-tight"
          style="color:${hoursTracked ? 'var(--clr-primary-light)' : 'var(--clr-text-muted)'}">
        ${hoursCell}
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

      <!-- Status badge — click to cycle through statuses -->
      <td class="td-cell text-center">
        <button class="badge ${status.badge} cursor-pointer"
                data-action="status-btn" data-id="${p.id}"
                title="Click to change status">${status.label}</button>
      </td>

      <!-- Actions -->
      <td class="td-cell text-right">
        <div class="flex items-center justify-end gap-1">
          <!-- Create Invoice -->
          <button data-action="create-invoice" data-id="${p.id}"
                  class="btn btn-icon" title="Create Invoice for this project"
                  aria-label="Create invoice for ${escapeHtml(p.name)}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                   a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </button>
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

/* ── Detail view ────────────────────────────────────────────────────────── */

function openDetailView(id) {
  navigate('project/' + id);
}

function showListView() {
  navigate('projects');
}

function detailHTML(project) {
  const status  = STATUSES.find(s => s.value === project.status) ?? STATUSES[0];
  const client  = escapeHtml(clientName(project.clientId));
  const overdue = project.endDate && project.status !== 'complete' && project.status !== 'cancelled'
                  && new Date(project.endDate) < new Date();

  return `
    <!-- Project header card -->
    <div class="card p-6 mb-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div class="flex-1 min-w-0 flex items-start gap-2">
          <!-- Back button -->
          <button id="btn-back-to-projects"
                  class="btn btn-icon shrink-0 mt-0.5"
                  title="Back to Projects" aria-label="Back to Projects">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <!-- Title + category stacked -->
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-xl font-semibold text-[var(--clr-text)]">${escapeHtml(project.name)}</h2>
              <span class="badge ${status.badge}">${status.label}</span>
            </div>
            ${project.category ? `<p class="text-sm text-[var(--clr-text-faint)] mt-0.5">${escapeHtml(project.category)}</p>` : ''}
          </div>
        </div>

        <div class="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
          <button id="btn-detail-create-invoice"
                  class="btn btn-ghost flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
                  title="Create invoice for this project">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                   a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Invoice
          </button>
          <button id="btn-detail-blueprint"
                  class="btn btn-ghost flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
                  title="Open Project Blueprint / Proposal">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
                   M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2
                   m-6 9l2 2 4-4"/>
            </svg>
            Blueprint
          </button>
          <button id="btn-detail-edit"
                  class="btn btn-secondary flex items-center justify-center gap-2 text-sm w-full sm:w-auto">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            Edit
          </button>
          <button id="btn-detail-delete"
                  class="btn btn-ghost flex items-center justify-center gap-2 text-sm w-full sm:w-auto"
                  style="color:var(--clr-danger)">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858
                   L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            Delete
          </button>
        </div>
      </div>

      <!-- Info grid -->
      ${(() => {
        // Auto-compute amount from blueprint features if project.amount is empty
        const bpTotal         = _blueprintFeatures.reduce((s, f) => s + Number(f.price || 0), 0);
        const hourlyRate      = Number(getSettings().blueprint?.amountPerHour || 0);

        // Auto-compute hours: effectiveHours (from source modal) → estimated (project.hours) → tracked sessions
        const trackedSeconds  = _sessions.reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
        const trackedHours    = trackedSeconds / 3600;
        const savedEffHours   = project.effectiveHours != null ? Number(project.effectiveHours) : null;
        const effectiveHours  = savedEffHours ?? (Number(project.hours) || (trackedSeconds > 0 ? trackedHours : null));
        const hoursTracked    = savedEffHours == null && !Number(project.hours) && trackedSeconds > 0;

        const hourlyAmount    = (!Number(project.amount) && bpTotal === 0 && hourlyRate > 0 && effectiveHours)
          ? hourlyRate * effectiveHours : null;
        const effectiveAmount = Number(project.amount) || bpTotal || hourlyAmount || null;
        const amountFromBP      = !Number(project.amount) && bpTotal > 0;
        const amountFromHourly  = !Number(project.amount) && !bpTotal && hourlyAmount != null;

        const savedSources  = project.amountSources ?? [];
        const amtSubLabel   = savedSources.length > 0
          ? '(' + savedSources.join(' + ') + ')'
          : (amountFromBP ? '(from blueprint)' : amountFromHourly ? '(hourly rate)' : '');
        const amountLabel = effectiveAmount
          ? `${formatQAR(effectiveAmount)} <span style="font-size:.65rem;opacity:.7;display:block;margin-top:.1rem">${amtSubLabel}</span>`
          : '—';
        const amountColor = (amountFromBP || amountFromHourly || savedSources.length > 0) ? 'var(--clr-primary-light)' : null;
        const hoursLabel  = hoursTracked
          ? `${effectiveHours % 1 === 0 ? effectiveHours.toLocaleString() : effectiveHours.toFixed(1)} hrs <span style="font-size:.65rem;opacity:.7;display:block;margin-top:.1rem">(tracked)</span>`
          : (effectiveHours ? `${effectiveHours % 1 === 0 ? effectiveHours.toLocaleString() : effectiveHours.toFixed(1)} hrs` : '—');

        const iBtnStyle = `width:17px;height:17px;border-radius:50%;flex-shrink:0;
                            border:1.5px solid var(--clr-text-faint);background:none;
                            cursor:pointer;display:flex;align-items:center;justify-content:center;
                            color:var(--clr-text-faint);font-size:9px;font-weight:800;line-height:1;padding:0;
                            font-style:italic;font-family:Georgia,serif`;

        const amountCardHTML = `
          <div id="stat-amount-card" class="rounded-xl px-4 py-3" style="background:var(--clr-surface-2);border:1px solid var(--clr-border-mid)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <p style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                        color:var(--clr-text-faint);margin:0">Amount</p>
              <button id="btn-amount-source" title="Set amount sources" style="${iBtnStyle}">i</button>
            </div>
            <p data-stat-val style="font-size:0.9rem;font-weight:600;color:${amountColor ?? 'var(--clr-text)'}">${amountLabel}</p>
          </div>`;

        const hoursColor = hoursTracked ? 'var(--clr-primary-light)' : null;
        const hoursCardHTML = `
          <div id="stat-hours-card" class="rounded-xl px-4 py-3" style="background:var(--clr-surface-2);border:1px solid var(--clr-border-mid)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <p style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                        color:var(--clr-text-faint);margin:0">Hours</p>
              <button id="btn-hours-source" title="Set hours source" style="${iBtnStyle}">i</button>
            </div>
            <p data-stat-val style="font-size:0.9rem;font-weight:600;color:${hoursColor ?? 'var(--clr-text)'}">${hoursLabel}</p>
          </div>`;

        return `
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-6
                  border-t border-[var(--clr-border)]">
        ${detailField('Client',     client || '—')}
        ${amountCardHTML}
        ${hoursCardHTML}`;
      })()}
        ${detailField('Start Date', formatDate(project.startDate))}
        ${detailField('Due Date',   formatDate(project.endDate), overdue ? 'var(--clr-danger)' : null, overdue)}
        ${detailField('Added',      formatDate(project.createdAt?.slice(0, 10)))}
      </div>

    </div>

    <!-- Milestones & Time card -->
    <div class="card p-6">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h3 class="font-semibold text-[var(--clr-text)]">Milestones &amp; Time</h3>
          <p class="text-xs text-[var(--clr-text-faint)] mt-0.5">Track deliverables and time spent</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <div id="timer-controls"></div>
          <button id="btn-add-milestone" class="btn btn-primary flex items-center gap-2 text-sm">
            <svg style="width:14px;height:14px" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
            Add Milestone
          </button>
        </div>
      </div>
      <div id="milestones-list"></div>
    </div>`;
}

/* ── Amount Source Modal ────────────────────────────────────────────────── */
function showAmountSourceModal(project, { bpTotal, hourlyAmount, hourlyRate, effectiveHours }) {
  const saved   = project.amountSources ?? [];
  const fmtQAR  = (v) => v > 0 ? `QAR ${Number(v).toLocaleString('en-US', {minimumFractionDigits:0,maximumFractionDigits:2})}` : '—';

  // Pre-fill contract value: prefer stored contractAmount, else current project.amount if no other source
  const contractPrefill = project.contractAmount != null
    ? project.contractAmount
    : (saved.length === 0 && Number(project.amount) > 0 ? project.amount : '');

  // Default checked state mirrors the stat card fallback chain:
  //   contract (if contractAmount set) → blueprint (if features exist) → hourly (otherwise)
  const hasContract = Number(project.contractAmount) > 0 || Number(project.amount) > 0;
  const ckContract  = saved.includes('contract')  || (saved.length === 0 && hasContract  && !bpTotal && !hourlyAmount);
  const ckHourly    = saved.includes('hourly')    || (saved.length === 0 && !hasContract && !bpTotal && !!hourlyAmount);
  const ckBlueprint = saved.includes('blueprint') || (saved.length === 0 && !hasContract && !!bpTotal);

  openModal({
    title:       'Set Amount Sources',
    submitLabel: 'Apply',
    bodyHTML: `
      <style>
        .ams-row {
          display:flex; align-items:center; gap:12px; padding:11px 14px;
          border-radius:10px; border:1.5px solid var(--clr-border);
          background:var(--clr-surface-2); cursor:pointer; position:relative;
          transition:border-color 140ms, background 140ms;
        }
        .ams-row.disabled { opacity:.38; pointer-events:none; }
        .ams-row:has(.ams-cb:checked) {
          background:rgba(var(--clr-primary-rgb,99,102,241),.07);
        }
        .ams-cb { position:absolute; opacity:0; width:0; height:0; }
        .ams-check {
          width:17px; height:17px; border-radius:4px; flex-shrink:0;
          border:2px solid var(--clr-border-mid); background:var(--clr-surface);
          display:flex; align-items:center; justify-content:center;
          transition:background 140ms, border-color 140ms;
        }
        .ams-row:has(.ams-cb:checked) .ams-check { background:var(--clr-primary); }
        .ams-check svg { display:none; }
        .ams-row:has(.ams-cb:checked) .ams-check svg { display:block; }
        .ams-info { flex:1; min-width:0; }
        .ams-info-title { font-size:.8rem; font-weight:600; color:var(--clr-text); margin:0 0 1px; }
        .ams-info-sub   { font-size:.7rem; color:var(--clr-text-faint); margin:0; }
        .ams-val { font-size:.875rem; font-weight:700; color:var(--clr-text); flex-shrink:0; text-align:right; }
        .ams-contract-input-wrap { display:flex; align-items:center; gap:0;
          border:1.5px solid var(--clr-border); border-radius:8px;
          background:var(--clr-surface); overflow:hidden; flex-shrink:0; width:130px; }
        .ams-row:has(.ams-cb:checked) .ams-contract-input-wrap { border-color:var(--clr-primary); }
        .ams-contract-prefix {
          padding:0 8px; font-size:.72rem; font-weight:700;
          color:var(--clr-text-faint); background:var(--clr-surface-2);
          border-right:1px solid var(--clr-border); white-space:nowrap;
          display:flex; align-items:center; height:100%;
        }
        .ams-contract-input {
          flex:1; min-width:0; border:none; background:transparent;
          padding:6px 8px; font-size:.82rem; font-weight:600; color:var(--clr-text);
          outline:none;
        }
        .ams-total-row {
          display:flex; align-items:center; justify-content:space-between;
          border-radius:10px; padding:11px 14px;
          background:rgba(var(--clr-primary-rgb,99,102,241),.1);
          border:1.5px solid var(--clr-primary);
        }
      </style>
      <div style="padding:14px 18px;display:flex;flex-direction:column;gap:7px">

        <!-- Contract Amount -->
        <label class="ams-row">
          <input type="checkbox" id="ams-contract" class="ams-cb" ${ckContract ? 'checked' : ''}>
          <span class="ams-check">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5l2.5 2.5 4.5-4"/></svg>
          </span>
          <div class="ams-info">
            <p class="ams-info-title">Contract Amount</p>
            <p class="ams-info-sub">Manually agreed project value</p>
          </div>
          <div class="ams-contract-input-wrap">
            <span class="ams-contract-prefix">QAR</span>
            <input id="ams-contract-val" type="number" min="0" step="0.01"
                   class="ams-contract-input" placeholder="0.00" value="${contractPrefill}">
          </div>
        </label>

        <!-- Hourly Rate -->
        <label class="ams-row ${!hourlyAmount ? 'disabled' : ''}">
          <input type="checkbox" id="ams-hourly" class="ams-cb"
                 ${ckHourly ? 'checked' : ''} ${!hourlyAmount ? 'disabled' : ''}>
          <span class="ams-check">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5l2.5 2.5 4.5-4"/></svg>
          </span>
          <div class="ams-info">
            <p class="ams-info-title">Hourly Rate</p>
            <p class="ams-info-sub">
              ${hourlyRate > 0
                ? `${effectiveHours != null ? (effectiveHours % 1 === 0 ? effectiveHours : effectiveHours.toFixed(1)) : 0} hrs &times; ${fmtQAR(hourlyRate)} / hr`
                : 'No hourly rate — configure in Settings'}
            </p>
          </div>
          <span class="ams-val">${fmtQAR(hourlyAmount)}</span>
        </label>

        <!-- Blueprint Total -->
        <label class="ams-row ${!bpTotal ? 'disabled' : ''}">
          <input type="checkbox" id="ams-blueprint" class="ams-cb"
                 ${ckBlueprint ? 'checked' : ''} ${!bpTotal ? 'disabled' : ''}>
          <span class="ams-check">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5l2.5 2.5 4.5-4"/></svg>
          </span>
          <div class="ams-info">
            <p class="ams-info-title">Blueprint Total</p>
            <p class="ams-info-sub">Sum of all blueprint feature prices</p>
          </div>
          <span class="ams-val">${fmtQAR(bpTotal)}</span>
        </label>

        <!-- Live Total -->
        <div class="ams-total-row">
          <span style="font-size:.8rem;font-weight:600;color:var(--clr-text)">Total Amount</span>
          <span id="ams-total" style="font-size:1rem;font-weight:800;color:var(--clr-primary)">—</span>
        </div>
      </div>`,
    onSubmit: async () => {
      const useContract  = document.getElementById('ams-contract')?.checked;
      const useHourly    = document.getElementById('ams-hourly')?.checked;
      const useBlueprint = document.getElementById('ams-blueprint')?.checked;
      const contractVal  = Number(document.getElementById('ams-contract-val')?.value) || 0;

      if (!useContract && !useHourly && !useBlueprint) {
        throw new Error('Select at least one source.');
      }

      const total = (useContract  ? contractVal      : 0)
                  + (useHourly    ? (hourlyAmount||0) : 0)
                  + (useBlueprint ? (bpTotal||0)      : 0);

      const sources = [];
      if (useContract)  sources.push('contract');
      if (useHourly)    sources.push('hourly');
      if (useBlueprint) sources.push('blueprint');

      await updateRecord('projects', project.id, {
        amount:         total,
        contractAmount: useContract ? contractVal : (project.contractAmount ?? null),
        amountSources:  sources,
      });

      const updated = _projects.find(p => p.id === project.id);
      if (updated) {
        updated.amount         = total;
        updated.contractAmount = useContract ? contractVal : (project.contractAmount ?? null);
        updated.amountSources  = sources;
      }
      renderStatCards();
    },
  });

  // Live total — wire after openModal sets innerHTML synchronously
  const calc = () => {
    const useContract  = document.getElementById('ams-contract')?.checked;
    const useHourly    = document.getElementById('ams-hourly')?.checked;
    const useBlueprint = document.getElementById('ams-blueprint')?.checked;
    const contractVal  = Number(document.getElementById('ams-contract-val')?.value) || 0;
    const total = (useContract  ? contractVal      : 0)
                + (useHourly    ? (hourlyAmount||0) : 0)
                + (useBlueprint ? (bpTotal||0)      : 0);
    const el = document.getElementById('ams-total');
    if (el) el.textContent = total > 0 ? `QAR ${total.toLocaleString('en-US', {minimumFractionDigits:0,maximumFractionDigits:2})}` : '—';
  };
  document.getElementById('ams-contract')?.addEventListener('change', calc);
  document.getElementById('ams-hourly')?.addEventListener('change', calc);
  document.getElementById('ams-blueprint')?.addEventListener('change', calc);
  document.getElementById('ams-contract-val')?.addEventListener('input', calc);
  calc();
}

/* ── Hours Source Modal ─────────────────────────────────────────────────── */
function showHoursSourceModal(project, { trackedHours }) {
  const saved        = project.hoursSources ?? [];
  const estimatedVal = Number(project.hours) || 0;
  const trackedVal   = trackedHours || 0;
  const fmtHrs = (v) => v > 0
    ? `${v % 1 === 0 ? v.toLocaleString() : Number(v).toFixed(1)} hrs`
    : '—';

  const ckTracked   = saved.includes('tracked')   || (saved.length === 0 && trackedVal   > 0 && !estimatedVal);
  const ckEstimated = saved.includes('estimated') || (saved.length === 0 && estimatedVal > 0);

  openModal({
    title:       'Set Hours Source',
    submitLabel: 'Apply',
    bodyHTML: `
      <style>
        .ahs-row {
          display:flex; align-items:center; gap:12px; padding:11px 14px;
          border-radius:10px; border:1.5px solid var(--clr-border);
          background:var(--clr-surface-2); cursor:pointer; position:relative;
          transition:border-color 140ms, background 140ms;
        }
        .ahs-row.disabled { opacity:.38; pointer-events:none; }
        .ahs-row:has(.ahs-cb:checked) {
          background:rgba(var(--clr-primary-rgb,99,102,241),.07);
        }
        .ahs-cb { position:absolute; opacity:0; width:0; height:0; }
        .ahs-check {
          width:17px; height:17px; border-radius:4px; flex-shrink:0;
          border:2px solid var(--clr-border-mid); background:var(--clr-surface);
          display:flex; align-items:center; justify-content:center;
          transition:background 140ms, border-color 140ms;
        }
        .ahs-row:has(.ahs-cb:checked) .ahs-check { background:var(--clr-primary); }
        .ahs-check svg { display:none; }
        .ahs-row:has(.ahs-cb:checked) .ahs-check svg { display:block; }
        .ahs-info { flex:1; min-width:0; }
        .ahs-info-title { font-size:.8rem; font-weight:600; color:var(--clr-text); margin:0 0 1px; }
        .ahs-info-sub   { font-size:.7rem; color:var(--clr-text-faint); margin:0; }
        .ahs-val { font-size:.875rem; font-weight:700; color:var(--clr-text); flex-shrink:0; text-align:right; }
        .ahs-total-row {
          display:flex; align-items:center; justify-content:space-between;
          border-radius:10px; padding:11px 14px;
          background:rgba(var(--clr-primary-rgb,99,102,241),.1);
          border:1.5px solid var(--clr-primary);
        }
      </style>
      <div style="padding:14px 18px;display:flex;flex-direction:column;gap:7px">

        <!-- Time Tracked -->
        <label class="ahs-row ${!trackedVal ? 'disabled' : ''}">
          <input type="checkbox" id="ahs-tracked" class="ahs-cb"
                 ${ckTracked ? 'checked' : ''} ${!trackedVal ? 'disabled' : ''}>
          <span class="ahs-check">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5l2.5 2.5 4.5-4"/></svg>
          </span>
          <div class="ahs-info">
            <p class="ahs-info-title">Time Tracked</p>
            <p class="ahs-info-sub">Accumulated from timer sessions</p>
          </div>
          <span class="ahs-val">${fmtHrs(trackedVal)}</span>
        </label>

        <!-- Estimated Hours -->
        <label class="ahs-row ${!estimatedVal ? 'disabled' : ''}">
          <input type="checkbox" id="ahs-estimated" class="ahs-cb"
                 ${ckEstimated ? 'checked' : ''} ${!estimatedVal ? 'disabled' : ''}>
          <span class="ahs-check">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5l2.5 2.5 4.5-4"/></svg>
          </span>
          <div class="ahs-info">
            <p class="ahs-info-title">Estimated Hours</p>
            <p class="ahs-info-sub">Manually set on the project</p>
          </div>
          <span class="ahs-val">${fmtHrs(estimatedVal)}</span>
        </label>

        <!-- Live Total -->
        <div class="ahs-total-row">
          <span style="font-size:.8rem;font-weight:600;color:var(--clr-text)">Total Hours</span>
          <span id="ahs-total" style="font-size:1rem;font-weight:800;color:var(--clr-primary)">—</span>
        </div>
      </div>`,
    onSubmit: async () => {
      const useTracked   = document.getElementById('ahs-tracked')?.checked;
      const useEstimated = document.getElementById('ahs-estimated')?.checked;

      if (!useTracked && !useEstimated) {
        throw new Error('Select at least one source.');
      }

      const total = (useTracked   ? trackedVal   : 0)
                  + (useEstimated ? estimatedVal : 0);

      const sources = [];
      if (useTracked)   sources.push('tracked');
      if (useEstimated) sources.push('estimated');

      await updateRecord('projects', project.id, {
        effectiveHours: total || null,
        hoursSources:   sources,
      });

      const updated = _projects.find(p => p.id === project.id);
      if (updated) {
        updated.effectiveHours = total || null;
        updated.hoursSources   = sources;
      }
      renderStatCards();
    },
  });

  // Live total
  const calc = () => {
    const useTracked   = document.getElementById('ahs-tracked')?.checked;
    const useEstimated = document.getElementById('ahs-estimated')?.checked;
    const total = (useTracked   ? trackedVal   : 0)
                + (useEstimated ? estimatedVal : 0);
    const el = document.getElementById('ahs-total');
    if (el) el.textContent = total > 0
      ? `${total % 1 === 0 ? total.toLocaleString() : Number(total).toFixed(1)} hrs`
      : '—';
  };
  document.getElementById('ahs-tracked')?.addEventListener('change', calc);
  document.getElementById('ahs-estimated')?.addEventListener('change', calc);
  calc();
}

/* ── Stat Card Live Patch ───────────────────────────────────────────── */
function renderStatCards() {
  if (_currentView !== 'detail' || !_container) return;
  const project = _projects.find(p => p.id === _currentProjectId);
  if (!project) return;

  const amountEl = _container.querySelector('#stat-amount-card [data-stat-val]');
  const hoursEl  = _container.querySelector('#stat-hours-card  [data-stat-val]');
  if (!amountEl && !hoursEl) return;

  const bpTotal    = _blueprintFeatures.reduce((s, f) => s + Number(f.price || 0), 0);
  const hourlyRate = Number(getSettings().blueprint?.amountPerHour || 0);

  // Include currently-running live seconds so Hours updates every tick
  const savedSec    = _sessions.reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
  const liveSec     = Math.floor(getElapsedMs(_currentProjectId) / 1000);
  const totalSec    = savedSec + liveSec;
  const trackedHrs  = totalSec / 3600;

  const savedEffHrs    = project.effectiveHours != null ? Number(project.effectiveHours) : null;
  const effectiveHours = savedEffHrs ?? (Number(project.hours) || (totalSec > 0 ? trackedHrs : null));
  const hoursTracked   = savedEffHrs == null && !Number(project.hours) && totalSec > 0;

  const hourlyAmount   = (!Number(project.amount) && bpTotal === 0 && hourlyRate > 0 && effectiveHours)
                         ? hourlyRate * effectiveHours : null;
  const effectiveAmount = Number(project.amount) || bpTotal || hourlyAmount || null;
  const amtFromBP      = !Number(project.amount) && bpTotal > 0;
  const amtFromHourly  = !Number(project.amount) && !bpTotal && hourlyAmount != null;

  const subSpan = (txt) => txt ? ` <span style="font-size:.65rem;opacity:.7;display:block;margin-top:.1rem">${txt}</span>` : '';
  const savedSources = project.amountSources ?? [];
  const amtSubLabel  = savedSources.length > 0
    ? '(' + savedSources.join(' + ') + ')'
    : (amtFromBP ? '(from blueprint)' : amtFromHourly ? '(hourly rate)' : '');
  const amountLabel = effectiveAmount
    ? `${formatQAR(effectiveAmount)}${subSpan(amtSubLabel)}`
    : '—';
  const amountColor = (amtFromBP || amtFromHourly || savedSources.length > 0) ? 'var(--clr-primary-light)' : 'var(--clr-text)';

  const hoursLabel = hoursTracked
    ? `${effectiveHours % 1 === 0 ? effectiveHours.toLocaleString() : effectiveHours.toFixed(1)} hrs${subSpan('(tracked)')}`
    : (effectiveHours ? `${effectiveHours % 1 === 0 ? effectiveHours.toLocaleString() : effectiveHours.toFixed(1)} hrs` : '—');
  const hoursColor = hoursTracked ? 'var(--clr-primary-light)' : 'var(--clr-text)';

  if (amountEl) { amountEl.style.color = amountColor; amountEl.innerHTML = amountLabel; }
  if (hoursEl)  { hoursEl.style.color  = hoursColor;  hoursEl.innerHTML  = hoursLabel; }
}

function detailField(label, value, color = null, warn = false) {
  const borderColor = warn ? 'var(--clr-danger-ring)' : 'var(--clr-border-mid)';
  const bgColor     = warn ? 'var(--clr-danger-bg)'   : 'var(--clr-surface-2)';
  return `
    <div class="rounded-xl px-4 py-3" style="background:${bgColor};border:1px solid ${borderColor}">
      <p style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;
                color:var(--clr-text-faint);margin-bottom:6px">${label}</p>
      <p style="font-size:0.9rem;font-weight:600;color:${color ?? 'var(--clr-text)'}">${value}</p>
    </div>`;
}

function bindDetailListeners() {
  _container.querySelector('#btn-back-to-projects')
    ?.addEventListener('click', () => showListView());

  _container.querySelector('#btn-add-milestone')
    ?.addEventListener('click', () => openAddMilestoneModal());

  _container.querySelector('#btn-detail-edit')
    ?.addEventListener('click', () => openEditModal(_currentProjectId));

  _container.querySelector('#btn-detail-delete')?.addEventListener('click', () => {
    const p = _projects.find(x => x.id === _currentProjectId);
    if (p) confirmDelete(_currentProjectId, p.name);
  });

  _container.querySelector('#btn-detail-create-invoice')?.addEventListener('click', async () => {
    const p = _projects.find(x => x.id === _currentProjectId);
    if (!p) return;
    let amount = p.amount ?? '';
    let notes  = p.notes  ?? '';
    try {
      const features = await getByIndex('blueprintFeatures', 'projectId', p.id);
      if (features && features.length) {
        const total = features.reduce((s, f) => s + Number(f.price || 0), 0);
        if (total) amount = total;
      }
    } catch (_) { /* fall through to project defaults */ }
    sessionStorage.setItem('qfl_invoice_prefill', JSON.stringify({
      clientId:  p.clientId ?? null,
      projectId: p.id,
      amount,
      notes,
      dueAt:     p.endDate ?? '',
    }));
    navigate('invoices');
  });

  _container.querySelector('#btn-detail-blueprint')
    ?.addEventListener('click', () => openBlueprintView());

  _container.querySelector('#btn-amount-source')?.addEventListener('click', () => {
    const project = _projects.find(p => p.id === _currentProjectId);
    if (!project) return;
    const bpTotal        = _blueprintFeatures.reduce((s, f) => s + Number(f.price || 0), 0);
    const hourlyRate     = Number(getSettings().blueprint?.amountPerHour || 0);
    const trackedSec     = _sessions.reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
    const effectiveHours = Number(project.hours) || (trackedSec > 0 ? trackedSec / 3600 : null);
    const hourlyAmount   = (hourlyRate > 0 && effectiveHours) ? hourlyRate * effectiveHours : null;
    showAmountSourceModal(project, { bpTotal, hourlyAmount, hourlyRate, effectiveHours });
  });

  _container.querySelector('#btn-hours-source')?.addEventListener('click', () => {
    const project = _projects.find(p => p.id === _currentProjectId);
    if (!project) return;
    const trackedSec  = _sessions.reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
    const trackedHours = trackedSec > 0 ? trackedSec / 3600 : 0;
    showHoursSourceModal(project, { trackedHours });
  });

  // Initialise timer controls for the current project
  renderTimerControls();
  // Re-register this project's controls in the global map
  _registerTimerControls(_currentProjectId);
}

/* ── Milestones ─────────────────────────────────────────────────────────── */

async function loadMilestones(projectId) {
  const all = await getByIndex('milestones', 'projectId', projectId);
  return all.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
}

function renderMilestones() {
  const el = _container?.querySelector('#milestones-list');
  if (!el) return;

  // ── Time-tracked summary bar ────────────────────────────────────────────
  const totalTrackedSec = _sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const budgetProject   = _projects.find(p => p.id === _currentProjectId);
  const budgetHours     = budgetProject?.hours ? Number(budgetProject.hours) : null; // always estimated only
  const trackedHours    = totalTrackedSec / 3600;
  const showTimeBar     = totalTrackedSec > 0 || budgetHours;
  const timePct         = budgetHours ? Math.min(100, Math.round((trackedHours / budgetHours) * 100)) : null;
  const timeBarColor    = timePct !== null
    ? (timePct >= 100 ? 'var(--clr-danger)' : timePct >= 80 ? 'var(--clr-warning)' : 'var(--clr-success)')
    : 'var(--clr-primary)';

  const timeBarHTML = showTimeBar ? `
    <div class="mb-5 px-4 rounded-xl" style="background:var(--clr-surface-2);border:1px solid var(--clr-border-mid);padding-top:${budgetHours ? '0.75rem' : '0.45rem'};padding-bottom:${budgetHours ? '0.75rem' : '0.45rem'}">
      <div class="flex justify-between items-center ${budgetHours ? 'mb-2' : ''}">
        <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--clr-text-faint)">Time Tracked</span>
        <span style="font-size:13px;font-weight:700;color:var(--clr-text)">
          ${formatDurationShort(totalTrackedSec)}
          ${budgetHours ? `<span style="font-size:11px;font-weight:500;color:var(--clr-text-faint)"> / ${budgetHours} hrs budget</span>` : ''}
        </span>
      </div>
      ${budgetHours ? `
        <div style="height:6px;border-radius:9999px;background:var(--clr-border);overflow:hidden">
          <div style="height:6px;border-radius:9999px;width:${timePct}%;background:${timeBarColor};transition:width 0.5s ease"></div>
        </div>` : ''}
    </div>` : '';

  // ── Milestone progress summary ──────────────────────────────────────────
  const doneMs  = _milestones.filter(m => m.completed).length;
  const totalMs = _milestones.length;
  const msPct   = totalMs ? Math.round((doneMs / totalMs) * 100) : 0;
  const milestoneProgressHTML = totalMs ? `
    <div class="mb-5">
      <div class="flex justify-between mb-1.5" style="font-size:12px;color:var(--clr-text-muted)">
        <span>${doneMs} of ${totalMs} milestones completed</span>
        <span>${msPct}%</span>
      </div>
      <div style="height:5px;border-radius:9999px;background:var(--clr-border);overflow:hidden">
        <div style="height:5px;border-radius:9999px;width:${msPct}%;background:var(--clr-primary);transition:width 0.5s ease"></div>
      </div>
    </div>` : '';

  // ── Build chronological timeline ────────────────────────────────────────
  // Standalone sessions (no milestone or milestone was completed at stop time)
  const standaloneItems = _sessions
    .filter(s => s.milestoneId === null)
    .map(s => ({ kind: 'session', item: s, at: s.createdAt }));

  // Milestone entries
  const milestoneItems = _milestones
    .map(m => ({ kind: 'milestone', item: m, at: m.createdAt }));

  // Sessions attached to milestones, grouped
  const sessionsByMs = {};
  _sessions
    .filter(s => s.milestoneId !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach(s => {
      (sessionsByMs[s.milestoneId] ??= []).push(s);
    });

  // Flat sorted timeline
  const timeline = [...standaloneItems, ...milestoneItems]
    .sort((a, b) => a.at.localeCompare(b.at));

  if (!timeline.length) {
    el.innerHTML = `
      ${timeBarHTML}
      <div style="padding:2.5rem 0;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center">
        <svg style="width:40px;height:40px;color:var(--clr-surface-3)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
               M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
        </svg>
        <p style="font-size:0.875rem;font-weight:500;color:var(--clr-text-muted)">Nothing yet</p>
        <p style="font-size:0.75rem;color:var(--clr-text-faint)">Add a milestone or start the timer to track work.</p>
      </div>`;
    return;
  }

  const timelineHTML = timeline.map(entry => {
    if (entry.kind === 'milestone') {
      return milestoneBlockHTML(entry.item, sessionsByMs[entry.item.id] ?? []);
    }
    return standaloneSessionHTML(entry.item);
  }).join('');

  el.innerHTML = `${timeBarHTML}${milestoneProgressHTML}<div style="display:flex;flex-direction:column;gap:6px">${timelineHTML}</div>`;

  el.querySelectorAll('[data-ms-action="toggle"]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); toggleMilestone(Number(btn.dataset.id)); })
  );
  el.querySelectorAll('[data-ms-action="rename"]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openRenameMilestoneModal(Number(btn.dataset.id)); })
  );
  el.querySelectorAll('[data-ms-action="delete"]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteMilestone(Number(btn.dataset.id), btn.dataset.name); })
  );
  el.querySelectorAll('[data-sess-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteSession(Number(btn.dataset.id), btn.dataset.name))
  );
  // Milestone row collapse / expand
  el.querySelectorAll('[data-ms-action="collapse"]').forEach(header => {
    header.addEventListener('click', e => {
      // Don't collapse when clicking toggle/rename/delete inside the header
      if (e.target.closest('[data-ms-action="toggle"],[data-ms-action="rename"],[data-ms-action="delete"]')) return;
      const id      = header.dataset.id;
      const pane    = el.querySelector(`[data-ms-sessions="${id}"]`);
      const chevron = el.querySelector(`[data-chevron="${id}"]`);
      if (!pane) return;
      const isHidden = pane.style.display === 'none';
      pane.style.display   = isHidden ? '' : 'none';
      if (chevron) chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
      // Persist so re-renders don't reset the state
      if (isHidden) _collapsedMilestones.delete(id);
      else          _collapsedMilestones.add(id);
    });
  });

  // Restore persisted collapsed state after each re-render
  _collapsedMilestones.forEach(id => {
    const pane    = el.querySelector(`[data-ms-sessions="${id}"]`);
    const chevron = el.querySelector(`[data-chevron="${id}"]`);
    if (pane)    pane.style.display        = 'none';
    if (chevron) chevron.style.transform   = 'rotate(-90deg)';
  });
}

function sessionGroupHTML(title, sessions) {
  return `
    <div style="border-radius:10px;overflow:hidden;border:1px solid var(--clr-border)">
      <div style="padding:6px 12px;background:var(--clr-surface-2)">
        <span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--clr-text-faint)">${title}</span>
      </div>
      <div>${sessions.map(s => sessionItemHTML(s)).join('')}</div>
    </div>`;
}

/** Milestone as a block with its sessions indented beneath it */
function milestoneBlockHTML(m, sessions) {
  const done        = m.completed;
  const hasSessions = sessions.length > 0;
  const toggleStyle = done
    ? 'width:18px;height:18px;border-radius:9999px;border:2px solid var(--clr-success);background:var(--clr-success);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;transition:all 150ms ease'
    : 'width:18px;height:18px;border-radius:9999px;border:2px solid var(--clr-text-faint);background:transparent;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;transition:all 150ms ease';
  const bgColor     = done ? 'var(--clr-surface)' : 'var(--clr-surface-2)';
  const borderColor = done ? 'var(--clr-border)'  : 'var(--clr-border-mid)';
  const accentColor = done ? 'var(--clr-success)'  : 'var(--clr-primary)';

  return `
    <div>
      <!-- Milestone row -->
      <div class="group" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;
                                background:${bgColor};border:1px solid ${borderColor};
                                ${hasSessions ? 'cursor:pointer;' : ''}${done ? 'opacity:0.75' : ''}"
           ${hasSessions ? `data-ms-action="collapse" data-id="${m.id}"` : ''}>
        <button data-ms-action="toggle" data-id="${m.id}"
                title="${done ? 'Mark incomplete' : 'Mark complete'}"
                style="${toggleStyle}">
          ${done ? `<svg style="width:10px;height:10px" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>` : ''}
        </button>
        <!-- Flag icon -->
        <svg style="width:13px;height:13px;flex-shrink:0;color:${accentColor}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/></svg>
        <span style="flex:1;font-size:0.875rem;font-weight:600;${done ? 'text-decoration:line-through;color:var(--clr-text-muted)' : 'color:var(--clr-text)'}">${escapeHtml(m.name)}</span>
        ${hasSessions ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:9999px;background:var(--clr-primary-dim);color:var(--clr-primary-light)">${sessions.length} session${sessions.length > 1 ? 's' : ''}</span>` : ''}
        <div style="display:flex;align-items:center;gap:2px;opacity:0.3;transition:opacity 150ms ease"
             onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.3'">
          <button data-ms-action="rename" data-id="${m.id}" data-name="${escapeHtml(m.name)}"
                  class="btn btn-icon" title="Rename">
            <svg style="width:13px;height:13px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/><path d="M17.586 3.586a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
          </button>
          <button data-ms-action="delete" data-id="${m.id}" data-name="${escapeHtml(m.name)}"
                  class="btn btn-icon" title="Delete" style="color:var(--clr-danger)">
            <svg style="width:13px;height:13px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
        ${hasSessions ? `
          <svg data-chevron="${m.id}" style="width:14px;height:14px;flex-shrink:0;color:var(--clr-text-faint);transition:transform 200ms ease"
               fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <polyline points="6 9 12 15 18 9"/>
          </svg>` : ''}
      </div>
      ${hasSessions ? `
        <div data-ms-sessions="${m.id}"
             style="margin-left:28px;margin-top:2px;display:flex;flex-direction:column;gap:2px;
                    border-left:2px solid ${accentColor}33;padding-left:12px;padding-bottom:4px">
          ${sessions.map(s => sessionItemHTML(s)).join('')}
        </div>` : ''}
    </div>`;
}

/** Standalone session (no milestone or milestone was completed at stop-time) */
function standaloneSessionHTML(s) {
  return sessionItemHTML(s, true);
}

function sessionItemHTML(s, standalone = false) {
  const d       = new Date(s.endedAt ?? s.createdAt);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const bg      = standalone ? 'var(--clr-surface-2)' : 'transparent';
  const border  = standalone ? '1px solid var(--clr-border)' : 'none';
  const radius  = standalone ? '8px' : '6px';
  return `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;
               background:${bg};border:${border};border-radius:${radius}">
      <svg style="width:13px;height:13px;flex-shrink:0;color:var(--clr-text-faint)" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6l4 2"/></svg>
      <span style="flex:1;font-size:12px;color:var(--clr-text-muted)">${escapeHtml(s.name)}</span>
      <span style="font-size:12px;font-weight:700;color:var(--clr-text);font-variant-numeric:tabular-nums">${formatDurationShort(s.durationSeconds)}</span>
      <span style="font-size:11px;color:var(--clr-text-faint);white-space:nowrap">${dateStr}</span>
      <button data-sess-action="delete" data-id="${s.id}" data-name="${escapeHtml(s.name)}"
              class="btn btn-icon" title="Delete session"
              style="opacity:0.25;transition:opacity 150ms ease;color:var(--clr-danger)"
              onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.25'">
        <svg style="width:12px;height:12px" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
      </button>
    </div>`;
}

function bindSessionActions(container) {
  container.querySelectorAll('[data-sess-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => confirmDeleteSession(Number(btn.dataset.id), btn.dataset.name))
  );
}

function openAddMilestoneModal() {
  openModal({
    title:       'Add Milestone',
    bodyHTML:    `
      <div class="p-6">
        <label class="form-label" for="ms-name-input">
          Milestone Name <span style="color:var(--clr-danger)">*</span>
        </label>
        <input id="ms-name-input" name="msName" type="text" class="form-input"
               placeholder="e.g. Design mockups approved" autocomplete="off" required/>
      </div>`,
    submitLabel: 'Add Milestone',
    onSubmit: async (fd) => {
      const name = fd.get('msName')?.trim();
      if (!name) throw new Error('Milestone name is required');
      await addRecord('milestones', { projectId: _currentProjectId, name, completed: false });
      _milestones = await loadMilestones(_currentProjectId);
      renderMilestones();
      toast('Milestone added.', 'success');
    },
  });
}

function openRenameMilestoneModal(id) {
  const m = _milestones.find(x => x.id === id);
  if (!m) return;
  openModal({
    title:       'Rename Milestone',
    bodyHTML:    `
      <div class="p-6">
        <label class="form-label" for="ms-rename-input">Milestone Name</label>
        <input id="ms-rename-input" name="msName" type="text" class="form-input"
               value="${escapeHtml(m.name)}" autocomplete="off" required/>
      </div>`,
    submitLabel: 'Save',
    onSubmit: async (fd) => {
      const name = fd.get('msName')?.trim();
      if (!name) throw new Error('Milestone name is required');
      await updateRecord('milestones', id, { name });
      const idx = _milestones.findIndex(x => x.id === id);
      if (idx !== -1) _milestones[idx] = { ..._milestones[idx], name };
      renderMilestones();
      toast('Milestone renamed.', 'success');
    },
  });
}

function confirmDeleteMilestone(id, name) {
  openConfirm({
    title:        'Delete Milestone',
    message:      `Delete "${name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await deleteRecord('milestones', id);
      _milestones = _milestones.filter(m => m.id !== id);
      renderMilestones();
      toast('Milestone deleted.', 'info');
    },
  });
}

async function toggleMilestone(id) {
  const m = _milestones.find(x => x.id === id);
  if (!m) return;
  const completed = !m.completed;
  await updateRecord('milestones', id, { completed });
  const idx = _milestones.findIndex(x => x.id === id);
  if (idx !== -1) _milestones[idx] = { ..._milestones[idx], completed };
  renderMilestones();
}

/* ── Sessions ───────────────────────────────────────────────────────────── */

async function loadSessions(projectId) {
  const all = await getByIndex('sessions', 'projectId', projectId);
  return all.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
}

function confirmDeleteSession(id, name) {
  openConfirm({
    title:        'Delete Session',
    message:      `Delete "${name}"? The tracked time will be removed.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await deleteRecord('sessions', id);
      _sessions = _sessions.filter(s => s.id !== id);
      renderMilestones();
      renderTimerControls();
      toast('Session deleted.', 'info');
    },
  });
}

/* ── Time helpers ───────────────────────────────────────────────────────── */

/** Format milliseconds as HH:MM:SS (live timer display) */
function formatDuration(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const totalSec = Math.floor(ms / 1000);
  const h   = Math.floor(totalSec / 3600);
  const m   = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Format seconds as human-readable short string (stored sessions) */
function formatDurationShort(seconds) {
  if (!seconds || seconds < 1) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/* ── Timer controls ─────────────────────────────────────────────────────── */

function _registerTimerControls(pid) {
  if (!window._qflAllTimerControls) window._qflAllTimerControls = new Map();
  window._qflAllTimerControls.set(pid, {
    pause:  () => _pauseTimerById(pid),
    resume: () => _resumeTimerById(pid),
    stop:   () => _stopTimerById(pid),
  });
}

function renderTimerControls() {
  const el = _container?.querySelector('#timer-controls');
  if (!el) return;
  el.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:nowrap';
  const pid    = _currentProjectId;
  const status = pid ? (getTimerState(pid).status) : 'idle';

  if (status === 'idle') {
    el.innerHTML = `
      <button id="btn-timer-start" class="btn btn-ghost flex items-center gap-2 text-sm"
              style="color:var(--clr-success);border:1px solid var(--clr-success-ring)">
        <svg style="width:13px;height:13px" fill="currentColor" viewBox="0 0 24 24">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        Start Timer
      </button>`;
  } else {
    const elapsed  = getElapsedMs(pid);
    const isPaused = status === 'paused';
    el.innerHTML = `
      <span id="timer-display"
            style="font-size:0.875rem;font-weight:700;font-variant-numeric:tabular-nums;min-width:5.5rem;text-align:center;
                   padding:0.375rem 0.5rem;border-radius:0.4rem;background:var(--clr-surface-2);
                   color:${isPaused ? 'var(--clr-text-muted)' : 'var(--clr-success)'}">
        ${formatDuration(elapsed)}
      </span>
      ${isPaused
        ? `<button id="btn-timer-resume" class="btn btn-ghost flex items-center gap-2 text-sm"
                   style="color:var(--clr-success);border:1px solid var(--clr-success-ring)">
             <svg style="width:12px;height:12px" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
             Resume
           </button>`
        : `<button id="btn-timer-pause" class="btn btn-ghost flex items-center gap-2 text-sm">
             <svg style="width:12px;height:12px" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
             Pause
           </button>`}
      <button id="btn-timer-stop" class="btn btn-ghost flex items-center gap-2 text-sm"
              style="color:var(--clr-danger);border:1px solid var(--clr-danger-ring)">
        <svg style="width:12px;height:12px" fill="currentColor" viewBox="0 0 24 24">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
        Stop
      </button>`;
  }

  el.querySelector('#btn-timer-start') ?.addEventListener('click', () => _startTimer());
  el.querySelector('#btn-timer-pause') ?.addEventListener('click', () => _pauseTimerById(_currentProjectId));
  el.querySelector('#btn-timer-resume')?.addEventListener('click', () => _resumeTimerById(_currentProjectId));
  el.querySelector('#btn-timer-stop')  ?.addEventListener('click', () => _stopTimerById(_currentProjectId));
}

function _updateTimerDisplay(pid) {
  // Only update the DOM display if this project is currently in view
  if (pid === _currentProjectId) {
    const el = _container?.querySelector('#timer-display');
    if (el) el.textContent = formatDuration(getElapsedMs(pid));
  }
  dispatchTimerEvent('qfl:timer-tick');
}

function _startTimer() {
  const pid     = _currentProjectId;
  const project = _projects.find(p => p.id === pid);
  const t       = getTimerState(pid);
  t.projectName  = project?.name ?? 'Project';
  t.status       = 'running';
  t.startedAt    = new Date();
  t.intervalId   = setInterval(() => _updateTimerDisplay(pid), 1000);
  renderTimerControls();
  _registerTimerControls(pid);
  dispatchTimerEvent('qfl:timer-updated');
  toast('Timer started.', 'info');
}

function _pauseTimerById(pid) {
  const t = _timerStates.get(pid);
  if (!t || t.status !== 'running') return;
  t.accumulatedMs += Date.now() - t.startedAt.getTime();
  t.startedAt     = null;
  t.status        = 'paused';
  clearInterval(t.intervalId);
  t.intervalId    = null;
  if (pid === _currentProjectId) renderTimerControls();
  dispatchTimerEvent('qfl:timer-updated');
}

function _resumeTimerById(pid) {
  const t = _timerStates.get(pid);
  if (!t || t.status !== 'paused') return;
  t.status     = 'running';
  t.startedAt  = new Date();
  t.intervalId = setInterval(() => _updateTimerDisplay(pid), 1000);
  if (pid === _currentProjectId) renderTimerControls();
  dispatchTimerEvent('qfl:timer-updated');
}

async function _stopTimerById(pid) {
  const t       = _timerStates.get(pid);
  if (!t || t.status === 'idle') return;
  const totalMs = getElapsedMs(pid);
  clearInterval(t.intervalId);
  _timerStates.delete(pid);
  if (window._qflAllTimerControls) window._qflAllTimerControls.delete(pid);

  if (pid === _currentProjectId) renderTimerControls();
  dispatchTimerEvent('qfl:timer-updated');

  if (totalMs < 1000) {
    toast('Session too short to save (< 1 second).', 'info');
    return;
  }

  const durationSeconds = Math.floor(totalMs / 1000);

  // Load milestones + sessions for this project (may differ from _currentProjectId)
  const [milestones, sessionsForPid] = await Promise.all([
    loadMilestones(pid),
    loadSessions(pid),
  ]);

  const sessionNumber  = sessionsForPid.length + 1;
  const name           = `Session ${sessionNumber}`;

  const incompleteMs   = milestones.filter(m => !m.completed);
  const lastMilestone  = incompleteMs.length
    ? incompleteMs.reduce((latest, m) => (m.createdAt > latest.createdAt ? m : latest), incompleteMs[0])
    : null;

  const endedAt   = new Date().toISOString();
  const startedAt = new Date(Date.now() - totalMs).toISOString();

  await addRecord('sessions', {
    projectId:   pid,
    milestoneId: lastMilestone?.id ?? null,
    name,
    durationSeconds,
    startedAt,
    endedAt,
  });

  // If this is the active detail view, refresh cached data + UI
  if (pid === _currentProjectId) {
    _sessions = await loadSessions(pid);
    if (lastMilestone) _collapsedMilestones.delete(String(lastMilestone.id));
    renderMilestones();
    renderStatCards();
  }

  // Fire stopped event carrying remaining active timers
  window.dispatchEvent(new CustomEvent('qfl:timer-stopped', { detail: { allTimers: allActiveTimers() } }));
  toast(`${name} saved — ${formatDurationShort(durationSeconds)}.`, 'success');
}

/* ── Blueprint ───────────────────────────────────────────────────────────── */

async function loadBlueprintFeatures(projectId) {
  const all = await getByIndex('blueprintFeatures', 'projectId', projectId);
  return all.sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.createdAt.localeCompare(b.createdAt));
}

function openBlueprintView() {
  navigate('project/' + _currentProjectId + '/blueprint');
}

function blueprintViewHTML(project, clientName, terms) {
  const overdue = project.endDate && project.status !== 'complete' && project.status !== 'cancelled'
                  && new Date(project.endDate) < new Date();

  const bpDefaults = getSettings().defaultFeatures ?? [];
  const addFeatureBtnHTML = bpDefaults.length ? `
    <div style="position:relative" id="bp-add-feature-wrap">
      <button id="bp-add-feature-toggle" class="btn btn-secondary flex items-center gap-2 text-sm">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
        Add Feature
        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      <div id="bp-add-feature-menu"
           style="display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:200;
                  min-width:220px;background:var(--clr-surface);border:1px solid var(--clr-border);
                  border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);overflow:hidden;">
        <button data-add-type="new"
                style="width:100%;display:flex;align-items:center;gap:8px;padding:9px 14px;
                       background:none;border:none;cursor:pointer;font-size:13px;font-weight:600;
                       color:var(--clr-text);text-align:left;"
                onmouseenter="this.style.background='var(--clr-surface-2)'"
                onmouseleave="this.style.background='none'">
          <svg style="width:13px;height:13px;flex-shrink:0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
          </svg>
          New
        </button>
        <div style="height:1px;background:var(--clr-border);margin:2px 0"></div>
        ${bpDefaults.map((d, i) => `
          <button data-add-type="preset" data-preset-idx="${i}"
                  style="width:100%;display:flex;align-items:center;justify-content:space-between;
                         gap:10px;padding:9px 14px;background:none;border:none;cursor:pointer;
                         font-size:13px;color:var(--clr-text);text-align:left;"
                  onmouseenter="this.style.background='var(--clr-surface-2)'"
                  onmouseleave="this.style.background='none'">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.name)}</span>
            ${d.price != null && d.price !== '' ? `<span style="font-size:11px;color:var(--clr-text-faint);flex-shrink:0">QAR ${Number(d.price).toLocaleString()}</span>` : ''}
          </button>`).join('')}
      </div>
    </div>` : `
    <button id="bp-add-feature" class="btn btn-secondary flex items-center gap-2 text-sm">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
      </svg>
      Add Feature
    </button>`;

  return `
    <!-- Blueprint header card -->
    <div class="card p-6 mb-6">
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div class="flex items-center gap-2 min-w-0">
          <button id="bp-back" class="btn btn-icon shrink-0"
                  title="Back to project" aria-label="Back to project">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <div class="min-w-0">
            <h2 class="text-xl font-semibold text-[var(--clr-text)]">Project Blueprint</h2>
            <p class="text-sm text-[var(--clr-text-faint)] mt-0.5 truncate">${escapeHtml(project.name)}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button id="btn-bp-create-invoice" class="btn btn-secondary flex items-center gap-2 text-sm shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293
                   l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Create Invoice
          </button>
          <button id="bp-export-pdf" class="btn btn-primary flex items-center gap-2 text-sm shrink-0">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2
                   m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm1-4h.01"/>
            </svg>
            Export PDF
          </button>
        </div>
      </div>

      ${(() => {
        // Effective amount — same logic as detail view
        const bpAmt          = _blueprintFeatures.reduce((s, f) => s + Number(f.price || 0), 0);
        const hrRate         = Number(getSettings().blueprint?.amountPerHour || 0);
        const trackedSec     = _sessions.reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
        const effHoursAmt    = Number(project.hours) || (trackedSec > 0 ? trackedSec / 3600 : null);
        const hourlyAmt      = (!Number(project.amount) && bpAmt === 0 && hrRate > 0 && effHoursAmt)
                               ? hrRate * effHoursAmt : null;
        const effAmount      = Number(project.amount) || bpAmt || hourlyAmt || null;
        const amtFromBP      = !Number(project.amount) && bpAmt > 0;
        const amtFromHourly  = !Number(project.amount) && !bpAmt && hourlyAmt != null;
        const amtLabel       = effAmount
          ? `${formatQAR(effAmount)}<span style="font-size:.65rem;opacity:.7;display:block;margin-top:.1rem">${amtFromBP ? '(from blueprint)' : amtFromHourly ? '(hourly rate)' : ''}</span>`
          : '—';
        const amtColor       = (amtFromBP || amtFromHourly) ? 'var(--clr-primary-light)' : null;

        // Effective hours — same logic as detail view
        const trackedHrs     = trackedSec > 0 ? trackedSec / 3600 : null;
        const effHours       = Number(project.hours) || trackedHrs || null;
        const hrsTracked     = !Number(project.hours) && trackedHrs != null;
        const hrsLabel       = effHours
          ? `${effHours % 1 === 0 ? effHours.toLocaleString() : effHours.toFixed(1)} hrs<span style="font-size:.65rem;opacity:.7;display:block;margin-top:.1rem">${hrsTracked ? '(tracked)' : ''}</span>`
          : '—';
        const hrsColor       = hrsTracked ? 'var(--clr-primary-light)' : null;

        return `
      <!-- Details grid — no Status -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6 pt-6
                  border-t border-[var(--clr-border)]">
        ${detailField('Client',     clientName || '—')}
        ${detailField('Amount',     amtLabel, amtColor)}
        ${detailField('Hours',      hrsLabel, hrsColor)}
        ${detailField('Start Date', formatDate(project.startDate))}
        ${detailField('Due Date',   formatDate(project.endDate), overdue ? 'var(--clr-danger)' : null, overdue)}
      </div>`;
      })()}
    </div>

    <!-- Project Description card -->
    <div class="card p-6 mb-6">
      <div class="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 class="font-semibold text-[var(--clr-text)]">Project Description</h3>
          <p class="text-xs text-[var(--clr-text-faint)] mt-0.5">Scope, objectives and details for this proposal</p>
        </div>
        <span id="bp-desc-status" class="text-xs text-[var(--clr-text-faint)] mt-1 shrink-0"></span>
      </div>
      <textarea id="bp-description"
                class="form-input w-full"
                rows="5"
                placeholder="Describe the project scope, goals, and deliverables…"
                style="resize:vertical;line-height:1.65">${escapeHtml(project.blueprintDescription ?? '')}</textarea>
    </div>

    <!-- Features & Services card -->
    <div class="card p-6 mb-6">
      <div class="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h3 class="font-semibold text-[var(--clr-text)]">Features &amp; Services</h3>
          <p class="text-xs text-[var(--clr-text-faint)] mt-0.5">Deliverables included in this proposal</p>
        </div>
        ${addFeatureBtnHTML}
      </div>
      <div id="bp-features-table"></div>
    </div>

    <!-- Terms of Agreement card -->
    ${ terms.trim() ? `
    <div class="card p-6">
      <h3 class="font-semibold text-[var(--clr-text)] mb-1">Terms of Agreement</h3>
      <p class="text-xs text-[var(--clr-text-faint)] mb-4">
        Edit in <strong>Settings → Blueprint / Proposal</strong>
      </p>
      <p class="text-sm text-[var(--clr-text-muted)] whitespace-pre-wrap leading-relaxed">${escapeHtml(terms)}</p>
    </div>` : `
    <div class="card p-6 text-center">
      <p class="text-sm text-[var(--clr-text-muted)]">No Terms of Agreement configured.</p>
      <p class="text-xs text-[var(--clr-text-faint)] mt-1">
        Go to <strong>Settings → Blueprint / Proposal</strong> to add standard terms.
      </p>
    </div>`}
  `;
}

function renderBlueprintFeatures() {
  const el = document.getElementById('bp-features-table');
  if (!el) return;

  if (!_blueprintFeatures.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:2.5rem 0;color:var(--clr-text-faint)">
        <svg style="width:36px;height:36px;margin:0 auto 10px;color:var(--clr-surface-3)"
             fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2
               M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <p style="font-size:13px;font-weight:500;color:var(--clr-text-muted)">No features yet</p>
        <p style="font-size:12px;margin-top:4px">Click "Add Feature" to list deliverables and services.</p>
      </div>`;
    return;
  }

  const total = _blueprintFeatures.reduce((sum, f) => sum + (Number(f.price) || 0), 0);
  el.innerHTML = `
    <div style="border-radius:10px;overflow:hidden;border:1px solid var(--clr-border)">
      <div style="display:grid;grid-template-columns:1.1fr 1.4fr 130px 70px;
                  padding:8px 14px;background:var(--clr-surface-2);
                  border-bottom:1px solid var(--clr-border);gap:8px">
        <span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
                     color:var(--clr-text-faint)">Feature / Service</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
                     color:var(--clr-text-faint)">Details</span>
        <span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
                     color:var(--clr-text-faint);text-align:right">Price</span>
        <span></span>
      </div>
      ${_blueprintFeatures.map(f => blueprintFeatureRowHTML(f)).join('')}
      ${total > 0 ? `
        <div style="display:grid;grid-template-columns:1.1fr 1.4fr 130px 70px;
                    padding:10px 14px;background:var(--clr-primary-dim);gap:8px;
                    border-top:1px solid var(--clr-border)">
          <span style="font-size:12px;font-weight:700;color:var(--clr-primary-light);
                       grid-column:1/3">Total Estimate</span>
          <span style="font-size:13px;font-weight:800;color:var(--clr-primary-light);
                       text-align:right;font-variant-numeric:tabular-nums">
            ${escapeHtml(formatQAR(total))}
          </span>
          <span></span>
        </div>` : ''}
    </div>`;

  bindBlueprintFeatureRowListeners();
}

function blueprintFeatureRowHTML(f) {
  return `
    <div data-bp-feature-id="${f.id}"
         style="display:grid;grid-template-columns:1.1fr 1.4fr 130px 70px;
                align-items:center;padding:10px 14px;gap:8px;
                border-bottom:1px solid var(--clr-border);transition:background 120ms ease"
         onmouseenter="this.style.background='var(--clr-surface-2)'"
         onmouseleave="this.style.background=''">
      <span style="font-size:13px;font-weight:600;color:var(--clr-text)">
        ${escapeHtml(f.name)}
      </span>
      <span style="font-size:12px;color:var(--clr-text-muted);overflow:hidden;
                   text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(f.details || '')}">
        ${escapeHtml(f.details || '—')}
      </span>
      <span style="font-size:13px;font-weight:600;color:var(--clr-text);text-align:right;
                   font-variant-numeric:tabular-nums">
        ${f.price ? escapeHtml(formatQAR(Number(f.price)))
                  : '<span style="color:var(--clr-text-faint)">—</span>'}
      </span>
      <div style="display:flex;justify-content:flex-end;gap:2px">
        <button class="btn btn-icon bp-edit-feature" data-id="${f.id}" title="Edit feature">
          <svg style="width:12px;height:12px" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5"/>
            <path d="M17.586 3.586a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button class="btn btn-icon bp-delete-feature"
                data-id="${f.id}" data-name="${escapeHtml(f.name)}"
                title="Delete feature" style="color:var(--clr-danger)">
          <svg style="width:12px;height:12px" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6m4-6v6"/>
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function bindBlueprintFeatureRowListeners() {
  document.querySelectorAll('.bp-edit-feature').forEach(btn =>
    btn.addEventListener('click', () => showBlueprintFeatureForm(Number(btn.dataset.id)))
  );
  document.querySelectorAll('.bp-delete-feature').forEach(btn =>
    btn.addEventListener('click', () =>
      confirmDeleteBlueprintFeature(Number(btn.dataset.id), btn.dataset.name)
    )
  );
}

function showBlueprintFeatureForm(editId = null, prefill = null) {
  const base = (editId != null) ? (_blueprintFeatures.find(x => x.id === editId) ?? {}) : (prefill ?? {});
  const f    = base;

  openModal({
    title:       editId != null ? 'Edit Feature' : 'Add Feature',
    submitLabel: editId != null ? 'Save Changes' : 'Add Feature',
    bodyHTML: `
      <div class="space-y-4 px-6 py-5">
        <div>
          <label class="form-label">
            Feature / Service <span class="text-[var(--clr-danger)]">*</span>
          </label>
          <input id="bp-f-name" name="bp-f-name" class="form-input"
                 value="${escapeHtml(f.name || '')}"
                 placeholder="e.g. Mobile App Design">
        </div>
        <div>
          <label class="form-label">Details</label>
          <input id="bp-f-details" name="bp-f-details" class="form-input"
                 value="${escapeHtml(f.details || '')}"
                 placeholder="Brief description of scope">
        </div>
        <div>
          <label class="form-label">
            Price
            <span class="text-xs font-normal text-[var(--clr-text-faint)] ml-1">(optional)</span>
          </label>
          <input id="bp-f-price" name="bp-f-price" class="form-input"
                 type="number" min="0" step="0.01"
                 value="${f.price ?? ''}" placeholder="0.00">
        </div>
      </div>`,
    onSubmit: async () => {
      const name     = document.getElementById('bp-f-name')?.value.trim();
      const details  = document.getElementById('bp-f-details')?.value.trim() ?? '';
      const priceRaw = document.getElementById('bp-f-price')?.value.trim();
      if (!name) {
        document.getElementById('bp-f-name')?.focus();
        throw new Error('Feature / Service name is required.');
      }
      const price = priceRaw ? Number(priceRaw) : null;
      if (editId != null) {
        await updateRecord('blueprintFeatures', editId, { name, details, price });
      } else {
        await addRecord('blueprintFeatures', {
          projectId: _currentProjectId,
          name, details, price,
          sortOrder: _blueprintFeatures.length,
          createdAt: new Date().toISOString(),
        });
      }
      _blueprintFeatures = await loadBlueprintFeatures(_currentProjectId);
      renderBlueprintFeatures();
    },
  });
}

async function confirmDeleteBlueprintFeature(id, name) {
  openConfirm({
    title:        'Delete Feature?',
    message:      `"${name}" will be permanently removed from this blueprint.`,
    confirmLabel: 'Delete',
    onConfirm:    async () => {
      await deleteRecord('blueprintFeatures', id);
      _blueprintFeatures = await loadBlueprintFeatures(_currentProjectId);
      renderBlueprintFeatures();
    },
  });
}

function bindBlueprintListeners(container, project, client) {
  container.querySelector('#bp-back')
    ?.addEventListener('click', () => openDetailView(_currentProjectId));

  container.querySelector('#btn-bp-create-invoice')?.addEventListener('click', () => {
    const total = _blueprintFeatures.reduce((sum, f) => sum + Number(f.price || 0), 0);
    const desc  = (container.querySelector('#bp-description')?.value ?? project.blueprintDescription ?? '').trim();
    sessionStorage.setItem('qfl_invoice_prefill', JSON.stringify({
      clientId:  project.clientId ?? null,
      projectId: project.id,
      amount:    total || project.amount || '',
      notes:     desc,
      dueAt:     project.endDate ?? '',
    }));
    navigate('invoices');
  });

  // ── Add Feature — dropdown (when defaults exist) or plain button
  const _addWrap = container.querySelector('#bp-add-feature-wrap');
  const _addBtn  = container.querySelector('#bp-add-feature');
  if (_addWrap) {
    const _toggle = _addWrap.querySelector('#bp-add-feature-toggle');
    const _menu   = _addWrap.querySelector('#bp-add-feature-menu');
    _toggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      _menu.style.display = _menu.style.display === 'none' ? 'block' : 'none';
    });
    _menu?.addEventListener('click', async (e) => {
      const item = e.target.closest('[data-add-type]');
      if (!item) return;
      _menu.style.display = 'none';
      if (item.dataset.addType === 'new') {
        showBlueprintFeatureForm(null, null);
      } else if (item.dataset.addType === 'preset') {
        const d = (getSettings().defaultFeatures ?? [])[Number(item.dataset.presetIdx)];
        if (!d) return;
        await addRecord('blueprintFeatures', {
          projectId: _currentProjectId,
          name:      d.name ?? '',
          details:   d.details ?? '',
          price:     d.price != null && d.price !== '' ? Number(d.price) : null,
          sortOrder: _blueprintFeatures.length,
          createdAt: new Date().toISOString(),
        });
        _blueprintFeatures = await loadBlueprintFeatures(_currentProjectId);
        renderBlueprintFeatures();
      }
    });
    document.addEventListener('click', function _closeBpMenu(e) {
      if (!_addWrap.isConnected) { document.removeEventListener('click', _closeBpMenu, true); return; }
      if (!_addWrap.contains(e.target)) _menu.style.display = 'none';
    }, true);
  } else if (_addBtn) {
    _addBtn.addEventListener('click', () => showBlueprintFeatureForm(null, null));
  }

  container.querySelector('#bp-export-pdf')
    ?.addEventListener('click', () => {
      // Pass the live textarea value so the PDF always reflects the current text
      const desc = container.querySelector('#bp-description')?.value ?? project.blueprintDescription ?? '';
      printBlueprint({ ...project, blueprintDescription: desc }, client, _blueprintFeatures);
    });

  // Auto-save Project Description on blur
  const descTA    = container.querySelector('#bp-description');
  const descStatus = container.querySelector('#bp-desc-status');
  let _descTimer  = null;
  if (descTA) {
    descTA.addEventListener('input', () => {
      if (descStatus) descStatus.textContent = 'Unsaved…';
      clearTimeout(_descTimer);
      _descTimer = setTimeout(async () => {
        const val = descTA.value.trim();
        await updateRecord('projects', _currentProjectId, { blueprintDescription: val });
        // Keep local project object in sync
        const p = _projects.find(x => x.id === _currentProjectId);
        if (p) p.blueprintDescription = val;
        if (descStatus) { descStatus.textContent = 'Saved'; setTimeout(() => { descStatus.textContent = ''; }, 1500); }
      }, 800);
    });
  }
}

/* ── Form HTML (shared by add + edit) ───────────────────────────────────── */
function formHTML(project = {}) {
  const v   = (k) => escapeHtml(project[k] ?? '');
  // For the amount field: show contractAmount only (never the computed total)
  const vAmount = () => escapeHtml(String(project.contractAmount != null ? project.contractAmount : ''));
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
          <input id="pf-category" name="category" type="text" list="pf-category-list"
                 class="form-input" placeholder="e.g. Web Design, Mobile App…"
                 value="${v('category')}" autocomplete="off"/>
          <datalist id="pf-category-list">
            ${getSettings().categories.project.map(c => `<option value="${c}">`).join('')}
          </datalist>
        </div>
      </div>

      <!-- Amount + Hours -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="pf-amount">Contract Amount (QAR)</label>
          <input id="pf-amount" name="amount" type="number" min="0" step="0.01" class="form-input"
                 placeholder="e.g. 15000" value="${vAmount()}" autocomplete="off"/>
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
      const contractAmount = fd.get('amount') ? Number(fd.get('amount')) : null;
      const data = {
        name:           fd.get('name').trim(),
        clientId:       fd.get('clientId') ? Number(fd.get('clientId')) : null,
        category:       fd.get('category').trim(),
        amount:         contractAmount,
        contractAmount: contractAmount,
        hours:          fd.get('hours')     ? Number(fd.get('hours'))     : null,
        startDate:      fd.get('startDate') || null,
        endDate:        fd.get('endDate')   || null,
        status:         fd.get('status'),
        notes:          fd.get('notes').trim(),
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
      const contractAmount = fd.get('amount') ? Number(fd.get('amount')) : null;
      const newHours       = fd.get('hours')  ? Number(fd.get('hours'))  : null;
      const sources        = project.amountSources ?? [];

      // Recompute total amount from all active sources using the new contract value
      let newAmount;
      if (sources.length > 0) {
        const bpTotal      = _blueprintFeatures.reduce((s, f) => s + Number(f.price || 0), 0);
        const hourlyRate   = Number(getSettings().blueprint?.amountPerHour || 0);
        const trackedSec   = _sessions.reduce((s, sess) => s + Number(sess.durationSeconds || 0), 0);
        const effHours     = newHours || (trackedSec > 0 ? trackedSec / 3600 : null);
        const hourlyAmount = (hourlyRate > 0 && effHours) ? hourlyRate * effHours : null;
        const total = (sources.includes('contract')  ? (contractAmount || 0) : 0)
                    + (sources.includes('hourly')    ? (hourlyAmount   || 0) : 0)
                    + (sources.includes('blueprint') ? (bpTotal        || 0) : 0);
        newAmount = total || null;
      } else {
        // No sources configured — amount equals contract amount
        newAmount = contractAmount;
      }

      const updates = {
        name:           fd.get('name').trim(),
        clientId:       fd.get('clientId') ? Number(fd.get('clientId')) : null,
        category:       fd.get('category').trim(),
        contractAmount: contractAmount,
        amount:         newAmount,
        hours:          newHours,
        startDate:      fd.get('startDate') || null,
        endDate:        fd.get('endDate')   || null,
        status:         fd.get('status'),
        notes:          fd.get('notes').trim(),
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

  _container.querySelectorAll('[data-daterange]').forEach(btn => {
    btn.addEventListener('click', () => {
      _dateRange = btn.dataset.daterange;
      _container.querySelectorAll('[data-daterange]').forEach(b =>
        b.classList.toggle('filter-active', b.dataset.daterange === _dateRange)
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
      <button id="btn-add-project" class="btn btn-primary w-full sm:w-auto" title="Add Project (N)">
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
      <div class="px-5 py-3 border-t border-[var(--clr-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--clr-surface-2)]/30">
        <p id="projects-count" class="text-xs" style="color:var(--clr-text-faint)">— projects</p>
        <div class="flex items-center gap-1">
          <button class="filter-btn filter-active py-0.5 px-2 text-[11px]" data-daterange="all">All time</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-month">Last month</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-year">Last year</button>
        </div>
        <p class="text-xs hidden sm:block" style="color:var(--clr-text-faint)">QFL Dashboard · 2026</p>
      </div>
    </div>`;
}
