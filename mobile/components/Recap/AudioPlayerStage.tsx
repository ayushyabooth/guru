import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  ScrollView,
} from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import { getAuthToken } from '../../utils/auth';
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
import type { ScriptSegment } from '../../services/recap-service';

const { width } = Dimensions.get('window');

interface AudioPlayerStageProps {
  journeyId: string;
  audioUrl: string;
  audioDuration: number;
  script?: ScriptSegment[];
  textOnly?: boolean;  // True when no audio is available (ElevenLabs fallback)
  onDismiss: () => void;
}

export default function AudioPlayerStage({
  journeyId,
  audioUrl,
  audioDuration,
  script,
  textOnly = false,
  onDismiss,
}: AudioPlayerStageProps) {
  const { colors, isDark } = useTheme();
  const GM = isDark ? DarkGlassMaterials : GlassMaterials;
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(audioDuration * 1000);
  const [showTranscript, setShowTranscript] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Animated waveform bars
  const barAnims = useRef(
    Array.from({ length: 10 }, () => new Animated.Value(0.2))
  ).current;
  const waveAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Narrator/Analyst pulse
  const narratorPulse = useRef(new Animated.Value(1)).current;
  const analystPulse = useRef(new Animated.Value(1)).current;

  // Load audio on mount (skip for text-only mode)
  useEffect(() => {
    if (!textOnly) {
      loadAudio();
    }
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      stopWaveAnimation();
    };
  }, []);

  const loadAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      const token = await getAuthToken();
      const { sound: newSound } = await Audio.Sound.createAsync(
        {
          uri: audioUrl,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
        { shouldPlay: false, progressUpdateIntervalMillis: 500 },
        onPlaybackStatusUpdate
      );

      setSound(newSound);
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
    }
  };

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;

    setPositionMs(status.positionMillis);
    setIsPlaying(status.isPlaying);

    if (status.durationMillis) {
      setDurationMs(status.durationMillis);
    }

    if (status.didJustFinish) {
      setIsPlaying(false);
      stopWaveAnimation();
    }
  }, []);

  // Wave animation
  const startWaveAnimation = () => {
    const animations = barAnims.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 0.3 + Math.random() * 0.7,
            duration: 300 + i * 50,
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.15 + Math.random() * 0.25,
            duration: 300 + i * 50,
            useNativeDriver: true,
          }),
        ])
      )
    );
    waveAnimRef.current = Animated.parallel(animations);
    waveAnimRef.current.start();
  };

  const stopWaveAnimation = () => {
    waveAnimRef.current?.stop();
    barAnims.forEach((anim) => {
      Animated.timing(anim, {
        toValue: 0.2,
        duration: 400,
        useNativeDriver: true,
      }).start();
    });
  };

  // Active speaker detection
  const currentSegmentIndex = script
    ? estimateCurrentSegment(positionMs, durationMs, script)
    : -1;
  const activeSpeaker =
    currentSegmentIndex >= 0 && script
      ? script[currentSegmentIndex].speaker
      : null;

  useEffect(() => {
    if (activeSpeaker === 'narrator') {
      Animated.sequence([
        Animated.timing(narratorPulse, { toValue: 1.15, duration: 300, useNativeDriver: true }),
        Animated.timing(narratorPulse, { toValue: 1.0, duration: 300, useNativeDriver: true }),
      ]).start();
    } else if (activeSpeaker === 'analyst') {
      Animated.sequence([
        Animated.timing(analystPulse, { toValue: 1.15, duration: 300, useNativeDriver: true }),
        Animated.timing(analystPulse, { toValue: 1.0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [activeSpeaker]);

  // Controls
  const handlePlayPause = async () => {
    if (!sound) return;
    if (isPlaying) {
      await sound.pauseAsync();
      stopWaveAnimation();
    } else {
      await sound.playAsync();
      startWaveAnimation();
    }
  };

  const handleSkip = async (seconds: number) => {
    if (!sound) return;
    const newPos = Math.max(0, Math.min(positionMs + seconds * 1000, durationMs));
    await sound.setPositionAsync(newPos);
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const progressPct = durationMs > 0 ? positionMs / durationMs : 0;

  // ─── Text-only mode ─────────────────────────────────────────
  if (textOnly && script && script.length > 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.overlay }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Your Weekly Recap</Text>
          <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
            <Text style={styles.dismissText}>Done</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.textRecapHeader}>
          <View style={styles.hostsRow}>
            <View style={[styles.hostOrb, styles.narratorOrb]}>
              <Text style={styles.hostLabel}>Narrator</Text>
            </View>
            <View style={[styles.hostOrb, styles.analystOrb]}>
              <Text style={styles.hostLabel}>Analyst</Text>
            </View>
          </View>
          <Text style={styles.textRecapSubtitle}>
            A conversation about your week's learning journey
          </Text>
        </View>

        <ScrollView
          style={styles.textRecapScroll}
          contentContainerStyle={styles.textRecapContent}
          showsVerticalScrollIndicator={false}
        >
          {script.map((seg, i) => (
            <View key={i} style={styles.textRecapSegment}>
              <View style={styles.textRecapSpeakerRow}>
                <View style={[
                  styles.textRecapSpeakerDot,
                  { backgroundColor: seg.speaker === 'narrator' ? '#38BDF8' : '#FB923C' },
                ]} />
                <Text style={[
                  styles.transcriptSpeaker,
                  seg.speaker === 'narrator' ? styles.narratorColor : styles.analystColor,
                ]}>
                  {seg.speaker === 'narrator' ? 'Narrator' : 'Analyst'}
                </Text>
              </View>
              <Text style={styles.textRecapText}>{seg.text}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.overlay }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Audio Recap</Text>
        <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
          <Text style={styles.dismissText}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* Host orbs */}
      <View style={styles.hostsRow}>
        <Animated.View
          style={[
            styles.hostOrb,
            styles.narratorOrb,
            { transform: [{ scale: narratorPulse }] },
            activeSpeaker === 'narrator' && styles.activeOrb,
          ]}
        >
          <Text style={styles.hostLabel}>Narrator</Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.hostOrb,
            styles.analystOrb,
            { transform: [{ scale: analystPulse }] },
            activeSpeaker === 'analyst' && styles.activeOrb,
          ]}
        >
          <Text style={styles.hostLabel}>Analyst</Text>
        </Animated.View>
      </View>

      {/* Waveform */}
      <View style={styles.waveformContainer}>
        {barAnims.map((anim, i) => (
          <Animated.View
            key={i}
            style={[
              styles.waveBar,
              { transform: [{ scaleY: anim }] },
            ]}
          />
        ))}
      </View>

      {/* Progress bar */}
      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
        </View>
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
          <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={[GM.card, styles.controlsRow]}>
        <TouchableOpacity style={styles.skipButton} onPress={() => handleSkip(-15)}>
          <Text style={styles.skipText}>-15s</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.playButton, isLoading && styles.playButtonDisabled]}
          onPress={handlePlayPause}
          disabled={isLoading}
        >
          <Text style={styles.playButtonText}>
            {isLoading ? '...' : isPlaying ? '⏸' : '▶'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipButton} onPress={() => handleSkip(15)}>
          <Text style={styles.skipText}>+15s</Text>
        </TouchableOpacity>
      </View>

      {/* Metadata */}
      <Text style={styles.metadata}>
        {Math.ceil(audioDuration / 60)} min
        {script ? ` · ${script.length} segments` : ''}
      </Text>

      {/* Transcript toggle */}
      {script && script.length > 0 && (
        <>
          <TouchableOpacity
            style={styles.transcriptToggle}
            onPress={() => setShowTranscript(!showTranscript)}
          >
            <Text style={styles.transcriptToggleText}>
              {showTranscript ? 'Hide Transcript' : 'Show Transcript'}
            </Text>
          </TouchableOpacity>

          {showTranscript && (
            <ScrollView style={styles.transcriptScroll} showsVerticalScrollIndicator={false}>
              {script.map((seg, i) => (
                <View
                  key={i}
                  style={[
                    styles.transcriptSegment,
                    i === currentSegmentIndex && styles.transcriptActive,
                  ]}
                >
                  <Text style={[
                    styles.transcriptSpeaker,
                    seg.speaker === 'narrator' ? styles.narratorColor : styles.analystColor,
                  ]}>
                    {seg.speaker === 'narrator' ? 'Narrator' : 'Analyst'}
                  </Text>
                  <Text style={styles.transcriptText}>{seg.text}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

/**
 * Estimate which script segment is currently playing
 * based on word count-weighted position.
 */
function estimateCurrentSegment(
  positionMs: number,
  durationMs: number,
  script: ScriptSegment[]
): number {
  if (durationMs <= 0 || script.length === 0) return -1;

  const totalWords = script.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  const targetWords = (positionMs / durationMs) * totalWords;

  let accumulated = 0;
  for (let i = 0; i < script.length; i++) {
    accumulated += script[i].text.split(/\s+/).length;
    if (accumulated >= targetWords) return i;
  }
  return script.length - 1;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 100,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: Spacing.xl,
  },
  headerTitle: {
    ...Typography.headlineMedium,
    color: RingColors.recap.light,
    fontWeight: '600',
  },
  dismissButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.3)',
  },
  dismissText: {
    ...Typography.labelMedium,
    color: RingColors.recap.light,
    fontWeight: '600',
  },
  hostsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.xl * 2,
    marginBottom: Spacing.xl,
    marginTop: Spacing.lg,
  },
  hostOrb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    ...getBackdropBlur(16),
  },
  narratorOrb: {
    backgroundColor: 'rgba(251, 146, 60, 0.15)',
    borderColor: 'rgba(251, 146, 60, 0.3)',
  },
  analystOrb: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  activeOrb: {
    borderWidth: 3,
    shadowColor: RingColors.recap.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  hostLabel: {
    ...Typography.labelSmall,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    gap: 6,
    marginBottom: Spacing.xl,
  },
  waveBar: {
    width: 8,
    height: 60,
    borderRadius: 4,
    backgroundColor: 'rgba(251, 146, 60, 0.5)',
  },
  progressSection: {
    width: '100%',
    marginBottom: Spacing.lg,
  },
  progressBar: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: RingColors.recap.primary,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  timeText: {
    ...Typography.labelSmall,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    marginBottom: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    ...getBackdropBlur(20),
  },
  skipButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  skipText: {
    ...Typography.labelMedium,
    color: 'rgba(255, 255, 255, 0.7)',
    fontWeight: '600',
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: RingColors.recap.primary,
    shadowColor: RingColors.recap.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  playButtonDisabled: {
    opacity: 0.5,
  },
  playButtonText: {
    fontSize: 28,
    color: '#fff',
  },
  metadata: {
    ...Typography.labelSmall,
    color: 'rgba(255, 255, 255, 0.4)',
    marginBottom: Spacing.lg,
  },
  transcriptToggle: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
    marginBottom: Spacing.md,
  },
  transcriptToggleText: {
    ...Typography.labelSmall,
    color: RingColors.recap.light,
    fontWeight: '600',
  },
  transcriptScroll: {
    flex: 1,
    width: '100%',
  },
  transcriptSegment: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: 6,
    backgroundColor: 'rgba(15, 20, 35, 0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  transcriptActive: {
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.25)',
  },
  transcriptSpeaker: {
    ...Typography.labelSmall,
    fontWeight: '700',
    marginBottom: 2,
  },
  narratorColor: {
    color: RingColors.recap.light,
  },
  analystColor: {
    color: '#94A3B8',
  },
  transcriptText: {
    ...Typography.bodySmall,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 20,
  },
  // ── Text-only mode styles ──────────────────────────────────
  textRecapHeader: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  textRecapSubtitle: {
    ...Typography.bodyMedium,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  textRecapScroll: {
    flex: 1,
    width: '100%',
  },
  textRecapContent: {
    paddingBottom: 40,
  },
  textRecapSegment: {
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: 'rgba(15, 20, 35, 0.3)',
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  textRecapSpeakerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  textRecapSpeakerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  textRecapText: {
    ...Typography.bodyMedium,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 24,
    paddingLeft: 18,
  },
});
