/**
 * finances.js — Finances module (CRUDS)
 *
 * Schema: { id, type('income'|'outcome'), clientId?, projectId?,
 *           category, amount, date, note, createdAt,
 *           recurring('none'|'weekly'|'monthly'|'yearly'), recurringId? }
 *
 * Operations:
 *  C — Create  : openAddModal()
 *  R — Read    : loadTransactions() → renderTable()
 *  U — Update  : openEditModal(id)
 *  D — Delete  : confirmDelete(id)
 *  S — Search  : live search by category/client/project/note + type filter
 */

import { addRecord, getAllRecords, updateRecord, deleteRecord } from '../db.js';
import { toast, openModal, openConfirm }                       from '../ui.js';
import { formatDate, formatQAR, escapeHtml, matchesSearch, debounce } from '../utils.js';
import { getSettings }                                         from '../settings-store.js';

/* ── Module state ───────────────────────────────────────────────────────── */
let _transactions = [];
let _clients      = [];
let _projects     = [];
let _filter       = 'all';   // 'all' | 'income' | 'outcome'
let _searchQ      = '';
let _container    = null;
let _dateRange    = 'all';   // 'all' | 'last-month' | 'last-year'

/* ── Categories — read live from settings-store so user edits are reflected ─ */
const incomeCats  = () => getSettings().categories.income;
const expenseCats = () => getSettings().categories.expense;

/* ── Mount / unmount ────────────────────────────────────────────────────── */
export async function mount(container) {
  _container = container;
  _filter    = 'all';
  _searchQ   = '';
  _dateRange = 'all';

  container.innerHTML = shellHTML();
  bindListeners();
  await loadTransactions();
}

export function unmount() {
  _container = null;
}

/* ── Load all data from DB ──────────────────────────────────────────────── */
async function loadTransactions() {
  try {
    [_transactions, _clients, _projects] = await Promise.all([
      getAllRecords('transactions'),
      getAllRecords('clients'),
      getAllRecords('projects'),
    ]);
    const added = await processRecurring();
    if (added > 0) {
      _transactions = await getAllRecords('transactions');
    }
    renderStats();
    renderTable(applyFilters());
  } catch (err) {
    console.error('[Finances] Load error:', err);
    toast('Failed to load transactions.', 'error');
  }
}

/* ── Auto-generate recurring entries ────────────────────────────────────── */
async function processRecurring() {
  const today   = new Date().toISOString().slice(0, 10);
  // Only parent templates (have a recur rule but are NOT themselves auto-generated)
  const parents = _transactions.filter(
    t => t.recurring && t.recurring !== 'none' && !t.recurringId
  );
  let added = 0;

  for (const parent of parents) {
    if (!parent.date) continue;

    // Latest date among the parent itself and all its children
    const children  = _transactions.filter(t => t.recurringId === parent.id);
    const allDates  = [parent.date, ...children.map(c => c.date)].filter(Boolean).sort();
    let   lastDate  = allDates.at(-1);
    let   next      = nextRecurDate(lastDate, parent.recurring);

    while (next <= today) {
      await addRecord('transactions', {
        type:        parent.type,
        category:    parent.category,
        amount:      parent.amount,
        date:        next,
        clientId:    parent.clientId   ?? null,
        projectId:   parent.projectId  ?? null,
        note:        parent.note       ?? '',
        recurring:   'none',
        recurringId: parent.id,
      });
      lastDate = next;
      next     = nextRecurDate(next, parent.recurring);
      added++;
    }
  }
  return added;
}

