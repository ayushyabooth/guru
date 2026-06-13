/**
 * TimeTrackingContext - Enhanced time tracking with idle detection and industry context
 *
 * Features:
 * - Tracks time spent in Catch-up and Dive-in modes
 * - Idle detection (pauses after 90 seconds of no interaction)
 * - Industry/specialization context per session
 * - Local AsyncStorage persistence for offline resilience
 * - Real-time sync to backend on session end
 * - Abandonment heuristic (counts time up to last interaction + 30 sec buffer)
 */

import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../constants/config';
import { getAuthToken } from '../utils/auth';

// Storage abstraction (SecureStore for native, localStorage for web)
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    }
    return await SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
      }
    } else {
      await SecureStore.deleteItemAsync(key);
    }
  },
};

// Constants
const IDLE_THRESHOLD_MS = 90 * 1000; // 90 seconds
const ABANDONMENT_BUFFER_MS = 30 * 1000; // 30 seconds
const SYNC_DEBOUNCE_MS = 2000; // 2 seconds debounce for sync
const STORAGE_KEY = 'guru_time_tracking_sessions';

// Types
export type RingType = 'catchup' | 'divein' | 'recap';
export type ActivityType = 'storyboard' | 'card' | 'qa' | 'article' | 'socratic';

export interface TimeSession {
  id: string;
  ringType: RingType;
  activityType?: ActivityType;
  startTime: number;
  lastInteractionTime: number;
  endTime?: number;
  totalActiveMs: number;
  totalIdleMs: number;
  industry?: string;
  specialization?: string;
  contextId?: string; // article_id or storyboard_id
  synced: boolean;
}

interface TimeTrackingState {
  activeSession: TimeSession | null;
  isIdle: boolean;
  pendingSessions: TimeSession[]; // Sessions waiting to be synced
  todayStats: {
    catchupMinutes: number;
    diveinMinutes: number;
    recapMinutes: number;
  };
}

type TimeTrackingAction =
  | { type: 'START_SESSION'; payload: Omit<TimeSession, 'id' | 'startTime' | 'lastInteractionTime' | 'totalActiveMs' | 'totalIdleMs' | 'synced'> }
  | { type: 'END_SESSION'; payload?: { abandoned?: boolean } }
  | { type: 'RECORD_INTERACTION' }
  | { type: 'SET_IDLE'; payload: boolean }
  | { type: 'UPDATE_CONTEXT'; payload: { industry?: string; specialization?: string; contextId?: string; activityType?: ActivityType } }
  | { type: 'SESSION_SYNCED'; payload: string } // session id
  | { type: 'LOAD_PENDING_SESSIONS'; payload: TimeSession[] }
  | { type: 'UPDATE_TODAY_STATS'; payload: { catchupMinutes: number; diveinMinutes: number; recapMinutes: number } };

interface TimeTrackingContextValue {
  state: TimeTrackingState;
  startSession: (ringType: RingType, options?: {
    activityType?: ActivityType;
    industry?: string;
    specialization?: string;
    contextId?: string;
  }) => void;
  endSession: (abandoned?: boolean) => void;
  recordInteraction: () => void;
  updateContext: (context: {
    industry?: string;
    specialization?: string;
    contextId?: string;
    activityType?: ActivityType;
  }) => void;
  isTracking: boolean;
  currentRingType: RingType | null;
}

