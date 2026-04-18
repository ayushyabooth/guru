import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import Icon from '../ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
  RingColors,
  getBackdropBlur,
} from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
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
 */
export default function RecapArchive({ onClose, onSelectJourney }: RecapArchiveProps) {
  const [journeys, setJourneys] = useState<RecapJourneySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJourneys = useCallback(async () => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out. Please check your connection.')), 8000)
    );
    try {
      setError(null);
      const data = await Promise.race([recapService.listJourneys(50, 0), timeoutPromise]);
      setJourneys(data.journeys);
    } catch (err: any) {
      setError(err.message || "Couldn't load your journal");
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

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'full': return { label: 'Full', color: '#FB923C' };
      case 'standard': return { label: 'Standard', color: '#EC4899' };
      case 'lite': return { label: 'Lite', color: '#38BDF8' };
      default: return { label: tier, color: '#94A3B8' };
    }
  };

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

  const formatDateRange = (weekStart: string, weekEnd: string) => {
    const start = new Date(weekStart);
    const end = new Date(weekEnd);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} \u2013 ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };

  const renderJourneyCard = (journey: RecapJourneySummary) => {
    const tier = getTierBadge(journey.tier);
    const isCompleted = journey.status === 'completed';

    return (
      <TouchableOpacity
        key={journey.id}
        style={[styles.journeyCard, isCompleted && styles.journeyCardCompleted]}
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
        <Text style={styles.journeyDate}>
          {formatDateRange(journey.week_start, journey.week_end)}
        </Text>

        {/* Tier badge */}
        <View style={[styles.tierBadge, { backgroundColor: `${tier.color}15` }]}>
          <Text style={[styles.tierBadgeText, { color: tier.color }]}>
            {tier.label}
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.journeyStats}>
          {journey.insight_count > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Text style={styles.journeyStat}>
                {journey.insight_count}
              </Text>
              <Icon name="star-four-points" size={12} color={DarkThemeColors.textSecondary} />
            </View>
          )}
          {journey.articles_read_count > 0 && (
            <Text style={styles.journeyStat}>
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
          <Text style={styles.commitmentPreview} numberOfLines={2}>
            "{journey.commitment}"
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Icon name="arrow-left" size={20} color={RingColors.recap.primary} />
        </TouchableOpacity>
        <Text style={styles.title}>Learning Journal</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={RingColors.recap.primary} />
          <Text style={styles.loadingText}>Loading your journal...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Couldn't load your journal</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchJourneys}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : journeys.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="notebook-outline" size={48} color={DarkThemeColors.textSecondary} style={{ marginBottom: Spacing.md }} />
          <Text style={styles.emptyTitle}>No recaps yet</Text>
          <Text style={styles.emptySubtitle}>
            Your journal will appear here once you start reading.
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
          <Text style={styles.sectionTitle}>
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
          <Text style={styles.sectionTitle}>All Recaps</Text>
          {journeys.map(journey => {
            const tier = getTierBadge(journey.tier);
            const isCompleted = journey.status === 'completed';
            return (
              <TouchableOpacity
                key={`list-${journey.id}`}
                style={styles.listItem}
                onPress={() => onSelectJourney?.(journey.id)}
                activeOpacity={0.7}
              >
                <View style={styles.listItemLeft}>
                  <View style={[styles.listDot, isCompleted && styles.listDotCompleted]} />
                  <View>
                    <Text style={styles.listDate}>
                      {formatDateRange(journey.week_start, journey.week_end)}
                    </Text>
                    <Text style={styles.listMeta}>
                      {journey.articles_read_count} articles
                      {journey.insight_count > 0 ? ` \u00B7 ${journey.insight_count} insights` : ''}
                    </Text>
                  </View>
                </View>
                <View style={[styles.listTierBadge, { backgroundColor: `${tier.color}15` }]}>
                  <Text style={[styles.listTierText, { color: tier.color }]}>
                    {tier.label}
                  </Text>
                </View>
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
    backgroundColor: DarkThemeColors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: 'rgba(15, 20, 35, 0.55)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    ...getBackdropBlur(24),
  },
  closeButton: {
    paddingVertical: Spacing.xs,
    paddingRight: Spacing.md,
    minWidth: 70,
  },
  title: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
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
    color: DarkThemeColors.textSecondary,
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
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.xs,
  },
  emptySubtitle: {
    ...Typography.bodyMedium,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  // Sections
  sectionTitle: {
    ...Typography.labelMedium,
    color: DarkThemeColors.textSecondary,
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
    backgroundColor: 'rgba(15, 20, 35, 0.55)',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    color: DarkThemeColors.textPrimary,
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
    color: DarkThemeColors.textSecondary,
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
    color: DarkThemeColors.textSecondary,
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
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
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
    color: DarkThemeColors.textPrimary,
  },
  listMeta: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
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
