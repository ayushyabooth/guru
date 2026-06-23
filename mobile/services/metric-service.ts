import { authedFetch, SessionExpiredError } from '../utils/authed-fetch';
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
      // GUR-232: per-window recap completion so the Today|Week toggle can show
      // "Done today / Not today" vs the weekly status independently.
      completedToday: boolean;
      completedThisWeek: boolean;
    };
    streak: number;
    stats: {
      // Weekly window (default surfaced everywhere it was before)
      articlesRead: number;
      articlesSaved: number;
      filtersExplored: number;
      topTopics: { name: string; count: number }[];
      notesThisWeek: number;
      // Today window (GUR-232) — the Today|Week toggle reads these for the
      // "today" view; saved is all-time so it has no today variant.
      articlesReadToday: number;
      notesToday: number;
      topTopicsToday: { name: string; count: number }[];
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

  async getMetrics(filter?: string): Promise<MetricsResponse> {
    try {
      // Scope the dashboard to the selected Home content filter (omit for 'all'),
      // and pass the device timezone so the server buckets "today"/"week" in the
      // user's LOCAL day rather than server UTC (GUR-234). Best-effort on tz.
      let tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* tz best-effort */ }
      const params = new URLSearchParams();
      if (filter && filter !== 'all') params.set('filter', filter);
      if (tz) params.set('tz', tz);
      const qs = params.toString();
      const metricsUrl = qs ? `${this.baseUrl}/me/metrics?${qs}` : `${this.baseUrl}/me/metrics`;

      // Profile: reuse the SWR-cached /me when fresh — it changes rarely and
      // was previously re-fetched on EVERY metrics call (60s polling included).
      // When the cache is stale/missing, fetch it in parallel with metrics.
      const cachedProfile = userService.getCachedProfile();
      const profileIsFresh = !!cachedProfile && (Date.now() - cachedProfile.timestamp) < PROFILE_REFRESH_MS;

      const profilePromise: Promise<UserProfile> = profileIsFresh
        ? Promise.resolve(cachedProfile!.data)
        : userService.fetchUserProfileFresh();

      // Fetch metrics and (when needed) profile in parallel. authedFetch handles
      // the 401 → login redirect centrally (GUR-240 D).
      const [metricsResponse, profileData] = await Promise.all([
        authedFetch(metricsUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } }),
        profilePromise,
      ]);

      if (!metricsResponse.ok) {
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
            // GUR-232: decoupled per-window completion flags from the backend.
            // Fall back to today's snapshot / weekly array if the new fields
            // are absent (older API), so the toggle still reads sensibly.
            completedToday: metricsData.recap_completed_today ?? !!metricsData.today?.recap_completed,
            completedThisWeek: metricsData.recap_completed_this_week
              ?? !!metricsData.week?.some((day: any) => day.recap_completed),
          },
          streak: metricsData.current_streak || 0,
          stats: {
            articlesRead: metricsData.articles_read || 0,
            articlesSaved: metricsData.articles_saved || 0,
            filtersExplored: metricsData.filters_explored || 0,
            topTopics: metricsData.top_topics || [],
            notesThisWeek: metricsData.notes_this_week || 0,
            // GUR-232: today-window stats
            articlesReadToday: metricsData.articles_read_today || 0,
            notesToday: metricsData.notes_today || 0,
            topTopicsToday: metricsData.top_topics_today || [],
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
    const response = await authedFetch(`${this.baseUrl}/me/metrics/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section,
        minutes,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP ${response.status}: Failed to update progress`);
    }
  }

  // Static default metrics — used only when no cached data exists
  getDefaultMetrics(): MetricsResponse {
    return {
      metrics: {
        catchup: { dailyProgress: 0, dailyGoal: 30, weeklyTotal: 0 },
        divein: { dailyProgress: 0, dailyGoal: 30, weeklyProgress: 0, weeklyGoal: 120 },
        recap: { status: 'not_started', weeklyProgress: 0, weeklyGoal: 60, completedToday: false, completedThisWeek: false },
        streak: 0,
        stats: {
          articlesRead: 0, articlesSaved: 0, filtersExplored: 0, topTopics: [],
          notesThisWeek: 0, articlesReadToday: 0, notesToday: 0, topTopicsToday: [],
        },
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
      // Propagate auth errors so the UI can redirect to login (the redirect has
      // already been triggered centrally by authedFetch / getAuthToken).
      if (error instanceof SessionExpiredError || (error instanceof Error && error.message.includes('Authentication failed'))) {
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
