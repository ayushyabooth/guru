/**
 * Login Screen - Liquid Glass Design
 *
 * Features:
 * - Organic blob backgrounds in teal/purple/amber
 * - Frosted glass card for login form
 * - Glass-styled inputs
 * - Primary teal CTA button with glow
 * - Dark/light theme support
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { GlassCard, GlassInput, GlassButton, OrganicBackground } from '../../components/ui';
import GuruRings from '../../components/ui/GuruRings';
import {
  Spacing,
  Typography,
  BorderRadius,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min(380, width - 48);

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { isDark, colors } = useTheme();

  // Clear form fields on mount to prevent stale data
  useEffect(() => {
    setEmail('');
    setPassword('');
    setError('');
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Clear old tokens first
      try {
        await SecureStore.deleteItemAsync('access_token');
        await SecureStore.deleteItemAsync('refresh_token');
      } catch {
        // Fallback for web
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      }

      const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
      const fullUrl = `${apiUrl}/auth/login`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      let response: Response;
      try {
        response = await fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: controller.signal,
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          setError('Server is taking too long. Please try again.');
        } else {
          setError('Unable to connect. Check your internet connection.');
        }
        setLoading(false);
        return;
      }
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();

        // Store tokens
        let tokenStored = false;
        try {
          await SecureStore.setItemAsync('access_token', data.access_token);
          await SecureStore.setItemAsync('refresh_token', data.refresh_token);
          tokenStored = true;
        } catch {
          // SecureStore failed
        }

        if (!tokenStored && typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
        }

        // Navigate to main app
        try {
          router.replace('/(tabs)');
        } catch {
          if (typeof window !== 'undefined') {
            window.location.href = '/(tabs)';
          }
        }
      } else {
        const responseText = await response.text();

        let errorMessage = 'Invalid email or password';
        try {
          const errorData = JSON.parse(responseText);
          errorMessage = errorData.detail || errorMessage;
        } catch {
          if (response.status === 401) {
            errorMessage = 'Invalid email or password';
          } else if (response.status === 404) {
            errorMessage = 'Account not found';
          } else if (response.status >= 500) {
            errorMessage = 'Server error. Please try again.';
          }
        }
        setError(errorMessage);
      }
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Organic blob backgrounds */}
      <OrganicBackground variant="login" />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo + Brand Name - Horizontal Row */}
          <View style={styles.logoSection}>
            <View style={styles.brandRow}>
              <GuruRings size="logo" dimensions={88} />
              <Text style={[styles.brandName, { color: colors.textPrimary }]}>GURU</Text>
            </View>
          </View>

          {/* Login Card */}
          <GlassCard style={styles.card} variant="heavy">
            {/* Error Message */}
            {error ? (
              <View style={[styles.alertBox, { flexDirection: 'row', alignItems: 'center' }]}>
                <Text style={[styles.alertText, { color: colors.error, flex: 1 }]}>{error}</Text>
                <TouchableOpacity onPress={() => setError('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ color: colors.error, fontSize: 18, fontWeight: '700', marginLeft: 8 }}>{'\u00D7'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Email Input */}
            <GlassInput
              placeholder="Email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (error) setError('');
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              icon="email"
              accessibilityLabel="Email address"
              textContentType="emailAddress"
            />

            {/* Password Input */}
            <GlassInput
              placeholder="Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (error) setError('');
              }}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              icon="lock"
              accessibilityLabel="Password"
              textContentType="password"
            />

            {/* Forgot Password Link */}
            <Text
              style={styles.forgotPasswordText}
              onPress={() => {}}
            >
              Forgot Password?
            </Text>

            {/* Login Button */}
            <GlassButton
              title="Sign In"
              onPress={handleLogin}
              loading={loading}
              variant="primary"
              size="lg"
              accentColor="#6366F1"
              style={styles.loginButton}
            />

            {/* Create Account Link */}
            <Text
              style={[styles.createAccountText, { color: colors.textSecondary }, ...(Platform.OS === 'web' ? [{ cursor: 'pointer' } as any] : [])]}
              onPress={() => router.push('/(auth)/signup')}
            >
              Don't have an account? <Text style={{ color: '#6366F1', textDecorationLine: 'underline' }}>Sign up</Text>
            </Text>
          </GlassCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xxl,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  brandName: {
    fontFamily: 'Orbitron_700Bold',
    fontSize: 42,
    letterSpacing: 12,
  },
  card: {
    width: CARD_WIDTH,
    marginBottom: Spacing.md,
  },
  alertBox: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  alertText: {
    ...Typography.bodySmall,
    fontWeight: '500',
    textAlign: 'center',
  },
  forgotPasswordText: {
    color: '#6366F1',
    fontSize: 14,
    textAlign: 'right',
    marginTop: -8,
    marginBottom: 8,
    textDecorationLine: 'underline',
  },
  loginButton: {
    marginTop: Spacing.md,
  },
  createAccountText: {
    ...Typography.bodyMedium,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
