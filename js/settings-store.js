/**
 * settings-store.js — Thin localStorage wrapper for app settings.
 *
 * Imported by:
 *   - js/modules/settings.js  (read + write, full UI)
 *   - js/modules/projects.js  (read project categories for datalist)
 *   - js/modules/finances.js  (read income/expense categories for datalist)
 *
 * All settings are stored under the key `qfl_settings` as a JSON object.
 */

const STORAGE_KEY = 'qfl_settings';

/** ── Default values ────────────────────────────────────────────────────── */
export const DEFAULTS = {
  profile: {
    name:     '',
    company:  '',
    email:    '',
    phone:    '',
    tagline:  '',
    avatar:   '',   // base64 data URL of the uploaded profile picture
  },
  invoice: {
    prefix:       'INV-',
    paymentTerms: 'Payment is due within 30 days of the invoice date.',
  },
  blueprint: {
    terms: 'All deliverables remain the property of the service provider until full payment is received.\nRevision rounds are limited to those specified in the agreed scope.\nAny changes outside the agreed scope will be quoted separately.\nProject timelines are estimates and may vary based on client feedback turnaround.\nThis proposal is valid for 30 days from the date issued.',
    amountPerHour: 0,
  },
  // Array of { id, name, details, price } preset features available in blueprints
  defaultFeatures: [],
  categories: {
    project: [
      'Web Design', 'Mobile App', 'Branding', 'Consulting',
      'SEO', 'UI/UX', 'Development', 'Other',
    ],
    transaction: [
      'Project Payment', 'Consulting', 'Retainer', 'Bonus', 'Refund',
      'Software / Tools', 'Hardware', 'Marketing', 'Office',
      'Freelancer Fee', 'Tax', 'Hosting', 'Transport', 'Education', 'Other',
    ],
  },
  appearance: {
    theme: 'system',   // 'system' | 'dark' | 'light'
  },
  sync: {
    peerUID: '',       // saved peer device UID for quick re-sync
  },
};

/** ── Read ─────────────────────────────────────────────────────────────── */

/**
 * Returns the current settings, merged over the defaults.
 * Always returns a complete object — safe to destructure any section.
 * @returns {typeof DEFAULTS}
 */
export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/** ── Write ────────────────────────────────────────────────────────────── */

/**
 * Merge a partial settings object into the stored settings and persist.
 * @param {Partial<typeof DEFAULTS>} patch
 * @returns {typeof DEFAULTS} the new full settings object
 */
export function saveSettings(patch) {
  const next = deepMerge(getSettings(), patch);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Deep-merges `source` into `target`.
 * Arrays in source REPLACE (not concat) the array in target.
 */
function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(typeof target[k] === 'object' ? target[k] : {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
