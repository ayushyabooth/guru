import React from 'react';
import { View, ScrollView, ActivityIndicator, Text, TouchableOpacity, StyleSheet, RefreshControl, Platform } from 'react-native';
import Icon from '../ui/Icon';
import { useCatchupFeed } from '../../hooks/useCatchupFeed';
import { CatchupService } from '../../services/article-service';
import { InFocusStoryboardCard } from './InFocusStoryboardCard';
import { StoryboardSkeleton } from './StoryboardSkeleton';

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
        <Text style={styles.emptyText}>No stories available</Text>
        <Text style={styles.emptySubtext}>
          Check back later for new content in this category
        </Text>
        <TouchableOpacity style={styles.refreshButton} onPress={refresh}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }
  
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: 0 }}
      refreshControl={
        <RefreshControl
          refreshing={isLoading && storyboards.length > 0}
          onRefresh={refresh}
          colors={['#38BDF8']}
          tintColor="#38BDF8"
        />
      }
    >
      {storyboards.map(storyboard => (
        <InFocusStoryboardCard
          key={storyboard.id}
          storyboard={storyboard}
          onSave={handleSaveArticle}
          onNotRelevant={handleNotRelevant}
        />
      ))}
      
      {error && storyboards.length > 0 && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>Failed to load more stories</Text>
        </View>
      )}
      
      {hasMore && !isLoading && (
        <TouchableOpacity style={[styles.loadMoreButton, Platform.OS === 'web' && { backdropFilter: 'blur(12px) saturate(180%)', WebkitBackdropFilter: 'blur(12px) saturate(180%)', boxShadow: '0 0 16px rgba(56,189,248,0.20), inset 0 1px 0 rgba(255,255,255,0.10)' } as any]} onPress={loadMore}>
          <Text style={styles.loadMoreButtonText}>Load More Stories</Text>
        </TouchableOpacity>
      )}
      
      {isLoading && storyboards.length > 0 && (
        <View style={styles.loadingMore}>
          <ActivityIndicator size="small" color="#38BDF8" />
          <Text style={styles.loadingMoreText}>Loading more...</Text>
        </View>
      )}
      
      {!hasMore && storyboards.length > 0 && (
        <View style={styles.endMessage}>
          <View style={styles.endMessageRow}>
            <Text style={styles.endMessageText}>You're all caught up! </Text>
            <Icon name="party-popper" size={18} color="#38BDF8" />
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
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ff6b6b',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#38BDF8',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  refreshButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  refreshButtonText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 16,
  },
  errorBanner: {
    margin: 12,
    padding: 12,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 8,
    alignItems: 'center',
  },
  errorBannerText: {
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: '500',
  },
  loadMoreButton: {
    margin: 12,
    padding: 16,
    backgroundColor: 'rgba(56, 189, 248, 0.30)',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.35)',
  },
  loadMoreButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    gap: 8,
  },
  loadingMoreText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  endMessage: {
    padding: 24,
    alignItems: 'center',
  },
  endMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  endMessageText: {
    fontSize: 16,
    color: '#38BDF8',
    fontWeight: '500',
  },
  authHint: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 16,
    fontStyle: 'italic',
  },
});
