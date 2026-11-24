export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'yoink_theme';

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function readSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveInitialTheme(
  storage?: StorageLike | null,
  systemPrefersDark: boolean = readSystemPrefersDark()
): ThemeMode {
  const store = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage;
  try {
    const saved = store?.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Storage access may be restricted in sandboxed contexts; fall back to system preference.
  }
  return systemPrefersDark ? 'dark' : 'light';
}

export function persistTheme(theme: ThemeMode, storage?: StorageLike | null): void {
  const store = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage;
  try {
    store?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage write errors so theme toggling stays responsive in restricted tabs.
  }
}

export function applyThemeToDocument(
  theme: ThemeMode,
  doc: Document | null = typeof document !== 'undefined' ? document : null
): void {
  if (!doc?.documentElement) return;
  doc.documentElement.setAttribute('data-theme', theme);
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark';
}
