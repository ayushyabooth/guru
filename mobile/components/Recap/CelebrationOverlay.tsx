import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions } from 'react-native';
import Icon from '../ui/Icon';
import GlassButton from '../ui/GlassButton';
import GuruBlob from '../ui/GuruBlob';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  DarkGlassMaterials,
  GlassMaterials,
  getBackdropBlur,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');

interface CelebrationOverlayProps {
  insightCount: number;
  questionCount: number;
  commitment: string;
  streak?: number;
  audioStatus?: 'idle' | 'generating' | 'ready' | 'failed' | 'text_only';
  onGenerateAudio?: () => void;
  onListenAudio?: () => void;
  onReadRecap?: () => void;
  onViewConstellation?: () => void;
  onBackToHome: () => void;
}

export default function CelebrationOverlay({
  insightCount,
  questionCount,
  commitment,
  streak = 1,
  audioStatus = 'idle',
  onGenerateAudio,
  onListenAudio,
  onReadRecap,
  onViewConstellation,
  onBackToHome,
}: CelebrationOverlayProps) {
  const { isDark, colors } = useTheme();
  const GM = isDark ? DarkGlassMaterials : GlassMaterials;
  // Theme-aware glass EDL for nested stat tiles (the static style hardcoded
  // white-on-white fills that vanished in light mode).
  const statGlass = isDark
    ? { backgroundColor: 'rgba(255, 255, 255, 0.06)', borderColor: 'rgba(255, 255, 255, 0.10)' }
    : { backgroundColor: 'rgba(15, 23, 42, 0.04)', borderColor: 'rgba(15, 23, 42, 0.08)' };
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulsing glow
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  // GUR-232: Recap is decoupled from the calendar week \u2014 label the period as
  // "Since <Mon D>" (the start of this reflection), not a "Week of \u2026" range.
  // No backend week_start is wired here, so derive a ~7-days-ago start.
  const getWeekLabel = () => {
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return `Since ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  return (
    <View style={styles.overlay}>
      {/* Gold glow background */}
      <Animated.View
        style={[
          styles.glowCircle,
          { opacity: glowAnim },
        ]}
      />

      <Animated.View
        style={[
          GM.cardHeavy,
          styles.card,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Text style={styles.weekLabel}>{getWeekLabel()}</Text>
        <Icon name="star-four-points" size={28} color={RingColors.recap.primary} />

        <View style={styles.statsGrid}>
          <View style={[styles.statItem, statGlass]}>
            <Text style={styles.statNumber}>{insightCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>insights captured</Text>
          </View>
          <View style={[styles.statItem, statGlass]}>
            <Text style={styles.statNumber}>{questionCount}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>questions reflected on</Text>
          </View>
          <View style={[styles.statItem, statGlass]}>
            <Text style={styles.statNumber}>1</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>commitment made</Text>
          </View>
        </View>

        {/* Streak */}
        {streak > 1 && (
          <View style={styles.streakBadge}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon
                name={streak >= 5 ? 'trophy-outline' : 'medal-outline'}
                size={18}
                color={RingColors.recap.primary}
              />
              <Text style={styles.streakText}>{streak}-week streak!</Text>
            </View>
          </View>
        )}

        {/* Commitment preview */}
        {commitment && (
          <View style={styles.commitmentPreview}>
            <Text style={[styles.commitmentLabel, { color: colors.textSecondary }]}>Your commitment:</Text>
            <Text style={[styles.commitmentText, { color: colors.textPrimary }]} numberOfLines={2}>
              "{commitment}"
            </Text>
          </View>
        )}

        {/* Audio / Text recap button */}
        <View style={styles.audioSection}>
          {audioStatus === 'idle' && onGenerateAudio && (
            <GlassButton
              title="Generate Your Recap"
              onPress={onGenerateAudio}
              accentColor="#6366F1"
              fullWidth={false}
              size="md"
              style={{ paddingHorizontal: Spacing.xl }}
            />
          )}
          {audioStatus === 'generating' && (
            <View style={styles.audioGenerating}>
              <GuruBlob size={20} state="thinking" tight />
              <Text style={[styles.audioGeneratingText, { color: colors.textSecondary }]}>Creating your recap...</Text>
            </View>
          )}
          {audioStatus === 'ready' && onListenAudio && (
            <GlassButton
              title="Listen to Audio Recap"
              onPress={onListenAudio}
              accentColor="#6366F1"
              fullWidth={false}
              size="md"
              style={{ paddingHorizontal: Spacing.xl }}
            />
          )}
          {audioStatus === 'text_only' && onReadRecap && (
            <GlassButton
              title="Read Your Recap"
              onPress={onReadRecap}
              accentColor="#6366F1"
              fullWidth={false}
              size="md"
              style={{ paddingHorizontal: Spacing.xl }}
            />
          )}
          {audioStatus === 'failed' && onGenerateAudio && (
            <TouchableOpacity style={styles.audioRetryButton} onPress={onGenerateAudio}>
              <Text style={styles.audioRetryText}>Retry Generation</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actionsRow}>
          {onViewConstellation && (
            <GlassButton
              title="View Constellation"
              onPress={onViewConstellation}
              variant="secondary"
              fullWidth={false}
              size="md"
              style={{ paddingHorizontal: Spacing.lg }}
            />
          )}
          <GlassButton
            title="Back to Home"
            onPress={onBackToHome}
            accentColor="#FB923C"
            fullWidth={false}
            size="md"
            style={{ paddingHorizontal: Spacing.lg }}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  glowCircle: {
    position: 'absolute',
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 60,
  },
  card: {
    padding: Spacing.xl,
    marginHorizontal: Spacing.lg,
    borderWidth: 2,
    borderColor: 'rgba(251, 146, 60, 0.4)',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
    ...getBackdropBlur(28),
    alignItems: 'center',
    width: width - Spacing.xl * 2,
  },
  weekLabel: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    marginBottom: Spacing.sm,
  },
  sparkle: {
    marginBottom: Spacing.lg,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: Spacing.lg,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    borderRadius: BorderRadius.lg,
    paddingVertical: Spacing.md,
    marginHorizontal: 4,
    borderWidth: 1,
    // fill/border applied inline via theme-aware `statGlass`
  },
  statNumber: {
    ...Typography.headlineLarge,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  statLabel: {
    ...Typography.labelSmall,
    textAlign: 'center',
  },
  streakBadge: {
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
  },
  streakText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  commitmentPreview: {
    width: '100%',
    backgroundColor: 'rgba(251, 146, 60, 0.10)',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.25)',
  },
  commitmentLabel: {
    ...Typography.labelSmall,
    marginBottom: 4,
  },
  commitmentText: {
    ...Typography.bodyMedium,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  secondaryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: RingColors.recap.primary,
  },
  secondaryButtonText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: RingColors.recap.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    shadowColor: RingColors.recap.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryButtonText: {
    ...Typography.labelMedium,
    color: '#fff',
    fontWeight: '700',
  },
  audioSection: {
    width: '100%',
    marginBottom: Spacing.lg,
    alignItems: 'center',
  },
  audioButton: {
    backgroundColor: 'rgba(251, 146, 60, 0.12)',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    borderWidth: 1.5,
    borderColor: RingColors.recap.primary,
    shadowColor: RingColors.recap.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  audioButtonText: {
    ...Typography.labelMedium,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  audioGenerating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  audioGeneratingText: {
    ...Typography.labelMedium,
  },
  audioRetryButton: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(220, 80, 80, 0.4)',
    backgroundColor: 'rgba(220, 80, 80, 0.06)',
  },
  audioRetryText: {
    ...Typography.labelMedium,
    color: '#EF4444',
    fontWeight: '600',
  },
});
