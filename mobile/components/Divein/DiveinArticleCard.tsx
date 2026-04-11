import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Platform,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
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

const { width } = Dimensions.get('window');

interface RichSummary {
  whats_in_article?: string;
  why_it_matters?: string;
  between_the_lines?: string;
  spotlight_quotes?: string[];
}

export interface DiveinArticleData {
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
  richSummary?: RichSummary;
  isSaved: boolean;
  isEssential: boolean;
}

interface DiveinArticleCardProps {
  article: DiveinArticleData;
  onDiveIn: (articleId: string) => void;
  onNotRelevant: (articleId: string) => void;
  compact?: boolean;
  filterContext?: string;
}

export const DiveinArticleCard: React.FC<DiveinArticleCardProps> = ({
  article,
  onDiveIn,
  onNotRelevant,
  compact = false,
  filterContext = 'core',
}) => {
  const router = useRouter();
  const { isDark, colors } = useTheme();
  
  // Use centralized color config from theme.ts
  const categoryColors = getFilterColors(article.industry);
  const filterColors = getFilterColors(filterContext);
  const industryIcon = categoryColors.icon;
  const industryConfig = getIndustryConfig(article.industry);

  const cleanSource = (source: string) =>
    source.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleDiveIn = () => {
    onDiveIn(article.id);
    // On web: open article in new tab (must be in user gesture context to avoid popup blocker)
    // then navigate to the reading state page
    if (Platform.OS === 'web' && article.url) {
      window.open(article.url, '_blank');
    }
    router.push(`/article/${article.id}?source=divein`);
  };

  const getBadgeConfig = () => {
    if (article.isSaved) {
      return { icon: '◈', label: 'SAVED', color: '#F59E0B' };
    }
    if (article.isEssential) {
      return { icon: '★', label: 'ESSENTIAL', color: RingColors.divein.primary };
    }
    return null;
  };

  const badge = getBadgeConfig();
  const whatsInArticle = article.richSummary?.whats_in_article || article.teaser;

  // Dark glassmorphic style - uses filter context colors
  const liquidGlassStyle = Platform.OS === 'web' ? {
    background: `linear-gradient(145deg, rgba(15,20,35,0.65) 0%, rgba(15,20,35,0.55) 50%, rgba(15,20,35,0.60) 100%)`,
    backdropFilter: 'blur(40px) saturate(200%)',
    WebkitBackdropFilter: 'blur(40px) saturate(200%)',
    borderColor: 'rgba(255,255,255,0.08)',
    boxShadow: `0 0 60px ${filterColors.accent}18, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`,
  } : {
    backgroundColor: 'rgba(15,20,35,0.75)',
    borderColor: 'rgba(255,255,255,0.08)',
  };

  return (
    <View style={[styles.card, liquidGlassStyle, !isDark && { backgroundColor: 'rgba(255,255,255,0.85)', borderColor: 'rgba(0,0,0,0.08)' }]}>
      {/* Accent strip at top - uses filter context color */}
      <View style={[styles.accentStrip, { backgroundColor: filterColors.accent }]} />
      
      {/* Header row with badge and category */}
      <View style={styles.headerRow}>
        {badge && (
          <View style={[styles.badge, { backgroundColor: badge.color + '15' }]}>
            <Text style={[styles.badgeIcon, { color: badge.color }]}>{badge.icon}</Text>
            <Text style={[styles.badgeLabel, { color: badge.color }]}>{badge.label}</Text>
          </View>
        )}
        <View style={[styles.categoryChip, { backgroundColor: colors.glassHighlight }]}>
          <Icon name={industryIcon} size={14} color={categoryColors.accent} />
          <Text style={[styles.categoryText, { color: categoryColors.accent }]}>
            {article.context || article.industry}
          </Text>
        </View>
      </View>

      {/* Hero Image Section */}
      <View style={styles.heroContainer}>
        {article.thumbnailUrl ? (
          <Image 
            source={{ uri: article.thumbnailUrl }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        ) : (
          <HeroGradientFallback
            accentFrom={industryConfig.accent}
            accentTo={industryConfig.accentSecondary || industryConfig.accent}
            emoji={industryConfig.emoji}
            height={140}
          />
        )}
        
        {/* Liquid glass overlay */}
        <View style={styles.heroOverlay}>
          <View style={styles.glassOverlay}>
            <Text style={styles.heroTitle} numberOfLines={3}>{article.headline}</Text>
            <Text style={styles.heroMeta}>
              {cleanSource(article.source)} • {article.readingTime} min read • {formatDate(article.publishDate)}
            </Text>
          </View>
        </View>
      </View>

      {/* Article summary */}
      <View style={styles.contentSection}>
        <Text style={[styles.contentText, { color: colors.textSecondary }]} numberOfLines={4}>
          {whatsInArticle}
        </Text>
      </View>

      {/* CTA Row */}
      <View style={styles.ctaRow}>
        <TouchableOpacity
          style={[styles.ctaButton, styles.ctaPrimary, { backgroundColor: filterColors.accent + '4D' }]}
          onPress={handleDiveIn}
          activeOpacity={0.8}
        >
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
            <Icon name="book-open-variant" size={16} color="#FFFFFF" />
            <Text style={styles.ctaPrimaryText}>Dive In</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.ctaButton, styles.ctaSecondary]}
          onPress={() => onNotRelevant(article.id)}
          activeOpacity={0.7}
        >
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
            <Icon name="close" size={16} color={colors.textTertiary} />
            <Text style={[styles.ctaSecondaryText, { color: colors.textSecondary }]}>Not Relevant</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.sm,
    marginTop: Spacing.md,
    ...DarkGlassMaterials.card,
    borderRadius: 20,
    overflow: 'hidden',
  },
  accentStrip: {
    height: 3,
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 6,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  badgeIcon: {
    ...Typography.labelMedium,
    fontWeight: '700',
    marginRight: Spacing.xs,
  },
  badgeLabel: {
    ...Typography.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
  },
  categoryEmoji: {
    fontSize: 12,
    marginRight: 4,
  },
  categoryText: {
    ...Typography.labelMedium,
  },
  heroContainer: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
    aspectRatio: 16 / 10,
    maxHeight: 140,
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
  heroPlaceholderEmoji: {
    ...Typography.displayMedium,
    opacity: 0.5,
  },
  heroOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  glassOverlay: {
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    ...Platform.select({
      web: {
        backdropFilter: 'blur(16px) saturate(180%)',
        WebkitBackdropFilter: 'blur(16px) saturate(180%)',
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.06)',
      },
    }),
  },
  heroTitle: {
    ...Typography.bodyLarge,
    fontWeight: '700',
    color: '#F1F5F9',
    lineHeight: 22,
    marginBottom: Spacing.xs,
  },
  heroMeta: {
    ...Typography.labelMedium,
    color: '#94A3B8',
  },
  contentSection: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  contentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  contentHeaderEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  contentHeaderText: {
    ...Typography.labelMedium,
  },
  contentDivider: {
    height: 1,
    marginBottom: 10,
  },
  contentText: {
    ...Typography.bodyMedium,
    lineHeight: 21,
  },
  ctaRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  ctaButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPrimary: {
    elevation: 2,
    borderWidth: 1,
    borderColor: `${RingColors.divein.light}59`,
    ...Platform.select({
      web: { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' },
      default: {},
    }),
  },
  ctaPrimaryText: {
    ...Typography.labelLarge,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  ctaSecondary: {
    ...DarkGlassMaterials.button,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
  },
  ctaSecondaryText: {
    ...Typography.labelLarge,
  },
});

export default DiveinArticleCard;
