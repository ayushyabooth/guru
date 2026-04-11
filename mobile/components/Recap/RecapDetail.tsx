import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import Icon from '../ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  DarkGlassMaterials,
  getBackdropBlur,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import { recapService } from '../../services/recap-service';
import { formatMinutes } from '../../services/metric-service';

interface RecapDetailProps {
  journeyId: string;
  onClose: () => void;
}

interface ScriptSegment {
  speaker: 'narrator' | 'analyst';
  text: string;
}

interface JourneySummary {
  journey_id: string;
  week_start: string;
  week_end: string;
  status: string;
  commitment: string | null;
  audio_script: string | null;
  insights: Array<{
    id: string;
    insight_text: string;
    source: string;
  }>;
  activity: {
    articles_read: number;
    total_time_minutes: number;
    qa_count: number;
    filters_explored: number;
  };
  socratic_exchange_count: number;
}

export default function RecapDetail({ journeyId, onClose }: RecapDetailProps) {
  const [summary, setSummary] = useState<JourneySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      setError(null);
      const data = await recapService.getSummary(journeyId);
      setSummary(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load recap');
    } finally {
      setLoading(false);
    }
  }, [journeyId]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const formatDateRange = (weekStart: string, weekEnd: string) => {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    return `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  };

  const parseAudioScript = (raw: string | null): ScriptSegment[] => {
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Recap</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={RingColors.recap.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Recap</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error || 'No data found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchSummary}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const script = parseAudioScript(summary.audio_script);
  const { activity, insights, commitment } = summary;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Your Recap</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Date Range */}
        <Text style={styles.dateRange}>
          {formatDateRange(summary.week_start, summary.week_end)}
        </Text>

        {/* Activity Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{activity.articles_read}</Text>
            <Text style={styles.statLabel}>articles</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatMinutes(activity.total_time_minutes)}</Text>
            <Text style={styles.statLabel}>reading</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{activity.qa_count}</Text>
            <Text style={styles.statLabel}>questions</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{insights.length}</Text>
            <Text style={styles.statLabel}>insights</Text>
          </View>
        </View>

        {/* Commitment */}
        {commitment && (
          <View style={styles.commitmentCard}>
            <View style={styles.sectionHeader}>
              <Icon name="flag-outline" size={16} color={RingColors.recap.primary} />
              <Text style={styles.sectionTitle}>Your Commitment</Text>
            </View>
            <Text style={styles.commitmentText}>"{commitment}"</Text>
          </View>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="star-four-points" size={16} color={RingColors.recap.primary} />
              <Text style={styles.sectionTitle}>Key Insights</Text>
            </View>
            {insights.map((insight, i) => (
              <View key={insight.id} style={styles.insightItem}>
                <View style={styles.insightDot} />
                <Text style={styles.insightText}>{insight.insight_text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Text Podcast / Audio Script */}
        {script.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="microphone-outline" size={16} color={RingColors.recap.primary} />
              <Text style={styles.sectionTitle}>Your Weekly Recap</Text>
            </View>
            <Text style={styles.podcastSubtitle}>A personalized recap of your learning week</Text>

            {script.map((segment, i) => (
              <View key={i} style={styles.scriptEntry}>
                <View style={[
                  styles.speakerBadge,
                  segment.speaker === 'narrator' ? styles.narratorBadge : styles.analystBadge,
                ]}>
                  <Text style={[
                    styles.speakerText,
                    segment.speaker === 'narrator' ? styles.narratorText : styles.analystText,
                  ]}>
                    {segment.speaker === 'narrator' ? 'Narrator' : 'Analyst'}
                  </Text>
                </View>
                <Text style={styles.scriptText}>{segment.text}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DarkThemeColors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    ...DarkGlassMaterials.navBar,
    ...getBackdropBlur(24),
  },
  backButton: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.md,
    minWidth: 44,
  },
  headerTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
  },
  headerSpacer: {
    minWidth: 44,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  errorText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.error,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: RingColors.recap.primary,
    borderRadius: BorderRadius.pill,
  },
  retryText: {
    ...Typography.labelMedium,
    color: '#fff',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
  },
  dateRange: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    ...DarkGlassMaterials.card,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    ...getBackdropBlur(16),
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    ...Typography.headlineSmall,
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  statLabel: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: DarkThemeColors.glassBorder,
  },
  commitmentCard: {
    ...DarkGlassMaterials.cardLight,
    backgroundColor: 'rgba(251, 146, 60, 0.06)',
    borderColor: 'rgba(251, 146, 60, 0.15)',
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textPrimary,
    fontWeight: '600',
  },
  commitmentText: {
    ...Typography.bodyMedium,
    color: RingColors.recap.primary,
    fontStyle: 'italic',
    marginTop: Spacing.xs,
    lineHeight: 22,
  },
  insightItem: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingLeft: Spacing.xs,
  },
  insightDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: RingColors.recap.primary,
    marginTop: 7,
  },
  insightText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textPrimary,
    flex: 1,
    lineHeight: 22,
  },
  podcastSubtitle: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
    marginBottom: Spacing.md,
  },
  scriptEntry: {
    marginBottom: Spacing.md,
  },
  speakerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.pill,
    marginBottom: 4,
  },
  narratorBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  analystBadge: {
    backgroundColor: 'rgba(251, 146, 60, 0.12)',
  },
  speakerText: {
    ...Typography.labelSmall,
    fontWeight: '600',
  },
  narratorText: {
    color: DarkThemeColors.catchup,
  },
  analystText: {
    color: DarkThemeColors.recap,
  },
  scriptText: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textPrimary,
    lineHeight: 24,
  },
});
