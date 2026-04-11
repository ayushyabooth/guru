import React, { useEffect } from 'react';
import { View, Platform } from 'react-native';
import { DarkTheme as NavDarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../contexts/ThemeContext';

const webShell: any = Platform.OS === 'web'
  ? { flex: 1, maxWidth: 480, width: '100%', alignSelf: 'center' as const }
  : { flex: 1 };

export default function ThemeAwareNav() {
  const { isDark } = useTheme();

  // Set the HTML body background to match theme — prevents white gutters on desktop
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = isDark ? '#0A0E17' : '#F8FAFC';
      document.body.style.margin = '0';
      document.documentElement.style.backgroundColor = isDark ? '#0A0E17' : '#F8FAFC';
    }
  }, [isDark]);

  return (
    <NavThemeProvider value={isDark ? NavDarkTheme : DefaultTheme}>
      <View style={webShell}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="article/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
      </View>
      <StatusBar style={isDark ? 'light' : 'dark'} />
    </NavThemeProvider>
  );
}
