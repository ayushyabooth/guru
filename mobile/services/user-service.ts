import { authedFetch } from '../utils/authed-fetch';
import { API_BASE_URL } from '../constants/config';
import { readCache, writeCache, removeCache, userCacheKey, CachedEntry } from '../utils/local-cache';

export interface UserProfile {
  user_id: string;
  core_industry: string;
  specializations: string[];
  additional_interest_industries: string[];
  core_industry_display?: string;
  specializations_display?: string[];
  additional_interest_industries_display?: string[];
  total_weekly_capacity_band: string;
  catchup_daily_goal_minutes: number;
  catchup_daily_max_minutes: number;
  divein_weekly_goal_minutes: number;
  recap_weekly_goal_minutes: number;
  created_at: string;
  updated_at: string;
}

const PROFILE_CACHE_KEY = userCacheKey('profile');
// Profile (industry, specializations, goals) changes rarely — refresh in the
// background at most every 5 minutes. Anything that mutates the profile
// (e.g. saving goals) must call invalidateProfileCache().
const PROFILE_TTL_MS = 5 * 60 * 1000;

class UserService {
  private profileMemoryCache: CachedEntry<UserProfile> | null = null;
  private inflightProfileFetch: Promise<UserProfile> | null = null;

  /** Last-known-good /me response (memory first, then localStorage). */
  getCachedProfile(): CachedEntry<UserProfile> | null {
    if (this.profileMemoryCache) return this.profileMemoryCache;
    const stored = readCache<UserProfile>(PROFILE_CACHE_KEY);
    if (stored) this.profileMemoryCache = stored;
    return stored;
  }

  /** Drop the cached profile (call after any profile mutation, e.g. goal edits). */
  invalidateProfileCache(): void {
    this.profileMemoryCache = null;
    removeCache(PROFILE_CACHE_KEY);
  }

  /** Always hits the network; updates the SWR cache on success. De-duplicates concurrent calls. */
  async fetchUserProfileFresh(): Promise<UserProfile> {
    if (this.inflightProfileFetch) return this.inflightProfileFetch;
    this.inflightProfileFetch = (async () => {
      const response = await authedFetch(`${API_BASE_URL}/me`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch user profile: ${response.statusText}`);
      }

      const profile: UserProfile = await response.json();
      this.profileMemoryCache = { data: profile, timestamp: Date.now() };
      writeCache(PROFILE_CACHE_KEY, profile);
      return profile;
    })();
    try {
      return await this.inflightProfileFetch;
    } finally {
      this.inflightProfileFetch = null;
    }
  }

  /**
   * Stale-while-revalidate: returns the cached profile instantly when one
   * exists (kicking off a background refresh if it's older than the TTL),
   * and only blocks on the network when nothing is cached yet.
   */
  async getUserProfile(): Promise<UserProfile> {
    const cached = this.getCachedProfile();
    if (cached) {
      if (Date.now() - cached.timestamp > PROFILE_TTL_MS) {
        this.fetchUserProfileFresh().catch(() => {
          // Background revalidation is best-effort; cached data stays in place.
        });
      }
      return cached.data;
    }
    return this.fetchUserProfileFresh();
  }
}

export const userService = new UserService();
