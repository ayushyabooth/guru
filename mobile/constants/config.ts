export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000/api/v1';

export const CONFIG = {
  API_BASE_URL,
  DEFAULT_PAGINATION_LIMIT: 5,
  TIME_TRACKING_INTERVAL: 30000, // 30 seconds
  DAILY_MAX_MINUTES: 45,
} as const;
