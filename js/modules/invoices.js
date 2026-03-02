/**
 * invoices.js — Invoices module (CRUDS)
 *
 * Schema: { id, number, clientId, projectId?, amount, issuedAt, dueAt, status, notes, createdAt }
 *
 * Operations:
 *  C — Create  : openAddModal()   — auto-generates invoice number (INV-XXXX)
 *  R — Read    : loadInvoices() → renderTable()
 *  U — Update  : openEditModal(id)
 *  D — Delete  : confirmDelete(id)
 *  S — Search  : live search by number/client/project + status filter
 */

import { addRecord, getAllRecords, updateRecord, deleteRecord } from '../db.js';
import { toast, openModal, openConfirm }                       from '../ui.js';
import { formatDate, formatQAR, escapeHtml, matchesSearch, debounce } from '../utils.js';
import { printInvoice }                                        from '../invoice-pdf.js';

/* ── Module state ───────────────────────────────────────────────────────── */
let _invoices  = [];
let _clients   = [];
let _projects  = [];
let _filter    = 'all';
let _searchQ   = '';
let _container = null;
let _dateRange = 'all';    // 'all' | 'last-month' | 'last-year'

/* ── Invoice status config ──────────────────────────────────────────────── */
const STATUSES = [
  { value: 'draft',     label: 'Draft',     badge: 'badge-draft'     },
  { value: 'sent',      label: 'Sent',      badge: 'badge-sent'      },
  { value: 'paid',      label: 'Paid',      badge: 'badge-complete'  },
  { value: 'overdue',   label: 'Overdue',   badge: 'badge-overdue'   },
  { value: 'cancelled', label: 'Cancelled', badge: 'badge-cancelled' },
];

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container) {
  _container = container;
  _filter    = 'all';
  _searchQ   = '';
  _dateRange = 'all';

  container.innerHTML = shellHTML();
  bindListeners();
  await loadInvoices();
}

export function unmount() {
  _container = null;
}

/* ── Load all data from DB ──────────────────────────────────────────────── */
async function loadInvoices() {
  try {
    [_invoices, _clients, _projects] = await Promise.all([
      getAllRecords('invoices'),
      getAllRecords('clients'),
      getAllRecords('projects'),
    ]);
    renderStats();
    renderTable(applyFilters());

    // Consume project-prefill set by projects.js "Create Invoice" button
    const raw = sessionStorage.getItem('qfl_invoice_prefill');
    if (raw) {
      sessionStorage.removeItem('qfl_invoice_prefill');
      try { openAddModal(JSON.parse(raw)); } catch (_) { openAddModal(); }
    }
  } catch (err) {
    console.error('[Invoices] Load error:', err);
    toast('Failed to load invoices.', 'error');
  }
}

/* ── Lookup helpers ─────────────────────────────────────────────────────── */
const clientName  = (id) => _clients.find(c => c.id === Number(id))?.name  ?? '—';
const projectName = (id) => _projects.find(p => p.id === Number(id))?.name ?? '—';

/* ── Auto-generate next invoice number ──────────────────────────────────── */
function nextInvoiceNumber() {
  if (!_invoices.length) return 'INV-0001';
  // Extract the highest numeric suffix from existing numbers
  const max = _invoices.reduce((best, inv) => {
    const match = String(inv.number ?? '').match(/(\d+)$/);
    const num   = match ? parseInt(match[1], 10) : 0;
    return num > best ? num : best;
  }, 0);
  return `INV-${String(max + 1).padStart(4, '0')}`;
}

/* ── Apply search + status filters ─────────────────────────────────────── */
function applyFilters() {
  let list = _invoices;

  if (_filter !== 'all') {
    list = list.filter(i => i.status === _filter);
  }

  if (_dateRange !== 'all') {
    const now    = new Date();
    const cutoff = _dateRange === 'last-month'
      ? new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    list = list.filter(inv => {
      const d = new Date(inv.date ?? inv.createdAt ?? '');
      return !isNaN(d) && d >= cutoff;
    });
  }

  if (_searchQ.trim()) {
    list = list.filter(inv => {
      const enriched = {
        ...inv,
        clientName:  clientName(inv.clientId),
        projectName: projectName(inv.projectId),
      };
      return matchesSearch(enriched, ['number', 'clientName', 'projectName', 'notes'], _searchQ);
    });
  }

  return list;
}

