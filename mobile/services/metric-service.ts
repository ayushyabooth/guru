import { getAuthToken } from '../utils/auth';
import { API_BASE_URL } from '../constants/config';
import { userService, UserProfile } from './user-service';
import { readCache, writeCache, userCacheKey } from '../utils/local-cache';

/** Format a minute value as "Xh Ym" when >= 60, or "Xm" when < 60 */
export function formatMinutes(m: number): string {
  const rounded = Math.round(m);
  if (rounded >= 60) {
    const h = Math.floor(rounded / 60);
    const rem = rounded % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${rounded}m`;
}

export interface MetricsResponse {
  metrics: {
    catchup: {
      dailyProgress: number;
      dailyGoal: number;
      weeklyTotal: number;
    };
    divein: {
      dailyProgress: number;
      dailyGoal: number;
      weeklyProgress: number;
      weeklyGoal: number;
    };
    recap: {
      status: 'not_started' | 'in_progress' | 'completed';
      weeklyProgress: number;
      weeklyGoal: number;
    };
    streak: number;
    stats: {
      articlesRead: number;
      articlesSaved: number;
      filtersExplored: number;
      topTopics: { name: string; count: number }[];
    };
    lastUpdated: string;
  };
  profile: {
    coreIndustry: string;
    specializations: string[];
    additionalInterests: string[];
  };
}

// Profile is fetched at most this often alongside metrics; between refreshes
// the SWR-cached /me response is reused (it changes rarely — goal edits
// invalidate it explicitly via userService.invalidateProfileCache()).
const PROFILE_REFRESH_MS = 5 * 60 * 1000;

function normalizeFilter(filter?: string): string {
  return filter && filter !== 'all' ? filter : 'all';
}

function metricsCacheKey(filter?: string): string {
  return userCacheKey(`metrics:${normalizeFilter(filter)}`);
}

class MetricService {
  private baseUrl = API_BASE_URL;
  private lastKnownGoodResponse: MetricsResponse | null = null;
  // Per-filter last-known-good responses for stale-while-revalidate rendering.
  private metricsMemoryCache = new Map<string, MetricsResponse>();

  /**
   * Last-known-good metrics for a filter (memory first, then localStorage).
   * Consumers (metric-context) render this instantly, then refresh over the
   * network — the ~300ms backend floor never blocks navigation.
   */
  getCachedMetrics(filter?: string): MetricsResponse | null {
    const key = normalizeFilter(filter);
    const inMemory = this.metricsMemoryCache.get(key);
    if (inMemory) return inMemory;
    const stored = readCache<MetricsResponse>(metricsCacheKey(filter));
    if (stored) {
      this.metricsMemoryCache.set(key, stored.data);
      return stored.data;
    }
    return null;
  }

  private cacheMetrics(filter: string | undefined, result: MetricsResponse): void {
    this.lastKnownGoodResponse = result;
    this.metricsMemoryCache.set(normalizeFilter(filter), result);
    writeCache(metricsCacheKey(filter), result);
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('No authentication token found');
    }
    
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async getMetrics(filter?: string): Promise<MetricsResponse> {
    try {
      const headers = await this.getAuthHeaders();

      // Scope the dashboard to the selected Home content filter (omit for 'all').
      const metricsUrl = filter && filter !== 'all'
        ? `${this.baseUrl}/me/metrics?filter=${encodeURIComponent(filter)}`
        : `${this.baseUrl}/me/metrics`;

      // Profile: reuse the SWR-cached /me when fresh — it changes rarely and
      // was previously re-fetched on EVERY metrics call (60s polling included).
      // When the cache is stale/missing, fetch it in parallel with metrics.
      const cachedProfile = userService.getCachedProfile();
      const profileIsFresh = !!cachedProfile && (Date.now() - cachedProfile.timestamp) < PROFILE_REFRESH_MS;

      const profilePromise: Promise<UserProfile> = profileIsFresh
        ? Promise.resolve(cachedProfile!.data)
        : userService.fetchUserProfileFresh().catch((err: unknown) => {
            // Map user-service auth wording so existing auth handling
            // (redirect-to-login on "Authentication failed") keeps working.
            if (err instanceof Error && (err.message.includes('Session expired') || err.message.includes('Not authenticated'))) {
              throw new Error('Authentication failed. Please log in again.');
            }
            throw err;
          });

      // Fetch metrics and (when needed) profile in parallel
      const [metricsResponse, profileData] = await Promise.all([
        fetch(metricsUrl, {
          method: 'GET',
          headers,
        }),
        profilePromise,
      ]);

      if (!metricsResponse.ok) {
        if (metricsResponse.status === 401) {
          throw new Error('Authentication failed. Please log in again.');
        }
        const errorData = await metricsResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${metricsResponse.status}: Failed to fetch metrics`);
      }

      const metricsData = await metricsResponse.json();
      
      // Transform the response to match our expected format
      const result: MetricsResponse = {
        metrics: {
          catchup: {
            dailyProgress: metricsData.today?.catchup_minutes || 0,
            dailyGoal: profileData.catchup_daily_goal_minutes || 30,
            weeklyTotal: metricsData.week?.reduce((sum: number, day: any) => sum + (day.catchup_minutes || 0), 0) || 0,
          },
          divein: {
            dailyProgress: metricsData.today?.divein_minutes || 0,
            // Convert weekly to daily, then clamp to the slider minimum (15m).
            // A stored weekly of 90 would otherwise compute to 13m — below the
            // 15m minimum shown in GoalEditor — see GUR-174 / GUR-182.
            dailyGoal: Math.max(15, Math.round((profileData.divein_weekly_goal_minutes || 120) / 7)),
            weeklyProgress: metricsData.week?.reduce((sum: number, day: any) => sum + (day.divein_minutes || 0), 0) || 0,
            weeklyGoal: profileData.divein_weekly_goal_minutes || 120,
          },
          recap: {
            status: metricsData.recap_journey_status === 'completed' ? 'completed'
              : (metricsData.recap_journey_status?.startsWith('stage_')
                || metricsData.recap_journey_status === 'commitment') ? 'in_progress'
              : metricsData.today?.recap_completed ? 'completed'
              : 'not_started',
            weeklyProgress: metricsData.week?.filter((day: any) => day.recap_completed).length * 60 || 0,
            weeklyGoal: profileData.recap_weekly_goal_minutes || 60,
          },
          streak: metricsData.current_streak || 0,
          stats: {
            articlesRead: metricsData.articles_read || 0,
            articlesSaved: metricsData.articles_saved || 0,
            filtersExplored: metricsData.filters_explored || 0,
            topTopics: metricsData.top_topics || [],
          },
          lastUpdated: new Date().toISOString(),
        },
        profile: {
          coreIndustry: profileData.core_industry || 'Consumer',
          specializations: profileData.specializations || [],
          additionalInterests: profileData.additional_interest_industries || [],
        },
      };

      // Cache successful response (per filter) for SWR rendering + error fallback
      this.cacheMetrics(filter, result);
      return result;
    } catch (error) {
      throw error;
    }
  }

  async updateProgress(section: 'catchup' | 'divein' | 'recap', minutes: number): Promise<void> {
    try {
      const headers = await this.getAuthHeaders();
      
      const response = await fetch(`${this.baseUrl}/me/metrics/progress`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          section,
          minutes,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Authentication failed. Please log in again.');
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}: Failed to update progress`);
      }
    } catch (error) {
      throw error;
    }
  }

  // Static default metrics — used only when no cached data exists
  getDefaultMetrics(): MetricsResponse {
    return {
      metrics: {
        catchup: { dailyProgress: 0, dailyGoal: 30, weeklyTotal: 0 },
        divein: { dailyProgress: 0, dailyGoal: 30, weeklyProgress: 0, weeklyGoal: 120 },
        recap: { status: 'not_started', weeklyProgress: 0, weeklyGoal: 60 },
        streak: 0,
        stats: { articlesRead: 0, articlesSaved: 0, filtersExplored: 0, topTopics: [] },
        lastUpdated: new Date().toISOString(),
      },
      profile: {
        coreIndustry: 'Consumer',
        specializations: ['Food & Beverage'],
        additionalInterests: [],
      },
    };
  }

  // Fetch metrics with graceful fallback: real API → last-known-good cache → static defaults
  async getMetricsWithFallback(filter?: string): Promise<MetricsResponse> {
    try {
      return await this.getMetrics(filter);
    } catch (error) {
      // Propagate auth errors so the UI can redirect to login
      if (error instanceof Error && error.message.includes('Authentication failed')) {
        throw error;
      }

      console.warn('[MetricService] API failed, using fallback:', error instanceof Error ? error.message : error);

      // Return last known good data if available — prefer the cache for the
      // requested filter, then any last-known-good response.
      const cached = this.getCachedMetrics(filter);
      if (cached) {
        return cached;
      }
      if (this.lastKnownGoodResponse) {
        return this.lastKnownGoodResponse;
      }

      // Final fallback: static defaults (all zeros)
      return this.getDefaultMetrics();
    }
  }
}

export const metricService = new MetricService();
