/**
 * overview.js — Overview / dashboard view.
 * Displays aggregate stats pulled live from IndexedDB.
 */

import { getAllRecords } from '../db.js';
import { formatQAR }    from '../utils.js';

/* ── Mount ──────────────────────────────────────────────────────────────── */
export async function mount(container) {
  // Render skeleton while loading
  container.innerHTML = skeletonHTML();

  const [clients, projects, transactions] = await Promise.all([
    getAllRecords('clients'),
    getAllRecords('projects'),
    getAllRecords('transactions'),
  ]);

  const income  = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const outcome = transactions.filter(t => t.type === 'outcome').reduce((s, t) => s + Number(t.amount), 0);
  const profit  = income - outcome;

  const inProgress = projects.filter(p => p.status === 'in-progress').length;
  const complete   = projects.filter(p => p.status === 'complete').length;
  const activeClients = clients.filter(c => c.status === 'active').length;

  container.innerHTML = `
    <!-- Welcome banner -->
    <div class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[var(--clr-surface-3)] via-[var(--clr-surface-2)] to-[#1e4172] p-6 md:p-8 mb-8">
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
      ${statCard({ label: 'Total Projects', value: projects.length, sub: `${inProgress} in progress · ${complete} complete`, color: 'blue',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>` })}
      ${statCard({ label: 'Total Clients', value: clients.length, sub: `${activeClients} active`, color: 'violet',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>` })}
      ${statCard({ label: 'Total Income', value: formatQAR(income), sub: `Outcomes: ${formatQAR(outcome, true)}`, color: 'emerald',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>` })}
      ${statCard({ label: 'Net Profit', value: formatQAR(profit), sub: profit >= 0 ? '▲ Positive' : '▼ Negative', color: profit >= 0 ? 'emerald' : 'red',
        icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>` })}
    </div>

    <!-- No data hint -->
    ${projects.length === 0 && clients.length === 0 ? `
    <div class="card p-8 text-center text-[var(--clr-text-faint)]">
      <svg class="w-12 h-12 mx-auto mb-3 text-[var(--clr-surface-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17v-2a4 4 0 014-4h0a4 4 0 014 4v2M12 3a4 4 0 100 8 4 4 0 000-8z"/>
      </svg>
      <p class="font-medium text-[var(--clr-text-muted)]">No data yet</p>
      <p class="text-sm mt-1">Start by adding clients and projects from the sidebar.</p>
    </div>` : ''}
  `;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
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
        <div class="min-w-0">
          <p class="section-label mb-1">${label}</p>
          <p class="text-2xl font-bold text-[var(--clr-text)] leading-tight">${value}</p>
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
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      ${Array(4).fill('<div class="card-skeleton rounded-xl h-32"></div>').join('')}
    </div>`;
}
