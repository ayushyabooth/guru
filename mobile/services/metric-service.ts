import { getAuthToken } from '../utils/auth';
import { API_BASE_URL } from '../constants/config';

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
    lastUpdated: string;
  };
  profile: {
    coreIndustry: string;
    specializations: string[];
    additionalInterests: string[];
  };
}

class MetricService {
  private baseUrl = API_BASE_URL;
  private lastKnownGoodResponse: MetricsResponse | null = null;

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

  async getMetrics(): Promise<MetricsResponse> {
    try {
      const headers = await this.getAuthHeaders();
      
      // Fetch metrics and profile in parallel
      const [metricsResponse, profileResponse] = await Promise.all([
        fetch(`${this.baseUrl}/me/metrics`, {
          method: 'GET',
          headers,
        }),
        fetch(`${this.baseUrl}/me`, {
          method: 'GET',
          headers,
        })
      ]);

      if (!metricsResponse.ok) {
        if (metricsResponse.status === 401) {
          throw new Error('Authentication failed. Please log in again.');
        }
        const errorData = await metricsResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${metricsResponse.status}: Failed to fetch metrics`);
      }

      if (!profileResponse.ok) {
        if (profileResponse.status === 401) {
          throw new Error('Authentication failed. Please log in again.');
        }
        const errorData = await profileResponse.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${profileResponse.status}: Failed to fetch profile`);
      }

      const metricsData = await metricsResponse.json();
      const profileData = await profileResponse.json();
      
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
          lastUpdated: new Date().toISOString(),
        },
        profile: {
          coreIndustry: profileData.core_industry || 'Consumer',
          specializations: profileData.specializations || [],
          additionalInterests: profileData.additional_interest_industries || [],
        },
      };

      // Cache successful response for fallback
      this.lastKnownGoodResponse = result;
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
  async getMetricsWithFallback(): Promise<MetricsResponse> {
    try {
      return await this.getMetrics();
    } catch (error) {
      // Propagate auth errors so the UI can redirect to login
      if (error instanceof Error && error.message.includes('Authentication failed')) {
        throw error;
      }

      console.warn('[MetricService] API failed, using fallback:', error instanceof Error ? error.message : error);

      // Return last known good data if available
      if (this.lastKnownGoodResponse) {
        return this.lastKnownGoodResponse;
      }

      // Final fallback: static defaults (all zeros)
      return this.getDefaultMetrics();
    }
  }
}

export const metricService = new MetricService();
