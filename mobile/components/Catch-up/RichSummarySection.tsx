import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import Icon from '../ui/Icon';
import GlassSection from '../ui/GlassSection';
import { useTheme } from '../../contexts/ThemeContext';

interface RichSummary {
  whats_in_article?: string;
  why_it_matters?: string;
  between_the_lines?: string;
  spotlight_quotes?: string[];
}

interface RichSummarySectionProps {
  richSummary: RichSummary | null;
  fallbackSummary?: string;
  isDark?: boolean;
  categoryAccent?: string;
  onQuotePress?: (quote: string) => void;
}

export const RichSummarySection: React.FC<RichSummarySectionProps> = ({
  richSummary,
  fallbackSummary,
  isDark: isDarkProp = false,
  categoryAccent = '#38BDF8',
  onQuotePress
}) => {
  const { colors } = useTheme();

  if (!richSummary) {
    if (!fallbackSummary) return null;
    return (
      <View style={styles.container}>
        <Text style={[styles.fallbackText, { color: colors.textPrimary }]}>{fallbackSummary}</Text>
      </View>
    );
  }

  const content = richSummary;

  return (
    <View style={styles.container}>
      {/* What's in the article - EXPANDED by default */}
      {content.whats_in_article && (
        <GlassSection
          title="What's in the article"
          icon={<Icon name="clipboard-text-outline" size={16} color={colors.textSecondary} />}
          accentColor={categoryAccent}
          defaultExpanded={true}
          style={styles.section}
        >
          <Text style={[styles.sectionBody, { color: colors.textSecondary }]} numberOfLines={4}>{content.whats_in_article}</Text>
        </GlassSection>
      )}

      {/* Spotlight Quotes - EXPANDED by default, horizontal scroll */}
      {content.spotlight_quotes && content.spotlight_quotes.length > 0 && (
        <GlassSection
          title="Spotlight"
          icon={<Icon name="format-quote-open" size={16} color={colors.textSecondary} />}
          accentColor={categoryAccent}
          defaultExpanded={true}
          style={styles.section}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quotesScroll}
            snapToInterval={260}
            decelerationRate="fast"
          >
            {content.spotlight_quotes.slice(0, 3).map((quote, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.quoteCard, { borderLeftColor: categoryAccent, backgroundColor: colors.glassHighlight, borderColor: isDarkProp ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)' }]}
                onPress={() => onQuotePress?.(quote)}
                activeOpacity={0.7}
              >
                <Text style={[styles.quoteText, { color: colors.textSecondary }]} numberOfLines={4}>
                  "{quote}"
                </Text>
                {onQuotePress && (
                  <Text style={styles.quoteHint}>Tap to find in article →</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </GlassSection>
      )}

      {/* Why it matters - COLLAPSED by default */}
      {content.why_it_matters && (
        <GlassSection
          title="Why it matters"
          icon={<Icon name="target" size={16} color={colors.textSecondary} />}
          accentColor={categoryAccent}
          defaultExpanded={false}
          style={styles.section}
        >
          <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>{content.why_it_matters}</Text>
        </GlassSection>
      )}

      {/* Between the lines - COLLAPSED by default */}
      {content.between_the_lines && (
        <GlassSection
          title="Between the lines"
          icon={<Icon name="magnify" size={16} color={colors.textSecondary} />}
          accentColor={categoryAccent}
          defaultExpanded={false}
          style={styles.section}
        >
          <Text style={[styles.sectionBody, { color: colors.textSecondary }]}>{content.between_the_lines}</Text>
        </GlassSection>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 8,
    gap: 8,
  },
  fallbackText: {
    fontSize: 16,
    lineHeight: 24,
    paddingHorizontal: 16,
    fontWeight: '400',
  },
  section: {
    marginHorizontal: 8,
  },
  sectionBody: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
  },
  quotesScroll: {
    gap: 12,
  },
  quoteCard: {
    width: 240,
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderWidth: 1,
  },
  quoteText: {
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  quoteHint: {
    fontSize: 11,
    color: '#0EA5E9',
    marginTop: 8,
    fontWeight: '500',
  },
});
