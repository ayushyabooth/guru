import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
  Dimensions,
  Platform,
  Animated,
  Image,
  Modal
} from 'react-native';
import { useRouter } from 'expo-router';
import { Storyboard } from '../../services/article-service';
import { trackInteraction } from '../../services/interaction-tracker';
import { RichSummarySection } from './RichSummarySection';
import { SocraticPromptsSection } from './SocraticPromptsSection';
import { ArticleCarousel } from './ArticleCarousel';
import { InFocusActionButtons } from './InFocusActionButtons';
import SocraticQAModal from './SocraticQAModal';
import { getFilterColors } from '../../constants/theme';
import { getIndustryConfig } from '../../constants/industryConfig';
import {
  Spacing,
  Typography,
  BorderRadius,
  DarkGlassMaterials,
  RingColors,
} from '../../constants/liquidGlass';
import Icon from '../ui/Icon';
import { HeroGradientFallback } from '../ui/HeroGradientFallback';
import { useTheme } from '../../contexts/ThemeContext';

/** Convert raw slug like "food_beverage" → "Food & Beverage" */
function formatIndustryLabel(slug: string | undefined | null): string {
  if (!slug) return 'Consumer';
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
    media: 'Media',
    automotive: 'Automotive',
  };
  const lower = slug.toLowerCase();
  if (labelMap[lower]) return labelMap[lower];
  // Fallback: capitalize words and replace underscores
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface InFocusStoryboardCardProps {
  storyboard: Storyboard;
  onSave: (articleId: string) => void;
  onNotRelevant: (storyboardId: string) => void;
}

const BADGE_CONFIG: Record<string, { icon: string; color: string; darkColor: string }> = {
  'Essential': { icon: 'star', color: '#EF4444', darkColor: '#FCA5A5' },
  'Normal': { icon: 'file-document-outline', color: '#6B7280', darkColor: '#9CA3AF' }
};

