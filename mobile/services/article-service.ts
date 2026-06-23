import { API_BASE_URL } from '../constants/config';
import { getAuthToken } from '../utils/auth';
import { authedFetch } from '../utils/authed-fetch';

export interface RichSummary {
  whats_in_article?: string;
  why_it_matters?: string;
  between_the_lines?: string;
  spotlight_quotes?: string[];
}

export interface Article {
  id: string;
  title: string;
  source: string;
  url: string;
  word_count: number;
  is_paywalled: boolean;
  created_at: string;
  is_saved?: boolean;
  is_essential?: boolean;
  publish_date?: string;
  rich_summary?: RichSummary | null;
  socratic_prompts?: string[];
}

export interface NarrativeArticle {
  id: string;
  title: string;
  url: string;
  word_count?: number;
  is_paywalled?: boolean;
  source?: string;
  created_at?: string;
  thumbnail_url?: string;  // For carousel thumbnails
  visual_url?: string;     // Alternative image URL
  rich_summary?: RichSummary;
  socratic_prompts?: string[];
}

export interface Storyboard {
  id: string;
  filter_context: string;
  industry: string;
  specializations: string[];
  summary: string;
  personal_prompt: string;
  cluster_narrative?: string;
  narrative_articles?: NarrativeArticle[];
  visual_url?: string;
  visual_source?: string;
  created_at: string;
  headline_article: Article;
  related_articles: Article[];
  article_count: number;
  theme?: string;
}

export interface CatchupFeedResponse {
  storyboards: Storyboard[];
  total: number;
  filter: string;
  limit: number;
  offset: number;
}

export class CatchupService {
  static async getCatchupFeed(
    filter: string,
    limit: number = 5,
    offset: number = 0
  ): Promise<CatchupFeedResponse> {
    const response = await authedFetch(
      `${API_BASE_URL}/catchup-feed?filter=${encodeURIComponent(filter)}&limit=${limit}&offset=${offset}`,
      { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch catchup feed: ${response.statusText}`);
    }

    return response.json();
  }

  static async saveArticle(articleId: string): Promise<{ message: string; is_saved: boolean }> {
    const response = await authedFetch(
      `${API_BASE_URL}/articles/${articleId}/save`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`Failed to save article: ${response.statusText}`);
    }

    return response.json();
  }

  static async unsaveArticle(articleId: string): Promise<{ message: string; is_saved: boolean }> {
    const response = await authedFetch(
      `${API_BASE_URL}/articles/${articleId}/save`,
      { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`Failed to unsave article: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Mark a storyboard as "read" by browsing it in the catch-up feed (GUR-234).
   * Logs a ZERO-duration catch-up TimeLog carrying the storyboard's primary
   * article id, so it counts toward "articles read" (distinct context_id)
   * without adding any time. activity_type 'storyboard_view' lets the backend
   * keep these out of the top-topics tally. Best-effort — never throws.
   */
  static async markStoryboardRead(articleId: string): Promise<void> {
    try {
      const token = await getAuthToken();
      if (!token || !articleId) return;
      const now = new Date().toISOString();
      await fetch(`${API_BASE_URL}/metrics/log-time`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ring_type: 'catchup',
          duration_seconds: 0,
          context_id: articleId,
          activity_type: 'storyboard_view',
          started_at: now,
          ended_at: now,
        }),
      });
    } catch { /* best-effort read marker */ }
  }

  static async markNotRelevant(
    storyboardId: string,
    filter: string
  ): Promise<{ message: string }> {
    const response = await authedFetch(
      `${API_BASE_URL}/storyboards/${storyboardId}/not-relevant?filter=${encodeURIComponent(filter)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );

    if (!response.ok) {
      throw new Error(`Failed to mark not relevant: ${response.statusText}`);
    }

    return response.json();
  }
}
