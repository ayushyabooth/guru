import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { DiveinArticleCard, DiveinArticleData } from './DiveinArticleCard';
import { DiveinArticleSkeleton } from './DiveinArticleSkeleton';
import Icon from '../ui/Icon';
import { DarkTheme } from '../../constants/darkTheme';
import {
  Spacing,
  Typography,
  BorderRadius,
  DarkGlassMaterials,
  RingColors,
} from '../../constants/liquidGlass';

export interface DiveinArticle {
  id: string;
  headline: string;
  source: string;
  publishDate: string;
  readingTime: number;
  teaser: string;
  priority: 'essential' | 'saved' | 'normal';
  context: string;
  industry: string;
  url: string;
  thumbnailUrl?: string;
  richSummary?: {
    whats_in_article?: string;
    why_it_matters?: string;
    between_the_lines?: string;
    spotlight_quotes?: string[];
  };
  isSaved: boolean;
  isEssential: boolean;
}

interface DiveinFeedProps {
  articles: DiveinArticle[];
  onLoadMore: () => void;
  onNotRelevant: (articleId: string) => void;
  hasMore: boolean;
  isLoading: boolean;
  filterContext?: string;
}

export const DiveinFeed: React.FC<DiveinFeedProps> = ({
  articles,
  onLoadMore,
  onNotRelevant,
  hasMore,
  isLoading,
  filterContext = 'core',
}) => {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const numColumns = width >= 768 ? 2 : width >= 600 ? 2 : 1;

  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const isCloseToBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 100;
    
    if (isCloseToBottom && hasMore && !isLoading) {
      onLoadMore();
    }
  };

  const handleDiveIn = (articleId: string) => {
    // Navigation handled by card component
  };

  // Three sections: Saved → Expert Picks → More Articles
  const savedArticles = articles.filter(a => a.isSaved);
  const expertArticles = articles.filter(a => a.isEssential && !a.isSaved);
  const moreArticles = articles.filter(a => !a.isSaved && !a.isEssential);

  // Convert to card data format
  const toCardData = (article: DiveinArticle): DiveinArticleData => ({
    id: article.id,
    headline: article.headline,
    source: article.source,
    publishDate: article.publishDate,
    readingTime: article.readingTime,
    teaser: article.teaser,
    priority: article.priority,
    context: article.context,
    industry: article.industry,
    url: article.url,
    thumbnailUrl: article.thumbnailUrl,
    richSummary: article.richSummary,
    isSaved: article.isSaved,
    isEssential: article.isEssential,
  });

  // Render a grid of cards
  const renderGrid = (articleList: DiveinArticle[]) => {
    if (numColumns === 1) {
      return articleList.map((article) => (
        <DiveinArticleCard
          key={article.id}
          article={toCardData(article)}
          onDiveIn={handleDiveIn}
          onNotRelevant={onNotRelevant}
          filterContext={filterContext}
        />
      ));
    }

    // Two-column grid
    const rows = [];
    for (let i = 0; i < articleList.length; i += numColumns) {
      const rowItems = articleList.slice(i, i + numColumns);
      rows.push(
        <View key={`row-${i}`} style={styles.gridRow}>
          {rowItems.map((article) => (
            <View key={article.id} style={styles.gridItem}>
              <DiveinArticleCard
                article={toCardData(article)}
                onDiveIn={handleDiveIn}
                onNotRelevant={onNotRelevant}
                compact
                filterContext={filterContext}
              />
            </View>
          ))}
          {rowItems.length < numColumns && (
            <View style={styles.gridItem} />
          )}
        </View>
      );
    }
    return rows;
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.feedContainer}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        contentContainerStyle={styles.scrollContent}
      >
        {isLoading && articles.length === 0 ? (
          <DiveinArticleSkeleton />
        ) : articles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No articles in this context</Text>
            <Text style={styles.emptyStateSubtext}>Try switching to another context or save some articles</Text>
          </View>
        ) : (
          <>
            {/* Section 1: Saved Articles */}
            {savedArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionPill}>
                    <Icon name="bookmark-outline" size={14} color={RingColors.divein.primary} />
                    <Text style={styles.sectionTitle}>SAVED FOR LATER</Text>
                    <View style={styles.sectionCount}>
                      <Text style={styles.sectionCountText}>{savedArticles.length}</Text>
                    </View>
                  </View>
                  {/* R24 (founder): crux-building lives in the agent — ONE
                      section-level door instead of per-card CTAs. */}
                  <TouchableOpacity
                    onPress={() => router.push(`/guru?goal=${encodeURIComponent('Dive-in crux: walk my saved queue and build the crux of each article')}`)}
                    accessibilityRole="button"
                    accessibilityLabel="Build cruxes with Guru"
                    style={{ marginLeft: 'auto', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12, borderWidth: 1, backgroundColor: 'rgba(99,102,241,0.14)', borderColor: 'rgba(129,140,248,0.32)' }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#A5B4FC' }}>Build cruxes with Guru →</Text>
                  </TouchableOpacity>
                </View>
                {renderGrid(savedArticles)}
              </>
            )}

            {/* Section 2: Expert Picks */}
            {expertArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionPill}>
                    <Icon name="star" size={14} color={DarkTheme.warning} />
                    <Text style={styles.sectionTitle}>EXPERT PICKS</Text>
                    <View style={styles.sectionCount}>
                      <Text style={styles.sectionCountText}>{expertArticles.length}</Text>
                    </View>
                  </View>
                </View>
                {renderGrid(expertArticles)}
              </>
            )}

            {/* Section 3: More to Explore */}
            {moreArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionPill}>
                    <Icon name="compass-outline" size={14} color={DarkTheme.textTertiary} />
                    <Text style={styles.sectionTitle}>MORE TO EXPLORE</Text>
                    <View style={styles.sectionCount}>
                      <Text style={styles.sectionCountText}>{moreArticles.length}</Text>
                    </View>
                  </View>
                </View>
                {renderGrid(moreArticles)}
              </>
            )}
          </>
        )}

        {isLoading && (
          <View style={styles.loadingMore}>
            <ActivityIndicator size="small" color={RingColors.divein.primary} />
            <Text style={styles.loadingMoreText}>Loading more articles...</Text>
          </View>
        )}

        {!hasMore && articles.length > 0 && (
          <View style={styles.endOfFeed}>
            <Text style={styles.endOfFeedText}>You've reached the end</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  gridRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    gap: 0,
  },
  gridItem: {
    flex: 1,
    maxWidth: '50%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: 20,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  sectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    ...DarkGlassMaterials.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    gap: 6,
  },
  sectionIcon: {
    fontSize: 16,
    marginRight: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.7)',
  },
  sectionCount: {
    marginLeft: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionCountText: {
    ...Typography.labelSmall,
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '600',
  },
  contextToggle: {
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: DarkTheme.glassSectionBorder,
    maxHeight: 60,
  },
  contextToggleContent: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  contextButton: {
    paddingHorizontal: 20,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.xl,
    backgroundColor: 'transparent',
    marginRight: Spacing.sm,
  },
  contextButtonActive: {
    backgroundColor: RingColors.divein.primary,
  },
  contextButtonText: {
    ...Typography.labelLarge,
    color: DarkTheme.textSecondary,
  },
  contextButtonTextActive: {
    color: '#FFFFFF',
  },
  feedContainer: {
    flex: 1,
  },
  articleCard: {
    backgroundColor: 'transparent',
    marginHorizontal: 16,
    marginTop: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  articleHeader: {
    marginBottom: 12,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginBottom: 8,
  },
  priorityIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  priorityLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  articleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  source: {
    ...Typography.labelMedium,
    color: DarkTheme.textSecondary,
  },
  metaDivider: {
    ...Typography.labelMedium,
    color: DarkTheme.glassBorder,
    marginHorizontal: 6,
  },
  date: {
    ...Typography.labelMedium,
    color: DarkTheme.textTertiary,
  },
  readingTime: {
    ...Typography.labelMedium,
    color: DarkTheme.textTertiary,
  },
  headline: {
    ...Typography.headlineSmall,
    color: DarkTheme.textPrimary,
    lineHeight: 26,
    marginBottom: 10,
  },
  teaser: {
    ...Typography.bodyMedium,
    lineHeight: 21,
    color: DarkTheme.textSecondary,
    marginBottom: Spacing.md,
  },
  articleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  contextChip: {
    ...DarkGlassMaterials.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
  },
  contextChipText: {
    ...Typography.labelMedium,
    color: DarkTheme.textSecondary,
    textTransform: 'capitalize',
  },
  startButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: BorderRadius.sm,
    backgroundColor: RingColors.divein.primary,
  },
  startButtonText: {
    ...Typography.labelLarge,
    color: '#FFFFFF',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: Spacing.xl,
  },
  emptyStateText: {
    ...Typography.headlineSmall,
    color: DarkTheme.textSecondary,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    ...Typography.bodyMedium,
    color: DarkTheme.textTertiary,
    textAlign: 'center',
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  loadingMoreText: {
    ...Typography.bodyMedium,
    color: DarkTheme.textSecondary,
  },
  endOfFeed: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  endOfFeedText: {
    ...Typography.bodyMedium,
    color: DarkTheme.textTertiary,
    fontStyle: 'italic',
  },
});
