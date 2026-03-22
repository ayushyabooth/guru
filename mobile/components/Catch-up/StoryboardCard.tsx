import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
  Alert,
  Image,
  Dimensions,
  Platform
} from 'react-native';
import { Storyboard, NarrativeArticle } from '../../services/article-service';
import { getIndustryConfig } from '../../constants/industryConfig';
import Icon from '../ui/Icon';
import { useTheme } from '../../contexts/ThemeContext';

interface StoryboardCardProps {
  storyboard: Storyboard;
  onSave: (articleId: string) => void;
  onNotRelevant: (storyboardId: string) => void;
}

// Priority badge config
const BADGE_CONFIG: Record<string, { icon: string; color: string; darkColor: string }> = {
  'Essential': { icon: 'star', color: '#EF4444', darkColor: '#FCA5A5' },
  'Important': { icon: 'pin', color: '#F97316', darkColor: '#FDBA74' },
  'Recommended': { icon: 'book-open-page-variant', color: '#10B981', darkColor: '#6EE7B7' },
  'Normal': { icon: 'file-document-outline', color: '#6B7280', darkColor: '#9CA3AF' }
};

export const StoryboardCard: React.FC<StoryboardCardProps> = ({
  storyboard,
  onSave,
  onNotRelevant,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [savedArticles, setSavedArticles] = useState<Set<string>>(new Set());
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  
  const { isDark } = useTheme();
  const { width } = Dimensions.get('window');
  
  const headline = storyboard.headline_article;
  const isMobile = width < 500;
  const isTablet = width >= 500 && width < 768;
  
  // Get gradient colors based on filter context
  const getGradientColors = (): string[] => {
    const config = getIndustryConfig(storyboard.industry || storyboard.filter_context || '');
    return [config.accent, config.accent];
  };

  const industryConfig = getIndustryConfig(storyboard.industry || storyboard.filter_context || '');
  
  // Calculate reading time from word count
  const getReadingTime = (wordCount: number): number => {
    return Math.ceil(wordCount / 225); // 225 words per minute
  };
  
  // Get priority badge info
  const getPriorityBadge = () => {
    // Try to extract priority from expert notes or use default
    const priority = 'Normal'; // TODO: Extract from storyboard data
    return BADGE_CONFIG[priority] || BADGE_CONFIG.Normal;
  };
  
  const handleSaveArticle = async (articleId: string) => {
    try {
      await onSave(articleId);
      setSavedArticles(prev => new Set([...prev, articleId]));
    } catch (error) {
      Alert.alert('Error', 'Failed to save article. Please try again.');
    }
  };

  const handleNotRelevant = () => {
    Alert.alert(
      'Mark as Not Relevant',
      'This will hide this story from your feed. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Yes, Hide', 
          style: 'destructive',
          onPress: () => onNotRelevant(storyboard.id)
        }
      ]
    );
  };
  
  const gradientColors = getGradientColors();
  const readingTime = getReadingTime(headline.word_count || 0);
  const badge = getPriorityBadge();
  const shouldShowImage = storyboard.visual_url && imageLoaded && !imageFailed;
  
  // Responsive heights - compact design with 16:3.5 aspect ratio
  const cardWidth = Math.min(width - 32, 600);
  const visualHeight = cardWidth / (16 / 3.5);
  
  return (
    <View style={[styles.card, isDark && styles.cardDark]} data-testid="storyboard-card">
      {/* SECTION 1: FULL IMAGE BACKGROUND HERO */}
      <View style={[styles.visualSection, { height: visualHeight }]} data-testid="visual-section">
        {/* Gradient fallback */}
        {!shouldShowImage && (
          <View 
            style={[
              styles.visualGradient,
              { backgroundColor: gradientColors[0] }
            ]} 
          />
        )}
        
        {/* Image (if available) */}
        {storyboard.visual_url && !imageFailed && (
          <Image
            source={{ uri: storyboard.visual_url }}
            style={styles.visualImage}
            resizeMode="cover"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
        )}
        
        {/* Icon - Top Left */}
        <View style={styles.emojiTopLeft}>
          <Icon name={industryConfig.icon} size={40} color="#FFFFFF" style={{ opacity: 0.8 }} />
        </View>
        
        {/* Theme Pill - Bottom Center */}
        <View style={styles.themePillContainer}>
          <View style={styles.themePill}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={industryConfig.icon} size={14} color="#FFFFFF" />
              <Text style={styles.themePillText}>
                {storyboard.theme}
              </Text>
            </View>
          </View>
        </View>
      </View>
      
      {/* CONTENT SECTION */}
      <View style={styles.content}>
        
        {/* SECTION 2: THEME ROW - Removed, now in hero pill */}
        
        {/* SECTION 3: HEADLINE */}
        <TouchableOpacity
          onPress={() => Linking.openURL(headline.url)}
          activeOpacity={0.7}
        >
          <Text 
            style={[
              styles.headline, 
              isDark && styles.headlineDark,
              isMobile && styles.headlineMobile
            ]} 
            numberOfLines={isMobile ? 2 : 3}
          >
            {headline.title}
          </Text>
        </TouchableOpacity>
        
        {/* SECTION 4: METADATA ROW */}
        <View style={styles.metadata}>
          <TouchableOpacity onPress={() => Linking.openURL(headline.url)} activeOpacity={0.7}>
            <Text style={[styles.metadataText, styles.metadataLink, isDark && styles.metadataTextDark]}>
              {headline.source}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.metadataText, isDark && styles.metadataTextDark]}>•</Text>
          <Text style={[styles.metadataText, isDark && styles.metadataTextDark]}>
            {readingTime} min
          </Text>
          <Text style={[styles.metadataText, isDark && styles.metadataTextDark]}>•</Text>
          <View style={[styles.badge, { backgroundColor: isDark ? badge.darkColor + '20' : badge.color + '20' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={badge.icon} size={12} color={isDark ? badge.darkColor : badge.color} />
              <Text style={[styles.badgeText, { color: isDark ? badge.darkColor : badge.color }]}>
                {badge.icon === 'star' ? 'Essential' : 'Normal'}
              </Text>
            </View>
          </View>
          {headline.is_paywalled && (
            <Icon name="lock-outline" size={12} color="#6B7280" />
          )}
        </View>
        
        {/* SECTION 5: SUMMARY */}
        <Text 
          style={[
            styles.summary, 
            isDark && styles.summaryDark,
            isMobile && styles.summaryMobile
          ]} 
          numberOfLines={isMobile ? 3 : 4}
        >
          {storyboard.summary}
        </Text>
        
        {/* SECTION 6: PERSONAL PROMPT */}
        {storyboard.personal_prompt && (
          <Text style={[styles.personalPrompt, isDark && styles.personalPromptDark]}>
            {storyboard.personal_prompt}
          </Text>
        )}
        
        {/* SECTION 7: DIVIDER */}
        {storyboard.narrative_articles && storyboard.narrative_articles.length > 0 && (
          <View style={[styles.divider, isDark && styles.dividerDark]} />
        )}
        
        {/* SECTION 8: CLUSTER NARRATIVE TEXT */}
        {storyboard.cluster_narrative && (() => {
          // Extract only the context before "Also in this story:"
          const narrativeContext = storyboard.cluster_narrative.split('Also in this story:')[0]?.trim();
          return narrativeContext ? (
            <Text style={[styles.clusterNarrative, isDark && styles.clusterNarrativeDark]}>
              {narrativeContext}
            </Text>
          ) : null;
        })()}
        
        {/* SECTION 9: NARRATIVE ARTICLES */}
        {storyboard.narrative_articles && storyboard.narrative_articles.length > 0 && (
          <View style={styles.narrativeSection}>
            <Text style={[styles.narrativeHeader, isDark && styles.narrativeHeaderDark]}>
              Also in this story:
            </Text>
            {storyboard.narrative_articles.slice(0, 5).map((article, idx) => {
              const articleReadingTime = getReadingTime(article.word_count || 0);
              return (
                <TouchableOpacity
                  key={article.id}
                  onPress={() => Linking.openURL(article.url)}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                    <Icon name="circle-small" size={16} color={isDark ? '#9CA3AF' : '#6B7280'} style={{ marginTop: 1 }} />
                    <Text
                      style={[styles.narrativeItem, isDark && styles.narrativeItemDark, { flex: 1 }]}
                      numberOfLines={1}
                    >
                      {article.title} ({articleReadingTime} min)
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        
        {/* SECTION 9: ACTION BUTTONS */}
        <View style={[styles.actions, isMobile && styles.actionsMobile]}>
          <TouchableOpacity
            style={[
              styles.saveButton,
              savedArticles.has(headline.id) && styles.saveButtonActive,
              isDark && styles.saveButtonDark,
              savedArticles.has(headline.id) && isDark && styles.saveButtonActiveDark,
              isMobile && { flex: 1 }
            ]}
            onPress={() => handleSaveArticle(headline.id)}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name={savedArticles.has(headline.id) ? 'bookmark-check' : 'bookmark-outline'} size={16} color="#FFFFFF" />
              <Text style={[
                styles.saveButtonText,
                savedArticles.has(headline.id) && styles.saveButtonTextActive,
                isDark && styles.saveButtonTextDark
              ]}>
                {savedArticles.has(headline.id) ? "Saved" : "Save"}
              </Text>
            </View>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.notRelevantButton,
              isDark && styles.notRelevantButtonDark,
              isMobile && { flex: 1 }
            ]}
            onPress={handleNotRelevant}
            activeOpacity={0.8}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="close" size={16} color={isDark ? '#E5E7EB' : '#1F2121'} />
              <Text style={[
                styles.notRelevantButtonText,
                isDark && styles.notRelevantButtonTextDark
              ]}>
                Not relevant
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  // Card container - responsive width like Facebook/Pinterest
  card: {
    marginHorizontal: 16,
    marginVertical: 4,
    marginTop: 0,
    borderRadius: 12,
    backgroundColor: 'rgba(15,20,35,0.55)',
    ...Platform.select({
      web: {
        backdropFilter: 'blur(40px) saturate(200%)',
        WebkitBackdropFilter: 'blur(40px) saturate(200%)',
      },
    }),
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    overflow: 'hidden',
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  cardDark: {
    backgroundColor: 'rgba(15,20,35,0.65)',
  },
  
  // Visual section (30% height)
  visualSection: {
    width: '100%',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  visualGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  visualImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  // New hero layout styles
  emojiTopLeft: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 20,
  },
  themePillContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  themePill: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  themePillText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  
  // Content section
  content: {
    padding: 16,
  },
  
  // Theme row
  theme: {
    fontSize: 12,
    fontWeight: '500',
    color: '#38BDF8',
    fontStyle: 'italic',
    marginBottom: 8,
  },
  themeDark: {
    color: '#2DD4BF',
  },
  
  // Headline
  headline: {
    fontSize: 24,
    fontWeight: '600',
    color: '#F1F5F9',
    lineHeight: 32,
    marginBottom: 8,
  },
  headlineDark: {
    color: '#E5E7EB',
  },
  headlineMobile: {
    fontSize: 22,
    lineHeight: 28,
  },
  
  // Metadata row
  metadata: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  metadataText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  metadataLink: {
    textDecorationLine: 'underline',
    color: '#38BDF8',
  },
  metadataTextDark: {
    color: '#9CA3AF',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  // Summary
  summary: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
    marginBottom: 12,
  },
  summaryDark: {
    color: '#D1D5DB',
  },
  summaryMobile: {
    fontSize: 13,
  },
  
  // Personal prompt
  personalPrompt: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#38BDF8',
    lineHeight: 20,
    marginVertical: 12,
  },
  personalPromptDark: {
    color: '#2DD4BF',
  },
  
  // Divider
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 12,
  },
  dividerDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  
  // Cluster narrative text
  clusterNarrative: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 8,
  },
  clusterNarrativeDark: {
    color: '#9CA3AF',
  },
  
  // Cluster narratives
  narrativeSection: {
    marginBottom: 12,
  },
  narrativeHeader: {
    fontSize: 14,
    fontWeight: '500',
    color: '#E2E8F0',
    marginBottom: 8,
  },
  narrativeHeaderDark: {
    color: '#E5E7EB',
  },
  narrativeItem: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#94A3B8',
    lineHeight: 18,
    marginBottom: 4,
  },
  narrativeItemDark: {
    color: '#D1D5DB',
  },
  
  // Action buttons
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  actionsMobile: {
    flexDirection: 'column',
    gap: 8,
  },
  saveButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonActive: {
    backgroundColor: '#9CA3AF',
  },
  saveButtonDark: {
    backgroundColor: '#0EA5E9',
  },
  saveButtonActiveDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  saveButtonTextActive: {
    color: '#FFFFFF',
  },
  saveButtonTextDark: {
    color: '#FFFFFF',
  },
  notRelevantButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  notRelevantButtonDark: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  notRelevantButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  notRelevantButtonTextDark: {
    color: '#E5E7EB',
  },
});
