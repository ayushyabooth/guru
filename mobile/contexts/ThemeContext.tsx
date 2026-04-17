/**
 * ThemeContext v2 — OS-aware, persisted, three-way theme system.
 *
 * Preferences:
 *   - "system" (default): follows OS prefers-color-scheme, updates live
 *   - "dark":   force dark regardless of OS
 *   - "light":  force light regardless of OS
 *
 * Persistence: localStorage.guru_theme on web; AsyncStorage on native (via
 * Platform-gated fallback — web uses window.localStorage directly to guarantee
 * synchronous first-paint resolution).
 *
 * Integration:
 *   - On web we also set <html data-theme="dark|light"> so non-RN chrome (web
 *     extension, global CSS) can react.
 *   - Tap into `useTheme()` for { mode, isDark, colors, preference, setPreference, cyclePreference }.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Appearance, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { DarkTheme } from '../constants/darkTheme';
import { LightTheme } from '../constants/lightTheme';

type ThemePreference = 'system' | 'dark' | 'light';
type ResolvedMode = 'dark' | 'light';
type ThemePalette = typeof DarkTheme;

const STORAGE_KEY = 'guru_theme';

// LightTheme already mirrors DarkTheme's shape exactly — use it directly.
const lightAsDarkShape: ThemePalette = LightTheme;

interface ThemeContextValue {
  /** Currently resolved mode after applying preference + OS hint. */
  mode: ResolvedMode;
  /** Back-compat: equivalent to `mode === 'dark'`. */
  isDark: boolean;
  /** Theme palette (same shape whether dark or light). */
  colors: ThemePalette;
  /** User preference. */
  preference: ThemePreference;
  /** Explicit set. Persists to storage. */
  setPreference: (p: ThemePreference) => void;
  /** Cycle System → Dark → Light → System. */
  cyclePreference: () => void;
  /** Back-compat with v1 API; toggles between dark and light (sets a non-system preference). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  isDark: true,
  colors: DarkTheme,
  preference: 'system',
  setPreference: () => {},
  cyclePreference: () => {},
  toggleTheme: () => {},
});

// --- Storage helpers -------------------------------------------------------

function readPreferenceSync(): ThemePreference {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const v = window.localStorage.getItem(STORAGE_KEY);
      if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch {
      /* storage disabled — fall through */
    }
  }
  return 'system';
}

function writePreference(p: ThemePreference): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, p);
    } catch {
      /* storage disabled */
    }
  } else {
    SecureStore.setItemAsync(STORAGE_KEY, p).catch(() => {});
  }
}

function readOSScheme(): ResolvedMode {
  const scheme = Appearance.getColorScheme();
  return scheme === 'light' ? 'light' : 'dark';
}

function resolveMode(preference: ThemePreference, osScheme: ResolvedMode): ResolvedMode {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return osScheme;
}

function applyHtmlDataTheme(mode: ResolvedMode): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  try {
    document.documentElement.setAttribute('data-theme', mode);
    // Also set a hint for browser chrome (address bar color, etc.)
    let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = mode === 'dark' ? '#0A0E17' : '#F8FAFC';
  } catch {
    /* no-op in SSR / non-DOM environments */
  }
}

// --- Provider --------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always start with server-safe defaults so SSR HTML matches client hydration.
  // Client-specific values (localStorage, OS scheme) are loaded in useEffect.
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [osScheme, setOsScheme] = useState<ResolvedMode>('dark');

  // After mount: read client-only values (localStorage / SecureStore / OS scheme).
  useEffect(() => {
    setOsScheme(readOSScheme());
    if (Platform.OS === 'web') {
      const stored = readPreferenceSync();
      if (stored !== 'system') setPreferenceState(stored);
    } else {
      SecureStore.getItemAsync(STORAGE_KEY).then((v) => {
        if (v === 'dark' || v === 'light' || v === 'system') {
          setPreferenceState(v);
        }
      }).catch(() => {});
    }
  }, []);

  // Subscribe to OS scheme changes.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setOsScheme(colorScheme === 'light' ? 'light' : 'dark');
    });
    return () => sub.remove();
  }, []);

  const mode = resolveMode(preference, osScheme);

  // Keep <html data-theme> + theme-color meta in sync on web.
  useEffect(() => {
    applyHtmlDataTheme(mode);
  }, [mode]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    writePreference(p);
  }, []);

  const cyclePreference = useCallback(() => {
    setPreferenceState((prev) => {
      const next: ThemePreference = prev === 'system' ? 'dark' : prev === 'dark' ? 'light' : 'system';
      writePreference(next);
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setPreferenceState((prev) => {
      // v1 behavior: flip between dark ↔ light; leaving `system` enters explicit mode.
      const currentResolved = resolveMode(prev, osScheme);
      const next: ThemePreference = currentResolved === 'dark' ? 'light' : 'dark';
      writePreference(next);
      return next;
    });
  }, [osScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark: mode === 'dark',
      colors: mode === 'dark' ? DarkTheme : lightAsDarkShape,
      preference,
      setPreference,
      cyclePreference,
      toggleTheme,
    }),
    [mode, preference, setPreference, cyclePreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

export default ThemeContext;
