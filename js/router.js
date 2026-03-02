/**
 * router.js — Lightweight hash-based SPA router.
 * Maps URL hashes (#overview, #clients, etc.) to view modules.
 * Each module exports a `mount(container)` function that renders its view.
 */

import { openDB } from './db.js';

/** @type {Map<string, { mount: (el: HTMLElement) => void, unmount?: () => void }>} */
const _routes = new Map();

/** Currently active route key */
let _activeRoute = null;
let _unmountCurrent = null;

/* ── Register a route ───────────────────────────────────────────────────── */
/**
 * @param {string} hash — without '#' prefix
 * @param {{ mount: (el: HTMLElement) => void, unmount?: () => void }} module
 */
export function registerRoute(hash, module) {
  _routes.set(hash, module);
}

/* ── Navigate to a route ────────────────────────────────────────────────── */
export function navigate(hash) {
  window.location.hash = '#' + hash;
}

/* ── Resolve & mount current hash ───────────────────────────────────────── */
async function resolve() {
  const hash  = (window.location.hash || '#overview').replace('#', '');
  const route = _routes.get(hash) ?? _routes.get('overview');

  if (!route) return;

  // Unmount previous view if it provides a cleanup function
  _unmountCurrent?.();
  _unmountCurrent = null;

  const container = document.getElementById('view-container');
  if (!container) return;

  // Show loading skeleton while DB opens
  container.innerHTML = `
    <div class="flex items-center justify-center h-64 text-[var(--clr-text-faint)]">
      <svg class="w-6 h-6 animate-spin mr-3" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Loading…
    </div>`;

  // Ensure DB is ready before mounting any view
  try {
    await openDB();
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <p class="text-[var(--clr-danger)]">⚠ Could not open database. Please refresh the page.</p>
      </div>`;
    return;
  }

  // Mount the new view
  route.mount(container);
  _unmountCurrent = route.unmount ?? null;

  // Update active nav link styling
  _activeRoute = hash;
  document.querySelectorAll('.nav-item').forEach(el => {
    const href = el.getAttribute('data-route');
    el.classList.toggle('nav-active', href === hash);
  });

  // Update page header title
  const headerTitle = document.getElementById('page-title');
  const titles = {
    overview: 'Overview',
    projects: 'Projects',
    clients:  'Clients',
    invoices: 'Invoices',
    finances: 'Finances',
    settings: 'Settings',
  };
  if (headerTitle) headerTitle.textContent = titles[hash] ?? hash;
}

/* ── Init router ────────────────────────────────────────────────────────── */
export function initRouter() {
  window.addEventListener('hashchange', resolve);
  resolve(); // resolve on initial load
}
