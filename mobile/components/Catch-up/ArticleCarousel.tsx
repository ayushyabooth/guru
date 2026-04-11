import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet, Dimensions, Platform } from 'react-native';
import Icon from '../ui/Icon';
import { DarkTheme } from '../../constants/darkTheme';
import {
  Spacing,
  Typography,
  BorderRadius,
  DarkGlassMaterials,
  RingColors,
} from '../../constants/liquidGlass';

interface CarouselArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  word_count?: number;
  thumbnail_url?: string;
  category_accent?: string; // For left border color
}

interface ArticleCarouselProps {
  articles: CarouselArticle[];
  currentInFocusId: string;
  onSelectArticle: (articleId: string) => void;
  isDark?: boolean;
  categoryAccent?: string; // Category hue for left border
}

const { width: screenWidth } = Dimensions.get('window');
const CARD_WIDTH = screenWidth < 500 ? 140 : screenWidth < 768 ? 160 : 180;
const CARD_GAP = 12;

// Gradient colors for carousel cards without images
const CARD_GRADIENTS = [
  { primary: '#4F46E5', secondary: '#7C3AED' },
  { primary: '#38BDF8', secondary: '#059669' },
  { primary: '#F97316', secondary: '#FBBF24' },
  { primary: '#EC4899', secondary: '#F43F5E' },
  { primary: '#6366F1', secondary: '#EC4899' },
  { primary: '#0EA5E9', secondary: '#22D3EE' },
];

export const ArticleCarousel: React.FC<ArticleCarouselProps> = ({
  articles,
  currentInFocusId,
  onSelectArticle,
  isDark = false,
  categoryAccent = '#38BDF8'
}) => {
  if (!articles || articles.length === 0) return null;

  const getReadingTime = (wordCount?: number): number => {
    if (!wordCount || wordCount === 0) return 3;
    return Math.max(1, Math.round(wordCount / 200));
  };

  const truncateTitle = (title: string | null | undefined, maxLength: number = 50): string => {
    if (!title) return 'Untitled';
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength - 3) + '...';
  };

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.header}>
        <Text style={[styles.headerText, isDark && styles.headerTextDark]}>
          Also in this story
        </Text>
        <Text style={[styles.countBadge, isDark && styles.countBadgeDark]}>
          {articles.length} articles
        </Text>
      </View>
      
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        decelerationRate="fast"
        snapToInterval={CARD_WIDTH + CARD_GAP}
        snapToAlignment="start"
      >
        {articles.map((article, index) => {
          const isCurrentFocus = article.id === currentInFocusId;
          const readingTime = getReadingTime(article.word_count);
          
          return (
            <TouchableOpacity
              key={article.id}
              style={[
                styles.card,
                isDark && styles.cardDark,
                isCurrentFocus && styles.cardActive,
                Platform.OS === 'web' && styles.cardWeb,
                { borderLeftColor: article.category_accent || categoryAccent, borderLeftWidth: 4 }
              ]}
              onPress={() => !isCurrentFocus && onSelectArticle(article.id)}
              activeOpacity={isCurrentFocus ? 1 : 0.7}
              disabled={isCurrentFocus}
            >
              <View 
                style={[
                  styles.thumbnail, 
                  isDark && styles.thumbnailDark,
                  !article.thumbnail_url && { backgroundColor: CARD_GRADIENTS[index % CARD_GRADIENTS.length].primary }
                ]}
              >
                {article.thumbnail_url ? (
                  <Image
                    source={{ uri: article.thumbnail_url }}
                    style={styles.thumbnailImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.gradientPlaceholder}>
                    <Icon name="file-document-outline" size={20} color="rgba(255,255,255,0.7)" />
                    <View style={styles.placeholderLines}>
                      <View style={styles.placeholderLine} />
                      <View style={[styles.placeholderLine, { width: '60%' }]} />
                    </View>
                  </View>
                )}
                {isCurrentFocus && (
                  <View style={styles.inFocusBadge}>
                    <Text style={styles.inFocusText}>In Focus</Text>
                  </View>
                )}
              </View>
              
              <View style={styles.cardContent}>
                <Text 
                  style={[styles.cardTitle, isDark && styles.cardTitleDark]}
                  numberOfLines={2}
                >
                  {truncateTitle(article.title, 60)}
                </Text>
                <View style={styles.cardMeta}>
                  <Text style={[styles.cardSource, isDark && styles.cardSourceDark]} numberOfLines={1}>
                    {article.source || 'Unknown'}
                  </Text>
                  <Text style={styles.cardTime}>
                    {readingTime} min
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      
      <Text style={[styles.hint, isDark && styles.hintDark]}>
        Tap to bring into focus
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: DarkTheme.glassSectionBorder,
    backgroundColor: 'transparent',
  },
  containerDark: {
    borderTopColor: DarkTheme.glassBorder,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  headerText: {
    ...Typography.labelLarge,
    color: DarkTheme.textPrimary,
  },
  headerTextDark: {
    color: DarkTheme.textPrimary,
  },
  countBadge: {
    ...Typography.labelMedium,
    color: DarkTheme.textSecondary,
    backgroundColor: DarkTheme.glassHighlight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeDark: {
    color: DarkTheme.textSecondary,
    backgroundColor: DarkTheme.glassBorder,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    ...DarkGlassMaterials.cardLight,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
      web: {
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      },
    }),
  },
  cardWeb: {
    backgroundColor: DarkTheme.glassLight,
    // @ts-ignore - backdropFilter is valid for web but not in RN types
    backdropFilter: 'blur(12px)',
    borderWidth: 1,
    borderColor: DarkTheme.glassBorder,
  },
  cardDark: {
    backgroundColor: DarkTheme.glassHighlight,
  },
  cardActive: {
    borderWidth: 2,
    borderColor: RingColors.catchup.primary,
    opacity: 0.8,
  },
  thumbnail: {
    height: 80,
    backgroundColor: DarkTheme.glassHighlight,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  thumbnailDark: {
    backgroundColor: DarkTheme.glassBorder,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailEmoji: {
    fontSize: 28,
  },
  gradientPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 8,
  },
  placeholderIcon: {
    fontSize: 20,
    marginBottom: 6,
  },
  placeholderLines: {
    width: '80%',
    gap: 4,
  },
  placeholderLine: {
    height: 4,
    backgroundColor: DarkTheme.glassLight,
    borderRadius: 2,
    width: '100%',
  },
  inFocusBadge: {
    position: 'absolute',
    top: Spacing.xs,
    right: Spacing.xs,
    backgroundColor: RingColors.catchup.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  inFocusText: {
    ...Typography.labelSmall,
    fontSize: 9,
    color: '#FFFFFF',
  },
  cardContent: {
    padding: Spacing.sm,
  },
  cardTitle: {
    ...Typography.bodySmall,
    fontWeight: '500',
    color: DarkTheme.textPrimary,
    lineHeight: 18,
    minHeight: 36,
  },
  cardTitleDark: {
    color: DarkTheme.textPrimary,
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  cardSource: {
    ...Typography.labelSmall,
    color: DarkTheme.textSecondary,
    flex: 1,
    marginRight: Spacing.sm,
  },
  cardSourceDark: {
    color: DarkTheme.textSecondary,
  },
  cardTime: {
    ...Typography.labelSmall,
    fontWeight: '500',
    color: RingColors.catchup.primary,
  },
  hint: {
    ...Typography.labelSmall,
    color: DarkTheme.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.sm,
    fontStyle: 'italic',
  },
  hintDark: {
    color: DarkTheme.textTertiary,
  },
});
