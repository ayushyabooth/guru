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
  };
  streak: number;
  stats: {
    articlesRead: number;
    articlesSaved: number;
    filtersExplored: number;
    topTopics: { name: string; count: number }[];
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
  activeFilter: string;
}

// Action types
type MetricAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: { metrics: MetricsData; profile: UserProfile } }
  | { type: 'FETCH_ERROR'; payload: string }
  | { type: 'SET_ACTIVE_FILTER'; payload: string }
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
    },
    streak: 0,
    stats: { articlesRead: 0, articlesSaved: 0, filtersExplored: 0, topTopics: [] },
    lastUpdated: null,
  },
  profile: null,
  loading: false,
  error: null,
  activeFilter: 'core',
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
    
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.payload };
    
    case 'SET_ACTIVE_FILTER':
      return { ...state, activeFilter: action.payload };
    
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
  setActiveFilter: (filter: string) => void;
  updateMetrics: (metrics: Partial<MetricsData>) => void;
  getFilterTabs: () => Array<{
    id: string;
    label: string;
    type: 'core' | 'specialization' | 'interest';
    value: string;
  }>;
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

  // Fetch metrics function
  const fetchMetrics = async () => {
    dispatch({ type: 'FETCH_START' });
    
    try {
      const data = await metricService.getMetricsWithFallback();
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

  // Set active filter
  const setActiveFilter = (filter: string) => {
    dispatch({ type: 'SET_ACTIVE_FILTER', payload: filter });
  };

  // Update metrics
  const updateMetrics = (metrics: Partial<MetricsData>) => {
    dispatch({ type: 'UPDATE_METRICS', payload: metrics });
  };

  // Generate filter tabs based on user profile
  const getFilterTabs = () => {
    const tabs = [];
    
    if (state.profile) {
      // Core industry tab
      tabs.push({
        id: 'core',
        label: state.profile.coreIndustry,
        type: 'core' as const,
        value: 'core',
      });

      // Specialization tabs
      state.profile.specializations.forEach((spec, index) => {
        tabs.push({
          id: `specialization-${index}`,
          label: spec,
          type: 'specialization' as const,
          value: `specialization:${spec}`,
        });
      });

      // Additional interest tabs
      state.profile.additionalInterests.forEach((interest, index) => {
        tabs.push({
          id: `interest-${index}`,
          label: interest,
          type: 'interest' as const,
          value: `interest:${interest}`,
        });
      });
    }

    return tabs;
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
    setActiveFilter,
    updateMetrics,
    getFilterTabs,
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
