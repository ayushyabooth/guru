import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform, useWindowDimensions } from 'react-native';
import { getFilterColors } from '../../constants/theme';
import Icon from '../ui/Icon';

export interface RelatedArticle {
  id: string;
  headline: string;
  context: string;
  source: string;
  readingTime: number;
  teaser?: string;
  thumbnailUrl?: string;
}

interface RelatedArticlesProps {
  articles: RelatedArticle[];
  onArticleClick: (article: RelatedArticle) => void;
}

export const RelatedArticles: React.FC<RelatedArticlesProps> = ({
  articles,
  onArticleClick,
}) => {
  const { width } = useWindowDimensions();
  const numColumns = width >= 600 ? 2 : 1;

  if (!articles || articles.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.sectionHeader}>
          <Icon name="bookshelf" size={14} color="#94A3B8" />
          <Text style={[styles.sectionTitle, { marginBottom: 0, paddingHorizontal: 0 }]}>THESE ARTICLES EXPAND ON THIS TOPIC</Text>
        </View>
        <Text style={styles.emptyText}>No related articles in this topic</Text>
      </View>
    );
  }

  // Show max 4 related articles in hero card format
  const displayedArticles = articles.slice(0, 4);

  // Render two-column grid of hero cards
  const renderGrid = () => {
    if (numColumns === 1) {
      return displayedArticles.map((article) => renderHeroCard(article));
    }

    const rows = [];
    for (let i = 0; i < displayedArticles.length; i += numColumns) {
      const rowItems = displayedArticles.slice(i, i + numColumns);
      rows.push(
        <View key={`row-${i}`} style={styles.gridRow}>
          {rowItems.map((article) => (
            <View key={article.id} style={styles.gridItem}>
              {renderHeroCard(article)}
            </View>
          ))}
          {rowItems.length < numColumns && <View style={styles.gridItem} />}
        </View>
      );
    }
    return rows;
  };

  const renderHeroCard = (article: RelatedArticle) => {
    const filterColors = getFilterColors(article.context);

    // Dark glassmorphic style
    const liquidGlassStyle = Platform.OS === 'web' ? {
      background: `linear-gradient(145deg, rgba(255,255,255,0.06) 0%, ${filterColors.accent}10 50%, rgba(255,255,255,0.04) 100%)`,
      boxShadow: `0 4px 20px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.05) inset`,
    } : {
      backgroundColor: 'rgba(255,255,255,0.06)',
    };

    return (
      <TouchableOpacity
        key={article.id}
        style={[styles.heroCard, liquidGlassStyle]}
        onPress={() => onArticleClick(article)}
        activeOpacity={0.8}
      >
        {/* Accent strip */}
        <View style={[styles.accentStrip, { backgroundColor: filterColors.accent }]} />

        {/* Hero image */}
        <View style={styles.heroImageContainer}>
          {article.thumbnailUrl ? (
            <Image
              source={{ uri: article.thumbnailUrl }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.heroPlaceholder, { backgroundColor: filterColors.accent + '12' }]}>
              <Icon name={filterColors.icon} size={28} color={filterColors.accent} library={filterColors.iconLibrary as 'mci' | 'mi'} style={{ opacity: 0.4 }} />
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          <Text style={styles.cardHeadline} numberOfLines={2}>
            {article.headline}
          </Text>
          <Text style={styles.cardMeta}>
            {article.source} {'\u00B7'} {article.readingTime} min
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Icon name="bookshelf" size={14} color="#94A3B8" />
        <Text style={[styles.sectionTitle, { marginBottom: 0, paddingHorizontal: 0 }]}>THESE ARTICLES EXPAND ON THIS TOPIC</Text>
      </View>
      <View style={styles.gridContainer}>
        {renderGrid()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 32,
    paddingVertical: 24,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 15,
    color: '#64748B',
    fontStyle: 'italic',
    paddingHorizontal: 16,
  },
  gridContainer: {
    paddingHorizontal: 8,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 0,
  },
  gridItem: {
    flex: 1,
    maxWidth: '50%',
  },
  heroCard: {
    marginHorizontal: 8,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  accentStrip: {
    height: 3,
    width: '100%',
  },
  heroImageContainer: {
    aspectRatio: 16 / 10,
    maxHeight: 100,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroPlaceholderIcon: {
    opacity: 0.5,
  },
  cardContent: {
    padding: 12,
  },
  cardHeadline: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E2E8F0',
    lineHeight: 20,
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 12,
    color: '#94A3B8',
  },
  articleTeaser: {
    fontSize: 14,
    color: '#94A3B8',
    lineHeight: 20,
    fontStyle: 'italic',
  },
  seeAllButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    alignSelf: 'center',
  },
  seeAllText: {
    fontSize: 15,
    color: '#38BDF8',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
