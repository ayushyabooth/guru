import { useEffect } from 'react';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { View, Text, StyleSheet } from 'react-native';

export default function IndexScreen() {
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = await SecureStore.getItemAsync('access_token');
      
      if (token) {
        // User is authenticated, redirect to main app
        router.replace('/(tabs)');
      } else {
        // User is not authenticated, redirect to signup
        router.replace('/(auth)/signup');
      }
    } catch (error) {
      // Default to signup if there's an error
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
