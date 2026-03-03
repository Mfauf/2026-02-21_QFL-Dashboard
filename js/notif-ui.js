/**
 * notif-ui.js — Notification bell badge + sliding right-side panel UI.
 * Depends on: js/notifications.js
 */

import { getAll, unreadCount, markAllRead, clearAll, clearOne } from './notifications.js';

/* ── Live timer state (not persisted, updated via window events) ─────────── */
let _liveTimer = { status: 'idle', elapsed: 0, projectName: '' };

function formatTimerMs(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
}

function renderTimerCard() {
  const card = document.getElementById('timer-live-card');
  if (!card) return;

  if (_liveTimer.status === 'idle') {
    card.style.display = 'none';
    return;
  }

  const isRunning = _liveTimer.status === 'running';
  card.style.display = 'block';
  card.innerHTML = `
    <div style="margin:12px 12px 0;border-radius:12px;overflow:hidden;
                border:1px solid var(--clr-success-ring);background:var(--clr-surface-2)">
      <!-- Status bar -->
      <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;
                  background:${isRunning ? 'var(--clr-success-bg)' : 'var(--clr-surface-3)'}">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;
                     background:${isRunning ? 'var(--clr-success)' : 'var(--clr-text-faint)'};
                     ${isRunning ? 'animation:timer-dot-pulse 1.4s ease-in-out infinite' : ''}"></span>
        <span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
                     color:${isRunning ? 'var(--clr-success)' : 'var(--clr-text-faint)'}">
          ${isRunning ? 'Timer Running' : 'Timer Paused'}
        </span>
      </div>
      <!-- Body -->
      <div style="padding:10px 14px 12px;display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div>
          <p id="notif-timer-display"
             style="font-size:1.75rem;font-weight:800;font-variant-numeric:tabular-nums;
                    letter-spacing:-0.03em;line-height:1;
                    color:${isRunning ? 'var(--clr-success)' : 'var(--clr-text-muted)'}">
            ${formatTimerMs(_liveTimer.elapsed)}
          </p>
          <p style="font-size:11px;color:var(--clr-text-faint);margin-top:4px;
                    max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(_liveTimer.projectName)}
          </p>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${isRunning
            ? `<button id="notif-timer-pause"
                       style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;
                              padding:6px 11px;border-radius:8px;border:1px solid var(--clr-border-mid);
                              background:var(--clr-surface);color:var(--clr-text-muted);cursor:pointer">
                 <svg style="width:11px;height:11px;flex-shrink:0" fill="currentColor" viewBox="0 0 24 24">
                   <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
                 </svg>Pause
               </button>`
            : `<button id="notif-timer-resume"
                       style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;
                              padding:6px 11px;border-radius:8px;border:1px solid var(--clr-success-ring);
                              background:var(--clr-success-bg);color:var(--clr-success);cursor:pointer">
                 <svg style="width:11px;height:11px;flex-shrink:0" fill="currentColor" viewBox="0 0 24 24">
                   <polygon points="5 3 19 12 5 21 5 3"/>
                 </svg>Resume
               </button>`}
          <button id="notif-timer-stop"
                  style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;
                         padding:6px 11px;border-radius:8px;border:1px solid var(--clr-danger-ring);
                         background:var(--clr-danger-bg);color:var(--clr-danger);cursor:pointer">
            <svg style="width:11px;height:11px;flex-shrink:0" fill="currentColor" viewBox="0 0 24 24">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>Stop
          </button>
        </div>
      </div>
    </div>`;

  card.querySelector('#notif-timer-pause')?.addEventListener('click', () => {
    window._qflTimerControls?.pause();
  });
  card.querySelector('#notif-timer-resume')?.addEventListener('click', () => {
    window._qflTimerControls?.resume();
  });
  card.querySelector('#notif-timer-stop')?.addEventListener('click', () => {
    window._qflTimerControls?.stop();
  });
}

function updateTimerBell() {
  const btn = document.getElementById('btn-notifications');
  if (!btn) return;
  if (_liveTimer.status !== 'idle') btn.classList.add('timer-active');
  else                              btn.classList.remove('timer-active');
}

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
  renderTimerCard();   // show live timer card whenever panel opens

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

  // ── Live timer events ───────────────────────────────────────────────────
  // Full state change (start / pause / resume): re-render card + update bell
  window.addEventListener('qfl:timer-updated', e => {
    _liveTimer = {
      status:      e.detail.status,
      elapsed:     e.detail.elapsed,
      projectName: e.detail.projectName,
    };
    renderTimerCard();
    updateTimerBell();
  });

  // Every-second tick while running: just update the time display text
  window.addEventListener('qfl:timer-tick', e => {
    _liveTimer.elapsed = e.detail.elapsed;
    _liveTimer.status  = e.detail.status;
    const display = document.getElementById('notif-timer-display');
    if (display) {
      display.textContent = formatTimerMs(_liveTimer.elapsed);
    }
  });

  // Timer stopped: hide card, remove bell ring
  window.addEventListener('qfl:timer-stopped', () => {
    _liveTimer = { status: 'idle', elapsed: 0, projectName: '' };
    renderTimerCard();
    updateTimerBell();
  });
}
