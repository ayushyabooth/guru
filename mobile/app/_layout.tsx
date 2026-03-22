import { Platform, LogBox } from 'react-native';
import { DarkTheme as NavDarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

// Suppress noisy "Unexpected text node" warnings from React Native Web
// These are caused by whitespace between JSX elements inside View components
// and don't affect functionality.
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

import { useColorScheme } from '@/hooks/use-color-scheme';
import { DiveInProvider } from '../contexts/DiveInContext';
import { TimeTrackingProvider } from '../contexts/TimeTrackingContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { loadVisualConfigFromAPI } from '../constants/industryConfig';

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
  const colorScheme = useColorScheme();

  const [fontsLoaded] = useFonts({
    Orbitron_400Regular,
    Orbitron_700Bold,
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

  // Load Orbitron font via Google Fonts CSS on web (Expo useFonts hook doesn't work on static export)
  // Also alias Expo font names (Orbitron_400Regular) to CSS font-family (Orbitron)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const link = document.createElement('link');
      link.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap';
      link.rel = 'stylesheet';
      document.head.appendChild(link);

      // Map Expo font names to Google Fonts CSS names
      const style = document.createElement('style');
      style.textContent = `
        @font-face { font-family: 'Orbitron_400Regular'; src: local('Orbitron'); font-weight: 400; }
        @font-face { font-family: 'Orbitron_700Bold'; src: local('Orbitron'); font-weight: 700; }
      `;
      document.head.appendChild(style);
    }
  }, []);

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
            <NavThemeProvider value={NavDarkTheme}>
              <Stack>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="article/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
              </Stack>
              <StatusBar style="light" />
            </NavThemeProvider>
          </DiveInProvider>
        </TimeTrackingProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
