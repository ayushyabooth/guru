import React, { createContext, useContext, useReducer, ReactNode } from 'react';

// Types for onboarding state
export interface OnboardingState {
  coreIndustry: string | null;
  specializations: string[];
  additionalInterests: string[];
  weeklyCapacity: string | null;
  catchupDailyGoal: number | null;
  catchupDailyMax: number | null;
  diveinWeeklyGoal: number | null;
  recapWeeklyGoal: number | null;
  isComplete: boolean;
  currentStep: number;
}

// Action types
type OnboardingAction =
  | { type: 'SET_CORE_INDUSTRY'; payload: string }
  | { type: 'SET_SPECIALIZATIONS'; payload: string[] }
  | { type: 'SET_ADDITIONAL_INTERESTS'; payload: string[] }
  | { type: 'SET_WEEKLY_CAPACITY'; payload: string }
  | { type: 'SET_CATCHUP_GOALS'; payload: { dailyGoal: number; dailyMax: number } }
  | { type: 'SET_WEEKLY_GOALS'; payload: { diveinGoal: number; recapGoal: number } }
  | { type: 'NEXT_STEP' }
  | { type: 'PREVIOUS_STEP' }
  | { type: 'SET_STEP'; payload: number }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'RESET_ONBOARDING' };

// Initial state
const initialState: OnboardingState = {
  coreIndustry: null,
  specializations: [],
  additionalInterests: [],
  weeklyCapacity: null,
  catchupDailyGoal: null,
  catchupDailyMax: null,
  diveinWeeklyGoal: null,
  recapWeeklyGoal: null,
  isComplete: false,
  currentStep: 0,
};

// Reducer
function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'SET_CORE_INDUSTRY':
      return { ...state, coreIndustry: action.payload };
    
    case 'SET_SPECIALIZATIONS':
      return { ...state, specializations: action.payload };
    
    case 'SET_ADDITIONAL_INTERESTS':
      return { ...state, additionalInterests: action.payload };
    
    case 'SET_WEEKLY_CAPACITY':
      return { ...state, weeklyCapacity: action.payload };
    
    case 'SET_CATCHUP_GOALS':
      return {
        ...state,
        catchupDailyGoal: action.payload.dailyGoal,
        catchupDailyMax: action.payload.dailyMax,
      };
    
    case 'SET_WEEKLY_GOALS':
      return {
        ...state,
        diveinWeeklyGoal: action.payload.diveinGoal,
        recapWeeklyGoal: action.payload.recapGoal,
      };
    
    case 'NEXT_STEP':
      return { ...state, currentStep: Math.min(state.currentStep + 1, 5) };
    
    case 'PREVIOUS_STEP':
      return { ...state, currentStep: Math.max(state.currentStep - 1, 0) };
    
    case 'SET_STEP':
      return { ...state, currentStep: action.payload };
    
    case 'COMPLETE_ONBOARDING':
      return { ...state, isComplete: true };
    
    case 'RESET_ONBOARDING':
      return initialState;
    
    default:
      return state;
  }
}

// Context
interface OnboardingContextType {
  state: OnboardingState;
  dispatch: React.Dispatch<OnboardingAction>;
  setCoreIndustry: (industry: string) => void;
  setSpecializations: (specializations: string[]) => void;
  setAdditionalInterests: (interests: string[]) => void;
  setWeeklyCapacity: (capacity: string) => void;
  setCatchupGoals: (dailyGoal: number, dailyMax: number) => void;
  setWeeklyGoals: (diveinGoal: number, recapGoal: number) => void;
  nextStep: () => void;
  previousStep: () => void;
  goToStep: (step: number) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  canProceed: () => boolean;
  getProfileData: () => any;
}

const OnboardingContext = createContext<OnboardingContextType | undefined>(undefined);