const initialState: TimeTrackingState = {
  activeSession: null,
  isIdle: false,
  pendingSessions: [],
  todayStats: {
    catchupMinutes: 0,
    diveinMinutes: 0,
    recapMinutes: 0,
  },
};

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function timeTrackingReducer(state: TimeTrackingState, action: TimeTrackingAction): TimeTrackingState {
  switch (action.type) {
    case 'START_SESSION': {
      // End any existing session first
      let pendingSessions = [...state.pendingSessions];
      if (state.activeSession && !state.activeSession.synced) {
        pendingSessions.push({
          ...state.activeSession,
          endTime: state.activeSession.lastInteractionTime + ABANDONMENT_BUFFER_MS,
        });
      }

      const now = Date.now();
      const newSession: TimeSession = {
        id: generateSessionId(),
        ringType: action.payload.ringType,
        activityType: action.payload.activityType,
        startTime: now,
        lastInteractionTime: now,
        totalActiveMs: 0,
        totalIdleMs: 0,
        industry: action.payload.industry,
        specialization: action.payload.specialization,
        contextId: action.payload.contextId,
        synced: false,
      };

      return {
        ...state,
        activeSession: newSession,
        isIdle: false,
        pendingSessions,
      };
    }

    case 'END_SESSION': {
      if (!state.activeSession) return state;

      const now = Date.now();
      const endTime = action.payload?.abandoned
        ? state.activeSession.lastInteractionTime + ABANDONMENT_BUFFER_MS
        : now;

      // Calculate final active time
      const finalActiveMs = state.isIdle
        ? state.activeSession.totalActiveMs
        : state.activeSession.totalActiveMs + (now - state.activeSession.lastInteractionTime);

      const endedSession: TimeSession = {
        ...state.activeSession,
        endTime,
        totalActiveMs: Math.min(finalActiveMs, endTime - state.activeSession.startTime),
      };

      // Update today stats
      const durationMinutes = Math.round(endedSession.totalActiveMs / (1000 * 60));
      const newStats = { ...state.todayStats };
      if (endedSession.ringType === 'catchup') {
        newStats.catchupMinutes += durationMinutes;
      } else if (endedSession.ringType === 'divein') {
        newStats.diveinMinutes += durationMinutes;
      } else if (endedSession.ringType === 'recap') {
        newStats.recapMinutes += durationMinutes;
      }

      return {
        ...state,
        activeSession: null,
        isIdle: false,
        pendingSessions: [...state.pendingSessions, endedSession],
        todayStats: newStats,
      };
    }

    case 'RECORD_INTERACTION': {
      if (!state.activeSession) return state;

      const now = Date.now();
      const timeSinceLastInteraction = now - state.activeSession.lastInteractionTime;

      // If we were idle, add to idle time
      const additionalIdleMs = state.isIdle ? timeSinceLastInteraction : 0;
      // If we weren't idle, add to active time
      const additionalActiveMs = state.isIdle ? 0 : timeSinceLastInteraction;

      return {
        ...state,
        isIdle: false,
        activeSession: {
          ...state.activeSession,
          lastInteractionTime: now,
          totalActiveMs: state.activeSession.totalActiveMs + additionalActiveMs,
          totalIdleMs: state.activeSession.totalIdleMs + additionalIdleMs,
        },
      };
    }

    case 'SET_IDLE': {
      if (!state.activeSession) return state;

      // When becoming idle, calculate active time up to now
      if (action.payload && !state.isIdle) {
        const now = Date.now();
        const additionalActiveMs = now - state.activeSession.lastInteractionTime;
        return {
          ...state,
          isIdle: true,
          activeSession: {
            ...state.activeSession,
            totalActiveMs: state.activeSession.totalActiveMs + additionalActiveMs,
          },
        };
      }

      return {
        ...state,
        isIdle: action.payload,
      };
    }

    case 'UPDATE_CONTEXT': {
      if (!state.activeSession) return state;
      return {
        ...state,
        activeSession: {
          ...state.activeSession,
          ...action.payload,
        },
      };
    }

    case 'SESSION_SYNCED': {
      return {
        ...state,
        pendingSessions: state.pendingSessions.filter(s => s.id !== action.payload),
      };
    }

    case 'LOAD_PENDING_SESSIONS': {
      return {
        ...state,
        pendingSessions: action.payload,
      };
    }

    case 'UPDATE_TODAY_STATS': {
      return {
        ...state,
        todayStats: action.payload,
      };
    }

    default:
      return state;
  }
}

const TimeTrackingContext = createContext<TimeTrackingContextValue | null>(null);

