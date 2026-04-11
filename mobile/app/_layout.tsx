import { Platform } from 'react-native';
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
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DiveInProvider } from '../contexts/DiveInContext';
import { TimeTrackingProvider } from '../contexts/TimeTrackingContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { loadVisualConfigFromAPI } from '../constants/industryConfig';
import ThemeAwareNav from '../components/ThemeAwareNav';

const queryClient = new QueryClient({
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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Orbitron_400Regular,
    Orbitron_700Bold,
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

  // No web font fix needed — Expo bundles the .ttf files in the static export.
  // The vercel.json rewrite must exclude asset paths to let fonts load correctly.

  // On web static export, fonts may not trigger the loaded callback.
  // Don't block rendering — the app works fine with fallback system fonts.
  if (!fontsLoaded && Platform.OS !== 'web') {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TimeTrackingProvider>
          <DiveInProvider userId="default">
            <ThemeAwareNav />
          </DiveInProvider>
        </TimeTrackingProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
