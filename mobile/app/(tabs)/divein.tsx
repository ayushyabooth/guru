import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Alert, SafeAreaView } from 'react-native';
import { DiveinFeed, DiveinArticle } from '../../components/Divein/DiveinFeed';
import { FilterTabBar } from '../../components/Catch-up/FilterTabBar';
import { userService, UserProfile } from '../../services/user-service';
import { useScreenTimeTracking, useTimeTrackingContext } from '../../contexts/TimeTrackingContext';
import { OrganicBackground } from '../../components/ui';
import { useDiveinFeed, DiveinArticleRaw } from '../../hooks/useDiveinFeed';
import {
  Spacing,
  Typography,
  RingColors,
} from '../../constants/liquidGlass';
import { useTheme } from '../../contexts/ThemeContext';

function mapArticle(article: DiveinArticleRaw): DiveinArticle {
  return {
    id: article.id,
    headline: article.title,
    source: article.source,
    publishDate: article.publish_date || article.created_at,
    readingTime: article.reading_time || Math.ceil((article.word_count || 0) / 200),
    teaser: article.summary || article.expert_takeaway || 'Read this article for expert insights',
    priority: article.is_essential ? 'essential' : (article.is_saved ? 'saved' : 'normal'),
    context: article.context || 'Consumer',
    industry: article.industry || article.context || 'Consumer',
    url: article.url,
    thumbnailUrl: article.thumbnail_url || article.image_url,
    richSummary: article.rich_summary ? {
      whats_in_article: article.rich_summary.whats_in_article,
      why_it_matters: article.rich_summary.why_it_matters,
      between_the_lines: article.rich_summary.between_the_lines,
      spotlight_quotes: article.rich_summary.spotlight_quotes,
    } : undefined,
    isSaved: article.is_saved || false,
    isEssential: article.is_essential || false,
  };
}

export default function DiveinScreen() {
  const [selectedContext, setSelectedContext] = useState('core');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const { isDark, colors } = useTheme();

  const { savedArticles: savedRaw, essentialArticles, discoveryArticles, isLoading, error, refresh, removeArticle } = useDiveinFeed(selectedContext);

  // Map raw articles to DiveinArticle format, memoized
  const articles = useMemo(() => {
    return [
      ...savedRaw.map(mapArticle),
      ...essentialArticles.map(mapArticle),
      ...discoveryArticles.map(mapArticle),
    ];
  }, [savedRaw, essentialArticles, discoveryArticles]);

  // Use the new time tracking context
  const { recordInteraction, updateContext } = useTimeTrackingContext();

  // Start tracking when profile is loaded (with industry context)
  useScreenTimeTracking('divein', {
    activityType: 'article',
    industry: userProfile?.core_industry,
    specialization: userProfile?.specializations?.[0],
    autoStart: !!userProfile,
  });

  useEffect(() => {
    loadUserProfile();
  }, []);

  // Update tracking context when selected context changes
  useEffect(() => {
    if (selectedContext.startsWith('specialization:')) {
      const spec = selectedContext.replace('specialization:', '');
      updateContext({ specialization: spec });
    } else if (selectedContext.startsWith('interest:')) {
      const interest = selectedContext.replace('interest:', '');
      updateContext({ industry: interest });
    }
  }, [selectedContext]);

  const loadUserProfile = async () => {
    try {
      const profile = await userService.getUserProfile();
      setUserProfile(profile);
    } catch (error) {
      Alert.alert('Error', 'Failed to load your profile. Please try again.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleNotRelevant = useCallback((articleId: string) => {
    removeArticle(articleId);
    recordInteraction();
  }, [removeArticle, recordInteraction]);

  const handleArticleInteraction = (articleId: string) => {
    recordInteraction();
    updateContext({ contextId: articleId });
  };

  // Build tab list from user profile - use _display fields for labels, keep original values for API context
  const tabs = (() => {
    if (!userProfile) return [];
    const rawTabs = [
      { label: userProfile.core_industry_display || userProfile.core_industry, context: 'core' },
      ...userProfile.specializations.map((specId: string, i: number) => ({
        label: userProfile.specializations_display?.[i] || specId,
        context: `specialization:${specId}`,
      })),
      ...userProfile.additional_interest_industries.map((industryId: string, i: number) => ({
        label: userProfile.additional_interest_industries_display?.[i] || industryId,
        context: `interest:${industryId}`,
      })),
    ];
    // Deduplicate by label to prevent duplicate tabs
    const seen = new Set<string>();
    return rawTabs.filter(tab => {
      if (seen.has(tab.label)) return false;
      seen.add(tab.label);
      return true;
    });
  })();

  if (profileLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="divein" />
        <DiveinFeed
          articles={[]}
          onLoadMore={() => {}}
          onNotRelevant={() => {}}
          hasMore={false}
          isLoading={true}
          filterContext="core"
        />
      </SafeAreaView>
    );
  }

  if (!userProfile) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <OrganicBackground variant="divein" />
        <View style={[styles.container, styles.centerContent]}>
          <Text style={[styles.emptyStateTitle, { color: colors.textPrimary }]}>Failed to load profile</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <OrganicBackground variant="divein" />

      <View style={styles.filterWrapper}>
        <FilterTabBar
          selectedContext={selectedContext}
          onContextChange={setSelectedContext}
          tabs={tabs}
          accentColor={RingColors.divein.primary}
        />
      </View>

      <DiveinFeed
        articles={articles}
        onLoadMore={() => {}}
        onNotRelevant={handleNotRelevant}
        hasMore={false}
        isLoading={isLoading}
        filterContext={selectedContext}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  loadingText: {
    marginTop: Spacing.md,
    ...Typography.bodyMedium,
  },
  emptyState: {
    padding: Spacing.xxl,
    alignItems: 'center',
  },
  emptyStateTitle: {
    ...Typography.headlineMedium,
    marginBottom: Spacing.sm,
  },
  emptyStateText: {
    ...Typography.bodyMedium,
    textAlign: 'center',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterWrapper: {
    paddingTop: Spacing.md,
  },
});
