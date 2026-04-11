import React from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { DiveinArticleCard, DiveinArticleData } from './DiveinArticleCard';
import { DiveinArticleSkeleton } from './DiveinArticleSkeleton';
import Icon from '../ui/Icon';

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
                  <Icon name="bookmark-outline" size={16} color="#38BDF8" />
                  <Text style={styles.sectionTitle}>SAVED FOR LATER</Text>
                  <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{savedArticles.length}</Text>
                  </View>
                </View>
                {renderGrid(savedArticles)}
              </>
            )}

            {/* Section 2: Expert Picks */}
            {expertArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Icon name="star" size={16} color="#F59E0B" />
                  <Text style={styles.sectionTitle}>EXPERT PICKS</Text>
                  <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{expertArticles.length}</Text>
                  </View>
                </View>
                {renderGrid(expertArticles)}
              </>
            )}

            {/* Section 3: More to Explore */}
            {moreArticles.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Icon name="compass-outline" size={16} color="#6B7280" />
                  <Text style={styles.sectionTitle}>MORE TO EXPLORE</Text>
                  <View style={styles.sectionCount}>
                    <Text style={styles.sectionCountText}>{moreArticles.length}</Text>
                  </View>
                </View>
                {renderGrid(moreArticles)}
              </>
            )}
          </>
        )}

        {isLoading && (
          <View style={styles.loadingMore}>
            <ActivityIndicator size="small" color="#38BDF8" />
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
    paddingBottom: 24,
  },
  gridRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 0,
  },
  gridItem: {
    flex: 1,
    maxWidth: '50%',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  sectionIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#64748B',
  },
  sectionCount: {
    marginLeft: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  contextToggle: {
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    maxHeight: 60,
  },
  contextToggleContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  contextButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'transparent',
    marginRight: 8,
  },
  contextButtonActive: {
    backgroundColor: '#38BDF8',
  },
  contextButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
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
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  metaDivider: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.15)',
    marginHorizontal: 6,
  },
  date: {
    fontSize: 13,
    color: '#64748B',
  },
  readingTime: {
    fontSize: 13,
    color: '#64748B',
  },
  headline: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E2E8F0',
    lineHeight: 26,
    marginBottom: 10,
  },
  teaser: {
    fontSize: 14,
    lineHeight: 21,
    color: '#94A3B8',
    marginBottom: 16,
  },
  articleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  contextChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  contextChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'capitalize',
  },
  startButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
  },
  startButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    paddingHorizontal: 32,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  loadingMoreText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  endOfFeed: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  endOfFeedText: {
    fontSize: 14,
    color: '#64748B',
    fontStyle: 'italic',
  },
});