function nextRecurDate(dateStr, period) {
  const d = new Date(dateStr + 'T00:00:00');
  if (period === 'weekly')  d.setDate(d.getDate() + 7);
  if (period === 'monthly') d.setMonth(d.getMonth() + 1);
  if (period === 'yearly')  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/* ── Lookup helpers ─────────────────────────────────────────────────────── */
const clientName  = (id) => id ? (_clients.find(c => c.id === Number(id))?.name  ?? '—') : '—';
const projectName = (id) => id ? (_projects.find(p => p.id === Number(id))?.name ?? '—') : '—';

/* ── Apply search + type filter ─────────────────────────────────────────── */
function applyFilters() {
  let list = _transactions;

  if (_filter === 'income' || _filter === 'outcome') {
    list = list.filter(t => t.type === _filter);
  } else if (_filter === 'recurring') {
    list = list.filter(t => t.recurring && t.recurring !== 'none');
  }

  if (_dateRange !== 'all') {
    const now    = new Date();
    const cutoff = _dateRange === 'last-month'
      ? new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      : new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    list = list.filter(t => {
      const d = new Date(t.date ?? t.createdAt ?? '');
      return !isNaN(d) && d >= cutoff;
    });
  }

  if (_searchQ.trim()) {
    list = list.filter(tx => {
      const enriched = {
        ...tx,
        clientName:  clientName(tx.clientId),
        projectName: projectName(tx.projectId),
      };
      return matchesSearch(enriched, ['category', 'note', 'clientName', 'projectName'], _searchQ);
    });
  }

  return list;
}

/* ── Render: stats row ──────────────────────────────────────────────────── */
function renderStats() {
  const el = _container?.querySelector('#finances-stats');
  if (!el) return;

  const income  = _transactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const outcome = _transactions
    .filter(t => t.type === 'outcome')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const profit  = income - outcome;
  const count   = _transactions.length;

  el.innerHTML = `
    ${statCard('Total Income',  formatQAR(income,  true), 'emerald')}
    ${statCard('Total Expenses', formatQAR(outcome, true), 'red')}
    ${statCard('Net Profit',    formatQAR(profit,  true), profit >= 0 ? 'blue' : 'danger')}
    ${statCard('Transactions',  count,                     'neutral')}`;
}

function statCard(label, value, color) {
  const map = {
    emerald: { bg: 'var(--clr-success-bg)',  text: 'var(--clr-success)',       border: 'var(--clr-success-ring)',  icon: '↑' },
    red:     { bg: 'var(--clr-danger-bg)',   text: 'var(--clr-danger)',         border: 'var(--clr-danger-ring)',   icon: '↓' },
    blue:    { bg: 'var(--clr-primary-dim)', text: 'var(--clr-primary-light)', border: 'var(--clr-primary-ring)',  icon: '=' },
    danger:  { bg: 'var(--clr-danger-bg)',   text: 'var(--clr-danger)',         border: 'var(--clr-danger-ring)',   icon: '−' },
    neutral: { bg: 'var(--clr-surface-2)',   text: 'var(--clr-text)',           border: 'var(--clr-border)',        icon: '#' },
  };
  const c = map[color] ?? map.neutral;
  return `
    <div class="card flex flex-col gap-1 px-5 py-4" style="border-color:${c.border}; background:${c.bg}">
      <span class="text-2xl font-bold leading-tight whitespace-nowrap" style="color:${c.text}">${value}</span>
      <span class="text-xs font-semibold uppercase tracking-wider text-[var(--clr-text-muted)]">${label}</span>
    </div>`;
}

/* ── Render: transactions table ─────────────────────────────────────────── */
function renderTable(transactions) {
  const tbody = _container?.querySelector('#finances-tbody');
  const count = _container?.querySelector('#finances-count');
  if (!tbody) return;

  if (count) count.textContent = `${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`;

  if (!transactions.length) {
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="empty-state">
          <svg class="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11
                 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21
                 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <p class="font-medium text-[var(--clr-text-muted)]">No transactions found</p>
          <p>${_searchQ || _filter !== 'all' ? 'Try adjusting your search or filter.' : 'Record your first income or expense to get started.'}</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = transactions.map(tx => rowHTML(tx)).join('');

  // Wire action buttons after rendering
  tbody.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)))
  );
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(Number(btn.dataset.id), btn.dataset.label))
  );
}

