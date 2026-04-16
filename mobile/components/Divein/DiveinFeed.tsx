import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { DiveinArticleCard, DiveinArticleData } from './DiveinArticleCard';
import { DiveinArticleSkeleton } from './DiveinArticleSkeleton';
import Icon from '../ui/Icon';
import {
  Spacing,
  Typography,
  BorderRadius,
  DarkGlassMaterials,
  GlassMaterials,
  RingColors,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

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
  filterLabel?: string;
}

export const DiveinFeed: React.FC<DiveinFeedProps> = ({
  articles,
  onLoadMore,
  onNotRelevant,
  hasMore,
  isLoading,
  filterContext = 'core',
  filterLabel,
}) => {
  const { width } = useWindowDimensions();
  const numColumns = width >= 768 ? 2 : width >= 600 ? 2 : 1;
  const { isDark, colors } = useTheme();

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

  // Client-side filter: only apply when a non-core, non-all filter is selected
  const needsClientFilter =
    filterContext !== 'all' &&
    filterContext !== 'core' &&
    !!filterLabel &&
    filterLabel !== 'All';

  const visibleArticles = needsClientFilter
    ? articles.filter(a => {
        const industry = (a.industry || a.context || '').toLowerCase();
        const label = filterLabel!.toLowerCase();
        return industry.includes(label) || label.includes(industry);
      })
    : articles;

  // Three sections: Saved → Expert Picks → More Articles
  const savedArticles = visibleArticles.filter(a => a.isSaved);
  const expertArticles = visibleArticles.filter(a => a.isEssential && !a.isSaved);
  const moreArticles = visibleArticles.filter(a => !a.isSaved && !a.isEssential);

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

  // Theme-aware section pill material
  const pillMaterial = isDark ? DarkGlassMaterials.pill : GlassMaterials.pill;
  const sectionTitleColor = isDark ? 'rgba(255,255,255,0.7)' : colors.textSecondary;
  const sectionCountBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const sectionCountTextColor = isDark ? 'rgba(255,255,255,0.5)' : colors.textTertiary;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.feedContainer}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        contentContainerStyle={styles.scrollContent}
      >
        {isLoading && visibleArticles.length === 0 ? (
          <DiveinArticleSkeleton />
        ) : visibleArticles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>No articles in this context</Text>
            <Text style={[styles.emptyStateSubtext, { color: colors.textTertiary }]}>Try switching to another context or save some articles</Text>
          </View>
        ) : (
          <>
            {/* Section 1: Saved Articles */}
            {savedArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionPill, pillMaterial]}>
                    <Icon name="bookmark-outline" size={14} color={RingColors.divein.primary} />
                    <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>SAVED FOR LATER</Text>
                    <View style={[styles.sectionCount, { backgroundColor: sectionCountBg }]}>
                      <Text style={[styles.sectionCountText, { color: sectionCountTextColor }]}>{savedArticles.length}</Text>
                    </View>
                  </View>
                </View>
                {renderGrid(savedArticles)}
              </>
            )}

            {/* Section 2: Expert Picks */}
            {expertArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <View style={[styles.sectionPill, pillMaterial]}>
                    <Icon name="star" size={14} color={colors.warning} />
                    <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>EXPERT PICKS</Text>
                    <View style={[styles.sectionCount, { backgroundColor: sectionCountBg }]}>
                      <Text style={[styles.sectionCountText, { color: sectionCountTextColor }]}>{expertArticles.length}</Text>
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
                  <View style={[styles.sectionPill, pillMaterial]}>
                    <Icon name="compass-outline" size={14} color={colors.textTertiary} />
                    <Text style={[styles.sectionTitle, { color: sectionTitleColor }]}>MORE TO EXPLORE</Text>
                    <View style={[styles.sectionCount, { backgroundColor: sectionCountBg }]}>
                      <Text style={[styles.sectionCountText, { color: sectionCountTextColor }]}>{moreArticles.length}</Text>
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
            <Text style={[styles.loadingMoreText, { color: colors.textSecondary }]}>Loading more articles...</Text>
          </View>
        )}

        {!hasMore && visibleArticles.length > 0 && (
          <View style={styles.endOfFeed}>
            <Text style={[styles.endOfFeedText, { color: colors.textTertiary }]}>You've reached the end</Text>
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
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    gap: 6,
    // borderRadius and bg applied dynamically via pillMaterial
  },
  sectionTitle: {
    ...Typography.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.8,
    // color applied inline
  },
  sectionCount: {
    marginLeft: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    // backgroundColor applied inline
  },
  sectionCountText: {
    ...Typography.labelSmall,
    fontWeight: '600',
    // color applied inline
  },
  feedContainer: {
    flex: 1,
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
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    ...Typography.bodyMedium,
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
  },
  endOfFeed: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  endOfFeedText: {
    ...Typography.bodyMedium,
    fontStyle: 'italic',
  },
});
