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
import { toast, openModal, openConfirm }                       from '../ui.js';
import { formatDate, formatQAR, escapeHtml, matchesSearch, debounce } from '../utils.js';
import { getSettings }                                         from '../settings-store.js';
import { navigate }                                            from '../router.js';

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
let _timerState        = { status: 'idle', startedAt: null, accumulatedMs: 0, intervalId: null };

/* ── Project status config ──────────────────────────────────────────────── */
const STATUSES = [
  { value: 'in-progress', label: 'In Progress', badge: 'badge-progress'  },
  { value: 'complete',    label: 'Complete',    badge: 'badge-complete'   },
  { value: 'on-hold',     label: 'On Hold',     badge: 'badge-on-hold'    },
  { value: 'cancelled',   label: 'Cancelled',   badge: 'badge-cancelled'  },
];

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container) {
  _container        = container;
  _currentProjectId = null;
  _milestones       = [];
  _sessions         = [];
  _timerState       = { status: 'idle', startedAt: null, accumulatedMs: 0, intervalId: null };
  _filter           = 'all';
  _searchQ          = '';
  _dateRange        = 'all';

  container.innerHTML = shellHTML();
  bindListeners();
  await loadProjects();
}

export function unmount() {
  if (_timerState.intervalId) clearInterval(_timerState.intervalId);
  _container = null;
}

