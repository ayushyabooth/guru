import { useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { getAuthToken } from '../utils/auth';

export default function IndexScreen() {
  useEffect(() => {
    // expo-router's router.replace() queues navigation actions internally
    // until the navigator is ready, so no manual "isReady" guard is needed.
    // Previously we imported useRootNavigationState from @react-navigation/native
    // which was removed in v7 — calling undefined() crashed every render. (GUR-91)
    getAuthToken()
      .then((token) => {
        if (token) {
          router.replace('/(tabs)');
        } else {
          router.replace('/(auth)/signup');
        }
      })
      .catch(() => {
        router.replace('/(auth)/signup');
      });
  }, []);

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
