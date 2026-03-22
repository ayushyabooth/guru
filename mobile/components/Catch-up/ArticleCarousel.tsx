import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet, Dimensions, Platform } from 'react-native';
import Icon from '../ui/Icon';

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
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'transparent',
  },
  containerDark: {
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  headerTextDark: {
    color: '#E5E7EB',
  },
  countBadge: {
    fontSize: 12,
    color: '#94A3B8',
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeDark: {
    color: '#CBD5E1',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
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
    // Liquid glass effect for web
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    // @ts-ignore - backdropFilter is valid for web but not in RN types
    backdropFilter: 'blur(12px)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardDark: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  cardActive: {
    borderWidth: 2,
    borderColor: '#38BDF8',
    opacity: 0.8,
  },
  thumbnail: {
    height: 80,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  thumbnailDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 2,
    width: '100%',
  },
  inFocusBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#38BDF8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  inFocusText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cardContent: {
    padding: 8,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#E2E8F0',
    lineHeight: 18,
    minHeight: 36,
  },
  cardTitleDark: {
    color: '#F3F4F6',
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  cardSource: {
    fontSize: 11,
    color: '#94A3B8',
    flex: 1,
    marginRight: 8,
  },
  cardSourceDark: {
    color: '#9CA3AF',
  },
  cardTime: {
    fontSize: 11,
    fontWeight: '500',
    color: '#38BDF8',
  },
  hint: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  hintDark: {
    color: '#6B7280',
  },
});
