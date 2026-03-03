/**
 * router.js — Lightweight hash-based SPA router.
 * Maps URL hashes (#overview, #clients, etc.) to view modules.
 * Each module exports a `mount(container)` function that renders its view.
 */

import { openDB } from './db.js';

/** @type {Map<string, { mount: (el: HTMLElement) => void, unmount?: () => void }>} */
const _routes = new Map();

/** Pattern routes for parametric paths like 'project/:id' */
const _patternRoutes = [];

/** Currently active route key */
let _activeRoute = null;
let _unmountCurrent = null;

/* ── Register a route ───────────────────────────────────────────────────── */
/**
 * @param {string} hash — without '#' prefix; supports ':param' segments
 * @param {{ mount: Function, unmount?: Function, staticParams?: object }} module
 */
export function registerRoute(hash, module) {
  if (hash.includes(':')) {
    // Parametric pattern route
    const paramNames = [];
    const regexStr   = hash.replace(/:([a-zA-Z_]+)/g, (_, n) => { paramNames.push(n); return '([^/]+)'; });
    _patternRoutes.push({
      regex:        new RegExp('^' + regexStr + '$'),
      paramNames,
      module:       { mount: module.mount, unmount: module.unmount },
      staticParams: module.staticParams ?? {},
    });
  } else {
    _routes.set(hash, module);
  }
}

/* ── Navigate to a route ────────────────────────────────────────────────── */
export function navigate(hash) {
  window.location.hash = '#' + hash;
}

/* ── Resolve & mount current hash ───────────────────────────────────────── */
async function resolve() {
  const hash = (window.location.hash || '#overview').replace('#', '');

  // Try exact route first, then pattern routes
  let route  = _routes.get(hash);
  let params = {};

  if (!route) {
    for (const pr of _patternRoutes) {
      const m = hash.match(pr.regex);
      if (m) {
        route = pr.module;
        pr.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
        Object.assign(params, pr.staticParams);
        break;
      }
    }
  }

  route = route ?? _routes.get('overview');
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

  // Mount the new view (params is populated for pattern routes, empty {} for exact routes)
  route.mount(container, params);
  _unmountCurrent = route.unmount ?? null;

  // Trigger entrance animation on the view container
  container.classList.remove('qfl-view-in');
  // Force reflow so removing + re-adding the class restarts the animation
  void container.offsetWidth;
  container.classList.add('qfl-view-in');
  container.addEventListener('animationend', () => container.classList.remove('qfl-view-in'), { once: true });

  // Update active nav link styling.
  // Sub-routes (project/:id, project/:id/blueprint) map back to 'projects' nav item.
  _activeRoute = hash;
  const navHash = hash.startsWith('project/') ? 'projects' : hash;
  document.querySelectorAll('.nav-item').forEach(el => {
    const href = el.getAttribute('data-route');
    el.classList.toggle('nav-active', href === navHash);
  });

  // Update page title for top-level routes only.
  // Detail / blueprint sub-routes set their own title inside the module.
  const headerTitle = document.getElementById('page-title');
  const titles = {
    overview: 'Overview',
    projects: 'Projects',
    clients:  'Clients',
    invoices: 'Invoices',
    finances: 'Finances',
    settings: 'Settings',
  };
  if (headerTitle && titles[hash]) headerTitle.textContent = titles[hash];
}

/* ── Init router ────────────────────────────────────────────────────────── */
export function initRouter() {
  window.addEventListener('hashchange', resolve);
  resolve(); // resolve on initial load
}
