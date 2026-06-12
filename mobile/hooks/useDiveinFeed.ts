import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE_URL } from '../constants/config';
import { getAuthToken } from '../utils/auth';
import { readCache, writeCache, userCacheKey } from '../utils/local-cache';

export interface DiveinArticleRaw {
  id: string;
  title: string;
  source: string;
  reading_time: number | null;
  is_saved: boolean;
  is_essential: boolean;
  image_url: string | null;
  thumbnail_url: string | null;
  summary: string | null;
  expert_takeaway: string | null;
  rich_summary: {
    whats_in_article: string | null;
    why_it_matters: string | null;
    between_the_lines: string | null;
    spotlight_quotes: string[] | null;
    socratic_prompts: string[] | null;
  } | null;
  created_at: string;
  publish_date: string | null;
  url: string;
  word_count: number | null;
  context: string | null;
  industry: string | null;
  priority: string;
}

interface DiveinFeedResponse {
  saved_articles: DiveinArticleRaw[];
  essential_articles: DiveinArticleRaw[];
  discovery_articles: DiveinArticleRaw[];
  total_saved: number;
  total_essential: number;
  total_discovery: number;
  limit: number;
  offset: number;
}

async function fetchDiveinFeed(filter: string): Promise<DiveinFeedResponse> {
  const token = await getAuthToken();
  if (!token) throw new Error('Not authenticated');

  const response = await fetch(
    `${API_BASE_URL}/divein-feed?limit=10&offset=0&filter=${filter}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function useDiveinFeed(filter: string) {
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // Last response per filter is persisted to localStorage so a fresh page
  // load renders instantly from last-known-good data; initialDataUpdatedAt
  // triggers a silent background revalidation when the copy is stale.
  const persistKey = userCacheKey(`divein-feed:${filter}`);
  const { data, isLoading, error, refetch } = useQuery<DiveinFeedResponse>({
    queryKey: ['divein-feed', filter],
    queryFn: async () => {
      const response = await fetchDiveinFeed(filter);
      writeCache(persistKey, response);
      return response;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (previousData) => previousData,
    initialData: () => readCache<DiveinFeedResponse>(persistKey)?.data,
    initialDataUpdatedAt: () => readCache<DiveinFeedResponse>(persistKey)?.timestamp,
  });

  const savedArticles = (data?.saved_articles ?? []).filter(a => !removedIds.has(a.id));
  const essentialArticles = (data?.essential_articles ?? []).filter(a => !removedIds.has(a.id));
  const discoveryArticles = (data?.discovery_articles ?? []).filter(a => !removedIds.has(a.id));

  const removeArticle = useCallback((articleId: string) => {
    setRemovedIds(prev => new Set([...prev, articleId]));
  }, []);

  const refresh = useCallback(async () => {
    setRemovedIds(new Set());
    await refetch();
  }, [refetch]);

  return {
    savedArticles,
    essentialArticles,
    discoveryArticles,
    isLoading: isLoading && !data,
    error: error ? (error instanceof Error ? error.message : 'Failed to load') : null,
    totalDiscovery: data?.total_discovery ?? 0,
    refresh,
    removeArticle,
  };
}
