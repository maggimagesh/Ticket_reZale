/**
 * Theme preference: URL ?theme= overrides once; otherwise restore from localStorage.
 */

const STORAGE_KEY = 'rezale_theme';

const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private mode / blocked storage */
  }
  return 'dark';
}

const fromQuery = params.get('theme');
export const defaultTheme =
  fromQuery === 'light' || fromQuery === 'dark' ? fromQuery : readStoredTheme();

export function saveTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}
