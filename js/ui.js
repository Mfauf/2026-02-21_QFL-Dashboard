/**
 * ui.js — Shared UI components:
 *   - Toast notifications
 *   - Modal (add/edit form)
 *   - Confirm dialog (delete)
 *   - Sidebar open/close on mobile
 */

/* ── Toast ──────────────────────────────────────────────────────────────── */

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type]
 * @param {number} [duration] ms before auto-dismiss
 */
export function toast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
              </svg>`,
    error:   `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>`,
    info:    `<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 110 20A10 10 0 0112 2z"/>
              </svg>`,
  };

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  // Insert icon as HTML but set message via textContent to prevent XSS
  el.innerHTML = `${icons[type] ?? ''}<span></span>`;
  el.querySelector('span').textContent = message;
  container.appendChild(el);

  // Auto-dismiss
  const dismiss = () => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  setTimeout(dismiss, duration);
  el.addEventListener('click', dismiss);
}

/* ── Modal ──────────────────────────────────────────────────────────────── */

let _modalCloseCallback = null;

/**
 * Open the global modal.
 * @param {{ title: string, bodyHTML: string, onSubmit: (formData: FormData) => Promise<void>, submitLabel?: string }} opts
 */
export function openModal({ title, bodyHTML, onSubmit, submitLabel = 'Save' }) {
  const backdrop = document.getElementById('modal-backdrop');
  const modalTitle = document.getElementById('modal-title');
  const modalBody  = document.getElementById('modal-body');
  const submitBtn  = document.getElementById('modal-submit');
  const form       = document.getElementById('modal-form');

  modalTitle.textContent = title;

  // Reset any previous form state BEFORE injecting new content,
  // so that dynamically-set values (edit modal) are not wiped.
  form.reset?.();

  // Clear any previous error banner
  const banner   = document.getElementById('modal-error-banner');
  const bannerTx = document.getElementById('modal-error-text');
  if (banner)   banner.style.display = 'none';
  if (bannerTx) bannerTx.textContent = '';

  modalBody.innerHTML    = bodyHTML;
  submitBtn.textContent  = submitLabel;
  submitBtn.disabled = false;

  // Attach submit handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;  // guard against concurrent submits

    // Hide any previous error
    const banner   = document.getElementById('modal-error-banner');
    const bannerTx = document.getElementById('modal-error-text');
    if (banner) banner.style.display = 'none';

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      await onSubmit(new FormData(form));
      closeModal();
    } catch (err) {
      console.error('[Modal] Submit error:', err);
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;

      // Show the error message inside the modal
      if (banner && bannerTx) {
        bannerTx.textContent = err?.message || 'Please fill in all required fields.';
        banner.style.display = 'flex';
        // Scroll the error into view
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  };

  form.addEventListener('submit', handleSubmit);
  _modalCloseCallback = () => form.removeEventListener('submit', handleSubmit);

  // Open with animation
  requestAnimationFrame(() => {
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });
}

/** Close the global modal. */
export function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  backdrop.classList.remove('open');
  backdrop.addEventListener('transitionend', () => {
    backdrop.classList.add('hidden');
    document.getElementById('modal-body').innerHTML = '';
  }, { once: true });

  _modalCloseCallback?.();
  _modalCloseCallback = null;
}

/* ── Confirm dialog ─────────────────────────────────────────────────────── */

/**
 * Show a confirmation dialog before a destructive action.
 * @param {{ title?: string, message: string, confirmLabel?: string, onConfirm: () => Promise<void> }} opts
 */
export function openConfirm({ title = 'Are you sure?', message, confirmLabel = 'Delete', onConfirm }) {
  const backdrop   = document.getElementById('confirm-backdrop');
  const titleEl    = document.getElementById('confirm-title');
  const messageEl  = document.getElementById('confirm-message');
  const confirmBtn = document.getElementById('confirm-ok');
  const cancelBtn  = document.getElementById('confirm-cancel');

  titleEl.textContent   = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmLabel;
  confirmBtn.disabled    = false;

  const close = () => {
    backdrop.classList.remove('open');
    backdrop.addEventListener('transitionend', () => backdrop.classList.add('hidden'), { once: true });
  };

  const handleConfirm = async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '…';
    try {
      await onConfirm();
    } finally {
      close();
    }
  };

  confirmBtn.onclick = handleConfirm;
  cancelBtn.onclick  = close;
  backdrop.onclick   = close;
  backdrop.querySelector('.confirm-box').onclick = (e) => e.stopPropagation();

  requestAnimationFrame(() => {
    backdrop.classList.remove('hidden');
    requestAnimationFrame(() => backdrop.classList.add('open'));
  });
}

/* ── Sidebar (mobile) ───────────────────────────────────────────────────── */
export function openSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  sb.style.transform = '';           // clear any live-drag leftover
  sb.classList.remove('-translate-x-full');
  ov?.classList.remove('hidden');
}

export function closeSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  if (!sb) return;
  sb.style.transform = '';
  sb.classList.add('-translate-x-full');
  ov?.classList.add('hidden');
}

/* ── Init shared UI listeners ────────────────────────────────────────────── */
export function initUI() {
  // Close modal on backdrop click
  document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Close confirm on backdrop click
  document.getElementById('confirm-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.remove('open');
      setTimeout(() => e.currentTarget.classList.add('hidden'), 200);
    }
  });

  // Modal cancel button
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);

  // Escape key closes the topmost open dialog
  // "N" key opens the Add form for the current view
  document.addEventListener('keydown', (e) => {
    // Ignore when typing inside any input/textarea/select or contenteditable
    const tag = document.activeElement?.tagName;
    const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
                   || document.activeElement?.isContentEditable;

    if (e.key === 'Escape') {
      const confirm = document.getElementById('confirm-backdrop');
      if (confirm && !confirm.classList.contains('hidden')) {
        confirm.classList.remove('open');
        setTimeout(() => confirm.classList.add('hidden'), 200);
        return;
      }
      closeModal();
      return;
    }

    if ((e.key === 'n' || e.key === 'N') && !isEditing && !e.ctrlKey && !e.metaKey) {
      const addBtn = document.querySelector(
        '#btn-add-client, #btn-add-project, #btn-add-invoice, #btn-add-transaction'
      );
      addBtn?.click();
    }
  });

  /* ── Swipe gesture for sidebar (mobile only) ──────────────────────────── */
  _initSidebarSwipe();
}

function _initSidebarSwipe() {
  const EDGE_ZONE   = 30;   // px from left edge that starts an open-swipe
  const MIN_SWIPE   = 40;   // minimum horizontal distance to commit open/close
  const MAX_VERT    = 60;   // max vertical drift allowed before we abandon the gesture

  let touchStartX = 0;
  let touchStartY = 0;
  let tracking    = false;  // are we tracking a swipe candidate?
  let direction   = null;   // 'open' | 'close'

  const sidebar = () => document.getElementById('sidebar');
  const overlay = () => document.getElementById('sidebar-overlay');
  const isOpen  = () => sidebar() && !sidebar().classList.contains('-translate-x-full');
  const sidebarW = () => sidebar()?.offsetWidth ?? 260;

  // Only wire up on touch devices / narrow screens
  document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    tracking = false;
    direction = null;

    // Decide if this touch could be a sidebar swipe:
    // - open: starting from within EDGE_ZONE at the left
    // - close: sidebar is open and touch starts anywhere inside it
    if (!isOpen() && touchStartX <= EDGE_ZONE) {
      direction = 'open';
      tracking  = true;
    } else if (isOpen()) {
      direction = 'close';
      tracking  = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = Math.abs(touch.clientY - touchStartY);

    // Abandon if too much vertical drift
    if (dy > MAX_VERT) { tracking = false; _resetSidebar(); return; }

    const sb = sidebar();
    if (!sb) return;

    if (direction === 'open') {
      // Drag right: translate from fully hidden (−sidebarW) toward 0
      const offset = Math.min(dx - sidebarW(), 0);
      sb.style.transition = 'none';
      sb.style.transform  = `translateX(${offset}px)`;
      // Show overlay faintly while dragging
      const ov = overlay();
      if (ov) { ov.classList.remove('hidden'); ov.style.opacity = String(Math.min(dx / sidebarW(), 1)); }
    } else if (direction === 'close') {
      // Drag left: translate from 0 toward negative
      const offset = Math.min(dx, 0);
      sb.style.transition = 'none';
      sb.style.transform  = `translateX(${offset}px)`;
      const ov = overlay();
      if (ov) ov.style.opacity = String(Math.max(1 + dx / sidebarW(), 0));
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const sb = sidebar();
    if (!sb) return;

    // Restore transition
    sb.style.transition = '';
    const ov = overlay();
    if (ov) ov.style.opacity = '';

    if (direction === 'open'  && dx >= MIN_SWIPE)  { openSidebar();  }
    else if (direction === 'close' && dx <= -MIN_SWIPE) { closeSidebar(); }
    else { _resetSidebar(); }
  }, { passive: true });

  function _resetSidebar() {
    const sb = sidebar();
    if (!sb) return;
    sb.style.transition = '';
    sb.style.transform  = '';
    const ov = overlay();
    if (ov) ov.style.opacity = '';
    // Re-sync classes to actual state
    if (isOpen()) { ov?.classList.remove('hidden'); }
    else          { ov?.classList.add('hidden'); }
  }}