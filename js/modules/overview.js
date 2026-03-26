/**
 * overview.js — Overview / dashboard view.
 * Displays aggregate stats + three Chart.js charts pulled live from IndexedDB.
 */

import { getAllRecords } from '../db.js';
import { formatQAR, formatDate, getCurrencySymbol } from '../utils.js';

/* keep references so we can destroy on unmount (avoid canvas reuse errors) */
let _charts = [];

/* ── Mount ──────────────────────────────────────────────────────────────── */
export async function mount(container) {
  container.innerHTML = skeletonHTML();

  const [clients, projects, transactions, invoices] = await Promise.all([
    getAllRecords('clients'),
    getAllRecords('projects'),
    getAllRecords('transactions'),
    getAllRecords('invoices'),
  ]);

  const income  = transactions.filter(t => t.type === 'income').reduce((s, t)  => s + Number(t.amount), 0);
  const outcome = transactions.filter(t => t.type === 'outcome').reduce((s, t) => s + Number(t.amount), 0);
  const profit  = income - outcome;

  const inProgress    = projects.filter(p => p.status === 'in-progress').length;
  const complete      = projects.filter(p => p.status === 'complete').length;
  const activeClients = clients.filter(c => c.status === 'active').length;

  /* ── Last 6 months labels + income/expense buckets ─────────────────── */
  const months      = last6Months();
  const incomeByM   = bucketByMonth(transactions.filter(t => t.type === 'income'),   months);
  const expenseByM  = bucketByMonth(transactions.filter(t => t.type === 'outcome'),  months);
  const hasFinData  = incomeByM.some(v => v > 0) || expenseByM.some(v => v > 0);

  /* ── Project status breakdown ───────────────────────────────────────── */
  const statusDef = [
    { key: 'in-progress', label: 'In Progress', color: '#60a5fa' },
    { key: 'complete',    label: 'Complete',    color: '#34d399' },
    { key: 'on-hold',     label: 'On Hold',     color: '#fbbf24' },
    { key: 'cancelled',   label: 'Cancelled',   color: '#f87171' },
  ];
  const statusCounts = statusDef.map(s => projects.filter(p => p.status === s.key).length);
  const hasProjData  = statusCounts.some(v => v > 0);

  /* ── Recent transactions ────────────────────────────────────────────── */
  const recent = [...transactions]
    .sort((a, b) => new Date(b.createdAt ?? b.date) - new Date(a.createdAt ?? a.date))
    .slice(0, 6);

  container.innerHTML = `
    <!-- Welcome banner -->
    <div id="overview-banner" class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--clr-surface-3)] via-[var(--clr-surface-2)] to-[#1e4172] p-6 md:p-8 mb-8">
      <div class="relative z-10">
        <p class="text-blue-300 text-sm font-medium mb-1">Good day 👋</p>
        <h2 class="text-white text-xl md:text-2xl font-semibold">Here's your freelance summary</h2>
        <p class="text-blue-200/80 text-sm mt-1">Track your projects, income, and clients at a glance.</p>
      </div>
      <div class="absolute -top-8 -right-8 w-48 h-48 rounded-full bg-white/5 pointer-events-none"></div>
      <div class="absolute -bottom-10 right-16 w-32 h-32 rounded-full bg-white/5 pointer-events-none"></div>
    </div>

    <!-- Stats grid -->
    <p class="section-label">Key Metrics</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
      ${statCard({ label: 'Total Projects', value: projects.length,  sub: `${inProgress} in progress · ${complete} complete`, color: 'blue',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>` })}
      ${statCard({ label: 'Total Clients',  value: clients.length,   sub: `${activeClients} active`, color: 'violet',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>` })}
      ${statCard({ label: 'Total Income',   value: formatQAR(income, true), sub: `Expenses: ${formatQAR(outcome, true)}`, color: 'emerald',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>` })}
      ${statCard({ label: 'Net Profit',     value: formatQAR(profit, true), sub: profit >= 0 ? '▲ Positive' : '▼ Negative', color: profit >= 0 ? 'emerald' : 'red',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>` })}
    </div>

    <!-- Charts row -->
    <p class="section-label mb-4">Analytics</p>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">

      <!-- Income vs Expenses — bar chart (spans 2 cols) -->
      <div class="card p-5 lg:col-span-2">
        <p class="text-sm font-semibold text-[var(--clr-text)] mb-4">Income vs Expenses — last 6 months</p>
        ${hasFinData
          ? `<div style="position:relative;height:220px;"><canvas id="chart-bar"></canvas></div>`
          : emptyChart('No financial transactions recorded yet.')}
      </div>

      <!-- Project status — donut -->
      <div class="card p-5 flex flex-col">
        <p class="text-sm font-semibold text-[var(--clr-text)] mb-4">Projects by Status</p>
        ${hasProjData
          ? `<div style="position:relative;flex:1;min-height:180px;"><canvas id="chart-donut"></canvas></div>
             <div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
               ${statusDef.map((s, i) => `
                 <div class="flex items-center gap-2 text-xs text-[var(--clr-text-muted)]">
                   <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0;display:inline-block;"></span>
                   ${s.label} <span class="font-semibold text-[var(--clr-text)] ml-auto">${statusCounts[i]}</span>
                 </div>`).join('')}
             </div>`
          : emptyChart('No projects yet.')}
      </div>
    </div>

    <!-- Recent transactions -->
    <p class="section-label mb-4">Recent Transactions</p>
    <div class="card overflow-hidden mb-6">
      ${recent.length ? `
        <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[28rem]">
          <thead>
            <tr class="border-b border-[var(--clr-border)]">
              <th class="th-cell text-left">Date</th>
              <th class="th-cell text-left">Category</th>
              <th class="th-cell text-left hidden sm:table-cell">Note</th>
              <th class="th-cell text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${recent.map(t => `
              <tr class="border-b border-[var(--clr-border)] last:border-0 hover:bg-[var(--clr-surface-2)]/50">
                <td class="td-cell text-xs text-[var(--clr-text-faint)] whitespace-nowrap">${formatDate(t.date)}</td>
                <td class="td-cell">
                  <span class="badge ${t.type === 'income' ? 'badge-active' : 'badge-inactive'} text-xs">${t.category || t.type}</span>
                </td>
                <td class="td-cell text-xs text-[var(--clr-text-muted)] hidden sm:table-cell max-w-[14rem] truncate">${t.note || '—'}</td>
                <td class="td-cell text-right font-semibold tabular-nums whitespace-nowrap"
                    style="color:${t.type === 'income' ? 'var(--clr-success)' : 'var(--clr-danger)'}">
                  ${t.type === 'income' ? '+' : '-'}${formatQAR(Number(t.amount))}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
        </div>` : `
        <div class="empty-state py-10">
          <p class="font-medium text-[var(--clr-text-muted)]">No transactions yet</p>
          <p class="text-sm">Add income or expenses in the Finances section.</p>
        </div>`}
    </div>

    ${projects.length === 0 && clients.length === 0 ? `
    <div class="card p-8 text-center text-[var(--clr-text-faint)]">
      <svg class="w-12 h-12 mx-auto mb-3 text-[var(--clr-surface-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2a4 4 0 014-4h0a4 4 0 014 4v2M12 3a4 4 0 100 8 4 4 0 000-8z"/>
      </svg>
      <p class="font-medium text-[var(--clr-text-muted)]">No data yet</p>
      <p class="text-sm mt-1">Start by adding clients and projects from the sidebar.</p>
    </div>` : ''}
  `;

  /* ── Draw charts with Chart.js ─────────────────────────────────────── */
  if (hasFinData)  drawBarChart(months, incomeByM, expenseByM);
  if (hasProjData) drawDonutChart(statusDef, statusCounts);
}

/* ── Unmount — destroy charts to avoid canvas-reuse errors ─────────────── */
export function unmount() {
  _charts.forEach(c => c.destroy());
  _charts = [];
}

/* ── Chart: Income vs Expenses (bar) ───────────────────────────────────── */
function drawBarChart(labels, incomeData, expenseData) {
  const ctx = document.getElementById('chart-bar')?.getContext('2d');
  if (!ctx) return;

  // Read CSS custom properties at render time so charts respect the active theme
  const textMuted = cssVar('--clr-text-muted');
  const textFaint = cssVar('--clr-text-faint');
  const gridColor = cssVar('--clr-border');

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: incomeData,
          backgroundColor: 'rgba(52,211,153,0.75)',
          borderColor:     'rgba(52,211,153,1)',
          borderWidth: 1,
          borderRadius: 5,
        },
        {
          label: 'Expenses',
          data: expenseData,
          backgroundColor: 'rgba(248,113,113,0.75)',
          borderColor:     'rgba(248,113,113,1)',
          borderWidth: 1,
          borderRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: textMuted, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${getCurrencySymbol()} ${Number(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: textFaint }, grid: { color: gridColor } },
        y: {
          ticks: { color: textFaint, callback: v => `${getCurrencySymbol()} ${(v/1000).toFixed(0)}k` },
          grid:  { color: gridColor },
          beginAtZero: true,
        },
      },
    },
  });
  _charts.push(chart);
}

