import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  RefreshControl,
  Dimensions,
} from 'react-native';
import Icon from '../ui/Icon';
import GuruBlob from '../ui/GuruBlob';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getBackdropBlur,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';
import { recapService, RecapJourneySummary } from '../../services/recap-service';

const { width } = Dimensions.get('window');

interface RecapArchiveProps {
  onClose: () => void;
  onSelectJourney?: (journeyId: string) => void;
}

/**
 * RecapArchive — Learning Journal / Archive view.
 *
 * Horizontal scrollable timeline of past weekly recap journeys.
 * Each entry shows: date range, tier badge, insight count, status.
 *
 * Glass EDL (GUR-228): theme-aware glass cards — dark rgba(15,20,35,0.55)
 * with rgba(255,255,255,0.08) hairline; light frosted white with
 * rgba(15,23,42,0.07) hairline. Text adapts via useTheme.
 */
export default function RecapArchive({ onClose, onSelectJourney }: RecapArchiveProps) {
  const { colors, isDark } = useTheme();
  const [journeys, setJourneys] = useState<RecapJourneySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJourneys = useCallback(async () => {
    try {
      setError(null);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      );
      const data = await Promise.race([recapService.listJourneys(50, 0), timeoutPromise]);
      setJourneys(data.journeys);
    } catch (err: any) {
      setError(
        err.message === 'TIMEOUT'
          ? "Couldn't load — tap to retry"
          : err.message || 'Failed to load journal'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchJourneys();
  }, [fetchJourneys]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchJourneys();
  }, [fetchJourneys]);

  // Defensive null-guard (GUR-194 — same pattern as GUR-185/GUR-179): if the
  // Icon barrel export resolves to undefined under React Compiler / barrel-init
  // edge cases, render nothing rather than throwing React error #130
  // ("Element type is invalid"). Placed AFTER all hooks to keep the hook call
  // order stable across renders.
  if (!Icon) return null;

  // ── Theme-aware glass EDL materials ──────────────────────────────
  const glassCard = isDark
    ? { backgroundColor: 'rgba(15, 20, 35, 0.55)', borderColor: 'rgba(255, 255, 255, 0.08)' }
    : { backgroundColor: 'rgba(255, 255, 255, 0.75)', borderColor: 'rgba(15, 23, 42, 0.07)' };
  const headerGlass = isDark
    ? { backgroundColor: 'rgba(15, 20, 35, 0.55)', borderBottomColor: 'rgba(255, 255, 255, 0.08)' }
    : { backgroundColor: 'rgba(255, 255, 255, 0.85)', borderBottomColor: 'rgba(15, 23, 42, 0.07)' };
  const hairline = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(15, 23, 42, 0.06)';

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return 'Completed';
      case 'stage_1': return 'Stage 1';
      case 'stage_2': return 'Stage 2';
      case 'stage_3': return 'Stage 3';
      case 'commitment': return 'Commitment';
      default: return status;
    }
  };

  // GUR-232: Recap is decoupled from the calendar week — label each entry by
  // its start ("Since <Mon D>") rather than a "<start> – <end>" range.
  const formatDateRange = (weekStart: string, _weekEnd?: string) => {
    const start = new Date(weekStart);
    if (isNaN(start.getTime())) return '';
    return `Since ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const renderJourneyCard = (journey: RecapJourneySummary) => {
    const isCompleted = journey.status === 'completed';

    return (
      <TouchableOpacity
        key={journey.id}
        style={[styles.journeyCard, glassCard, isCompleted && styles.journeyCardCompleted]}
        onPress={() => onSelectJourney?.(journey.id)}
        activeOpacity={0.7}
      >
        {/* Constellation thumbnail placeholder */}
        <View style={styles.constellationThumb}>
          {/* Simple visual: dots arranged in a pattern based on insight count */}
          {Array.from({ length: Math.min(journey.insight_count || 0, 7) }).map((_, i) => {
            const angle = (i / Math.max(journey.insight_count, 1)) * Math.PI * 2;
            const r = 16;
            const cx = 28 + Math.cos(angle) * r;
            const cy = 28 + Math.sin(angle) * r;
            return (
              <View
                key={i}
                style={[styles.constellationDot, { left: cx, top: cy }]}
              />
            );
          })}
          {isCompleted && (
            <Icon name="star-four-points" size={18} color={RingColors.recap.primary} />
          )}
        </View>

        {/* Date range */}
        <Text style={[styles.journeyDate, { color: colors.textPrimary }]}>
          {formatDateRange(journey.week_start, journey.week_end)}
        </Text>

        {/* Stats */}
        <View style={styles.journeyStats}>
          {journey.insight_count > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={[styles.journeyStat, { color: colors.textSecondary }]}>
                {journey.insight_count}
              </Text>
              <Icon name="star-four-points" size={12} color={colors.textSecondary} />
            </View>
          )}
          {journey.articles_read_count > 0 && (
            <Text style={[styles.journeyStat, { color: colors.textSecondary }]}>
              {journey.articles_read_count} articles
            </Text>
          )}
        </View>

        {/* Status */}
        {!isCompleted && (
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{getStatusLabel(journey.status)}</Text>
          </View>
        )}

        {/* Commitment preview */}
        {journey.commitment && (
          <Text style={[styles.commitmentPreview, { color: colors.textSecondary }]} numberOfLines={2}>
            "{journey.commitment}"
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, headerGlass]}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Learning Journal</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <GuruBlob size={40} state="thinking" />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading your journal...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchJourneys}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : journeys.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="notebook-outline" size={48} color={colors.textSecondary} style={{ marginBottom: Spacing.md }} />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No recaps yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Complete your first recap to start building your learning journal.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={RingColors.recap.primary}
            />
          }
        >
          {/* Timeline */}
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            {journeys.length} recap{journeys.length !== 1 ? 's' : ''} completed
          </Text>

          {/* Horizontal scroll of journey cards */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.timelineContent}
            style={styles.timeline}
          >
            {journeys.map(renderJourneyCard)}
          </ScrollView>

          {/* Vertical list for detailed view */}
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>All Recaps</Text>
          {journeys.map(journey => {
            const isCompleted = journey.status === 'completed';
            return (
              <TouchableOpacity
                key={`list-${journey.id}`}
                style={[styles.listItem, { borderBottomColor: hairline }]}
                onPress={() => onSelectJourney?.(journey.id)}
                activeOpacity={0.7}
              >
                <View style={styles.listItemLeft}>
                  <View style={[styles.listDot, isCompleted && styles.listDotCompleted]} />
                  <View>
                    <Text style={[styles.listDate, { color: colors.textPrimary }]}>
                      {formatDateRange(journey.week_start, journey.week_end)}
                    </Text>
                    <Text style={[styles.listMeta, { color: colors.textSecondary }]}>
                      {journey.articles_read_count} articles
                      {journey.insight_count > 0 ? ` · ${journey.insight_count} insights` : ''}
                    </Text>
                  </View>
                </View>
                {!isCompleted && (
                  <View style={[styles.listTierBadge, { backgroundColor: 'rgba(148,163,184,0.12)' }]}>
                    <Text style={[styles.listTierText, { color: isDark ? '#94A3B8' : '#64748B' }]}>
                      {getStatusLabel(journey.status)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
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
    borderBottomWidth: 1,
    ...getBackdropBlur(24),
  },
  closeButton: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.md,
    minWidth: 70,
  },
  title: {
    ...Typography.headlineSmall,
  },
  headerSpacer: {
    minWidth: 70,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  // Loading / Error / Empty
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.md,
  },
  loadingText: {
    ...Typography.bodyMedium,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyIcon: {
    marginBottom: Spacing.md,
  },
  emptyTitle: {
    ...Typography.headlineSmall,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    ...Typography.bodyMedium,
    textAlign: 'center',
    maxWidth: 280,
  },
  // Sections
  sectionTitle: {
    ...Typography.labelMedium,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  // Horizontal timeline
  timeline: {
    maxHeight: 260,
  },
  timelineContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  journeyCard: {
    width: 160,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    ...getBackdropBlur(16),
  },
  journeyCardCompleted: {
    borderColor: 'rgba(251, 146, 60, 0.2)',
  },
  constellationThumb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(251, 146, 60, 0.06)',
    alignSelf: 'center',
    marginBottom: Spacing.sm,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  constellationDot: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: RingColors.recap.primary,
  },
  constellationCheck: {
    color: RingColors.recap.primary,
  },
  journeyDate: {
    ...Typography.labelSmall,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  tierBadge: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.pill,
    marginBottom: Spacing.xs,
  },
  tierBadgeText: {
    ...Typography.labelSmall,
    fontWeight: '600',
  },
  journeyStats: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  journeyStat: {
    ...Typography.labelSmall,
  },
  statusBadge: {
    alignSelf: 'center',
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: BorderRadius.pill,
  },
  statusText: {
    ...Typography.labelSmall,
    color: '#F59E0B',
    fontWeight: '600',
  },
  commitmentPreview: {
    ...Typography.bodySmall,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  // List view
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  listDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(251, 146, 60, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.4)',
  },
  listDotCompleted: {
    backgroundColor: RingColors.recap.primary,
    borderColor: RingColors.recap.primary,
  },
  listDate: {
    ...Typography.labelMedium,
  },
  listMeta: {
    ...Typography.bodySmall,
    marginTop: 2,
  },
  listTierBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.pill,
  },
  listTierText: {
    ...Typography.labelSmall,
    fontWeight: '600',
  },
});