/* ── Render: stats row ──────────────────────────────────────────────────── */
function renderStats() {
  const el = _container?.querySelector('#invoices-stats');
  if (!el) return;

  const total    = _invoices.length;
  const paid     = _invoices.filter(i => i.status === 'paid').length;
  const pending  = _invoices.filter(i => i.status === 'sent' || i.status === 'draft').length;
  const overdue  = _invoices.filter(i => i.status === 'overdue').length;
  const revenue  = _invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.amount || 0), 0);
  const outstanding = _invoices
    .filter(i => i.status === 'sent' || i.status === 'overdue')
    .reduce((s, i) => s + Number(i.amount || 0), 0);

  el.innerHTML = `
    ${miniStat('Total',       total,                           'blue')}
    ${miniStat('Paid',        paid,                            'emerald')}
    ${miniStat('Pending',     pending,                         'yellow')}
    ${miniStat('Overdue',     overdue,                         'red')}
    ${miniStat('Revenue',     formatQAR(revenue, true),        'violet')}
    ${miniStat('Outstanding', formatQAR(outstanding, true),    'orange')}`;
}

function miniStat(label, value, color) {
  const map = {
    blue:   { bg: 'var(--clr-primary-dim)',   text: 'var(--clr-primary-light)', border: 'var(--clr-primary-ring)'  },
    emerald:{ bg: 'var(--clr-success-bg)',    text: 'var(--clr-success)',        border: 'var(--clr-success-ring)'  },
    yellow: { bg: 'var(--clr-warning-bg)',    text: 'var(--clr-warning)',        border: 'var(--clr-warning-ring)'  },
    red:    { bg: 'var(--clr-danger-bg)',     text: 'var(--clr-danger)',         border: 'var(--clr-danger-ring)'   },
    violet: { bg: 'var(--clr-info-bg)',       text: 'var(--clr-info)',           border: 'var(--clr-info-ring)'     },
    orange: { bg: 'rgba(249,115,22,0.12)',    text: '#fb923c',                   border: 'rgba(249,115,22,0.3)'     },
  };
  const c = map[color];
  return `
    <div class="card flex flex-col gap-1 px-4 py-3" style="border-color:${c.border}; background:${c.bg}">
      <span class="text-xl font-bold leading-tight whitespace-nowrap" style="color:${c.text}">${value}</span>
      <span class="text-xs font-semibold uppercase tracking-wider text-[var(--clr-text-muted)]">${label}</span>
    </div>`;
}

/* ── Render: invoices table ─────────────────────────────────────────────── */
function renderTable(invoices) {
  const tbody = _container?.querySelector('#invoices-tbody');
  const count = _container?.querySelector('#invoices-count');
  if (!tbody) return;

  if (count) count.textContent = `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`;

  if (!invoices.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0
                 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
          </svg>
          <p class="font-medium text-[var(--clr-text-muted)]">No invoices found</p>
          <p>${_searchQ || _filter !== 'all' ? 'Try adjusting your search or filter.' : 'Create your first invoice to get started.'}</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = invoices.map(inv => rowHTML(inv)).join('');

  tbody.querySelectorAll('[data-action="pdf"]').forEach(btn =>
    btn.addEventListener('click', () => {
      const inv     = _invoices.find(i => i.id === Number(btn.dataset.id));
      if (!inv) return;
      const client  = _clients.find(c => c.id === Number(inv.clientId))  ?? null;
      const project = _projects.find(p => p.id === Number(inv.projectId)) ?? null;
      const ok = printInvoice(inv, client, project);
      if (!ok) toast('Popup blocked — please allow popups for this site.', 'warning');
    })
  );
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)))
  );
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(Number(btn.dataset.id), btn.dataset.number))
  );

  // Cycle status on badge click
  tbody.querySelectorAll('[data-action="status-btn"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id      = Number(btn.dataset.id);
      const invoice = _invoices.find(inv => inv.id === id);
      if (!invoice) return;
      const idx  = STATUSES.findIndex(s => s.value === invoice.status);
      const next = STATUSES[(idx + 1) % STATUSES.length];
      try {
        await updateRecord('invoices', id, { status: next.value });
        const wasPaid = invoice.status === 'paid';
        invoice.status = next.value;
        renderStats();
        renderTable(applyFilters());
        if (next.value === 'paid' && !wasPaid) {
          await createPaidTransaction(invoice);
          toast('Status changed to Paid — income transaction added.', 'success');
        } else {
          toast(`Status changed to ${next.label}.`, 'success');
        }
      } catch (err) {
        console.error('[Invoices] Status update error:', err);
        toast('Failed to update status.', 'error');
      }
    });
  });
}

