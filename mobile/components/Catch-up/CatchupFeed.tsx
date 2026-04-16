import React, { useEffect, useRef } from 'react';
import { View, ScrollView, ActivityIndicator, Text, TouchableOpacity, StyleSheet, RefreshControl, Platform, Animated } from 'react-native';
import Icon from '../ui/Icon';
import { useCatchupFeed } from '../../hooks/useCatchupFeed';
import { CatchupService } from '../../services/article-service';
import { InFocusStoryboardCard } from './InFocusStoryboardCard';
import { StoryboardSkeleton } from './StoryboardSkeleton';
import { DarkTheme } from '../../constants/darkTheme';
import {
  Spacing,
  Typography,
  BorderRadius,
  DarkGlassMaterials,
  RingColors,
  getDarkBackdropBlur,
} from '../../constants/liquidGlass';

/** Lightweight stagger wrapper — fades + slides each card with a 50ms offset */
function StaggeredCard({ children, index }: { children: React.ReactNode; index: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    const delay = index * 50;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

interface CatchupFeedProps {
  context: string;           // 'core', 'specialization:X', 'interest:Y'
  onArticleSave?: (articleId: string) => void;
  onNotRelevant?: (storyboardId: string) => void;
}

export const CatchupFeed: React.FC<CatchupFeedProps> = ({
  context,
  onArticleSave,
  onNotRelevant,
}) => {
  const {
    storyboards,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    removeStoryboard,
  } = useCatchupFeed(context);

  const handleSaveArticle = async (articleId: string) => {
    try {
      await CatchupService.saveArticle(articleId);
      onArticleSave?.(articleId);
    } catch (error) {
      throw error; // Re-throw to let StoryboardCard handle the error display
    }
  };
  
  const handleNotRelevant = async (storyboardId: string) => {
    try {
      await CatchupService.markNotRelevant(storyboardId, context);
      removeStoryboard(storyboardId);
      onNotRelevant?.(storyboardId);
    } catch (error) {
      throw error;
    }
  };

  if (error && storyboards.length === 0) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Failed to load stories</Text>
        <Text style={styles.errorSubtext}>{error}</Text>
        {error.includes('Unauthorized') && (
          <Text style={styles.authHint}>
            Please sign up or log in to access your personalized feed
          </Text>
        )}
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading && storyboards.length === 0) {
    return <StoryboardSkeleton />;
  }

  if (storyboards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View style={[styles.emptyGlassCard, Platform.OS === 'web' && styles.emptyGlassCardWeb as any]}>
          <Text style={styles.emptyText}>All caught up!</Text>
          <Text style={styles.emptySubtext}>
            Check back later for new content in this category
          </Text>
          <TouchableOpacity style={styles.refreshButton} onPress={refresh}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: 0, paddingBottom: 100 }}
      refreshControl={
        <RefreshControl
          refreshing={isLoading && storyboards.length > 0}
          onRefresh={refresh}
          colors={[RingColors.catchup.primary]}
          tintColor={RingColors.catchup.primary}
        />
      }
    >
      {storyboards.map((storyboard, index) => (
        <StaggeredCard key={storyboard.id} index={index}>
          <InFocusStoryboardCard
            storyboard={storyboard}
            onSave={handleSaveArticle}
            onNotRelevant={handleNotRelevant}
          />
        </StaggeredCard>
      ))}
      
      {error && storyboards.length > 0 && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Failed to load more stories</Text>
        </View>
      )}
      
      {hasMore && !isLoading && (
        <TouchableOpacity style={[styles.loadMoreButton, Platform.OS === 'web' && { ...getDarkBackdropBlur(12), boxShadow: `0 0 16px ${DarkTheme.catchupGlow}, inset 0 1px 0 ${DarkTheme.glassHighlight}` } as any]} onPress={loadMore}>
          <Text style={styles.loadMoreButtonText}>Load More Stories</Text>
        </TouchableOpacity>
      )}
      
      {isLoading && storyboards.length > 0 && (
        <View style={styles.loadingMore}>
          <ActivityIndicator size="small" color={RingColors.catchup.primary} />
          <Text style={styles.loadingMoreText}>Loading more...</Text>
        </View>
      )}
      
      {!hasMore && storyboards.length > 0 && (
        <View style={styles.endMessage}>
          <View style={styles.endMessageRow}>
            <Text style={styles.endMessageText}>You're all caught up! </Text>
            <Icon name="party-popper" size={18} color={RingColors.catchup.primary} />
          </View>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: 0,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingText: {
    marginTop: Spacing.md,
    ...Typography.bodyLarge,
    color: DarkTheme.textSecondary,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  errorText: {
    ...Typography.headlineSmall,
    color: DarkTheme.error,
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  errorSubtext: {
    ...Typography.bodyMedium,
    color: DarkTheme.textTertiary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  retryButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: RingColors.catchup.primary,
    borderRadius: BorderRadius.sm,
  },
  retryButtonText: {
    color: DarkTheme.textPrimary,
    ...Typography.labelLarge,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  emptyGlassCard: {
    ...DarkGlassMaterials.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyGlassCardWeb: {
    ...getDarkBackdropBlur(16),
  },
  emptyText: {
    ...Typography.headlineSmall,
    color: 'rgba(255,255,255,0.45)',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  emptySubtext: {
    ...Typography.bodyMedium,
    color: DarkTheme.textTertiary,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  refreshButton: {
    ...DarkGlassMaterials.button,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  refreshButtonText: {
    color: DarkTheme.textSecondary,
    ...Typography.labelLarge,
  },
  errorBanner: {
    margin: Spacing.md,
    padding: Spacing.md,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
  },
  errorBannerText: {
    color: DarkTheme.error,
    ...Typography.bodyMedium,
    fontWeight: '500',
  },
  loadMoreButton: {
    margin: Spacing.md,
    padding: Spacing.md,
    backgroundColor: `${RingColors.catchup.primary}4D`,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: `${RingColors.catchup.light}59`,
  },
  loadMoreButtonText: {
    color: DarkTheme.textPrimary,
    ...Typography.labelLarge,
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  loadingMoreText: {
    ...Typography.bodyMedium,
    color: DarkTheme.textSecondary,
  },
  endMessage: {
    padding: Spacing.lg,
    alignItems: 'center',
  },
  endMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  endMessageText: {
    ...Typography.bodyLarge,
    color: RingColors.catchup.primary,
    fontWeight: '500',
  },
  authHint: {
    ...Typography.bodyMedium,
    color: DarkTheme.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.md,
    fontStyle: 'italic',
  },
});
