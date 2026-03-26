/**
 * sw.js — Service Worker for QFL Dashboard PWA.
 *
 * Strategy: Cache-first for static assets, network-first for navigation.
 * On install, pre-caches the app shell so it works offline.
 * On activate, purges any old cache versions.
 */

const CACHE_NAME = 'qfl-v1';

/** App shell files to pre-cache on install. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './css/styles.css',
  './css/tailwind.css',
  './js/db.js',
  './js/router.js',
  './js/ui.js',
  './js/utils.js',
  './js/theme.js',
  './js/settings-store.js',
  './js/sync.js',
  './js/notifications.js',
  './js/notif-ui.js',
  './js/blueprint-pdf.js',
  './js/invoice-pdf.js',
  './js/modules/overview.js',
  './js/modules/projects.js',
  './js/modules/clients.js',
  './js/modules/invoices.js',
  './js/modules/finances.js',
  './js/modules/settings.js',
  './js/vendor/chart.umd.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/* ── Install: pre-cache app shell ───────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: purge old caches ─────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first for same-origin static assets, network-first for
     HTML navigations so the user always gets the latest page on refresh ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET or cross-origin requests (PeerJS, Google Fonts, CDN, etc.)
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return;

  // HTML navigations → network-first so updates land immediately
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Everything else → cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Only cache successful same-origin responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
