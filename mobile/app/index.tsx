import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
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

  // Use <Redirect> (rendered synchronously) rather than router.replace() in an
  // effect — the latter can be dropped on web before the navigator is mounted,
  // leaving a blank white screen. (GUR-166)
  if (checked) {
    return <Redirect href={isAuthenticated ? '/(tabs)' : '/(auth)/login'} />;
  }

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
