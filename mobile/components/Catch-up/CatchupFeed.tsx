import React, { useEffect, useRef, useCallback } from 'react';
import { View, ScrollView, ActivityIndicator, Text, TouchableOpacity, StyleSheet, RefreshControl, Platform, Animated } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../ui/Icon';
import { useCatchupFeed } from '../../hooks/useCatchupFeed';
import { useTimeTrackingContext } from '../../contexts/TimeTrackingContext';
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

/**
 * Marks a storyboard "read" once it has dwelled in the viewport (GUR-234).
 * Browsing a storyboard in the feed should count toward "articles read", so we
 * fire onRead after the card is ≥50% visible for 2.5s continuously. Web-only
 * (IntersectionObserver); a no-op wrapper on native.
 */
function StoryboardViewTracker({
  articleId,
  onRead,
  children,
}: {
  articleId?: string;
  onRead: (articleId: string) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<any>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !articleId) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const el = ref.current as unknown as Element | null;
    if (!el || typeof (el as any).getBoundingClientRect !== 'function') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const obs = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e.isIntersecting && e.intersectionRatio >= 0.5) {
          if (!timer) timer = setTimeout(() => onRead(articleId), 2500);
        } else if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    obs.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      obs.disconnect();
    };
  }, [articleId, onRead]);
  return <View ref={ref}>{children}</View>;
}

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

  const queryClient = useQueryClient();

  // Reading the feed (scrolling) counts as engagement: without this the idle
  // timer (90s) fires while the user is actively reading storyboards but not
  // tapping, so catch-up time under-counts. Throttled to once / 5s. (GUR-234)
  const { recordInteraction } = useTimeTrackingContext();
  const lastScrollInteractionRef = useRef(0);
  const handleFeedScroll = () => {
    const now = Date.now();
    if (now - lastScrollInteractionRef.current > 5000) {
      lastScrollInteractionRef.current = now;
      recordInteraction();
    }
  };

  // Browsing a storyboard (dwelling on it) counts as reading its article — once
  // per article per mount, deduped so a re-scroll doesn't re-log. (GUR-234)
  const readMarkedRef = useRef<Set<string>>(new Set());
  const handleStoryboardRead = useCallback((articleId: string) => {
    if (!articleId || readMarkedRef.current.has(articleId)) return;
    readMarkedRef.current.add(articleId);
    CatchupService.markStoryboardRead(articleId);
    recordInteraction();
  }, [recordInteraction]);

  // A save (or not-relevant) here changes what the Dive-in library should show.
  // The Dive-in feed query lives behind a 5-min staleTime + localStorage-seeded
  // initialData, so without an explicit signal it keeps serving the old list —
  // newly-saved articles stay invisible until the cache expires. Invalidating
  // forces the (always-mounted, on web) Dive-in observer to refetch in the
  // background, which also rewrites its localStorage copy. (GUR-233)
  const invalidateLibrary = () => {
    queryClient.invalidateQueries({ queryKey: ['divein-feed'] });
  };

  // Scroll to top when the feed first populates so the hero image/headline of
  // card #1 is never hidden above the fold due to browser scroll restoration
  // on web. (GUR-168)
  const scrollViewRef = useRef<ScrollView>(null);
  const didScrollToTop = useRef(false);
  useEffect(() => {
    if (storyboards.length > 0 && !didScrollToTop.current) {
      didScrollToTop.current = true;
      scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    }
  }, [storyboards.length]);

  const handleSaveArticle = async (articleId: string) => {
    try {
      await CatchupService.saveArticle(articleId);
      invalidateLibrary();
      onArticleSave?.(articleId);
    } catch (error) {
      throw error; // Re-throw to let StoryboardCard handle the error display
    }
  };

  const handleNotRelevant = async (storyboardId: string) => {
    try {
      await CatchupService.markNotRelevant(storyboardId, context);
      removeStoryboard(storyboardId);
      invalidateLibrary();
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
      ref={scrollViewRef}
      style={styles.container}
      contentContainerStyle={{ paddingTop: 0, paddingBottom: 100 }}
      onScroll={handleFeedScroll}
      scrollEventThrottle={250}
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
          <StoryboardViewTracker
            articleId={storyboard.headline_article?.id}
            onRead={handleStoryboardRead}
          >
            <InFocusStoryboardCard
              storyboard={storyboard}
              onSave={handleSaveArticle}
              onNotRelevant={handleNotRelevant}
            />
          </StoryboardViewTracker>
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
