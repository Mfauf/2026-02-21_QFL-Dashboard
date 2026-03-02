/**
 * utils.js — Shared helper functions used across all modules.
 */

/* ── Date & time ────────────────────────────────────────────────────────── */

/**
 * Formats an ISO date string to a human-readable date.
 * @param {string|Date} date
 * @param {Intl.DateTimeFormatOptions} [opts]
 * @returns {string}
 */
export function formatDate(date, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-US', opts);
}

/**
 * Returns a relative time string like "2 days ago" or "in 3 hours".
 * @param {string|Date} date
 * @returns {string}
 */
export function timeAgo(date) {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  const abs  = Math.abs(diff);
  const past = diff > 0;

  const units = [
    { label: 'year',   ms: 31536000000 },
    { label: 'month',  ms: 2592000000  },
    { label: 'week',   ms: 604800000   },
    { label: 'day',    ms: 86400000    },
    { label: 'hour',   ms: 3600000     },
    { label: 'minute', ms: 60000       },
    { label: 'second', ms: 1000        },
  ];

  for (const { label, ms } of units) {
    const n = Math.floor(abs / ms);
    if (n >= 1) {
      const s = n === 1 ? label : label + 's';
      return past ? `${n} ${s} ago` : `in ${n} ${s}`;
    }
  }
  return 'just now';
}

/* ── Number / currency ──────────────────────────────────────────────────── */

/**
 * Formats a number as a QAR currency string.
 * @param {number} amount
 * @param {boolean} [compact] — show abbreviated form e.g. "QAR 12.5K"
 * @returns {string}
 */
export function formatQAR(amount, compact = false) {
  if (amount == null || isNaN(amount)) return '—';
  if (compact && Math.abs(amount) >= 1000) {
    const k = (amount / 1000).toFixed(1).replace(/\.0$/, '');
    return `QAR ${k}K`;
  }
  return 'QAR ' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/* ── String helpers ─────────────────────────────────────────────────────── */

/**
 * Returns uppercase initials from a name string (up to 2 chars).
 * @param {string} name
 * @returns {string}
 */
export function initials(name = '') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * Assigns a deterministic background color class for avatars based on name.
 * @param {string} name
 * @returns {string} inline style string with background-color
 */
export function avatarColor(name = '') {
  const colors = [
    '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
    '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Sanitises a string to prevent XSS when inserted via innerHTML.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Case-insensitive substring check across multiple fields of an object.
 * @param {object} obj
 * @param {string[]} fields
 * @param {string} query
 * @returns {boolean}
 */
export function matchesSearch(obj, fields, query) {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return fields.some(f => String(obj[f] ?? '').toLowerCase().includes(q));
}

/**
 * Debounce: delay fn execution until after `wait` ms of silence.
 * @param {Function} fn
 * @param {number} wait
 * @returns {Function}
 */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
