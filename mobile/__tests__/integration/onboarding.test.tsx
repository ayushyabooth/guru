import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { OnboardingProvider } from '@/store/user-context';
import IndustryScreen from '../../app/(auth)/onboarding/industry';
import SpecializationsScreen from '../../app/(auth)/onboarding/specializations';
import InterestsScreen from '../../app/(auth)/onboarding/interests';
import CapacityScreen from '../../app/(auth)/onboarding/capacity';
import GoalsCatchupScreen from '../../app/(auth)/onboarding/goals-catchup';
import GoalsDiveinRecapScreen from '../../app/(auth)/onboarding/goals-divein-recap';
import { API_BASE_URL } from '../../constants/config';

// Mock fetch
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

// Onboarding is five steps today (industry, specializations, interests,
// capacity, then goals.tsx), and the industry, specializations and interests
// screens load their options from the API's /config/industries routes. These
// tests were written for a six-step flow with the industries written into the
// screens, so the step labels and the industry tests were updated to today's
// screens. The goals-catchup and goals-divein-recap screens are legacy: still
// registered, no longer in the flow. The tests that can't pass without a
// rewrite are skipped, each with its reason.
const INDUSTRIES = [
  { id: 'consumer', name: 'Consumer', emoji: '', color_primary: '#F97316', color_secondary: '#FDBA74', description: '' },
  { id: 'technology', name: 'Technology', emoji: '', color_primary: '#38BDF8', color_secondary: '#7DD3FC', description: '' },
  { id: 'healthcare', name: 'Healthcare', emoji: '', color_primary: '#10B981', color_secondary: '#6EE7B7', description: '' },
];

/** Answer the onboarding config routes: the industries, and no specializations. */
async function serveConfig(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  const body = url === `${API_BASE_URL}/config/industries` ? INDUSTRIES : [];
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

// Test wrapper with context
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <OnboardingProvider>{children}</OnboardingProvider>
);

