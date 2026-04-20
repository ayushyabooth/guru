import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { getAuthToken } from '../utils/auth';

export default function IndexScreen() {
  const [checked, setChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    getAuthToken()
      .then((token) => {
        setIsAuthenticated(!!token);
        setChecked(true);
      })
      .catch(() => {
        setChecked(true);
      });
  }, []);

  // On web, do a hard browser-level redirect once the auth check resolves.
  // Both router.replace() (GUR-166) and <Redirect> leave a blank screen at the
  // root route on the static export — the Expo Suspense fallback never hydrates
  // cleanly, so the React tree unmounts to an empty #root. A real window-level
  // navigation bypasses the navigator entirely.
  useEffect(() => {
    if (!checked) return;
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    window.location.replace(isAuthenticated ? '/catchup' : '/login');
  }, [checked, isAuthenticated]);

  // Native still uses <Redirect>; it works correctly on iOS/Android.
  if (checked && Platform.OS !== 'web') {
    return <Redirect href={isAuthenticated ? '/(tabs)' : '/(auth)/login'} />;
  }

  // Always render a visible loading screen — never unmount to null — so the
  // root route shows something while the redirect effect fires.
  return (
    <View style={styles.container}>
      <Text style={styles.loadingText}>Loading Guru...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0A0E17',
  },
  loadingText: {
    fontSize: 18,
    color: '#64748B',
    fontWeight: '500',
  },
});
