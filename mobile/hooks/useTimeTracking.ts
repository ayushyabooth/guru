import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { API_BASE_URL } from '../constants/config';
import { getAuthToken } from '../utils/auth';

interface TimeTrackingOptions {
  interval?: number; // Interval to log time in milliseconds
  autoStart?: boolean;
  contextId?: string; // Article ID or storyboard ID for recap tracking
  activityType?: string; // 'article', 'storyboard', 'qa', etc.
}

interface UseTimeTrackingResult {
  startTracking: () => void;
  stopTracking: () => void;
  logTime: (minutes: number) => Promise<void>;
}

export function useTimeTracking(
  activity: string,
  options: TimeTrackingOptions = {}
): UseTimeTrackingResult {
  const { interval = 30000, autoStart = true, contextId, activityType } = options;
  
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const logTime = useCallback(async (minutes: number) => {
    if (minutes <= 0) return;
    
    try {
      const token = await getAuthToken();
      if (!token) {
        return;
      }

      const now = new Date();
      const startedAt = new Date(now.getTime() - minutes * 60 * 1000);
      
      const response = await fetch(`${API_BASE_URL}/metrics/log-time`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ring_type: activity,
          duration_seconds: Math.round(minutes * 60),
          started_at: startedAt.toISOString(),
          ended_at: now.toISOString(),
          context_id: contextId || null,
          activity_type: activityType || null,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
      } else {
      }
    } catch (error) {
    }
  }, [activity, contextId, activityType]);

  const startTracking = useCallback(() => {
    if (startTimeRef.current) return; // Already tracking
    
    startTimeRef.current = Date.now();
    
    // Set up periodic logging
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    intervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const elapsedMinutes = (Date.now() - startTimeRef.current) / (1000 * 60);
        logTime(elapsedMinutes);
        startTimeRef.current = Date.now(); // Reset start time for next interval
      }
    }, interval);
  }, [activity, interval, logTime]);

  const stopTracking = useCallback(() => {
    if (!startTimeRef.current) return; // Not tracking
    
    const elapsedMinutes = (Date.now() - startTimeRef.current) / (1000 * 60);
    
    // Clear interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    // Log final time
    if (elapsedMinutes > 0) {
      logTime(elapsedMinutes);
    }
    
    startTimeRef.current = null;
  }, [activity, logTime]);

  // Handle app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        // App came to foreground - resume tracking if we were tracking before
        if (startTimeRef.current) {
          startTracking();
        }
      } else if (appStateRef.current === 'active' && nextAppState.match(/inactive|background/)) {
        // App went to background - log current time
        if (startTimeRef.current) {
          const elapsedMinutes = (Date.now() - startTimeRef.current) / (1000 * 60);
          if (elapsedMinutes > 0) {
            logTime(elapsedMinutes);
          }
          startTimeRef.current = Date.now(); // Reset for when app comes back
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      subscription?.remove();
    };
  }, [logTime, startTracking]);

  // Auto-start tracking on mount
  useEffect(() => {
    if (autoStart) {
      startTracking();
    }
    
    // Cleanup on unmount
    return () => {
      stopTracking();
    };
  }, [autoStart, startTracking, stopTracking]);

  return {
    startTracking,
    stopTracking,
    logTime,
  };
}