// Provider component
interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);

  // Helper functions
  const setCoreIndustry = (industry: string) => {
    dispatch({ type: 'SET_CORE_INDUSTRY', payload: industry });
  };

  const setSpecializations = (specializations: string[]) => {
    dispatch({ type: 'SET_SPECIALIZATIONS', payload: specializations });
  };

  const setAdditionalInterests = (interests: string[]) => {
    dispatch({ type: 'SET_ADDITIONAL_INTERESTS', payload: interests });
  };

  const setWeeklyCapacity = (capacity: string) => {
    dispatch({ type: 'SET_WEEKLY_CAPACITY', payload: capacity });
  };

  const setCatchupGoals = (dailyGoal: number, dailyMax: number) => {
    dispatch({ type: 'SET_CATCHUP_GOALS', payload: { dailyGoal, dailyMax } });
  };

  const setWeeklyGoals = (diveinGoal: number, recapGoal: number) => {
    dispatch({ type: 'SET_WEEKLY_GOALS', payload: { diveinGoal, recapGoal } });
  };

  const nextStep = () => {
    dispatch({ type: 'NEXT_STEP' });
  };

  const previousStep = () => {
    dispatch({ type: 'PREVIOUS_STEP' });
  };

  const goToStep = (step: number) => {
    dispatch({ type: 'SET_STEP', payload: step });
  };

  const completeOnboarding = () => {
    dispatch({ type: 'COMPLETE_ONBOARDING' });
  };

  const resetOnboarding = () => {
    dispatch({ type: 'RESET_ONBOARDING' });
  };

  // Validation function to check if user can proceed from current step
  const canProceed = (): boolean => {
    switch (state.currentStep) {
      case 0: // Industry selection
        return state.coreIndustry !== null;
      case 1: // Specializations (up to 4)
        return state.specializations.length >= 1 && state.specializations.length <= 4;
      case 2: // Additional interests (optional)
        return true; // Always can proceed as this is optional
      case 3: // Weekly capacity
        return state.weeklyCapacity !== null;
      case 4: // Catchup goals
        return state.catchupDailyGoal !== null && state.catchupDailyMax !== null;
      case 5: // Weekly goals
        return state.diveinWeeklyGoal !== null && state.recapWeeklyGoal !== null;
      default:
        return false;
    }
  };

  // Get profile data for API submission
  const getProfileData = () => {
    return {
      core_industry: state.coreIndustry,
      specializations: state.specializations,
      additional_interest_industries: state.additionalInterests,
      total_weekly_capacity_band: state.weeklyCapacity,
      catchup_daily_goal_minutes: state.catchupDailyGoal,
      catchup_daily_max_minutes: state.catchupDailyMax,
      divein_weekly_goal_minutes: state.diveinWeeklyGoal,
      recap_weekly_goal_minutes: state.recapWeeklyGoal,
    };
  };

  const value: OnboardingContextType = {
    state,
    dispatch,
    setCoreIndustry,
    setSpecializations,
    setAdditionalInterests,
    setWeeklyCapacity,
    setCatchupGoals,
    setWeeklyGoals,
    nextStep,
    previousStep,
    goToStep,
    completeOnboarding,
    resetOnboarding,
    canProceed,
    getProfileData,
  };

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

// Custom hook
export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (context === undefined) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}

// DEPRECATED: These constants are no longer used. Industries and specializations
// should be fetched from the API at /api/v1/config/industries and
// /api/v1/config/industries/{industry_id}/specializations
// The onboarding screens already do this - see industry.tsx, specializations.tsx
// Keeping for backward compatibility but DO NOT use in new code.
// @deprecated Use API endpoints instead
export const INDUSTRIES = [
  'Consumer',
  'Technology',
  'Finance',
];

// @deprecated Use API endpoint /api/v1/config/industries/{id}/specializations instead
export const SPECIALIZATIONS: Record<string, string[]> = {
  // These are stale - actual specializations come from backend config
};

export const WEEKLY_CAPACITY_OPTIONS = [
  { value: 'Light', label: 'Light (1-2 hours)', description: 'Perfect for busy schedules' },
  { value: 'Medium', label: 'Medium (3-5 hours)', description: 'Balanced learning approach' },
  { value: 'Heavy', label: 'Heavy (6+ hours)', description: 'Deep dive into insights' },
];
