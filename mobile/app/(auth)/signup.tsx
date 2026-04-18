/**
 * Signup Screen - Dark Glass Design
 *
 * Features:
 * - Matrix background with ambient glow orbs
 * - Frosted glass card for signup form
 * - Glass-styled inputs with icons
 * - Primary CTA button with glow
 * - Dark-only mode
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

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { colors } = useTheme();

  // Clear form fields on mount to prevent stale data
  useEffect(() => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setInviteCode('');
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const handleSignup = async () => {
    setStatus('idle');
    setErrorMessage('');

    if (!email || !password || !confirmPassword || !inviteCode) {
      setStatus('error');
      setErrorMessage('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setStatus('error');
      setErrorMessage('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setStatus('error');
      setErrorMessage('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setStatus('idle');

    try {
      const apiUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';
      const fullUrl = `${apiUrl}/auth/signup`;

      const response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, invite_code: inviteCode }),
      });

      if (response.ok) {
        const data = await response.json();

        try {
          await SecureStore.setItemAsync('access_token', data.access_token);
          await SecureStore.setItemAsync('refresh_token', data.refresh_token);
        } catch {
          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
        }

        setStatus('success');

        setTimeout(() => {
          router.replace('/(auth)/onboarding/industry');
        }, 1500);
      } else {
        const responseText = await response.text();

        try {
          const errorData = JSON.parse(responseText);
          setStatus('error');

          if (errorData.detail === 'Email already registered') {
            setErrorMessage('This email is already registered');
          } else {
            setErrorMessage(errorData.detail || 'Failed to create account');
          }
        } catch {
          setStatus('error');
          setErrorMessage('Something went wrong. Please try again.');
        }
      }
    } catch {
      setStatus('error');
      setErrorMessage('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Background */}
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
              <GuruRings size="logo" dimensions={88} accessibilityLabel="Guru logo" />
              <Text accessibilityRole="header" style={[styles.brandName, { color: colors.textPrimary }]}>GURU</Text>
            </View>
          </View>

          {/* Signup Card */}
          <GlassCard style={styles.card} variant="heavy">
            {/* Status Message */}
            {status !== 'idle' && (
              <View style={[
                styles.alertBox,
                status === 'error' ? styles.alertError : styles.alertSuccess
              ]}>
                <Text
                  role="alert"
                  accessibilityLiveRegion="assertive"
                  style={[
                    styles.alertText,
                    { color: status === 'error' ? colors.error : colors.success }
                  ]}
                >
                  {status === 'success' ? 'Account created!' : errorMessage}
                </Text>
              </View>
            )}

            {/* Email Input */}
            <GlassInput
              placeholder="Email"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (status === 'error') setStatus('idle');
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
                if (status === 'error') setStatus('idle');
              }}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              icon="lock"
              accessibilityLabel="Password"
              textContentType="newPassword"
            />

            {/* Confirm Password Input */}
            <GlassInput
              placeholder="Confirm password"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (status === 'error') setStatus('idle');
              }}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              icon="lock"
              accessibilityLabel="Confirm password"
              textContentType="newPassword"
            />

            {/* Invite Code Input */}
            <GlassInput
              placeholder="Invite Code"
              value={inviteCode}
              onChangeText={(text) => {
                setInviteCode(text);
                if (status === 'error') setStatus('idle');
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="one-time-code"
              icon="key"
              accessibilityLabel="Invite code"
            />

            {/* Signup Button */}
            <GlassButton
              title={status === 'success' ? 'Redirecting...' : 'Sign Up'}
              onPress={handleSignup}
              loading={loading}
              disabled={status === 'success'}
              variant="primary"
              size="lg"
              accentColor="#6366F1"
              style={styles.signupButton}
            />

            {/* Sign In Link */}
            <Text
              style={[styles.signInText, { color: colors.textSecondary }, ...(Platform.OS === 'web' ? [{ cursor: 'pointer' } as any] : [])]}
              onPress={() => router.push('/(auth)/login')}
            >
              Already have an account? <Text style={{ color: '#6366F1', textDecorationLine: 'underline' }}>Sign in</Text>
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
  },
  alertError: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  alertSuccess: {
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
  },
  alertText: {
    ...Typography.bodySmall,
    fontWeight: '500',
    textAlign: 'center',
  },
  signupButton: {
    marginTop: Spacing.md,
  },
  signInText: {
    ...Typography.bodyMedium,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
