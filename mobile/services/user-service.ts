import { getAuthToken } from '../utils/auth';
import { API_BASE_URL } from '../constants/config';

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

class UserService {
  async getUserProfile(retries = 2): Promise<UserProfile> {
    const token = await getAuthToken();

    if (!token) {
      throw new Error('Not authenticated. Please log in.');
    }

    const response = await fetch(`${API_BASE_URL}/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Retry on 502/503 — Railway cold starts return these before the app is ready
      if ((response.status === 502 || response.status === 503) && retries > 0) {
        await new Promise(r => setTimeout(r, 1000));
        return this.getUserProfile(retries - 1);
      }
      if (response.status === 401) {
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(`Failed to fetch user profile: ${response.statusText}`);
    }

    return await response.json();
  }
}

export const userService = new UserService();
