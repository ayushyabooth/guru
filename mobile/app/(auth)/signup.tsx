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
  TouchableOpacity,
} from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../../constants/config';
import { Sun, Moon } from 'phosphor-react-native';
import { GlassCard, GlassInput, GlassButton, OrganicBackground } from '../../components/ui';
import GuruWordmark from '../../components/ui/GuruWordmark';
import {
  Spacing,
  Typography,
  BorderRadius,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');
const CARD_WIDTH = Math.min(380, width - 48);

/**
 * Coerce an API error `detail` into a single display string. FastAPI returns a
 * string for our own HTTPExceptions, but a 422 returns an array of Pydantic
 * error objects ({ type, loc, msg, input }). Rendering that object/array as a
 * React child throws React error #31 and takes down the whole screen, so we
 * always flatten it to a string here.
 */
function extractErrorMessage(detail: unknown): string {
  if (!detail) return 'Failed to create account';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && 'msg' in d ? String((d as any).msg) : ''))
      .filter(Boolean);
    return msgs.join('. ') || 'Please check your details and try again.';
  }
  if (typeof detail === 'object' && detail !== null && 'msg' in detail) {
    return String((detail as any).msg);
  }
  return 'Failed to create account';
}

export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const { isDark, colors, toggleTheme } = useTheme();

  // Clear form fields on mount to prevent stale data
  useEffect(() => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const handleSignup = async () => {
    setStatus('idle');
    setErrorMessage('');

    if (!email || !password || !confirmPassword) {
      setStatus('error');
      setErrorMessage('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      setStatus('error');
      setErrorMessage('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setStatus('error');
      setErrorMessage('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setStatus('idle');

    try {
      const fullUrl = `${API_BASE_URL}/auth/signup`;

      // GUR-229 hardening: a backend redeploy window can refuse the first
      // connection — retry once after a short pause before declaring failure,
      // so a brand-new user's very first action doesn't die on a blip.
      const post = () =>
        fetch(fullUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
      let response: Response;
      try {
        response = await post();
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
        response = await post();
      }

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

          // `detail` may be a string (our own errors) OR, on a 422, a Pydantic
          // array of { type, loc, msg, input } objects. Always coerce to a
          // string — setting state to an object/array crashes the whole app
          // with React error #31 ("objects are not valid as a React child").
          const msg = extractErrorMessage(errorData.detail);
          setErrorMessage(
            msg === 'Email already registered' ? 'This email is already registered' : msg,
          );
        } catch {
          setStatus('error');
          setErrorMessage('Something went wrong. Please try again.');
        }
      }
    } catch {
      setStatus('error');
      setErrorMessage("Couldn't reach Guru — please try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Background */}
      <OrganicBackground variant="login" />

      {/* Theme Toggle */}
      <TouchableOpacity
        style={styles.themeToggle}
        onPress={toggleTheme}
        accessibilityRole="button"
        accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        {isDark ? (
          <Sun size={22} weight="fill" color="rgba(255,255,255,0.7)" />
        ) : (
          <Moon size={22} weight="fill" color="rgba(0,0,0,0.6)" />
        )}
      </TouchableOpacity>

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
              {/* THE signature, hero-sized — a first-time user's first sight of the
                  living organism (GUR-228 R18): "guru" with the creature as the
                  full stop, gently alive. */}
              <GuruWordmark size={46} color={colors.textPrimary} />
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
            <TouchableOpacity
              onPress={() => router.push('/(auth)/login')}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="link"
              accessibilityLabel="Already have an account? Sign in"
            >
              <Text style={[styles.signInText, { color: colors.textSecondary }]}>
                Already have an account? <Text style={{ color: '#6366F1', textDecorationLine: 'underline' }}>Sign in</Text>
              </Text>
            </TouchableOpacity>
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
  themeToggle: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(128,128,128,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
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