/* ── Load data from DB ──────────────────────────────────────────────────── */
async function loadProjects() {
  try {
    [_projects, _clients] = await Promise.all([
      getAllRecords('projects'),
      getAllRecords('clients'),
    ]);

    // If a detail view is open, re-render it; fall back to list if project was deleted
    if (_currentProjectId !== null) {
      const project = _projects.find(p => p.id === _currentProjectId);
      if (project) {
        _milestones = await loadMilestones(_currentProjectId);
        _sessions   = await loadSessions(_currentProjectId);
        _container.innerHTML = detailHTML(project);
        renderMilestones();
        bindDetailListeners();
        return;
      }
      // Project was deleted — fall back to list
      _currentProjectId = null;
      _milestones = [];
      _sessions   = [];
      if (_timerState.intervalId) clearInterval(_timerState.intervalId);
      _timerState = { status: 'idle', startedAt: null, accumulatedMs: 0, intervalId: null };
      _container.innerHTML = shellHTML();
      bindListeners();
    }
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
    btn.addEventListener('click', () => {
      const p = _projects.find(pr => pr.id === Number(btn.dataset.id));
      if (!p) return;
      sessionStorage.setItem('qfl_invoice_prefill', JSON.stringify({
        clientId:  p.clientId  ?? null,
        projectId: p.id,
        amount:    p.amount    ?? '',
        notes:     p.notes     ?? '',
        dueAt:     p.endDate   ?? '',
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

async function openDetailView(id) {
  _currentProjectId = id;
  await loadProjects();
}

async function showListView() {
  if (_timerState.intervalId) clearInterval(_timerState.intervalId);
  _timerState = { status: 'idle', startedAt: null, accumulatedMs: 0, intervalId: null };
  _currentProjectId = null;
  _milestones       = [];
  _sessions         = [];
  _container.innerHTML = shellHTML();
  bindListeners();
  await loadProjects();
}

function detailHTML(project) {
  const status  = STATUSES.find(s => s.value === project.status) ?? STATUSES[0];
  const client  = escapeHtml(clientName(project.clientId));
  const overdue = project.endDate && project.status !== 'complete' && project.status !== 'cancelled'
                  && new Date(project.endDate) < new Date();

  return `
    <!-- Back -->
    <div class="mb-6">
      <button id="btn-back-to-projects"
              class="btn btn-ghost flex items-center gap-2 text-sm pl-0">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        Back to Projects
      </button>
    </div>

    <!-- Project header card -->
    <div class="card p-6 mb-6">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3 flex-wrap">
            <h2 class="text-xl font-semibold text-[var(--clr-text)]">${escapeHtml(project.name)}</h2>
            <span class="badge ${status.badge}">${status.label}</span>
          </div>
          ${project.category ? `<p class="text-sm text-[var(--clr-text-faint)] mt-1">${escapeHtml(project.category)}</p>` : ''}
        </div>

        <div class="flex items-center gap-2 shrink-0 flex-wrap">
          <button id="btn-detail-create-invoice"
                  class="btn btn-ghost flex items-center gap-2 text-sm"
                  title="Create invoice for this project">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                   a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            Invoice
          </button>
          <button id="btn-detail-edit"
                  class="btn btn-secondary flex items-center gap-2 text-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            Edit
          </button>
          <button id="btn-detail-delete"
                  class="btn btn-ghost flex items-center gap-2 text-sm"
                  style="color:var(--clr-danger)">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858
                   L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            Delete
          </button>
        </div>
      </div>

      <!-- Info grid -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6 pt-6
                  border-t border-[var(--clr-border)]">
        ${detailField('Client',     client || '—')}
        ${detailField('Amount',     project.amount ? formatQAR(Number(project.amount)) : '—')}
        ${detailField('Hours',      project.hours  ? `${Number(project.hours).toLocaleString()} hrs` : '—')}
        ${detailField('Start Date', formatDate(project.startDate))}
        ${detailField('Due Date',   formatDate(project.endDate), overdue ? 'var(--clr-danger)' : null, overdue)}
        ${detailField('Added',      formatDate(project.createdAt?.slice(0, 10)))}
      </div>

      ${project.notes ? `
        <div class="mt-5 pt-5 border-t border-[var(--clr-border)]">
          <p class="text-xs font-semibold uppercase tracking-wider text-[var(--clr-text-muted)] mb-2">Notes</p>
          <p class="text-sm text-[var(--clr-text-muted)] whitespace-pre-wrap">${escapeHtml(project.notes)}</p>
        </div>` : ''}
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

  _container.querySelector('#btn-detail-create-invoice')?.addEventListener('click', () => {
    const p = _projects.find(x => x.id === _currentProjectId);
    if (!p) return;
    sessionStorage.setItem('qfl_invoice_prefill', JSON.stringify({
      clientId:  p.clientId ?? null,
      projectId: p.id,
      amount:    p.amount   ?? '',
      notes:     p.notes    ?? '',
      dueAt:     p.endDate  ?? '',
    }));
    navigate('invoices');
  });

  // Initialise timer controls
  renderTimerControls();
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
  const budgetHours     = budgetProject?.hours ? Number(budgetProject.hours) : null;
  const trackedHours    = totalTrackedSec / 3600;
  const showTimeBar     = totalTrackedSec > 0 || budgetHours;
  const timePct         = budgetHours ? Math.min(100, Math.round((trackedHours / budgetHours) * 100)) : null;
  const timeBarColor    = timePct !== null
    ? (timePct >= 100 ? 'var(--clr-danger)' : timePct >= 80 ? 'var(--clr-warning)' : 'var(--clr-success)')
    : 'var(--clr-primary)';

  const timeBarHTML = showTimeBar ? `
    <div class="mb-5 px-4 py-3 rounded-xl" style="background:var(--clr-surface-2);border:1px solid var(--clr-border-mid)">
      <div class="flex justify-between items-center mb-2">
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
    });
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

function getElapsedMs() {
  if (_timerState.status === 'running' && _timerState.startedAt) {
    return _timerState.accumulatedMs + (Date.now() - _timerState.startedAt.getTime());
  }
  return _timerState.accumulatedMs;
}

/* ── Timer controls ─────────────────────────────────────────────────────── */

function renderTimerControls() {
  const el = _container?.querySelector('#timer-controls');
  if (!el) return;
  // Always a flex row so all controls sit on one line
  el.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:nowrap';
  const { status } = _timerState;

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
    const elapsed  = getElapsedMs();
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

  el.querySelector('#btn-timer-start')?.addEventListener('click',  startTimer);
  el.querySelector('#btn-timer-pause')?.addEventListener('click',  pauseTimer);
  el.querySelector('#btn-timer-resume')?.addEventListener('click', resumeTimer);
  el.querySelector('#btn-timer-stop')?.addEventListener('click',   () => stopTimer());
}

function updateTimerDisplay() {
  const el = _container?.querySelector('#timer-display');
  if (el) el.textContent = formatDuration(getElapsedMs());
}

function startTimer() {
  _timerState.status    = 'running';
  _timerState.startedAt = new Date();
  _timerState.intervalId = setInterval(updateTimerDisplay, 1000);
  renderTimerControls();
  toast('Timer started.', 'info');
}

function pauseTimer() {
  _timerState.accumulatedMs += Date.now() - _timerState.startedAt.getTime();
  _timerState.startedAt = null;
  _timerState.status    = 'paused';
  clearInterval(_timerState.intervalId);
  _timerState.intervalId = null;
  renderTimerControls();
}

function resumeTimer() {
  _timerState.status    = 'running';
  _timerState.startedAt = new Date();
  _timerState.intervalId = setInterval(updateTimerDisplay, 1000);
  renderTimerControls();
}

async function stopTimer() {
  const totalMs = getElapsedMs();
  clearInterval(_timerState.intervalId);
  _timerState = { status: 'idle', startedAt: null, accumulatedMs: 0, intervalId: null };

  if (totalMs < 1000) {
    renderTimerControls();
    toast('Session too short to save (< 1 second).', 'info');
    return;
  }

  const durationSeconds = Math.floor(totalMs / 1000);
  const sessionNumber   = _sessions.length + 1;
  const name            = `Session ${sessionNumber}`;

  // Attach to the last INCOMPLETE milestone — completed milestones no longer collect sessions
  const incompleteMs = _milestones.filter(m => !m.completed);
  const lastMilestone = incompleteMs.length
    ? incompleteMs.reduce((latest, m) => (m.createdAt > latest.createdAt ? m : latest), incompleteMs[0])
    : null;

  const endedAt   = new Date().toISOString();
  const startedAt = new Date(Date.now() - totalMs).toISOString();

  await addRecord('sessions', {
    projectId:       _currentProjectId,
    milestoneId:     lastMilestone?.id ?? null,
    name,
    durationSeconds,
    startedAt,
    endedAt,
  });

  _sessions = await loadSessions(_currentProjectId);
  renderTimerControls();
  renderMilestones();
  toast(`${name} saved — ${formatDurationShort(durationSeconds)}.`, 'success');
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
