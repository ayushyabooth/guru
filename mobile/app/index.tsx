import { useEffect } from 'react';
import { router } from 'expo-router';
import { useRootNavigationState } from '@react-navigation/native';
import { View, Text, StyleSheet } from 'react-native';
import { getAuthToken } from '../utils/auth';

export default function IndexScreen() {
  // Wait for the navigation container to finish mounting before calling
  // router.replace(). Without this check, the replace() fires before the
  // Stack navigator is ready and gets silently dropped, leaving authed users
  // stuck on the loading screen — or bounced to /signup by a subsequent
  // re-render. (GUR-91)
  const rootNavState = useRootNavigationState();

  useEffect(() => {
    if (!rootNavState?.isReady) return;
    checkAuthStatus();
  }, [rootNavState?.isReady]);

  const checkAuthStatus = async () => {
    try {
      // Use getAuthToken() wrapper so web reads from localStorage and
      // native reads from SecureStore. Calling SecureStore directly on web
      // always returns null and wrongly redirects authed users to /signup.
      const token = await getAuthToken();

      if (token) {
        router.replace('/(tabs)');
      } else {
        router.replace('/(auth)/signup');
      }
    } catch (error) {
      router.replace('/(auth)/signup');
    }
  };

  // Show loading screen while checking auth
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