/* ── Row HTML ───────────────────────────────────────────────────────────── */
function rowHTML(tx) {
  const isIncome = tx.type === 'income';
  const typeColor  = isIncome ? 'var(--clr-success)'  : 'var(--clr-danger)';
  const typeBadge  = isIncome ? 'badge-active'         : 'badge-overdue';
  const typeLabel  = isIncome ? 'Income'               : 'Expense';
  const amountSign = isIncome ? '+' : '−';

  const cName = tx.clientId  ? clientName(tx.clientId)   : null;
  const pName = tx.projectId ? projectName(tx.projectId) : null;

  return `
    <tr class="border-b border-[var(--clr-border)] last:border-0
               hover:bg-[var(--clr-surface-2)]/50 transition-colors duration-150">

      <!-- Type badge -->
      <td class="td-cell">
        <span class="badge ${typeBadge}">${typeLabel}</span>
      </td>

      <!-- Category + note -->
      <td class="td-cell">
        <div class="flex items-center flex-wrap gap-1.5">
          <span class="font-medium text-sm text-[var(--clr-text)]">${escapeHtml(tx.category ?? '—')}</span>
          ${tx.recurring && tx.recurring !== 'none'
            ? `<span class="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                     style="background:var(--clr-primary-dim);color:var(--clr-primary-light)">
                 ↻ ${tx.recurring}
               </span>`
            : tx.recurringId
              ? `<span class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                       style="background:var(--clr-surface-3);color:var(--clr-text-faint)">auto</span>`
              : ''}
        </div>
        ${tx.note
          ? `<p class="text-xs text-[var(--clr-text-faint)] mt-0.5 truncate max-w-[14rem]">${escapeHtml(tx.note)}</p>`
          : ''}
      </td>

      <!-- Client / Project -->
      <td class="td-cell text-sm hidden md:table-cell">
        ${cName ? `<span class="text-[var(--clr-text-muted)]">${escapeHtml(cName)}</span>` : '<span class="text-[var(--clr-text-faint)]">—</span>'}
        ${pName ? `<p class="text-xs text-[var(--clr-text-faint)] mt-0.5 truncate max-w-[10rem]">${escapeHtml(pName)}</p>` : ''}
      </td>

      <!-- Date -->
      <td class="td-cell text-xs text-[var(--clr-text-faint)] whitespace-nowrap hidden sm:table-cell">
        ${tx.date ? formatDate(tx.date) : '—'}
      </td>

      <!-- Amount — coloured by type -->
      <td class="td-cell text-right font-semibold tabular-nums whitespace-nowrap"
          style="color:${typeColor}">
        ${amountSign} ${tx.amount ? formatQAR(Number(tx.amount)) : '—'}
      </td>

      <!-- Actions -->
      <td class="td-cell text-right">
        <div class="flex items-center justify-end gap-1">
          <button data-action="edit" data-id="${tx.id}"
                  class="btn btn-icon" title="Edit transaction"
                  aria-label="Edit transaction">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5
                   m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
          </button>
          <button data-action="delete" data-id="${tx.id}"
                  data-label="${escapeHtml(tx.category ?? String(tx.id))}"
                  class="btn btn-icon" title="Delete transaction"
                  aria-label="Delete transaction">
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
function formHTML(tx = {}) {
  const v   = (k) => escapeHtml(tx[k] ?? '');
  const sel = (val, opt) => String(val) === String(opt) ? 'selected' : '';

  const isIncome  = tx.type === 'income';
  const cats      = isIncome ? incomeCats() : expenseCats();

  const clientOptions = _clients
    .map(c => `<option value="${c.id}" ${sel(tx.clientId, c.id)}>
                 ${escapeHtml(c.name)}${c.company ? ` — ${escapeHtml(c.company)}` : ''}
               </option>`)
    .join('');

  const projectOptions = _projects
    .map(p => `<option value="${p.id}" ${sel(tx.projectId, p.id)}>
                 ${escapeHtml(p.name)} (${escapeHtml(clientName(p.clientId))})
               </option>`)
    .join('');

  const catOptions = cats
    .map(cat => `<option value="${cat}" ${sel(tx.category, cat)}>${cat}</option>`)
    .join('');

  const today   = new Date().toISOString().slice(0, 10);
  const dateVal = v('date') || (tx.id ? '' : today);

  return `
    <div class="p-6 space-y-5">

      <!-- Type -->
      <div>
        <label class="form-label">Type <span style="color:var(--clr-danger)">*</span></label>
        <div class="flex gap-3">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="radio" name="type" value="income"
                   ${!tx.type || tx.type === 'income' ? 'checked' : ''}
                   class="accent-[var(--clr-success)] w-4 h-4"/>
            <span class="text-sm font-medium" style="color:var(--clr-success)">Income</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="radio" name="type" value="outcome"
                   ${tx.type === 'outcome' ? 'checked' : ''}
                   class="accent-[var(--clr-danger)] w-4 h-4"/>
            <span class="text-sm font-medium" style="color:var(--clr-danger)">Expense</span>
          </label>
        </div>
      </div>

      <!-- Category + Amount -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="tf-category">
            Category <span style="color:var(--clr-danger)">*</span>
          </label>
          <!-- Editable combobox: datalist provides suggestions, user can type anything -->
          <input id="tf-category" name="category" type="text" list="tf-category-list"
                 class="form-input" placeholder="e.g. Project Payment"
                 value="${v('category')}" required autocomplete="off"/>
          <datalist id="tf-category-list">
            ${[...incomeCats(), ...expenseCats()]
              .filter((c, i, arr) => arr.indexOf(c) === i)
              .map(c => `<option value="${c}">`)
              .join('')}
          </datalist>
        </div>
        <div>
          <label class="form-label" for="tf-amount">
            Amount (QAR) <span style="color:var(--clr-danger)">*</span>
          </label>
          <input id="tf-amount" name="amount" type="number" min="0" step="0.01"
                 class="form-input" placeholder="e.g. 3000"
                 value="${v('amount')}" required autocomplete="off"/>
        </div>
      </div>

      <!-- Date -->
      <div>
        <label class="form-label" for="tf-date">Date</label>
        <input id="tf-date" name="date" type="date" class="form-input" value="${dateVal}"/>
      </div>

      <!-- Client + Project (optional) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="form-label" for="tf-client">Linked Client (optional)</label>
          <select id="tf-client" name="clientId" class="form-select">
            <option value="">— No client —</option>
            ${clientOptions}
          </select>
        </div>
        <div>
          <label class="form-label" for="tf-project">Linked Project (optional)</label>
          <select id="tf-project" name="projectId" class="form-select">
            <option value="">— No project —</option>
            ${projectOptions}
          </select>
        </div>
      </div>

      <!-- Recurring -->
      <div>
        <label class="form-label" for="tf-recurring">Recurring</label>
        <select id="tf-recurring" name="recurring" class="form-select"
                ${tx.recurringId ? 'disabled title="Cannot change a schedule on an auto-generated entry"' : ''}>
          <option value="none"    ${sel(tx.recurring ?? 'none', 'none')}>— No recurrence —</option>
          <option value="weekly"  ${sel(tx.recurring, 'weekly')}>Weekly</option>
          <option value="monthly" ${sel(tx.recurring, 'monthly')}>Monthly</option>
          <option value="yearly"  ${sel(tx.recurring, 'yearly')}>Yearly</option>
        </select>
        <p class="text-xs mt-1.5" style="color:var(--clr-text-faint)">
          ${tx.recurringId
            ? '↻ Auto-generated from a recurring parent transaction.'
            : 'Future entries will be auto-generated from the start date each time you open Finances.'}
        </p>
      </div>

      <!-- Note -->
      <div>
        <label class="form-label" for="tf-note">Note</label>
        <textarea id="tf-note" name="note" class="form-textarea"
                  placeholder="Reference number, description, any additional detail…">${v('note')}</textarea>
      </div>

    </div>`;
}

/* ── Add modal ──────────────────────────────────────────────────────────── */
function openAddModal() {
  openModal({
    title:       'Record Transaction',
    bodyHTML:    formHTML(),
    submitLabel: 'Save Transaction',
    onSubmit: async (fd) => {
      const type = fd.get('type');
      if (!type) throw new Error('Please select a type (Income or Expense).');

      const category = fd.get('category')?.trim();
      if (!category) throw new Error('Category is required.');

      const amount = fd.get('amount');
      if (!amount || isNaN(Number(amount))) throw new Error('A valid amount is required.');

      const data = {
        type,
        category,
        amount:     Number(amount),
        date:       fd.get('date')      || null,
        clientId:   fd.get('clientId')  ? Number(fd.get('clientId'))  : null,
        projectId:  fd.get('projectId') ? Number(fd.get('projectId')) : null,
        note:       fd.get('note')?.trim() || '',
        recurring:  fd.get('recurring') || 'none',
        recurringId: null,
      };

      await addRecord('transactions', data);
      toast(`Transaction recorded: ${category}`, 'success');
      await loadTransactions();
    },
  });
}

/* ── Edit modal ─────────────────────────────────────────────────────────── */
async function openEditModal(id) {
  const tx = _transactions.find(t => t.id === id);
  if (!tx) { toast('Transaction not found.', 'error'); return; }

  openModal({
    title:       'Edit Transaction',
    bodyHTML:    formHTML(tx),
    submitLabel: 'Save Changes',
    onSubmit: async (fd) => {
      const type = fd.get('type');
      const category = fd.get('category')?.trim();
      if (!category) throw new Error('Category is required.');

      const amount = fd.get('amount');
      if (!amount || isNaN(Number(amount))) throw new Error('A valid amount is required.');

      const updates = {
        type,
        category,
        amount:      Number(amount),
        date:        fd.get('date')      || null,
        clientId:    fd.get('clientId')  ? Number(fd.get('clientId'))  : null,
        projectId:   fd.get('projectId') ? Number(fd.get('projectId')) : null,
        note:        fd.get('note')?.trim() || '',
        recurring:   tx.recurringId ? 'none' : (fd.get('recurring') || tx.recurring || 'none'),
        recurringId: tx.recurringId ?? null,
      };

      await updateRecord('transactions', id, updates);
      toast(`Transaction updated: ${category}`, 'success');
      await loadTransactions();
    },
  });
}

/* ── Delete ─────────────────────────────────────────────────────────────── */
function confirmDelete(id, label) {
  const tx         = _transactions.find(t => t.id === id);
  const isParent   = tx?.recurring && tx.recurring !== 'none' && !tx.recurringId;
  const children   = isParent ? _transactions.filter(t => t.recurringId === id) : [];
  const childCount = children.length;

  const extraMsg = isParent && childCount > 0
    ? ` This will also delete ${childCount} auto-generated entr${childCount > 1 ? 'ies' : 'y'}.`
    : '';

  openConfirm({
    title:        'Delete Transaction',
    message:      `Are you sure you want to delete "${label}"?${extraMsg} This cannot be undone.`,
    confirmLabel: 'Delete',
    onConfirm: async () => {
      await deleteRecord('transactions', id);
      if (childCount > 0) {
        await Promise.all(children.map(c => deleteRecord('transactions', c.id)));
      }
      toast(`Transaction "${label}" deleted.`, 'info');
      await loadTransactions();
    },
  });
}

/* ── Bind UI listeners ──────────────────────────────────────────────────── */
function bindListeners() {
  _container.querySelector('#btn-add-transaction')?.addEventListener('click', openAddModal);

  const searchInput = _container.querySelector('#finances-search');
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
        <h2 class="text-xl font-semibold text-[var(--clr-text)]">Finances</h2>
        <p class="text-sm text-[var(--clr-text-faint)] mt-0.5">Track income, expenses and profit</p>
      </div>
      <button id="btn-add-transaction" class="btn btn-primary w-full sm:w-auto" title="Add Transaction (N)">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        Record Transaction
      </button>
    </div>

    <!-- Stats row -->
    <div id="finances-stats" class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
      ${Array(4).fill('<div class="card-skeleton rounded-xl h-16"></div>').join('')}
    </div>

    <!-- Table card -->
    <div class="card overflow-hidden">

      <!-- Toolbar -->
      <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-4
                  border-b border-[var(--clr-border)]">

        <!-- Search -->
        <div class="relative flex-1">
          <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
               fill="none" stroke="currentColor" viewBox="0 0 24 24"
               style="color:var(--clr-text-faint)">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input id="finances-search" type="search"
                 placeholder="Search by category, note, client, project…"
                 class="form-input pl-9 text-sm"
                 style="background:var(--clr-surface-2)"/>
        </div>

        <!-- Type filter pills -->
        <div class="flex items-center gap-2 shrink-0 flex-wrap">
          <button class="filter-btn filter-active" data-filter="all">All</button>
          <button class="filter-btn" data-filter="income">Income</button>
          <button class="filter-btn" data-filter="outcome">Expenses</button>
          <button class="filter-btn" data-filter="recurring">↻ Recurring</button>
        </div>
      </div>

      <!-- Table -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--clr-border)] bg-[var(--clr-surface-2)]/50">
              <th class="th-cell text-left">Type</th>
              <th class="th-cell text-left">Category / Note</th>
              <th class="th-cell text-left hidden md:table-cell">Client / Project</th>
              <th class="th-cell text-left hidden sm:table-cell">Date</th>
              <th class="th-cell text-right">Amount</th>
              <th class="th-cell text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="finances-tbody">
            <!-- Loading spinner -->
            <tr>
              <td colspan="6">
                <div class="empty-state">
                  <svg class="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24"
                       style="color:var(--clr-surface-3)">
                    <circle class="opacity-25" cx="12" cy="12" r="10"
                            stroke="currentColor" stroke-width="4"/>
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
        <p id="finances-count" class="text-xs" style="color:var(--clr-text-faint)">— transactions</p>
        <div class="flex items-center gap-1">
          <button class="filter-btn filter-active py-0.5 px-2 text-[11px]" data-daterange="all">All time</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-month">Last month</button>
          <button class="filter-btn py-0.5 px-2 text-[11px]" data-daterange="last-year">Last year</button>
        </div>
        <p class="text-xs hidden sm:block" style="color:var(--clr-text-faint)">QFL Dashboard · 2026</p>
      </div>

    </div>`;
}
