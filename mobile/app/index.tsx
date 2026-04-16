import { useEffect } from 'react';
import { router } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { getAuthToken } from '../utils/auth';

export default function IndexScreen() {
  useEffect(() => {
    checkAuthStatus();
  }, []);

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
