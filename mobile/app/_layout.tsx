import '../utils/polyfills';
import React from 'react';
import { Platform, View, Text, TouchableOpacity, StyleSheet, AppState } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

// Suppress noisy "Unexpected text node" warnings from React Native Web
if (Platform.OS === 'web') {
  const origWarn = console.error;
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Unexpected text node')) return;
    origWarn.apply(console, args);
  };
}
import { useFonts, Orbitron_400Regular, Orbitron_700Bold } from '@expo-google-fonts/orbitron';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';

import { DiveInProvider } from '../contexts/DiveInContext';
import { TimeTrackingProvider } from '../contexts/TimeTrackingContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { loadVisualConfigFromAPI } from '../constants/industryConfig';
import { getAuthToken, redirectToLogin } from '../utils/auth';
import ThemeAwareNav from '../components/ThemeAwareNav';

// GUR-240: recognise a session-expiry error from any service/hook so the global
// caches below can route to login. Services throw varied strings ("Not
// authenticated", "Unauthorized…", "Session expired", "Authentication failed")
// and the feed hooks throw `HTTP 401` — match them all.
function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /not authenticated|unauthorized|session expired|authentication failed|\b401\b/i.test(msg);
}

const queryClient = new QueryClient({
  // GUR-240: a single global "session expired → login" path. Any query OR
  // mutation that errors with an auth failure (including the catch-up / dive-in
  // feed refetches whose 401 was previously orphaned while cache rendered)
  // redirects to login. redirectToLogin() is loop-guarded.
  queryCache: new QueryCache({
    onError: (error) => { if (isAuthError(error)) void redirectToLogin(); },
  }),
  mutationCache: new MutationCache({
    onError: (error) => { if (isAuthError(error)) void redirectToLogin(); },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // 5 min — data is fresh, no refetch
      gcTime: 30 * 60 * 1000,       // 30 min — keep in cache
      refetchOnWindowFocus: false,   // Don't refetch when tab regains focus
      retry: 1,
    },
  },
});

// Prevent splash screen from auto-hiding while fonts load
SplashScreen.preventAutoHideAsync();

