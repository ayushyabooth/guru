/**
 * InterestsEditor — Settings → "Interests & specializations" (GUR-235)
 *
 * A dedicated, theme-aware editor (presented as a page sheet from the Home
 * Settings sheet). Lets the user edit their specializations (cap 2) and
 * additional interests (cap relaxed 2 → 4). Core field is read-only.
 *
 * Save → PATCH /me/interests (preserves core/goals, fires storyboard warming),
 * then invalidates the profile cache + catch-up/dive-in feed queries so the new
 * tabs + feeds flow downstream immediately. Agent reads the profile fresh per
 * turn, so its personalization updates automatically.
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, ActivityIndicator, Platform,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../../constants/config';
import { getAuthToken } from '../../utils/auth';
import { userService } from '../../services/user-service';
import { useTheme } from '../../contexts/ThemeContext';
import Icon from '../ui/Icon';

const TEAL = '#0D9488';   // specializations accent (matches onboarding)
const PINK = '#EC4899';   // interests accent (matches onboarding)
const MAX_SPECIALIZATIONS = 2;
const MAX_INTERESTS = 4;

interface Industry { id: string; name: string; emoji?: string; description?: string; }
interface Specialization { id: string; name: string; description?: string; }

interface Props { onClose: () => void; onSaved: () => void; }

export default function InterestsEditor({ onClose, onSaved }: Props) {
  const { isDark, colors } = useTheme();
  const queryClient = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [curating, setCurating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [coreName, setCoreName] = useState('');
  const [interestOptions, setInterestOptions] = useState<Industry[]>([]);
  const [specOptions, setSpecOptions] = useState<Specialization[]>([]);
  const [selInterests, setSelInterests] = useState<Set<string>>(new Set());
  const [selSpecs, setSelSpecs] = useState<Set<string>>(new Set());

  const t = isDark
    ? { surface: '#0B0F1A', card: 'rgba(255,255,255,0.06)', cardBorder: 'rgba(255,255,255,0.10)',
        footer: 'rgba(12,17,28,0.96)', divider: 'rgba(255,255,255,0.08)' }
    : { surface: '#F8FAFC', card: 'rgba(255,255,255,0.92)', cardBorder: 'rgba(15,23,42,0.08)',
        footer: 'rgba(248,250,252,0.96)', divider: 'rgba(15,23,42,0.08)' };

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setError(null);
      const token = await getAuthToken();
      const headers = { Authorization: `Bearer ${token}` } as any;
      const [profile, indRes] = await Promise.all([
        userService.getUserProfile(),
        fetch(`${API_BASE_URL}/config/industries`, { headers }),
      ]);
      const industries: Industry[] = indRes.ok ? await indRes.json() : [];

      const coreDisplay = profile.core_industry_display || profile.core_industry || '';
      setCoreName(coreDisplay);
      const core = industries.find(i => i.name === coreDisplay || i.id === profile.core_industry);
      const coreId = core?.id;

      // Interests = all industries except the core field.
      setInterestOptions(industries.filter(i => i.id !== coreId));
      const interestNames = new Set([
        ...(profile.additional_interest_industries_display || []),
        ...(profile.additional_interest_industries || []),
      ]);
      setSelInterests(new Set(industries.filter(i => interestNames.has(i.name)).map(i => i.id)));

      if (coreId) {
        const sRes = await fetch(`${API_BASE_URL}/config/industries/${coreId}/specializations`, { headers });
        const specs: Specialization[] = sRes.ok ? await sRes.json() : [];
        setSpecOptions(specs);
        const specNames = new Set([
          ...(profile.specializations_display || []),
          ...(profile.specializations || []),
        ]);
        setSelSpecs(new Set(specs.filter(s => specNames.has(s.name)).map(s => s.id)));
      }
      setLoading(false);
    } catch (e) {
      setError('Couldn’t load your topics. Please try again.');
      setLoading(false);
    }
  };

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string, cap: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else { if (next.size >= cap) return; next.add(id); }
    setSet(next);
  };

  const handleSave = async () => {
    setSaving(true); setError(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE_URL}/me/interests`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specializations: [...selSpecs],
          additional_interest_industries: [...selInterests],
        }),
      });
      if (!res.ok) {
        let m = `Couldn’t save (HTTP ${res.status})`;
        try { const b = await res.json(); if (typeof b?.detail === 'string') m = b.detail; else if (Array.isArray(b?.detail) && b.detail[0]?.msg) m = b.detail[0].msg; } catch {}
        throw new Error(m);
      }
      // Flow downstream: fresh profile (rebuilds tabs) + refetch the feeds.
      userService.invalidateProfileCache();
      queryClient.invalidateQueries({ queryKey: ['catchup-feed'] });
      queryClient.invalidateQueries({ queryKey: ['divein-feed'] });
      setCurating(true);
      setTimeout(() => onSaved(), 1100);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save your changes');
      setSaving(false);
    }
  };

  const card = (
    key: string, accent: string, name: string, desc: string | undefined,
    emoji: string | undefined, selected: boolean, atCap: boolean, onPress: () => void,
  ) => (
    <TouchableOpacity
      key={key}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={!selected && atCap}
      style={[
        styles.card,
        { backgroundColor: selected ? `${accent}28` : t.card, borderColor: selected ? accent : t.cardBorder },
        !selected && atCap && { opacity: 0.4 },
      ]}
    >
      <View style={[styles.emoji, { backgroundColor: selected ? `${accent}33` : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)') }]}>
        <Text style={{ fontSize: 20 }}>{emoji || '◆'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: selected ? accent : colors.textPrimary }]} numberOfLines={1}>{name}</Text>
        {!!desc && <Text style={[styles.cardDesc, { color: colors.textSecondary }]} numberOfLines={1}>{desc}</Text>}
      </View>
      <View style={[styles.check, selected ? { backgroundColor: accent, borderColor: accent } : { borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.2)' }]}>
        {selected && <Text style={styles.checkMark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );

  const sectionHeader = (label: string, count: number, cap: number, accent: string, sub: string) => (
    <View style={{ gap: 6 }}>
      <View style={styles.sectionRow}>
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{label}</Text>
        <View style={[styles.badge, { backgroundColor: `${accent}24` }]}>
          <Text style={[styles.badgeText, { color: accent }]}>{count}/{cap} selected</Text>
        </View>
      </View>
      <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>{sub}</Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.surface }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: t.divider }]}>
        <TouchableOpacity onPress={onClose} disabled={saving} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.headerAction, { color: colors.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]} numberOfLines={1}>Interests & specializations</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving || loading} accessibilityRole="button" accessibilityLabel="Save changes">
          {saving ? <ActivityIndicator size="small" color={PINK} /> : <Text style={[styles.headerAction, { color: PINK, fontWeight: '700' }]}>Save</Text>}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={PINK} /></View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }} showsVerticalScrollIndicator={false}>
          {/* Core field — read-only context */}
          <View style={[styles.coreChip, { backgroundColor: t.card, borderColor: t.cardBorder }]}>
            <View style={[styles.emoji, { backgroundColor: 'rgba(56,189,248,0.16)' }]}><Text style={{ fontSize: 18 }}>🛡️</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.coreLabel, { color: colors.textSecondary }]}>Your field</Text>
              <Text style={[styles.coreName, { color: colors.textPrimary }]}>{coreName || '—'}</Text>
            </View>
            <Text style={styles.coreTag}>Core</Text>
          </View>

          {/* Specializations */}
          <View style={{ gap: 12 }}>
            {sectionHeader('Specializations', selSpecs.size, MAX_SPECIALIZATIONS, TEAL, `Sub-topics inside ${coreName || 'your field'}.`)}
            {specOptions.map(s => card(
              s.id, TEAL, s.name, s.description, undefined,
              selSpecs.has(s.id), selSpecs.size >= MAX_SPECIALIZATIONS,
              () => toggle(selSpecs, setSelSpecs, s.id, MAX_SPECIALIZATIONS),
            ))}
          </View>

          {/* Interests */}
          <View style={{ gap: 12 }}>
            {sectionHeader('Interests', selInterests.size, MAX_INTERESTS, PINK, 'Up to 4 industries beyond your field.')}
            {interestOptions.map(i => card(
              i.id, PINK, i.name, i.description, i.emoji,
              selInterests.has(i.id), selInterests.size >= MAX_INTERESTS,
              () => toggle(selInterests, setSelInterests, i.id, MAX_INTERESTS),
            ))}
          </View>
        </ScrollView>
      )}

      {/* Curating overlay (post-save) */}
      {curating && (
        <View style={styles.curatingOverlay}>
          <View style={[styles.curatingCard, { backgroundColor: isDark ? '#12182A' : '#FFFFFF', borderColor: `${PINK}55` }]}>
            <ActivityIndicator size="small" color={PINK} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.curatingTitle, { color: colors.textPrimary }]}>Curating your feed…</Text>
              <Text style={[styles.curatingSub, { color: colors.textSecondary }]}>New topics will appear across Catch-up & Dive-in shortly.</Text>
            </View>
          </View>
        </View>
      )}

      {/* Footer */}
      {!loading && (
        <View style={[styles.footer, { backgroundColor: t.footer, borderTopColor: t.divider }]}>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity onPress={handleSave} disabled={saving} style={[styles.saveBtn, { backgroundColor: PINK }, saving && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Save changes">
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>Save changes</Text>}
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  headerAction: { fontSize: 15, fontWeight: '500' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coreChip: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
  coreLabel: { fontSize: 11.5, fontWeight: '600' },
  coreName: { fontSize: 15, fontWeight: '700', marginTop: 1 },
  coreTag: { fontSize: 11.5, fontWeight: '600', color: '#38BDF8' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionSub: { fontSize: 12.5 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 11.5, fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 18, borderWidth: 1.5 },
  emoji: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15.5, fontWeight: '600' },
  cardDesc: { fontSize: 12.5, marginTop: 2 },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'web' ? 20 : 28, borderTopWidth: 1, gap: 10 },
  saveBtn: { paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  error: { color: '#EF4444', fontSize: 13, textAlign: 'center' },
  curatingOverlay: { position: 'absolute', left: 0, right: 0, bottom: 96, paddingHorizontal: 20, alignItems: 'center' },
  curatingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, maxWidth: 460, width: '100%' },
  curatingTitle: { fontSize: 14.5, fontWeight: '700' },
  curatingSub: { fontSize: 12, marginTop: 2 },
});
