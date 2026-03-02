/**
 * theme.js — Dark / Light / System theme management.
 *
 * Reads the user's stored preference ('dark' | 'light' | 'system') and
 * applies `data-theme="dark"` or `data-theme="light"` to <html>.
 * When preference is 'system', it follows prefers-color-scheme and
 * re-applies automatically when the OS setting changes.
 *
 * Used by:
 *   - index.html  (inline anti-flash script + watchSystemTheme call)
 *   - js/modules/settings.js  (applyTheme after user picks a preference)
 */

const STORAGE_KEY = 'qfl_settings';
const HTML = document.documentElement;

/** Return the stored theme preference: 'system' | 'dark' | 'light' */
export function getThemePref() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw ? JSON.parse(raw) : {})?.appearance?.theme ?? 'system';
  } catch {
    return 'system';
  }
}

/** Resolve 'system' to the actual 'dark' or 'light' based on OS setting */
function resolve(pref) {
  if (pref === 'light') return 'light';
  if (pref === 'dark')  return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Apply a theme preference to <html data-theme="…"> */
export function applyTheme(pref) {
  HTML.dataset.theme = resolve(pref);
}

/** Listen for OS-level colour-scheme changes and re-apply when pref = 'system' */
export function watchSystemTheme() {
  window.matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => {
      if (getThemePref() === 'system') applyTheme('system');
    });
}
