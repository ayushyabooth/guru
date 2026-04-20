import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import type { ScriptSegment } from '../../services/recap-service';

interface TextPodcastStageProps {
  script: ScriptSegment[];
  isLoading?: boolean;
  error?: string | null;
  onFinish: () => void;
  onDismiss: () => void;
}

const STICKY_THRESHOLD = 180;

export default function TextPodcastStage({
  script,
  isLoading = false,
  error = null,
  onFinish,
  onDismiss,
}: TextPodcastStageProps) {
  const { isDark } = useTheme();
  const [stickyVisible, setStickyVisible] = useState(false);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  // Pulse loading indicator
  useEffect(() => {
    if (!isLoading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isLoading, pulseAnim]);

  // Theme-aware tokens
  const screenBg = isDark ? '#0A0E17' : '#F8FAFC';
  const cardBg = isDark ? 'rgba(15,20,35,0.42)' : 'rgba(255,255,255,0.82)';
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.07)';
  const bodyTextColor = isDark ? 'rgba(255,255,255,0.82)' : 'rgba(15,23,42,0.80)';
  const subtitleColor = isDark ? 'rgba(255,255,255,0.40)' : 'rgba(15,23,42,0.50)';
  const narratorLabelColor = isDark ? '#38BDF8' : '#0284C7';
  const analystLabelColor = isDark ? '#FB923C' : '#EA580C';

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const next = y > STICKY_THRESHOLD;
    if (next !== stickyVisible) setStickyVisible(next);
  };

  // ── Loading state ───────────────────────────────────────────
  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: screenBg }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: RingColors.recap.light }]}>
            Your Weekly Recap
          </Text>
          <TouchableOpacity style={styles.donePill} onPress={onDismiss}>
            <Text style={[styles.doneText, { color: RingColors.recap.light }]}>Done</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Animated.View
            style={[
              styles.loadingDot,
              { opacity: pulseAnim, backgroundColor: RingColors.recap.primary },
            ]}
          />
          <Text style={[styles.loadingLabel, { color: subtitleColor }]}>
            Generating your recap...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ─────────────────────────────────────────────
  if (error || script.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: screenBg }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: RingColors.recap.light }]}>
            Your Weekly Recap
          </Text>
          <TouchableOpacity style={styles.donePill} onPress={onDismiss}>
            <Text style={[styles.doneText, { color: RingColors.recap.light }]}>Done</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Text style={[styles.errorTitle, { color: bodyTextColor }]}>
            We couldn't generate your conversation this week.
          </Text>
          {error ? (
            <Text style={[styles.errorSubtitle, { color: subtitleColor }]}>
              {error}
            </Text>
          ) : null}
        </View>
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.finishButton}
            onPress={onFinish}
            activeOpacity={0.85}
          >
            <Text style={styles.finishButtonText}>Finish Recap ✓</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loaded state ────────────────────────────────────────────
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: screenBg }]}>
      {stickyVisible && (
        <View
          style={[
            styles.stickyHeader,
            {
              backgroundColor: screenBg,
              borderBottomColor: cardBorder,
            },
          ]}
        >
          <View style={styles.stickyDotsRow}>
            <View style={[styles.stickyDot, { backgroundColor: '#38BDF8' }]} />
            <Text style={[styles.stickyLetter, { color: narratorLabelColor }]}>N</Text>
            <View
              style={[
                styles.stickyDot,
                { backgroundColor: '#FB923C', marginLeft: 12 },
              ]}
            />
            <Text style={[styles.stickyLetter, { color: analystLabelColor }]}>A</Text>
          </View>
          <Text style={[styles.stickyTitle, { color: RingColors.recap.light }]}>
            Your Weekly Recap
          </Text>
          <TouchableOpacity style={styles.donePill} onPress={onDismiss}>
            <Text style={[styles.doneText, { color: RingColors.recap.light }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: RingColors.recap.light }]}>
            Your Weekly Recap
          </Text>
          <TouchableOpacity style={styles.donePill} onPress={onDismiss}>
            <Text style={[styles.doneText, { color: RingColors.recap.light }]}>
              Done
            </Text>
          </TouchableOpacity>
        </View>

        {/* Host orbs */}
        <View style={styles.orbsRow}>
          <View
            style={[
              styles.orb,
              {
                backgroundColor: 'rgba(56,189,248,0.12)',
                borderColor: '#38BDF8',
              },
            ]}
          >
            <Text style={[styles.orbLetter, { color: '#38BDF8' }]}>N</Text>
          </View>
          <View
            style={[
              styles.orb,
              {
                backgroundColor: 'rgba(148,163,184,0.10)',
                borderColor: '#FB923C',
              },
            ]}
          >
            <Text style={[styles.orbLetter, { color: '#FB923C' }]}>A</Text>
          </View>
        </View>

        <Text style={[styles.subtitle, { color: subtitleColor }]}>
          A conversation about your week's learning journey
        </Text>

        <View style={styles.segmentList}>
          {script.map((seg, i) => {
            const isNarrator = seg.speaker === 'narrator';
            const speakerLabelColor = isNarrator
              ? narratorLabelColor
              : analystLabelColor;
            const dotColor = isNarrator ? '#38BDF8' : '#FB923C';
            return (
              <View
                key={i}
                style={[
                  styles.segmentCard,
                  { backgroundColor: cardBg, borderColor: cardBorder },
                ]}
              >
                <View style={styles.speakerRow}>
                  <View
                    style={[styles.speakerDot, { backgroundColor: dotColor }]}
                  />
                  <Text
                    style={[styles.speakerLabel, { color: speakerLabelColor }]}
                  >
                    {isNarrator ? 'Narrator' : 'Analyst'}
                  </Text>
                </View>
                <Text style={[styles.segmentBody, { color: bodyTextColor }]}>
                  {seg.text}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: screenBg }]}>
        <TouchableOpacity
          style={styles.finishButton}
          onPress={onFinish}
          activeOpacity={0.85}
        >
          <Text style={styles.finishButtonText}>Finish Recap ✓</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: 140,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xl,
  },
  headerTitle: {
    ...Typography.headlineMedium,
    fontWeight: '700',
  },
  donePill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251,146,60,0.3)',
  },
  doneText: {
    ...Typography.labelMedium,
    fontWeight: '600',
  },
  orbsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl + 8,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  orb: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orbLetter: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    ...Typography.bodyMedium,
    textAlign: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  segmentList: {
    gap: Spacing.sm,
  },
  segmentCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md, // 12
    borderWidth: 1,
  },
  speakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  speakerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  speakerLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  segmentBody: {
    fontSize: 14,
    lineHeight: 22,
  },
  // Sticky compact header
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52,
    paddingBottom: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
  },
  stickyDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stickyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  stickyLetter: {
    fontSize: 12,
    fontWeight: '700',
  },
  stickyTitle: {
    ...Typography.labelLarge,
    fontWeight: '700',
  },
  // Footer CTA
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  finishButton: {
    backgroundColor: '#FB923C',
    borderWidth: 1.5,
    borderColor: '#EA580C',
    borderRadius: BorderRadius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  finishButtonText: {
    ...Typography.labelLarge,
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // Loading
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  loadingDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  loadingLabel: {
    ...Typography.bodyMedium,
    textAlign: 'center',
  },
  // Error
  errorTitle: {
    ...Typography.headlineSmall,
    textAlign: 'center',
  },
  errorSubtitle: {
    ...Typography.bodySmall,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
