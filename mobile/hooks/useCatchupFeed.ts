import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CatchupService, Storyboard, CatchupFeedResponse } from '../services/article-service';

interface UseCatchupFeedResult {
  storyboards: Storyboard[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  removeStoryboard: (storyboardId: string) => void;
}

const LIMIT = 5;

export function useCatchupFeed(context: string): UseCatchupFeedResult {
  const queryClient = useQueryClient();
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // React Query manages the fetch, caching, and background revalidation.
  // When switching filters, cached data is returned instantly (staleTime = 5 min),
  // and a background refetch happens silently.
  const { data, isLoading, error, refetch } = useQuery<CatchupFeedResponse>({
    queryKey: ['catchup-feed', context],
    queryFn: () => CatchupService.getCatchupFeed(context, LIMIT, 0),
    staleTime: 5 * 60 * 1000,  // 5 min — filter switches serve cached data
    gcTime: 30 * 60 * 1000,    // 30 min — keep old filter data in memory
    placeholderData: (previousData) => previousData, // Show previous filter's data while loading
  });

  const storyboards = (data?.storyboards ?? []).filter(s => !removedIds.has(s.id));
  const total = data?.total ?? 0;
  const hasMore = storyboards.length < total;

  const loadMore = useCallback(async () => {
    // For now, initial page is sufficient. Could extend with infinite query later.
  }, []);

  const refresh = useCallback(async () => {
    setRemovedIds(new Set());
    await refetch();
  }, [refetch]);

  const removeStoryboard = useCallback((storyboardId: string) => {
    setRemovedIds(prev => new Set([...prev, storyboardId]));
  }, []);

  return {
    storyboards,
    isLoading: isLoading && !data, // Only show loading spinner if no cached data
    error: error ? (error instanceof Error ? error.message : 'Failed to load storyboards') : null,
    hasMore,
    loadMore,
    refresh,
    removeStoryboard,
  };
}
