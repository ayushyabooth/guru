import React, { createContext, useContext, useReducer, useEffect, useRef, ReactNode } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { metricService } from '../services/metric-service';

// Types for metrics state
export interface MetricsData {
  catchup: {
    dailyProgress: number;
    dailyGoal: number;
    weeklyTotal: number;
  };
  divein: {
    dailyProgress: number;  // Added daily tracking
    dailyGoal: number;      // Added daily goal
    weeklyProgress: number;
    weeklyGoal: number;
  };
  recap: {
    status: 'not_started' | 'in_progress' | 'completed';
    weeklyProgress: number;
    weeklyGoal: number;
    // GUR-232: per-window recap completion (Today|Week toggle)
    completedToday: boolean;
    completedThisWeek: boolean;
  };
  streak: number;
  stats: {
    articlesRead: number;
    articlesSaved: number;
    filtersExplored: number;
    topTopics: { name: string; count: number }[];
    notesThisWeek: number;
    // GUR-232: today-window stats for the Today|Week toggle
    articlesReadToday: number;
    notesToday: number;
    topTopicsToday: { name: string; count: number }[];
  };
  lastUpdated: string | null;
}

export interface UserProfile {
  coreIndustry: string;
  specializations: string[];
  additionalInterests: string[];
}

interface MetricState {
  metrics: MetricsData;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
}

// Action types
type MetricAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: { metrics: MetricsData; profile: UserProfile } }
  // Stale-while-revalidate: paint cached data instantly WITHOUT touching
  // `loading` — the in-flight network refresh keeps the dim-while-loading
  // affordance on Home so the user still sees the refresh happen.
  | { type: 'HYDRATE_FROM_CACHE'; payload: { metrics: MetricsData; profile: UserProfile } }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'UPDATE_METRICS'; payload: Partial<MetricsData> };

// Initial state
const initialState: MetricState = {
  metrics: {
    catchup: {
      dailyProgress: 0,
      dailyGoal: 30,
      weeklyTotal: 0,
    },
    divein: {
      dailyProgress: 0,
      dailyGoal: 30,
      weeklyProgress: 0,
      weeklyGoal: 120,
    },
    recap: {
      status: 'not_started',
      weeklyProgress: 0,
      weeklyGoal: 60,
      completedToday: false,
      completedThisWeek: false,
    },
    streak: 0,
    stats: {
      articlesRead: 0, articlesSaved: 0, filtersExplored: 0, topTopics: [],
      notesThisWeek: 0, articlesReadToday: 0, notesToday: 0, topTopicsToday: [],
    },
    lastUpdated: null,
  },
  profile: null,
  loading: false,
  error: null,
};

// Reducer
function metricReducer(state: MetricState, action: MetricAction): MetricState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    
    case 'FETCH_SUCCESS':
      return {
        ...state,
        loading: false,
        error: null,
        metrics: action.payload.metrics,
        profile: action.payload.profile,
      };

    case 'HYDRATE_FROM_CACHE':
      return {
        ...state,
        metrics: action.payload.metrics,
        profile: action.payload.profile,
      };

    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload };

    case 'UPDATE_METRICS':
      return {
        ...state,
        metrics: { ...state.metrics, ...action.payload },
      };
    
    default:
      return state;
  }
}

// Context
interface MetricContextType {
  state: MetricState;
  dispatch: React.Dispatch<MetricAction>;
  fetchMetrics: () => Promise<void>;
  updateMetrics: (metrics: Partial<MetricsData>) => void;
}

const MetricContext = createContext<MetricContextType | undefined>(undefined);

// Provider component
interface MetricProviderProps {
  children: ReactNode;
  enablePolling?: boolean;
  pollingInterval?: number;
}

export function MetricProvider({ 
  children, 
  enablePolling = true,
  pollingInterval = 60000
}: MetricProviderProps) {
  const [state, dispatch] = useReducer(metricReducer, initialState);

  // True once the first network fetch has rendered. Used to gate cache
  // hydration: hydrate from cache once on mount (instant paint) — NOT on every
  // 60s poll, which would re-dispatch identical data.
  const hasRenderedRef = useRef(false);

  // Fetch aggregate metrics (GUR-232: Home is no longer filter-scoped).
  // Stale-while-revalidate: on first load, dispatch any cached response
  // immediately (loading stays true via FETCH_START) so the UI paints
  // instantly, then refresh over the network and update state.
  const fetchMetrics = async () => {
    if (!hasRenderedRef.current) {
      const cached = metricService.getCachedMetrics();
      if (cached) {
        dispatch({
          type: 'HYDRATE_FROM_CACHE',
          payload: { metrics: cached.metrics, profile: cached.profile },
        });
      }
    }

    dispatch({ type: 'FETCH_START' });

    try {
      const data = await metricService.getMetricsWithFallback();
      hasRenderedRef.current = true;
      dispatch({
        type: 'FETCH_SUCCESS',
        payload: {
          metrics: data.metrics,
          profile: data.profile,
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch metrics';
      console.warn('[MetricProvider] Fetch error:', message);
      dispatch({ type: 'FETCH_ERROR', payload: message });
    }
  };

  // Update metrics
  const updateMetrics = (metrics: Partial<MetricsData>) => {
    dispatch({ type: 'UPDATE_METRICS', payload: metrics });
  };

  // Smart polling: only when app is in foreground (or document visible on web)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchMetrics();

    if (!enablePolling) return;

    const startPolling = () => {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(fetchMetrics, pollingInterval);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    // Start polling initially
    startPolling();

    if (Platform.OS === 'web') {
      // Web: use document visibility API
      const handleVisibility = () => {
        if (document.hidden) {
          stopPolling();
        } else {
          fetchMetrics(); // Refresh immediately on return
          startPolling();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      return () => {
        stopPolling();
        document.removeEventListener('visibilitychange', handleVisibility);
      };
    } else {
      // Native: use AppState
      const handleAppState = (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          fetchMetrics();
          startPolling();
        } else {
          stopPolling();
        }
      };
      const sub = AppState.addEventListener('change', handleAppState);
      return () => {
        stopPolling();
        sub.remove();
      };
    }
  }, [enablePolling, pollingInterval]);

  const value: MetricContextType = {
    state,
    dispatch,
    fetchMetrics,
    updateMetrics,
  };

  return (
    <MetricContext.Provider value={value}>
      {children}
    </MetricContext.Provider>
  );
}

// Custom hook
export function useMetrics() {
  const context = useContext(MetricContext);
  if (context === undefined) {
    throw new Error('useMetrics must be used within a MetricProvider');
  }
  return context;
}
