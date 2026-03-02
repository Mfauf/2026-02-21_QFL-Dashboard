/**
 * notifications.js — Persistent notification store backed by localStorage.
 *
 * Each record: { id, type, title, message, createdAt, read }
 * Types: 'overdue' | 'recurring' | 'info' | 'warning' | 'success'
 *
 * Fires a 'qfl:notif-updated' CustomEvent on window every time the store changes,
 * so any listener (e.g. the badge in the header) can update.
 */

const KEY      = 'qfl_notifications';
const MAX_KEEP = 100;

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); }
  catch { return []; }
}

function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent('qfl:notif-updated'));
}

/** Return all notifications, newest first. */
export function getAll() { return load(); }

/** Number of unread notifications. */
export function unreadCount() { return load().filter(n => !n.read).length; }

/**
 * Add a notification.
 * @param {{ type?: string, title: string, message: string }} opts
 */
export function addNotification({ type = 'info', title, message }) {
  const all = load();
  all.unshift({
    id:        Date.now() + Math.random(),
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
    read:      false,
  });
  save(all.slice(0, MAX_KEEP));
}

/** Mark every notification as read. */
export function markAllRead() {
  save(load().map(n => ({ ...n, read: true })));
}

/** Remove a single notification by id. */
export function clearOne(id) {
  save(load().filter(n => n.id !== id));
}

/** Remove all notifications. */
export function clearAll() {
  save([]);
}
