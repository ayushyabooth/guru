import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
} from 'react-native';
import Icon from '../ui/Icon';
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
  const { colors, isDark } = useTheme();
  const GM = isDark ? DarkGlassMaterials : GlassMaterials;
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

  // Defensive null-guard (GUR-185 — same pattern as GUR-179): if any
  // imported child component resolves to undefined under React Compiler
  // / barrel-init edge cases, render nothing instead of throwing
  // React error #130 ("Element type is invalid"). Placed AFTER all hooks
  // to keep the hook call order stable across renders.
  if (!Icon) return null;

  // ── Theme-aware glass EDL materials (GUR-228) ─────────────────────
  // Dark: rgba(15,20,35,0.55) + white 0.08 hairline. Light: frosted white
  // + slate 0.07 hairline. Applied over GM.* as a fill/border override.
  const glassCard = isDark
    ? { backgroundColor: 'rgba(15, 20, 35, 0.55)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.08)' }
    : { backgroundColor: 'rgba(255, 255, 255, 0.75)', borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.07)' };
  const headerGlass = isDark
    ? { backgroundColor: 'rgba(15, 20, 35, 0.55)', borderBottomWidth: 1, borderBottomColor: 'rgba(255, 255, 255, 0.08)' }
    : { backgroundColor: 'rgba(255, 255, 255, 0.85)', borderBottomWidth: 1, borderBottomColor: 'rgba(15, 23, 42, 0.07)' };

  // GUR-232: Recap is decoupled from the calendar week — label the period by
  // its start ("Since <Mon D, YYYY>") rather than a "<start> – <end>" range.
  const formatDateRange = (weekStart: unknown, _weekEnd?: unknown) => {
    if (typeof weekStart !== 'string') return '';
    const start = new Date(weekStart);
    if (isNaN(start.getTime())) return '';
    return `Since ${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  };

  const parseAudioScript = (raw: unknown): ScriptSegment[] => {
    if (!raw) return [];
    // Backend stores audio_script as a JSON-stringified array, but be defensive:
    // if a raw array ever comes through, accept it; otherwise JSON.parse the string.
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(parsed)) return [];
    // Only keep segments with string text and recognised speaker — guarantees
    // no object is ever rendered as a Text child (React error #130).
    return parsed.filter(
      (seg): seg is ScriptSegment =>
        !!seg &&
        typeof seg === 'object' &&
        typeof (seg as any).text === 'string' &&
        ((seg as any).speaker === 'narrator' || (seg as any).speaker === 'analyst')
    );
  };

  // Safely coerce a value to a string for rendering inside <Text>. If an
  // object sneaks through the API response (legacy records, schema drift, etc.)
  // this prevents React error #130 ("Objects are not valid as a React child").
  const asText = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, headerGlass]}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Recap</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <GuruBlob size={40} state="thinking" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !summary) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, headerGlass]}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Recap</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error || 'No data found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchSummary}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const script = parseAudioScript(summary.audio_script);
  // Defensive defaults — if the backend ever omits a field or returns a
  // non-object for activity, the destructure below would explode when we
  // later read `.articles_read` etc. GUR-194.
  const activity = (summary.activity && typeof summary.activity === 'object')
    ? summary.activity
    : { articles_read: 0, total_time_minutes: 0, qa_count: 0, filters_explored: 0 };
  const insights = Array.isArray(summary.insights) ? summary.insights : [];
  const commitment = typeof summary.commitment === 'string' ? summary.commitment : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, headerGlass]}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Your Recap</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Date Range */}
        <Text style={[styles.dateRange, { color: colors.textPrimary }]}>
          {formatDateRange(summary.week_start, summary.week_end)}
        </Text>

        {/* Activity Stats */}
        <View style={[GM.card, styles.statsRow, glassCard]}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{Number(activity.articles_read) || 0}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>articles</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.glassBorder }]} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatMinutes(Number(activity.total_time_minutes) || 0)}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>reading</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.glassBorder }]} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{Number(activity.qa_count) || 0}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>questions</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.glassBorder }]} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{insights.length}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>insights</Text>
          </View>
        </View>

        {/* Commitment */}
        {commitment && (
          <View style={[GM.cardLight, styles.commitmentCard]}>
            <View style={styles.sectionHeader}>
              <Icon name="flag-outline" size={16} color={RingColors.recap.primary} />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Your Commitment</Text>
            </View>
            <Text style={styles.commitmentText}>"{asText(commitment)}"</Text>
          </View>
        )}

        {/* Insights */}
        {insights.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="star-four-points" size={16} color={RingColors.recap.primary} />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Key Insights</Text>
            </View>
            {insights
              .filter((insight) => insight && typeof insight.insight_text === 'string')
              .map((insight, i) => (
                <View key={insight.id || `insight-${i}`} style={styles.insightItem}>
                  <View style={styles.insightDot} />
                  <Text style={[styles.insightText, { color: colors.textPrimary }]}>{asText(insight.insight_text)}</Text>
                </View>
              ))}
          </View>
        )}

        {/* Text Podcast / Audio Script */}
        {script.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="microphone-outline" size={16} color={RingColors.recap.primary} />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Your Recap</Text>
            </View>
            <Text style={[styles.podcastSubtitle, { color: colors.textSecondary }]}>A personalized recap of your reading since your last recap</Text>

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
                <Text style={[styles.scriptText, { color: colors.textPrimary }]}>{asText(segment.text)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* In-progress fallback (GUR-217): show a clear state instead of a blank
            body when the recap isn't completed (no commitment/insights/script yet). */}
        {!commitment && insights.length === 0 && script.length === 0 && (
          <View style={[GM.cardLight, styles.commitmentCard, { backgroundColor: 'rgba(251,146,60,0.06)', borderColor: 'rgba(251,146,60,0.15)' }]}>
            <View style={styles.sectionHeader}>
              <Icon name="book-open-page-variant" size={16} color={RingColors.recap.primary} />
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Recap in progress</Text>
            </View>
            <Text style={[styles.podcastSubtitle, { color: colors.textSecondary, marginTop: 4 }]}>
              {`You've engaged with ${Number(activity.articles_read) || 0} article${(Number(activity.articles_read) || 0) === 1 ? '' : 's'} since your last recap. Finish your Recap journey to unlock your insights, commitment, and synthesis.`}
            </Text>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    ...getBackdropBlur(24),
  },
  backButton: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.md,
    minWidth: 44,
  },
  headerTitle: {
    ...Typography.headlineSmall,
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
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
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
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
  },
  commitmentCard: {
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
    flex: 1,
    lineHeight: 22,
  },
  podcastSubtitle: {
    ...Typography.bodySmall,
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
    color: '#38BDF8',
  },
  analystText: {
    color: '#FB923C',
  },
  scriptText: {
    ...Typography.bodyMedium,
    lineHeight: 24,
  },
});
