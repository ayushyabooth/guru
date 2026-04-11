import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Spacing, Typography, BorderRadius, RingColors, getBackdropBlur } from '../../constants/liquidGlass';
import DarkThemeColors from '../../constants/darkTheme';
import Icon from '../ui/Icon';
import { SnapshotData } from '../../services/recap-service';

interface SnapshotStageProps {
  snapshot: SnapshotData;
  onContinue: () => void;
}

/** Convert raw filter context like "core:consumer:food_beverage" to human label */
function formatFilterLabel(ctx: string): string {
  const labelMap: Record<string, string> = {
    consumer: 'Consumer',
    food_beverage: 'Food & Beverage',
    food_and_beverage: 'Food & Beverage',
    apparel_footwear: 'Apparel & Footwear',
    apparel_and_footwear: 'Apparel & Footwear',
    finance: 'Finance',
    technology: 'Technology',
    healthcare: 'Healthcare',
    energy: 'Energy',
    retail: 'Retail',
  };
  const parts = ctx.split(':');
  const slug = parts[parts.length - 1];
  if (labelMap[slug]) return labelMap[slug];
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Map filter context to tint color
function getFilterTint(filterContext: string): string {
  if (filterContext.includes('specialization')) return 'rgba(56, 189, 248, 0.12)';
  if (filterContext.includes('interest')) return 'rgba(236, 72, 153, 0.12)';
  if (filterContext.includes('industry')) return 'rgba(59, 130, 246, 0.12)';
  return 'rgba(251, 146, 60, 0.08)';
}

function getFilterBorder(filterContext: string): string {
  if (filterContext.includes('specialization')) return 'rgba(56, 189, 248, 0.25)';
  if (filterContext.includes('interest')) return 'rgba(236, 72, 153, 0.25)';
  if (filterContext.includes('industry')) return 'rgba(59, 130, 246, 0.25)';
  return 'rgba(251, 146, 60, 0.2)';
}

export default function SnapshotStage({ snapshot, onContinue }: SnapshotStageProps) {
  const { articles_engaged, qa_highlights, reading_pattern, topic_clusters } = snapshot;
  const hasActivity = articles_engaged.length > 0;
  const isWidened = (snapshot as any).widened_window === true;

  return (
    <View style={styles.container}>
      {/* Reading pattern header */}
      <View style={styles.patternHeader}>
        {hasActivity ? (
          <Text style={styles.patternText}>
            {isWidened && <Text style={{ color: DarkThemeColors.textTertiary }}>Recent activity{'\u00A0\u00B7\u00A0'}</Text>}
            Your peak day was <Text style={styles.highlight}>{reading_pattern.peak_day}</Text>
            {reading_pattern.deepest_dive?.article_title !== 'N/A' && (
              <> {'\u00B7'} Deepest dive: <Text style={styles.highlight}>{reading_pattern.deepest_dive.time_spent_minutes} min</Text> on "{reading_pattern.deepest_dive.article_title}"</>
            )}
          </Text>
        ) : (
          <Text style={styles.patternText}>
            No reading activity this week yet
          </Text>
        )}
      </View>

      {/* Empty state */}
      {!hasActivity && (
        <View style={styles.emptyState}>
          <Icon name="book-open-page-variant" size={48} color="rgba(251, 146, 60, 0.3)" />
          <Text style={styles.emptyTitle}>Your week is just getting started</Text>
          <Text style={styles.emptySubtitle}>
            Read articles in Catch-up or Dive-in to build your weekly snapshot. You can still continue to reflect on your reading.
          </Text>
        </View>
      )}

      {/* Article cards */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Topic clusters as pills */}
        {topic_clusters.length > 1 && (
          <View style={styles.clusterRow}>
            {topic_clusters.map((cluster, idx) => (
              <View key={idx} style={styles.clusterPill}>
                <Text style={styles.clusterText}>{formatFilterLabel(cluster.theme)} ({cluster.article_count})</Text>
              </View>
            ))}
          </View>
        )}

        {/* Article cards with filter-colored tints */}
        {articles_engaged.map((article, idx) => (
          <View
            key={article.id || idx}
            style={[
              styles.articleCard,
              { backgroundColor: getFilterTint(article.filter_context),
                borderColor: getFilterBorder(article.filter_context) }
            ]}
          >
            <View style={styles.articleHeader}>
              <Text style={styles.articleTitle} numberOfLines={2}>{article.title}</Text>
              <View style={styles.engagementBadge}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon
                    name={
                      article.engagement_type === 'saved'
                        ? 'bookmark-outline'
                        : article.engagement_type === 'qa_asked'
                        ? 'help-circle-outline'
                        : 'book-open-page-variant'
                    }
                    size={13}
                    color={DarkThemeColors.textSecondary}
                  />
                  <Text style={styles.engagementText}>
                    {article.time_spent_minutes}m
                  </Text>
                </View>
              </View>
            </View>
            {article.source && (
              <Text style={styles.articleSource}>{article.source}</Text>
            )}
            {article.key_quote && (
              <View style={styles.quoteContainer}>
                <Text style={styles.quoteText}>"{article.key_quote}"</Text>
              </View>
            )}
          </View>
        ))}

        {/* Q&A highlights */}
        {qa_highlights.length > 0 && (
          <View style={styles.qaSection}>
            <Text style={styles.qaSectionTitle}>Questions You Asked</Text>
            {qa_highlights.map((qa, idx) => (
              <View key={idx} style={styles.qaCard}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
                  <Icon name="help-circle-outline" size={14} color={DarkThemeColors.textPrimary} style={{ marginTop: 2 }} />
                  <Text style={[styles.qaQuestion, { flex: 1 }]}>{qa.question}</Text>
                </View>
                <Text style={styles.qaArticle}>from "{qa.article_title}"</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Continue button */}
      <TouchableOpacity style={styles.continueButton} onPress={onContinue}>
        <Text style={styles.continueText}>Continue to Questions →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  patternHeader: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.06)',
    ...getBackdropBlur(16),
  },
  patternText: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
    textAlign: 'center',
  },
  highlight: {
    color: RingColors.recap.primary,
    fontWeight: '700',
  },
  scrollArea: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: 80,
  },
  clusterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  clusterPill: {
    backgroundColor: 'rgba(251, 146, 60, 0.1)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.2)',
  },
  clusterText: {
    ...Typography.labelSmall,
    color: RingColors.recap.primary,
  },
  articleCard: {
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderLeftWidth: 4,
    ...getBackdropBlur(12),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  articleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  articleTitle: {
    ...Typography.labelLarge,
    color: DarkThemeColors.textPrimary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  engagementBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.pill,
  },
  engagementText: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textSecondary,
  },
  articleSource: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textTertiary,
    marginTop: 4,
  },
  quoteContainer: {
    marginTop: Spacing.sm,
    paddingLeft: Spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(251, 146, 60, 0.3)',
  },
  quoteText: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
    fontStyle: 'italic',
  },
  qaSection: {
    marginTop: Spacing.lg,
  },
  qaSectionTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginBottom: Spacing.md,
  },
  qaCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  qaQuestion: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textPrimary,
    fontWeight: '500',
  },
  qaArticle: {
    ...Typography.labelSmall,
    color: DarkThemeColors.textTertiary,
    marginTop: 4,
  },
  continueButton: {
    position: 'absolute',
    bottom: 20,
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: RingColors.recap.primary,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.pill,
    alignItems: 'center',
    shadowColor: RingColors.recap.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  continueText: {
    ...Typography.labelLarge,
    color: '#fff',
    fontWeight: '700',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: 80,
  },
  emptyTitle: {
    ...Typography.headlineSmall,
    color: DarkThemeColors.textPrimary,
    marginTop: Spacing.lg,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...Typography.bodySmall,
    color: DarkThemeColors.textSecondary,
    marginTop: Spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