/* ── Chart: Project Status (donut) ─────────────────────────────────────── */
function drawDonutChart(statusDef, counts) {
  const ctx = document.getElementById('chart-donut')?.getContext('2d');
  if (!ctx) return;
  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels:   statusDef.map(s => s.label),
      datasets: [{
        data:            counts,
        backgroundColor: statusDef.map(s => s.color + 'cc'),
        borderColor:     statusDef.map(s => s.color),
        borderWidth: 2,
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} project${ctx.raw !== 1 ? 's' : ''}`,
          },
        },
      },
    },
  });
  _charts.push(chart);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Read a CSS custom property from the root element (theme-aware). */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function last6Months() {
  const labels = [];
  const now    = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    labels.push(d.toLocaleString('default', { month: 'short', year: '2-digit' }));
  }
  return labels;
}

function bucketByMonth(txns, labels) {
  const now    = new Date();
  return labels.map((_, i) => {
    const d     = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const year  = d.getFullYear();
    const month = d.getMonth();
    return txns
      .filter(t => {
        const td = new Date(t.date ?? t.createdAt);
        return td.getFullYear() === year && td.getMonth() === month;
      })
      .reduce((s, t) => s + Number(t.amount), 0);
  });
}

function emptyChart(msg) {
  return `<div class="flex items-center justify-center h-48 text-sm text-[var(--clr-text-faint)] italic">${msg}</div>`;
}

function statCard({ label, value, sub, color, icon }) {
  const colors = {
    blue:   { bg: 'rgba(59,130,246,0.12)',  text: '#60a5fa', border: 'rgba(59,130,246,0.25)'  },
    violet: { bg: 'rgba(139,92,246,0.12)',  text: '#a78bfa', border: 'rgba(139,92,246,0.25)'  },
    emerald:{ bg: 'rgba(34,197,94,0.12)',   text: '#4ade80', border: 'rgba(34,197,94,0.25)'   },
    red:    { bg: 'rgba(239,68,68,0.12)',   text: '#f87171', border: 'rgba(239,68,68,0.25)'   },
  };
  const c = colors[color] ?? colors.blue;
  return `
    <div class="card p-5 flex flex-col gap-4 hover:scale-[1.015] transition-transform duration-200 cursor-default"
         style="border-color:${c.border}; background: linear-gradient(135deg, ${c.bg} 0%, var(--clr-surface) 100%)">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="section-label mb-1">${label}</p>
          <p class="text-2xl font-bold text-[var(--clr-text)] leading-tight break-words">${value}</p>
        </div>
        <div class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
             style="background:${c.bg}; color:${c.text}">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">${icon}</svg>
        </div>
      </div>
      <p class="text-xs text-[var(--clr-text-faint)]">${sub}</p>
    </div>`;
}

function skeletonHTML() {
  return `
    <div class="card-skeleton rounded-2xl h-32 mb-8"></div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
      ${Array(4).fill('<div class="card-skeleton rounded-xl h-32"></div>').join('')}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
      <div class="card-skeleton rounded-xl h-64 lg:col-span-2"></div>
      <div class="card-skeleton rounded-xl h-64"></div>
    </div>`;
}

