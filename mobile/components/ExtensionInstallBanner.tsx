import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useExtensionInstalled, isChromiumBrowser } from '../hooks/useExtensionInstalled';
import { useTheme } from '../contexts/ThemeContext';

const DISMISS_KEY = 'guru_ext_banner_dismissed';

/**
 * Dismissible onboarding banner shown on web (Chromium only) when the Guru
 * extension isn't installed (GUR-227). Routes to /setup for the install flow.
 * Renders nothing on native, non-Chromium browsers, when installed, or once
 * dismissed (persisted in localStorage).
 */
export default function ExtensionInstallBanner() {
  const router = useRouter();
  const { isDark } = useTheme();
  const status = useExtensionInstalled();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return false;
    return localStorage.getItem(DISMISS_KEY) === '1';
  });

  if (Platform.OS !== 'web' || !isChromiumBrowser()) return null;
  if (status !== 'not-installed' || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setDismissed(true);
  };

  const accent = '#6366F1';
  const cardBg = isDark ? 'rgba(99,102,241,0.14)' : 'rgba(99,102,241,0.08)';
  const border = isDark ? 'rgba(129,140,248,0.40)' : 'rgba(99,102,241,0.30)';
  const titleColor = isDark ? '#E2E8F0' : '#1E293B';
  const subColor = isDark ? '#94A3B8' : '#475569';

  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 14,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: cardBg,
        },
        Platform.OS === 'web'
          ? ({
              backdropFilter: 'blur(16px) saturate(160%)',
              WebkitBackdropFilter: 'blur(16px) saturate(160%)',
              boxShadow: '0 4px 20px rgba(99,102,241,0.18), inset 0 1px 0 rgba(255,255,255,0.10)',
            } as any)
          : {},
      ]}
      accessibilityRole="alert"
    >
      <View
        style={{
          width: 38, height: 38, borderRadius: 11,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.15)',
        }}
      >
        <Text style={{ fontSize: 20 }}>🧩</Text>
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: titleColor, fontWeight: '700', fontSize: 14, marginBottom: 2 }}>
          Get the full Guru experience
        </Text>
        <Text style={{ color: subColor, fontSize: 12.5, lineHeight: 17 }}>
          Add the browser extension to highlight, ask Guru, and see insights right on any article.
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => router.push('/setup')}
        accessibilityRole="button"
        accessibilityLabel="Set up the Guru extension"
        style={{
          paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12,
          backgroundColor: accent,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Set it up →</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{ paddingHorizontal: 4 }}
      >
        <Text style={{ color: subColor, fontSize: 18, fontWeight: '600' }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}