/* ── Row HTML ───────────────────────────────────────────────────────────── */
function rowHTML(inv) {
  const status   = STATUSES.find(s => s.value === inv.status) ?? STATUSES[0];
  const issuedAt = formatDate(inv.issuedAt);
  const dueAt    = formatDate(inv.dueAt);
  const isOverdue = inv.dueAt && inv.status !== 'paid' && inv.status !== 'cancelled'
                    && new Date(inv.dueAt) < new Date();

  return `
    <tr class="border-b border-[var(--clr-border)] last:border-0
               hover:bg-[var(--clr-surface-2)]/50 transition-colors duration-150">

      <!-- Invoice number -->
      <td class="td-cell">
        <span class="font-mono font-semibold text-[var(--clr-primary-light)] text-sm">
          ${escapeHtml(inv.number ?? '—')}
        </span>
      </td>

      <!-- Client -->
      <td class="td-cell text-sm text-[var(--clr-text-muted)]">
        ${escapeHtml(clientName(inv.clientId))}
        ${inv.projectId
          ? `<p class="text-xs text-[var(--clr-text-faint)] mt-0.5 truncate max-w-[10rem]">
               ${escapeHtml(projectName(inv.projectId))}
             </p>`
          : ''}
      </td>

      <!-- Amount -->
      <td class="td-cell text-right font-medium text-[var(--clr-text)] tabular-nums whitespace-nowrap
                 hidden sm:table-cell">
        ${inv.amount ? formatQAR(Number(inv.amount)) : '—'}
      </td>

      <!-- Issued date -->
      <td class="td-cell text-xs text-[var(--clr-text-faint)] whitespace-nowrap hidden md:table-cell">
        ${issuedAt}
      </td>

      <!-- Due date — red if overdue -->
      <td class="td-cell text-xs whitespace-nowrap hidden md:table-cell"
          style="color:${isOverdue ? 'var(--clr-danger)' : 'var(--clr-text-faint)'}">
        ${dueAt}${isOverdue ? ' ⚠' : ''}
      </td>

      <!-- Status badge — click to cycle through statuses -->
      <td class="td-cell text-center">
        <button class="badge ${status.badge} cursor-pointer"
                data-action="status-btn" data-id="${inv.id}"
                title="Click to change status">${status.label}</button>
      </td>

      <!-- Actions -->
      <td class="td-cell text-right">
        <div class="flex items-center justify-end gap-1">
          <button data-action="pdf" data-id="${inv.id}"
                  class="btn btn-icon" title="Export PDF"
                  aria-label="Export PDF for invoice ${escapeHtml(inv.number ?? '')}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586
                   a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
          </button>
          <button data-action="edit" data-id="${inv.id}"
                  class="btn btn-icon" title="Edit invoice"
                  aria-label="Edit invoice ${escapeHtml(inv.number ?? '')}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button data-action="delete" data-id="${inv.id}"
                  data-number="${escapeHtml(inv.number ?? String(inv.id))}"
                  class="btn btn-icon" title="Delete invoice"
                  aria-label="Delete invoice ${escapeHtml(inv.number ?? '')}">
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
function formHTML(invoice = {}, autoNumber = '') {
  const v   = (k) => escapeHtml(invoice[k] ?? '');
  const sel = (val, opt) => String(val) === String(opt) ? 'selected' : '';

  const clientOptions = _clients
    .map(c => `<option value="${c.id}" ${sel(invoice.clientId, c.id)}>
                 ${escapeHtml(c.name)}${c.company ? ` — ${escapeHtml(c.company)}` : ''}
               </option>`)
    .join('');

  // Show all projects; if a client is pre-selected, matching ones appear first
  const projectOptions = _projects
    .map(p => {
      const cName = clientName(p.clientId);
      return `<option value="${p.id}" ${sel(invoice.projectId, p.id)}>
                ${escapeHtml(p.name)}${p.clientId ? ` (${escapeHtml(cName)})` : ''}
              </option>`;
    })
    .join('');

  const statusOptions = STATUSES
    .map(s => `<option value="${s.value}" ${sel(invoice.status ?? 'draft', s.value)}>${s.label}</option>`)
    .join('');

  // Default issued date to today when creating a new invoice
  const today      = new Date().toISOString().slice(0, 10);
  const issuedVal  = v('issuedAt') || (invoice.id ? '' : today);

  return `
    <div class="p-6 space-y-5">

      <!-- Invoice number + Status -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="if-number">
            Invoice Number <span style="color:var(--clr-danger)">*</span>
          </label>
          <input id="if-number" name="number" type="text" class="form-input"
                 placeholder="e.g. INV-0001"
                 value="${invoice.number ? v('number') : escapeHtml(autoNumber)}"
                 required autocomplete="off"/>
        </div>
        <div>
          <label class="form-label" for="if-status">Status</label>
          <select id="if-status" name="status" class="form-select">
            ${statusOptions}
          </select>
        </div>
      </div>

      <!-- Client + Project -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="if-client">
            Client <span style="color:var(--clr-danger)">*</span>
          </label>
          <select id="if-client" name="clientId" class="form-select" required>
            <option value="">— Select a client —</option>
            ${clientOptions}
          </select>
        </div>
        <div>
          <label class="form-label" for="if-project">Linked Project (optional)</label>
          <select id="if-project" name="projectId" class="form-select">
            <option value="">— No project —</option>
            ${projectOptions}
          </select>
        </div>
      </div>

      <!-- Amount -->
      <div>
        <label class="form-label" for="if-amount">
          Amount (QAR) <span style="color:var(--clr-danger)">*</span>
        </label>
        <input id="if-amount" name="amount" type="number" min="0" step="0.01"
               class="form-input" placeholder="e.g. 5000"
               value="${v('amount')}" required autocomplete="off"/>
      </div>

      <!-- Issued date + Due date -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="if-issued">Issued Date</label>
          <input id="if-issued" name="issuedAt" type="date" class="form-input"
                 value="${issuedVal}"/>
        </div>
        <div>
          <label class="form-label" for="if-due">Due Date</label>
          <input id="if-due" name="dueAt" type="date" class="form-input"
                 value="${v('dueAt')}"/>
        </div>
      </div>

      <!-- Notes -->
      <div>
        <label class="form-label" for="if-notes">Notes</label>
        <textarea id="if-notes" name="notes" class="form-textarea"
                  placeholder="Payment terms, reference numbers, remarks…">${v('notes')}</textarea>
      </div>
    </div>`;
}

/* ── Auto-create income transaction when invoice is marked paid ─────────── */
async function createPaidTransaction(invoice) {
  const today = new Date().toISOString().slice(0, 10);
  await addRecord('transactions', {
    type:      'income',
    clientId:  invoice.clientId  ?? null,
    projectId: invoice.projectId ?? null,
    category:  'Project Payment',
    amount:    Number(invoice.amount ?? 0),
    date:      today,
    note:      `Invoice ${invoice.number ?? invoice.id}`,
    createdAt: new Date().toISOString(),
  });
}

/* ── Add modal ──────────────────────────────────────────────────────────── */
function openAddModal(prefill = {}) {
  const autoNum = nextInvoiceNumber();

  openModal({
    title:       'Create Invoice',
    bodyHTML:    formHTML(prefill, autoNum),
    submitLabel: 'Create Invoice',
    onSubmit: async (fd) => {
      const clientId = fd.get('clientId');
      if (!clientId) throw new Error('Please select a client.');

      const amount = fd.get('amount');
      if (!amount || isNaN(Number(amount))) throw new Error('A valid amount is required.');

      const data = {
        number:    fd.get('number').trim() || autoNum,
        clientId:  Number(clientId),
        projectId: fd.get('projectId') ? Number(fd.get('projectId')) : null,
        amount:    Number(amount),
        issuedAt:  fd.get('issuedAt') || null,
        dueAt:     fd.get('dueAt')    || null,
        status:    fd.get('status'),
        notes:     fd.get('notes').trim(),
      };

      await addRecord('invoices', data);
      toast(`Invoice ${data.number} created.`, 'success');
      await loadInvoices();
    },
  });
}

/* ── Edit modal ─────────────────────────────────────────────────────────── */
async function openEditModal(id) {
  const invoice = _invoices.find(i => i.id === id);
  if (!invoice) { toast('Invoice not found.', 'error'); return; }

  openModal({
    title:       `Edit Invoice ${invoice.number ?? ''}`,
    bodyHTML:    formHTML(invoice),
    submitLabel: 'Save Changes',
    onSubmit: async (fd) => {
      const clientId = fd.get('clientId');
      if (!clientId) throw new Error('Please select a client.');

      const amount = fd.get('amount');
      if (!amount || isNaN(Number(amount))) throw new Error('A valid amount is required.');

      const updates = {
        number:    fd.get('number').trim(),
        clientId:  Number(clientId),
        projectId: fd.get('projectId') ? Number(fd.get('projectId')) : null,
        amount:    Number(amount),
        issuedAt:  fd.get('issuedAt') || null,
        dueAt:     fd.get('dueAt')    || null,
        status:    fd.get('status'),
        notes:     fd.get('notes').trim(),
      };

      const wasAlreadyPaid = invoice.status === 'paid';

      await updateRecord('invoices', id, updates);
      if (updates.status === 'paid' && !wasAlreadyPaid) {
        await createPaidTransaction({ ...invoice, ...updates });
        toast(`Invoice ${updates.number} saved — income transaction added.`, 'success');
      } else {
        toast(`Invoice ${updates.number} updated.`, 'success');
      }
      await loadInvoices();
    },
  });
}

/* ── Delete ─────────────────────────────────────────────────────────────── */
function confirmDelete(id, number) {
  openConfirm({
    title:        'Delete Invoice',
    message:      `Are you sure you want to delete invoice "${number}"? This action cannot be undone.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await deleteRecord('invoices', id);
      toast(`Invoice "${number}" deleted.`, 'info');
      await loadInvoices();
    },
  });
}

