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
      return { icon: 'bookmark', label: 'SAVED', color: '#F59E0B' };
    }
    if (article.isEssential) {
      return { icon: 'star', label: 'ESSENTIAL', color: RingColors.divein.primary };
    }
    return null;
  };

  const badge = getBadgeConfig();
  const whatsInArticle = article.richSummary?.whats_in_article || article.teaser;

  // Glass card style — translucent fill, backdrop blur on web, gradient border
  const liquidGlassStyle = isDark
    ? (Platform.OS === 'web'
        ? {
            background: `linear-gradient(145deg, rgba(15,20,35,0.65) 0%, rgba(15,20,35,0.55) 50%, rgba(15,20,35,0.60) 100%)`,
            backdropFilter: 'blur(40px) saturate(200%)',
            WebkitBackdropFilter: 'blur(40px) saturate(200%)',
            borderColor: 'rgba(255,255,255,0.08)',
            boxShadow: `0 0 60px ${filterColors.accent}18, 0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)`,
          }
        : {
            backgroundColor: 'rgba(15,20,35,0.75)',
            borderColor: 'rgba(255,255,255,0.08)',
          })
    : (Platform.OS === 'web'
        ? {
            // Solid white card + soft filter-context shadow in light mode.
            background: '#FFFFFF',
            backdropFilter: 'none',
            WebkitBackdropFilter: 'none',
            borderColor: 'rgba(15,23,42,0.08)',
            boxShadow: `0 1px 3px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.08), 0 0 32px ${filterColors.accent}10`,
          }
        : {
            backgroundColor: '#FFFFFF',
            borderColor: 'rgba(15,23,42,0.08)',
          });

  // Accent bar glow (left edge)
  const accentBarGlow = Platform.OS === 'web' ? {
    boxShadow: `2px 0 8px ${categoryColors.accent}50`,
  } : {
    shadowColor: categoryColors.accent,
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  };

  // Gradient border (brighter top) for the glass card on web
  const gradientBorderStyle = Platform.OS === 'web' && isDark ? {
    borderImage: `linear-gradient(to bottom, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%) 1`,
  } : {};

  return (
    <View style={[styles.card, liquidGlassStyle, gradientBorderStyle]}>
      {/* 3px accent bar on left edge with glow */}
      <View style={[styles.accentBar, { backgroundColor: categoryColors.accent }, accentBarGlow]} />

      {/* Main content row: text-first with small thumbnail on right */}
      <View style={styles.contentRow}>
        {/* Text content — takes priority */}
        <View style={styles.textContent}>
          {/* Top row: badge + category */}
          <View style={styles.topRow}>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.color + '15' }]}>
                <Icon name={badge.icon} size={10} color={badge.color} />
                <Text style={[styles.badgeLabel, { color: badge.color }]}>{badge.label}</Text>
              </View>
            )}
            <View style={[styles.categoryChip, { backgroundColor: colors.glassHighlight }]}>
              <Icon name={industryIcon} size={12} color={categoryColors.accent} />
              <Text style={[styles.categoryText, { color: categoryColors.accent }]}>
                {article.context || article.industry}
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text
            style={[styles.title, { color: colors.textPrimary }]}
            numberOfLines={2}
          >
            {article.headline}
          </Text>

          {/* Source + meta row */}
          <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
            {cleanSource(article.source)} · {article.readingTime} min · {formatDate(article.publishDate)}
          </Text>

          {/* 1-line teaser */}
          <Text
            style={[styles.teaser, { color: isDark ? colors.textTertiary : colors.textSecondary }]}
            numberOfLines={1}
          >
            {whatsInArticle}
          </Text>

          {/* Inline CTAs: "Dive In" text link + bookmark icon + dismiss */}
          <View style={styles.inlineCtas}>
            <TouchableOpacity
              onPress={handleDiveIn}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Dive in to ${article.headline}`}
              style={styles.diveInLink}
            >
              <Icon name="book-open-variant" size={14} color={filterColors.accent} />
              <Text style={[styles.diveInText, { color: filterColors.accent }]}>Dive In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                // TODO(R5A): wire to save mutation; for now this is a no-op placeholder.
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={article.isSaved ? 'Unsave' : 'Save for later'}
              style={styles.bookmarkButton}
            >
              <Icon
                name={article.isSaved ? 'bookmark' : 'bookmark-outline'}
                size={16}
                color={article.isSaved ? '#F59E0B' : (isDark ? colors.textTertiary : colors.textSecondary)}
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => onNotRelevant(article.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Mark not relevant"
              style={styles.dismissButton}
            >
              <Icon name="close" size={14} color={isDark ? colors.textTertiary : colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Small 52x52 thumbnail on the right */}
        <View style={styles.thumbnailContainer}>
          {article.thumbnailUrl ? (
            <Image
              source={{ uri: article.thumbnailUrl }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.thumbnailFallback, { backgroundColor: `${categoryColors.accent}18` }]}>
              <Icon name={industryIcon} size={20} color={categoryColors.accent} />
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    ...DarkGlassMaterials.card,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  accentBar: {
    width: 3,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
    padding: Spacing.sm,
    paddingLeft: Spacing.md,
    gap: Spacing.sm,
  },
  textContent: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
    gap: 3,
  },
  badgeLabel: {
    ...Typography.labelSmall,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    gap: 3,
  },
  categoryText: {
    ...Typography.labelSmall,
  },
  title: {
    ...Typography.headlineSmall,
    fontSize: 15,
    lineHeight: 20,
  },
  meta: {
    ...Typography.labelSmall,
    fontSize: 11,
  },
  teaser: {
    ...Typography.bodySmall,
    fontSize: 12,
    lineHeight: 16,
  },
  inlineCtas: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  diveInLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  diveInText: {
    ...Typography.labelMedium,
    fontWeight: '700',
    fontSize: 13,
  },
  bookmarkButton: {
    padding: 2,
  },
  dismissButton: {
    padding: 2,
    marginLeft: 'auto',
  },
  thumbnailContainer: {
    justifyContent: 'center',
  },
  thumbnail: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.sm,
  },
  thumbnailFallback: {
    width: 52,
    height: 52,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default DiveinArticleCard;