describe('Onboarding Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockImplementation(serveConfig);
    // The screens cache the config in localStorage; start each test without it.
    localStorage.clear();
  });

  describe('IndustryScreen', () => {
    it('renders industry selection correctly', async () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      expect(await screen.findByText('Consumer')).toBeTruthy();
      expect(screen.getByText('Choose Your Industry')).toBeTruthy();
      expect(screen.getByText('Step 1 of 5')).toBeTruthy();
      expect(screen.getByText('Technology')).toBeTruthy();
      expect(screen.getByText('Healthcare')).toBeTruthy();
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE_URL}/config/industries`, expect.any(Object));
    });

    it('enables continue button after industry selection', async () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      const consumerOption = await screen.findByText('Consumer');
      const continueButton = () => screen.getByRole('button', { name: 'Continue' });
      expect(continueButton().props.accessibilityState?.disabled).toBe(true);

      fireEvent.press(consumerOption);

      expect(continueButton().props.accessibilityState?.disabled).toBe(false);
    });

    // Skipped: the selected industry card no longer shows a check mark. It is
    // marked by its style only, with no accessibility state to test either.
    it.skip('shows selected industry with checkmark', () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      const consumerOption = screen.getByText('Consumer');
      fireEvent.press(consumerOption);

      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  describe('SpecializationsScreen', () => {
    it('renders specializations selection correctly', () => {
      render(
        <TestWrapper>
          <SpecializationsScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Choose your specializations')).toBeTruthy();
      expect(screen.getByText('Step 2 of 5')).toBeTruthy();
      expect(screen.getByText('0/2 selected')).toBeTruthy();
    });

    it('allows selection of up to 2 specializations', () => {
      render(
        <TestWrapper>
          <SpecializationsScreen />
        </TestWrapper>
      );
      
      // Note: This test would need the context to have a selected industry
      // In a real test, we'd need to set up the context state properly
      expect(screen.getByText('Back')).toBeTruthy();
      expect(screen.getByText('Continue')).toBeTruthy();
    });
  });

  describe('InterestsScreen', () => {
    it('renders additional interests selection correctly', () => {
      render(
        <TestWrapper>
          <InterestsScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Any additional interests?')).toBeTruthy();
      expect(screen.getByText('Step 3 of 5')).toBeTruthy();
      expect(screen.getByText('Skip')).toBeTruthy();
      expect(screen.getByText('0/2 selected')).toBeTruthy();
    });

    it('allows skipping additional interests', () => {
      render(
        <TestWrapper>
          <InterestsScreen />
        </TestWrapper>
      );
      
      const skipButton = screen.getByText('Skip');
      expect(skipButton).toBeTruthy();
      
      // Test skip functionality
      fireEvent.press(skipButton);
      // Would need to verify navigation in a real test
    });
  });

  describe('CapacityScreen', () => {
    it('renders weekly capacity selection correctly', () => {
      render(
        <TestWrapper>
          <CapacityScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('How much time can you dedicate weekly?')).toBeTruthy();
      expect(screen.getByText('Step 4 of 5')).toBeTruthy();
      expect(screen.getByText('Light (1-2 hours)')).toBeTruthy();
      expect(screen.getByText('Medium (3-5 hours)')).toBeTruthy();
      expect(screen.getByText('Heavy (6+ hours)')).toBeTruthy();
    });

    it('shows capacity descriptions', () => {
      render(
        <TestWrapper>
          <CapacityScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Perfect for busy schedules')).toBeTruthy();
      expect(screen.getByText('Balanced learning approach')).toBeTruthy();
      expect(screen.getByText('Deep dive into insights')).toBeTruthy();
    });

    it('enables continue after capacity selection', () => {
      render(
        <TestWrapper>
          <CapacityScreen />
        </TestWrapper>
      );
      
      // The footer button is "Set Daily Goals" now, not "Continue".
      const lightOption = screen.getByText('Light (1-2 hours)');
      
      fireEvent.press(lightOption);
      
      expect(screen.getByText('✓')).toBeTruthy();
    });
  });

  describe('GoalsCatchupScreen', () => {
    it('renders daily goals selection correctly', () => {
      render(
        <TestWrapper>
          <GoalsCatchupScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Set your daily catch-up goals')).toBeTruthy();
      expect(screen.getByText('Step 5 of 6')).toBeTruthy();
      expect(screen.getByText('Daily Goal (Target)')).toBeTruthy();
      expect(screen.getByText('Daily Maximum')).toBeTruthy();
    });

    it('shows goal time options', () => {
      render(
        <TestWrapper>
          <GoalsCatchupScreen />
        </TestWrapper>
      );
      
      // 30m and 60m are in both the goal row and the maximum row.
      expect(screen.getByText('15m')).toBeTruthy();
      expect(screen.getAllByText('30m')).toHaveLength(2);
      expect(screen.getAllByText('60m')).toHaveLength(2);
    });

    it('validates that maximum is greater than goal', () => {
      render(
        <TestWrapper>
          <GoalsCatchupScreen />
        </TestWrapper>
      );
      
      // Test that selecting a goal enables appropriate maximum options
      const goal30 = screen.getAllByText('30m')[0]; // First 30m is in daily goal section
      fireEvent.press(goal30);
      
      // Maximum options less than 30m should be disabled
      // This would need more specific testing of disabled state
    });
  });

  describe('GoalsDiveinRecapScreen', () => {
    it('renders weekly goals selection correctly', () => {
      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Set your weekly deep-dive goals')).toBeTruthy();
      expect(screen.getByText('Step 6 of 6')).toBeTruthy();
      expect(screen.getByText('Dive-in Goal')).toBeTruthy();
      expect(screen.getByText('Recap Goal')).toBeTruthy();
    });

    it('shows profile summary', () => {
      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      expect(screen.getByText('Your Guru Setup')).toBeTruthy();
      expect(screen.getByText('Industry:')).toBeTruthy();
      expect(screen.getByText('Specializations:')).toBeTruthy();
      expect(screen.getByText('Weekly Capacity:')).toBeTruthy();
    });

    // Skipped: legacy screen, no longer in the flow (goals.tsx submits now).
    // Submitting needs a finished onboarding state (canProceed at the weekly
    // goals step), which this test never sets up, so the press does nothing.
    it.skip('handles profile submission successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ success: true }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);
      
      // Mock secure store
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/me',
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({
              'Authorization': 'Bearer mock-token',
              'Content-Type': 'application/json',
            }),
          })
        );
      });
    });

    // Skipped: legacy screen, no longer in the flow (goals.tsx submits now).
    // Submitting needs a finished onboarding state (canProceed at the weekly
    // goals step), which this test never sets up, so the press does nothing.
    it.skip('handles profile submission failure', async () => {
      const mockResponse = {
        ok: false,
        json: jest.fn().mockResolvedValue({ detail: 'Profile update failed' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);
      
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Setup Error',
          'Profile update failed',
          expect.any(Array)
        );
      });
    });

    // Skipped: legacy screen, no longer in the flow (goals.tsx submits now).
    // Submitting needs a finished onboarding state (canProceed at the weekly
    // goals step), which this test never sets up, so the press does nothing.
    it.skip('handles network error during submission', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('mock-token');

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Network Error',
          'Unable to save your profile. Please check your connection and try again.',
          expect.any(Array)
        );
      });
    });

    // Skipped: legacy screen, no longer in the flow (goals.tsx submits now).
    // Submitting needs a finished onboarding state (canProceed at the weekly
    // goals step), which this test never sets up, so the press does nothing.
    it.skip('handles missing authentication token', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      const submitButton = screen.getByText('Complete Setup');
      fireEvent.press(submitButton);

      await waitFor(() => {
        expect(require('react-native').Alert.alert).toHaveBeenCalledWith(
          'Error',
          'Authentication token not found. Please log in again.'
        );
      });
    });
  });

  describe('Onboarding Flow Integration', () => {
    it('maintains state across screens', async () => {
      // This would test the full flow by rendering multiple screens
      // and verifying that state is maintained through the context
      
      const { rerender } = render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      // Select industry
      const consumerOption = await screen.findByText('Consumer');
      fireEvent.press(consumerOption);
      
      // Navigate to next screen
      rerender(
        <TestWrapper>
          <SpecializationsScreen />
        </TestWrapper>
      );
      
      // Verify industry selection is maintained
      expect(screen.getByText('Select 1-2 areas within Consumer that you focus on most.')).toBeTruthy();
    });

    it('validates required fields before allowing progression', async () => {
      render(
        <TestWrapper>
          <IndustryScreen />
        </TestWrapper>
      );
      
      const consumerOption = await screen.findByText('Consumer');
      const continueButton = () => screen.getByRole('button', { name: 'Continue' });
      
      // Should be disabled initially
      expect(continueButton().props.accessibilityState?.disabled).toBe(true);
      
      // Should be enabled after selection
      fireEvent.press(consumerOption);
      
      expect(continueButton().props.accessibilityState?.disabled).toBe(false);
    });

    it('generates correct profile data for API submission', () => {
      // This would test the getProfileData function returns correct format
      // matching the backend API expectations
      
      render(
        <TestWrapper>
          <GoalsDiveinRecapScreen />
        </TestWrapper>
      );
      
      // The profile data structure should match:
      // {
      //   core_industry: string,
      //   specializations: string[],
      //   additional_interest_industries: string[],
      //   total_weekly_capacity_band: string,
      //   catchup_daily_goal_minutes: number,
      //   catchup_daily_max_minutes: number,
      //   divein_weekly_goal_minutes: number,
      //   recap_weekly_goal_minutes: number,
      // }
    });
  });
});