// ── Global Error Boundary (GUR-187) ─────────────────────────────────
// Catches any React render error in the entire app tree so a single
// component crash does not produce a blank white screen. Uses dark
// background + recap salmon accent matching the design system tokens.
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log so the error surfaces in Sentry / dev console / Vercel logs.
    console.error('[ErrorBoundary] Render error caught:', error, info?.componentStack);
  }

  handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    } else {
      // On native, the only recovery is to clear the error and re-render.
      this.setState({ hasError: false, error: null });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorBoundaryStyles.container}>
          <Text style={errorBoundaryStyles.logo}>guru.</Text>
          <Text style={errorBoundaryStyles.title}>Something went wrong</Text>
          {this.state.error?.message ? (
            <Text style={errorBoundaryStyles.message} numberOfLines={3}>
              {this.state.error.message}
            </Text>
          ) : null}
          <TouchableOpacity
            style={errorBoundaryStyles.button}
            onPress={this.handleReload}
            accessibilityRole="button"
            accessibilityLabel="Reload the app"
          >
            <Text style={errorBoundaryStyles.buttonText}>Reload</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorBoundaryStyles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: '100%' as any,
    backgroundColor: '#0A0E17',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    color: '#FB923C',
    fontFamily: Platform.OS === 'web' ? "'Orbitron_700Bold', 'Orbitron', sans-serif" : undefined,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 4,
    marginBottom: 24,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 12,
  },
  message: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 320,
  },
  button: {
    backgroundColor: '#FB923C',
    borderWidth: 1.5,
    borderColor: '#EA580C',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 999,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Orbitron_400Regular,
    Orbitron_700Bold,
    // Primary UI + reading font (peppy + sleek)
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    // Load icon fonts explicitly from assets/fonts/ so they don't reference
    // node_modules/ paths which Vercel strips from deployments.
    'material-community': require('../assets/fonts/MaterialCommunityIcons.ttf'),
    'material': require('../assets/fonts/MaterialIcons.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Sync industry visual config from backend (static fallback if unreachable)
  useEffect(() => {
    loadVisualConfigFromAPI();
  }, []);

  // GUR-240: validate the session on entry and whenever the app/tab regains
  // focus. getAuthToken() self-redirects to login on a dead session (refresh
  // failed), so a session that expired while backgrounded — or a deep-link
  // straight into a tab that bypasses the root gate — routes to login instead
  // of rendering cached authed content. No-op when logged out (no token).
  useEffect(() => {
    const revalidate = () => { void getAuthToken(); };
    revalidate(); // entry check (covers deep links past app/index.tsx)
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisible = () => { if (document.visibilityState === 'visible') revalidate(); };
      window.addEventListener('focus', revalidate);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('focus', revalidate);
        document.removeEventListener('visibilitychange', onVisible);
      };
    }
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') revalidate(); });
    return () => sub.remove();
  }, []);

  // Set default document title on web so the browser tab + screen readers have
  // a meaningful label. Per-route pages can override via their own effect.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.title) {
      document.title = 'Guru — Expert-curated reading';
    }
  }, []);

  // Inject a global font-family rule so every Text defaults to Manrope on web
  // without having to touch every consumer. Native path uses Typography tokens.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'guru-font-default';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      :root {
        --guru-font-primary: 'Manrope_400Regular', 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --guru-font-primary-bold: 'Manrope_700Bold', 'Manrope_800ExtraBold', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
        --guru-focus-ring: 2px solid rgba(99, 102, 241, 0.9);
      }
      html, body, input, textarea, button, [class*="css-"] {
        font-family: var(--guru-font-primary);
      }
      /* Preserve Orbitron on the logo wordmark */
      [data-brand="guru-logo"], [data-brand="guru-logo"] * {
        font-family: 'Orbitron_700Bold', 'Orbitron', sans-serif !important;
        letter-spacing: 0.25em;
      }
      /* A11y: focus-visible ring on any focusable element */
      :focus-visible {
        outline: var(--guru-focus-ring) !important;
        outline-offset: 2px !important;
        border-radius: 6px;
      }
      input:focus, textarea:focus { outline: none !important; }
      input:focus-visible, textarea:focus-visible { outline: var(--guru-focus-ring) !important; }
      /* A11y: Force <a> elements to inherit their colour from the parent
         themed container instead of falling through to browser default blue
         (#0000EE) or purple visited — which fails WCAG AA contrast on the
         dark #0A0E17 canvas (2.05:1) and breaks the tab-bar + "Adjust goals"
         link. Theme tokens set color on the parent React Native Text so
         inheriting yields the right value in both dark + light. */
      a, a:visited, a:link, a:hover, a:active {
        color: inherit;
        text-decoration: none;
      }
      a:focus-visible {
        outline: var(--guru-focus-ring) !important;
        outline-offset: 2px;
      }
      /* Skip-link */
      .guru-skip-link {
        position: absolute; top: -1000px; left: 0; z-index: 99999;
        padding: 10px 16px; background: #4F46E5; color: #FFFFFF;
        font-family: var(--guru-font-primary-bold);
        border-radius: 0 0 8px 0;
      }
      .guru-skip-link:focus, .guru-skip-link:focus-visible {
        top: 0;
      }
    `;
    // Inject a skip-link at the top of body for keyboard users.
    if (!document.querySelector('.guru-skip-link')) {
      const link = document.createElement('a');
      link.className = 'guru-skip-link';
      link.href = '#guru-main';
      link.textContent = 'Skip to main content';
      document.body.prepend(link);
    }
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // No web font fix needed — Expo bundles the .ttf files in the static export.
  // The vercel.json rewrite must exclude asset paths to let fonts load correctly.

  // On web static export, fonts may not trigger the loaded callback.
  // Don't block rendering — the app works fine with fallback system fonts.
  if (!fontsLoaded && Platform.OS !== 'web') {
    return null;
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TimeTrackingProvider>
            <DiveInProvider userId="default">
              <ThemeAwareNav />
            </DiveInProvider>
          </TimeTrackingProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
