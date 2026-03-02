/**
 * notif-ui.js — Notification bell badge + sliding right-side panel UI.
 * Depends on: js/notifications.js
 */

import { getAll, unreadCount, markAllRead, clearAll, clearOne } from './notifications.js';

/* ── Icon SVG per notification type ─────────────────────────────────────── */
function iconSVG(type) {
  if (type === 'overdue') {
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4
           c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
    </svg>`;
  }
  if (type === 'recurring') {
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003
           8.003 0 01-15.357-2m15.357 2H15"/>
    </svg>`;
  }
  if (type === 'success') {
    return `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
    </svg>`;
  }
  /* info / warning / default */
  return `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
      d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z"/>
  </svg>`;
}

const ICON_STYLE = {
  overdue:   { bg: 'var(--clr-danger-bg)',   color: 'var(--clr-danger)'        },
  recurring: { bg: 'var(--clr-primary-dim)', color: 'var(--clr-primary-light)' },
  info:      { bg: 'var(--clr-surface-3)',   color: 'var(--clr-text-muted)'    },
  warning:   { bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24'                  },
  success:   { bg: 'var(--clr-success-bg)',  color: 'var(--clr-success)'       },
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Badge ───────────────────────────────────────────────────────────────── */
export function refreshBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const n = unreadCount();
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.style.display = n > 0 ? 'flex' : 'none';
}

/* ── Panel open / close ──────────────────────────────────────────────────── */
function openPanel() {
  const overlay = document.getElementById('notif-overlay');
  const drawer  = document.getElementById('notif-drawer');
  if (!overlay || !drawer) return;

  renderList();

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    drawer.classList.add('open');
  });

  // Mark all read after a short delay so user sees the unread dots briefly
  setTimeout(() => { markAllRead(); refreshBadge(); }, 600);
}

function closePanel() {
  const overlay = document.getElementById('notif-overlay');
  const drawer  = document.getElementById('notif-drawer');
  if (!overlay || !drawer) return;

  overlay.classList.remove('open');
  drawer.classList.remove('open');
  overlay.addEventListener('transitionend', () => {
    overlay.classList.add('hidden');
  }, { once: true });
}

/* ── List renderer ───────────────────────────────────────────────────────── */
function renderList() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  const all = getAll();

  if (!all.length) {
    list.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  padding:4rem 1.5rem;text-align:center;user-select:none">
        <svg style="width:3rem;height:3rem;margin-bottom:.75rem;color:var(--clr-surface-3)"
             fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0
               00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0
               .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>
        </svg>
        <p style="font-weight:500;color:var(--clr-text-muted)">No notifications</p>
        <p style="font-size:.75rem;margin-top:.25rem;color:var(--clr-text-faint)">
          Auto-actions and alerts will appear here
        </p>
      </div>`;
    return;
  }

  list.innerHTML = all.map(n => {
    const style = ICON_STYLE[n.type] ?? ICON_STYLE.info;
    const ts    = n.createdAt
      ? new Date(n.createdAt).toLocaleString('en-GB', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        })
      : '';
    return `
      <div class="notif-item${n.read ? '' : ' unread'}">
        <div class="notif-icon" style="background:${style.bg};color:${style.color}">
          ${iconSVG(n.type)}
        </div>
        <div class="notif-body">
          <p class="notif-title">
            ${esc(n.title)}
            ${!n.read ? '<span class="notif-dot"></span>' : ''}
          </p>
          <p class="notif-msg">${esc(n.message)}</p>
          <p class="notif-time">${ts}</p>
        </div>
        <button class="notif-dismiss" data-id="${n.id}" title="Dismiss" aria-label="Dismiss">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  list.querySelectorAll('.notif-dismiss').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      clearOne(Number(btn.dataset.id));
      renderList();
    });
  });
}

/* ── Init ────────────────────────────────────────────────────────────────── */
export function initNotifications() {
  refreshBadge();
  window.addEventListener('qfl:notif-updated', refreshBadge);

  // Bell button
  document.getElementById('btn-notifications')
    ?.addEventListener('click', openPanel);

  // Overlay backdrop click closes panel
  document.getElementById('notif-overlay')
    ?.addEventListener('click', e => {
      if (e.target === e.currentTarget) closePanel();
    });

  // Close button inside drawer
  document.getElementById('notif-close')
    ?.addEventListener('click', closePanel);

  // Mark all read
  document.getElementById('notif-mark-read')?.addEventListener('click', () => {
    markAllRead();
    renderList();
    refreshBadge();
  });

  // Clear all
  document.getElementById('notif-clear-all')?.addEventListener('click', () => {
    clearAll();
    renderList();
    refreshBadge();
  });

  // ESC key closes panel
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
  });
}
