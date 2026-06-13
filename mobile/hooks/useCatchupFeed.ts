import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CatchupService, Storyboard, CatchupFeedResponse } from '../services/article-service';
import { readCache, writeCache, userCacheKey } from '../utils/local-cache';

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
  //
  // The last response per filter is also persisted to localStorage so a fresh
  // page load (new browser session) renders instantly from the last-known-good
  // feed; initialDataUpdatedAt makes React Query revalidate in the background
  // when the persisted copy is older than staleTime.
  const persistKey = userCacheKey(`catchup-feed:${context}`);
  const { data, isLoading, error, refetch } = useQuery<CatchupFeedResponse>({
    queryKey: ['catchup-feed', context],
    queryFn: async () => {
      const response = await CatchupService.getCatchupFeed(context, LIMIT, 0);
      writeCache(persistKey, response);
      return response;
    },
    staleTime: 5 * 60 * 1000,  // 5 min — filter switches serve cached data
    gcTime: 30 * 60 * 1000,    // 30 min — keep old filter data in memory
    // Keep showing data only when revalidating the SAME filter. On a filter
    // switch (e.g. to a newly-added interest with no cache), return undefined so
    // the loading skeleton shows instead of the PREVIOUS filter's articles —
    // otherwise a new "Finance" tab briefly shows the old "AI" feed. (GUR-235)
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[1] === context ? previousData : undefined,
    initialData: () => readCache<CatchupFeedResponse>(persistKey)?.data,
    initialDataUpdatedAt: () => readCache<CatchupFeedResponse>(persistKey)?.timestamp,
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
