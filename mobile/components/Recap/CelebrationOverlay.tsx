import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Dimensions, ActivityIndicator } from 'react-native';
import Icon from '../ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getBackdropBlur,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';

const { width } = Dimensions.get('window');

interface CelebrationOverlayProps {
  insightCount: number;
  questionCount: number;
  commitment: string;
  streak?: number;
  isFullTier?: boolean;
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
  isFullTier = false,
  audioStatus = 'idle',
  onGenerateAudio,
  onListenAudio,
  onReadRecap,
  onViewConstellation,
  onBackToHome,
}: CelebrationOverlayProps) {
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

  const getWeekLabel = () => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun..6=Sat
    const diff = day === 0 ? 6 : day - 1; // days since Monday
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - diff);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
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
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{insightCount}</Text>
            <Text style={styles.statLabel}>insights captured</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{questionCount}</Text>
            <Text style={styles.statLabel}>questions reflected on</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>1</Text>
            <Text style={styles.statLabel}>commitment made</Text>
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
            <Text style={styles.commitmentLabel}>Your commitment:</Text>
            <Text style={styles.commitmentText} numberOfLines={2}>
              "{commitment}"
            </Text>
          </View>
        )}

        {/* Audio / Text recap button */}
        <View style={styles.audioSection}>
          {audioStatus === 'idle' && onGenerateAudio && (
            <TouchableOpacity style={styles.audioButton} onPress={onGenerateAudio}>
              <Icon name="headphones" size={18} color="#fff" />
              <Text style={styles.audioButtonText}>Generate Your Recap</Text>
            </TouchableOpacity>
          )}
          {audioStatus === 'generating' && (
            <View style={styles.audioGenerating}>
              <ActivityIndicator size="small" color={RingColors.recap.primary} />
              <Text style={styles.audioGeneratingText}>Creating your recap...</Text>
            </View>
          )}
          {audioStatus === 'ready' && onListenAudio && (
            <TouchableOpacity style={styles.audioButton} onPress={onListenAudio}>
              <Icon name="headphones" size={18} color="#fff" />
              <Text style={styles.audioButtonText}>Listen to Audio Recap</Text>
            </TouchableOpacity>
          )}
          {audioStatus === 'text_only' && onReadRecap && (
            <TouchableOpacity style={styles.audioButton} onPress={onReadRecap}>
              <Icon name="book-open-variant" size={18} color="#fff" />
              <Text style={styles.audioButtonText}>Read Your Recap</Text>
            </TouchableOpacity>
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
            <TouchableOpacity style={styles.secondaryButton} onPress={onViewConstellation}>
              <Text style={styles.secondaryButtonText}>View Constellation</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.primaryButton} onPress={onBackToHome}>
            <Text style={styles.primaryButtonText}>Back to Home</Text>
          </TouchableOpacity>
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
    backgroundColor: 'rgba(20, 25, 40, 0.92)',
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    marginHorizontal: Spacing.lg,
    borderWidth: 2,
    borderColor: 'rgba(251, 146, 60, 0.4)',
    shadowColor: '#FB923C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 10,
    ...getBackdropBlur(24),
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
  },
  statNumber: {
    ...Typography.headlineLarge,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  statLabel: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
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
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 4,
  },
  commitmentText: {
    ...Typography.bodyMedium,
    color: 'rgba(255, 255, 255, 0.9)',
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
    color: DarkThemeColors.textSecondary,
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
    color: '#C04040',
    fontWeight: '600',
  },
});