export function TimeTrackingProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(timeTrackingReducer, initialState);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load pending sessions from storage on mount
  useEffect(() => {
    loadPendingSessions();
  }, []);

  // Sync pending sessions to backend
  useEffect(() => {
    if (state.pendingSessions.length > 0) {
      // Debounce sync
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
      syncTimeoutRef.current = setTimeout(() => {
        syncPendingSessions();
      }, SYNC_DEBOUNCE_MS);
    }

    // Save to storage for persistence
    savePendingSessions();
  }, [state.pendingSessions]);

  // Idle detection timer
  useEffect(() => {
    if (state.activeSession && !state.isIdle) {
      // Clear existing timer
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }

      // Set new idle timer
      idleTimerRef.current = setTimeout(() => {
        dispatch({ type: 'SET_IDLE', payload: true });
      }, IDLE_THRESHOLD_MS);
    }

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [state.activeSession, state.isIdle, state.activeSession?.lastInteractionTime]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App came to foreground - resume tracking
        if (state.activeSession) {
          dispatch({ type: 'RECORD_INTERACTION' });
        }
      } else if (
        appStateRef.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App went to background - end session as abandoned
        if (state.activeSession) {
          dispatch({ type: 'END_SESSION', payload: { abandoned: true } });
        }
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription?.remove();
    };
  }, [state.activeSession]);

  // Web: pause on tab-hidden (GUR-234). RN AppState doesn't reliably fire
  // background on the web, so a hidden/backgrounded tab would otherwise keep
  // accruing "active" time. Hiding banks active time up to now and stops the
  // clock (SET_IDLE); becoming visible again resumes it.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onVisibility = () => {
      if (!state.activeSession) return;
      if (document.hidden) {
        dispatch({ type: 'SET_IDLE', payload: true });
      } else {
        dispatch({ type: 'RECORD_INTERACTION' });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [state.activeSession]);

  const loadPendingSessions = async () => {
    try {
      const stored = await storage.getItem(STORAGE_KEY);
      if (stored) {
        const sessions = JSON.parse(stored) as TimeSession[];
        // Filter out sessions older than 24 hours
        const recentSessions = sessions.filter(
          s => Date.now() - (s.endTime || s.startTime) < 24 * 60 * 60 * 1000
        );
        dispatch({ type: 'LOAD_PENDING_SESSIONS', payload: recentSessions });
      }
    } catch (error) {
    }
  };

  const savePendingSessions = async () => {
    try {
      await storage.setItem(STORAGE_KEY, JSON.stringify(state.pendingSessions));
    } catch (error) {
    }
  };

  const syncPendingSessions = async () => {
    const token = await getAuthToken();
    if (!token) {
      return;
    }

    for (const session of state.pendingSessions) {
      if (session.synced) continue;

      try {
        const durationSeconds = Math.round(session.totalActiveMs / 1000);
        if (durationSeconds < 1) {
          // Skip sessions less than 1 second
          dispatch({ type: 'SESSION_SYNCED', payload: session.id });
          continue;
        }

        const response = await fetch(`${API_BASE_URL}/metrics/log-time`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ring_type: session.ringType,
            duration_seconds: durationSeconds,
            started_at: new Date(session.startTime).toISOString(),
            ended_at: new Date(session.endTime || Date.now()).toISOString(),
            context_id: session.contextId || null,
            industry: session.industry || null,
            specialization: session.specialization || null,
            activity_type: session.activityType || null,
            idle_seconds: Math.round(session.totalIdleMs / 1000),
          }),
        });

        if (response.ok) {
          dispatch({ type: 'SESSION_SYNCED', payload: session.id });
        } else {
          const errorText = await response.text();
        }
      } catch (error) {
      }
    }
  };

  const startSession = useCallback((
    ringType: RingType,
    options?: {
      activityType?: ActivityType;
      industry?: string;
      specialization?: string;
      contextId?: string;
    }
  ) => {
    dispatch({
      type: 'START_SESSION',
      payload: {
        ringType,
        activityType: options?.activityType,
        industry: options?.industry,
        specialization: options?.specialization,
        contextId: options?.contextId,
      },
    });
  }, []);

  const endSession = useCallback((abandoned: boolean = false) => {
    if (state.activeSession) {
      dispatch({ type: 'END_SESSION', payload: { abandoned } });
    }
  }, [state.activeSession]);

  const recordInteraction = useCallback(() => {
    if (state.activeSession) {
      dispatch({ type: 'RECORD_INTERACTION' });
    }
  }, [state.activeSession]);

  const updateContext = useCallback((context: {
    industry?: string;
    specialization?: string;
    contextId?: string;
    activityType?: ActivityType;
  }) => {
    dispatch({ type: 'UPDATE_CONTEXT', payload: context });
  }, []);

  const value: TimeTrackingContextValue = {
    state,
    startSession,
    endSession,
    recordInteraction,
    updateContext,
    isTracking: state.activeSession !== null,
    currentRingType: state.activeSession?.ringType || null,
  };

  return (
    <TimeTrackingContext.Provider value={value}>
      {children}
    </TimeTrackingContext.Provider>
  );
}

export function useTimeTrackingContext() {
  const context = useContext(TimeTrackingContext);
  if (!context) {
    throw new Error('useTimeTrackingContext must be used within a TimeTrackingProvider');
  }
  return context;
}

/**
 * Hook for components to easily track their screen time
 * Automatically starts tracking on mount and stops on unmount
 */
export function useScreenTimeTracking(
  ringType: RingType,
  options?: {
    activityType?: ActivityType;
    industry?: string;
    specialization?: string;
    contextId?: string;
    autoStart?: boolean;
  }
) {
  const { startSession, endSession, recordInteraction, updateContext, isTracking, currentRingType } = useTimeTrackingContext();
  const { autoStart = true } = options || {};

  useEffect(() => {
    if (autoStart) {
      startSession(ringType, options);
    }

    return () => {
      // Only end if we're still tracking this ring type
      if (currentRingType === ringType) {
        endSession(false);
      }
    };
  }, [ringType, autoStart]);

  return {
    startSession: () => startSession(ringType, options),
    endSession,
    recordInteraction,
    updateContext,
    isTracking: isTracking && currentRingType === ringType,
  };
}