/* ── Bind UI listeners ──────────────────────────────────────────────────── */
function bindListeners() {
  _container.querySelector('#btn-add-invoice')?.addEventListener('click', openAddModal);

  const searchInput = _container.querySelector('#invoices-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      _searchQ = searchInput.value;
      renderTable(applyFilters());
    }, 200));
  }

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
        <h2 class="text-xl font-semibold text-[var(--clr-text)]">Invoices</h2>
        <p class="text-sm text-[var(--clr-text-faint)] mt-0.5">Track billing and payment status</p>
      </div>
      <button id="btn-add-invoice" class="btn btn-primary w-full sm:w-auto" title="Add Invoice (N)">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        Create Invoice
      </button>
    </div>

    <!-- Stats row -->
    <div id="invoices-stats" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
      ${Array(6).fill('<div class="card-skeleton rounded-xl h-16"></div>').join('')}
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
          <input id="invoices-search" type="search"
                 placeholder="Search by number, client, project…"
                 class="form-input pl-9 text-sm"
                 style="background:var(--clr-surface-2)"/>
        </div>

        <!-- Status filter pills -->
        <div class="flex items-center gap-2 flex-wrap shrink-0">
          <button class="filter-btn filter-active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="draft">Draft</button>
          <button class="filter-btn" data-filter="sent">Sent</button>
          <button class="filter-btn" data-filter="paid">Paid</button>
          <button class="filter-btn" data-filter="overdue">Overdue</button>
          <button class="filter-btn" data-filter="cancelled">Cancelled</button>
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--clr-border)] bg-[var(--clr-surface-2)]/50">
              <th class="th-cell text-left">Number</th>
              <th class="th-cell text-left">Client / Project</th>
              <th class="th-cell text-right hidden sm:table-cell">Amount</th>
              <th class="th-cell text-left hidden md:table-cell">Issued</th>
              <th class="th-cell text-left hidden md:table-cell">Due</th>
              <th class="th-cell text-center">Status</th>
              <th class="th-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="invoices-tbody">
            <tr>
              <td colspan="7">
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
      <div class="px-5 py-3 border-t border-[var(--clr-border)] flex flex-wrap items-center justify-between gap-2
                  bg-[var(--clr-surface-2)]/30">
        <p id="invoices-count" class="text-xs" style="color:var(--clr-text-faint)">— invoices</p>
        <div class="flex items-center gap-1">
          <button class="filter-btn filter-active py-0.5 px-2 text-[11px]" data-daterange="all">All time</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-month">Last month</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-year">Last year</button>
        </div>
        <p class="text-xs hidden sm:block" style="color:var(--clr-text-faint)">QFL Dashboard · 2026</p>
      </div>
    </div>`;
}