export const InFocusStoryboardCard: React.FC<InFocusStoryboardCardProps> = ({
  storyboard,
  onSave,
  onNotRelevant,
}) => {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { width } = Dimensions.get('window');
  const isMobile = width < 500;

  // State for tracking which article is in focus
  const [inFocusArticleId, setInFocusArticleId] = useState(storyboard.headline_article?.id);
  const [savedArticles, setSavedArticles] = useState<Set<string>>(new Set());
  const [fadeAnim] = useState(new Animated.Value(1));

  // Get the current in-focus article
  const getInFocusArticle = () => {
    if (inFocusArticleId === storyboard.headline_article?.id) {
      return storyboard.headline_article;
    }
    // Find in narrative_articles - they now have rich content too!
    const found = storyboard.narrative_articles?.find(a => a.id === inFocusArticleId);
    if (found) {
      return {
        ...found,
        source: found.source || 'Unknown',
        is_paywalled: found.is_paywalled || false,
        is_saved: false,
        created_at: found.created_at || new Date().toISOString(),
        // Rich content is now included from backend for ALL articles
        rich_summary: found.rich_summary || null,
        socratic_prompts: found.socratic_prompts || []
      };
    }
    return storyboard.headline_article;
  };

  const inFocusArticle = getInFocusArticle();

  // Get category colors from centralized config
  const categoryColors = getFilterColors(storyboard.industry);

  // Get current in-focus article's image
  const getCurrentHeroImage = () => {
    if (inFocusArticleId === storyboard.headline_article?.id) {
      return storyboard.visual_url;
    }
    const narrativeArticle = storyboard.narrative_articles?.find(a => a.id === inFocusArticleId);
    return narrativeArticle?.thumbnail_url || narrativeArticle?.visual_url || storyboard.visual_url;
  };

  const currentHeroImage = getCurrentHeroImage();

  // Build carousel articles (all articles except currently in focus)
  const getCarouselArticles = () => {
    const allArticles = [
      {
        id: storyboard.headline_article?.id || '',
        title: storyboard.headline_article?.title || '',
        source: storyboard.headline_article?.source || '',
        url: storyboard.headline_article?.url || '',
        word_count: storyboard.headline_article?.word_count,
        thumbnail_url: storyboard.visual_url,
        category_accent: categoryColors.accent
      },
      ...(storyboard.narrative_articles || []).map(a => ({
        id: a.id,
        title: a.title || 'Untitled',
        source: a.source || 'Unknown',
        url: a.url,
        word_count: a.word_count,
        thumbnail_url: a.thumbnail_url || a.visual_url,
        category_accent: categoryColors.accent
      }))
    ];
    return allArticles.filter(a => a.id && a.id !== inFocusArticleId);
  };

  const carouselArticles = getCarouselArticles();

  const getReadingTime = (wordCount?: number): number => {
    if (!wordCount || wordCount === 0) return 3;
    return Math.max(1, Math.round(wordCount / 200));
  };

  const handleSwapInFocus = (articleId: string) => {
    // Fade out, swap, fade in for smooth transition
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Swap article after fade starts
    setTimeout(() => {
      setInFocusArticleId(articleId);
    }, 150);
  };

  // Socratic Q&A Modal state
  const [showSocraticModal, setShowSocraticModal] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState('');

  const handleStartReading = (articleId: string) => {
    // On web: open article in new tab (user gesture context avoids popup blocker)
    if (Platform.OS === 'web') {
      const articles = getCarouselArticles();
      const article = articles.find(a => a.id === articleId);
      if (article?.url) {
        window.open(article.url, '_blank');
      }
    }
    router.push(`/article/${articleId}?source=catchup`);
  };

  const handleSave = (articleId: string) => {
    setSavedArticles(prev => new Set(prev).add(articleId));
    onSave(articleId);
  };

  const handleNotRelevant = () => {
    onNotRelevant(storyboard.id);
  };

  const handleQuestionTap = (question: string, index: number) => {
    setSelectedQuestion(question);
    setShowSocraticModal(true);
  };

  const handleQuotePress = (quote: string) => {
    // Track spotlight tap for recap
    trackInteraction({
      interactionType: 'spotlight_tap',
      articleId: inFocusArticle?.id,
      content: quote,
      metadata: { storyboard_id: storyboard.id, industry: storyboard.industry },
    });
    // Navigate to article reader with quote to highlight/scroll to
    router.push(`/article/${inFocusArticle?.id}?highlightQuote=${encodeURIComponent(quote)}&source=catchup`);
  };

  if (!inFocusArticle) {
    return null;
  }

  const readingTime = getReadingTime(inFocusArticle.word_count);
  const specialization = storyboard.specializations?.[0] || '';

  // Get industry icon from centralized config
  const industryConfig = getIndustryConfig(storyboard.industry);

  // Dark glassmorphism with ambient category glow
  const liquidGlassStyle = Platform.OS === 'web' ? {
    background: isDark
      ? `linear-gradient(145deg, rgba(15,20,35,0.65) 0%, rgba(15,20,35,0.55) 50%, rgba(15,20,35,0.60) 100%)`
      : `linear-gradient(145deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.95) 40%, ${categoryColors.accent}12 100%)`,
    backdropFilter: isDark ? 'blur(40px) saturate(200%)' : 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: isDark ? 'blur(40px) saturate(200%)' : 'blur(24px) saturate(180%)',
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : `${categoryColors.accent}50`,
    boxShadow: isDark
      ? `0 0 80px ${categoryColors.accent}20, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`
      : `0 4px 32px ${categoryColors.accent}25, 0 16px 64px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 ${categoryColors.accent}15`,
  } : {
    backgroundColor: isDark ? 'rgba(15,20,35,0.75)' : '#FFFFFF',
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
  };

  // Hero image gradient overlay (fades from image to transparent at bottom)
  const heroGradientOverlay = Platform.OS === 'web' ? {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
    background: 'linear-gradient(to bottom, transparent 0%, rgba(10,14,23,0.8) 100%)',
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
  } : {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: 'rgba(10,14,23,0.5)',
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
  };

  // Content area glass panel styling
  const contentGlassStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    background: isDark
      ? 'rgba(15,20,35,0.18)'
      : 'rgba(255,255,255,0.15)',
    borderTopWidth: 1,
    borderTopColor: isDark
      ? 'rgba(255,255,255,0.12)'
      : 'rgba(255,255,255,0.4)',
  } : {
    backgroundColor: isDark
      ? 'rgba(15,20,35,0.15)'
      : 'rgba(255,255,255,0.1)',
    borderTopWidth: 1,
    borderTopColor: isDark
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(255,255,255,0.3)',
  };

  // Category pill glass style with accent tint + glow
  const categoryPillGlassStyle = Platform.OS === 'web' ? {
    backgroundColor: `${categoryColors.accent}18`,
    borderColor: `${categoryColors.accent}35`,
    boxShadow: `0 0 12px ${categoryColors.accent}20`,
  } : {
    backgroundColor: `${categoryColors.accent}20`,
    borderColor: `${categoryColors.accent}40`,
  };

  return (
    <View
      style={[
        styles.card,
        isDark && styles.cardDark,
        liquidGlassStyle,
        ...(!isDark ? [{ shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 }] : []),
      ]}
      data-testid="in-focus-storyboard-card"
    >
      {/* Accent strip at top for category color pop */}
      <View style={[styles.accentStrip, { backgroundColor: categoryColors.accent }]} />

      {/* HERO IMAGE SECTION — with gradient overlay */}
      <Animated.View style={[styles.heroSection, { opacity: fadeAnim }]}>
        {currentHeroImage ? (
          <View style={{ position: 'relative' }}>
            <Image
              source={{ uri: currentHeroImage }}
              style={styles.heroImage}
              resizeMode="cover"
            />
            {/* Gradient overlay fading from image to transparent at bottom */}
            <View style={heroGradientOverlay} />
          </View>
        ) : (
          <HeroGradientFallback
            accentFrom={industryConfig.accent}
            accentTo={industryConfig.accentSecondary || industryConfig.accent}
            emoji={industryConfig.emoji}
            height={180}
          />
        )}
      </Animated.View>

      {/* Category Pill — glass with accent tint and glow */}
      <View style={[styles.categoryBadge, categoryPillGlassStyle]}>
        <Icon name={industryConfig.icon} size={14} color={categoryColors.accent} />
        <Text style={[styles.categoryText, { color: categoryColors.accent }]}>
          {formatIndustryLabel(storyboard.industry)}
        </Text>
        {specialization && (
          <>
            <Text style={[styles.categoryDot, { color: categoryColors.accent }]}>•</Text>
            <Text style={[styles.categoryText, { color: categoryColors.accent }]}>
              {formatIndustryLabel(specialization)}
            </Text>
          </>
        )}
      </View>

      {/* IN FOCUS ARTICLE SECTION — glass overlay panel */}
      <Animated.View style={[styles.inFocusSection, contentGlassStyle, { opacity: fadeAnim }]}>
        {/* Headline */}
        <TouchableOpacity
          onPress={() => Linking.openURL(inFocusArticle.url)}
          activeOpacity={0.7}
          style={styles.headlineContainer}
        >
          <Text
            style={[styles.headline, { color: colors.textPrimary }, isMobile && styles.headlineMobile]}
            numberOfLines={3}
          >
            {inFocusArticle.title}
          </Text>
        </TouchableOpacity>

        {/* Metadata Row */}
        <View style={styles.metadata}>
          <TouchableOpacity onPress={() => Linking.openURL(inFocusArticle.url)} activeOpacity={0.7}>
            <Text style={[styles.metadataLink, { color: colors.textPrimary }]}>
              {inFocusArticle.source}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.metadataText, { color: colors.textSecondary }]}>•</Text>
          <Text style={[styles.metadataText, { color: colors.textSecondary }]}>
            {readingTime} min
          </Text>
          <Text style={[styles.metadataText, { color: colors.textSecondary }]}>•</Text>
          {(() => {
            const badgeKey = inFocusArticle.is_essential ? 'Essential' : 'Normal';
            const cfg = BADGE_CONFIG[badgeKey];
            const badgeColor = isDark ? cfg.darkColor : cfg.color;
            return (
              <View style={[styles.badge, { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: badgeKey === 'Essential' ? badgeColor + '20' : colors.glassHighlight }]}>
                <Icon name={cfg.icon} size={12} color={badgeColor} />
                <Text style={[styles.badgeText, { color: badgeColor }]}>{badgeKey}</Text>
              </View>
            );
          })()}
          {inFocusArticle.is_paywalled && (
            <Icon name="lock-outline" size={12} color="#6B7280" />
          )}
        </View>

        {/* Rich Summary Section with Collapsible Sections */}
        <RichSummarySection
          richSummary={inFocusArticle.rich_summary || null}
          fallbackSummary={storyboard.summary}
          isDark={isDark}
          categoryAccent={categoryColors.accent}
          onQuotePress={handleQuotePress}
        />

        {/* Socratic Prompts Section - Collapsible with tap-to-explore */}
        <SocraticPromptsSection
          prompts={inFocusArticle.socratic_prompts || []}
          isDark={isDark}
          onQuestionTap={handleQuestionTap}
          articleId={inFocusArticle.id}
        />

        {/* In-Focus Action Buttons — pass accent color for glass CTA */}
        <InFocusActionButtons
          articleId={inFocusArticle.id}
          isSaved={savedArticles.has(inFocusArticle.id) || inFocusArticle.is_saved || false}
          onStartReading={handleStartReading}
          onSave={handleSave}
          onNotRelevant={handleNotRelevant}
          storyboardId={storyboard.id}
          isDark={isDark}
          accentColor={categoryColors.accent}
        />
      </Animated.View>

      {/* Socratic Q&A Modal */}
      <SocraticQAModal
        visible={showSocraticModal}
        onClose={() => setShowSocraticModal(false)}
        question={selectedQuestion}
        articleId={inFocusArticle.id}
        articleTitle={inFocusArticle.title}
        isDark={isDark}
      />

      {/* RELATED ARTICLES CAROUSEL */}
      {carouselArticles.length > 0 && (
        <ArticleCarousel
          articles={carouselArticles}
          currentInFocusId={inFocusArticleId || ''}
          onSelectArticle={handleSwapInFocus}
          isDark={isDark}
          categoryAccent={categoryColors.accent}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.md,
    ...DarkGlassMaterials.card,
    overflow: 'hidden',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  cardDark: {
    // dark is now default, handled by liquidGlassStyle
  },
  accentStrip: {
    height: 4,
    width: '100%',
  },
  heroSection: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: 180,
    borderRadius: BorderRadius.md,
  },
  heroPlaceholder: {
    width: '100%',
    height: 140,
    borderRadius: BorderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroPlaceholderEmoji: {
    fontSize: 48,
    opacity: 0.6,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    gap: 6,
  },
  categoryEmoji: {
    fontSize: 14,
  },
  categoryText: {
    ...Typography.labelMedium,
    fontSize: 13,
  },
  categoryDot: {
    ...Typography.labelMedium,
  },
  inFocusSection: {
    paddingTop: 8,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.xs,
  },
  headlineContainer: {
    paddingHorizontal: Spacing.md,
  },
  headline: {
    ...Typography.headlineLarge,
    fontSize: 22,
    lineHeight: 30,
  },
  headlineMobile: {
    ...Typography.headlineSmall,
  },
  metadata: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  metadataText: {
    ...Typography.labelMedium,
    fontSize: 13,
  },
  metadataLink: {
    ...Typography.labelMedium,
    color: RingColors.catchup.primary,
    textDecorationLine: 'underline',
  },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  badgeText: {
    ...Typography.labelMedium,
  },
  paywalledIcon: {
    fontSize: 12,
  },
});

export default InFocusStoryboardCard;
