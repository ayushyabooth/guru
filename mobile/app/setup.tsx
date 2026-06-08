import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../contexts/ThemeContext';
import { useExtensionInstalled, isChromiumBrowser } from '../hooks/useExtensionInstalled';
import {
  EXTENSION_NAME,
  EXTENSION_WEBSTORE_URL,
  EXTENSION_DOWNLOAD_URL,
  isExtensionPublished,
} from '../constants/extension';

export default function SetupScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const status = useExtensionInstalled();
  const published = isExtensionPublished();

  const bg = isDark ? '#0A0E17' : '#F8FAFC';
  const cardBg = isDark ? 'rgba(255,255,255,0.05)' : '#FFFFFF';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.08)';
  const title = isDark ? '#F1F5F9' : '#0F172A';
  const body = isDark ? '#CBD5E1' : '#334155';
  const muted = isDark ? '#94A3B8' : '#64748B';
  const accent = '#6366F1';

  const card = {
    backgroundColor: cardBg, borderColor: border, borderWidth: 1,
    borderRadius: 18, padding: 18, marginBottom: 14,
  } as const;

  const unpackedSteps = [
    { t: `Download ${EXTENSION_NAME}`, d: 'Grab the extension zip and unzip it somewhere you’ll keep it.' },
    { t: 'Open chrome://extensions', d: 'Copy that into a new Chrome tab and press Enter (links to it aren’t allowed).' },
    { t: 'Turn on Developer mode', d: 'Toggle it on — top-right of the Extensions page.' },
    { t: 'Click "Load unpacked"', d: 'Top-left — then select the unzipped folder.' },
    { t: 'Pin Guru & open any article', d: 'Click the puzzle icon, pin Guru, then visit a news article — the Guru button appears bottom-right.' },
  ];
  const storeSteps = [
    { t: `Add ${EXTENSION_NAME} to Chrome`, d: 'One click from the Chrome Web Store.' },
    { t: 'Pin it', d: 'Click the puzzle icon in Chrome’s toolbar and pin Guru so it’s always handy.' },
    { t: 'Open any article', d: 'Visit a news article — the Guru button appears bottom-right.' },
  ];
  const steps = published ? storeSteps : unpackedSteps;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={{ padding: 18, paddingTop: 56, maxWidth: 680, alignSelf: 'center', width: '100%' }}>
      <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={{ marginBottom: 14 }}>
        <Text style={{ color: accent, fontSize: 15, fontWeight: '600' }}>‹ Back</Text>
      </TouchableOpacity>

      {/* Hero */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <View style={{ width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(99,102,241,0.22)' : 'rgba(99,102,241,0.12)' }}>
          <Text style={{ fontSize: 30 }}>🧩</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: title, fontSize: 24, fontWeight: '800' }}>The Guru browser extension</Text>
          <Text style={{ color: muted, fontSize: 13.5, marginTop: 2 }}>Guru insights, right on the article you’re reading.</Text>
        </View>
      </View>

      {/* Status */}
      {status === 'installed' && (
        <View style={[card, { backgroundColor: isDark ? 'rgba(16,185,129,0.14)' : 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.4)' }]}>
          <Text style={{ color: isDark ? '#6EE7B7' : '#047857', fontWeight: '700', fontSize: 15 }}>✓ You’re all set</Text>
          <Text style={{ color: body, fontSize: 13.5, marginTop: 4 }}>The Guru extension is installed. Open any news article and tap the Guru button (bottom-right) to highlight, ask questions, and see insights.</Text>
        </View>
      )}
      {status === 'not-installed' && !isChromiumBrowser() && (
        <View style={[card, { backgroundColor: isDark ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.4)' }]}>
          <Text style={{ color: isDark ? '#FCD34D' : '#92400E', fontWeight: '700', fontSize: 14 }}>This browser isn’t supported yet</Text>
          <Text style={{ color: body, fontSize: 13.5, marginTop: 4 }}>The Guru extension runs on Chrome (and other Chromium browsers like Edge, Brave, Arc). Open this page in one of those to install it.</Text>
        </View>
      )}

      {/* What it does */}
      <View style={card}>
        <Text style={{ color: title, fontSize: 16, fontWeight: '700', marginBottom: 10 }}>What it does</Text>
        {[
          ['✍️', 'Highlight & take notes', 'Select text on any article to highlight it and jot notes — they sync to your Guru account.'],
          ['💬', 'Ask Guru in context', 'Open the panel to ask questions about what you’re reading and get Socratic, no-fluff answers.'],
          ['💡', 'Insights & spotlight quotes', 'See what’s in the article, why it matters, and the lines worth a second look.'],
        ].map(([icon, h, d], i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: i < 2 ? 12 : 0 }}>
            <Text style={{ fontSize: 18 }}>{icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: title, fontWeight: '600', fontSize: 14 }}>{h}</Text>
              <Text style={{ color: muted, fontSize: 13, lineHeight: 18, marginTop: 1 }}>{d}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Install */}
      {status !== 'installed' && (
        <View style={card}>
          <Text style={{ color: title, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
            {published ? 'Install it' : 'Install it (beta)'}
          </Text>
          {!published && (
            <Text style={{ color: muted, fontSize: 12.5, marginBottom: 12 }}>
              We’re finishing the Chrome Web Store listing. For now it installs as an unpacked extension — a few extra steps, one time.
            </Text>
          )}

          {/* Primary CTA */}
          <TouchableOpacity
            onPress={() => {
              const url = published ? EXTENSION_WEBSTORE_URL : EXTENSION_DOWNLOAD_URL;
              if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
              else Linking.openURL(url);
            }}
            accessibilityRole="button"
            style={{ backgroundColor: accent, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 16 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {published ? 'Add to Chrome ↗' : 'Download the extension ↓'}
            </Text>
          </TouchableOpacity>

          {steps.map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: i < steps.length - 1 ? 12 : 0 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: accent, fontWeight: '700', fontSize: 12 }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: title, fontWeight: '600', fontSize: 14 }}>{s.t}</Text>
                <Text style={{ color: muted, fontSize: 13, lineHeight: 18, marginTop: 1 }}>{s.d}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <Text style={{ color: muted, fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>
        The extension reads the article you’re on to generate insights and syncs your highlights to your Guru account. It never runs on pages you don’t open Guru on.
      </Text>
    </ScrollView>
  );
}
